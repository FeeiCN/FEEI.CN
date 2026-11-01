import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {gunzipSync} from 'node:zlib';
import {transform} from './health_chart_transform.generated.mjs';
import {
  buildMonthlyHealthFromDailyFiles,
  compactMonthlyDetails,
  mergeMonthData,
  monthlyPayload,
  selectDay,
} from './health_month_storage.mjs';

const point = (date, qty = 1) => ({date: `${date} 00:00:00 +0800`, qty});
const payload = (points) => ({exportedAt: '2025-03-01', data: {
  healthMetrics: {metrics: [{name: 'step_count', units: 'count', data: points}]},
  workouts: {workouts: [{start: '2025-01-31 23:00:00 +0800', end: '2025-02-01 01:00:00 +0800'}]},
}});
const run = (script, args) => spawnSync(process.execPath, [path.resolve('scripts', script), ...args], {encoding: 'utf8'});

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'health-month-test-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return root;
}

test('annual split filters nested points and merges idempotently', () => {
  const raw = payload([point('2025-01-31'), point('2025-02-01')]);
  const jan = monthlyPayload(raw, '2025-01');
  const feb = monthlyPayload(raw, '2025-02');
  assert.equal(jan.data.healthMetrics.metrics[0].data.length, 1);
  assert.equal(feb.data.healthMetrics.metrics[0].data[0].date.slice(0, 10), '2025-02-01');
  assert.equal(jan.data.workouts.workouts.length, 1);
  assert.equal(feb.data.workouts.workouts.length, 0);
  assert.deepEqual(mergeMonthData(jan.data, jan.data), jan.data);
  assert.equal(monthlyPayload(payload([]), '2024-02').dateRange.end, '2024-02-29 23:59:59 +0800');
});

test('daily canonical data rebuilds the matching monthly cache', (t) => {
  const root = fixture(t);
  for (const day of ['01', '02']) {
    const dailyDir = path.join(root, '2025/01');
    fs.mkdirSync(dailyDir, {recursive: true});
    fs.writeFileSync(path.join(dailyDir, `${day}.json`), JSON.stringify({
      version: 5, date: `2025-01-${day}`, exportedAt: `2025-01-${day}T12:00:00.000Z`, revision: '123456789abc', files: {},
      activity: {steps: day === '01' ? 42 : 84, movementPeriods: [[1, 2, 42, 0.03]]},
    }));
  }
  const rebuilt = buildMonthlyHealthFromDailyFiles(root, '2025-01');
  assert.equal(rebuilt.version, 5);
  assert.deepEqual(rebuilt.days.map((day) => day.activity.steps), [42, 84]);
  assert.equal(rebuilt.days[0].activity.movementPeriods, undefined);
  assert.equal(rebuilt.exportedAt, '2025-01-02T12:00:00.000Z');
});

test('migration uses supplied root, preserves annual input and is repeatable', (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'health_data_2025.json'), JSON.stringify(payload([point('2025-01-31'), point('2025-02-01')])));
  for (let i = 0; i < 2; i++) {
    const result = run('split_health_annual_to_monthly.mjs', ['--target', root]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, '2025/01.json'))).data.healthMetrics.metrics[0].data.length, 1);
  }
  assert.ok(fs.existsSync(path.join(root, 'health_data_2025.json')));
});

test('repair moves unique cross-month points, preserves other sections, and is idempotent', (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, '2025'));
  fs.writeFileSync(path.join(root, '2025/01.json'), JSON.stringify(payload([point('2025-01-31'), point('2025-02-01', 2)])));
  fs.writeFileSync(path.join(root, '2025/02.json'), JSON.stringify(payload([point('2025-02-01', 3)])));
  const args = ['--target', root, '--repair-monthly'];
  const dry = run('split_health_annual_to_monthly.mjs', [...args, '--dry-run']);
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, '2025/01.json'))).data.healthMetrics.metrics[0].data.length, 2);
  const result = run('split_health_annual_to_monthly.mjs', args);
  assert.equal(result.status, 0, result.stderr);
  const feb = JSON.parse(fs.readFileSync(path.join(root, '2025/02.json')));
  assert.equal(feb.data.healthMetrics.metrics[0].data.length, 2);
  assert.deepEqual(feb.data.workouts, payload([]).data.workouts);
  assert.match(run('split_health_annual_to_monthly.mjs', args).stdout, /Updated 0 monthly files/);
});

test('repair fails before writing when a destination month is absent', (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, '2025'));
  const file = path.join(root, '2025/01.json');
  const original = JSON.stringify(payload([point('2025-02-01')]));
  fs.writeFileSync(file, original);
  assert.notEqual(run('split_health_annual_to_monthly.mjs', ['--target', root, '--repair-monthly']).status, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test('exporter writes native v5 indexes and lossless compressed shards', (t) => {
  const root = fixture(t);
  const server = path.join(root, 'mock.mjs');
  fs.writeFileSync(server, `import readline from 'node:readline';
for await (const line of readline.createInterface({input: process.stdin})) {
 const message = JSON.parse(line);
 if (!message.id) continue;
 let result = {};
 if (message.method === 'tools/call') {
  const {name, arguments: args} = message.params;
  const metrics = name === 'get_health_metrics' ? [{name:'step_count',units:'count',data:[{date:'2025-01-01 00:00:00 +0800',qty:42}]}] : [];
  if (name === 'get_health_metrics') metrics.push({name:'sleep_analysis',units:'hr',data:[{date:'2025-01-01 13:30:00 +0800',start:'2025-01-01 13:30:00 +0800',end:'2025-01-01 14:51:00 +0800',value:'睡眠时长',qty:1.35}]});
  if (name === 'get_health_metrics') metrics.push({name:'heart_rate_variability',units:'ms',data:[{start:'2025-01-01 02:00:00 +0800',end:'2025-01-01 02:01:00 +0800',qty:42.5,source:'Watch',heartbeatSeries:[{date:1}]}]});
  const workouts = name === 'get_workouts' ? [{name:'Walk',start:'2025-01-01 01:00:00 +0800',duration:600,stepCount:[{qty:2,date:'a'},{qty:3,date:'b'}],heartRateData:[{qty:80}]}] : [];
  const ecg = name === 'get_ecg' ? [{start:'2025-01-01 01:00:00 +0800',averageHeartRate:80,voltageMeasurements:[1,2,3]}] : [];
  result = {data: {metrics,workouts,ecg}};
 }
 process.stdout.write(JSON.stringify({jsonrpc:'2.0', id:message.id, result})+'\\n');
}`);
  fs.mkdirSync(path.join(root, '2025/01'), {recursive: true});
  const dailyFile = path.join(root, '2025/01/01.json');
  fs.writeFileSync(dailyFile, JSON.stringify({version: 3, source: {collections: {}}, derived: {summary: {old: true}, timeline: [{type: 'old'}]}}));
  const result = run('export_health_year_from_mcp.mjs', ['--date', '2025-01-01', '--target', root, '--mcp-server', server]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(path.join(root, '2025/01.json')));
  const month = JSON.parse(fs.readFileSync(path.join(root, '2025/01.json')));
  assert.equal(month.version, 5);
  assert.equal(month.days.length, 1);
  assert.equal(month.days[0].heart.hrv.measurements, undefined);
  const daily = JSON.parse(fs.readFileSync(dailyFile));
  assert.equal(daily.version, 5);
  assert.match(daily.revision, /^[a-f0-9]{12}$/);
  assert.equal(daily.activity.steps, 42);
  assert.deepEqual(daily.sleep.stages, [[810, 891, 'asleep']]);
  assert.deepEqual(daily.heart.hrv.measurements, [[120, 42.5, 'watch']]);
  assert.equal(daily.activity.workouts[0].steps, 5);
  assert.equal(daily.heart.ecg[0].voltageMeasurements, undefined);
  assert.ok(Object.keys(daily.files).some((name) => name.endsWith('/heart_rate_variability.json.gz')));
  const hrvDescriptor = Object.entries(daily.files).find(([name]) => name.endsWith('/heart_rate_variability.json.gz'))[1];
  const hrvShard = JSON.parse(gunzipSync(fs.readFileSync(path.join(root, '2025/01', hrvDescriptor.path))));
  assert.deepEqual(hrvShard.metric.rows[0].find((value) => Array.isArray(value)), [{date: 1}]);
  const ecgDescriptor = Object.entries(daily.files).find(([name]) => name.startsWith('ecg/'))[1];
  const ecgShard = JSON.parse(gunzipSync(fs.readFileSync(path.join(root, '2025/01', ecgDescriptor.path))));
  assert.deepEqual(ecgShard.ecg.voltageMeasurements, [1, 2, 3]);
  const workoutDescriptor = Object.entries(daily.files).find(([name]) => name.endsWith('/samples.json.gz'))[1];
  const workoutShard = JSON.parse(gunzipSync(fs.readFileSync(path.join(root, '2025/01', workoutDescriptor.path))));
  assert.deepEqual(workoutShard.samples.heartRateData, [{qty: 80}]);
  assert.equal(daily.source, undefined);
  assert.equal(daily.derived, undefined);

  const revision = daily.revision;
  const repeated = run('export_health_year_from_mcp.mjs', ['--date', '2025-01-01', '--target', root, '--mcp-server', server]);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(JSON.parse(fs.readFileSync(dailyFile)).revision, revision);
  assert.match(repeated.stderr, /Verified 2025-01-01 v5 health index/);
});

test('incomplete daily refresh preserves the existing valid file and continues', (t) => {
  const root = fixture(t);
  const server = path.join(root, 'mock-error.mjs');
  fs.writeFileSync(server, `import readline from 'node:readline';
for await (const line of readline.createInterface({input: process.stdin})) {
 const message = JSON.parse(line);
 if (!message.id) continue;
 const result = message.method === 'tools/call' ? {isError:true,content:[{type:'text',text:'Unavailable'}]} : {};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0', id:message.id, result})+'\\n');
}`);
  fs.mkdirSync(path.join(root, '2025/01'), {recursive: true});
  const file = path.join(root, '2025/01/01.json');
  const original = JSON.stringify({
    version: 5, date: '2025-01-01', exportedAt: '2025-01-02T00:00:00.000Z', revision: '123456789abc', files: {}, activity: {steps: 1},
  });
  fs.writeFileSync(file, original);
  fs.writeFileSync(path.join(root, '2025/01.json'), JSON.stringify(payload([])));
  const result = run('export_health_year_from_mcp.mjs', ['--date', '2025-01-01', '--target', root, '--mcp-server', server]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /existing daily file preserved/);
  assert.match(result.stderr, /Preserved 1 existing daily health file/);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test('incomplete first daily refresh fails without writing an empty timeline', (t) => {
  const root = fixture(t);
  const server = path.join(root, 'mock-error.mjs');
  fs.writeFileSync(server, `import readline from 'node:readline';
for await (const line of readline.createInterface({input: process.stdin})) {
 const message = JSON.parse(line);
 if (!message.id) continue;
 const result = message.method === 'tools/call' ? {isError:true,content:[{type:'text',text:'Unavailable'}]} : {};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0', id:message.id, result})+'\\n');
}`);
  const file = path.join(root, '2025/01/01.json');
  const result = run('export_health_year_from_mcp.mjs', ['--date', '2025-01-01', '--target', root, '--mcp-server', server]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no daily file written/);
  assert.match(result.stderr, /no empty daily data was written/);
  assert.ok(!fs.existsSync(file));
});

test('HRV backfill patches only existing daily files and omits heartbeat samples', (t) => {
  const root = fixture(t);
  const server = path.join(root, 'mock-hrv.mjs');
  fs.writeFileSync(server, `import readline from 'node:readline';
for await (const line of readline.createInterface({input: process.stdin})) {
 const message = JSON.parse(line);
 if (!message.id) continue;
 let result = {};
 if (message.method === 'tools/call') result = {data:{metrics:[{name:'heart_rate_variability',units:'ms',data:[{start:'2025-01-01 02:00:00 +0800',end:'2025-01-01 02:01:00 +0800',qty:42.5,source:'Watch',heartbeatSeries:[{date:1}]}]}]}};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0', id:message.id, result})+'\\n');
}`);
  const file = path.join(root, '2025/01/01.json');
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify({version: 3, date: '2025-01-01', source: {collections: {}}, derived: {timeline: [{type: 'sleep'}]}}));
  const result = run('export_health_year_from_mcp.mjs', ['--date', '2025-01-01', '--backfill-hrv', '--target', root, '--mcp-server', server]);
  assert.equal(result.status, 0, result.stderr);
  const daily = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(daily.derived.timeline, [{type: 'sleep'}]);
  assert.deepEqual(daily.derived.hrv, {
    units: 'ms',
    samples: [{start: '2025-01-01 02:00:00 +0800', end: '2025-01-01 02:01:00 +0800', value: 42.5, source: 'Watch'}],
  });
});

test('HRV backfill records a successful source query with no samples', (t) => {
  const root = fixture(t);
  const server = path.join(root, 'mock-empty-hrv.mjs');
  fs.writeFileSync(server, `import readline from 'node:readline';
for await (const line of readline.createInterface({input: process.stdin})) {
 const message = JSON.parse(line);
 if (!message.id) continue;
 const result = message.method === 'tools/call' ? {data:{metrics:[]}} : {};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0', id:message.id, result})+'\\n');
}`);
  const file = path.join(root, '2025/01/01.json');
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify({version: 3, date: '2025-01-01', source: {collections: {}}, derived: {timeline: []}}));
  const result = run('export_health_year_from_mcp.mjs', ['--date', '2025-01-01', '--backfill-hrv', '--target', root, '--mcp-server', server]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1 had no HRV samples/);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).derived.hrv, {units: 'ms', samples: []});
});

test('mutable refresh replaces mood and medication timeline data and adds weight detail', (t) => {
  const root = fixture(t);
  const server = path.join(root, 'mock-mutable.mjs');
  fs.writeFileSync(server, `import readline from 'node:readline';
for await (const line of readline.createInterface({input: process.stdin})) {
 const message = JSON.parse(line);
 if (!message.id) continue;
 let result = {};
 if (message.method === 'tools/call') {
  const name = message.params.name;
  if (name === 'get_health_metrics') result = {data:{metrics:[{name:'weight_body_mass',units:'kg',data:[{date:'2025-01-01 08:00:00 +0800',qty:70.2,source:'Scale'}]}]}};
  if (name === 'get_medications') result = {data:{medications:[{displayText:'Vitamin',start:'2025-01-01 09:00:00 +0800',status:'Taken',dosage:1,units:'count'}]}};
  if (name === 'get_state_of_mind') result = {data:{stateOfMind:[{kind:'momentaryEmotion',start:'2025-01-01 10:00:00 +0800',end:'2025-01-01 10:01:00 +0800',valence:0.5,valenceClassification:'pleasant'}]}};
 }
 process.stdout.write(JSON.stringify({jsonrpc:'2.0', id:message.id, result})+'\\n');
}`);
  const file = path.join(root, '2025/01/01.json');
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify({
    version: 3,
    date: '2025-01-01',
    source: {collections: {}},
    derived: {summary: {medications: {count: 9}, stateOfMind: {count: 9}}, timeline: [{type: 'sleep'}, {type: 'medication', name: 'Old'}, {type: 'state_of_mind', kind: 'Old'}]},
  }));
  const result = run('export_health_year_from_mcp.mjs', ['--date', '2025-01-01', '--refresh-mutable', '--target', root, '--mcp-server', server]);
  assert.equal(result.status, 0, result.stderr);
  const daily = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(daily.derived.weight, {units: 'kg', samples: [{start: '2025-01-01 08:00:00 +0800', value: 70.2, source: 'Scale'}]});
  assert.equal(daily.derived.summary.medications.count, 1);
  assert.equal(daily.derived.summary.stateOfMind.count, 1);
  assert.equal(daily.derived.timeline.filter((item) => item.type === 'medication').length, 1);
  assert.equal(daily.derived.timeline.filter((item) => item.type === 'state_of_mind').length, 1);
  assert.equal(daily.derived.timeline.filter((item) => item.type === 'sleep').length, 1);
});

test('v5 month projection preserves chart semantics', () => {
  const data = transform({version: 5, exportedAt: '2025-01-02T00:00:00.000Z', days: [{
    version: 5, date: '2025-01-01', activity: {steps: 4200, activeEnergyKJ: 418.4, exerciseMinutes: 30},
    respiratory: {bloodOxygenFraction: 0.97}, bodyMeasurements: {bodyFatFraction: 0.2, weight: {dailyKg: 70}},
    heart: {hrv: {dailyMs: 42}}, sleep: {totalMinutes: 480, deepMinutes: 60, remMinutes: 90, coreMinutes: 330},
  }]});
  assert.deepEqual(data.steps, [['2025-01-01', 4200]]);
  assert.deepEqual(data.energy_active, [['2025-01-01', 100]]);
  assert.deepEqual(data.spo2, [['2025-01-01', 97]]);
  assert.deepEqual(data.fat, [['2025-01-01', 20]]);
  assert.deepEqual(data.sleep[0], ['2025-01-01', 8, 1, 1.5, 5.5, 0]);
});


test('compaction preserves chart output and summaries without mutating input', () => {
  const raw = payload([point('2025-01-31')]);
  Object.assign(raw.data.workouts.workouts[0], {
    name: 'Outdoor Walk', duration: 600, activeEnergyBurned: {qty: 500},
    distance: {qty: 2}, avgHeartRate: {qty: 85}, heartRate: {min: {qty: 70}, max: {qty: 100}},
    stepCount: [{qty: 101.5, date: 'a'}, {qty: 99.5, date: 'b'}],
    heartRateData: [{qty: 70}, {qty: 100}], heartRateRecovery: [{qty: 75}],
    activeEnergy: [{qty: 500}], walkingAndRunningDistance: [{qty: 2}],
    basalEnergy: [{qty: 10}], cyclingDistance: [], swimStroke: [], swimDistance: [],
  });
  raw.data.ecg = {ecg: [{start: '2025-01-31', classification: 'test', voltageMeasurements: [1, 2], samplingFrequency: 512}]};
  const before = structuredClone(raw);
  const compact = compactMonthlyDetails(raw);
  assert.deepEqual(raw, before);
  assert.deepEqual(transform(compact), transform(raw));
  assert.deepEqual(compactMonthlyDetails(compact), compact);
  assert.deepEqual(compact.data.workouts.workouts[0].stepCount, [{qty: 201}]);
  assert.equal(compact.data.ecg.ecg[0].samplingFrequency, 512);
  assert.equal(compact.data.ecg.ecg[0].voltageMeasurements, undefined);
  assert.equal(compact.data.workouts.workouts[0].heartRateData, undefined);
  assert.deepEqual(mergeMonthData(compact.data, raw.data), compact.data);
});
