import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export class HealthSourceCatalog {
  constructor(root) {
    this.file = path.join(root, 'sources.json');
    this.sources = {};
    if (fs.existsSync(this.file)) {
      const payload = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (payload?.version === 1 && payload.sources && typeof payload.sources === 'object') {
        this.sources = payload.sources;
      }
    }
  }

  id(value) {
    const label = sourceLabel(value);
    if (!label) return undefined;
    let id;
    if (/watch/i.test(label)) id = 'watch';
    else if (/iphone/i.test(label)) id = 'phone';
    else if (/fitdays/i.test(label)) id = 'scale';
    else id = `source-${crypto.createHash('sha256').update(label).digest('hex').slice(0, 8)}`;
    this.sources[id] ??= label;
    return id;
  }

  write() {
    writeJsonAtomic(this.file, {version: 1, sources: this.sources});
  }
}

export function buildHealthDailyV4({date, exportedAt, aggregateMetrics, rawMetrics, timeline, collections, sourceCatalog}) {
  const result = {version: 4, date, exportedAt};
  const unknown = [];
  for (const metric of aggregateMetrics ?? []) {
    const point = metric.data?.[0];
    if (!point) continue;
    if (!applyMetric(result, metric.name, point, sourceCatalog)) unknown.push(metric.name);
  }

  addMetricCollections(result, date, aggregateMetrics ?? [], rawMetrics ?? [], sourceCatalog);
  if (unknown.length) (result.other ??= {}).unmappedMetricNames = [...new Set(unknown)].sort();
  addTimelineDetails(result, date, timeline ?? []);
  addMeasurements(result, date, rawMetrics ?? [], sourceCatalog);
  addCollections(result, date, collections ?? {}, sourceCatalog);
  return prune(result);
}

function addMetricCollections(result, date, aggregateMetrics, rawMetrics, sourceCatalog) {
  for (const [key, metrics] of [['summaries', aggregateMetrics], ['records', rawMetrics]]) {
    for (const metric of metrics) {
      if (!metric?.name || !Array.isArray(metric.data) || metric.data.length === 0) continue;
      const domain = metricDomain(metric.name);
      ((result[domain] ??= {})[key] ??= []).push(columnarMetric(metric, date, sourceCatalog));
    }
  }
}

export function columnarMetric(metric, date, sourceCatalog) {
  const {data, ...metadata} = metric;
  const originalColumns = [...new Set(data.flatMap((record) => Object.keys(record)))].sort();
  const columns = originalColumns.map((column) => {
    const values = data.map((record) => record[column]).filter((value) => value !== undefined && value !== null);
    if (values.length && values.every((value) => typeof value === 'string' && Number.isFinite(parseHealthTime(value)))) {
      return `${column}Minute`;
    }
    return column === 'source' ? 'sourceId' : column;
  });
  const rows = data.map((record) => originalColumns.map((column, index) => {
    if (!Object.hasOwn(record, column)) return null;
    const value = record[column];
    if (columns[index].endsWith('Minute') && typeof value === 'string') {
      return round((parseHealthTime(value) - Date.parse(`${date}T00:00:00+08:00`)) / 60000, 6);
    }
    if (column === 'source') return sourceCatalog.id(value);
    return value;
  }));
  return {...structuredClone(metadata), columns, rows};
}

function parseHealthTime(value) {
  return Date.parse(String(value).replace(' ', 'T').replace(/ ([+-]\d{2})(\d{2})$/, '$1:$2'));
}

export function metricDomain(name) {
  if (/sleep/i.test(name)) return 'sleep';
  if (/mindful/i.test(name)) return 'mindfulness';
  if (/audio|hearing/i.test(name)) return 'hearing';
  if (/respiratory|oxygen|spirometry|inhaler|peak_expiratory|forced_vital|perfusion/i.test(name)) return 'respiratory';
  if (/heart|cardio|blood_pressure|atrial|electrocardiogram/i.test(name)) return 'heart';
  if (/walking_speed|walking_step|walking_asymmetry|walking_double|stair_speed|six_minute|running_stride|running_ground|running_vertical|running_power/i.test(name)) return 'activityCapability';
  if (/body_mass|body_fat|lean_body|height|waist|weight/i.test(name)) return 'bodyMeasurements';
  if (/temperature|blood_glucose|insulin/i.test(name)) return 'vitalSigns';
  if (/sexual|menstrual|ovulation|cervical|contraceptive|pregnancy|lactation|basal_body/i.test(name)) return 'reproductive';
  if (/dietary|nutrition|water|caffeine/i.test(name)) return 'nutrition';
  if (/step|distance|energy|exercise|stand|flight|swim|cycling|running|push|effort|vo2|daylight|handwashing|water_depth/i.test(name)) return 'activity';
  return 'other';
}

export function validateHealthDailyV4(value, expectedDate) {
  const errors = [];
  if (value?.version !== 4) errors.push('version must be 4');
  if (value?.date !== expectedDate) errors.push(`date must be ${expectedDate}`);
  if (!value?.exportedAt || !Number.isFinite(Date.parse(value.exportedAt))) errors.push('exportedAt must be an ISO timestamp');
  if (value?.sleep?.totalMinutes > 0 && !Array.isArray(value.sleep.stages)) {
    errors.push('sleep summary exists without sleep stages');
  }
  if (value?.heart?.hrv?.dailyMs > 0 && !Array.isArray(value.heart.hrv.measurements)) {
    errors.push('HRV summary exists without HRV measurements');
  }
  return errors;
}

export function writeJsonAtomic(file, payload) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload)}\n`);
  fs.renameSync(temporary, file);
}

function applyMetric(result, name, point, sourceCatalog) {
  const qty = finite(point.qty);
  const activity = () => result.activity ??= {};
  const capability = () => result.activityCapability ??= {};
  const body = () => result.bodyMeasurements ??= {};
  const heart = () => result.heart ??= {};
  const hearing = () => result.hearing ??= {};
  const respiratory = () => result.respiratory ??= {};
  const vitalSigns = () => result.vitalSigns ??= {};
  const setters = {
    active_energy: () => activity().activeEnergyKJ = round(qty),
    apple_exercise_time: () => activity().exerciseMinutes = round(qty),
    apple_sleeping_wrist_temperature: () => vitalSigns().wristTemperatureCelsius = round(qty),
    apple_stand_hour: () => activity().standHours = round(qty),
    apple_stand_time: () => activity().standMinutes = round(qty),
    basal_energy_burned: () => activity().restingEnergyKJ = round(qty),
    blood_oxygen_saturation: () => respiratory().bloodOxygenFraction = round(qty / 100),
    body_fat_percentage: () => body().bodyFatFraction = round(qty / 100),
    body_mass_index: () => body().bodyMassIndex = round(qty),
    cardio_recovery: () => heart().cardioRecoveryBpm = round(qty),
    cycling_distance: () => activity().cyclingDistanceKm = round(qty),
    environmental_audio_exposure: () => hearing().environmentalAudioExposureDbASPL = round(qty),
    flights_climbed: () => activity().flightsClimbed = round(qty),
    handwashing: () => activity().handwashingSeconds = round(qty),
    headphone_audio_exposure: () => hearing().headphoneAudioExposureDbASPL = round(qty),
    lean_body_mass: () => body().leanBodyMassKg = round(qty),
    mindful_minutes: () => (result.mindfulness ??= {}).minutes = round(qty),
    physical_effort: () => activity().physicalEffortKcalPerHourKg = round(qty),
    respiratory_rate: () => respiratory().respiratoryRatePerMinute = round(qty),
    resting_heart_rate: () => heart().restingHeartRateBpm = round(qty),
    six_minute_walking_test_distance: () => capability().sixMinuteWalkDistanceM = round(qty),
    stair_speed_down: () => capability().stairDescentSpeedMps = round(qty),
    stair_speed_up: () => capability().stairAscentSpeedMps = round(qty),
    step_count: () => activity().steps = round(qty),
    swimming_distance: () => activity().swimmingDistanceM = round(qty),
    swimming_stroke_count: () => activity().swimmingStrokeCount = round(qty),
    time_in_daylight: () => activity().daylightMinutes = round(qty),
    toothbrushing: () => (result.other ??= {}).toothbrushingSeconds = round(qty),
    vo2_max: () => activity().vo2MaxMlKgMin = round(qty),
    walking_asymmetry_percentage: () => capability().walkingAsymmetryPercent = round(qty),
    walking_double_support_percentage: () => capability().walkingDoubleSupportPercent = round(qty),
    walking_heart_rate_average: () => heart().walkingHeartRateBpm = round(qty),
    walking_running_distance: () => activity().distanceKm = round(qty),
    walking_speed: () => capability().walkingSpeedMps = round(qty / 3.6),
    walking_step_length: () => capability().walkingStepLengthM = round(qty / 100),
    weight_body_mass: () => body().weight = {dailyKg: round(qty), source: sourceCatalog.id(point.source)},
  };
  if (name === 'heart_rate') {
    heart().heartRate = prune({minimumBpm: round(point.Min), averageBpm: round(point.Avg), maximumBpm: round(point.Max)});
    return true;
  }
  if (name === 'heart_rate_variability') {
    heart().hrv = {dailyMs: round(qty), source: sourceCatalog.id(point.source)};
    return true;
  }
  if (name === 'sleep_analysis') {
    result.sleep = prune({
      totalMinutes: hoursToMinutes(point.totalSleep), deepMinutes: hoursToMinutes(point.deep),
      coreMinutes: hoursToMinutes(point.core), remMinutes: hoursToMinutes(point.rem),
      awakeMinutes: hoursToMinutes(point.awake),
      startMinute: minuteOffset(String(point.date ?? '').slice(0, 10), point.sleepStart ?? point.inBedStart),
      endMinute: minuteOffset(String(point.date ?? '').slice(0, 10), point.sleepEnd ?? point.inBedEnd),
      source: sourceCatalog.id(point.source),
    });
    return true;
  }
  const setter = setters[name];
  if (!setter) return false;
  setter();
  return true;
}

function addTimelineDetails(result, date, timeline) {
  const sleep = timeline.filter((item) => item.type === 'sleep' && item.stage && item.start && item.end)
    .map((item) => [minuteOffset(date, item.start), minuteOffset(date, item.end), item.stage]);
  if (sleep.length) (result.sleep ??= {}).stages = sleep;

  const periods = (type, mapper) => timeline.filter((item) => item.type === type).map(mapper);
  const movement = periods('movement', (item) => [clockMinute(item.start), clockMinute(item.end), round(item.steps), round(item.distanceKm)]);
  const stand = periods('stand', (item) => [clockMinute(item.start), clockMinute(item.end), round(item.durationMinutes)]);
  const daylight = periods('daylight', (item) => [clockMinute(item.start), clockMinute(item.end), round(item.durationMinutes)]);
  if (movement.length) (result.activity ??= {}).movementPeriods = movement;
  if (stand.length) (result.activity ??= {}).standPeriods = stand;
  if (daylight.length) (result.activity ??= {}).daylightPeriods = daylight;
}

function addMeasurements(result, date, metrics, sourceCatalog) {
  const metric = (name) => metrics.find((item) => item?.name === name)?.data ?? [];
  const hrv = metric('heart_rate_variability').flatMap((item) => {
    const minute = minuteOffset(date, item.start ?? item.date);
    const value = round(item.qty);
    return minute === undefined || value === undefined ? [] : [[minute, value, sourceCatalog.id(item.source)]];
  });
  if (hrv.length) ((result.heart ??= {}).hrv ??= {}).measurements = hrv;
  const weight = metric('weight_body_mass').flatMap((item) => {
    const minute = minuteOffset(date, item.start ?? item.date);
    const value = round(item.qty);
    return minute === undefined || value === undefined ? [] : [[minute, value, sourceCatalog.id(item.source)]];
  });
  if (weight.length) ((result.bodyMeasurements ??= {}).weight ??= {}).measurements = weight;
}

function addCollections(result, date, collections, sourceCatalog) {
  const workouts = (collections.workouts?.workouts ?? []).map((item) => prune({
    ...item,
    id: item.id,
    type: item.name,
    startMinute: minuteOffset(date, item.start),
    endMinute: minuteOffset(date, item.end),
    durationMinutes: round(Number(item.duration) / 60),
    indoor: item.isIndoor,
    distanceKm: distanceKm(item.distance),
    activeEnergyKJ: energyKJ(item.activeEnergyBurned ?? item.totalEnergy),
    averageHeartRateBpm: round(quantity(item.avgHeartRate)),
    maximumHeartRateBpm: round(quantity(item.maxHeartRate) ?? item.heartRate?.max?.qty),
    steps: round((item.stepCount ?? []).reduce((sum, point) => sum + finite(point.qty), 0)) || undefined,
    sourceId: sourceCatalog.id(item.source),
  }));
  if (workouts.length) (result.activity ??= {}).workouts = workouts;

  const doses = (collections.medications?.medications ?? []).map((item) => prune({
    ...item,
    scheduledMinute: minuteOffset(date, item.scheduledDate),
    takenMinute: item.status === '已服用' ? minuteOffset(date, item.start) : undefined,
    name: item.displayText,
    dosage: optionalNumber(item.dosage),
    scheduledDosage: optionalNumber(item.scheduledDosage),
    unit: item.units,
    status: item.status,
  }));
  if (doses.length) result.medications = {doses};

  const entries = (collections.stateOfMind?.stateOfMind ?? []).map((item) => prune({
    ...item,
    minute: minuteOffset(date, item.start), kind: item.kind, valence: round(item.valence),
    classification: item.valenceClassification, labels: item.labels, associations: item.associations,
  }));
  if (entries.length) (result.mindfulness ??= {}).stateOfMindEntries = entries;
  const notifications = collections.heartNotifications?.heartRateNotifications ?? [];
  if (notifications.length) (result.heart ??= {}).notifications = notifications;
  const ecg = collections.ecg?.ecg ?? [];
  if (ecg.length) (result.heart ??= {}).ecg = ecg;
  const cycleTracking = collections.cycleTracking?.cycleTracking ?? [];
  if (cycleTracking.length) (result.reproductive ??= {}).cycleTracking = cycleTracking;
  const symptoms = collections.symptoms?.symptoms ?? [];
  if (symptoms.length) (result.other ??= {}).symptoms = symptoms;
}

function sourceLabel(value) {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  return value.name ?? value.identifier ?? JSON.stringify(value);
}

function minuteOffset(day, value) {
  if (!value) return undefined;
  const normalized = String(value).replace(' ', 'T').replace(/ ([+-]\d{2})(\d{2})$/, '$1:$2');
  const start = Date.parse(`${day}T00:00:00+08:00`);
  const time = Date.parse(normalized);
  return Number.isFinite(time) ? round((time - start) / 60000, 3) : clockMinute(value);
}

function clockMinute(value) {
  const match = String(value ?? '').match(/(?:^|T| )(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return undefined;
  return round(Number(match[1]) * 60 + Number(match[2]) + Number(match[3] ?? 0) / 60, 3);
}

function distanceKm(value) {
  const amount = quantity(value);
  if (amount === undefined) return undefined;
  return round(value?.units === 'm' ? amount / 1000 : amount);
}

function energyKJ(value) {
  const amount = quantity(value);
  if (amount === undefined) return undefined;
  return round(value?.units === 'kcal' ? amount * 4.184 : amount);
}

function quantity(value) {
  if (typeof value === 'number') return value;
  return typeof value?.qty === 'number' ? value.qty : undefined;
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function optionalNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function hoursToMinutes(value) {
  return round(finite(value) * 60, 3);
}

function round(value, digits = 6) {
  if (value === undefined || !Number.isFinite(Number(value))) return undefined;
  const scale = 10 ** digits;
  return Math.round(Number(value) * scale) / scale;
}

export function prune(value) {
  if (Array.isArray(value)) {
    const cleaned = value.map(prune);
    while (cleaned.length && cleaned.at(-1) === undefined) cleaned.pop();
    return cleaned.map((item) => item === undefined ? null : item);
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    const cleaned = prune(item);
    if (cleaned === undefined || cleaned === null || cleaned === false || cleaned === '') return [];
    if (Array.isArray(cleaned) && cleaned.length === 0) return [];
    if (typeof cleaned === 'object' && !Array.isArray(cleaned) && Object.keys(cleaned).length === 0) return [];
    return [[key, cleaned]];
  }));
}
