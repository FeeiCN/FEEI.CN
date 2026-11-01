import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import createJiti from 'jiti';

const jiti = createJiti(import.meta.url);
const {additionalHealthMetricFiles, compactHealthMetricSummary, healthTimelineCoverageMinutes, healthTimelinePeriodLabel, indexHealthTimelineRows, parseHealthMetricTimeline} = jiti(fileURLToPath(new URL('../src/utils/healthTimeline.ts', import.meta.url)));
const date = '2026-10-31';
const parse = (name, columns, rows, units = 'count') => parseHealthMetricTimeline(date, {name, path: 'synthetic.json.gz'}, {
  version: 5, date, metric: {name, columns, rows, units},
});

test('five-minute totals preserve zero readings and gaps', () => {
  const row = parse('step_count', ['qty', 'dateMinute'], [[0.2, 1], [0.3, 2], [0, 10], [1, 60]]);
  assert.deepEqual(row.periods.map(({start, end, value}) => [start, end, value]), [[0, 5, 0.5], [10, 15, 0], [60, 65, 1]]);
  assert.match(row.summary, /采样合计 1.5 步/);
});

test('authoritative daily totals stay distinct from sums of raw samples', () => {
  const row = parseHealthMetricTimeline(date, {name: 'step_count', path: 'synthetic', dailyValue: 10}, {
    version: 5, date, metric: {name: 'step_count', units: 'count', columns: ['dateMinute', 'qty'], rows: [[1, 5], [2, 7]]},
  });
  assert.match(row.summary, /日汇总 10 步/);
  assert.equal(row.periods[0].value, 12);
  assert.match(row.periods[0].detail, /原始采样合计/);
});

test('heart rate uses Avg with reordered columns and retains ranges', () => {
  const row = parse('heart_rate', ['Max', 'endMinute', 'Avg', 'sourceId', 'Min', 'startMinute'], [[90, 20, 80, 'watch', 70, 20]], 'count/min');
  assert.equal(row.periods[0].start, row.periods[0].end);
  assert.equal(row.periods[0].value, 80);
  assert.match(row.periods[0].detail, /70 次\/分–90 次\/分/);
  assert.match(row.periods[0].detail, /Apple Watch/);
});

test('dense gauge samples use means and bounded five-minute bins', () => {
  const row = parse('new_metric', ['dateMinute', 'qty'], Array.from({length: 601}, (_, index) => [index / 200, index]), 'custom');
  assert.equal(row.periods.length, 1);
  assert.equal(row.periods[0].value, 300);
  assert.match(row.periods[0].detail, /采样均值/);
  assert.match(row.periods[0].detail, /0 custom–600 custom/);
});

test('daily statistics retain their coverage and are marked explicitly', () => {
  const row = parse('resting_heart_rate', ['startMinute', 'endMinute', 'qty'], [[3, 1438, 65]], 'count/min');
  assert.equal(row.periods[0].statistic, true);
  assert.equal(row.periods[0].start, 3);
  assert.equal(row.periods[0].end, 1438);
  assert.match(row.periods[0].detail, /日统计覆盖时段/);
});

test('conversions require matching source units', () => {
  assert.equal(parse('active_energy', ['dateMinute', 'qty'], [[20, 4.184]], 'kJ').periods[0].value, 1);
  const unexpected = parse('active_energy', ['dateMinute', 'qty'], [[20, 10]], 'kcal');
  assert.equal(unexpected.periods[0].value, 10);
  assert.match(unexpected.periods[0].detail, /10 kcal/);
  assert.equal(parse('weight_body_mass', ['dateMinute', 'qty'], [[20, 70]], 'kg').periods[0].value, 140);
});

test('invalid and out-of-day records are skipped; valid intervals are clipped', () => {
  const row = parse('respiratory_rate', ['startMinute', 'endMinute', 'qty'], [[-5, 5, 15], [1435, 1450, 20], [1500, 1500, 18], [10, 9, 18], [20, 20, NaN]]);
  assert.deepEqual(row.periods.map(({start, end}) => [start, end]), [[0, 5], [1435, 1440]]);
  assert.throws(() => parseHealthMetricTimeline(date, {name: 'step_count', path: 'synthetic'}, {version: 5, date: '2026-10-30', metric: {name: 'step_count', columns: [], rows: []}}));
});

test('manifest discovery keeps new metrics and excludes existing or empty tracks', () => {
  const files = additionalHealthMetricFiles({
    'metrics/heart/heart_rate_variability.json.gz': {path: 'synthetic/hrv'},
    'metrics/activity/step_count.json.gz': {path: 'synthetic/steps', records: 2},
    'metrics/other/new_metric.json.gz': {path: 'synthetic/new', records: 1},
    'metrics/other/empty.json.gz': {path: 'synthetic/empty', records: 0},
    'aggregate.json.gz': {path: 'synthetic/aggregate'},
  });
  assert.deepEqual(files.map(({name}) => name), ['step_count', 'new_metric']);
});

test('medication events keep actual and planned times separate and group concurrent doses', () => {
  const rows = indexHealthTimelineRows({doses: [
    {takenMinute: 720.1, scheduledMinute: 570, name: '合成药品甲', status: '已服用', dosage: 1},
    {takenMinute: 720.2, scheduledMinute: 780, name: '合成药品乙', status: '已服用', dosage: 2},
    {scheduledMinute: 900, name: '合成药品丙'},
  ]});
  assert.equal(rows[0].periods.length, 2);
  assert.equal(rows[0].periods[0].start, 720.1);
  assert.match(rows[0].periods[0].detail, /合成药品甲[\s\S]*合成药品乙/);
  assert.match(rows[0].periods[0].detail, /计划 09:30/);
  assert.match(rows[0].periods[1].detail, /计划用药/);
});

test('movement coverage merges overlaps and clips to the day without counting gaps', () => {
  const periods = [{start: 20, end: 30}, {start: -5, end: 5}, {start: 0, end: 10}, {start: 1435, end: 1450}, {start: 8, end: 12}, {start: 40, end: 39}];
  assert.equal(healthTimelineCoverageMinutes(periods), 27);
  assert.equal(periods[0].start, 20);
});

test('standing shows recorded minutes rather than the span of sampling windows', () => {
  const data = {standPeriods: [[0, 5, 1], [20, 25, 2], [30, 40, 8]]};
  const row = indexHealthTimelineRows(data)[0];
  assert.match(row.summary, /^11 分钟/);
  assert.equal(healthTimelineCoverageMinutes(row.periods), 20);
  assert.match(indexHealthTimelineRows({...data, standMinutes: 15})[0].summary, /^15 分钟/);
  assert.match(indexHealthTimelineRows({...data, standMinutes: 0})[0].summary, /^0 分钟/);
});

test('compact values retain units and meaningful precision while detail keeps the source value', () => {
  const row = parseHealthMetricTimeline(date, {name: 'step_count', path: 'synthetic', dailyValue: 7950.16}, {
    version: 5, date, metric: {name: 'step_count', units: 'count', columns: ['dateMinute', 'qty'], rows: [[1, 12.6]]},
  });
  assert.equal(compactHealthMetricSummary(row), '7,950 步');
  assert.match(row.summary, /7,950.16 步/);
  assert.match(row.periods[0].detail, /12.6 步/);
  assert.equal(compactHealthMetricSummary({id: 'heart_rate', summary: '83.26 次/分'}), '83 次/分');
  assert.equal(compactHealthMetricSummary({id: 'active_energy', summary: '日汇总 414.44 千卡'}), '414 千卡');
  assert.equal(compactHealthMetricSummary({id: 'walking_running_distance', summary: '5.67 公里'}), '5.67 公里');
  assert.equal(compactHealthMetricSummary({id: 'walking_step_length', summary: '63.42 厘米'}), '63.4 厘米');
  assert.equal(compactHealthMetricSummary({id: 'new_metric', summary: '0.123 custom'}), '0.123 custom');
});

test('sub-minute periods show seconds while points and whole-minute spans stay concise', () => {
  assert.equal(healthTimelinePeriodLabel({start: 32.25, end: 32.75}), '00:32:15–00:32:45');
  assert.equal(healthTimelinePeriodLabel({start: 32.251, end: 32.252}), '00:32:15.06–00:32:15.12');
  assert.equal(healthTimelinePeriodLabel({start: 32, end: 32}), '00:32');
  assert.equal(healthTimelinePeriodLabel({start: 1435, end: 1440}), '23:55–24:00');
});

const {healthBandBuckets, healthBandSample, healthMetricComparison, healthBandOpacity, vitalsEntryLabel, activityEntryLabel, availableHealthMetrics, healthMetricBaseline, healthMetricDefinitions, healthMetricValue, healthSampleSeries} = jiti(fileURLToPath(new URL('../src/utils/healthPresentation.ts', import.meta.url)));

test('health entry points remain available without mood or exercise-minute records', () => {
  const day = {date, activity: {steps: 6800}, heart: {hrv: {dailyMs: 42}, restingHeartRateBpm: 61}};
  assert.equal(activityEntryLabel(day), '活动6,800步');
  assert.deepEqual(availableHealthMetrics(day, ['vitals']).map((item) => item.name), ['heart_rate_variability', 'resting_heart_rate']);
  assert.equal(activityEntryLabel({date, activity: {exerciseMinutes: 0, steps: 6800}}), '活动0分钟');
  assert.equal(activityEntryLabel({date, activity: {workouts: [{type: '游泳'}]}}), '训练1次');
  assert.equal(activityEntryLabel({date}), null);
});

test('metrics present only in the declared manifest are discoverable in their own groups', () => {
  const day = {date, files: {
    'metrics/bodyMeasurements/height.json.gz': {path: 'height', records: 1},
    'metrics/mindfulness/mindful_minutes.json.gz': {path: 'mindful', records: 2},
    'metrics/activity/swimming_distance.json.gz': {path: 'swim', records: 10},
    'metrics/activityCapability/stair_speed_up.json.gz': {path: 'stairs', records: 1},
  }};
  assert.deepEqual(availableHealthMetrics(day, ['body']).map((item) => item.name), ['height']);
  assert.deepEqual(availableHealthMetrics(day, ['mindfulness']).map((item) => item.name), ['mindful_minutes']);
  assert.equal(activityEntryLabel(day), '活动');
  assert.equal(availableHealthMetrics(day, ['capability']).length, 0);
});

test('baseline excludes the current day and needs four actual prior measurements', () => {
  const definition = healthMetricDefinitions.find((item) => item.name === 'heart_rate_variability');
  const days = [20, 30, 40, 50].map((value, index) => ({date: `2026-10-${24 + index}`, heart: {hrv: {dailyMs: value}}}));
  days.push({date, heart: {hrv: {dailyMs: 200}}});
  assert.equal(healthMetricBaseline(days, date, definition), 35);
  assert.equal(healthMetricBaseline(days.slice(1), date, definition), null);
  assert.equal(healthMetricValue({date, respiratory: {bloodOxygenFraction: 0.97}}, healthMetricDefinitions.find((item) => item.name === 'blood_oxygen_saturation')), 97);
});

test('sample curves preserve zero values and explicitly break across unrecorded gaps', () => {
  const points = healthSampleSeries([{start: 50, end: 50, value: 80}, {start: 0, end: 0, value: 0}, {start: 5, end: 5, value: 60}]);
  assert.deepEqual(points, [[0, 0], [5, 60], [5.001, null], [50, 80]]);
});


test('vitals entry identifies HRV first and falls back to resting heart rate without inventing a score', () => {
  assert.equal(vitalsEntryLabel({date, heart: {hrv: {dailyMs: 38.4}, restingHeartRateBpm: 68}}), '体征 HRV38毫秒');
  assert.equal(vitalsEntryLabel({date, heart: {restingHeartRateBpm: 68}}), '体征 静息68次/分');
  assert.equal(vitalsEntryLabel({date, heart: {hrv: {dailyMs: 0}, restingHeartRateBpm: 68}}), '体征 HRV0毫秒');
  assert.equal(vitalsEntryLabel({date, heart: {hrv: {dailyMs: NaN}}}), '体征');
});


test('overview bands preserve zeros and normalize each metric separately, while HRV keeps its fixed scale', () => {
  assert.equal(healthBandOpacity(0, [0, 20]), 0.25);
  assert.equal(healthBandOpacity(10, [0, 20]), 0.625);
  assert.equal(healthBandOpacity(20, [0, 20]), 1);
  assert.equal(healthBandOpacity(80, [60, 100]), healthBandOpacity(10, [0, 20]));
  assert.equal(healthBandOpacity(5, [5, 5]), 0.65);
  assert.equal(healthBandOpacity(undefined), 1);
  assert.equal(healthBandOpacity(50, [10, 80], true), 0.625);
  assert.equal(healthBandOpacity(150, [10, 150], true), 1);
});


test('pixel bins average overlapping samples without drawing duplicates or filling missing bins', () => {
  const periods = [{start: 0, end: 0, value: 0}, {start: 5, end: 5, value: 20}, {start: 60, end: 60, value: 80}];
  const bins = healthBandBuckets(periods, 144);
  assert.deepEqual(bins.map(({start, end, value}) => [start, end, value]), [[0, 20, 10], [60, 80, 80]]);
  assert.equal(healthBandBuckets(periods, 288).length, 2);
  assert.equal(healthBandBuckets([{start: 0, end: 0, value: 0}], 144)[0].value, 0);
});

test('total bins distribute interval quantities once and preserve the total across widths', () => {
  const periods = [{start: 0, end: 40, value: 80}, {start: 60, end: 60, value: 20}];
  for (const width of [120, 144, 288]) {
    const bins = healthBandBuckets(periods, width, true);
    assert.ok(Math.abs(bins.reduce((sum, bin) => sum + bin.value, 0) - 100) < 1e-8);
    assert.ok(bins.every((bin) => bin.end <= 1440));
  }
  assert.equal(healthBandBuckets([{start: 10, end: 20, detail: 'event'}], 144)[0].value, undefined);
});

test('linked readings use actual intervals or nearby point times without extrapolating across gaps', () => {
  const interval = {start: 0, end: 20, value: 0};
  const point = {start: 65, end: 65, value: 80};
  assert.equal(healthBandSample([interval, point], 10), interval);
  assert.equal(healthBandSample([interval, point], 20), undefined);
  assert.equal(healthBandSample([interval, point], 60), point);
  assert.equal(healthBandSample([interval, point], 40), undefined);
  assert.equal(healthBandSample([point], 0, 10), undefined);
});

test('overview comparisons round at display precision and never label a change as good or bad', () => {
  const definition = healthMetricDefinitions.find((item) => item.name === 'resting_heart_rate');
  const days = [65, 65, 65, 65].map((value, index) => ({date: `2026-10-${24 + index}`, heart: {restingHeartRateBpm: value}}));
  assert.equal(healthMetricComparison(days, {date, heart: {restingHeartRateBpm: 67}}, definition), '较前 7 日中位数 +2 次/分');
  assert.equal(healthMetricComparison(days, {date, heart: {restingHeartRateBpm: 64.9}}, definition), '与前 7 日中位数持平');
  assert.equal(healthMetricComparison(days.slice(1), {date, heart: {restingHeartRateBpm: 65}}, definition), '基线记录不足');
});

const {createHealthPeriodCache, healthMetricCacheKey} = jiti(fileURLToPath(new URL('../src/utils/healthMetricCache.ts', import.meta.url)));

test('parsed-period cache reuses empty and populated results and isolates dates, revisions and files', async () => {
  const cache = createHealthPeriodCache(2);
  const signal = new AbortController().signal;
  let calls = 0;
  const load = () => {calls++; return Promise.resolve([]);};
  const key = healthMetricCacheKey({date, revision: 'a'}, 'hrv', 'a/hrv');
  await cache.load(key, signal, load);
  await cache.load(key, signal, load);
  assert.equal(calls, 1);
  const revised = healthMetricCacheKey({date, revision: 'b'}, 'hrv', 'b/hrv');
  assert.notEqual(key, revised);
  assert.notEqual(key, healthMetricCacheKey({date: '2026-10-30', revision: 'a'}, 'hrv', 'a/hrv'));
  assert.notEqual(key, healthMetricCacheKey({date, revision: 'a'}, 'heart_rate', 'a/hr'));
  await cache.load(revised, signal, load);
  cache.get(key);
  await cache.load('third', signal, load);
  assert.deepEqual(cache.get(key), []);
  assert.equal(cache.get(revised), undefined);
});

test('failed and cancelled loads cannot poison the cache or block retry', async () => {
  const cache = createHealthPeriodCache();
  const controller = new AbortController();
  await assert.rejects(cache.load('failed', controller.signal, () => Promise.reject(new Error('offline'))));
  assert.equal(cache.get('failed'), undefined);
  await cache.load('failed', controller.signal, () => Promise.resolve([]));
  await assert.rejects(cache.load('aborted', controller.signal, async () => {controller.abort(); return [];}), {name: 'AbortError'});
  assert.equal(cache.get('aborted'), undefined);
});
