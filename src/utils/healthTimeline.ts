export type HealthTimelinePeriod = {start: number; end: number; detail: string; value?: number; statistic?: boolean};
export type HealthTimelineRow = {
  id: string;
  name: string;
  axisLabel: string;
  periods: HealthTimelinePeriod[];
  summary: string;
  range?: [number, number];
};
export type HealthTimelineFile = {name: string; path: string; records?: number; dailyValue?: number};
export type HealthMetricPayload = {
  version?: number;
  date?: string;
  metric?: {name?: string; units?: string; columns?: string[]; rows?: unknown[][]};
};

type Definition = {name: string; axisLabel: string; total?: boolean; statistic?: string; unit?: string; multiplier?: number; inputUnit?: string};
const definitions: Record<string, Definition> = {
  heart_rate: {name: '心率', axisLabel: '心率'},
  respiratory_rate: {name: '呼吸频率', axisLabel: '呼吸'},
  blood_oxygen_saturation: {name: '血氧饱和度', axisLabel: '血氧'},
  apple_sleeping_wrist_temperature: {name: '睡眠腕温', axisLabel: '腕温', statistic: '夜间统计'},
  resting_heart_rate: {name: '静息心率', axisLabel: '静息率', statistic: '日统计'},
  walking_heart_rate_average: {name: '步行平均心率', axisLabel: '步行率', statistic: '日统计'},
  apple_stand_hour: {name: '站立达标小时', axisLabel: '站立时', total: true, unit: '个达标小时'},
  apple_stand_time: {name: '站立时长', axisLabel: '站立量', total: true},
  apple_exercise_time: {name: '运动时长', axisLabel: '运动', total: true},
  active_energy: {name: '活动能量', axisLabel: '活动能', total: true, unit: '千卡', multiplier: 1 / 4.184, inputUnit: 'kJ'},
  basal_energy_burned: {name: '静息能量', axisLabel: '静息能', total: true, unit: '千卡', multiplier: 1 / 4.184, inputUnit: 'kJ'},
  step_count: {name: '步数', axisLabel: '步数', total: true, unit: '步'},
  walking_running_distance: {name: '步行与跑步距离', axisLabel: '步跑距', total: true},
  cycling_distance: {name: '骑行距离', axisLabel: '骑行', total: true},
  swimming_distance: {name: '游泳距离', axisLabel: '游泳', total: true},
  swimming_stroke_count: {name: '划水次数', axisLabel: '划水', total: true, unit: '次'},
  flights_climbed: {name: '爬楼层数', axisLabel: '爬楼', total: true, unit: '层'},
  handwashing: {name: '洗手', axisLabel: '洗手', total: true},
  toothbrushing: {name: '刷牙', axisLabel: '刷牙', total: true},
  mindful_minutes: {name: '正念', axisLabel: '正念', total: true},
  cardio_recovery: {name: '心率恢复', axisLabel: '恢复', statistic: '测量'},
  six_minute_walking_test_distance: {name: '六分钟步行', axisLabel: '六分步行', statistic: '测量'},
  height: {name: '身高', axisLabel: '身高', unit: '厘米', multiplier: 100, inputUnit: 'm'},
  physical_effort: {name: '体力强度', axisLabel: '体力'},
  walking_speed: {name: '步行速度', axisLabel: '步速'},
  walking_step_length: {name: '步长', axisLabel: '步长'},
  walking_asymmetry_percentage: {name: '步行不对称', axisLabel: '不对称'},
  walking_double_support_percentage: {name: '双脚支撑比例', axisLabel: '双支撑'},
  stair_speed_up: {name: '上楼速度', axisLabel: '上楼速'},
  stair_speed_down: {name: '下楼速度', axisLabel: '下楼速'},
  weight_body_mass: {name: '体重', axisLabel: '体重', unit: '斤', multiplier: 2, inputUnit: 'kg'},
  body_fat_percentage: {name: '体脂率', axisLabel: '体脂'},
  lean_body_mass: {name: '瘦体重', axisLabel: '瘦体重'},
  body_mass_index: {name: '身体质量指数', axisLabel: 'BMI', unit: ''},
  headphone_audio_exposure: {name: '耳机音量', axisLabel: '耳机'},
  vo2_max: {name: '最大摄氧量', axisLabel: '摄氧量'},
};
const existingMetrics = new Set(['heart_rate_variability', 'sleep_analysis', 'time_in_daylight', 'environmental_audio_exposure']);
const units: Record<string, string> = {
  'count/min': '次/分', degC: '℃', min: '分钟', s: '秒', kg: '公斤', km: '公里', m: '米',
  'km/hr': '公里/时', 'm/s': '米/秒', cm: '厘米', dBASPL: 'dBA', 'kcal/hr·kg': '千卡/时·公斤',
  'mL/min·kg': '毫升/分·公斤', count: '次',
};
const number = (value: number) => value.toLocaleString('zh-CN', {maximumFractionDigits: 2});
const time = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(Math.floor(minute % 60)).padStart(2, '0')}`;
const source = (value: unknown) => typeof value === 'string' ? ({watch: 'Apple Watch', phone: 'iPhone', scale: '体脂秤'}[value] ?? value) : '';

export function healthTimelinePeriodLabel({start, end}: {start: number; end: number}): string {
  if (start === end) return time(start);
  if (Math.floor(start) !== Math.floor(end)) return `${time(start)}–${time(end)}`;
  const subsecond = Math.floor(start * 60) === Math.floor(end * 60);
  const clock = (minute: number) => `${time(minute)}:${subsecond
    ? ((minute * 60) % 60).toFixed(2).padStart(5, '0')
    : String(Math.floor(minute * 60 + 1e-6) % 60).padStart(2, '0')}`;
  return `${clock(start)}–${clock(end)}`;
}

export function additionalHealthMetricFiles(files: Record<string, {path: string; records?: number}>, dailyValues: Record<string, number | undefined> = {}): HealthTimelineFile[] {
  return Object.entries(files).flatMap(([key, file]) => {
    const name = key.match(/^metrics\/[^/]+\/([^/]+)\.json\.gz$/)?.[1];
    return name && !existingMetrics.has(name) && file.records !== 0
      ? [{name, ...file, dailyValue: Number.isFinite(dailyValues[name]) ? dailyValues[name] : undefined}] : [];
  }).sort((left, right) => {
    const order = Object.keys(definitions);
    const rank = (name: string) => order.includes(name) ? order.indexOf(name) : order.length;
    return rank(left.name) - rank(right.name) || left.name.localeCompare(right.name);
  });
}

export function pendingHealthMetricRow(file: HealthTimelineFile): HealthTimelineRow {
  const definition = definitions[file.name];
  return {id: file.name, name: definition?.name ?? file.name, axisLabel: definition?.axisLabel ?? `${file.name.slice(0, 4)}…`, periods: [], summary: '正在加载…'};
}

export function compactHealthMetricSummary(row: {id: string; summary: string}): string {
  const text = row.summary.split(' · ')[0].replace(/^(日汇总|日统计) /, '');
  if (!definitions[row.id]) return text;
  const integers = new Set(['step_count', 'active_energy', 'basal_energy_burned', 'heart_rate', 'resting_heart_rate',
    'walking_heart_rate_average', 'apple_exercise_time', 'apple_stand_time', 'apple_stand_hour', 'flights_climbed']);
  const decimals = integers.has(row.id) ? 0 : ['walking_running_distance', 'cycling_distance', 'apple_sleeping_wrist_temperature', 'vo2_max'].includes(row.id) ? 2 : 1;
  return text.replace(/-?\d[\d,]*(?:\.\d+)?/g, (value) => Number(value.replaceAll(',', '')).toLocaleString('zh-CN', {maximumFractionDigits: decimals}));
}

export function parseHealthMetricTimeline(date: string, file: HealthTimelineFile, payload: HealthMetricPayload): HealthTimelineRow {
  const metric = payload.metric;
  if (payload.version !== 5 || payload.date !== date || metric?.name !== file.name
    || !Array.isArray(metric.columns) || !Array.isArray(metric.rows)) throw new Error('Invalid health metric');
  const definition = definitions[file.name] ?? {name: file.name, axisLabel: `${file.name.slice(0, 4)}…`};
  const convert = !definition.inputUnit || definition.inputUnit === metric.units;
  const unit = (convert ? definition.unit : undefined) ?? units[metric.units ?? ''] ?? metric.units ?? '';
  const format = (value: number) => `${number(value)}${unit ? ` ${unit}` : ''}`;
  const column = (name: string) => metric.columns!.indexOf(name);
  const startIndex = column('startMinute');
  const dateIndex = column('dateMinute');
  const endIndex = column('endMinute');
  const valueIndex = column('qty') >= 0 ? column('qty') : column('Avg');
  if (valueIndex < 0 || (startIndex < 0 && dateIndex < 0)) throw new Error('Missing health metric columns');
  const values = metric.rows.flatMap((row) => {
    const start = row[startIndex] ?? row[dateIndex];
    const end = row[endIndex] ?? start;
    const rawValue = row[valueIndex];
    if (typeof start !== 'number' || typeof end !== 'number' || typeof rawValue !== 'number'
      || ![start, end, rawValue].every(Number.isFinite) || end < start || end < 0 || start >= 1440) return [];
    const value = rawValue * (convert ? definition.multiplier ?? 1 : 1);
    const details = [definition.name, format(value), source(row[column('sourceId')])];
    const low = row[column('Min')];
    const high = row[column('Max')];
    if (typeof low === 'number' && typeof high === 'number' && low !== high) details.push(`范围 ${format(low)}–${format(high)}`);
    if (typeof row[column('value')] === 'string') details.push(row[column('value')] as string);
    return [{start: Math.max(0, start), end: Math.min(1440, end), value,
      statistic: Boolean(definition.statistic),
      detail: [definition.statistic ? `${definition.statistic}覆盖时段` : '', ...details].filter(Boolean).join(' · ')}];
  }).sort((left, right) => left.start - right.start);
  let periods: HealthTimelinePeriod[] = values;
  const binned = (definition.total && endIndex < 0) || values.length > 600;
  if (binned) {
    const bins = new Map<number, {sum: number; count: number; min: number; max: number}>();
    for (const item of values) {
      const start = Math.floor(item.start / 5) * 5;
      const bin = bins.get(start) ?? {sum: 0, count: 0, min: Infinity, max: -Infinity};
      bin.sum += item.value;
      bin.count += 1;
      bin.min = Math.min(bin.min, item.value);
      bin.max = Math.max(bin.max, item.value);
      bins.set(start, bin);
    }
    periods = [...bins].map(([start, bin]) => {
      const value = definition.total ? bin.sum : bin.sum / bin.count;
      return {start, end: Math.min(1440, start + 5), value,
        detail: `${definition.name} · 5 分钟${definition.total ? '原始采样合计' : '采样均值'} ${format(value)} · ${bin.count.toLocaleString()} 条记录${definition.total ? '' : ` · 范围 ${format(bin.min)}–${format(bin.max)}`}`};
    });
  }
  const minimum = values.reduce((low, item) => Math.min(low, item.value), Infinity);
  const maximum = values.reduce((high, item) => Math.max(high, item.value), -Infinity);
  const dailyValue = typeof file.dailyValue === 'number' ? file.dailyValue * (convert ? definition.multiplier ?? 1 : 1) : null;
  const summary = dailyValue !== null ? `日汇总 ${format(dailyValue)}` : !values.length ? '暂无有效时间记录' : definition.total
    ? `采样合计 ${format(values.reduce((sum, item) => sum + item.value, 0))}`
    : definition.statistic && values.length === 1 ? `${definition.statistic} ${format(values[0].value)}`
    : `${format(minimum)}${minimum === maximum ? '' : `–${format(maximum)}`}`;
  const range: [number, number] = [
    periods.reduce((low, item) => Math.min(low, item.value ?? 0), Infinity),
    periods.reduce((high, item) => Math.max(high, item.value ?? 0), -Infinity),
  ];
  return {...pendingHealthMetricRow(file), periods, range,
    summary: `${summary}${values.length ? ` · ${values.length.toLocaleString()} 条${binned ? ' · 5分钟汇总' : ''}` : ''}`};
}

type IndexTimelineData = {
  standMinutes?: number;
  standPeriods?: Array<[number, number, number]>;
  workouts?: Array<{type?: string; startMinute?: number; endMinute?: number; durationMinutes?: number; distanceKm?: number; averageHeartRateBpm?: number}>;
  doses?: Array<{takenMinute?: number; scheduledMinute?: number; name?: string; displayText?: string; status?: string; dosage?: number; scheduledDosage?: number}>;
  moods?: Array<{minute?: number; detail: string}>;
};

export function healthTimelineCoverageMinutes(periods: Array<{start: number; end: number}>): number {
  let duration = 0;
  let coveredEnd = 0;
  for (const period of periods.filter(({start, end}) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .sort((left, right) => left.start - right.start)) {
    const start = Math.max(0, period.start);
    const end = Math.min(1440, period.end);
    duration += Math.max(0, end - Math.max(start, coveredEnd));
    coveredEnd = Math.max(coveredEnd, end);
  }
  return duration;
}

export function indexHealthTimelineRows(data: IndexTimelineData): HealthTimelineRow[] {
  const rows: HealthTimelineRow[] = [];
  const valid = (minute: unknown): minute is number => typeof minute === 'number' && Number.isFinite(minute) && minute >= 0 && minute < 1440;
  const add = (id: string, name: string, axisLabel: string, periods: HealthTimelinePeriod[], summary: string) => {
    if (periods.length) rows.push({id, name, axisLabel, periods: periods.sort((left, right) => left.start - right.start), summary});
  };
  const standing = (data.standPeriods ?? []).flatMap(([start, end, duration]) => valid(start) && Number.isFinite(end) && end > start && Number.isFinite(duration) && duration >= 0
    ? [{start, end: Math.min(1440, end), value: duration, detail: `时段内累计站立 ${number(duration)} 分钟`}] : []);
  const standMinutes = typeof data.standMinutes === 'number' && Number.isFinite(data.standMinutes) && data.standMinutes >= 0
    ? data.standMinutes : standing.reduce((sum, period) => sum + period.value, 0);
  add('standing-periods', '站立', '站立', standing, `${number(standMinutes)} 分钟 · ${standing.length} 个站立片段`);
  const workouts = (data.workouts ?? []).flatMap((item) => valid(item.startMinute) && typeof item.endMinute === 'number' && item.endMinute > item.startMinute
    ? [{start: item.startMinute, end: Math.min(1440, item.endMinute), detail: [item.type ?? '训练',
      typeof item.durationMinutes === 'number' ? `${number(item.durationMinutes)} 分钟` : '',
      typeof item.distanceKm === 'number' ? `${number(item.distanceKm)} 公里` : '',
      typeof item.averageHeartRateBpm === 'number' ? `平均心率 ${number(item.averageHeartRateBpm)} 次/分` : ''].filter(Boolean).join(' · ')}] : []);
  add('workouts', '训练记录', '训练', workouts, `${workouts.length} 次训练`);
  const doses = new Map<string, HealthTimelinePeriod>();
  for (const dose of data.doses ?? []) {
    const taken = valid(dose.takenMinute);
    const minute = taken ? dose.takenMinute : dose.scheduledMinute;
    if (!valid(minute)) continue;
    const key = `${taken ? 'taken' : 'planned'}-${Math.floor(minute)}`;
    const detail = [taken ? '实际记录' : '计划用药', dose.displayText ?? dose.name ?? '用药', dose.status,
      typeof dose.dosage === 'number' ? `剂量 ${number(dose.dosage)}` : '',
      valid(dose.scheduledMinute) ? `计划 ${time(dose.scheduledMinute)}` : ''].filter(Boolean).join(' · ');
    const previous = doses.get(key);
    if (previous) previous.detail += `\n${detail}`;
    else doses.set(key, {start: minute, end: minute, detail});
  }
  add('medications', '用药记录', '用药', [...doses.values()], `${data.doses?.length ?? 0} 次记录`);
  const moods = (data.moods ?? []).flatMap((item) => valid(item.minute) ? [{start: item.minute, end: item.minute, detail: item.detail}] : []);
  add('state-of-mind', '心情记录', '心情', moods, `${moods.length} 次主动记录`);
  return rows;
}
