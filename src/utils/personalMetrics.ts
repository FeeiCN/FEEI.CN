export type ManualMetricPoint = {
  value: number;
  source: string;
};

type ManualMetricYear = {
  version: number;
  metric: string;
  unit: string;
  provenance: string;
  range: {start: string; end: string};
  values: Record<string, ManualMetricPoint>;
};

export type WeightSnapshot = {
  date: string;
  kg: number;
  source: string;
  change30dKg?: number;
  baselineDate?: string;
};

const weightYearCache = new Map<string, Promise<ManualMetricYear | null>>();

function dateOffset(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
}

export function loadManualWeightYear(year: string): Promise<ManualMetricYear | null> {
  const cached = weightYearCache.get(year);
  if (cached) return cached;

  const request = fetch(`/data/manual/health/weight/${year}.json`, {cache: 'force-cache'})
    .then(async (response) => {
      if (!response.ok) return null;
      const payload = await response.json() as ManualMetricYear;
      return payload?.metric === 'weight' && payload?.unit === 'kg' ? payload : null;
    })
    .catch(() => null);

  weightYearCache.set(year, request);
  return request;
}

function latestPointOnOrBefore(
  values: Record<string, ManualMetricPoint>,
  targetDate: string,
  maxAgeDays: number,
): {date: string; point: ManualMetricPoint} | null {
  const date = Object.keys(values)
    .filter((key) => key <= targetDate && daysBetween(key, targetDate) <= maxAgeDays)
    .sort()
    .at(-1);
  return date ? {date, point: values[date]} : null;
}

export async function loadWeightSnapshot(date: string): Promise<WeightSnapshot | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const year = date.slice(0, 4);
  const currentYear = await loadManualWeightYear(year);
  const current = currentYear?.values?.[date];
  if (!current) return null;

  const targetBaselineDate = dateOffset(date, -30);
  const baselineYear = targetBaselineDate.slice(0, 4);
  const baselinePayload = baselineYear === year
    ? currentYear
    : await loadManualWeightYear(baselineYear);
  const baseline = baselinePayload
    ? latestPointOnOrBefore(baselinePayload.values, targetBaselineDate, 14)
    : null;

  return {
    date,
    kg: current.value,
    source: current.source,
    ...(baseline ? {
      change30dKg: Number((current.value - baseline.point.value).toFixed(2)),
      baselineDate: baseline.date,
    } : {}),
  };
}
