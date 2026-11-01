// Generated from src/components/HealthCharts/transform.ts. Keep in sync when transform logic changes.
// Transforms raw Apple Health export JSON into chart-ready data.
const DAILY_STEPS_GOAL = 3000;
const DAILY_EXERCISE_GOAL = 20;
const WEIGHT_GOAL_JIN = 140;
const WORKOUT_NAME_ALIASES = {
    'Outdoor Walk': '户外步行',
    'Indoor Walk': '室内步行',
    'Rowing': '划船',
    'Badminton': '羽毛球',
    'Indoor Cycling': '室内骑行',
    'Indoor Run': '室内跑步',
    'Core Training': '核心训练',
};
function r(v, d = 2) {
    return Math.round(v * 10 ** d) / 10 ** d;
}
function localDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
function series(metrics, name, conv) {
    const m = metrics.find((x) => x.name === name);
    if (!m)
        return [];
    return m.data
        .filter((d) => typeof d.qty === 'number' && typeof d.date === 'string' && d.date.length >= 10)
        .map((d) => [d.date.slice(0, 10), r(conv ? conv(d.qty) : d.qty)]);
}
function sleep(metrics) {
    const m = metrics.find((x) => x.name === 'sleep_analysis');
    if (!m)
        return [];
    return m.data
        .filter((d) => typeof d.date === 'string' && d.date.length >= 10)
        .map((d) => [
        d.date.slice(0, 10),
        r(d.totalSleep ?? 0), r(d.deep ?? 0), r(d.rem ?? 0), r(d.core ?? 0), r(d.awake ?? 0),
    ]);
}
function workouts(ws) {
    return [...ws]
        .filter((w) => typeof w.start === 'string' && w.start.length >= 10)
        .sort((a, b) => a.start.localeCompare(b.start))
        .map((w) => [
        w.start.slice(0, 10),
        WORKOUT_NAME_ALIASES[w.name ?? ''] ?? w.name ?? '其他',
        r((w.duration ?? 0) / 60, 1),
        Math.round((w.activeEnergyBurned?.qty ?? 0) / 4.184),
        Math.round(typeof w.avgHeartRate === 'object' ? (w.avgHeartRate?.qty ?? 0) : 0),
        Math.round(w.heartRate?.min?.qty ?? 0),
        Math.round(w.heartRate?.max?.qty ?? 0),
        r(w.distance?.qty ?? 0, 2),
        Math.round((w.stepCount ?? []).reduce((s, e) => s + (e.qty ?? 0), 0)),
        Math.round(w.elevationUp?.qty ?? 0),
        w.start.slice(11, 16),
    ]);
}
function medications(meds) {
    const byDay = {};
    for (const m of meds) {
        if (typeof m.scheduledDate !== 'string' || m.scheduledDate.length < 10)
            continue;
        const date = m.scheduledDate.slice(0, 10);
        const name = (m.displayText ?? '').replace(/[^一-龥a-zA-Z]/g, '');
        if (!byDay[date])
            byDay[date] = {};
        if (!byDay[date][name])
            byDay[date][name] = [0, 0];
        byDay[date][name][1]++;
        if (m.status === '已服用')
            byDay[date][name][0]++;
    }
    const byMonth = {};
    for (const [date, drugs] of Object.entries(byDay)) {
        const mon = date.slice(0, 7);
        if (!byMonth[mon])
            byMonth[mon] = {};
        for (const [name, [t, tot]] of Object.entries(drugs)) {
            if (!byMonth[mon][name])
                byMonth[mon][name] = [0, 0];
            byMonth[mon][name][0] += t;
            byMonth[mon][name][1] += tot;
        }
    }
    const nah = Object.entries(byDay).filter(([, d]) => '碳酸氢钠片' in d)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, d]) => [date, d['碳酸氢钠片'][0], d['碳酸氢钠片'][1]]);
    const bns = Object.entries(byDay).filter(([, d]) => '苯溴马隆片' in d)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, d]) => [date, d['苯溴马隆片'][0], d['苯溴马隆片'][1]]);
    const monthly = Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)).map(([mon, drugs]) => {
        const nah_ = drugs['碳酸氢钠片'] ?? [0, 1];
        const bns_ = drugs['苯溴马隆片'] ?? [0, 1];
        return [mon, Math.round(100 * nah_[0] / nah_[1]) || 0, Math.round(100 * bns_[0] / bns_[1]) || 0];
    });
    return { nah, bns, monthly };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function transform(raw) {
    if (raw?.version === 5 && Array.isArray(raw.days))
        return transformV4(raw.days, raw.exportedAt);
    const data = raw?.data ?? {};
    const metrics = data.healthMetrics?.metrics ?? [];
    const ws = data.workouts?.workouts ?? [];
    const meds = data.medications?.medications ?? [];
    const moods = data.stateOfMind?.stateOfMind ?? [];
    const alerts = data.heartNotifications?.heartRateNotifications ?? [];
    const med = medications(meds);
    return {
        steps: series(metrics, 'step_count'),
        distance: series(metrics, 'walking_running_distance'),
        exercise: series(metrics, 'apple_exercise_time'),
        energy_active: series(metrics, 'active_energy', (v) => r(v / 4.184, 1)),
        energy_basal: series(metrics, 'basal_energy_burned', (v) => r(v / 4.184, 1)),
        flights: series(metrics, 'flights_climbed'),
        stand_time: series(metrics, 'apple_stand_time'),
        stand_hour: series(metrics, 'apple_stand_hour'),
        sleep: sleep(metrics),
        sleep_score: [],
        wrist_temp: series(metrics, 'apple_sleeping_wrist_temperature'),
        rhr: series(metrics, 'resting_heart_rate'),
        hrv: series(metrics, 'heart_rate_variability'),
        walking_hr: series(metrics, 'walking_heart_rate_average'),
        resp_rate: series(metrics, 'respiratory_rate'),
        spo2: series(metrics, 'blood_oxygen_saturation'),
        weight: series(metrics, 'weight_body_mass'),
        fat: series(metrics, 'body_fat_percentage'),
        bmi: series(metrics, 'body_mass_index'),
        lean: series(metrics, 'lean_body_mass'),
        walk_speed: series(metrics, 'walking_speed'),
        step_length: series(metrics, 'walking_step_length'),
        asym: series(metrics, 'walking_asymmetry_percentage'),
        double_supp: series(metrics, 'walking_double_support_percentage'),
        stair_up: series(metrics, 'stair_speed_up'),
        stair_down: series(metrics, 'stair_speed_down'),
        six_min_walk: series(metrics, 'six_minute_walking_test_distance'),
        audio_env: series(metrics, 'environmental_audio_exposure'),
        audio_hp: series(metrics, 'headphone_audio_exposure'),
        daylight: series(metrics, 'time_in_daylight'),
        mindful: series(metrics, 'mindful_minutes'),
        handwash: series(metrics, 'handwashing'),
        physical_effort: series(metrics, 'physical_effort'),
        cardio_recovery: series(metrics, 'cardio_recovery'),
        vo2: series(metrics, 'vo2_max'),
        workouts: workouts(ws),
        nah_daily: med.nah,
        bns_daily: med.bns,
        med_monthly: med.monthly,
        state_of_mind: moods
            .filter((s) => typeof s.start === 'string' && s.start.length >= 10 && typeof s.valence === 'number')
            .sort((a, b) => a.start.localeCompare(b.start))
            .map((s) => [
            s.start.slice(0, 10),
            r(s.valence, 3),
            s.kind === 'daily_mood' ? 'daily' : 'emotion',
            (s.labels ?? []).join(','),
            (s.associations ?? []).join(','),
        ]),
        hr_notifications: alerts
            .filter((n) => typeof n.start === 'string' && n.start.length >= 10)
            .map((n) => [n.start.slice(0, 10), n.threshold]),
        lastUpdated: raw.exportedAt ?? null,
    };
}
function transformV4(days, exportedAt) {
    const scalar = (read, convert) => days.flatMap((day) => {
        const value = read(day);
        return typeof value === 'number' && Number.isFinite(value) ? [[day.date, r(convert ? convert(value) : value)]] : [];
    });
    const doses = days.flatMap((day) => (day.medications?.doses ?? []).map((dose) => ({ day, dose })));
    const medicationSeries = (name) => days.flatMap((day) => {
        const records = (day.medications?.doses ?? []).filter((dose) => dose.name === name);
        return records.length ? [[day.date, records.filter((dose) => dose.status === '已服用').length, records.length]] : [];
    });
    const medicationMonths = new Map();
    for (const { day, dose } of doses) {
        const month = day.date.slice(0, 7);
        const totals = medicationMonths.get(month) ?? { nah: [0, 0], bns: [0, 0] };
        const target = dose.name === '碳酸氢钠片' ? totals.nah : dose.name === '苯溴马隆片' ? totals.bns : null;
        if (target) {
            target[1] += 1;
            if (dose.status === '已服用')
                target[0] += 1;
        }
        medicationMonths.set(month, totals);
    }
    return {
        steps: scalar((day) => day.activity?.steps),
        distance: scalar((day) => day.activity?.distanceKm),
        exercise: scalar((day) => day.activity?.exerciseMinutes),
        energy_active: scalar((day) => day.activity?.activeEnergyKJ, (value) => value / 4.184),
        energy_basal: scalar((day) => day.activity?.restingEnergyKJ, (value) => value / 4.184),
        flights: scalar((day) => day.activity?.flightsClimbed),
        stand_time: scalar((day) => day.activity?.standMinutes),
        stand_hour: scalar((day) => day.activity?.standHours),
        sleep: days.flatMap((day) => day.sleep?.totalMinutes === undefined ? [] : [[day.date, r(day.sleep.totalMinutes / 60), r((day.sleep.deepMinutes ?? 0) / 60), r((day.sleep.remMinutes ?? 0) / 60), r((day.sleep.coreMinutes ?? 0) / 60), r((day.sleep.awakeMinutes ?? 0) / 60)]]),
        sleep_score: [],
        wrist_temp: scalar((day) => day.vitalSigns?.wristTemperatureCelsius),
        rhr: scalar((day) => day.heart?.restingHeartRateBpm),
        hrv: scalar((day) => day.heart?.hrv?.dailyMs),
        walking_hr: scalar((day) => day.heart?.walkingHeartRateBpm),
        resp_rate: scalar((day) => day.respiratory?.respiratoryRatePerMinute),
        spo2: scalar((day) => day.respiratory?.bloodOxygenFraction, (value) => value * 100),
        weight: scalar((day) => day.bodyMeasurements?.weight?.dailyKg),
        fat: scalar((day) => day.bodyMeasurements?.bodyFatFraction, (value) => value * 100),
        bmi: scalar((day) => day.bodyMeasurements?.bodyMassIndex),
        lean: scalar((day) => day.bodyMeasurements?.leanBodyMassKg),
        walk_speed: scalar((day) => day.activityCapability?.walkingSpeedMps),
        step_length: scalar((day) => day.activityCapability?.walkingStepLengthM),
        asym: scalar((day) => day.activityCapability?.walkingAsymmetryPercent),
        double_supp: scalar((day) => day.activityCapability?.walkingDoubleSupportPercent),
        stair_up: scalar((day) => day.activityCapability?.stairAscentSpeedMps),
        stair_down: scalar((day) => day.activityCapability?.stairDescentSpeedMps),
        six_min_walk: scalar((day) => day.activityCapability?.sixMinuteWalkDistanceM),
        audio_env: scalar((day) => day.hearing?.environmentalAudioExposureDbASPL),
        audio_hp: scalar((day) => day.hearing?.headphoneAudioExposureDbASPL),
        daylight: scalar((day) => day.activity?.daylightMinutes),
        mindful: scalar((day) => day.mindfulness?.minutes),
        handwash: scalar((day) => day.activity?.handwashingSeconds),
        physical_effort: scalar((day) => day.activity?.physicalEffortKcalPerHourKg),
        cardio_recovery: scalar((day) => day.heart?.cardioRecoveryBpm),
        vo2: scalar((day) => day.activity?.vo2MaxMlKgMin),
        workouts: days.flatMap((day) => (day.activity?.workouts ?? []).map((workout) => [
            day.date, WORKOUT_NAME_ALIASES[workout.type ?? ''] ?? workout.type ?? '其他', r(workout.durationMinutes ?? 0, 1),
            Math.round((workout.activeEnergyKJ ?? 0) / 4.184), Math.round(workout.averageHeartRateBpm ?? 0), 0,
            Math.round(workout.maximumHeartRateBpm ?? 0), r(workout.distanceKm ?? 0, 2), Math.round(workout.steps ?? 0), 0,
            minuteLabel(workout.startMinute),
        ])),
        nah_daily: medicationSeries('碳酸氢钠片'),
        bns_daily: medicationSeries('苯溴马隆片'),
        med_monthly: [...medicationMonths.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, value]) => [month, value.nah[1] ? Math.round(value.nah[0] / value.nah[1] * 100) : 0, value.bns[1] ? Math.round(value.bns[0] / value.bns[1] * 100) : 0]),
        state_of_mind: days.flatMap((day) => (day.mindfulness?.stateOfMindEntries ?? []).map((entry) => [day.date, r(entry.valence ?? 0, 3), entry.kind === 'daily_mood' ? 'daily' : 'emotion', (entry.labels ?? []).join(','), (entry.associations ?? []).join(',')])),
        hr_notifications: days.flatMap((day) => (day.heart?.notifications ?? []).flatMap((item) => typeof item.threshold === 'number' ? [[day.date, item.threshold]] : [])),
        lastUpdated: exportedAt ?? days.map((day) => day.exportedAt).filter(Boolean).sort().at(-1) ?? null,
    };
}
function minuteLabel(value) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return '';
    const minute = Math.max(0, Math.round(value));
    return `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}
function avg(arr) {
    if (!arr.length)
        return 0;
    return arr.reduce((s, [, v]) => s + v, 0) / arr.length;
}
function st(val, goodThresh, warnThresh, dir = 'gte') {
    if (!val)
        return 'neutral';
    if (dir === 'gte')
        return val >= goodThresh ? 'good' : val >= warnThresh ? 'warn' : 'bad';
    return val <= goodThresh ? 'good' : val <= warnThresh ? 'warn' : 'bad';
}
export function computeStats(D) {
    const sleepAvg = D.sleep.length ? D.sleep.reduce((s, [, v]) => s + v, 0) / D.sleep.length : 0;
    const weightJin = avg(D.weight) * 2;
    const rhrAvg = avg(D.rhr);
    const hrvAvg = avg(D.hrv);
    const spo2Avg = avg(D.spo2);
    const exerciseAvg = avg(D.exercise);
    const stepsAvg = avg(D.steps);
    const fatAvg = avg(D.fat);
    const sleepSt = !sleepAvg ? 'neutral' : sleepAvg >= 7 && sleepAvg <= 9 ? 'good' : sleepAvg >= 6 ? 'warn' : 'bad';
    return [
        { v: D.steps.length ? Math.round(stepsAvg).toLocaleString() : '—', l: '日均步数', status: st(stepsAvg, DAILY_STEPS_GOAL, DAILY_STEPS_GOAL * 0.7) },
        { v: D.sleep.length ? `${sleepAvg.toFixed(1)}h` : '—', l: '日均睡眠', status: sleepSt },
        { v: D.rhr.length ? Math.round(rhrAvg).toString() : '—', l: '静息心率 bpm', status: st(rhrAvg, 0, 0) === 'neutral' ? 'neutral' : rhrAvg <= 60 ? 'good' : rhrAvg <= 75 ? 'warn' : 'bad' },
        { v: D.hrv.length ? `${hrvAvg.toFixed(1)}ms` : '—', l: '心率变异性 HRV', status: st(hrvAvg, 50, 30) },
        { v: D.weight.length ? `${weightJin.toFixed(1)}斤` : '—', l: '平均体重', status: 'neutral' },
        { v: D.fat.length ? `${fatAvg.toFixed(1)}%` : '—', l: '平均体脂率', status: st(fatAvg, 0, 0) === 'neutral' ? 'neutral' : fatAvg <= 20 ? 'good' : fatAvg <= 25 ? 'warn' : 'bad' },
        { v: D.spo2.length ? `${spo2Avg.toFixed(1)}%` : '—', l: '平均血氧', status: st(spo2Avg, 97, 95) },
        { v: D.exercise.length ? `${Math.round(exerciseAvg)}min` : '—', l: '日均运动时长', status: st(exerciseAvg, DAILY_EXERCISE_GOAL, DAILY_EXERCISE_GOAL * 0.7) },
    ];
}
export function getDateRange(D) {
    const ref = (D.steps.length ? D.steps : D.rhr);
    if (!ref.length)
        return null;
    const start = ref[0][0];
    const end = ref[ref.length - 1][0];
    if (start.slice(0, 4) === end.slice(0, 4)) {
        return `${start.slice(0, 4)} · ${start.slice(5)} ~ ${end.slice(5)}`;
    }
    return `${start.slice(0, 7)} ~ ${end.slice(0, 7)}`;
}
function lastRecent(arr, days, conv) {
    if (arr.length < 2)
        return null;
    const latest = arr[arr.length - 1][0];
    const cutoff = new Date(latest);
    cutoff.setDate(cutoff.getDate() - days);
    const cs = cutoff.toISOString().slice(0, 10);
    const older = [...arr].reverse().find(([d]) => d <= cs);
    if (!older)
        return null;
    return conv ? conv(older[1]) : older[1];
}
export function computeDashboard(D) {
    const cards = [];
    function addCard(data, label, unit, rangeLabel, goodMin, goodMax, warnMin, warnMax, higherBetter, fmtVal, fmtMag, conv, changeThreshold) {
        if (!data.length)
            return;
        const rawLatest = data[data.length - 1][1];
        const val = conv ? conv(rawLatest) : rawLatest;
        const status = val >= goodMin && val <= goodMax ? 'good' :
            val >= warnMin && val <= warnMax ? 'warn' : 'bad';
        const old7 = lastRecent(data, 7, conv);
        const delta = old7 !== null ? r(val - old7, 2) : null;
        const threshold = changeThreshold ?? Math.max((goodMax - goodMin) * 0.02, 0.1);
        const changeDir = delta === null || Math.abs(delta) < threshold ? 'flat' : delta > 0 ? 'up' : 'down';
        let changeGood = null;
        if (changeDir !== 'flat' && delta !== null) {
            if (val < goodMin)
                changeGood = delta > 0;
            else if (val > goodMax)
                changeGood = delta < 0;
            else
                changeGood = higherBetter ? delta > 0 : delta < 0;
        }
        cards.push({
            label, value: fmtVal(val), unit, rangeLabel, rangeStatus: status,
            change7d: changeDir !== 'flat' && delta !== null ? fmtMag(Math.abs(delta)) : '—',
            changeDir, changeGood,
            sparkline: data.slice(Math.max(0, data.length - 30)).map(([, v]) => conv ? conv(v) : v),
            sparklineDates: data.slice(Math.max(0, data.length - 30)).map(([d]) => d),
            rangeMin: goodMin,
            rangeMax: goodMax,
        });
    }
    addCard(D.weight, '体重', '斤', `目标 ${WEIGHT_GOAL_JIN}斤`, WEIGHT_GOAL_JIN - 2, WEIGHT_GOAL_JIN + 2, WEIGHT_GOAL_JIN - 5, WEIGHT_GOAL_JIN + 5, false, (v) => v.toFixed(1), (m) => `${m.toFixed(1)}斤`, (v) => r(v * 2, 1));
    addCard(D.bmi, 'BMI', '', '正常区间 18.5~23.9', 18.5, 23.9, 17.5, 25, false, (v) => v.toFixed(1), (m) => m.toFixed(2), undefined, 0.05);
    addCard(D.fat, '体脂率', '%', '理想区间 10~20%', 10, 20, 8, 25, false, (v) => v.toFixed(1), (m) => `${m.toFixed(1)}%`);
    addCard(D.rhr, '静息心率', 'bpm', '理想区间 50~70', 50, 70, 45, 80, false, (v) => String(Math.round(v)), (m) => `${Math.round(m)}bpm`);
    const sleepSeries = D.sleep.map(([d, total]) => [d, total]);
    addCard(sleepSeries, '睡眠', 'h', '理想区间 7~9h', 7, 9, 6, 10, true, (v) => v.toFixed(1), (m) => `${m.toFixed(1)}h`);
    addCard(D.hrv, 'HRV', 'ms', '理想区间 40~80ms', 40, 80, 25, 100, true, (v) => String(Math.round(v)), (m) => `${Math.round(m)}ms`);
    return cards;
}
export function filterByTimeRange(D, days) {
    const latestDate = localDateKey(new Date());
    const cutoff = new Date(`${latestDate}T00:00:00`);
    cutoff.setDate(cutoff.getDate() - days + 1);
    const cs = localDateKey(cutoff);
    const f = (arr) => arr.filter(([d]) => d >= cs && d <= latestDate);
    return {
        steps: f(D.steps), distance: f(D.distance), exercise: f(D.exercise),
        energy_active: f(D.energy_active), energy_basal: f(D.energy_basal),
        flights: f(D.flights), stand_time: f(D.stand_time), stand_hour: f(D.stand_hour),
        sleep: D.sleep.filter(([d]) => d >= cs), sleep_score: D.sleep_score.filter(([d]) => d >= cs && d <= latestDate),
        wrist_temp: f(D.wrist_temp), rhr: f(D.rhr), hrv: f(D.hrv),
        walking_hr: f(D.walking_hr), resp_rate: f(D.resp_rate), spo2: f(D.spo2),
        weight: f(D.weight), fat: f(D.fat), bmi: f(D.bmi), lean: f(D.lean),
        walk_speed: f(D.walk_speed), step_length: f(D.step_length),
        asym: f(D.asym), double_supp: f(D.double_supp),
        stair_up: f(D.stair_up), stair_down: f(D.stair_down),
        six_min_walk: f(D.six_min_walk), audio_env: f(D.audio_env),
        audio_hp: f(D.audio_hp), daylight: f(D.daylight), mindful: f(D.mindful),
        handwash: f(D.handwash), physical_effort: f(D.physical_effort),
        cardio_recovery: f(D.cardio_recovery), vo2: f(D.vo2),
        workouts: D.workouts.filter(([d]) => d >= cs && d <= latestDate),
        nah_daily: D.nah_daily.filter(([d]) => d >= cs && d <= latestDate),
        bns_daily: D.bns_daily.filter(([d]) => d >= cs && d <= latestDate),
        med_monthly: D.med_monthly.filter(([d]) => d >= cs && d <= latestDate),
        state_of_mind: D.state_of_mind.filter(([d]) => d >= cs && d <= latestDate),
        hr_notifications: D.hr_notifications.filter(([d]) => d >= cs && d <= latestDate),
        lastUpdated: D.lastUpdated,
    };
}
