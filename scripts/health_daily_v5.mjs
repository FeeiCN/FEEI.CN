import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {gzipSync, gunzipSync} from 'node:zlib';
import {
  buildHealthDailyV4,
  columnarMetric,
  metricDomain,
  prune,
  writeJsonAtomic,
} from './health_daily_v4.mjs';

const indexKeys = new Set(['version', 'date', 'exportedAt', 'revision', 'files']);

export function buildHealthDailyV5({date, exportedAt, aggregateMetrics, rawMetrics, timeline, collections, sourceCatalog}) {
  const expanded = buildHealthDailyV4({
    date,
    exportedAt,
    aggregateMetrics,
    rawMetrics,
    timeline,
    collections,
    sourceCatalog,
  });
  const index = projectDailyIndex(expanded);
  const shards = [];

  addShard(shards, 'aggregate.json.gz', {
    version: 5,
    date,
    metrics: (aggregateMetrics ?? []).map((metric) => columnarMetric(metric, date, sourceCatalog)),
  }, aggregateMetrics?.reduce((sum, metric) => sum + (metric.data?.length ?? 0), 0));

  for (const metric of rawMetrics ?? []) {
    if (!metric?.name || !metric.data?.length) continue;
    const domain = metricDomain(metric.name);
    addShard(
      shards,
      `metrics/${safeSegment(domain)}/${safeSegment(metric.name)}.json.gz`,
      {version: 5, date, metric: columnarMetric(metric, date, sourceCatalog)},
      metric.data.length,
    );
  }

  const eventCollections = Object.fromEntries(Object.entries(collections ?? {})
    .filter(([key, value]) => !['healthMetrics', 'workouts', 'ecg'].includes(key) && hasCollectionData(value)));
  if (Object.keys(eventCollections).length) {
    addShard(shards, 'events.json.gz', {version: 5, date, collections: eventCollections}, countCollectionRecords(eventCollections));
  }

  const workoutRefs = [];
  for (const [position, workout] of (collections?.workouts?.workouts ?? []).entries()) {
    const id = safeSegment(workout.id ?? `workout-${position + 1}-${shortHash(workout)}`);
    const {meta, samples, route} = splitWorkout(workout);
    const files = {};
    if (Object.keys(meta).length) files.meta = addShard(shards, `workouts/${id}/meta.json.gz`, {version: 5, date, workout: meta}, 1);
    if (Object.keys(samples).length) files.samples = addShard(shards, `workouts/${id}/samples.json.gz`, {version: 5, date, workoutId: workout.id ?? id, samples}, countCollectionRecords(samples));
    if (route.length) files.route = addShard(shards, `workouts/${id}/route.json.gz`, {version: 5, date, workoutId: workout.id ?? id, route}, route.length);
    workoutRefs.push(prune({id: workout.id ?? id, files}));
  }

  const ecgRefs = [];
  for (const [position, record] of (collections?.ecg?.ecg ?? []).entries()) {
    const id = safeSegment(record.id ?? record.uuid ?? `ecg-${position + 1}-${shortHash(record)}`);
    const file = addShard(shards, `ecg/${id}.json.gz`, {version: 5, date, ecg: record}, 1);
    ecgRefs.push({id: record.id ?? record.uuid ?? id, file});
  }

  if (workoutRefs.length) index.workoutDetails = workoutRefs;
  if (ecgRefs.length) index.ecgDetails = ecgRefs;
  return {index, shards};
}

export function writeHealthDailyV5(root, built) {
  const date = built.index.date;
  const indexFile = path.join(root, date.slice(0, 4), date.slice(5, 7), `${date.slice(8, 10)}.json`);
  if (!built.shards.length) {
    return {changed: false, skipped: true, reason: 'empty_day', indexFile, files: 0};
  }
  const shardContents = built.shards.map((shard) => {
    const json = Buffer.from(`${JSON.stringify(shard.payload)}\n`);
    const compressed = gzipSync(json, {level: 9, mtime: 0});
    return {...shard, json, compressed, sha256: hashBuffer(json)};
  });
  const contentIdentity = {
    index: Object.fromEntries(Object.entries(built.index).filter(([key]) => key !== 'exportedAt')),
    shards: shardContents.map(({relativePath, sha256}) => [relativePath, sha256]),
  };
  const revision = hashBuffer(Buffer.from(canonical(contentIdentity))).slice(0, 12);
  const dayDirectory = path.join(root, date.slice(0, 4), date.slice(5, 7), date.slice(8, 10));
  const revisionDirectory = path.join(dayDirectory, revision);
  const existing = readJson(indexFile);
  if (existing?.version === 5 && existing.revision === revision && validateHealthDailyV5(existing, date, root).length === 0) {
    return {changed: false, indexFile, revision, files: shardContents.length};
  }

  const temporary = `${revisionDirectory}.tmp-${process.pid}`;
  fs.rmSync(temporary, {recursive: true, force: true});
  for (const shard of shardContents) {
    const file = path.join(temporary, shard.relativePath);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, shard.compressed);
  }
  fs.mkdirSync(dayDirectory, {recursive: true});
  fs.rmSync(revisionDirectory, {recursive: true, force: true});
  fs.renameSync(temporary, revisionDirectory);

  const descriptors = Object.fromEntries(shardContents.map((shard) => [shard.relativePath, prune({
    path: `${date.slice(8, 10)}/${revision}/${shard.relativePath}`,
    compression: 'gzip',
    contentType: 'application/json',
    records: shard.records,
    bytes: shard.compressed.length,
    uncompressedBytes: shard.json.length,
    sha256: shard.sha256,
  })]));
  const index = prune({...built.index, version: 5, revision, files: descriptors});
  writeJsonAtomic(indexFile, index);
  cleanupRevisions(dayDirectory, revision);
  return {changed: true, indexFile, revision, files: shardContents.length};
}

export function validateHealthDailyV5(index, expectedDate, root) {
  const errors = [];
  if (index?.version !== 5) errors.push('version must be 5');
  if (index?.date !== expectedDate) errors.push(`date must be ${expectedDate}`);
  if (!/^[a-f0-9]{12}$/.test(index?.revision ?? '')) errors.push('revision must be a 12-character content hash');
  if (!index?.exportedAt || !Number.isFinite(Date.parse(index.exportedAt))) errors.push('exportedAt must be an ISO timestamp');
  if (!index?.files || typeof index.files !== 'object') errors.push('files manifest is required');
  if (index?.sleep?.totalMinutes > 0 && !Array.isArray(index.sleep.stages)) errors.push('sleep summary exists without sleep stages');
  if (index?.heart?.hrv?.dailyMs > 0 && !Array.isArray(index.heart.hrv.measurements)) errors.push('HRV summary exists without HRV measurements');
  if (root && index?.files) {
    const monthDirectory = path.join(root, expectedDate.slice(0, 4), expectedDate.slice(5, 7));
    for (const [name, descriptor] of Object.entries(index.files)) {
      const file = path.join(monthDirectory, descriptor.path ?? '');
      if (!descriptor.path || !fs.existsSync(file)) {
        errors.push(`missing shard: ${name}`);
        continue;
      }
      try {
        const json = gunzipSync(fs.readFileSync(file));
        if (hashBuffer(json) !== descriptor.sha256) errors.push(`checksum mismatch: ${name}`);
        JSON.parse(json.toString('utf8'));
      } catch (error) {
        errors.push(`invalid shard ${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return errors;
}

export function projectDailyIndex(expanded) {
  const index = structuredClone(expanded);
  index.version = 5;
  for (const domain of Object.values(index)) {
    if (!domain || typeof domain !== 'object' || Array.isArray(domain)) continue;
    delete domain.records;
    delete domain.summaries;
  }
  if (index.activity?.workouts) {
    index.activity.workouts = index.activity.workouts.map(compactWorkout);
  }
  if (index.heart?.ecg) {
    index.heart.ecg = index.heart.ecg.map((record) => prune(Object.fromEntries(
      Object.entries(record).filter(([key, value]) => key !== 'voltageMeasurements' && !Array.isArray(value)),
    )));
  }
  return prune(index);
}

function compactWorkout(item) {
  return prune({
    id: item.id,
    type: item.type ?? item.name,
    startMinute: item.startMinute,
    endMinute: item.endMinute,
    durationMinutes: item.durationMinutes,
    distanceKm: item.distanceKm,
    activeEnergyKJ: item.activeEnergyKJ,
    averageHeartRateBpm: item.averageHeartRateBpm,
    maximumHeartRateBpm: item.maximumHeartRateBpm,
    steps: item.steps,
  });
}

function splitWorkout(workout) {
  const meta = {};
  const samples = {};
  let route = [];
  for (const [key, value] of Object.entries(workout)) {
    if (key === 'route' && Array.isArray(value)) {
      route = value;
    } else if (Array.isArray(value)) {
      samples[key] = value;
    } else {
      meta[key] = value;
    }
  }
  return {meta, samples, route};
}

function addShard(shards, relativePath, payload, records) {
  if (relativePath === 'aggregate.json.gz' && payload.metrics.length === 0) return undefined;
  shards.push({relativePath, payload: prune(payload), records});
  return relativePath;
}

function hasCollectionData(value) {
  return value && typeof value === 'object' && Object.values(value).some((records) => Array.isArray(records) ? records.length > 0 : records != null);
}

function countCollectionRecords(value) {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== 'object') return 0;
  return Object.values(value).reduce((sum, item) => sum + countCollectionRecords(item), 0);
}

function cleanupRevisions(dayDirectory, currentRevision) {
  for (const entry of fs.readdirSync(dayDirectory, {withFileTypes: true})) {
    if (entry.isDirectory() && entry.name !== currentRevision && !entry.name.includes('.tmp-')) {
      fs.rmSync(path.join(dayDirectory, entry.name), {recursive: true, force: true});
    }
  }
}

function safeSegment(value) {
  const normalized = String(value).normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || `item-${shortHash(value)}`;
}

function shortHash(value) {
  return hashBuffer(Buffer.from(canonical(value))).slice(0, 10);
}

function hashBuffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function isHealthDailyV5Empty(index) {
  return Object.keys(index ?? {}).every((key) => indexKeys.has(key)) && Object.keys(index?.files ?? {}).length === 0;
}
