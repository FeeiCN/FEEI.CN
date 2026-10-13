import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonical, recordMonth, monthlyPayload, mergeMetrics, mergeMonthData, writeMonthlyHealth, compactMonthlyDetails} from './health_month_storage.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (['--dry-run', '--cleanup', '--repair-monthly'].includes(arg)) args[arg.slice(2)] = true;
  else if (['--target', '--year'].includes(arg) && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) args[arg.slice(2)] = process.argv[++i];
  else throw new Error(`Unknown or incomplete argument: ${arg}`);
}
if (args.year && !/^\d{4}$/.test(args.year)) throw new Error('Invalid year');
if (args.cleanup && args['repair-monthly']) throw new Error('--cleanup applies only to annual migration');
const root = path.resolve(args.target ?? path.join(repoRoot, 'static/data/health'));
const plans = new Map();
const annualFiles = [];

if (args['repair-monthly']) {
  const originals = new Map();
  for (const year of fs.readdirSync(root).filter((name) => /^\d{4}$/.test(name) && (!args.year || name === args.year))) {
    for (const name of fs.readdirSync(path.join(root, year)).filter((name) => /^(0[1-9]|1[0-2])\.json$/.test(name))) {
      const month = `${year}-${name.slice(0, 2)}`;
      const raw = JSON.parse(fs.readFileSync(path.join(root, year, name), 'utf8'));
      originals.set(month, raw);
      const repaired = structuredClone(raw);
      repaired.data.healthMetrics.metrics = raw.data.healthMetrics.metrics.map((metric) => ({
        ...metric, data: metric.data.filter((point) => recordMonth(point) === month),
      })).filter((metric) => metric.data.length);
      plans.set(month, repaired);
    }
  }
  for (const raw of originals.values()) {
    for (const metric of raw.data.healthMetrics.metrics) {
      const groups = new Map();
      for (const point of metric.data) {
        const month = recordMonth(point);
        if (!groups.has(month)) groups.set(month, []);
        groups.get(month).push(point);
      }
      for (const [month, points] of groups) {
        if (!plans.has(month)) throw new Error(`Missing destination month ${month}; no files written`);
        const target = plans.get(month).data.healthMetrics;
        target.metrics = mergeMetrics(target.metrics, [{...metric, data: points}]);
      }
    }
  }
  const signatures = (values) => new Set([...values].flatMap((raw) => raw.data.healthMetrics.metrics.flatMap(({data, ...metadata}) => data.map((point) => canonical({metadata, point})))));
  const before = signatures(originals.values());
  const after = signatures(plans.values());
  if (before.size !== after.size || [...before].some((key) => !after.has(key))) throw new Error('Record preservation check failed');
  console.log(`Verified preservation of ${before.size} unique metric records`);
} else {
  for (const name of fs.readdirSync(root).filter((name) => /^health_data_\d{4}\.json$/.test(name) && (!args.year || name === `health_data_${args.year}.json`))) {
    const file = path.join(root, name);
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const months = new Set();
    for (const [section, collection] of Object.entries(raw.data)) {
      for (const [key, records] of Object.entries(collection)) {
        if (!Array.isArray(records)) continue;
        for (const record of records) {
          if (section === 'healthMetrics' && key === 'metrics') record.data.forEach((point) => months.add(recordMonth(point)));
          else months.add(recordMonth(record));
        }
      }
    }
    for (const month of months) {
      const payload = monthlyPayload(raw, month);
      const destination = path.join(root, month.replace('-', '/') + '.json');
      const previous = plans.get(month) ?? (fs.existsSync(destination) ? JSON.parse(fs.readFileSync(destination, 'utf8')) : null);
      if (previous) payload.data = mergeMonthData(monthlyPayload(previous, month).data, payload.data);
      plans.set(month, payload);
    }
    annualFiles.push(file);
  }
}
let changed = 0;
for (const [month, payload] of plans) {
  const file = path.join(root, month.replace('-', '/') + '.json');
  if (args['dry-run']) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== `${JSON.stringify(compactMonthlyDetails(payload))}\n`) changed++;
  } else if (writeMonthlyHealth(file, payload)) changed++;
}
if (args.cleanup && !args['dry-run']) annualFiles.forEach((file) => fs.unlinkSync(file));
console.log(`${args['dry-run'] ? 'Would update' : 'Updated'} ${changed} monthly files`);
