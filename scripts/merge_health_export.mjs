import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultSourceRoot = '/Users/feei/Library/Mobile Documents/iCloud~com~ifunography~HealthExport/Documents';
const defaultTargetRoot = path.join(repoRoot, 'static', 'health');
const timeZone = 'Asia/Shanghai';

const collectionMappings = [
  {
    folder: '健康',
    sourceKey: 'metrics',
    targetPath: ['healthMetrics', 'metrics'],
    kind: 'metrics',
  },
  {
    folder: '健康',
    sourceKey: 'workouts',
    targetPath: ['workouts', 'workouts'],
    kind: 'records',
  },
  {
    folder: '健康',
    sourceKey: 'heartRateNotifications',
    targetPath: ['heartNotifications', 'heartRateNotifications'],
    kind: 'records',
  },
  {
    folder: '心情',
    sourceKey: 'stateOfMind',
    targetPath: ['stateOfMind', 'stateOfMind'],
    kind: 'records',
  },
  {
    folder: '药物',
    sourceKey: 'medications',
    targetPath: ['medications', 'medications'],
    kind: 'records',
  },
];

const args = parseArgs(process.argv.slice(2));
const targetDate = args.date ?? getToday();
assertDate(targetDate);

const sourceRoot = path.resolve(expandHome(args.source ?? defaultSourceRoot));
const targetRoot = path.resolve(expandHome(args.target ?? defaultTargetRoot));
const targetYear = targetDate.slice(0, 4);
const targetFile = path.join(targetRoot, `health_data_${targetYear}.json`);

if (!fs.existsSync(targetFile)) {
  throw new Error(`Target year file does not exist: ${targetFile}`);
}

const annualData = readJson(targetFile);
annualData.data ??= {};

const summary = {
  files: 0,
  metrics: 0,
  records: 0,
  missingFiles: [],
};

for (const folder of [...new Set(collectionMappings.map((item) => item.folder))]) {
  const sourceFile = path.join(sourceRoot, folder, `HealthAutoExport-${targetDate}.json`);

  if (!fs.existsSync(sourceFile)) {
    summary.missingFiles.push(path.relative(sourceRoot, sourceFile));
    continue;
  }

  const sourceData = readJson(sourceFile).data ?? {};
  summary.files += 1;

  for (const mapping of collectionMappings.filter((item) => item.folder === folder)) {
    const sourceCollection = sourceData[mapping.sourceKey];

    if (!Array.isArray(sourceCollection) || sourceCollection.length === 0) {
      continue;
    }

    if (mapping.kind === 'metrics') {
      summary.metrics += mergeMetrics(annualData, mapping.targetPath, sourceCollection, targetDate);
      continue;
    }

    summary.records += mergeRecords(annualData, mapping.targetPath, sourceCollection, targetDate);
  }
}

annualData.exportedAt = `${targetDate}T23:59:59+08:00`;
annualData.dateRange ??= {};
annualData.dateRange.start ??= `${targetYear}-01-01 00:00:00 +0800`;
annualData.dateRange.end = `${targetDate} 23:59:59 +0800`;

fs.writeFileSync(targetFile, `${JSON.stringify(annualData, null, 2)}\n`);

console.log(`Merged ${targetDate} into ${path.relative(repoRoot, targetFile)}`);
console.log(`Source files: ${summary.files}`);
console.log(`Metric records: ${summary.metrics}`);
console.log(`Records: ${summary.records}`);

if (summary.missingFiles.length > 0) {
  console.log(`Missing source files: ${summary.missingFiles.join(', ')}`);
}

function mergeMetrics(annualData, targetPath, sourceMetrics, targetDate) {
  const targetMetrics = ensureArray(annualData.data, targetPath);
  const byName = new Map(targetMetrics.map((metric) => [metric.name, metric]));
  let mergedCount = 0;

  for (const sourceMetric of sourceMetrics) {
    if (!sourceMetric?.name || !Array.isArray(sourceMetric.data)) {
      continue;
    }

    let targetMetric = byName.get(sourceMetric.name);

    if (!targetMetric) {
      targetMetric = {
        name: sourceMetric.name,
        units: sourceMetric.units,
        data: [],
      };
      targetMetrics.push(targetMetric);
      byName.set(sourceMetric.name, targetMetric);
    }

    if (sourceMetric.units !== undefined) {
      targetMetric.units = sourceMetric.units;
    }

    targetMetric.data = (targetMetric.data ?? []).filter((record) => !recordMatchesDate(record, targetDate));
    const sourceRecords = sourceMetric.data.filter((record) => recordMatchesDate(record, targetDate));
    targetMetric.data.push(...dedupeRecords(sourceRecords));
    mergedCount += sourceRecords.length;
  }

  return mergedCount;
}

function mergeRecords(annualData, targetPath, sourceRecords, targetDate) {
  const targetRecords = ensureArray(annualData.data, targetPath);
  const filteredTargetRecords = targetRecords.filter((record) => !recordMatchesDate(record, targetDate));
  const filteredSourceRecords = sourceRecords.filter((record) => recordMatchesDate(record, targetDate));
  const mergedRecords = [...filteredTargetRecords, ...dedupeRecords(filteredSourceRecords)];

  targetRecords.splice(0, targetRecords.length, ...mergedRecords);
  return filteredSourceRecords.length;
}

function ensureArray(root, pathParts) {
  let current = root;

  for (const part of pathParts.slice(0, -1)) {
    current[part] ??= {};
    current = current[part];
  }

  const finalKey = pathParts[pathParts.length - 1];
  current[finalKey] ??= [];

  if (!Array.isArray(current[finalKey])) {
    throw new Error(`Target path is not an array: data.${pathParts.join('.')}`);
  }

  return current[finalKey];
}

function recordMatchesDate(record, targetDate) {
  return ['date', 'start', 'end', 'scheduledDate'].some((key) => localDateKey(record?.[key]) === targetDate);
}

function localDateKey(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const localDateMatch = value.match(/^(\d{4}-\d{2}-\d{2})\s/);

  if (localDateMatch) {
    return localDateMatch[1];
  }

  const isoDateMatch = value.match(/^\d{4}-\d{2}-\d{2}T/);

  if (!isoDateMatch) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return formatLocalDate(date);
}

function dedupeRecords(records) {
  const seen = new Set();
  const deduped = [];

  for (const record of records) {
    const key = stableStringify(record);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(record);
  }

  return deduped;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--date' || arg === '--source' || arg === '--target') {
      const value = argv[index + 1];

      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${arg}`);
      }

      parsed[arg.slice(2)] = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function assertDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid date: ${value}`);
  }
}

function getToday() {
  return formatLocalDate(new Date());
}

function formatLocalDate(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function expandHome(value) {
  if (value === '~') {
    return process.env.HOME;
  }

  if (value.startsWith('~/')) {
    return path.join(process.env.HOME, value.slice(2));
  }

  return value;
}
