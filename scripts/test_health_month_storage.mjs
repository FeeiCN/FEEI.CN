import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {transform} from './health_chart_transform.generated.mjs';
import {monthlyPayload, mergeMonthData, compactMonthlyDetails} from './health_month_storage.mjs';

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

test('year exporter writes months and refreshes existing daily files without live services', (t) => {
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
  const workouts = name === 'get_workouts' ? [{name:'Walk',start:'2025-01-01 01:00:00 +0800',duration:600,stepCount:[{qty:2,date:'a'},{qty:3,date:'b'}],heartRateData:[{qty:80}]}] : [];
  const ecg = name === 'get_ecg' ? [{start:'2025-01-01 01:00:00 +0800',averageHeartRate:80,voltageMeasurements:[1,2,3]}] : [];
  result = {data: {metrics,workouts,ecg}};
 }
 process.stdout.write(JSON.stringify({jsonrpc:'2.0', id:message.id, result})+'\\n');
}`);
  fs.mkdirSync(path.join(root, '2025/01'), {recursive: true});
  const dailyFile = path.join(root, '2025/01/01.json');
  fs.writeFileSync(dailyFile, JSON.stringify({version: 2, summary: {old: true}, timeline: [{type: 'old'}]}));
  const result = run('export_health_year_from_mcp.mjs', ['--year', '2025', '--end-date', '2025-02-01', '--target', root, '--mcp-server', server]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(path.join(root, '2025/01.json')));
  assert.ok(fs.existsSync(path.join(root, '2025/02.json')));
  assert.ok(!fs.existsSync(path.join(root, 'health_data_2025.json')));
  const month = JSON.parse(fs.readFileSync(path.join(root, '2025/01.json')));
  assert.deepEqual(month.data.workouts.workouts[0].stepCount, [{qty:5}]);
  assert.equal(month.data.workouts.workouts[0].heartRateData, undefined);
  assert.equal(month.data.ecg.ecg[0].voltageMeasurements, undefined);
  assert.equal(month.data.ecg.ecg[0].averageHeartRate, 80);
  assert.ok(!fs.existsSync(path.join(root, '.archives')));
  const daily = JSON.parse(fs.readFileSync(dailyFile));
  assert.equal(daily.summary.old, undefined);
  const nap = daily.timeline.find((item) => item.type === 'sleep');
  assert.equal(nap.stage, 'asleep');
  assert.equal(nap.durationMinutes, 81);
  assert.equal(nap.end, '2025-01-01 14:51:00 +0800');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, '2025/02.json'))).data.healthMetrics.metrics, []);
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
  const original = JSON.stringify({version: 2, summary: {rawRecords: {healthMetrics: 1}}, timeline: []});
  fs.writeFileSync(file, original);
  fs.writeFileSync(path.join(root, '2025/01.json'), JSON.stringify(payload([])));
  const result = run('export_health_year_from_mcp.mjs', ['--date', '2025-01-01', '--target', root, '--mcp-server', server]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /existing daily file preserved/);
  assert.match(result.stderr, /Preserved 1 existing daily health file/);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test('incomplete monthly collection preserves the existing section', (t) => {
  const root = fixture(t);
  const server = path.join(root, 'mock-month-error.mjs');
  fs.writeFileSync(server, `import readline from 'node:readline';
for await (const line of readline.createInterface({input: process.stdin})) {
 const message = JSON.parse(line);
 if (!message.id) continue;
 let result = {};
 if (message.method === 'tools/call') {
  if (message.params.name === 'get_workouts') result = {isError:true,content:[{type:'text',text:'Unavailable'}]};
  else result = {content:[{type:'text',text:JSON.stringify({data:{metrics:[]}})}]};
 }
 process.stdout.write(JSON.stringify({jsonrpc:'2.0', id:message.id, result})+'\\n');
}`);
  fs.mkdirSync(path.join(root, '2025'), {recursive: true});
  const file = path.join(root, '2025/01.json');
  fs.writeFileSync(file, JSON.stringify({
    exportedAt: '2025-01-01',
    dateRange: {start: '2025-01-01 00:00:00 +0800', end: '2025-01-31 23:59:59 +0800'},
    data: {workouts: {workouts: [{start: '2025-01-01 01:00:00 +0800', name: 'Walk'}]}},
  }));
  const result = run('export_health_year_from_mcp.mjs', ['--month', '2025-01', '--end-date', '2025-01-01', '--skip-daily', '--target', root, '--mcp-server', server]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Preserved existing monthly workouts data/);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).data.workouts.workouts[0].name, 'Walk');
  assert.ok(!fs.existsSync(path.join(root, '2025/01/01.json')));
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
