import type {HealthDayData} from './healthPresentation';
import type {HealthTimelinePeriod} from './healthTimeline';

export function healthMetricCacheKey(day: HealthDayData, name: string, path: string): string {
  return JSON.stringify([day.date, day.revision ?? '', name, path]);
}

export function createHealthPeriodCache(capacity = 48) {
  const entries = new Map<string, HealthTimelinePeriod[]>();
  const get = (key: string) => {
    const value = entries.get(key);
    if (value) {entries.delete(key); entries.set(key, value);}
    return value;
  };
  return {
    get,
    async load(key: string, signal: AbortSignal, loader: () => Promise<HealthTimelinePeriod[]>): Promise<HealthTimelinePeriod[]> {
      signal.throwIfAborted();
      const cached = get(key);
      if (cached) return cached;
      const periods = await loader();
      signal.throwIfAborted();
      entries.delete(key);
      entries.set(key, periods);
      while (entries.size > capacity) entries.delete(entries.keys().next().value!);
      return periods;
    },
  };
}
