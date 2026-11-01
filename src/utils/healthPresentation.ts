import {type HealthMetricPayload, type HealthTimelinePeriod, type HealthTimelineFile, parseHealthMetricTimeline} from './healthTimeline';

export type HealthDayData = {
  version?: 5;
  revision?: string;
  date: string;
  activity?: Record<string, number | unknown[] | undefined> & {
    daylightPeriods?: Array<[number, number, number]>;
    movementPeriods?: Array<[number, number, number?, number?]>;
    standPeriods?: Array<[number, number, number]>;
    workouts?: Array<{id?: string; type?: string; startMinute?: number; endMinute?: number; durationMinutes?: number; distanceKm?: number; averageHeartRateBpm?: number; activeEnergyKJ?: number}>;
  };
  sleep?: {stages?: Array<[number, number, string]>; totalMinutes?: number};
  hearing?: {environmentalAudioExposureDbASPL?: number; headphoneAudioExposureDbASPL?: number};
  respiratory?: {respiratoryRatePerMinute?: number; bloodOxygenFraction?: number};
  vitalSigns?: {wristTemperatureCelsius?: number};
  activityCapability?: {walkingStepLengthM?: number; walkingSpeedMps?: number; walkingAsymmetryPercent?: number; walkingDoubleSupportPercent?: number; stairAscentSpeedMps?: number; stairDescentSpeedMps?: number; sixMinuteWalkDistanceM?: number};
  files?: Record<string, {path: string; records?: number}>;
  heart?: {
    hrv?: {dailyMs?: number; source?: string; measurements?: Array<[number, number, string]>};
    restingHeartRateBpm?: number; walkingHeartRateBpm?: number; cardioRecoveryBpm?: number;
    heartRate?: {averageBpm?: number};
    notifications?: Array<{start?: string; end?: string; heartNotification?: string; threshold?: number}>;
  };
  bodyMeasurements?: {weight?: {dailyKg?: number; measurements?: Array<[number, number, string]>}; bodyFatFraction?: number; bodyMassIndex?: number; leanBodyMassKg?: number};
  mindfulness?: {minutes?: number; stateOfMindEntries?: Array<{minute?: number; kind?: string; valence?: number; classification?: string; labels?: string[]; associations?: string[]}>};
  medications?: {doses?: Array<{scheduledMinute?: number; takenMinute?: number; name?: string; displayText?: string; status?: string; dosage?: number; scheduledDosage?: number; unit?: string; units?: string}>};
  other?: {toothbrushingSeconds?: number};
  workoutDetails?: Array<{id: string; files: {meta?: string; samples?: string; route?: string}}>;
};

export type MetricGroup = 'vitals' | 'activity' | 'capability' | 'other' | 'environment' | 'mindfulness' | 'body';
export type HealthMetricDefinition = {
  name: string; label: string; unit: string; group: MetricGroup;
  kind: 'series' | 'statistic' | 'total' | 'measurements';
  field: string; multiplier?: number; decimals?: number;
};
export const healthMetricDefinitions: HealthMetricDefinition[] = [
  {name: 'heart_rate_variability', label: 'HRV', unit: '毫秒', group: 'vitals', kind: 'measurements', field: 'heart.hrv.dailyMs', decimals: 1},
  {name: 'resting_heart_rate', label: '静息心率', unit: '次/分', group: 'vitals', kind: 'statistic', field: 'heart.restingHeartRateBpm'},
  {name: 'heart_rate', label: '全天心率', unit: '次/分', group: 'vitals', kind: 'series', field: 'heart.heartRate.averageBpm'},
  {name: 'blood_oxygen_saturation', label: '血氧', unit: '%', group: 'vitals', kind: 'series', field: 'respiratory.bloodOxygenFraction', multiplier: 100, decimals: 1},
  {name: 'respiratory_rate', label: '呼吸频率', unit: '次/分', group: 'vitals', kind: 'series', field: 'respiratory.respiratoryRatePerMinute', decimals: 1},
  {name: 'apple_sleeping_wrist_temperature', label: '睡眠腕温', unit: '℃', group: 'vitals', kind: 'statistic', field: 'vitalSigns.wristTemperatureCelsius', decimals: 2},
  {name: 'apple_exercise_time', label: '运动', unit: '分钟', group: 'activity', kind: 'total', field: 'activity.exerciseMinutes'},
  {name: 'step_count', label: '步数', unit: '步', group: 'activity', kind: 'total', field: 'activity.steps'},
  {name: 'walking_running_distance', label: '步跑距离', unit: '公里', group: 'activity', kind: 'total', field: 'activity.distanceKm', decimals: 2},
  {name: 'cycling_distance', label: '骑行距离', unit: '公里', group: 'activity', kind: 'total', field: 'activity.cyclingDistanceKm', decimals: 2},
  {name: 'swimming_distance', label: '游泳距离', unit: '米', group: 'activity', kind: 'total', field: 'activity.swimmingDistanceM'},
  {name: 'swimming_stroke_count', label: '划水次数', unit: '次', group: 'activity', kind: 'total', field: 'activity.swimmingStrokeCount'},
  {name: 'active_energy', label: '活动能量', unit: '千卡', group: 'activity', kind: 'total', field: 'activity.activeEnergyKJ', multiplier: 1 / 4.184},
  {name: 'apple_stand_time', label: '站立', unit: '分钟', group: 'activity', kind: 'total', field: 'activity.standMinutes'},
  {name: 'apple_stand_hour', label: '站立达标', unit: '小时', group: 'activity', kind: 'total', field: 'activity.standHours'},
  {name: 'vo2_max', label: '最大摄氧量', unit: 'mL/kg/min', group: 'capability', kind: 'statistic', field: 'activity.vo2MaxMlKgMin', decimals: 1},
  {name: 'cardio_recovery', label: '心率恢复', unit: '次/分', group: 'capability', kind: 'statistic', field: 'heart.cardioRecoveryBpm'},
  {name: 'six_minute_walking_test_distance', label: '六分钟步行', unit: '米', group: 'capability', kind: 'statistic', field: 'activityCapability.sixMinuteWalkDistanceM'},
  {name: 'walking_heart_rate_average', label: '步行平均心率', unit: '次/分', group: 'capability', kind: 'statistic', field: 'heart.walkingHeartRateBpm'},
  {name: 'walking_speed', label: '步速', unit: '公里/时', group: 'capability', kind: 'statistic', field: 'activityCapability.walkingSpeedMps', multiplier: 3.6, decimals: 2},
  {name: 'walking_step_length', label: '步长', unit: '厘米', group: 'capability', kind: 'statistic', field: 'activityCapability.walkingStepLengthM', multiplier: 100, decimals: 1},
  {name: 'walking_asymmetry_percentage', label: '步行不对称', unit: '%', group: 'capability', kind: 'statistic', field: 'activityCapability.walkingAsymmetryPercent', decimals: 1},
  {name: 'walking_double_support_percentage', label: '双脚支撑', unit: '%', group: 'capability', kind: 'statistic', field: 'activityCapability.walkingDoubleSupportPercent', decimals: 1},
  {name: 'basal_energy_burned', label: '静息能量', unit: '千卡', group: 'other', kind: 'total', field: 'activity.restingEnergyKJ', multiplier: 1 / 4.184},
  {name: 'physical_effort', label: '体力强度', unit: 'kcal/kg/h', group: 'other', kind: 'series', field: 'activity.physicalEffortKcalPerHourKg', decimals: 1},
  {name: 'flights_climbed', label: '爬楼', unit: '层', group: 'other', kind: 'total', field: 'activity.flightsClimbed'},
  {name: 'handwashing', label: '洗手', unit: '秒', group: 'other', kind: 'total', field: 'activity.handwashingSeconds'},
  {name: 'toothbrushing', label: '刷牙', unit: '秒', group: 'other', kind: 'total', field: 'other.toothbrushingSeconds'},
  {name: 'time_in_daylight', label: '日照', unit: '分钟', group: 'environment', kind: 'total', field: 'activity.daylightMinutes'},
  {name: 'environmental_audio_exposure', label: '环境声音', unit: 'dBA', group: 'environment', kind: 'series', field: 'hearing.environmentalAudioExposureDbASPL', decimals: 1},
  {name: 'headphone_audio_exposure', label: '耳机声音', unit: 'dBA', group: 'environment', kind: 'series', field: 'hearing.headphoneAudioExposureDbASPL', decimals: 1},
  {name: 'mindful_minutes', label: '正念', unit: '分钟', group: 'mindfulness', kind: 'total', field: 'mindfulness.minutes', decimals: 1},
  {name: 'height', label: '身高', unit: '厘米', group: 'body', kind: 'measurements', field: 'bodyMeasurements.heightM', multiplier: 100, decimals: 1},
];

export function healthMetricValue(day: HealthDayData, definition: HealthMetricDefinition): number | null {
  const value = definition.field.split('.').reduce<unknown>((parent, key) => parent && typeof parent === 'object' ? (parent as Record<string, unknown>)[key] : undefined, day);
  return typeof value === 'number' && Number.isFinite(value) ? value * (definition.multiplier ?? 1) : null;
}

export function healthMetricFile(day: HealthDayData, name: string): HealthTimelineFile | undefined {
  const entry = Object.entries(day.files ?? {}).find(([key, file]) => key.endsWith(`/${name}.json.gz`) && key.startsWith('metrics/') && file.records !== 0);
  return entry ? {name, ...entry[1]} : undefined;
}

export function availableHealthMetrics(day: HealthDayData, groups: MetricGroup[]): HealthMetricDefinition[] {
  return healthMetricDefinitions.filter((definition) => groups.includes(definition.group)
    && (healthMetricValue(day, definition) !== null || Boolean(healthMetricFile(day, definition.name))));
}

export function healthMetricBaseline(days: HealthDayData[], date: string, definition: HealthMetricDefinition): number | null {
  const start = new Date(`${date}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 7);
  const minimum = start.toISOString().slice(0, 10);
  const values = days.filter((day) => day.date >= minimum && day.date < date).map((day) => healthMetricValue(day, definition))
    .filter((value): value is number => value !== null).sort((a, b) => a - b);
  if (values.length < 4) return null;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
}

export function vitalsEntryLabel(day: HealthDayData): string {
  const hrv = day.heart?.hrv?.dailyMs;
  if (typeof hrv === 'number' && Number.isFinite(hrv)) return `体征 HRV${Math.round(hrv)}毫秒`;
  const resting = day.heart?.restingHeartRateBpm;
  if (typeof resting === 'number' && Number.isFinite(resting)) return `体征 静息${Math.round(resting)}次/分`;
  return '体征';
}

export function activityEntryLabel(day: HealthDayData): string | null {
  const minutes = day.activity?.exerciseMinutes;
  if (typeof minutes === 'number' && Number.isFinite(minutes)) return `活动${Math.round(minutes)}分钟`;
  const steps = day.activity?.steps;
  if (typeof steps === 'number' && Number.isFinite(steps)) return `活动${Math.round(steps).toLocaleString('zh-CN')}步`;
  if (day.activity?.workouts?.length) return `训练${day.activity.workouts.length}次`;
  return availableHealthMetrics(day, ['activity', 'capability', 'other']).length ? '活动' : null;
}

export function healthMetricPeriods(day: HealthDayData, definition: HealthMetricDefinition, payload?: HealthMetricPayload): HealthTimelinePeriod[] {
  if (definition.name === 'heart_rate_variability') return (day.heart?.hrv?.measurements ?? [])
    .filter(([minute, value]) => Number.isFinite(minute) && minute >= 0 && minute < 1440 && Number.isFinite(value))
    .map(([minute, value]) => ({start: minute, end: minute, value, detail: `HRV ${value.toFixed(1)} 毫秒`}));
  if (definition.name === 'time_in_daylight' && day.activity?.daylightPeriods?.length) return day.activity.daylightPeriods
    .map(([start, end, value]) => ({start, end, value, detail: `累计日照 ${value.toFixed(1)} 分钟`}));
  if (definition.name === 'apple_stand_time' && day.activity?.standPeriods?.length) return day.activity.standPeriods
    .map(([start, end, value]) => ({start, end, value, detail: `时段内累计站立 ${value.toFixed(1)} 分钟`}));
  if (!payload) return [];
  const file = healthMetricFile(day, definition.name);
  return file ? parseHealthMetricTimeline(day.date, file, payload).periods : [];
}

export function formatHealthMetric(value: number, definition: HealthMetricDefinition): string {
  return `${value.toLocaleString('zh-CN', {maximumFractionDigits: definition.decimals ?? 0})}${definition.unit ? ` ${definition.unit}` : ''}`;
}

export function healthSampleSeries(periods: HealthTimelinePeriod[]): Array<[number, number | null]> {
  const series: Array<[number, number | null]> = [];
  let previous: HealthTimelinePeriod | undefined;
  for (const period of [...periods].sort((a, b) => a.start - b.start)) {
    if (typeof period.value !== 'number') continue;
    if (previous && period.start - previous.end > 15) series.push([previous.end + 0.001, null]);
    series.push([period.start, period.value]);
    previous = period;
  }
  return series;
}


export function healthBandOpacity(value: number | undefined, range?: [number, number], hrv = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !range) return 1;
  if (hrv) return 0.25 + 0.75 * Math.max(0, Math.min(1, value / 100));
  const [low, high] = range;
  if (high === low) return 0.65;
  return 0.25 + 0.75 * Math.max(0, Math.min(1, (value - low) / (high - low)));
}

export function healthBandBuckets(periods: HealthTimelinePeriod[], width: number, total = false): HealthTimelinePeriod[] {
  const count = Math.max(1, Math.floor(width / 2));
  const step = 1440 / count;
  const bins = new Map<number, {sum: number; weight: number; numeric: boolean}>();
  for (const period of periods) {
    if (!Number.isFinite(period.start) || !Number.isFinite(period.end) || period.end < period.start || period.end < 0 || period.start >= 1440) continue;
    if ((period.value !== undefined && !Number.isFinite(period.value)) || (period.end === 0 && period.start < 0)) continue;
    const start = Math.max(0, period.start);
    const end = Math.min(1440, period.end);
    const first = Math.min(count - 1, Math.floor(start / step));
    const last = Math.min(count - 1, Math.max(first, Math.ceil(end / step) - 1));
    for (let index = first; index <= last; index++) {
      const weight = end > start ? (Math.min(end, (index + 1) * step) - Math.max(start, index * step)) / (end - start) : 1;
      const bin = bins.get(index) ?? {sum: 0, weight: 0, numeric: false};
      if (typeof period.value === 'number' && Number.isFinite(period.value)) {
        bin.sum += period.value * weight;
        bin.weight += weight;
        bin.numeric = true;
      }
      bins.set(index, bin);
    }
  }
  return [...bins].sort(([a], [b]) => a - b).map(([index, bin]) => ({
    start: index * step, end: (index + 1) * step, detail: '',
    value: bin.numeric ? total ? bin.sum : bin.sum / bin.weight : undefined,
  }));
}

export function healthBandSample(periods: HealthTimelinePeriod[], minute: number, tolerance = 5): HealthTimelinePeriod | undefined {
  const exact = periods.find((period) => period.end > period.start && minute >= period.start && minute < period.end);
  if (exact) return exact;
  return periods.filter((period) => period.start === period.end && Math.abs(period.start - minute) <= tolerance)
    .sort((a, b) => Math.abs(a.start - minute) - Math.abs(b.start - minute))[0];
}

export function healthMetricComparison(days: HealthDayData[], day: HealthDayData, definition: HealthMetricDefinition): string {
  const value = healthMetricValue(day, definition);
  const baseline = healthMetricBaseline(days, day.date, definition);
  if (value === null) return '暂无日汇总';
  if (baseline === null) return '基线记录不足';
  const difference = Number((value - baseline).toFixed(definition.decimals ?? 0));
  return difference === 0 ? '与前 7 日中位数持平' : `较前 7 日中位数 ${difference > 0 ? '+' : '−'}${formatHealthMetric(Math.abs(difference), definition)}`;
}
