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
