import React, {useEffect, useMemo, useState} from 'react';
import {useDoc} from '@docusaurus/plugin-content-docs/client';
import styles from './DailyRecordMeta.module.css';

type WeatherDay = {
  location: string;
  label: string;
  min: number;
  max: number;
  precipitation?: number;
};

type GeocodingResponse = {
  results?: Array<{latitude: number; longitude: number; name?: string}>;
};

type WeatherResponse = {
  daily?: {
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_sum?: number[];
  };
};

type HolidayData = {
  days?: Array<{name: string; date: string; isOffDay: boolean}>;
};

type DayStatus = {
  label: string;
  holiday?: string;
};

type CachedGeo = {
  latitude: number;
  longitude: number;
};

type CachedWeather = {
  value: WeatherDay;
  cachedAt: number;
};

const GEO_CACHE_PREFIX = 'feei:daily-geo:v3:';
const WEATHER_CACHE_PREFIX = 'feei:daily-weather:v4:';

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
    // Storage may be unavailable in private/restricted browsing. Ignore it.
  }
}

const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const locationAliases: Record<string, string[]> = {
  '札幌': ['札幌市', 'Sapporo'],
  '千叶': ['千葉市', 'Chiba'],
  '千葉': ['千葉市', 'Chiba'],
};

function geocodingNames(location: string): string[] {
  const names = [location, ...(locationAliases[location] ?? [])];
  if (/^[\u3400-\u9fff]{2,}$/.test(location) && !/[市区县縣]$/.test(location)) {
    names.push(`${location}市`);
  }
  return [...new Set(names)];
}

function rainIntensity(precipitation?: number): string | null {
  if (typeof precipitation !== 'number' || precipitation < 0.1) return null;
  if (precipitation < 10) return '小雨';
  if (precipitation < 25) return '中雨';
  if (precipitation < 50) return '大雨';
  if (precipitation < 100) return '暴雨';
  if (precipitation < 250) return '大暴雨';
  return '特大暴雨';
}

function weatherLabel(code: number, precipitation?: number): string {
  const rain = rainIntensity(precipitation);

  if (code === 0) return '晴';
  if (code === 1) return '晴间多云';
  if (code === 2) return '多云';
  if (code === 3) return rain ?? '阴';
  if (code === 45 || code === 48) return '雾';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return rain ?? '小雨';
  if (code >= 71 && code <= 77) return '雪';
  if (code >= 85 && code <= 86) return '阵雪';
  if (code >= 95) return rain ? `雷雨 · ${rain}` : '雷雨';
  return rain ?? '天气';
}

function splitLocations(value: string): string[] {
  return [...new Set(value.split(/\s*(?:→|\/|、)\s*/).map((part) => part.trim()).filter(Boolean))].slice(0, 4);
}

function dayDistance(date: string): number {
  const target = Date.parse(`${date}T00:00:00Z`);
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((today - target) / 86400000);
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

async function loadWeather(location: string, date: string, signal: AbortSignal): Promise<WeatherDay | null> {
  const geoKey = `${GEO_CACHE_PREFIX}${location}`;
  let place = readCache<CachedGeo>(geoKey);

  if (!place) {
    for (const name of geocodingNames(location)) {
      for (const language of ['zh', 'ja', 'en']) {
        const geocodingUrl = new URL('https://geocoding-api.open-meteo.com/v1/search');
        geocodingUrl.searchParams.set('name', name);
        geocodingUrl.searchParams.set('count', '5');
        geocodingUrl.searchParams.set('language', language);
        geocodingUrl.searchParams.set('format', 'json');

        const geocoding = await fetch(geocodingUrl, {signal});
        if (!geocoding.ok) continue;
        const geocodingData = await geocoding.json() as GeocodingResponse;
        const result = geocodingData.results?.[0];
        if (!result) continue;

        place = {latitude: result.latitude, longitude: result.longitude};
        writeCache(geoKey, place);
        break;
      }
      if (place) break;
    }
  }

  if (!place) return null;

  const distance = dayDistance(date);
  const endpoint = distance <= 0
    ? 'https://api.open-meteo.com/v1/forecast'
    : date >= '2021-01-01'
      ? 'https://historical-forecast-api.open-meteo.com/v1/forecast'
      : 'https://archive-api.open-meteo.com/v1/archive';
  const weatherUrl = new URL(endpoint);
  weatherUrl.searchParams.set('latitude', String(place.latitude));
  weatherUrl.searchParams.set('longitude', String(place.longitude));
  weatherUrl.searchParams.set('start_date', date);
  weatherUrl.searchParams.set('end_date', date);
  weatherUrl.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum');
  weatherUrl.searchParams.set('timezone', 'auto');

  const weather = await fetch(weatherUrl, {signal});
  if (!weather.ok) return null;
  const data = await weather.json() as WeatherResponse;
  const code = data.daily?.weather_code?.[0];
  const max = data.daily?.temperature_2m_max?.[0];
  const min = data.daily?.temperature_2m_min?.[0];
  const precipitation = data.daily?.precipitation_sum?.[0];
  if (typeof code !== 'number' || typeof max !== 'number' || typeof min !== 'number') return null;

  return {
    location,
    label: weatherLabel(code, precipitation),
    min: Math.round(min),
    max: Math.round(max),
    precipitation: typeof precipitation === 'number' ? precipitation : undefined,
  };
}

export default function DailyRecordMeta() {
  const {frontMatter} = useDoc();
  const values = frontMatter as Record<string, unknown>;
  const slug = typeof values.slug === 'string' ? values.slug : '';
  const match = slug.match(/^\/(\d{4})-(\d{2})-(\d{2})\/?$/);
  const location = typeof values.location === 'string' ? values.location.trim() : '';
  const locations = useMemo(() => splitLocations(location), [location]);
  const isMultiLocation = locations.length > 1;
  const [weather, setWeather] = useState<WeatherDay[]>([]);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [dayStatus, setDayStatus] = useState<DayStatus | null>(null);

  const date = match ? `${match[1]}-${match[2]}-${match[3]}` : '';
  const dateLabel = match ? `${match[1]}年${Number(match[2])}月${Number(match[3])}日` : '';
  const weekdayIndex = useMemo(() => {
    if (!match) return -1;
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
  }, [date]);
  const weekday = weekdayIndex >= 0 ? weekdays[weekdayIndex] : '';

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
    setWeather([]);
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
      setWeather(cached.map((item) => item!.value));
      return;
    }

    const availableCached = cached
      .filter((item): item is CachedWeather => Boolean(item))
      .map((item) => item.value);
    if (availableCached.length > 0) setWeather(availableCached);
    setWeatherLoading(availableCached.length !== locations.length);

    const controller = new AbortController();
    Promise.all(locations.map((place) => loadWeather(place, date, controller.signal)))
      .then((items) => {
        const values = items.filter((item): item is WeatherDay => Boolean(item));
        values.forEach((item) =>
          writeCache(`${WEATHER_CACHE_PREFIX}${date}:${item.location}`, {
            value: item,
            cachedAt: Date.now(),
          } satisfies CachedWeather),
        );
        setWeather(values);
      })
      .catch(() => {})
      .finally(() => setWeatherLoading(false));
    return () => controller.abort();
  }, [date, location, locations]);

  if (!match) return null;

  const renderWeather = (item: WeatherDay) => (
    <>
      {item.label} {item.min}–{item.max}°
    </>
  );

  return (
    <div className={styles.dailyMeta} aria-label="当天基本信息">
      <div className={styles.metaLine}>
        <span>{dateLabel}</span>
        <span>{weekday}</span>
        {dayStatus?.holiday && <span>{dayStatus.holiday}</span>}
        {dayStatus && <span>{dayStatus.label}</span>}
        {!isMultiLocation && location && <span>{location}</span>}
        {!isMultiLocation && weather.length > 0 ? (
          <span className={styles.weather}>{renderWeather(weather[0])}</span>
        ) : !isMultiLocation && location && weatherLoading ? (
          <span className={styles.weatherPlaceholder}>天气…</span>
        ) : null}
      </div>

      {isMultiLocation && (
        <div className={styles.routeLine} aria-label="当天行程天气">
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
        </div>
      )}
    </div>
  );
}
