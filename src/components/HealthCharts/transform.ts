// Transforms raw Apple Health export JSON into chart-ready data.

type RawEntry = {qty?: number; date: string};
type SleepEntry = {date: string; totalSleep?: number; deep?: number; rem?: number; core?: number; awake?: number};
type RawMetric = {name: string; data: (RawEntry | SleepEntry)[]};
type RawWorkout = {name?: string; start: string; duration?: number; activeEnergyBurned?: {qty?: number}; avgHeartRate?: {qty?: number} | number};
type RawMed = {scheduledDate: string; displayText?: string; status?: string};
type RawMood = {start: string; valence: number; kind: string; valenceClassification: string; labels?: string[]; associations?: string[]};
type RawHeartAlert = {start: string; threshold: number};

export type HealthData = {
  steps: [string, number][];
  distance: [string, number][];
  exercise: [string, number][];
  energy_active: [string, number][];
  energy_basal: [string, number][];
  flights: [string, number][];
  stand_time: [string, number][];
  stand_hour: [string, number][];
  sleep: [string, number, number, number, number, number][];
  wrist_temp: [string, number][];
  rhr: [string, number][];
  hrv: [string, number][];
  walking_hr: [string, number][];
  resp_rate: [string, number][];
  spo2: [string, number][];
  weight: [string, number][];
  fat: [string, number][];
  bmi: [string, number][];
  lean: [string, number][];
  walk_speed: [string, number][];
  step_length: [string, number][];
  asym: [string, number][];
  double_supp: [string, number][];
  stair_up: [string, number][];
  stair_down: [string, number][];
  six_min_walk: [string, number][];
  audio_env: [string, number][];
  audio_hp: [string, number][];
  daylight: [string, number][];
  mindful: [string, number][];
  handwash: [string, number][];
  physical_effort: [string, number][];
  cardio_recovery: [string, number][];
  vo2: [string, number][];
  workouts: [string, string, number, number, number][];
  nah_daily: [string, number, number][];
  bns_daily: [string, number, number][];
  med_monthly: [string, number, number][];
  state_of_mind: [string, number, string, string, string][];
  hr_notifications: [string, number][];
};

function r(v: number, d = 2) {
  return Math.round(v * 10 ** d) / 10 ** d;
}

function series(metrics: RawMetric[], name: string, conv?: (v: number) => number): [string, number][] {
  const m = metrics.find((x) => x.name === name);
  if (!m) return [];
  return (m.data as RawEntry[])
    .filter((d) => typeof d.qty === 'number')
    .map((d) => [d.date.slice(0, 10), r(conv ? conv(d.qty!) : d.qty!)]);
}

function sleep(metrics: RawMetric[]): [string, number, number, number, number, number][] {
  const m = metrics.find((x) => x.name === 'sleep_analysis');
  if (!m) return [];
  return (m.data as SleepEntry[]).map((d) => [
    d.date.slice(0, 10),
    r(d.totalSleep ?? 0), r(d.deep ?? 0), r(d.rem ?? 0), r(d.core ?? 0), r(d.awake ?? 0),
  ]);
}

function workouts(ws: RawWorkout[]): [string, string, number, number, number][] {
  return [...ws]
    .sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''))
    .map((w) => [
      (w.start ?? '').slice(0, 10),
      w.name ?? '其他',
      r(((w.duration ?? 0)) / 60, 1),
      Math.round((w.activeEnergyBurned?.qty ?? 0) / 4.184),
      Math.round(typeof w.avgHeartRate === 'object' ? (w.avgHeartRate?.qty ?? 0) : 0),
    ]);
}

function medications(meds: RawMed[]): {nah: [string, number, number][]; bns: [string, number, number][]; monthly: [string, number, number][]} {
  const byDay: Record<string, Record<string, [number, number]>> = {};
  for (const m of meds) {
    const date = (m.scheduledDate ?? '').slice(0, 10);
    const name = (m.displayText ?? '').replace(/[^一-龥a-zA-Z]/g, '');
    if (!byDay[date]) byDay[date] = {};
    if (!byDay[date][name]) byDay[date][name] = [0, 0];
    byDay[date][name][1]++;
    if (m.status === '已服用') byDay[date][name][0]++;
  }
  const byMonth: Record<string, Record<string, [number, number]>> = {};
  for (const [date, drugs] of Object.entries(byDay)) {
    const mon = date.slice(0, 7);
    if (!byMonth[mon]) byMonth[mon] = {};
    for (const [name, [t, tot]] of Object.entries(drugs)) {
      if (!byMonth[mon][name]) byMonth[mon][name] = [0, 0];
      byMonth[mon][name][0] += t;
      byMonth[mon][name][1] += tot;
    }
  }
  const nah = Object.entries(byDay).filter(([, d]) => '碳酸氢钠片' in d)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => [date, d['碳酸氢钠片'][0], d['碳酸氢钠片'][1]] as [string, number, number]);
  const bns = Object.entries(byDay).filter(([, d]) => '苯溴马隆片' in d)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => [date, d['苯溴马隆片'][0], d['苯溴马隆片'][1]] as [string, number, number]);
  const monthly = Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)).map(([mon, drugs]) => {
    const nah_ = drugs['碳酸氢钠片'] ?? [0, 1];
    const bns_ = drugs['苯溴马隆片'] ?? [0, 1];
    return [mon, Math.round(100 * nah_[0] / nah_[1]) || 0, Math.round(100 * bns_[0] / bns_[1]) || 0] as [string, number, number];
  });
  return {nah, bns, monthly};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function transform(raw: any): HealthData {
  const data = raw?.data ?? {};
  const metrics: RawMetric[] = data.healthMetrics?.metrics ?? [];
  const ws: RawWorkout[] = data.workouts?.workouts ?? [];
  const meds: RawMed[] = data.medications?.medications ?? [];
  const moods: RawMood[] = data.stateOfMind?.stateOfMind ?? [];
  const alerts: RawHeartAlert[] = data.heartNotifications?.heartRateNotifications ?? [];

  const med = medications(meds);

  return {
    steps:          series(metrics, 'step_count'),
    distance:       series(metrics, 'walking_running_distance'),
    exercise:       series(metrics, 'apple_exercise_time'),
    energy_active:  series(metrics, 'active_energy', (v) => r(v / 4.184, 1)),
    energy_basal:   series(metrics, 'basal_energy_burned', (v) => r(v / 4.184, 1)),
    flights:        series(metrics, 'flights_climbed'),
    stand_time:     series(metrics, 'apple_stand_time'),
    stand_hour:     series(metrics, 'apple_stand_hour'),
    sleep:          sleep(metrics),
    wrist_temp:     series(metrics, 'apple_sleeping_wrist_temperature'),
    rhr:            series(metrics, 'resting_heart_rate'),
    hrv:            series(metrics, 'heart_rate_variability'),
    walking_hr:     series(metrics, 'walking_heart_rate_average'),
    resp_rate:      series(metrics, 'respiratory_rate'),
    spo2:           series(metrics, 'blood_oxygen_saturation'),
    weight:         series(metrics, 'weight_body_mass'),
    fat:            series(metrics, 'body_fat_percentage'),
    bmi:            series(metrics, 'body_mass_index'),
    lean:           series(metrics, 'lean_body_mass'),
    walk_speed:     series(metrics, 'walking_speed'),
    step_length:    series(metrics, 'walking_step_length'),
    asym:           series(metrics, 'walking_asymmetry_percentage'),
    double_supp:    series(metrics, 'walking_double_support_percentage'),
    stair_up:       series(metrics, 'stair_speed_up'),
    stair_down:     series(metrics, 'stair_speed_down'),
    six_min_walk:   series(metrics, 'six_minute_walking_test_distance'),
    audio_env:      series(metrics, 'environmental_audio_exposure'),
    audio_hp:       series(metrics, 'headphone_audio_exposure'),
    daylight:       series(metrics, 'time_in_daylight'),
    mindful:        series(metrics, 'mindful_minutes'),
    handwash:       series(metrics, 'handwashing'),
    physical_effort:series(metrics, 'physical_effort'),
    cardio_recovery:series(metrics, 'cardio_recovery'),
    vo2:            series(metrics, 'vo2_max'),
    workouts:       workouts(ws),
    nah_daily:      med.nah,
    bns_daily:      med.bns,
    med_monthly:    med.monthly,
    state_of_mind:  moods
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((s) => [
        s.start.slice(0, 10),
        r(s.valence, 3),
        s.kind === 'daily_mood' ? 'daily' : 'emotion',
        (s.labels ?? []).join(','),
        (s.associations ?? []).join(','),
      ]),
    hr_notifications: alerts.map((n) => [n.start.slice(0, 10), n.threshold]),
  };
}

function avg(arr: [string, number][]): number {
  if (!arr.length) return 0;
  return arr.reduce((s, [, v]) => s + v, 0) / arr.length;
}

export type StatStatus = 'good' | 'warn' | 'bad' | 'neutral';

function st(val: number, goodThresh: number, warnThresh: number, dir: 'gte' | 'lte' = 'gte'): StatStatus {
  if (!val) return 'neutral';
  if (dir === 'gte') return val >= goodThresh ? 'good' : val >= warnThresh ? 'warn' : 'bad';
  return val <= goodThresh ? 'good' : val <= warnThresh ? 'warn' : 'bad';
}

export function computeStats(D: HealthData): {v: string; l: string; status: StatStatus}[] {
  const sleepAvg = D.sleep.length ? D.sleep.reduce((s, [, v]) => s + v, 0) / D.sleep.length : 0;
  const weightJin = avg(D.weight) * 2;
  const rhrAvg = avg(D.rhr);
  const hrvAvg = avg(D.hrv);
  const spo2Avg = avg(D.spo2);
  const exerciseAvg = avg(D.exercise);
  const stepsAvg = avg(D.steps);
  const fatAvg = avg(D.fat);
  const sleepSt: StatStatus = !sleepAvg ? 'neutral' : sleepAvg >= 7 && sleepAvg <= 9 ? 'good' : sleepAvg >= 6 ? 'warn' : 'bad';
  return [
    {v: D.steps.length ? Math.round(stepsAvg).toLocaleString() : '—', l: '日均步数', status: st(stepsAvg, 8000, 5000)},
    {v: D.sleep.length ? `${sleepAvg.toFixed(1)}h` : '—', l: '日均睡眠', status: sleepSt},
    {v: D.rhr.length ? Math.round(rhrAvg).toString() : '—', l: '静息心率 bpm', status: st(rhrAvg, 0, 0) === 'neutral' ? 'neutral' : rhrAvg <= 60 ? 'good' : rhrAvg <= 75 ? 'warn' : 'bad'},
    {v: D.hrv.length ? `${hrvAvg.toFixed(1)}ms` : '—', l: '心率变异性 HRV', status: st(hrvAvg, 50, 30)},
    {v: D.weight.length ? `${weightJin.toFixed(1)}斤` : '—', l: '平均体重', status: 'neutral'},
    {v: D.fat.length ? `${fatAvg.toFixed(1)}%` : '—', l: '平均体脂率', status: st(fatAvg, 0, 0) === 'neutral' ? 'neutral' : fatAvg <= 20 ? 'good' : fatAvg <= 25 ? 'warn' : 'bad'},
    {v: D.spo2.length ? `${spo2Avg.toFixed(1)}%` : '—', l: '平均血氧', status: st(spo2Avg, 97, 95)},
    {v: D.exercise.length ? `${Math.round(exerciseAvg)}min` : '—', l: '日均运动时长', status: st(exerciseAvg, 30, 15)},
  ];
}

export function getDateRange(D: HealthData): string | null {
  const ref = (D.steps.length ? D.steps : D.rhr) as [string, number][];
  if (!ref.length) return null;
  const start = ref[0][0];
  const end = ref[ref.length - 1][0];
  if (start.slice(0, 4) === end.slice(0, 4)) {
    return `${start.slice(0, 4)} · ${start.slice(5)} ~ ${end.slice(5)}`;
  }
  return `${start.slice(0, 7)} ~ ${end.slice(0, 7)}`;
}
