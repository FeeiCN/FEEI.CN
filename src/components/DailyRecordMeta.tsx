import React, {useEffect, useMemo, useState} from 'react';
import {useDoc} from '@docusaurus/plugin-content-docs/client';
import styles from './styles.module.css';

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

const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

function weatherLabel(code: number): string {
  if (code === 0) return '晴';
  if (code === 1) return '晴间多云';
  if (code === 2) return '多云';
  if (code === 3) return '阴';
  if (code === 45 || code === 48) return '雾';
  if (code >= 51 && code <= 57) return '毛毛雨';
  if (code >= 61 && code <= 67) return '雨';
  if (code >= 71 && code <= 77) return '雪';
  if (code >= 80 && code <= 82) return '阵雨';
  if (code >= 85 && code <= 86) return '阵雪';
  if (code >= 95) return '雷雨';
  return '天气';
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

async function loadWeather(location: string, date: string, signal: AbortSignal): Promise<WeatherDay | null> {
  const geocodingUrl = new URL('https://geocoding-api.open-meteo.com/v1/search');
  geocodingUrl.searchParams.set('name', location);
  geocodingUrl.searchParams.set('count', '1');
  geocodingUrl.searchParams.set('language', 'zh');
  geocodingUrl.searchParams.set('format', 'json');

  const geocoding = await fetch(geocodingUrl, {signal});
  if (!geocoding.ok) return null;
  const geocodingData = await geocoding.json() as GeocodingResponse;
  const place = geocodingData.results?.[0];
  if (!place) return null;

  const distance = dayDistance(date);
  const endpoint = distance >= 0 && distance <= 92
    ? 'https://api.open-meteo.com/v1/forecast'
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
    label: weatherLabel(code),
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
  const [weather, setWeather] = useState<WeatherDay[]>([]);

  const date = match ? `${match[1]}-${match[2]}-${match[3]}` : '';
  const dateLabel = match ? `${match[1]}年${Number(match[2])}月${Number(match[3])}日` : '';
  const weekday = useMemo(() => {
    if (!match) return '';
    return weekdays[new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay()];
  }, [date]);

  useEffect(() => {
    if (!date || !location) return;
    const controller = new AbortController();
    Promise.all(splitLocations(location).map((place) => loadWeather(place, date, controller.signal)))
      .then((items) => setWeather(items.filter((item): item is WeatherDay => Boolean(item))))
      .catch(() => {});
    return () => controller.abort();
  }, [date, location]);

  if (!match) return null;

  return (
    <div className={styles.dailyMeta} aria-label="当天基本信息">
      <span>{dateLabel}</span>
      <span>{weekday}</span>
      {location && <span>{location}</span>}
      {weather.length > 0 && (
        <span className={styles.weather}>
          {weather.map((item) => (
            <span key={item.location}>
              {weather.length > 1 && `${item.location} `}
              {item.label} {item.min}–{item.max}°C
              {typeof item.precipitation === 'number' && item.precipitation >= 0.1
                ? ` · 降水 ${item.precipitation.toFixed(1)}mm`
                : ''}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}
