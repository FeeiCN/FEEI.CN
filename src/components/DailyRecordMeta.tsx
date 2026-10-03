import React, {useEffect, useMemo, useState} from 'react';
import {useDoc} from '@docusaurus/plugin-content-docs/client';
import {
  summarizeWeather,
  type RawWeatherDay,
  type WeatherSummary,
} from '@site/src/utils/weather';
import styles from './DailyRecordMeta.module.css';

type GeocodingResult = {
  latitude: number;
  longitude: number;
  name?: string;
  country_code?: string;
  admin1?: string;
  population?: number;
  feature_code?: string;
};

type GeocodingResponse = {
  results?: GeocodingResult[];
};

type GeoNamesResult = {
  geonameId?: number;
  name?: string;
  lat?: string;
  lng?: string;
  countryCode?: string;
  adminName1?: string;
  adminName2?: string;
  featureClass?: string;
  featureCode?: string;
  population?: number;
  alternateNames?: Array<{name?: string; lang?: string}>;
};

type GeoNamesResponse = {
  geonames?: GeoNamesResult[];
};

type NominatimResult = {
  lat?: string;
  lon?: string;
  display_name?: string;
  name?: string;
  type?: string;
  addresstype?: string;
  importance?: number;
  address?: {
    country_code?: string;
    state?: string;
    province?: string;
    county?: string;
    city?: string;
    town?: string;
  };
};

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

type CachedGeo = {
  latitude: number;
  longitude: number;
  canonicalName?: string;
  countryCode?: string;
  admin1?: string;
};

type CachedWeather = {
  value: RawWeatherDay;
  cachedAt: number;
};

type LocationAlias = {
  names: string[];
  countryCode?: string;
};

const GEO_CACHE_PREFIX = 'feei:daily-geo:v7:';
const GEONAMES_USERNAME = 'feei';
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

const locationAliases: Record<string, LocationAlias> = {
  '千岛湖': {names: ['Qiandaohu'], countryCode: 'CN'},
  '札幌': {names: ['札幌市', 'Sapporo'], countryCode: 'JP'},
  '千叶': {names: ['千葉市', 'Chiba'], countryCode: 'JP'},
  '千葉': {names: ['千葉市', 'Chiba'], countryCode: 'JP'},
  '横滨': {names: ['横浜市', 'Yokohama'], countryCode: 'JP'},
  '冲绳': {names: ['沖縄', 'Okinawa'], countryCode: 'JP'},
  '函馆': {names: ['函館市', 'Hakodate'], countryCode: 'JP'},
  '蕲春': {names: ['Qichun']},
};

function geocodingNames(location: string): string[] {
  const alias = locationAliases[location];
  // Prefer a disambiguating alias first. For example, the Chinese query
  // “千岛湖” also returns a different place in Lishui before the intended
  // Qiandaohu in Hangzhou; the transliterated alias resolves the latter.
  const names = [...(alias?.names ?? []), location];
  return [...new Set(names)];
}

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

function normalizePlaceName(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s·・.,，。'’"“”()（）\-_]/g, '')
    .replace(/(?:市|县|縣|区|區|町|村|州|省|府)$/u, '');
}

function nameScore(query: string, names: Array<string | undefined>): number {
  const normalizedQuery = normalizePlaceName(query);
  let best = 0;
  for (const name of names) {
    if (!name) continue;
    const normalizedName = normalizePlaceName(name);
    if (normalizedName === normalizedQuery) best = Math.max(best, 100);
    else if (normalizedName.includes(normalizedQuery) || normalizedQuery.includes(normalizedName)) best = Math.max(best, 65);
  }
  return best;
}

function featureScore(featureCode?: string, type?: string): number {
  if (featureCode?.startsWith('PPL')) return 20;
  if (featureCode?.startsWith('ADM')) return 18;
  if (['city', 'town', 'village', 'county', 'administrative'].includes(type ?? '')) return 15;
  return 0;
}

function populationScore(population?: number): number {
  if (!population || population <= 0) return 0;
  return Math.min(12, Math.log10(population + 1) * 2);
}

function aliasCountryBonus(location: string, countryCode?: string): number {
  const expected = locationAliases[location]?.countryCode;
  return expected && countryCode?.toUpperCase() === expected ? 25 : 0;
}

function chooseGeocodingResult(location: string, query: string, results: GeocodingResult[]): GeocodingResult | undefined {
  return [...results].sort((a, b) => {
    const score = (item: GeocodingResult) =>
      nameScore(query, [item.name])
      + featureScore(item.feature_code)
      + populationScore(item.population)
      + aliasCountryBonus(location, item.country_code);
    return score(b) - score(a);
  })[0];
}

function geoNamesAlternateNames(item: GeoNamesResult): string[] {
  return (item.alternateNames ?? []).map((entry) => entry.name).filter((name): name is string => Boolean(name));
}

function chooseGeoNamesResult(location: string, query: string, results: GeoNamesResult[]): GeoNamesResult | undefined {
  return [...results].sort((a, b) => {
    const score = (item: GeoNamesResult) =>
      nameScore(query, [item.name, ...geoNamesAlternateNames(item)])
      + featureScore(item.featureCode)
      + populationScore(item.population)
      + aliasCountryBonus(location, item.countryCode);
    return score(b) - score(a);
  })[0];
}

function chooseNominatimResult(location: string, query: string, results: NominatimResult[]): NominatimResult | undefined {
  return [...results].sort((a, b) => {
    const score = (item: NominatimResult) =>
      nameScore(query, [item.name, item.display_name])
      + featureScore(undefined, item.addresstype ?? item.type)
      + (item.importance ?? 0) * 10
      + aliasCountryBonus(location, item.address?.country_code);
    return score(b) - score(a);
  })[0];
}

async function resolveWithGeoNames(location: string, signal: AbortSignal): Promise<CachedGeo | null> {
  for (const query of geocodingNames(location)) {
    const url = new URL('https://secure.geonames.org/searchJSON');
    url.searchParams.set('q', query);
    url.searchParams.set('maxRows', '10');
    url.searchParams.set('username', GEONAMES_USERNAME);

    const response = await fetch(url, {signal});
    if (!response.ok) continue;
    const data = await response.json() as GeoNamesResponse;
    const result = chooseGeoNamesResult(location, query, data.geonames ?? []);
    if (!result) continue;

    const latitude = Number(result.lat);
    const longitude = Number(result.lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    return {
      latitude,
      longitude,
      canonicalName: result.name,
      countryCode: result.countryCode,
      admin1: result.adminName1,
    };
  }
  return null;
}

async function resolveWithNominatim(location: string, signal: AbortSignal): Promise<CachedGeo | null> {
  for (const query of geocodingNames(location)) {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '8');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('accept-language', 'zh,en');

    const response = await fetch(url, {
      signal,
      headers: {'Accept': 'application/json'},
    });
    if (!response.ok) continue;
    const results = await response.json() as NominatimResult[];
    const result = chooseNominatimResult(location, query, results);
    if (!result) continue;

    const latitude = Number(result.lat);
    const longitude = Number(result.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    return {
      latitude,
      longitude,
      canonicalName: result.name ?? result.display_name,
      countryCode: result.address?.country_code?.toUpperCase(),
      admin1: result.address?.state ?? result.address?.province,
    };
  }
  return null;
}

async function resolveWithOpenMeteo(location: string, signal: AbortSignal): Promise<CachedGeo | null> {
  for (const query of geocodingNames(location)) {
    for (const language of ['zh', 'ja', 'en']) {
      const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
      url.searchParams.set('name', query);
      url.searchParams.set('count', '8');
      url.searchParams.set('language', language);
      url.searchParams.set('format', 'json');

      const response = await fetch(url, {signal});
      if (!response.ok) continue;
      const data = await response.json() as GeocodingResponse;
      const result = chooseGeocodingResult(location, query, data.results ?? []);
      if (!result) continue;
      return {
        latitude: result.latitude,
        longitude: result.longitude,
        canonicalName: result.name,
        countryCode: result.country_code,
        admin1: result.admin1,
      };
    }
  }
  return null;
}

async function resolveAtomicLocation(location: string, signal: AbortSignal): Promise<CachedGeo | null> {
  const geoKey = `${GEO_CACHE_PREFIX}${location}`;
  const cached = readCache<CachedGeo>(geoKey);
  if (cached) return cached;

  const providers = [resolveWithGeoNames, resolveWithNominatim, resolveWithOpenMeteo];
  for (const provider of providers) {
    try {
      const resolved = await provider(location, signal);
      if (!resolved) continue;
      writeCache(geoKey, resolved);
      return resolved;
    } catch (error) {
      if (signal.aborted) throw error;
    }
  }
  return null;
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

async function loadWeather(location: string, date: string, signal: AbortSignal): Promise<RawWeatherDay | null> {
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
  const locations = useMemo(() => splitLocations(location), [location]);
  const isMultiLocation = locations.length > 1;
  const [rawWeather, setRawWeather] = useState<RawWeatherDay[]>([]);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [dayStatus, setDayStatus] = useState<DayStatus | null>(null);

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
        {dayStatus?.holiday && <>，<span className={styles.specialDay}>{dayStatus.holiday}</span></>}）
        {dayStatus && <>，{dayStatus.label}</>}
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
    </div>
  );
}
