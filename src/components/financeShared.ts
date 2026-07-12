export type FinanceTimeScope =
  | {mode: 'recent'; range: '7d' | '30d' | '90d' | '1y'}
  | {mode: 'year'; year: number}
  | {mode: 'period'; start: string; end: string; label?: string}
  | {mode: 'all'};

export type FinanceRecentRange = Extract<FinanceTimeScope, {mode: 'recent'}>['range'];

const RANGE_DAYS: Record<FinanceRecentRange, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '1y': 365,
};
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const jsonRequestCache = new Map<string, Promise<unknown>>();

function shiftDateKey(date: string, days: number): string | null {
  const match = date.match(DATE_KEY_PATTERN);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Date keys represent Beijing calendar days; UTC methods keep the arithmetic independent of browser time zone.
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function isDateKey(date: string): boolean {
  return shiftDateKey(date, 0) === date;
}

export function latestDateKey<T>(items: T[], getDate: (item: T) => string): string | null {
  return items
    .map(getDate)
    .filter(isDateKey)
    .sort()
    .at(-1) ?? null;
}

export function getInclusiveRangeStart(endDate: string, range: FinanceRecentRange): string | null {
  return shiftDateKey(endDate, -(RANGE_DAYS[range] - 1));
}

export function filterByFinanceTimeScope<T>(
  items: T[],
  getDate: (item: T) => string,
  scope?: FinanceTimeScope,
  endDate?: string | null,
): T[] {
  if (scope?.mode === 'all') return items;

  if (scope?.mode === 'period') {
    if (!isDateKey(scope.start) || !isDateKey(scope.end) || scope.start > scope.end) return [];
    return items.filter((item) => {
      const itemDate = getDate(item);
      return isDateKey(itemDate) && itemDate >= scope.start && itemDate <= scope.end;
    });
  }

  const validEndDate = endDate && isDateKey(endDate) ? endDate : null;
  const cappedItems = validEndDate
    ? items.filter((item) => {
        const itemDate = getDate(item);
        return isDateKey(itemDate) && itemDate <= validEndDate;
      })
    : items;

  if (!scope) return cappedItems;
  if (scope.mode === 'year') {
    return cappedItems.filter((item) => getDate(item).startsWith(`${scope.year}-`));
  }

  const rangeEnd = validEndDate ?? latestDateKey(cappedItems, getDate);
  if (!rangeEnd) return [];
  const rangeStart = getInclusiveRangeStart(rangeEnd, scope.range);
  if (!rangeStart) return [];
  return cappedItems.filter((item) => {
    const itemDate = getDate(item);
    return isDateKey(itemDate) && itemDate >= rangeStart && itemDate <= rangeEnd;
  });
}

export function fetchJsonCached<T>(path: string): Promise<T> {
  const cached = jsonRequestCache.get(path);
  if (cached) return cached as Promise<T>;

  const request = fetch(path, {cache: 'no-store'})
    .then(async (response) => {
      if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
      return await response.json() as T;
    })
    .catch((error: unknown) => {
      if (jsonRequestCache.get(path) === request) jsonRequestCache.delete(path);
      throw error;
    });
  jsonRequestCache.set(path, request);
  return request;
}
