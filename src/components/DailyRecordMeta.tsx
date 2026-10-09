import React, {useEffect, useMemo, useState} from 'react';
import {useDoc} from '@docusaurus/plugin-content-docs/client';
import {
  summarizeWeather,
  type RawWeatherDay,
  type WeatherSummary,
} from '@site/src/utils/weather';
import {resolvePlace, type ResolvedPlace} from '@site/src/utils/locationResolver';
import styles from './DailyRecordMeta.module.css';

type WeatherResponse = {
  daily?: {
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
  };
  hourly?: {
    weather_code?: number[];
    rain?: number[];
    showers?: number[];
    snowfall?: number[];
  };
};

type HolidayData = {
  days?: Array<{name: string; date: string; isOffDay: boolean}>;
};

type DayStatus = {
  label: string;
  holiday?: string;
};

type CachedGeo = ResolvedPlace;

type CachedWeather = {
  value: RawWeatherDay;
  cachedAt: number;
};

type ReadingYear = {
  daily?: Record<string, {seconds?: number}>;
};

const GEO_CACHE_PREFIX = 'feei:daily-geo:v8:';
const WEATHER_CACHE_PREFIX = 'feei:daily-weather:v7:';

function readCache<T>(key: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be unavailable in private/restricted browsing.
  }
}

const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function splitLocations(value: string): string[] {
  return [...new Set(
    value
      .split(/\s*→\s*/)
      .map((part) => part.trim())
      .filter(Boolean),
  )].slice(0, 4);
}

function weatherLocationCandidates(location: string): string[] {
  const hierarchy = location
    .split(/\s*·\s*/)
    .map((part) => part.trim())
    .filter(Boolean);

  const candidates: string[] = [];
  for (let index = hierarchy.length - 1; index >= 0; index -= 1) {
    const level = hierarchy[index];
    const places = level
      .split(/\s*(?:\/|、)\s*/)
      .map((part) => part.trim())
      .filter(Boolean);
    candidates.push(...places);
  }
  candidates.push(location);
  return [...new Set(candidates)];
}

function dayDistance(date: string): number {
  const target = Date.parse(`${date}T00:00:00Z`);
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((today - target) / 86400000);
}

function formatReadingTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分钟`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}小时${remainingMinutes}分钟` : `${hours}小时`;
}

async function loadReadingTime(date: string, signal: AbortSignal): Promise<number | null> {
  const response = await fetch(`/data/reading/${date.slice(0, 4)}.json`, {signal});
  if (!response.ok) return null;
  const data = await response.json() as ReadingYear;
  const seconds = data.daily?.[date]?.seconds;
  return typeof seconds === 'number' && seconds > 0 ? seconds : null;
}

async function resolveAtomicLocation(location: string, signal: AbortSignal): Promise<CachedGeo | null> {
  const geoKey = `${GEO_CACHE_PREFIX}${location}`;
  const cached = readCache<CachedGeo>(geoKey);
  if (cached) return cached;

  const resolved = await resolvePlace(location, signal);
  if (resolved) writeCache(geoKey, resolved);
  return resolved;
}

async function resolveLocation(location: string, signal: AbortSignal): Promise<CachedGeo | null> {
  const descriptorKey = `${GEO_CACHE_PREFIX}descriptor:${location}`;
  const cached = readCache<CachedGeo>(descriptorKey);
  if (cached) return cached;

  for (const candidate of weatherLocationCandidates(location)) {
    const resolved = await resolveAtomicLocation(candidate, signal);
    if (!resolved) continue;
    writeCache(descriptorKey, resolved);
    return resolved;
  }

  return null;
}

async function loadDayStatus(date: string, weekday: number, signal: AbortSignal): Promise<DayStatus | null> {
  const year = date.slice(0, 4);
  const response = await fetch(
    `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`,
    {signal},
  );
  if (!response.ok) return null;

  const data = await response.json() as HolidayData;
  if (!Array.isArray(data.days)) return null;
  const specialDay = data.days.find((item) => item.date === date);

  if (specialDay) {
    return specialDay.isOffDay
      ? {label: '休息', holiday: specialDay.name}
      : {label: '调休上班', holiday: specialDay.name};
  }

  return {label: weekday === 0 || weekday === 6 ? '休息' : '工作'};
}

function parseWeatherResponse(
  location: string,
  source: RawWeatherDay['source'],
  data: WeatherResponse,
): RawWeatherDay | null {
  const max = data.daily?.temperature_2m_max?.[0];
  const min = data.daily?.temperature_2m_min?.[0];
  const hourlyCodes = data.hourly?.weather_code ?? [];
  if (typeof max !== 'number' || typeof min !== 'number') return null;
  if (hourlyCodes.length === 0 && typeof data.daily?.weather_code?.[0] !== 'number') return null;

  return {
    location,
    min,
    max,
    dailyCode: data.daily?.weather_code?.[0],
    hourlyCodes,
    hourlyRain: data.hourly?.rain ?? [],
    hourlyShowers: data.hourly?.showers ?? [],
    hourlySnowfall: data.hourly?.snowfall ?? [],
    source,
  };
}

async function fetchWeatherEndpoint(
  endpoint: string,
  source: RawWeatherDay['source'],
  location: string,
  place: CachedGeo,
  date: string,
  signal: AbortSignal,
): Promise<RawWeatherDay | null> {
  const weatherUrl = new URL(endpoint);
  weatherUrl.searchParams.set('latitude', String(place.latitude));
  weatherUrl.searchParams.set('longitude', String(place.longitude));
  weatherUrl.searchParams.set('start_date', date);
  weatherUrl.searchParams.set('end_date', date);
  weatherUrl.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min');
  weatherUrl.searchParams.set(
    'hourly',
    source === 'archive'
      ? 'weather_code,rain,snowfall'
      : 'weather_code,rain,showers,snowfall',
  );
  weatherUrl.searchParams.set('timezone', 'auto');

  const response = await fetch(weatherUrl, {signal});
  if (!response.ok) return null;
  const data = await response.json() as WeatherResponse;
  return parseWeatherResponse(location, source, data);
}

let staticWeatherPromise: Promise<Record<string, RawWeatherDay>> | null = null;

async function loadStaticWeather(signal: AbortSignal): Promise<Record<string, RawWeatherDay>> {
  if (!staticWeatherPromise) {
    staticWeatherPromise = fetch('/data/weather/days.json', {cache: 'no-cache'})
      .then((response) => response.ok ? response.json() : {})
      .catch(() => ({}));
  }
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  return staticWeatherPromise;
}

async function loadStaticWeatherDay(location: string, date: string, signal: AbortSignal): Promise<RawWeatherDay | null> {
  const data = await loadStaticWeather(signal);
  const value = data[`${date}:${location}`];
  return value ? {...value, location} : null;
}

async function loadWeather(location: string, date: string, signal: AbortSignal): Promise<RawWeatherDay | null> {
  const staticWeather = await loadStaticWeatherDay(location, date, signal);
  if (staticWeather) return staticWeather;

  const place = await resolveLocation(location, signal);
  if (!place) return null;

  const distance = dayDistance(date);
  if (distance <= 0) {
    return fetchWeatherEndpoint(
      'https://api.open-meteo.com/v1/forecast',
      'forecast',
      location,
      place,
      date,
      signal,
    );
  }

  if (date >= '2022-01-01') {
    const historicalForecast = await fetchWeatherEndpoint(
      'https://historical-forecast-api.open-meteo.com/v1/forecast',
      'historical-forecast',
      location,
      place,
      date,
      signal,
    );
    if (historicalForecast) return historicalForecast;
  }

  return fetchWeatherEndpoint(
    'https://archive-api.open-meteo.com/v1/archive',
    'archive',
    location,
    place,
    date,
    signal,
  );
}

export default function DailyRecordMeta() {
  const {frontMatter} = useDoc();
  const values = frontMatter as Record<string, unknown>;
  const slug = typeof values.slug === 'string' ? values.slug : '';
  const match = slug.match(/^\/(\d{4})-(\d{2})-(\d{2})\/?$/);
  const location = typeof values.location === 'string' ? values.location.trim() : '';
  const dayStatusOverride = typeof values.day_status === 'string' ? values.day_status.trim() : '';
  const locations = useMemo(() => splitLocations(location), [location]);
  const isMultiLocation = locations.length > 1;
  const [rawWeather, setRawWeather] = useState<RawWeatherDay[]>([]);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [dayStatus, setDayStatus] = useState<DayStatus | null>(null);
  const [readingSeconds, setReadingSeconds] = useState<number | null>(null);

  const weather = useMemo<WeatherSummary[]>(
    () => rawWeather.map(summarizeWeather),
    [rawWeather],
  );
  const date = match ? `${match[1]}-${match[2]}-${match[3]}` : '';
  const dateLabel = match ? `${match[1]}年${Number(match[2])}月${Number(match[3])}日` : '';
  const weekdayIndex = useMemo(() => {
    if (!match) return -1;
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
  }, [date]);
  const weekday = weekdayIndex >= 0 ? weekdays[weekdayIndex] : '';
  const displayedDayStatus: DayStatus | null = dayStatusOverride
    ? {label: dayStatusOverride, holiday: dayStatus?.holiday}
    : dayStatus;

  useEffect(() => {
    setDayStatus(null);
    if (!date || weekdayIndex < 0) return;
    const controller = new AbortController();
    loadDayStatus(date, weekdayIndex, controller.signal)
      .then(setDayStatus)
      .catch(() => {});
    return () => controller.abort();
  }, [date, weekdayIndex]);

  useEffect(() => {
    setRawWeather([]);
    setWeatherLoading(false);
    if (!date || !location) return;

    const distance = dayDistance(date);
    const maxAge = distance > 1 ? 30 * 24 * 60 * 60 * 1000 : 3 * 60 * 60 * 1000;
    const cached = locations.map((place) =>
      readCache<CachedWeather>(`${WEATHER_CACHE_PREFIX}${date}:${place}`),
    );
    const validCached = cached.every(
      (item) => item && Date.now() - item.cachedAt < maxAge,
    );

    if (validCached) {
      setRawWeather(cached.map((item) => item!.value));
      return;
    }

    const availableCached = cached
      .filter((item): item is CachedWeather => Boolean(item))
      .map((item) => item.value);
    if (availableCached.length > 0) setRawWeather(availableCached);
    setWeatherLoading(availableCached.length !== locations.length);

    const controller = new AbortController();
    Promise.allSettled(locations.map((place) => loadWeather(place, date, controller.signal)))
      .then((results) => {
        const freshValues = results
          .filter((result): result is PromiseFulfilledResult<RawWeatherDay | null> => result.status === 'fulfilled')
          .map((result) => result.value)
          .filter((item): item is RawWeatherDay => Boolean(item));

        freshValues.forEach((item) =>
          writeCache(`${WEATHER_CACHE_PREFIX}${date}:${item.location}`, {
            value: item,
            cachedAt: Date.now(),
          } satisfies CachedWeather),
        );

        const freshByLocation = new Map(freshValues.map((item) => [item.location, item]));
        const cachedByLocation = new Map(availableCached.map((item) => [item.location, item]));
        setRawWeather(
          locations
            .map((place) => freshByLocation.get(place) ?? cachedByLocation.get(place))
            .filter((item): item is RawWeatherDay => Boolean(item)),
        );
      })
      .finally(() => setWeatherLoading(false));

    return () => controller.abort();
  }, [date, location, locations]);

  useEffect(() => {
    setReadingSeconds(null);
    if (!date) return;
    const controller = new AbortController();
    loadReadingTime(date, controller.signal)
      .then(setReadingSeconds)
      .catch(() => {});
    return () => controller.abort();
  }, [date]);

  if (!match) return null;

  const renderWeather = (item: WeatherSummary) => (
    <>
      {item.label} {item.min}–{item.max}°
    </>
  );


  return (
    <div className={styles.dailyMeta} aria-label="当天基本信息">
      <div className={styles.metaLine}>
        {dateLabel}（{weekday}
        {displayedDayStatus?.holiday && <>，<span className={styles.specialDay}>{displayedDayStatus.holiday}</span></>}）
        {displayedDayStatus && <>，{displayedDayStatus.label}</>}
      </div>
      {location && (
        <span className={styles.routeLine} aria-label={isMultiLocation ? '当天行程天气' : '当天地点天气'}>
          {locations.map((place, index) => {
            const item = weather.find((entry) => entry.location === place);
            return (
              <span className={styles.routeSegment} key={place}>
                {index > 0 && <span className={styles.routeArrow}>→</span>}
                <span className={styles.routeStop}>
                  <span className={styles.routePlace}>{place}</span>
                  {item ? (
                    <span className={styles.routeWeather}>{renderWeather(item)}</span>
                  ) : weatherLoading ? (
                    <span className={styles.weatherPlaceholder}>天气…</span>
                  ) : (
                    <span className={styles.weatherUnavailable}>天气暂无</span>
                  )}
                </span>
              </span>
            );
          })}
        </span>
      )}
      {readingSeconds !== null && (
        <div className={styles.readingLine} aria-label="当天阅读时间">
          阅读 {formatReadingTime(readingSeconds)}
        </div>
      )}
    </div>
  );
}
