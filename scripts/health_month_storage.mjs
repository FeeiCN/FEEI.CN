import fs from 'node:fs';
import path from 'node:path';

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function recordMonth(record) {
  const value = record.date ?? record.start ?? record.end;
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-\d{2}/.test(value)) {
    throw new Error('Health record is missing a valid date');
  }
  return value.slice(0, 7);
}

export function selectMonth(data, month) {
  return Object.fromEntries(Object.entries(data).map(([section, collection]) => [section,
    Object.fromEntries(Object.entries(collection).map(([key, records]) => {
      if (!Array.isArray(records)) return [key, records];
      if (section === 'healthMetrics' && key === 'metrics') {
        return [key, records.map((metric) => ({
          ...metric, data: metric.data.filter((point) => recordMonth(point) === month),
        })).filter((metric) => metric.data.length)];
      }
      return [key, records.filter((record) => recordMonth(record) === month)];
    })),
  ]));
}

export function mergeMetrics(existing, incoming) {
  const groups = new Map();
  for (const metric of [...existing, ...incoming]) {
    const {data, ...metadata} = metric;
    const key = canonical(metadata);
    if (!groups.has(key)) groups.set(key, {...metadata, data: [], seen: new Set()});
    const group = groups.get(key);
    for (const point of data) {
      const signature = canonical(point);
      if (!group.seen.has(signature)) {
        group.seen.add(signature);
        group.data.push(point);
      }
    }
  }
  return [...groups.values()].map(({seen, ...metric}) => ({
    ...metric, data: metric.data.sort((a, b) => a.date.localeCompare(b.date)),
  }));
}

export function mergeMonthData(existing, incoming) {
  const result = structuredClone(existing);
  for (const [section, collection] of Object.entries(incoming)) {
    result[section] ??= {};
    for (const [key, records] of Object.entries(collection)) {
      const previous = result[section][key] ?? [];
      if (section === 'healthMetrics' && key === 'metrics') {
        result[section][key] = mergeMetrics(previous, records);
      } else if (Array.isArray(records)) {
        const combined = compactMonthlyDetails({data: {[section]: {[key]: [...previous, ...records]}}}).data[section][key];
        result[section][key] = [...new Map(combined.map((record) => [canonical(record), record])).values()];
      } else {
        result[section][key] = records;
      }
    }
  }
  return result;
}

export function monthlyPayload(raw, month) {
  const [year, number] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return {...raw, dateRange: {
    start: `${month}-01 00:00:00 +0800`,
    end: `${month}-${last} 23:59:59 +0800`,
  }, data: selectMonth(raw.data, month)};
}

export function writeHealthJson(file, payload) {
  const content = `${JSON.stringify(payload)}\n`;
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return false;
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, content);
  return true;
}

const workoutSampleFields = [
  'heartRateData', 'heartRateRecovery', 'activeEnergy', 'basalEnergy',
  'walkingAndRunningDistance', 'cyclingDistance', 'swimStroke', 'swimDistance',
];

export function compactMonthlyDetails(raw) {
  const payload = structuredClone(raw);
  const workouts = payload.data.workouts?.workouts;
  for (const workout of workouts ?? []) {
    for (const field of workoutSampleFields) {
      if (Object.hasOwn(workout, field)) {
        delete workout[field];
      }
    }
    if (Array.isArray(workout.stepCount) && workout.stepCount.length && (
      workout.stepCount.length > 1 || Object.keys(workout.stepCount[0]).some((key) => key !== 'qty')
    )) {
      const total = workout.stepCount.reduce((sum, point) => sum + (point.qty ?? 0), 0);
      if (!Number.isFinite(total)) throw new Error('Invalid workout step count');
      workout.stepCount = [{qty: total}];
    }
  }
  for (const record of payload.data.ecg?.ecg ?? []) {
    if (Object.hasOwn(record, 'voltageMeasurements')) {
      delete record.voltageMeasurements;
    }
  }
  return payload;
}

export function writeMonthlyHealth(file, raw) {
  return writeHealthJson(file, compactMonthlyDetails(raw));
}
