import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildHealthChartHistory} from './build_health_chart_history.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultTargetRoot = path.join(repoRoot, 'static', 'data', 'health');
const defaultMcpServerPath = path.join(repoRoot, 'scripts', 'health_auto_export_mcp_server.mjs');
const timeZone = 'Asia/Shanghai';
const timeZoneOffset = '+0800';
const activeEnergyBucketMinutes = 5;
const activeEnergySegmentThresholdKJ = 5;
const activeEnergyMergeGapMinutes = 10;
const movementBucketMinutes = 5;
const movementSegmentThresholdSteps = 30;
const movementSegmentThresholdDistanceKm = 0.02;
const movementMergeGapMinutes = 5;
const flightsBucketMinutes = 5;
const flightsSegmentThreshold = 0.5;
const flightsMergeGapMinutes = 5;
const standBucketMinutes = 5;
const standSegmentThresholdMinutes = 1;
const standMergeGapMinutes = 0;
const physicalEffortBucketMinutes = 5;
const physicalEffortSegmentThresholdAvg = 5;
const physicalEffortSegmentThresholdMax = 8;
const physicalEffortMergeGapMinutes = 10;
const daylightBucketMinutes = 5;
const daylightSegmentThresholdMinutes = 1;
const daylightMergeGapMinutes = 5;
const exerciseTimeBucketMinutes = 5;
const dailyHealthMetricCatalog = [
  'active_energy',
  'apple_exercise_time',
  'apple_sleeping_wrist_temperature',
  'apple_stand_hour',
  'apple_stand_time',
  'blood_oxygen_saturation',
  'body_fat_percentage',
  'body_mass_index',
  'cardio_recovery',
  'environmental_audio_exposure',
  'flights_climbed',
  'handwashing',
  'heart_rate',
  'heart_rate_variability',
  'lean_body_mass',
  'physical_effort',
  'respiratory_rate',
  'resting_heart_rate',
  'sleep_analysis',
  'stair_speed_down',
  'stair_speed_up',
  'step_count',
  'time_in_daylight',
  'vo2_max',
  'walking_heart_rate_average',
  'walking_running_distance',
  'weight_body_mass',
];
const dailyHealthMetricBlacklist = new Set([
  'basal_energy_burned',
]);
const dailyHealthMetrics = dailyHealthMetricCatalog
  .filter((metric) => !dailyHealthMetricBlacklist.has(metric))
  .join(',');

const collectionMappings = [
  {
    tool: 'get_health_metrics',
    args: {
      metrics: '',
      interval: 'days',
      aggregate: true,
    },
    rawArgs: {
      metrics: dailyHealthMetrics,
      aggregate: false,
    },
    targetSection: 'healthMetrics',
    targetKey: 'metrics',
    sourceKeys: ['metrics'],
  },
  {
    tool: 'get_workouts',
    args: {
      includeMetadata: true,
      includeRoutes: false,
      metadataAggregation: 'minutes',
    },
    rawArgs: {
      includeMetadata: true,
      includeRoutes: false,
      metadataAggregation: 'minutes',
    },
    targetSection: 'workouts',
    targetKey: 'workouts',
    sourceKeys: ['workouts'],
  },
  {
    tool: 'get_medications',
    args: {},
    optional: true,
    targetSection: 'medications',
    targetKey: 'medications',
    sourceKeys: ['medications'],
  },
  {
    tool: 'get_heart_notifications',
    args: {},
    targetSection: 'heartNotifications',
    targetKey: 'heartRateNotifications',
    sourceKeys: ['heartRateNotifications', 'heartNotifications'],
  },
  {
    tool: 'get_state_of_mind',
    args: {},
    targetSection: 'stateOfMind',
    targetKey: 'stateOfMind',
    sourceKeys: ['stateOfMind', 'state_of_mind'],
  },
  {
    tool: 'get_cycle_tracking',
    args: {},
    targetSection: 'cycleTracking',
    targetKey: 'cycleTracking',
    sourceKeys: ['cycleTracking', 'cycle_tracking'],
  },
  {
    tool: 'get_ecg',
    args: {},
    targetSection: 'ecg',
    targetKey: 'ecg',
    sourceKeys: ['ecg'],
  },
  {
    tool: 'get_symptoms',
    args: {},
    targetSection: 'symptoms',
    targetKey: 'symptoms',
    sourceKeys: ['symptoms'],
  },
];

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  if (args.date && (args.month || args.endDate)) {
    throw new Error('--date cannot be combined with --month or --end-date');
  }

  const targetYear = args.date ? args.date.slice(0, 4) : (args.year ?? getCurrentYear());
  const targetMonth = args.month;
  assertYear(targetYear);

  const targetRoot = path.resolve(expandHome(args.target ?? defaultTargetRoot));

  let startDate, endDate, targetFile;

  if (args.date) {
    assertDate(args.date);
    if (args.year && args.year !== targetYear) {
      throw new Error(`--year ${args.year} does not match --date ${args.date}`);
    }
    startDate = args.date;
    endDate = args.date;
  } else if (targetMonth) {
    assertMonth(targetMonth);
    const [y, m] = targetMonth.split('-');
    startDate = `${y}-${m}-01`;
    endDate = args.endDate ?? defaultEndDateMonth(y, m);
    targetFile = path.join(targetRoot, y, `${m}.json`);
  } else if (args.year) {
    // Explicit --year: export full year
    startDate = `${targetYear}-01-01`;
    endDate = args.endDate ?? defaultEndDate(targetYear);
    targetFile = path.join(targetRoot, `health_data_${targetYear}.json`);
  } else {
    // Default: export current month
    const currentMonthStr = getCurrentMonth();
    const [y, m] = currentMonthStr.split('-');
    startDate = `${y}-${m}-01`;
    endDate = args.endDate ?? defaultEndDateMonth(y, m);
    targetFile = path.join(targetRoot, y, `${m}.json`);
  }

  if (!endDate.startsWith(targetYear)) {
    throw new Error(`End date must be in ${targetYear}: ${endDate}`);
  }

  const mcpServerPath = path.resolve(expandHome(args.mcpServer ?? process.env.HEALTH_AUTO_EXPORT_MCP_SERVER ?? defaultMcpServerPath));
  const timeoutMs = Number(args.timeout ?? process.env.HEALTH_AUTO_EXPORT_MCP_TIMEOUT ?? 86400000);

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Invalid timeout: ${args.timeout}`);
  }

  if (!fs.existsSync(mcpServerPath)) {
    throw new Error(`MCP server does not exist: ${mcpServerPath}`);
  }

  fs.mkdirSync(targetRoot, {recursive: true});
  if (args.date || targetMonth || !args.year) {
    fs.mkdirSync(path.join(targetRoot, targetYear), {recursive: true});
  }

  const start = `${startDate} 00:00:00 ${timeZoneOffset}`;
  const end = `${endDate} 23:59:59 ${timeZoneOffset}`;
  const client = new McpClient('node', [mcpServerPath], {timeoutMs});

  try {
    await client.start();
    await client.initialize();

    const exportedAt = new Date().toISOString();

    if (targetFile) {
      const data = {};
      const summary = {};

      for (const mapping of collectionMappings) {
        process.stderr.write(`Exporting ${mapping.targetSection}...\n`);
        const {records} = await collectMappingRecords(client, mapping, {
          start,
          end,
          args: mapping.args,
          allowErrors: mapping.optional === true,
        });

        if (mapping.targetSection === 'healthMetrics') {
          data[mapping.targetSection] = {
            [mapping.targetKey]: Array.isArray(records) ? records : [],
          };
          summary[mapping.targetSection] = sumMetricRecords(data[mapping.targetSection][mapping.targetKey]);
          continue;
        }

        if (Array.isArray(records) && records.length > 0) {
          data[mapping.targetSection] = {
            [mapping.targetKey]: records,
          };
        } else {
          data[mapping.targetSection] = {};
        }

        summary[mapping.targetSection] = Array.isArray(records) ? records.length : 0;
      }

      const annualData = {
        exportedAt,
        dateRange: {
          start,
          end,
        },
        data,
      };

      fs.writeFileSync(targetFile, `${JSON.stringify(annualData, null, 2)}\n`);

      console.log(`Exported ${targetYear} health data to ${path.relative(repoRoot, targetFile)}`);
      for (const [section, count] of Object.entries(summary)) {
        console.log(`${section}: ${count}`);
      }
    }

    const dailyResult = await exportDailyCompactFiles(client, {
      startDate,
      endDate,
      targetRoot,
      exportedAt,
      skipExisting: !args.date && !args.overwriteDaily,
    });

    console.log(`Exported ${dailyResult.written.length} daily compact health files`);
    if (dailyResult.skipped.length > 0) {
      console.log(`Skipped ${dailyResult.skipped.length} existing daily compact health files`);
    }
  } finally {
    await client.close();
  }

  await buildHealthChartHistory({healthRoot: targetRoot});
}

class McpClient {
  constructor(command, commandArgs, options = {}) {
    this.command = command;
    this.commandArgs = commandArgs;
    this.timeoutMs = options.timeoutMs ?? 86400000;
    this.nextId = 1;
    this.pending = new Map();
    this.stdoutBuffer = '';
    this.process = null;
  }

  async start() {
    this.process = spawn(this.command, this.commandArgs, {
      cwd: repoRoot,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout.setEncoding('utf8');
    this.process.stderr.setEncoding('utf8');

    this.process.stdout.on('data', (chunk) => {
      this.stdoutBuffer += chunk;
      this.readStdoutLines();
    });

    this.process.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
    });

    this.process.on('error', (error) => {
      for (const pending of this.pending.values()) {
        pending.reject(error);
      }
      this.pending.clear();
    });

    this.process.on('exit', (code, signal) => {
      const detail = signal ? `signal ${signal}` : `code ${code}`;
      for (const pending of this.pending.values()) {
        pending.reject(new Error(`MCP server exited before responding: ${detail}`));
      }
      this.pending.clear();
    });
  }

  async initialize() {
    await this.request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: {
        name: 'FEEI.CN health export script',
        version: '1.0.0',
      },
    });

    this.notify('notifications/initialized', {});
  }

  async callTool(name, toolArgs) {
    const result = await this.request('tools/call', {
      name,
      arguments: toolArgs,
    });

    if (result.isError) {
      throw new Error(extractText(result) || `MCP tool failed: ${name}`);
    }

    return unwrapToolResult(result);
  }

  request(method, params) {
    const id = this.nextId;
    this.nextId += 1;

    const message = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      this.process.stdin.write(`${JSON.stringify(message)}\n`);
    });
  }

  notify(method, params) {
    this.process.stdin.write(`${JSON.stringify({jsonrpc: '2.0', method, params})}\n`);
  }

  readStdoutLines() {
    while (true) {
      const index = this.stdoutBuffer.indexOf('\n');

      if (index === -1) {
        return;
      }

      const line = this.stdoutBuffer.slice(0, index).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(index + 1);

      if (!line) {
        continue;
      }

      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        process.stderr.write(`Ignoring non-JSON MCP output: ${line}\n`);
        continue;
      }

      if (message.id === undefined || !this.pending.has(message.id)) {
        continue;
      }

      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);

      if (message.error) {
        pending.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
      } else {
        pending.resolve(message.result);
      }
    }
  }

  async close() {
    if (!this.process) {
      return;
    }

    if (!this.process.killed) {
      this.process.kill('SIGTERM');
    }
  }
}

function unwrapToolResult(result) {
  const text = extractText(result);

  if (!text) {
    return result;
  }

  const parsed = parseJsonText(text);

  if (!parsed) {
    throw new Error(text);
  }

  return parsed;
}

function extractData(value) {
  if (value?.error) {
    throw new Error(value.error.message ?? JSON.stringify(value.error));
  }

  if (Array.isArray(value?.content)) {
    return extractData(unwrapToolResult(value));
  }

  if (typeof value?.result?.content?.[0]?.text === 'string') {
    return extractData(parseJsonText(value.result.content[0].text));
  }

  if (value?.result?.data && typeof value.result.data === 'object') {
    return value.result.data;
  }

  if (value?.data && typeof value.data === 'object') {
    return value.data;
  }

  if (value?.result && typeof value.result === 'object') {
    return value.result;
  }

  if (value && typeof value === 'object') {
    return value;
  }

  return {};
}

function extractText(result) {
  return result?.content?.find((item) => item.type === 'text')?.text;
}

function parseJsonText(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function findCollection(sourceData, sourceKeys) {
  for (const key of sourceKeys) {
    if (Array.isArray(sourceData?.[key])) {
      return sourceData[key];
    }
  }

  return [];
}

async function collectMappingRecords(client, mapping, options) {
  const toolArgs = {
    start: options.start,
    end: options.end,
    ...(options.args ?? {}),
  };

  try {
    const payload = await client.callTool(mapping.tool, toolArgs);
    const sourceData = extractData(payload);
    return {
      records: findCollection(sourceData, mapping.sourceKeys),
    };
  } catch (error) {
    if (!options.allowErrors) {
      throw error;
    }

    return {
      records: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function exportDailyCompactFiles(client, options) {
  const written = [];
  const skipped = [];
  const today = formatLocalDate(new Date());

  for (const day of enumerateDates(options.startDate, options.endDate)) {
    const [year, month, date] = day.split('-');
    const dailyDir = path.join(options.targetRoot, year, month);
    const dailyFile = path.join(dailyDir, `${date}.json`);

    if (
      options.skipExisting
      && day !== today
      && fs.existsSync(dailyFile)
      && !isEmptyDailyHealthFile(dailyFile)
    ) {
      skipped.push(dailyFile);
      continue;
    }

    const dailyStart = `${day} 00:00:00 ${timeZoneOffset}`;
    const dailyEnd = `${day} 23:59:59 ${timeZoneOffset}`;
    const data = {};
    const summary = {};
    const errors = {};

    for (const mapping of collectionMappings) {
      process.stderr.write(`Exporting compact ${day} ${mapping.targetSection}...\n`);
      const {records, error} = await collectMappingRecords(client, mapping, {
        start: dailyStart,
        end: dailyEnd,
        args: mapping.rawArgs ?? mapping.args,
        allowErrors: true,
      });

      if (mapping.targetSection === 'healthMetrics') {
        data[mapping.targetSection] = {
          [mapping.targetKey]: Array.isArray(records) ? records : [],
        };
        summary[mapping.targetSection] = sumMetricRecords(data[mapping.targetSection][mapping.targetKey]);
      } else if (Array.isArray(records) && records.length > 0) {
        data[mapping.targetSection] = {
          [mapping.targetKey]: records,
        };
        summary[mapping.targetSection] = records.length;
      } else {
        data[mapping.targetSection] = {};
        summary[mapping.targetSection] = 0;
      }

      if (error) {
        errors[mapping.targetSection] = error;
      }
    }

    const compactData = buildDailyCompactData(data);
    const dailyData = {
      exportedAt: options.exportedAt,
      date: day,
      dateRange: {
        start: dailyStart,
        end: dailyEnd,
      },
      summary: {
        rawRecords: summary,
        ...compactData.summary,
      },
      timeline: compactData.timeline,
      series: compactData.series,
      data: compactData.data,
    };

    if (Object.keys(errors).length > 0) {
      dailyData.errors = errors;
    }

    fs.mkdirSync(dailyDir, {recursive: true});
    fs.writeFileSync(dailyFile, `${JSON.stringify(dailyData, null, 2)}\n`);
    written.push(dailyFile);
  }

  return {written, skipped};
}

function isEmptyDailyHealthFile(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const rawRecords = data.summary?.rawRecords ?? {};
    const rawTotal = Object.values(rawRecords)
      .reduce((sum, value) => sum + (Number(value) || 0), 0);
    const timelineCount = Array.isArray(data.timeline) ? data.timeline.length : 0;
    return rawTotal === 0 && timelineCount === 0;
  } catch {
    return true;
  }
}

function buildDailyCompactData(data) {
  const healthMetrics = data.healthMetrics?.metrics ?? [];
  const metrics = [];
  const summary = {};
  const timeline = [];
  const series = {};
  const movementMetrics = {};

  for (const metric of healthMetrics) {
    if (metric.name === 'basal_energy_burned') {
      summary.basalEnergy = summarizeEnergy(metric);
      continue;
    }

    if (metric.name === 'active_energy') {
      const activeEnergy = buildActiveEnergy(metric);
      summary.activeEnergy = activeEnergy.summary;
      series.activeEnergy5m = activeEnergy.series;
      timeline.push(...activeEnergy.segments);
      continue;
    }

    if (metric.name === 'step_count' || metric.name === 'walking_running_distance') {
      movementMetrics[metric.name] = metric;
      continue;
    }

    if (metric.name === 'flights_climbed') {
      const flights = buildFlightsClimbed(metric);
      summary.flightsClimbed = flights.summary;
      series.flightsClimbed5m = flights.series;
      timeline.push(...flights.segments);
      continue;
    }

    if (metric.name === 'apple_stand_time') {
      const standTime = buildStandTime(metric);
      summary.standTime = standTime.summary;
      series.standTime5m = standTime.series;
      timeline.push(...standTime.segments);
      continue;
    }

    if (metric.name === 'heart_rate') {
      const heartRate = buildHeartRate(metric);
      summary.heartRate = heartRate.summary;
      series.heartRate5m = heartRate.series;
      timeline.push(...heartRate.segments);
      continue;
    }

    if (metric.name === 'physical_effort') {
      const physicalEffort = buildPhysicalEffort(metric);
      summary.physicalEffort = physicalEffort.summary;
      series.physicalEffort5m = physicalEffort.series;
      timeline.push(...physicalEffort.segments);
      continue;
    }

    if (metric.name === 'handwashing') {
      const handwashing = buildHandwashing(metric);
      summary.handwashing = handwashing.summary;
      timeline.push(...handwashing.timeline);
      continue;
    }

    if (metric.name === 'apple_exercise_time') {
      const exerciseTime = buildExerciseTime(metric);
      summary.exerciseTime = exerciseTime.summary;
      series.exerciseTime5m = exerciseTime.series;
      continue;
    }

    if (metric.name === 'time_in_daylight') {
      const daylight = buildDaylight(metric);
      summary.daylight = daylight.summary;
      series.daylight5m = daylight.series;
      timeline.push(...daylight.segments);
      continue;
    }

    if (metric.name === 'walking_heart_rate_average') {
      summary.walkingHeartRateAverage = summarizeQuantityMetric(metric, 1);
      continue;
    }

    if (metric.name === 'vo2_max') {
      summary.vo2Max = summarizeQuantityMetric(metric, 2);
      continue;
    }

    if (metric.name === 'cardio_recovery') {
      summary.cardioRecovery = summarizeQuantityMetric(metric, 1);
      continue;
    }

    if (metric.name === 'sleep_analysis') {
      timeline.push(...buildSleepTimeline(metric));
    }

    metrics.push(metric);
  }

  if (movementMetrics.step_count || movementMetrics.walking_running_distance) {
    const movement = buildMovement(movementMetrics);
    summary.movement = movement.summary;
    series.movement5m = movement.series;
    timeline.push(...movement.segments);
  }

  const workouts = data.workouts?.workouts ?? [];
  const compactWorkouts = buildCompactWorkouts(workouts);
  summary.workouts = compactWorkouts.summary;
  timeline.push(...compactWorkouts.timeline);

  const collectionEvents = buildCollectionEvents(data);
  Object.assign(summary, collectionEvents.summary);
  timeline.push(...collectionEvents.timeline);
  timeline.sort(compareTimelineItems);

  return {
    summary,
    timeline,
    series,
    data: {
      ...data,
      workouts: {
        workouts: compactWorkouts.workouts,
      },
      healthMetrics: {
        metrics,
      },
    },
  };
}

function buildCollectionEvents(data) {
  const summary = {};
  const timeline = [];
  const collectionBuilders = [
    ['stateOfMind', 'stateOfMind', buildStateOfMindCollection],
    ['medications', 'medications', buildGenericCollection('medication')],
    ['heartNotifications', 'heartRateNotifications', buildGenericCollection('heart_notification')],
    ['cycleTracking', 'cycleTracking', buildGenericCollection('cycle_tracking')],
    ['ecg', 'ecg', buildGenericCollection('ecg')],
    ['symptoms', 'symptoms', buildGenericCollection('symptom')],
  ];

  for (const [section, key, builder] of collectionBuilders) {
    const records = data[section]?.[key];
    if (!Array.isArray(records)) {
      summary[section] = {count: 0};
      continue;
    }

    const built = builder(records);
    summary[section] = built.summary;
    timeline.push(...built.timeline);
  }

  return {summary, timeline};
}

function buildStateOfMindCollection(records) {
  const timeline = records.map((record) => dropUndefined({
    type: 'state_of_mind',
    kind: record.kind,
    start: normalizeTimelineDateTime(record.start),
    end: normalizeTimelineDateTime(record.end),
    valenceClassification: record.valenceClassification,
    valence: record.valence === undefined ? undefined : round(Number(record.valence), 3),
    labels: record.labels,
    associations: record.associations,
  }));

  return {
    summary: {
      count: records.length,
      byKind: countBy(records, (record) => record.kind),
      byValenceClassification: countBy(records, (record) => record.valenceClassification),
    },
    timeline,
  };
}

function buildGenericCollection(type) {
  return (records) => ({
    summary: {
      count: records.length,
    },
    timeline: records
      .filter((record) => record.start ?? record.date ?? record.end)
      .map((record) => dropUndefined({
        type,
        start: normalizeTimelineDateTime(record.start ?? record.date),
        end: normalizeTimelineDateTime(record.end),
        value: record.value,
        name: record.name,
        source: record.source,
      })),
  });
}

function countBy(records, selector) {
  const counts = {};

  for (const record of records) {
    const key = selector(record);
    if (!key) {
      continue;
    }

    counts[key] = (counts[key] ?? 0) + 1;
  }

  return counts;
}

function summarizeEnergy(metric) {
  const data = Array.isArray(metric?.data) ? metric.data : [];
  const totalKJ = data.reduce((sum, record) => sum + Number(record.qty ?? 0), 0);

  return {
    units: metric.units,
    totalKJ: round(totalKJ, 3),
    totalKcal: round(kjToKcal(totalKJ), 3),
    omittedRawRecords: data.length,
  };
}

function buildActiveEnergy(metric) {
  const data = Array.isArray(metric?.data) ? metric.data : [];
  const buckets = new Map();
  let totalKJ = 0;

  for (const record of data) {
    const minute = minuteOfDay(record.date);
    if (minute === null) {
      continue;
    }

    const bucketStart = Math.floor(minute / activeEnergyBucketMinutes) * activeEnergyBucketMinutes;
    const qty = Number(record.qty ?? 0);
    totalKJ += qty;
    buckets.set(bucketStart, (buckets.get(bucketStart) ?? 0) + qty);
  }

  const bucketRows = Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([minute, value]) => [formatMinuteOfDay(minute), round(value, 3)]);

  return {
    summary: {
      units: metric.units,
      totalKJ: round(totalKJ, 3),
      totalKcal: round(kjToKcal(totalKJ), 3),
      omittedRawRecords: data.length,
      bucketMinutes: activeEnergyBucketMinutes,
      segmentThresholdKJ: activeEnergySegmentThresholdKJ,
      segmentMergeGapMinutes: activeEnergyMergeGapMinutes,
    },
    series: {
      units: metric.units,
      bucketMinutes: activeEnergyBucketMinutes,
      values: bucketRows,
    },
    segments: buildActiveEnergySegments(buckets),
  };
}

function buildActiveEnergySegments(buckets) {
  const activeBuckets = Array.from(buckets.entries())
    .filter(([, value]) => value >= activeEnergySegmentThresholdKJ)
    .sort((a, b) => a[0] - b[0]);
  const segments = [];
  let current = null;

  for (const [minute, value] of activeBuckets) {
    if (!current || minute - current.endMinute > activeEnergyMergeGapMinutes) {
      if (current) {
        segments.push(formatActiveEnergySegment(current));
      }
      current = {
        startMinute: minute,
        endMinute: minute + activeEnergyBucketMinutes,
        energyKJ: 0,
        bucketCount: 0,
      };
    } else {
      current.endMinute = minute + activeEnergyBucketMinutes;
    }

    current.energyKJ += value;
    current.bucketCount += 1;
  }

  if (current) {
    segments.push(formatActiveEnergySegment(current));
  }

  return segments;
}

function formatActiveEnergySegment(segment) {
  return {
    type: 'active_energy',
    level: 'high',
    start: formatMinuteOfDay(segment.startMinute),
    end: formatMinuteOfDay(segment.endMinute),
    durationMinutes: segment.endMinute - segment.startMinute,
    energyKJ: round(segment.energyKJ, 3),
    energyKcal: round(kjToKcal(segment.energyKJ), 3),
    bucketCount: segment.bucketCount,
  };
}

function buildMovement(metrics) {
  const stepMetric = metrics.step_count;
  const distanceMetric = metrics.walking_running_distance;
  const buckets = new Map();
  const stepRecords = Array.isArray(stepMetric?.data) ? stepMetric.data : [];
  const distanceRecords = Array.isArray(distanceMetric?.data) ? distanceMetric.data : [];

  addMetricToBuckets(buckets, stepRecords, movementBucketMinutes, 'steps');
  addMetricToBuckets(buckets, distanceRecords, movementBucketMinutes, 'distanceKm');

  const sortedBuckets = Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]);
  const values = sortedBuckets.map(([minute, bucket]) => [
    formatMinuteOfDay(minute),
    round(bucket.steps ?? 0, 1),
    round(bucket.distanceKm ?? 0, 4),
  ]);
  const totalSteps = sumRecords(stepRecords);
  const totalDistanceKm = sumRecords(distanceRecords);

  return {
    summary: {
      steps: round(totalSteps, 1),
      distanceKm: round(totalDistanceKm, 4),
      omittedRawRecords: stepRecords.length + distanceRecords.length,
      bucketMinutes: movementBucketMinutes,
      segmentThresholdSteps: movementSegmentThresholdSteps,
      segmentThresholdDistanceKm: movementSegmentThresholdDistanceKm,
      segmentMergeGapMinutes: movementMergeGapMinutes,
    },
    series: {
      units: ['count', 'km'],
      bucketMinutes: movementBucketMinutes,
      values,
    },
    segments: buildMovementSegments(sortedBuckets),
  };
}

function buildMovementSegments(sortedBuckets) {
  const activeBuckets = sortedBuckets.filter(([, bucket]) => (
    (bucket.steps ?? 0) >= movementSegmentThresholdSteps ||
    (bucket.distanceKm ?? 0) >= movementSegmentThresholdDistanceKm
  ));
  const segments = [];
  let current = null;

  for (const [minute, bucket] of activeBuckets) {
    if (!current || minute - current.endMinute > movementMergeGapMinutes) {
      if (current) {
        segments.push(formatMovementSegment(current));
      }
      current = {
        startMinute: minute,
        endMinute: minute + movementBucketMinutes,
        steps: 0,
        distanceKm: 0,
        bucketCount: 0,
      };
    } else {
      current.endMinute = minute + movementBucketMinutes;
    }

    current.steps += bucket.steps ?? 0;
    current.distanceKm += bucket.distanceKm ?? 0;
    current.bucketCount += 1;
  }

  if (current) {
    segments.push(formatMovementSegment(current));
  }

  return segments;
}

function formatMovementSegment(segment) {
  return {
    type: 'movement',
    start: formatMinuteOfDay(segment.startMinute),
    end: formatMinuteOfDay(segment.endMinute),
    durationMinutes: segment.endMinute - segment.startMinute,
    steps: round(segment.steps, 1),
    distanceKm: round(segment.distanceKm, 4),
    bucketCount: segment.bucketCount,
  };
}

function buildFlightsClimbed(metric) {
  const data = Array.isArray(metric?.data) ? metric.data : [];
  const buckets = new Map();
  addMetricToBuckets(buckets, data, flightsBucketMinutes, 'flights');
  const sortedBuckets = Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]);
  const values = sortedBuckets.map(([minute, bucket]) => [
    formatMinuteOfDay(minute),
    round(bucket.flights ?? 0, 3),
  ]);
  const totalFlights = sumRecords(data);

  return {
    summary: {
      units: metric.units,
      total: round(totalFlights, 3),
      omittedRawRecords: data.length,
      bucketMinutes: flightsBucketMinutes,
      segmentThreshold: flightsSegmentThreshold,
      segmentMergeGapMinutes: flightsMergeGapMinutes,
    },
    series: {
      units: metric.units,
      bucketMinutes: flightsBucketMinutes,
      values,
    },
    segments: buildSingleValueSegments(sortedBuckets, {
      type: 'stairs',
      valueKey: 'flights',
      outputKey: 'flights',
      bucketMinutes: flightsBucketMinutes,
      threshold: flightsSegmentThreshold,
      mergeGapMinutes: flightsMergeGapMinutes,
      decimals: 3,
    }),
  };
}

function buildStandTime(metric) {
  const data = Array.isArray(metric?.data) ? metric.data : [];
  const buckets = new Map();
  addMetricToBuckets(buckets, data, standBucketMinutes, 'minutes');
  const sortedBuckets = Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]);
  const values = sortedBuckets.map(([minute, bucket]) => [
    formatMinuteOfDay(minute),
    round(bucket.minutes ?? 0, 1),
  ]);
  const totalMinutes = sumRecords(data);

  return {
    summary: {
      units: metric.units,
      totalMinutes: round(totalMinutes, 1),
      omittedRawRecords: data.length,
      bucketMinutes: standBucketMinutes,
      segmentThresholdMinutes: standSegmentThresholdMinutes,
      segmentMergeGapMinutes: standMergeGapMinutes,
    },
    series: {
      units: metric.units,
      bucketMinutes: standBucketMinutes,
      values,
    },
    segments: buildSingleValueSegments(sortedBuckets, {
      type: 'stand',
      valueKey: 'minutes',
      outputKey: 'durationMinutes',
      bucketMinutes: standBucketMinutes,
      threshold: standSegmentThresholdMinutes,
      mergeGapMinutes: standMergeGapMinutes,
      decimals: 1,
    }),
  };
}

function buildHeartRate(metric) {
  const data = Array.isArray(metric?.data) ? metric.data : [];
  const buckets = new Map();
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let count = 0;

  for (const record of data) {
    const minute = minuteOfDay(record.date);
    const value = Number(record.Avg ?? record.qty);
    if (minute === null || !Number.isFinite(value)) {
      continue;
    }

    const bucketStart = Math.floor(minute / 5) * 5;
    const bucket = buckets.get(bucketStart) ?? {
      sum: 0,
      count: 0,
      min: Infinity,
      max: -Infinity,
    };
    const recordMin = Number(record.Min ?? value);
    const recordMax = Number(record.Max ?? value);
    bucket.sum += value;
    bucket.count += 1;
    bucket.min = Math.min(bucket.min, recordMin);
    bucket.max = Math.max(bucket.max, recordMax);
    buckets.set(bucketStart, bucket);

    min = Math.min(min, recordMin);
    max = Math.max(max, recordMax);
    sum += value;
    count += 1;
  }

  const values = Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([minute, bucket]) => [
      formatMinuteOfDay(minute),
      round(bucket.sum / bucket.count, 1),
      round(bucket.min, 1),
      round(bucket.max, 1),
    ]);

  return {
    summary: {
      units: metric.units,
      avg: count > 0 ? round(sum / count, 1) : null,
      min: count > 0 ? round(min, 1) : null,
      max: count > 0 ? round(max, 1) : null,
      omittedRawRecords: data.length,
      bucketMinutes: 5,
    },
    series: {
      units: metric.units,
      bucketMinutes: 5,
      values,
    },
    segments: buildHeartRateSegments(values),
  };
}

function buildHeartRateSegments(values) {
  const highBuckets = values
    .map(([time, avg, min, max]) => ({
      minute: parseClockMinute(time),
      avg,
      min,
      max,
    }))
    .filter((bucket) => bucket.minute !== null && (bucket.avg >= 120 || bucket.max >= 150));
  const segments = [];
  let current = null;

  for (const bucket of highBuckets) {
    if (!current || bucket.minute - current.endMinute > 10) {
      if (current) {
        segments.push(formatHeartRateSegment(current));
      }
      current = {
        startMinute: bucket.minute,
        endMinute: bucket.minute + 5,
        sum: 0,
        count: 0,
        min: Infinity,
        max: -Infinity,
      };
    } else {
      current.endMinute = bucket.minute + 5;
    }

    current.sum += bucket.avg;
    current.count += 1;
    current.min = Math.min(current.min, bucket.min);
    current.max = Math.max(current.max, bucket.max);
  }

  if (current) {
    segments.push(formatHeartRateSegment(current));
  }

  return segments.filter((segment) => segment.durationMinutes >= 10);
}

function formatHeartRateSegment(segment) {
  return {
    type: 'heart_rate_zone',
    level: 'high',
    start: formatMinuteOfDay(segment.startMinute),
    end: formatMinuteOfDay(segment.endMinute),
    durationMinutes: segment.endMinute - segment.startMinute,
    avg: round(segment.sum / segment.count, 1),
    min: round(segment.min, 1),
    max: round(segment.max, 1),
  };
}

function buildPhysicalEffort(metric) {
  const data = Array.isArray(metric?.data) ? metric.data : [];
  const buckets = new Map();
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let count = 0;

  for (const record of data) {
    const minute = minuteOfDay(record.start ?? record.date);
    const value = Number(record.qty);
    if (minute === null || !Number.isFinite(value)) {
      continue;
    }

    const bucketStart = Math.floor(minute / physicalEffortBucketMinutes) * physicalEffortBucketMinutes;
    const bucket = buckets.get(bucketStart) ?? {
      sum: 0,
      count: 0,
      min: Infinity,
      max: -Infinity,
    };
    bucket.sum += value;
    bucket.count += 1;
    bucket.min = Math.min(bucket.min, value);
    bucket.max = Math.max(bucket.max, value);
    buckets.set(bucketStart, bucket);

    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
    count += 1;
  }

  const values = Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([minute, bucket]) => [
      formatMinuteOfDay(minute),
      round(bucket.sum / bucket.count, 2),
      round(bucket.min, 2),
      round(bucket.max, 2),
    ]);

  return {
    summary: {
      units: metric.units,
      avg: count > 0 ? round(sum / count, 2) : null,
      min: count > 0 ? round(min, 2) : null,
      max: count > 0 ? round(max, 2) : null,
      omittedRawRecords: data.length,
      bucketMinutes: physicalEffortBucketMinutes,
      segmentThresholdAvg: physicalEffortSegmentThresholdAvg,
      segmentThresholdMax: physicalEffortSegmentThresholdMax,
      segmentMergeGapMinutes: physicalEffortMergeGapMinutes,
    },
    series: {
      units: metric.units,
      bucketMinutes: physicalEffortBucketMinutes,
      values,
    },
    segments: buildPhysicalEffortSegments(values),
  };
}

function buildPhysicalEffortSegments(values) {
  const highBuckets = values
    .map(([time, avg, min, max]) => ({
      minute: parseClockMinute(time),
      avg,
      min,
      max,
    }))
    .filter((bucket) => bucket.minute !== null && (
      bucket.avg >= physicalEffortSegmentThresholdAvg ||
      bucket.max >= physicalEffortSegmentThresholdMax
    ));
  const segments = [];
  let current = null;

  for (const bucket of highBuckets) {
    if (!current || bucket.minute - current.endMinute > physicalEffortMergeGapMinutes) {
      if (current) {
        segments.push(formatPhysicalEffortSegment(current));
      }
      current = {
        startMinute: bucket.minute,
        endMinute: bucket.minute + physicalEffortBucketMinutes,
        sum: 0,
        count: 0,
        min: Infinity,
        max: -Infinity,
      };
    } else {
      current.endMinute = bucket.minute + physicalEffortBucketMinutes;
    }

    current.sum += bucket.avg;
    current.count += 1;
    current.min = Math.min(current.min, bucket.min);
    current.max = Math.max(current.max, bucket.max);
  }

  if (current) {
    segments.push(formatPhysicalEffortSegment(current));
  }

  return segments;
}

function formatPhysicalEffortSegment(segment) {
  return {
    type: 'effort_zone',
    level: 'high',
    start: formatMinuteOfDay(segment.startMinute),
    end: formatMinuteOfDay(segment.endMinute),
    durationMinutes: segment.endMinute - segment.startMinute,
    avg: round(segment.sum / segment.count, 2),
    min: round(segment.min, 2),
    max: round(segment.max, 2),
  };
}

function buildHandwashing(metric) {
  const data = Array.isArray(metric?.data) ? metric.data : [];
  const events = data.map((record) => ({
    type: 'handwashing',
    start: record.start ?? record.date,
    end: record.end,
    durationSeconds: round(Number(record.qty ?? 0), 1),
    status: record.value,
    source: record.source,
  }));
  const totalSeconds = events.reduce((sum, event) => sum + (event.durationSeconds ?? 0), 0);

  return {
    summary: {
      units: metric.units,
      count: events.length,
      totalSeconds: round(totalSeconds, 1),
      completedCount: events.filter((event) => event.status === '已完成' || event.status === '完成').length,
      omittedRawRecords: data.length,
    },
    timeline: events,
  };
}

function buildExerciseTime(metric) {
  const data = Array.isArray(metric?.data) ? metric.data : [];
  const buckets = new Map();
  addMetricToBuckets(buckets, data, exerciseTimeBucketMinutes, 'minutes');
  const sortedBuckets = Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]);
  const values = sortedBuckets.map(([minute, bucket]) => [
    formatMinuteOfDay(minute),
    round(bucket.minutes ?? 0, 1),
  ]);
  const totalMinutes = sumRecords(data);

  return {
    summary: {
      units: metric.units,
      totalMinutes: round(totalMinutes, 1),
      omittedRawRecords: data.length,
      bucketMinutes: exerciseTimeBucketMinutes,
    },
    series: {
      units: metric.units,
      bucketMinutes: exerciseTimeBucketMinutes,
      values,
    },
  };
}

function buildDaylight(metric) {
  const data = Array.isArray(metric?.data) ? metric.data : [];
  const buckets = new Map();
  addMetricToBuckets(buckets, data, daylightBucketMinutes, 'minutes');
  const sortedBuckets = Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]);
  const values = sortedBuckets.map(([minute, bucket]) => [
    formatMinuteOfDay(minute),
    round(bucket.minutes ?? 0, 1),
  ]);
  const totalMinutes = sumRecords(data);

  return {
    summary: {
      units: metric.units,
      totalMinutes: round(totalMinutes, 1),
      omittedRawRecords: data.length,
      bucketMinutes: daylightBucketMinutes,
      segmentThresholdMinutes: daylightSegmentThresholdMinutes,
      segmentMergeGapMinutes: daylightMergeGapMinutes,
    },
    series: {
      units: metric.units,
      bucketMinutes: daylightBucketMinutes,
      values,
    },
    segments: buildSingleValueSegments(sortedBuckets, {
      type: 'daylight',
      valueKey: 'minutes',
      outputKey: 'durationMinutes',
      bucketMinutes: daylightBucketMinutes,
      threshold: daylightSegmentThresholdMinutes,
      mergeGapMinutes: daylightMergeGapMinutes,
      decimals: 1,
    }),
  };
}

function summarizeQuantityMetric(metric, decimals) {
  const data = Array.isArray(metric?.data) ? metric.data : [];
  const values = data.map((record) => Number(record.qty)).filter(Number.isFinite);
  const latest = data.at(-1);

  if (values.length === 0) {
    return {
      units: metric.units,
      count: 0,
      omittedRawRecords: data.length,
    };
  }

  return {
    units: metric.units,
    count: values.length,
    latest: round(Number(latest?.qty ?? values.at(-1)), decimals),
    latestDate: latest?.date,
    avg: round(values.reduce((sum, value) => sum + value, 0) / values.length, decimals),
    min: round(Math.min(...values), decimals),
    max: round(Math.max(...values), decimals),
    omittedRawRecords: data.length,
  };
}

function buildSingleValueSegments(sortedBuckets, options) {
  const activeBuckets = sortedBuckets.filter(([, bucket]) => (bucket[options.valueKey] ?? 0) >= options.threshold);
  const segments = [];
  let current = null;

  for (const [minute, bucket] of activeBuckets) {
    if (!current || minute - current.endMinute > options.mergeGapMinutes) {
      if (current) {
        segments.push(formatSingleValueSegment(current, options));
      }
      current = {
        startMinute: minute,
        endMinute: minute + options.bucketMinutes,
        value: 0,
        bucketCount: 0,
      };
    } else {
      current.endMinute = minute + options.bucketMinutes;
    }

    current.value += bucket[options.valueKey] ?? 0;
    current.bucketCount += 1;
  }

  if (current) {
    segments.push(formatSingleValueSegment(current, options));
  }

  return segments;
}

function formatSingleValueSegment(segment, options) {
  return {
    type: options.type,
    start: formatMinuteOfDay(segment.startMinute),
    end: formatMinuteOfDay(segment.endMinute),
    durationMinutes: segment.endMinute - segment.startMinute,
    [options.outputKey]: round(segment.value, options.decimals),
    bucketCount: segment.bucketCount,
  };
}

function addMetricToBuckets(buckets, records, bucketMinutes, key) {
  for (const record of records) {
    const minute = minuteOfDay(record.date);
    if (minute === null) {
      continue;
    }

    const bucketStart = Math.floor(minute / bucketMinutes) * bucketMinutes;
    const bucket = buckets.get(bucketStart) ?? {};
    bucket[key] = (bucket[key] ?? 0) + Number(record.qty ?? 0);
    buckets.set(bucketStart, bucket);
  }
}

function sumRecords(records) {
  return records.reduce((sum, record) => sum + Number(record.qty ?? 0), 0);
}

function buildSleepTimeline(metric) {
  const data = Array.isArray(metric?.data) ? metric.data : [];
  return data.map((record) => ({
    type: 'sleep',
    stage: normalizeSleepStage(record.value),
    label: record.value,
    start: record.start ?? record.startDate ?? record.date,
    end: record.end ?? record.endDate,
    durationMinutes: round(Number(record.qty ?? 0) * 60, 1),
    source: record.source,
  }));
}

function buildWorkoutTimeline(workouts) {
  if (!Array.isArray(workouts)) {
    return [];
  }

  return workouts.map((workout) => ({
    type: 'workout',
    workoutType: workout.workoutActivityType ?? workout.activityType ?? workout.type,
    start: workout.start ?? workout.startDate,
    end: workout.end ?? workout.endDate,
    durationMinutes: workout.duration,
    source: workout.source,
  }));
}

function buildCompactWorkouts(workouts) {
  if (!Array.isArray(workouts)) {
    return {
      summary: {
        count: 0,
      },
      workouts: [],
      timeline: [],
    };
  }

  const compactWorkouts = workouts.map(compactWorkout);

  return {
    summary: {
      count: compactWorkouts.length,
      durationMinutes: round(compactWorkouts.reduce((sum, workout) => sum + (workout.durationMinutes ?? 0), 0), 1),
      activeEnergyKJ: round(compactWorkouts.reduce((sum, workout) => sum + (workout.activeEnergyKJ ?? 0), 0), 1),
      distanceKm: round(compactWorkouts.reduce((sum, workout) => sum + (workout.distanceKm ?? 0), 0), 3),
      steps: round(compactWorkouts.reduce((sum, workout) => sum + (workout.steps ?? 0), 0), 0),
    },
    workouts: compactWorkouts,
    timeline: compactWorkouts.map((workout) => ({
      type: 'workout',
      ...workout,
    })),
  };
}

function compactWorkout(workout) {
  const durationMinutes = workout.duration === undefined ? undefined : round(Number(workout.duration) / 60, 1);
  const distanceKm = workout.distance?.qty ?? sumWorkoutRecords(workout.walkingAndRunningDistance);
  const steps = sumWorkoutRecords(workout.stepCount);
  const activeEnergyKJ = workout.activeEnergyBurned?.qty ?? sumWorkoutRecords(workout.activeEnergy);
  const basalEnergyKJ = workout.basalEnergyBurned?.qty ?? sumWorkoutRecords(workout.basalEnergy);
  const heartRate = summarizeWorkoutHeartRate(workout);

  return dropUndefined({
    id: workout.id,
    name: workout.name,
    workoutType: workout.workoutActivityType ?? workout.activityType ?? workout.type,
    location: workout.location,
    isIndoor: workout.isIndoor,
    start: workout.start ?? workout.startDate,
    end: workout.end ?? workout.endDate,
    durationMinutes,
    activeEnergyKJ: round(activeEnergyKJ, 1),
    basalEnergyKJ: round(basalEnergyKJ, 1),
    totalEnergyKJ: workout.totalEnergy?.qty === undefined ? undefined : round(Number(workout.totalEnergy.qty), 1),
    distanceKm: round(distanceKm, 3),
    steps: round(steps, 0),
    flights: workout.flightsClimbed?.qty === undefined ? undefined : round(Number(workout.flightsClimbed.qty), 2),
    avgHeartRate: heartRate.avg,
    minHeartRate: heartRate.min,
    maxHeartRate: heartRate.max,
    avgSpeed: workout.avgSpeed?.qty === undefined ? undefined : round(Number(workout.avgSpeed.qty), 2),
    maxSpeed: workout.maxSpeed?.qty === undefined ? undefined : round(Number(workout.maxSpeed.qty), 2),
    temperature: workout.temperature?.qty === undefined ? undefined : round(Number(workout.temperature.qty), 1),
    humidity: workout.humidity?.qty === undefined ? undefined : round(Number(workout.humidity.qty), 1),
  });
}

function summarizeWorkoutHeartRate(workout) {
  const candidates = [];

  if (Array.isArray(workout.heartRateData)) {
    candidates.push(...workout.heartRateData);
  }
  if (Array.isArray(workout.heartRate)) {
    candidates.push(...workout.heartRate);
  }

  const values = candidates
    .map((record) => Number(record.Avg ?? record.qty))
    .filter(Number.isFinite);
  const avgValue = workout.avgHeartRate?.qty;
  const maxValue = workout.maxHeartRate?.qty;

  if (values.length === 0) {
    return {
      avg: avgValue === undefined ? undefined : round(Number(avgValue), 1),
      min: undefined,
      max: maxValue === undefined ? undefined : round(Number(maxValue), 1),
    };
  }

  return {
    avg: avgValue === undefined ? round(values.reduce((sum, value) => sum + value, 0) / values.length, 1) : round(Number(avgValue), 1),
    min: round(Math.min(...values), 1),
    max: maxValue === undefined ? round(Math.max(...values), 1) : round(Number(maxValue), 1),
  };
}

function sumWorkoutRecords(records) {
  if (!Array.isArray(records)) {
    return 0;
  }

  return records.reduce((sum, record) => sum + Number(record.qty ?? 0), 0);
}

function dropUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null));
}

function normalizeSleepStage(value) {
  const stageMap = {
    '清醒': 'awake',
    '核心': 'core',
    '深度': 'deep',
    '快速动眼期': 'rem',
  };
  return stageMap[value] ?? value;
}

function compareTimelineItems(a, b) {
  return timelineSortValue(a) - timelineSortValue(b);
}

function timelineSortValue(item) {
  const value = item.start ?? item.date ?? '';
  const fullDateMinute = minuteOfDay(value);
  const isoMinute = isoMinuteOfDay(value);
  const minute = parseClockMinute(value);
  if (fullDateMinute !== null) {
    return fullDateMinute;
  }
  if (isoMinute !== null) {
    return isoMinute;
  }
  return minute === null ? Number.MAX_SAFE_INTEGER : minute;
}

function minuteOfDay(value) {
  const match = value?.match(/\d{4}-\d{2}-\d{2} (\d{2}):(\d{2}):/);
  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function parseClockMinute(value) {
  const match = value?.match(/^(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function isoMinuteOfDay(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date).map((part) => [part.type, part.value]));

  return Number(parts.hour) * 60 + Number(parts.minute);
}

function normalizeTimelineDateTime(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return value;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date).map((part) => [part.type, part.value]));

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${timeZoneOffset}`;
}

function formatMinuteOfDay(minute) {
  const normalized = Math.min(minute, 24 * 60);
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function kjToKcal(value) {
  return value / 4.184;
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function enumerateDates(startDate, endDate) {
  assertDate(startDate);
  assertDate(endDate);

  const dates = [];
  const current = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);

  while (current <= end) {
    dates.push(formatLocalDate(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

function parseDateOnly(value) {
  const [year, month, date] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date));
}

function sumMetricRecords(metrics) {
  if (!Array.isArray(metrics)) {
    return 0;
  }

  return metrics.reduce((sum, metric) => sum + (Array.isArray(metric?.data) ? metric.data.length : 0), 0);
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }

    if (arg === '--overwrite-daily') {
      parsed.overwriteDaily = true;
      continue;
    }

    if (arg === '--year' || arg === '--month' || arg === '--date' || arg === '--end-date' || arg === '--target' || arg === '--mcp-server' || arg === '--timeout') {
      const value = argv[index + 1];

      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${arg}`);
      }

      parsed[toCamelCase(arg.slice(2))] = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function printHelp() {
  console.log(`Usage: npm run export-health-year -- [options]

Options:
  --year <year>              Export full year (defaults to current month if omitted).
  --month <YYYY-MM>          Export specific month.
  --date <YYYY-MM-DD>        Export only one daily compact file without writing month summary.
  --end-date <YYYY-MM-DD>    End date. Defaults to today for current year/month.
  --overwrite-daily          Rewrite existing daily compact files in month/year mode.
  --target <dir>             Output directory. Defaults to static/data/health.
  --mcp-server <file>        health_auto_export MCP server path.
  --timeout <ms>             Per-tool timeout. Defaults to 86400000.
  -h, --help                 Show this help.`);
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function assertYear(value) {
  if (!/^\d{4}$/.test(value)) {
    throw new Error(`Invalid year: ${value}`);
  }
}

function assertDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid date: ${value}`);
  }
}

function assertMonth(value) {
  if (!/^\d{4}-\d{2}$/.test(value)) {
    throw new Error(`Invalid month: ${value}`);
  }
}

function getCurrentYear() {
  return formatLocalDate(new Date()).slice(0, 4);
}

function getCurrentMonth() {
  return formatLocalDate(new Date()).slice(0, 7);
}

function defaultEndDate(year) {
  const today = formatLocalDate(new Date());
  return today.startsWith(`${year}-`) ? today : `${year}-12-31`;
}

function defaultEndDateMonth(year, month) {
  const today = formatLocalDate(new Date());
  const monthPrefix = `${year}-${month}`;
  if (today.startsWith(monthPrefix)) {
    return today;
  }
  // Last day of month
  const lastDay = new Date(Number(year), Number(month), 0);
  return formatLocalDate(lastDay);
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

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
