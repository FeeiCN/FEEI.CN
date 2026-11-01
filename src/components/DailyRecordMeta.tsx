import React, {type ReactNode, useEffect, useId, useMemo, useRef, useState} from 'react';
import {Button, Collapsible, Popover, Portal} from '@chakra-ui/react';
import {useDoc} from '@docusaurus/plugin-content-docs/client';
import {useColorMode} from '@docusaurus/theme-common';
import ReactECharts from 'echarts-for-react';
import {color as echartsColor, format as echartsFormat, type CustomSeriesOption, type EChartsOption} from 'echarts';
import ActivityDayDetails from './ActivityDayDetails';
import XIcon from '@site/src/components/ItsHoverIcon/icons/x-icon';
import {
  summarizeWeather,
  type RawWeatherDay,
  type WeatherSummary,
} from '@site/src/utils/weather';
import {resolvePlace, type ResolvedPlace} from '@site/src/utils/locationResolver';
import {staticAssetUrl} from '@site/src/utils/staticAssets';
import {
  additionalHealthMetricFiles, compactHealthMetricSummary, healthTimelineCoverageMinutes, healthTimelinePeriodLabel, indexHealthTimelineRows, parseHealthMetricTimeline, pendingHealthMetricRow,
  type HealthMetricPayload, type HealthTimelineFile, type HealthTimelinePeriod, type HealthTimelineRow,
} from '@site/src/utils/healthTimeline';
import {
  STATE_OF_MIND_ASSOCIATION_LABELS,
  STATE_OF_MIND_CLASSIFICATION_LABELS,
  STATE_OF_MIND_FEELING_LABELS,
  STATE_OF_MIND_KIND_LABELS,
  stateOfMindTerm,
} from '@site/src/utils/stateOfMind';
import styles from './DailyRecordMeta.module.css';
import SleepStageChart from './SleepStageChart';

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

type ReadingDay = {
  seconds?: number;
  books?: string[];
};

type ReadingYear = {
  daily?: Record<string, ReadingDay>;
};

type ReadingWeekBook = {
  id?: string;
  title?: string;
  readTime?: number;
};

type ReadingWeek = {
  startDate?: string;
  endDate?: string;
  totalReadTime?: number;
  books?: ReadingWeekBook[];
};

type ReadingWeeksYear = {
  weeks?: Record<string, ReadingWeek>;
};

type ReadingSummary = {
  day: ReadingDay;
  date: string;
  sevenDayAverage: number;
  streak: number;
  week: ReadingWeek | null;
  trend: Array<{
    date: string;
    seconds: number;
  }>;
};

type SleepScoreDay = {
  score?: number;
  classification?: string;
  source?: string;
  components?: Record<'duration' | 'bedtime' | 'interruptions', {
    score?: number;
    maximum?: number;
    detail?: string;
  }>;
};

type SleepScoreSummary = SleepScoreDay & {
  date: string;
  trend: Array<SleepScoreDay & {
    date: string;
    score: number;
    durationMinutes: number | null;
  }>;
};

type HealthMetricRecord = {
  date?: string;
  qty?: number;
  source?: string;
};

type HealthMetric = {
  name?: string;
  data?: HealthMetricRecord[];
};

type HealthDay = {
  version?: 5;
  date: string;
  activity?: Record<string, number | unknown[] | undefined> & {
    daylightPeriods?: Array<[number, number, number]>;
    movementPeriods?: Array<[number, number, number?, number?]>;
    standPeriods?: Array<[number, number, number]>;
    workouts?: Array<{type?: string; startMinute?: number; endMinute?: number; durationMinutes?: number; distanceKm?: number; averageHeartRateBpm?: number}>;
  };
  sleep?: {stages?: Array<[number, number, string]>};
  hearing?: {environmentalAudioExposureDbASPL?: number};
  respiratory?: {respiratoryRatePerMinute?: number; bloodOxygenFraction?: number};
  vitalSigns?: {wristTemperatureCelsius?: number};
  activityCapability?: {walkingStepLengthM?: number; walkingSpeedMps?: number; walkingAsymmetryPercent?: number; walkingDoubleSupportPercent?: number; stairAscentSpeedMps?: number; stairDescentSpeedMps?: number};
  files?: Record<string, {path: string; records?: number}>;
  heart?: {hrv?: {dailyMs?: number; source?: string; measurements?: Array<[number, number, string]>}; restingHeartRateBpm?: number; walkingHeartRateBpm?: number; heartRate?: {averageBpm?: number}};
  bodyMeasurements?: {weight?: {dailyKg?: number}; bodyFatFraction?: number; bodyMassIndex?: number; leanBodyMassKg?: number};
  mindfulness?: {stateOfMindEntries?: Array<{minute?: number; kind?: string; valence?: number; classification?: string; labels?: string[]; associations?: string[]}>};
  medications?: {doses?: Array<{scheduledMinute?: number; takenMinute?: number; name?: string; displayText?: string; status?: string; dosage?: number; scheduledDosage?: number}>};
};

type HealthMonth = {
  version?: 5;
  month?: string;
  days?: HealthDay[];
};

type MedicationRecord = {
  displayText?: string;
  nickname?: string;
  name?: string;
  scheduledDate?: string;
  start?: string;
  status?: string;
  dosage?: number;
  scheduledDosage?: number;
};

type MedicationSummary = {
  date: string;
  records: MedicationRecord[];
  taken: number;
};

type StateOfMindRecord = {
  start?: string;
  kind?: 'daily_mood' | 'momentary_emotion' | string;
  valenceClassification?: string;
  valence?: number;
  labels?: string[];
  associations?: string[];
};

type MoodSummary = HealthTimelineSummary & {
  date: string;
  primary: StateOfMindRecord;
  records: StateOfMindRecord[];
  recordedDays: number;
};

type HealthTimelineSummary = {
  date: string;
  hrvMs: number | null;
  hrvSource?: string;
  hrvMeasurements: Array<[number, number, string]>;
  hrvBaselineMs: number | null;
  restingHeartRateBpm: number | null;
  restingHeartRateBaselineBpm: number | null;
  daylightMinutes: number | null;
  daylightPeriods: Array<[number, number, number]>;
  sleepStages: Array<[number, number, string]>;
  movementPeriods: Array<[number, number, number?, number?]>;
  environmentSoundDb: number | null;
  environmentSoundFile?: string;
  timelineFiles: HealthTimelineFile[];
  timelineRows: HealthTimelineRow[];
};

type ActivitySummary = {
  date: string;
  timeline: HealthTimelineSummary;
  exerciseMinutes: number;
  activeEnergyKJ: number | null;
  distanceKm: number | null;
  steps: number | null;
  standMinutes: number | null;
  flightsClimbed: number | null;
  daylightMinutes: number | null;
  trend: Array<{
    date: string;
    minutes: number | null;
  }>;
};

type WeightSummary = {
  date: string;
  weightKg: number;
  previousWeightKg: number | null;
  previousWeightDate: string | null;
  previousBodyFatPercentage: number | null;
  previousBodyFatDate: string | null;
  bodyFatPercentage: number | null;
  bmi: number | null;
  leanBodyMassKg: number | null;
  trend: Array<{
    date: string;
    weightKg: number;
  }>;
};

type HealthSummary = {
  activity: ActivitySummary | null;
  weight: WeightSummary | null;
  mood: MoodSummary | null;
  medication: MedicationSummary | null;
};

const sleepScoreLevels = [
  {label: '非常低', range: '0–40', minimum: 0, maximum: 40, visualStart: 0, visualWidth: 30},
  {label: '低', range: '41–60', minimum: 41, maximum: 60, visualStart: 30, visualWidth: 20},
  {label: '一般', range: '61–80', minimum: 61, maximum: 80, visualStart: 50, visualWidth: 20},
  {label: '高', range: '81–95', minimum: 81, maximum: 95, visualStart: 70, visualWidth: 16},
  {label: '非常高', range: '96–100', minimum: 96, maximum: 100, visualStart: 86, visualWidth: 14},
] as const;

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

function parseDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shiftDate(date: string, days: number): string {
  const value = parseDate(date);
  value.setUTCDate(value.getUTCDate() + days);
  return formatDate(value);
}

function startOfWeek(date: string): string {
  const value = parseDate(date);
  const daysSinceMonday = (value.getUTCDay() + 6) % 7;
  value.setUTCDate(value.getUTCDate() - daysSinceMonday);
  return formatDate(value);
}

function formatShortDate(date: string): string {
  const [, month, day] = date.split('-').map(Number);
  return `${month}月${day}日`;
}

function parseDurationMinutes(detail?: string): number | null {
  if (!detail) return null;
  const hours = detail.match(/(\d+)小时/);
  const minutes = detail.match(/(\d+)分钟/);
  if (!hours && !minutes) return null;
  return Number(hours?.[1] ?? 0) * 60 + Number(minutes?.[1] ?? 0);
}

async function loadReadingSummary(date: string, signal: AbortSignal): Promise<ReadingSummary | null> {
  const sevenDayStart = shiftDate(date, -6);
  const years = [...new Set([date.slice(0, 4), sevenDayStart.slice(0, 4), String(Number(date.slice(0, 4)) - 1)])];
  const yearPayloads = await Promise.all(years.map(async (year) => {
    const response = await fetch(`/data/reading/${year}.json`, {signal});
    return response.ok ? await response.json() as ReadingYear : {} as ReadingYear;
  }));
  const daily = Object.assign({}, ...yearPayloads.map((payload) => payload.daily ?? {})) as Record<string, ReadingDay>;
  const day = daily[date];
  if (typeof day?.seconds !== 'number' || day.seconds <= 0) return null;

  const sevenDaySeconds = Array.from({length: 7}, (_, index) => {
    const item = daily[shiftDate(sevenDayStart, index)];
    return typeof item?.seconds === 'number' ? item.seconds : 0;
  });
  let streak = 0;
  for (let index = 0; index < 732; index += 1) {
    const item = daily[shiftDate(date, -index)];
    if (typeof item?.seconds !== 'number' || item.seconds <= 0) break;
    streak += 1;
  }

  const weekStart = startOfWeek(date);
  const weekResponse = await fetch(`/data/reading/weeks/${weekStart.slice(0, 4)}.json`, {signal});
  const weekPayload = weekResponse.ok ? await weekResponse.json() as ReadingWeeksYear : null;
  const week = weekPayload?.weeks?.[weekStart] ?? null;
  return {
    day,
    date,
    sevenDayAverage: Math.round(sevenDaySeconds.reduce((sum, value) => sum + value, 0) / 7),
    streak,
    week,
    trend: sevenDaySeconds.map((seconds, index) => ({
      date: shiftDate(sevenDayStart, index),
      seconds,
    })),
  };
}

async function loadSleepScore(date: string, signal: AbortSignal): Promise<SleepScoreSummary | null> {
  const trendStart = shiftDate(date, -6);
  const dates = Array.from({length: 7}, (_, index) => shiftDate(trendStart, index));
  const days = await Promise.all(dates.map(async (trendDate) => {
    const [year, month, day] = trendDate.split('-');
    const response = await fetch(`/data/sleep-score/${year}/${month}/${day}.json`, {signal});
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return null;
    const data = await response.json() as SleepScoreDay;
    return typeof data.score === 'number' && Number.isFinite(data.score) ? {date: trendDate, data} : null;
  }));
  const current = days.find((item) => item?.date === date);
  if (!current) return null;
  return {
    ...current.data,
    date,
    trend: days
      .filter((item): item is {date: string; data: SleepScoreDay & {score: number}} => item !== null)
      .map((item) => ({
        ...item.data,
        date: item.date,
        score: item.data.score,
        durationMinutes: parseDurationMinutes(item.data.components?.duration?.detail),
      })),
  };
}

async function loadHealthSummary(date: string, signal: AbortSignal): Promise<HealthSummary | null> {
  const trendStart = shiftDate(date, -6);
  const moodStart = shiftDate(date, -29);
  const months = [...new Set(Array.from({length: 30}, (_, index) => shiftDate(date, -index).slice(0, 7)))];
  const [dayResponse, ...monthResponses] = await Promise.all([
    fetch(staticAssetUrl(`/data/health/${date.replaceAll('-', '/')}.json`), {signal, cache: 'no-store'}),
    ...months.map((month) => fetch(staticAssetUrl(`/data/health/${month.replace('-', '/')}.json`), {signal, cache: 'no-store'}).catch(() => null)),
  ]);
  if (!dayResponse.ok || !dayResponse.headers.get('content-type')?.includes('application/json')) return null;
  const currentDay = await dayResponse.json() as HealthDay;
  if (currentDay.version !== 5 || currentDay.date !== date) return null;
  const monthPayloads = await Promise.all(monthResponses.map(async (response, index) => {
    if (!response?.ok || !response.headers.get('content-type')?.includes('application/json')) return null;
    const payload = await response.json() as HealthMonth;
    return payload.version === 5 && payload.month === months[index] && Array.isArray(payload.days) ? payload : null;
  }));
  const records = new Map<string, HealthMetricRecord[]>();
  const healthDays = [currentDay, ...monthPayloads.flatMap((month) => month?.days ?? [])
    .filter((day) => day.version === 5 && day.date >= moodStart && day.date < date)];
  healthDays.forEach((day) => {
    const values: Array<[string, number | undefined]> = [
      ['apple_exercise_time', day.activity?.exerciseMinutes as number],
      ['active_energy', day.activity?.activeEnergyKJ as number],
      ['walking_running_distance', day.activity?.distanceKm as number],
      ['step_count', day.activity?.steps as number],
      ['apple_stand_time', day.activity?.standMinutes as number],
      ['flights_climbed', day.activity?.flightsClimbed as number],
      ['time_in_daylight', day.activity?.daylightMinutes as number],
      ['heart_rate_variability', day.heart?.hrv?.dailyMs],
      ['resting_heart_rate', day.heart?.restingHeartRateBpm],
      ['weight_body_mass', day.bodyMeasurements?.weight?.dailyKg],
      ['body_fat_percentage', day.bodyMeasurements?.bodyFatFraction === undefined ? undefined : day.bodyMeasurements.bodyFatFraction * 100],
      ['body_mass_index', day.bodyMeasurements?.bodyMassIndex],
      ['lean_body_mass', day.bodyMeasurements?.leanBodyMassKg],
    ];
    for (const [name, qty] of values) {
      if (typeof qty !== 'number' || !Number.isFinite(qty)) continue;
      records.set(name, [...(records.get(name) ?? []), {date: day.date, qty}]);
    }
  });
  const moodRecords: StateOfMindRecord[] = healthDays
    .flatMap((day) => (day.mindfulness?.stateOfMindEntries ?? []).map((entry) => ({
      start: dateAtMinute(day.date, entry.minute),
      kind: entry.kind,
      valence: entry.valence,
      valenceClassification: entry.classification,
      labels: entry.labels,
      associations: entry.associations,
    })))
    .filter((record) => typeof record.start === 'string')
    .sort((left, right) => (left.start || '').localeCompare(right.start || ''));
  const medicationRecords: MedicationRecord[] = healthDays
    .flatMap((day) => (day.medications?.doses ?? []).map((dose) => ({
      displayText: dose.name,
      scheduledDate: dateAtMinute(day.date, dose.scheduledMinute),
      start: dateAtMinute(day.date, dose.takenMinute),
      status: dose.status,
      dosage: dose.dosage,
      scheduledDosage: dose.scheduledDosage,
    })))
    .filter((record) => (record.scheduledDate || record.start || '').slice(0, 10) === date)
    .sort((left, right) => String(left.scheduledDate || left.start).localeCompare(String(right.scheduledDate || right.start)));
  const recordForDate = (name: string): HealthMetricRecord | undefined =>
    records.get(name)?.find((record) => record.date?.slice(0, 10) === date);
  const valueForDate = (name: string): number | null => {
    const value = recordForDate(name)?.qty;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };
  const previousWeekMedian = (name: string): number | null => {
    const start = shiftDate(date, -7);
    const values = (records.get(name) ?? [])
      .filter((record): record is HealthMetricRecord & {date: string; qty: number} => (
        typeof record.date === 'string' && record.date >= start && record.date < date
        && typeof record.qty === 'number' && Number.isFinite(record.qty)
      ))
      .map((record) => record.qty)
      .sort((left, right) => left - right);
    if (values.length < 4) return null;
    const middle = Math.floor(values.length / 2);
    return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  };

  const exerciseMinutes = valueForDate('apple_exercise_time');
  const exerciseRecords = records.get('apple_exercise_time') ?? [];
  const exerciseByDate = new Map(exerciseRecords
    .filter((record): record is HealthMetricRecord & {date: string; qty: number} => (
      typeof record.date === 'string' && typeof record.qty === 'number' && Number.isFinite(record.qty)
    ))
    .map((record) => [record.date.slice(0, 10), record.qty]));
  const weightKg = valueForDate('weight_body_mass');
  const weightRecords = records.get('weight_body_mass') ?? [];
  const previousWeight = weightRecords
    ?.filter((record) => record.date && record.date.slice(0, 10) < date && typeof record.qty === 'number')
    .sort((left, right) => (right.date || '').localeCompare(left.date || ''))[0];
  const previousBodyFat = (records.get('body_fat_percentage') ?? [])
    .filter((record) => record.date && record.date.slice(0, 10) < date && typeof record.qty === 'number' && Number.isFinite(record.qty))
    .sort((left, right) => (right.date || '').localeCompare(left.date || ''))[0];
  const weightTrend = weightRecords
    .filter((record): record is HealthMetricRecord & {date: string; qty: number} => (
      typeof record.date === 'string'
      && record.date.slice(0, 10) >= moodStart
      && record.date.slice(0, 10) <= date
      && typeof record.qty === 'number'
      && Number.isFinite(record.qty)
    ))
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((record) => ({date: record.date.slice(0, 10), weightKg: record.qty}));
  const weight = weightKg === null ? null : {
    date,
    weightKg,
    previousWeightKg: typeof previousWeight?.qty === 'number' && Number.isFinite(previousWeight.qty) ? previousWeight.qty : null,
    previousWeightDate: previousWeight?.date?.slice(0, 10) ?? null,
    previousBodyFatPercentage: previousBodyFat?.qty ?? null,
    previousBodyFatDate: previousBodyFat?.date?.slice(0, 10) ?? null,
    bodyFatPercentage: valueForDate('body_fat_percentage'),
    bmi: valueForDate('body_mass_index'),
    leanBodyMassKg: valueForDate('lean_body_mass'),
    trend: weightTrend,
  };
  const currentMoodRecords = moodRecords.filter((record) => formatMoodDate(record.start) === date);
  const primaryMood = [...currentMoodRecords].reverse().find((record) => record.kind === 'daily_mood')
    ?? currentMoodRecords.at(-1);
  const timeline: HealthTimelineSummary = {
    date,
    hrvMs: valueForDate('heart_rate_variability'),
    hrvSource: currentDay.heart?.hrv?.source,
    hrvMeasurements: (currentDay.heart?.hrv?.measurements ?? [])
      .filter(([minute, value]) => Number.isFinite(minute) && Number.isFinite(value))
      .sort((left, right) => left[0] - right[0]),
    hrvBaselineMs: previousWeekMedian('heart_rate_variability'),
    restingHeartRateBpm: valueForDate('resting_heart_rate'),
    restingHeartRateBaselineBpm: previousWeekMedian('resting_heart_rate'),
    daylightMinutes: valueForDate('time_in_daylight'),
    daylightPeriods: (currentDay.activity?.daylightPeriods ?? [])
      .filter(([start, end, duration]) => [start, end, duration].every(Number.isFinite)
        && start >= 0 && end <= 1440 && end > start && duration > 0)
      .sort((left, right) => left[0] - right[0]),
    sleepStages: currentDay.sleep?.stages ?? [],
    movementPeriods: currentDay.activity?.movementPeriods ?? [],
    environmentSoundDb: currentDay.hearing?.environmentalAudioExposureDbASPL ?? null,
    environmentSoundFile: currentDay.files?.['metrics/hearing/environmental_audio_exposure.json.gz']?.path,
    timelineFiles: additionalHealthMetricFiles(currentDay.files ?? {}, {
      heart_rate: currentDay.heart?.heartRate?.averageBpm,
      resting_heart_rate: currentDay.heart?.restingHeartRateBpm,
      walking_heart_rate_average: currentDay.heart?.walkingHeartRateBpm,
      respiratory_rate: currentDay.respiratory?.respiratoryRatePerMinute,
      blood_oxygen_saturation: currentDay.respiratory?.bloodOxygenFraction === undefined ? undefined : currentDay.respiratory.bloodOxygenFraction * 100,
      apple_sleeping_wrist_temperature: currentDay.vitalSigns?.wristTemperatureCelsius,
      step_count: valueForDate('step_count') ?? undefined,
      walking_running_distance: valueForDate('walking_running_distance') ?? undefined,
      flights_climbed: valueForDate('flights_climbed') ?? undefined,
      apple_exercise_time: valueForDate('apple_exercise_time') ?? undefined,
      apple_stand_time: valueForDate('apple_stand_time') ?? undefined,
      apple_stand_hour: currentDay.activity?.standHours as number | undefined,
      active_energy: valueForDate('active_energy') ?? undefined,
      basal_energy_burned: currentDay.activity?.restingEnergyKJ as number | undefined,
      cycling_distance: currentDay.activity?.cyclingDistanceKm as number | undefined,
      handwashing: currentDay.activity?.handwashingSeconds as number | undefined,
      physical_effort: currentDay.activity?.physicalEffortKcalPerHourKg as number | undefined,
      walking_step_length: currentDay.activityCapability?.walkingStepLengthM === undefined ? undefined : currentDay.activityCapability.walkingStepLengthM * 100,
      walking_speed: currentDay.activityCapability?.walkingSpeedMps === undefined ? undefined : currentDay.activityCapability.walkingSpeedMps * 3.6,
      walking_asymmetry_percentage: currentDay.activityCapability?.walkingAsymmetryPercent,
      walking_double_support_percentage: currentDay.activityCapability?.walkingDoubleSupportPercent,
      stair_speed_up: currentDay.activityCapability?.stairAscentSpeedMps,
      stair_speed_down: currentDay.activityCapability?.stairDescentSpeedMps,
      weight_body_mass: currentDay.bodyMeasurements?.weight?.dailyKg,
      body_fat_percentage: currentDay.bodyMeasurements?.bodyFatFraction === undefined ? undefined : currentDay.bodyMeasurements.bodyFatFraction * 100,
      lean_body_mass: currentDay.bodyMeasurements?.leanBodyMassKg,
      body_mass_index: currentDay.bodyMeasurements?.bodyMassIndex,
      vo2_max: currentDay.activity?.vo2MaxMlKgMin as number | undefined,
    }),
    timelineRows: indexHealthTimelineRows({
      standMinutes: valueForDate('apple_stand_time') ?? undefined,
      standPeriods: currentDay.activity?.standPeriods,
      workouts: currentDay.activity?.workouts,
    }),
  };
  const activity = exerciseMinutes === null ? null : {
    date,
    exerciseMinutes,
    timeline,
    activeEnergyKJ: valueForDate('active_energy'),
    distanceKm: valueForDate('walking_running_distance'),
    steps: valueForDate('step_count'),
    standMinutes: valueForDate('apple_stand_time'),
    flightsClimbed: valueForDate('flights_climbed'),
    daylightMinutes: valueForDate('time_in_daylight'),
    trend: Array.from({length: 7}, (_, index) => {
      const trendDate = shiftDate(trendStart, index);
      return {date: trendDate, minutes: exerciseByDate.get(trendDate) ?? null};
    }),
  };
  const mood = primaryMood ? {
    ...timeline,
    primary: primaryMood,
    records: currentMoodRecords,
    recordedDays: new Set(moodRecords
      .map((record) => formatMoodDate(record.start))
      .filter((recordDate): recordDate is string => Boolean(
        recordDate && recordDate >= moodStart && recordDate <= date,
      ))).size,
  } : null;
  const medication = medicationRecords.length > 0 ? {
    date,
    records: medicationRecords,
    taken: medicationRecords.filter((record) => record.status === '已服用').length,
  } : null;

  return activity || weight || mood || medication ? {activity, weight, mood, medication} : null;
}

function dateAtMinute(date: string, value?: number): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const minute = Math.round(value);
  return `${date} ${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00 +0800`;
}

function MetricPopover({label, ariaLabel, children, wide = false, scrollable = false}: {label: string; ariaLabel: string; children: ReactNode; wide?: boolean; scrollable?: boolean}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  return (
    <Popover.Root lazyMount unmountOnExit initialFocusEl={wide || scrollable ? () => contentRef.current : undefined}
      onOpenChange={({open}) => {if (open && (wide || scrollable)) requestAnimationFrame(() => {if (bodyRef.current) bodyRef.current.scrollTop = 0;});}}
      positioning={{placement: 'bottom-start', gutter: 8, strategy: 'fixed', hideWhenDetached: true, overlap: wide, overflowPadding: wide ? 12 : undefined, sizeMiddleware: !wide}}>
      <Popover.Trigger asChild>
        <button type="button" className={styles.metricTrigger} aria-label={ariaLabel}>{label}</button>
      </Popover.Trigger>
      <Portal>
        <Popover.Positioner>
          <Popover.Content ref={contentRef} className={`${styles.metricPopover} ${wide ? styles.sleepPopover : ''} ${scrollable ? styles.scrollablePopover : ''}`}>
            <Popover.Body ref={bodyRef} className={styles.metricPopoverBody}>{children}</Popover.Body>
            <Popover.CloseTrigger className={styles.metricPopoverClose} aria-label="关闭详情">
              <XIcon size={15} />
            </Popover.CloseTrigger>
          </Popover.Content>
        </Popover.Positioner>
      </Portal>
    </Popover.Root>
  );
}

function formatCompactDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return hours > 0 ? `${hours}h${String(remainingMinutes).padStart(2, '0')}` : `${minutes}m`;
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}小时${minutes % 60}分钟` : `${minutes}分钟`;
}

function formatReadingTrendTime(minutes: number): string {
  if (minutes < 60) return `${minutes}分`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}时${remainingMinutes}分` : `${hours}时`;
}

function SevenDayBars({
  values,
  maximum,
  formatValue,
  ariaLabel,
  currentDate,
}: {
  values: Array<{date: string; value: number | null}>;
  maximum: number;
  formatValue: (value: number) => string;
  ariaLabel: string;
  currentDate: string;
}) {
  return (
    <div className={styles.sevenDayBars} role="img" aria-label={ariaLabel}>
      {values.map(({date, value}) => (
        <div
          key={date}
          className={[
            date === currentDate ? styles.sevenDayCurrent : '',
            value === null ? styles.sevenDayMissing : '',
          ].filter(Boolean).join(' ') || undefined}
        >
          <div className={styles.sevenDayBarPlot}>
            {value !== null && value > 0 ? (
              <i style={{height: `${Math.max(4, value / maximum * 100)}%`}}>
                <span>{formatValue(value)}</span>
              </i>
            ) : value === 0 ? <b aria-hidden="true" /> : null}
          </div>
          <small>{Number(date.slice(-2))}日</small>
        </div>
      ))}
    </div>
  );
}

function SleepTrend({data, selectedDate, onSelect}: {data: SleepScoreSummary; selectedDate: string; onSelect: (date: string) => void}) {
  const trendStart = shiftDate(data.date, -6);
  const values = Array.from({length: 7}, (_, index) => {
    const date = shiftDate(trendStart, index);
    return data.trend.find((item) => item.date === date) ?? {date, score: null, durationMinutes: null};
  });
  const scores = values.flatMap((item) => typeof item.score === 'number' ? [item.score] : []);
  const durations = values.flatMap((item) => typeof item.durationMinutes === 'number' ? [item.durationMinutes] : []);
  const averageScore = Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
  const averageDuration = Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length);
  const currentScore = data.trend.find((item) => item.date === selectedDate)?.score ?? averageScore;
  const width = 272;
  const height = 72;
  const top = 14;
  const bottom = 5;
  const durationMaximum = Math.max(600, Math.ceil(Math.max(...durations) / 120) * 120);
  const points = values.map((item, index) => ({
    ...item,
    x: (index + 0.5) * width / 7,
    y: typeof item.score === 'number'
      ? top + (100 - item.score) / 100 * (height - top - bottom)
      : null,
  }));

  return (
    <div className={styles.metricTrend}>
      <div className={styles.metricTrendHeader}>
        <span>近 7 天</span>
        <strong>均分 {averageScore}</strong>
      </div>
      <div className={styles.sleepTrendLegend} aria-hidden="true">
        <span><i />评分 0–100分</span>
        <span><b />时长 0–{durationMaximum / 60}小时</span>
      </div>
      <div className={styles.sleepTrendPlot}>
        <svg className={styles.sleepTrendChart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`近 7 天睡眠平均 ${averageScore} 分，平均时长 ${formatDuration(averageDuration)}；评分范围 0 至 100 分，时长范围 0 至 ${durationMaximum / 60} 小时`}>
          {[top, height - bottom].map((y) => <line key={y} className={styles.sleepTrendGuide} x1="0" y1={y} x2={width} y2={y} />)}
          {points.map((point) => point.durationMinutes !== null && (
            <rect
              data-date={point.date}
              key={`bar-${point.date}`}
              className={point.date === selectedDate ? styles.sleepTrendCurrentBar : undefined}
              x={point.x - 7}
              y={height - bottom - point.durationMinutes / durationMaximum * (height - top - bottom)}
              width="14"
              height={point.durationMinutes / durationMaximum * (height - top - bottom)}
              rx="2"
            />
          ))}
          {points.slice(0, -1).map((point, index) => {
            const next = points[index + 1];
            return point.y !== null && next.y !== null
              ? <line key={`line-${point.date}`} x1={point.x} y1={point.y} x2={next.x} y2={next.y} />
              : null;
          })}
          {points.map((point) => point.y !== null && (
            <g data-date={point.date} key={`point-${point.date}`} className={point.date === selectedDate ? styles.sleepTrendCurrentPoint : undefined}>
              <circle cx={point.x} cy={point.y} r="2.8" />
              <text x={point.x} y={Math.max(8, point.y - 6)} textAnchor="middle">{point.score}</text>
              <title>{formatShortDate(point.date)}：{point.score}分，{point.durationMinutes === null ? '时长暂无' : formatCompactDuration(point.durationMinutes)}</title>
            </g>
          ))}
        </svg>
        <div className={styles.sevenDayLabels} role="group" aria-label="选择睡眠记录日期">
          {values.map((item, index) => (
            <Button
              unstyled
              type="button"
              key={item.date}
              data-sleep-date={item.date}
              style={{'--sleep-day-index': index} as React.CSSProperties}
              className={[
                styles.sleepTrendDay,
                item.date === selectedDate ? styles.sevenDayCurrent : '',
                item.score === null ? styles.sleepTrendMissing : '',
              ].filter(Boolean).join(' ')}
              disabled={item.score === null}
              aria-pressed={item.date === selectedDate}
              aria-label={`${item.date}，${item.score === null ? '未记录' : `评分${item.score}分，${item.durationMinutes === null ? '时长未记录' : `睡眠${formatDuration(item.durationMinutes)}`}，查看详情`}`}
              onClick={() => onSelect(item.date)}
            >
              <span>{Number(item.date.slice(-2))}日</span>
              <small>{item.durationMinutes === null ? '未记录' : formatCompactDuration(item.durationMinutes)}</small>
            </Button>
          ))}
        </div>
      </div>
      <small className={styles.metricTrendNote}>
        {scores.length}次记录 · 平均睡眠 {formatDuration(averageDuration)} · {currentScore === averageScore ? '评分与均值持平' : `评分较均值${currentScore > averageScore ? '高' : '低'} ${Math.abs(currentScore - averageScore)} 分`}
      </small>
    </div>
  );
}

function SleepScoreDetails({data: summary}: {data: SleepScoreSummary}) {
  const [selectedDate, setSelectedDate] = useState(summary.date);
  useEffect(() => setSelectedDate(summary.date), [summary.date]);
  const data = summary.trend.find((item) => item.date === selectedDate) ?? summary;
  const components = [
    ['bedtime', '入睡时间', '入睡'],
    ['interruptions', '睡眠中断', '中断'],
    ['duration', '睡眠时长', '醒来'],
  ] as const;
  const currentLevel = sleepScoreLevels.find((level) => level.label === data.classification)
    ?? [...sleepScoreLevels].reverse().find((level) => (data.score || 0) >= level.minimum)
    ?? sleepScoreLevels[0];
  const score = Math.max(0, Math.min(100, data.score || 0));
  const scoreLevel = [...sleepScoreLevels].reverse().find((level) => score >= level.minimum)
    ?? sleepScoreLevels[0];
  const scoreWithinLevel = (score - scoreLevel.minimum) / (scoreLevel.maximum - scoreLevel.minimum || 1);
  const visualScore = scoreLevel.visualStart
    + Math.max(0, Math.min(1, scoreWithinLevel)) * scoreLevel.visualWidth;
  const componentRates = components.map(([key]) => {
    const item = data.components?.[key];
    return typeof item?.score === 'number' && typeof item.maximum === 'number' && item.maximum > 0
      ? item.score / item.maximum
      : null;
  });
  const availableRates = componentRates.filter((rate): rate is number => rate !== null);
  const lowestRate = availableRates.length > 0 ? Math.min(...availableRates) : null;

  return (
    <Collapsible.Root className={styles.metricDetails} lazyMount unmountOnExit>
      <SleepStageChart
        date={data.date}
        durationMinutes={parseDurationMinutes(data.components?.duration?.detail)}
        score={(
          <Collapsible.Trigger className={styles.sleepScoreButton} aria-label={`睡眠评分${score}分，${currentLevel.label}，查看评分区间`}>
            <span>评分</span>
            <span className={styles.sleepScoreValue}>
              <strong>{score}<small>分</small></strong>
              <span className={styles.sleepScoreRating}>· {currentLevel.label}</span>
            </span>
          </Collapsible.Trigger>
        )}
        scoreDetails={(
          <Collapsible.Content className={styles.sleepScoreDisclosure}>
            <div className={styles.sleepScoreScale} aria-label={`睡眠评分 ${score} 分，评级为${currentLevel.label}`}>
              <div
                className={styles.sleepScoreTrack}
                style={{'--sleep-score': `${visualScore}%`} as React.CSSProperties}
                role="meter"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={score}
                aria-valuetext={`${score} 分，${currentLevel.label}`}
              >
                {sleepScoreLevels.slice(1).map((level) => (
                  <i key={level.label} style={{left: `${level.visualStart}%`}} aria-hidden="true" />
                ))}
              </div>
              <div className={styles.sleepScoreLegend} aria-hidden="true">
                {sleepScoreLevels.map((level) => {
                  const isCurrent = level.label === currentLevel.label;
                  return (
                    <div
                      key={level.label}
                      className={isCurrent ? styles.sleepScoreLevelCurrent : undefined}
                      aria-current={isCurrent ? 'true' : undefined}
                    >
                      <span>{level.label}</span>
                      <small>{level.range}</small>
                    </div>
                  );
                })}
              </div>
            </div>
          </Collapsible.Content>
        )}
      >
        <div className={styles.metricBreakdown}>
          {components.map(([key, label, heading], index) => {
            const item = data.components?.[key];
            const rate = componentRates[index];
            const isLowest = rate !== null && rate === lowestRate;
            return (
              <div key={key} className={isLowest ? styles.metricBreakdownLowest : undefined} role="group" aria-label={label}>
                <span>{heading}</span>
                <strong><span className={styles.metricBreakdownScoreLabel}>{key === 'duration' ? '时长' : heading}评分</span>{item?.score ?? '—'} <span className={styles.metricBreakdownMaximum}>/ {item?.maximum ?? '—'}</span></strong>
                {rate !== null && (
                  <div
                    className={styles.metricBreakdownTrack}
                    role="progressbar"
                    aria-label={`${label}得分率`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(rate * 100)}
                  >
                    <div style={{width: `${Math.max(0, Math.min(100, rate * 100))}%`}} />
                  </div>
                )}
                {item?.detail && <small>{item.detail}</small>}
              </div>
            );
          })}
        </div>
        <SleepTrend data={summary} selectedDate={data.date} onSelect={setSelectedDate} />
        {data.source && <footer>来源：{data.source}</footer>}
      </SleepStageChart>
    </Collapsible.Root>
  );
}

function moodRecordType(record: StateOfMindRecord): string {
  return stateOfMindTerm(record.kind, STATE_OF_MIND_KIND_LABELS);
}

function formatMoodTime(value: string | undefined): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Shanghai',
  }).format(parsed);
}

function formatMoodDate(value: string | undefined): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Shanghai',
  }).formatToParts(parsed);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

type ContextPeriod = HealthTimelinePeriod;
type ContextRow = {id: string; name: string; axisLabel?: string; colorIndex: number; periods: ContextPeriod[]; summary: string; range?: [number, number]; secondary?: boolean};
type SoundPeriod = [number, number, number];
const dailyMetricNames = new Set(['resting_heart_rate', 'walking_heart_rate_average', 'vo2_max']);
const moodMetricNames = new Set(['resting_heart_rate', 'heart_rate', 'headphone_audio_exposure']);
const activityMetricNames = new Set([
  'apple_exercise_time', 'step_count', 'walking_running_distance', 'cycling_distance', 'active_energy',
  'apple_stand_time', 'walking_heart_rate_average', 'vo2_max',
]);
const extraActivityMetricNames = new Set([
  'basal_energy_burned', 'physical_effort', 'apple_stand_hour', 'flights_climbed', 'walking_speed', 'walking_step_length',
  'walking_double_support_percentage', 'walking_asymmetry_percentage', 'handwashing',
]);
const healthTimelineOrder = [
  'sleep', 'apple_exercise_time', 'workouts', 'movement', 'daylight', 'sound', 'headphone_audio_exposure',
  'heart_rate', 'respiratory_rate', 'blood_oxygen_saturation', 'step_count', 'walking_running_distance',
  'cycling_distance', 'active_energy', 'basal_energy_burned', 'physical_effort', 'standing-periods', 'apple_stand_time',
  'apple_stand_hour', 'flights_climbed', 'walking_speed', 'walking_step_length',
  'walking_double_support_percentage', 'walking_asymmetry_percentage', 'handwashing',
];

async function loadHealthDetail(date: string, path: string, signal: AbortSignal): Promise<HealthMetricPayload> {
  const response = await fetch(staticAssetUrl(`/data/health/${date.slice(0, 7).replace('-', '/')}/${path}`), {signal});
  if (!response.ok) throw new Error('Health detail unavailable');
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const stream = new Blob([buffer]).stream();
  return await new Response(bytes[0] === 0x1f && bytes[1] === 0x8b
    ? stream.pipeThrough(new DecompressionStream('gzip')) : stream).json() as HealthMetricPayload;
}

async function loadEnvironmentSound(date: string, path: string, signal: AbortSignal): Promise<SoundPeriod[]> {
  const payload = await loadHealthDetail(date, path, signal);
  const metric = payload.metric;
  if (payload.version !== 5 || payload.date !== date || metric?.name !== 'environmental_audio_exposure'
    || metric.units !== 'dBASPL' || !Array.isArray(metric.columns) || !Array.isArray(metric.rows)) {
    throw new Error('Invalid environment sound data');
  }
  const column = (name: string) => metric.columns!.indexOf(name);
  const startColumn = column('startMinute');
  const dateColumn = column('dateMinute');
  const endColumn = column('endMinute');
  const valueColumn = column('qty');
  if (valueColumn < 0 || (startColumn < 0 && dateColumn < 0)) throw new Error('Missing sound columns');
  return metric.rows.flatMap((row): SoundPeriod[] => {
    const start = row[startColumn] ?? row[dateColumn];
    const end = row[endColumn] ?? start;
    const value = row[valueColumn];
    if (typeof start !== 'number' || typeof end !== 'number' || typeof value !== 'number'
      || ![start, end, value].every(Number.isFinite) || end < start || end < 0 || start >= 1440) return [];
    return [[Math.max(0, start), Math.min(1440, end), value]];
  }).sort((left, right) => left[0] - right[0]);
}

function HealthDayTimeline({data, sleepScore = null, mode = 'mood'}: {data: HealthTimelineSummary; sleepScore?: SleepScoreSummary | null; mode?: 'mood' | 'activity' | 'activity-extra'}) {
  const showHrv = mode === 'mood';
  const {colorMode} = useColorMode();
  const chartId = useId();
  const detailId = useId();
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<ReactECharts>(null);
  const [sleepDetailsElement, setSleepDetailsElement] = useState<HTMLDivElement | null>(null);
  const [detailElement, setDetailElement] = useState<HTMLDivElement | null>(null);
  const [detail, setDetail] = useState<{rowId: string; dataIndex: number} | null>(null);
  const [detailHeight, setDetailHeight] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [sleepOpen, setSleepOpen] = useState(false);
  const [sleepHeight, setSleepHeight] = useState(0);
  const [palette, setPalette] = useState<string[]>([]);
  const [chartWidth, setChartWidth] = useState(0);
  const [selected, setSelected] = useState<{seriesIndex: number; dataIndex: number} | null>(null);
  const metricFiles = useMemo(() => data.timelineFiles.filter((file) => (mode === 'mood' ? moodMetricNames : mode === 'activity' ? activityMetricNames : extraActivityMetricNames).has(file.name)
    && !(file.name === 'apple_stand_time' && data.timelineRows.some((row) => row.id === 'standing-periods'))), [data.timelineFiles, data.timelineRows, mode]);
  const [additionalMetrics, setAdditionalMetrics] = useState<HealthTimelineRow[]>(() => metricFiles.map(pendingHealthMetricRow));
  const measurements = useMemo(() => showHrv ? data.hrvMeasurements : [], [showHrv, data.hrvMeasurements]);
  const timeLeft = 112;
  const timeRight = 16;
  const bandTop = 26;
  const rowHeight = 40;
  const contextTop = showHrv ? (expanded ? 268 : 66) : bandTop;
  const sleepSummary = sleepScore?.date === data.date ? sleepScore : null;
  const formatTime = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(Math.floor(minute % 60)).padStart(2, '0')}`;
  const sourceName = (source: string) => source === 'watch' ? 'Apple Watch' : source;
  const [sound, setSound] = useState<{status: 'loading' | 'ready' | 'error' | 'missing'; periods: SoundPeriod[]}>({
    status: data.environmentSoundFile ? 'loading' : 'missing', periods: [],
  });
  useEffect(() => {
    const controller = new AbortController();
    const files = metricFiles;
    setAdditionalMetrics(files.map(pendingHealthMetricRow));
    let next = 0;
    const worker = async () => {
      while (!controller.signal.aborted && next < files.length) {
        const file = files[next++];
        let row: HealthTimelineRow;
        try {
          row = parseHealthMetricTimeline(data.date, file, await loadHealthDetail(data.date, file.path, controller.signal));
        } catch {
          row = {...pendingHealthMetricRow(file), summary: '明细暂不可用'};
        }
        if (!controller.signal.aborted) setAdditionalMetrics((previous) => previous.map((item) => item.id === row.id ? row : item));
      }
    };
    void Promise.all(Array.from({length: Math.min(4, files.length)}, worker));
    return () => controller.abort();
  }, [data.date, metricFiles]);
  useEffect(() => {
    const controller = new AbortController();
    if (mode !== 'mood' || !data.environmentSoundFile) {
      setSound({status: 'missing', periods: []});
      return;
    }
    setSound({status: 'loading', periods: []});
    loadEnvironmentSound(data.date, data.environmentSoundFile, controller.signal)
      .then((periods) => {if (!controller.signal.aborted) setSound({status: 'ready', periods});})
      .catch(() => {if (!controller.signal.aborted) setSound({status: 'error', periods: []});});
    return () => controller.abort();
  }, [data.date, data.environmentSoundFile, mode]);
  const dailyMetrics = useMemo(() => {
    const rows = additionalMetrics.filter((row) => dailyMetricNames.has(row.id));
    if (showHrv && data.restingHeartRateBpm !== null && !data.timelineFiles.some((file) => file.name === 'resting_heart_rate')) {
      rows.unshift({id: 'resting_heart_rate', name: '静息心率', axisLabel: '静息率', periods: [], summary: `${Math.round(data.restingHeartRateBpm)} 次/分`});
    }
    const order = [...dailyMetricNames];
    return rows.sort((left, right) => order.indexOf(left.id) - order.indexOf(right.id));
  }, [additionalMetrics, data.restingHeartRateBpm, data.timelineFiles, showHrv]);
  const contextRows = useMemo<ContextRow[]>(() => {
    const rows: ContextRow[] = [];
    const sleep: Array<[number, number]> = [];
    const stages = data.sleepStages.filter(([start, end, stage]) => [start, end].every(Number.isFinite)
      && end > start && end > 0 && start < 1440 && ['core', 'deep', 'rem', 'asleep', '睡眠时长'].includes(stage))
      .map(([start, end]): [number, number] => [Math.max(0, start), Math.min(1440, end)])
      .sort((left, right) => left[0] - right[0]);
    for (const [start, end] of stages) {
      const previous = sleep.at(-1);
      if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
      else sleep.push([start, end]);
    }
    if (showHrv && sleep.length) rows.push({
      id: 'sleep', name: '睡眠', colorIndex: 7,
      periods: sleep.map(([start, end]) => ({start, end, detail: `睡眠 ${(end - start).toFixed(1)} 分钟`})),
      summary: typeof sleepSummary?.score === 'number' ? `${Math.round(sleepSummary.score)}分`
        : `${Math.round(sleep.reduce((sum, [start, end]) => sum + end - start, 0))} 分钟`,
    });
    const movement = data.movementPeriods.filter(([start, end]) => [start, end].every(Number.isFinite)
      && end > start && end > 0 && start < 1440)
      .map(([start, end, steps, distanceKm]) => ({
        start: Math.max(0, start), end: Math.min(1440, end),
        detail: ['移动记录覆盖时段（含采样间隔）', typeof steps === 'number' && Number.isFinite(steps) ? `约 ${Math.round(steps)} 步` : '',
          typeof distanceKm === 'number' && Number.isFinite(distanceKm) ? `${distanceKm.toFixed(2)} 公里` : ''].filter(Boolean).join(' · '),
      }));
    if (mode !== 'activity' && movement.length) rows.push({id: 'movement', name: '移动记录', colorIndex: 1, periods: movement, secondary: true,
      summary: `覆盖 ${Math.round(healthTimelineCoverageMinutes(movement))} 分钟 · ${movement.length} 个移动片段（含采样间隔，非实际运动时长）`});
    if (showHrv && (data.daylightMinutes !== null || data.daylightPeriods.length)) rows.push({
      id: 'daylight', name: '日照', colorIndex: 5,
      periods: data.daylightPeriods.map(([start, end, duration]) => ({start, end, detail: `累计日照 ${duration.toFixed(1)} 分钟`})),
      summary: `${data.daylightMinutes === null ? '' : `${Math.round(data.daylightMinutes)} 分钟 · `}${data.daylightPeriods.length ? `${data.daylightPeriods.length} 个主要时段` : '暂无分时时段'}`,
    });
    if (showHrv && (data.environmentSoundFile || data.environmentSoundDb !== null)) rows.push({
      id: 'sound', name: '声音', colorIndex: 9,
      periods: sound.periods.map(([start, end, value]) => ({start, end, value, detail: `环境声音 ${value.toFixed(1)} dBA`})),
      summary: sound.status === 'loading' ? '正在加载采样…' : sound.status === 'error' ? '声音明细暂不可用'
        : `${data.environmentSoundDb === null ? '' : `日汇总 ${data.environmentSoundDb.toFixed(1)} dBA · `}${sound.periods.length ? `${sound.periods.length} 条采样` : '暂无声音采样'}`,
    });
    rows.push(...data.timelineRows.filter((row) => mode === 'activity' && ['standing-periods', 'workouts'].includes(row.id))
      .map((row) => ({...row, colorIndex: row.id === 'standing-periods' ? 8 : 9})));
    rows.push(...additionalMetrics.filter((row) => !dailyMetricNames.has(row.id)).map((row) => ({...row, colorIndex: 9})));
    const rank = (id: string) => {
      const index = healthTimelineOrder.indexOf(id);
      return index < 0 ? healthTimelineOrder.length : index;
    };
    return rows.sort((left, right) => rank(left.id) - rank(right.id) || left.id.localeCompare(right.id));
  }, [data.sleepStages, data.movementPeriods, data.daylightPeriods, data.daylightMinutes, data.environmentSoundFile, data.environmentSoundDb, data.timelineRows, additionalMetrics, sound, sleepSummary, showHrv, mode]);
  const sleepRowIndex = contextRows.findIndex((row) => row.name === '睡眠');
  const detailRowIndex = contextRows.findIndex((row) => row.id === detail?.rowId);
  const detailRow = contextRows[detailRowIndex];
  const detailPeriod = detailRow?.periods[detail?.dataIndex ?? 0];
  const detailOffset = detailRow ? detailHeight + 12 : 0;
  const sleepOffset = sleepOpen ? sleepHeight + 16 : 0;
  const contextBandTop = (index: number) => contextTop + index * rowHeight + (index > sleepRowIndex ? sleepOffset : 0)
    + (detailRowIndex >= 0 && index > detailRowIndex ? detailOffset : 0);
  const chartHeight = contextRows.length ? contextBandTop(contextRows.length - 1) + 40
    + (detailRowIndex === contextRows.length - 1 ? detailOffset : 0) : (expanded ? 288 : 80);
  useEffect(() => {
    if (!detailElement || !detailRow) return;
    let frame = 0;
    const measure = () => setDetailHeight(Math.ceil(detailElement.getBoundingClientRect().height));
    measure();
    const observer = new ResizeObserver(() => {cancelAnimationFrame(frame); frame = requestAnimationFrame(measure);});
    observer.observe(detailElement);
    return () => {observer.disconnect(); cancelAnimationFrame(frame);};
  }, [detailElement, detailRow]);
  useEffect(() => {
    const element = sleepDetailsElement;
    if (!sleepOpen || !element) return;
    const measure = () => setSleepHeight(Math.ceil(element.getBoundingClientRect().height));
    measure();
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(element);
    return () => {observer.disconnect(); cancelAnimationFrame(frame);};
  }, [sleepOpen, sleepDetailsElement]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const instance = chart.current?.getEchartsInstance();
      if (!instance || !container.current) return;
      instance.resize({width: container.current.clientWidth, height: container.current.clientHeight});
      if (selected?.seriesIndex === 0) {
        instance.dispatchAction({type: 'showTip', seriesIndex: expanded ? contextRows.length + 1 : 0, dataIndex: selected.dataIndex});
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [expanded]);
  useEffect(() => {
    if (!container.current) return;
    const css = getComputedStyle(container.current);
    setPalette(['--ifm-color-primary', '--ifm-color-emphasis-600', '--ifm-color-emphasis-200', '--ifm-background-surface-color', '--ifm-font-color-base', '--daylight-color', '--ifm-color-emphasis-100', '--context-sleep-color', '--context-movement-color', '--context-sound-color', '--hrv-low-color', '--hrv-high-color', '--timeline-low-color', '--timeline-high-color']
      .map((name) => css.getPropertyValue(name).trim()));
  }, [colorMode]);
  useEffect(() => {
    if (!container.current) return;
    let frame = 0;
    const observer = new ResizeObserver(([entry]) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const instance = chart.current?.getEchartsInstance();
        const {width, height} = entry.contentRect;
        setChartWidth(width);
        if (instance && width > 0 && (instance.getWidth() !== width || instance.getHeight() !== height)) {
          instance.resize({width, height});
        }
      });
    });
    observer.observe(container.current);
    return () => {observer.disconnect(); cancelAnimationFrame(frame);};
  }, []);
  const tooltipPosition = (point: number[], size: {contentSize: number[]; viewSize: number[]}) => {
    const bounds = container.current?.getBoundingClientRect();
    const body = container.current?.closest('.chakra-popover__body')?.getBoundingClientRect();
    const top = bounds ? Math.max(0, (body?.top ?? 0) - bounds.top, -bounds.top) + 4 : 4;
    const bottom = bounds ? Math.min(size.viewSize[1], (body?.bottom ?? window.innerHeight) - bounds.top, window.innerHeight - bounds.top) - 4 : size.viewSize[1] - 4;
    const y = point[1] + size.contentSize[1] + 12 <= bottom ? point[1] + 12 : point[1] - size.contentSize[1] - 12;
    return [Math.max(4, Math.min(size.viewSize[0] - size.contentSize[0] - 4, point[0] + 12)),
      Math.max(top, Math.min(bottom - size.contentSize[1], y))];
  };
  const option = useMemo<EChartsOption>(() => {
    const wrapTooltip = (text: string) => text.split('\n').flatMap((line) => {
      const lines: string[] = [];
      let current = '';
      for (const character of line) {
        if (current && echartsFormat.getTextRect(current + character, '12px sans-serif').width > Math.max(120, Math.min(280, chartWidth - 48))) {
          lines.push(current);
          current = '';
        }
        current += character;
      }
      return [...lines, current];
    }).join('\n');
    const hrvColor = (value: number) => echartsColor.lerp(Math.max(0, Math.min(1, value / 100)), [palette[10], palette[11]]) ?? palette[0];
    const timeAxis = {
      type: 'value' as const, min: 0, max: 1440, interval: chartWidth - timeLeft - timeRight < 200 ? 720 : 360,
      axisLabel: {color: palette[1], fontSize: 10, formatter: formatTime},
      axisLine: {show: true, lineStyle: {color: palette[2]}},
      axisTick: {show: false}, splitLine: {show: false},
    };
    const contextSeries = contextRows.map((row, index): CustomSeriesOption => ({
      type: 'custom', name: row.name, xAxisIndex: index + 1, yAxisIndex: index + 1,
      data: row.periods.map((period) => [period.start, period.end, period.value ?? 0, period.statistic ? 1 : 0]), encode: {x: [0, 1], y: []},
      tooltip: {trigger: 'item'},
      renderItem: (_params, api) => {
        const start = api.coord([api.value(0), 0]);
        const end = api.coord([api.value(1), 0]);
        const point = Number(api.value(0)) === Number(api.value(1));
        const statistic = Number(api.value(3)) === 1;
        const fraction = row.range && row.range[1] > row.range[0] ? (Number(api.value(2)) - row.range[0]) / (row.range[1] - row.range[0]) : 0.5;
        const fill = row.range ? echartsColor.lerp(Math.max(0, Math.min(1, fraction)), [palette[12], palette[13]]) : palette[row.colorIndex];
        return {
          type: 'rect',
          shape: {x: start[0] - (point ? 2 : 0), y: start[1] - 5, width: point ? 4 : Math.max(1, end[0] - start[0]), height: 10, r: 2},
          style: {fill, stroke: statistic ? fill : undefined, lineWidth: statistic ? 1 : 0, lineDash: statistic ? [3, 2] : undefined,
            opacity: row.secondary ? 0.5 : statistic ? 0.45 : row.name === '声音' ? 0.15 + 0.85 * Math.max(0, Math.min(1, (Number(api.value(2)) - 30) / 70)) : 1},
          emphasis: {style: {stroke: palette[row.colorIndex], lineWidth: 1}},
        };
      },
    }));
    return {
      animation: false,
      grid: [
        {left: timeLeft, right: timeRight, top: bandTop, height: 14, outerBoundsMode: 'none'},
        ...contextRows.map((_row, index) => ({left: timeLeft, right: timeRight, top: contextBandTop(index), height: 14, outerBoundsMode: 'none' as const})),
        ...(expanded ? [{left: 30, right: timeRight, top: 76, height: 120, outerBoundsMode: 'none' as const}] : []),
      ],
      tooltip: {
        trigger: 'item',
        triggerOn: 'mousemove',
        confine: true,
        renderMode: 'richText',
        backgroundColor: palette[3],
        borderColor: palette[2],
        textStyle: {color: palette[4], fontSize: 11},
        position: (point, _params, _element, _rect, size) => tooltipPosition(point, size),
        axisPointer: {type: 'line', snap: true, lineStyle: {color: palette[1], type: 'dotted'}},
        formatter: (params) => {
          const point = Array.isArray(params) ? params[0] : params;
          if (point.seriesIndex && point.seriesIndex > 0 && point.seriesIndex <= contextRows.length) {
            const period = contextRows[point.seriesIndex - 1]?.periods[point.dataIndex];
            return period ? wrapTooltip(`${healthTimelinePeriodLabel(period)}\n${period.detail}`) : '';
          }
          const measurement = measurements[point.dataIndex];
          if (!measurement) return '';
          return wrapTooltip(`${formatTime(measurement[0])}\nHRV ${measurement[1].toFixed(1)} 毫秒\n${sourceName(measurement[2])}`);
        },
      },
      xAxis: [
        {...timeAxis, position: 'top', axisLabel: {...timeAxis.axisLabel, show: true, fontSize: 9, margin: 0}, axisLine: {show: false}},
        ...contextRows.map((_row, index) => ({...timeAxis, gridIndex: index + 1,
          axisLabel: {...timeAxis.axisLabel, show: index === contextRows.length - 1}, axisLine: {show: false}})),
        ...(expanded ? [{...timeAxis, gridIndex: contextRows.length + 1,
          axisLabel: {...timeAxis.axisLabel, show: contextRows.length === 0}}] : []),
      ],
      yAxis: [{
        type: 'category', data: ['HRV'],
        axisLabel: {show: false},
        axisLine: {show: false}, axisTick: {show: false},
        splitArea: {show: showHrv, areaStyle: {color: [palette[6]]}},
      }, ...contextRows.map((row, index) => ({
        type: 'category' as const, gridIndex: index + 1, data: [row.axisLabel ?? row.name],
        axisLabel: {show: false},
        axisLine: {show: false}, axisTick: {show: false},
        splitArea: {show: true, areaStyle: {color: [palette[6]]}},
      })), ...(expanded ? [{
        type: 'value' as const, gridIndex: contextRows.length + 1, min: 0, splitNumber: 3,
        name: '毫秒', nameGap: 9, nameTextStyle: {color: palette[1], fontSize: 10},
        axisLabel: {color: palette[1], fontSize: 10},
        splitLine: {lineStyle: {color: palette[2]}},
      }] : [])],
      series: [{
        type: 'custom', name: 'HRV',
        data: measurements.map(([minute, value]) => [minute, value]),
        encode: {x: 0, y: []}, tooltip: {trigger: 'item'},
        renderItem: (_params, api) => {
          const point = api.coord([api.value(0), 0]);
          return {
            type: 'rect', cursor: 'pointer',
            shape: {x: point[0] - 2, y: point[1] - 5, width: 4, height: 10, r: 1},
            style: {fill: hrvColor(Number(api.value(1)))},
            emphasis: {style: {stroke: hrvColor(Number(api.value(1))), lineWidth: 2}},
          };
        },
      }, ...contextSeries, ...(expanded ? [{
        type: 'scatter' as const, name: 'HRV 读数', xAxisIndex: contextRows.length + 1, yAxisIndex: contextRows.length + 1,
        data: measurements.map(([minute, value]) => ({value: [minute, value], itemStyle: {color: hrvColor(value)}})),
        symbolSize: 8,
        emphasis: {scale: 1.5},
        markLine: data.hrvMs === null ? undefined : {
          silent: true, symbol: 'none', label: {show: false},
          lineStyle: {color: palette[1], type: 'dashed' as const, width: 1},
          data: [{yAxis: data.hrvMs}],
        },
      }] : [])],
    };
  }, [measurements, data.hrvMs, contextRows, palette, chartWidth, expanded, sleepRowIndex, sleepOffset, showHrv, detailRowIndex, detailOffset]);
  const selectedMeasurement = selected?.seriesIndex === 0 ? measurements[selected.dataIndex] : null;
  const selectHrvAt = (clientX: number) => {
    if (!container.current) return;
    const bounds = container.current.getBoundingClientRect();
    const minute = Math.max(0, Math.min(1, (clientX - bounds.left - timeLeft) / (bounds.width - timeLeft - timeRight))) * 1440;
    const nearest = measurements.reduce((best, measurement, index) => Math.abs(measurement[0] - minute) < Math.abs(measurements[best][0] - minute) ? index : best, 0);
    setSelected((previous) => previous?.seriesIndex === 0 && previous.dataIndex === nearest ? previous : {seriesIndex: 0, dataIndex: nearest});
    chart.current?.getEchartsInstance().dispatchAction({type: 'hideTip'});
  };
  const selectSleepAt = (clientX: number) => {
    if (!container.current || sleepRowIndex < 0) return;
    const bounds = container.current.getBoundingClientRect();
    const minute = Math.max(0, Math.min(1, (clientX - bounds.left - timeLeft) / (bounds.width - timeLeft - timeRight))) * 1440;
    const periods = contextRows[sleepRowIndex].periods;
    const distance = (period: ContextPeriod) => Math.max(period.start - minute, minute - period.end, 0);
    const nearest = periods.reduce((best, period, index) => distance(period) < distance(periods[best]) ? index : best, 0);
    setSelected({seriesIndex: sleepRowIndex + 1, dataIndex: nearest});
    chart.current?.getEchartsInstance().dispatchAction({type: 'hideTip'});
  };
  const selectContextAt = (index: number, clientX: number) => {
    const periods = contextRows[index].periods;
    if (!container.current || !periods.length) return 0;
    const bounds = container.current.getBoundingClientRect();
    const minute = Math.max(0, Math.min(1, (clientX - bounds.left - timeLeft) / (bounds.width - timeLeft - timeRight))) * 1440;
    const distance = (period: ContextPeriod) => Math.max(period.start - minute, minute - period.end, 0);
    const nearest = periods.reduce((best, period, item) => distance(period) < distance(periods[best]) ? item : best, 0);
    setSelected({seriesIndex: index + 1, dataIndex: nearest});
    chart.current?.getEchartsInstance().dispatchAction({type: 'hideTip'});
    return nearest;
  };
  const hoverTimelineAt = (seriesIndex: number, clientX: number, clientY: number) => {
    const instance = chart.current?.getEchartsInstance();
    if (!container.current || !instance) return;
    const bounds = container.current.getBoundingClientRect();
    const x = clientX - bounds.left;
    const y = clientY - bounds.top;
    const width = bounds.width - timeLeft - timeRight;
    const rowTop = seriesIndex === 0 ? bandTop : contextBandTop(seriesIndex - 1);
    const minute = (x - timeLeft) / width * 1440;
    const periods = seriesIndex === 0 ? measurements.map(([start]) => ({start, end: start})) : contextRows[seriesIndex - 1].periods;
    const tolerance = 4 / width * 1440;
    const distance = (period: {start: number; end: number}) => Math.max(period.start - minute, minute - period.end, 0);
    const nearest = periods.reduce((best, period, index) => best < 0 || distance(period) < distance(periods[best]) ? index : best, -1);
    const dataIndex = x >= timeLeft && x <= bounds.width - timeRight && Math.abs(y - rowTop - 7) <= 9
      && nearest >= 0 && distance(periods[nearest]) <= tolerance ? nearest : -1;
    if (dataIndex < 0) {
      instance.dispatchAction({type: 'hideTip'});
      return;
    }
    instance.dispatchAction({type: 'showTip', seriesIndex, dataIndex,
      position: (_point: unknown, _params: unknown, _element: unknown, _rect: unknown, size: {contentSize: number[]; viewSize: number[]}) => [
        ...tooltipPosition([x, y], size),
      ],
    });
  };
  const chartEvents = useMemo(() => ({click: (event: {seriesIndex?: number; dataIndex?: number}) => {
    if (typeof event.dataIndex === 'number' && (event.seriesIndex ?? 0) > contextRows.length) {
      setSelected({seriesIndex: 0, dataIndex: event.dataIndex});
    }
  }}), [contextRows.length]);
  const toggleDetail = (index: number, dataIndex: number) => {
    const rowId = contextRows[index].id;
    setDetail((previous) => previous?.rowId === rowId && previous.dataIndex === dataIndex ? null : {rowId, dataIndex});
  };
  const renderMetricCards = (rows: HealthTimelineRow[], title: string) => rows.length > 0 && (
    <section className={styles.moodDailyMetrics} aria-label={title}>
      <div className={styles.hrvMeasurementsHeading}>{title}</div>
      <dl>
        {rows.map((row) => <div key={row.id}>
          <dt>{row.name}</dt>
          <dd>
            <span title={row.summary}>{compactHealthMetricSummary(row)}</span>
            {row.id === 'resting_heart_rate' && data.restingHeartRateBaselineBpm !== null
              ? <small>前 7 日中位数 {Math.round(data.restingHeartRateBaselineBpm)} 次/分</small>
              : row.periods.length === 1 && row.periods[0].start === row.periods[0].end
                ? <small>{formatTime(row.periods[0].start)} 测量</small> : null}
          </dd>
        </div>)}
      </dl>
    </section>
  );
  return (
    <>
      {renderMetricCards(dailyMetrics, showHrv ? '身体状态参考' : '运动能力参考')}
      <div className={styles.hrvMeasurementsHeading}>{showHrv ? '健康与生活时段' : mode === 'activity' ? '主要活动时段' : '其他活动指标'}</div>
      <Collapsible.Root open={Boolean(detailRow)} onOpenChange={({open}) => {if (!open) setDetail(null);}} lazyMount unmountOnExit>
        <div ref={container} className={styles.hrvChart} style={{height: chartHeight}} tabIndex={0} role="group"
          aria-label={`${showHrv ? `HRV 采样时间带${expanded ? '与分时散点图，纵轴为毫秒' : ''}，共 ${measurements.length} 次测量。点击 HRV 时间带或按 Enter 展开、收起散点图。` : '运动与活动时间带。'}横轴为全天时间。点击各行就近展开明细，再点同一记录收起。${sleepRowIndex >= 0 ? '点击睡眠行展开完整睡眠详情。' : ''}${contextRows.length ? `下方为${contextRows.map((row) => row.name).join('、')}时间带，上下方向键切换数据行，` : ''}左右方向键查看记录，Home 和 End 跳到首尾，Enter 展开或收起当前行`}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            const series = [...(measurements.length ? [0] : []), ...contextRows.flatMap((row, index) => row.periods.length ? [index + 1] : [])];
            if (!series.length) return;
            let seriesIndex = selected?.seriesIndex ?? series[0];
            if (!series.includes(seriesIndex)) seriesIndex = series[0];
            let next: number;
            const count = seriesIndex === 0 ? measurements.length : contextRows[seriesIndex - 1].periods.length;
            const position = Math.max(0, series.indexOf(seriesIndex));
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              if (seriesIndex === 0) setExpanded((value) => !value);
              else if (seriesIndex === sleepRowIndex + 1) setSleepOpen((value) => !value);
              else toggleDetail(seriesIndex - 1, selected?.dataIndex ?? 0);
              return;
            }
            if (event.key === 'ArrowDown' && series.length > 1) {seriesIndex = series[Math.min(series.length - 1, position + 1)]; next = 0;}
            else if (event.key === 'ArrowUp') {seriesIndex = series[Math.max(0, position - 1)]; next = 0;}
            else if (event.key === 'ArrowRight') next = selected === null ? 0 : Math.min(count - 1, selected.dataIndex + 1);
            else if (event.key === 'ArrowLeft') next = selected === null ? count - 1 : Math.max(0, selected.dataIndex - 1);
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = count - 1;
            else return;
            event.preventDefault();
            setSelected({seriesIndex, dataIndex: next});
            setDetail(seriesIndex > 0 && seriesIndex !== sleepRowIndex + 1 ? {rowId: contextRows[seriesIndex - 1].id, dataIndex: next} : null);
            const scroller = container.current?.closest<HTMLElement>('.chakra-popover__body');
            if (scroller && container.current) {
              const rowY = seriesIndex === 0 ? bandTop + 7 : contextBandTop(seriesIndex - 1) + 7;
              const y = container.current.getBoundingClientRect().top + rowY;
              const bounds = scroller.getBoundingClientRect();
              if (y < bounds.top + 36) scroller.scrollTop += y - bounds.top - 36;
              else if (y > bounds.bottom - 24) scroller.scrollTop += y - bounds.bottom + 24;
            }
            chart.current?.getEchartsInstance().dispatchAction({type: 'showTip', seriesIndex: seriesIndex === 0 && expanded ? contextRows.length + 1 : seriesIndex, dataIndex: next});
          }}>
          {showHrv && <div className={styles.timelineRowHeading} style={{top: bandTop - 9, color: palette[11]}}>
            <div><strong>HRV</strong><span>{data.hrvMs === null ? `${measurements.length} 次采样` : `${Math.round(data.hrvMs)} 毫秒`}</span></div>
          </div>}
          {contextRows.map((row, index) => <div key={row.id} className={`${styles.timelineRowHeading} ${row.secondary ? styles.timelineSecondary : ''}`}
            style={{top: contextBandTop(index) - 9, color: palette[row.colorIndex]}} title={`${row.name} · ${row.summary}`}>
            <div><strong>{row.name}</strong><span>{row.secondary ? '辅助参考' : compactHealthMetricSummary(row)}</span></div>
          </div>)}
          {showHrv && <Button unstyled className={styles.hrvBandToggle} disabled={!measurements.length} aria-expanded={expanded} aria-controls={chartId}
            aria-label={`HRV 采样时间带，${expanded ? '收起' : '展开'}散点图`}
            onClick={(event) => {if (event.detail > 0) selectHrvAt(event.clientX); setExpanded((value) => !value);}}
            onPointerMove={(event) => {if (event.pointerType === 'mouse') hoverTimelineAt(0, event.clientX, event.clientY);}}
            onPointerLeave={() => chart.current?.getEchartsInstance().dispatchAction({type: 'hideTip'})}>
            <span aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
          </Button>}
          {sleepRowIndex >= 0 && <Button unstyled className={`${styles.hrvBandToggle} ${styles.sleepBandToggle}`}
              style={{top: contextBandTop(sleepRowIndex) - 13}}
              aria-expanded={sleepOpen} aria-controls={`${chartId}-sleep`}
              aria-label={`睡眠时间带，${sleepOpen ? '收起' : '展开'}睡眠详情`}
              onClick={(event) => {if (event.detail > 0) selectSleepAt(event.clientX); setSleepOpen((value) => !value);}}
              onPointerMove={(event) => {if (event.pointerType === 'mouse') hoverTimelineAt(sleepRowIndex + 1, event.clientX, event.clientY);}}
              onPointerLeave={() => chart.current?.getEchartsInstance().dispatchAction({type: 'hideTip'})}>
              <span aria-hidden="true">{sleepOpen ? '⌃' : '⌄'}</span>
            </Button>}
          {contextRows.map((row, index) => row.id !== 'sleep' && <Button key={row.id} unstyled
            className={`${styles.hrvBandToggle} ${styles.contextBandToggle}`} data-timeline-row={row.id}
            style={{top: contextBandTop(index) - 13}} aria-expanded={detail?.rowId === row.id} aria-controls={detailId}
            aria-label={`${row.name}时间带，${detail?.rowId === row.id ? '收起' : '展开'}明细`}
            onClick={(event) => toggleDetail(index, event.detail > 0 ? selectContextAt(index, event.clientX) : selected?.seriesIndex === index + 1 ? selected.dataIndex : 0)}
            onPointerMove={(event) => {if (event.pointerType === 'mouse') hoverTimelineAt(index + 1, event.clientX, event.clientY);}}
            onPointerLeave={() => chart.current?.getEchartsInstance().dispatchAction({type: 'hideTip'})}>
            <span aria-hidden="true">{detail?.rowId === row.id ? '⌃' : '⌄'}</span>
          </Button>)}
          {expanded && <div className={styles.hrvInlineSelection} style={{top: 204}} aria-live="polite">
            {selectedMeasurement ? `${formatTime(selectedMeasurement[0])} · ${selectedMeasurement[1].toFixed(1)} 毫秒 · ${sourceName(selectedMeasurement[2])}` : '点击散点查看 HRV 测量值'}
            <small>{data.hrvMs !== null ? `虚线为日汇总 ${Math.round(data.hrvMs)} 毫秒` : ''}{data.hrvBaselineMs !== null ? ` · 前 7 日中位数 ${Math.round(data.hrvBaselineMs)} 毫秒` : ''}</small>
          </div>}
          <div id={chartId} style={{height: '100%'}}>{palette.length > 0 && <ReactECharts ref={chart} option={option} notMerge autoResize={false} opts={{renderer: 'svg'}} style={{height: '100%'}} onEvents={chartEvents} />}</div>
          <Collapsible.Root open={sleepOpen} onOpenChange={({open}) => setSleepOpen(open)} lazyMount unmountOnExit>
            <Collapsible.Content id={`${chartId}-sleep`} ref={setSleepDetailsElement} className={`${styles.sleepPopover} ${styles.embeddedSleepDetails}`}
              style={{top: contextBandTop(sleepRowIndex) + 24}}>
              {sleepSummary ? <SleepScoreDetails data={sleepSummary} />
                : <SleepStageChart date={data.date} durationMinutes={null} score={null} scoreDetails={null}>{null}</SleepStageChart>}
            </Collapsible.Content>
          </Collapsible.Root>
          <Collapsible.Content id={detailId} ref={setDetailElement} className={styles.timelineInlineDetails}
            style={{top: contextBandTop(detailRowIndex) + 24}} aria-live="polite">
            {detailRow && <>
              <div className={styles.timelineDetailHeading}><strong>{detailRow.name}</strong>
                <Button unstyled onClick={() => {
                  [...(container.current?.querySelectorAll<HTMLButtonElement>('[data-timeline-row]') ?? [])].find((button) => button.dataset.timelineRow === detailRow.id)?.focus();
                  setDetail(null);
                }}>收起</Button>
              </div>
              <div>{detailRow.summary}</div>
              {detailPeriod && <p><time>{healthTimelinePeriodLabel(detailPeriod)}</time>{detailPeriod.detail}</p>}
              {detailRow.range && <small>深浅仅表示这项指标当日数值的高低，不代表健康好坏，也不用于跨指标比较。</small>}
            </>}
          </Collapsible.Content>
        </div>
      </Collapsible.Root>
      {showHrv && <div className={styles.hrvLegend}><span aria-hidden="true" />HRV 浅→深：0–100+ 毫秒</div>}
      {sound.periods.length > 0 && <div className={styles.soundLegend}><span aria-hidden="true" />声音浅→深：30–100 dBA；灰底无采样</div>}
      <div className={styles.timelineLegend}>灰色阶：各指标当日数值由低到高；纯色带：记录时段；灰底：无记录。颜色不代表健康好坏，不同指标之间不可比较深浅。</div>
      <div className={styles.timelineLegend}>点击时间带就近查看明细，再点同一记录收起。密集记录按 5 分钟汇总，采样合计可能与日汇总不同。</div>
    </>
  );
}

function MoodDetails({data, sleepScore}: {data: MoodSummary; sleepScore: SleepScoreSummary | null}) {
  const primaryLabel = stateOfMindTerm(data.primary.valenceClassification, STATE_OF_MIND_CLASSIFICATION_LABELS);
  return (
    <div className={styles.metricDetails}>
      <header>
        <span>心理状态 · {formatShortDate(data.date)}</span>
        <strong>{primaryLabel}</strong>
      </header>
      <div className={styles.moodRecords}>
        {data.records.map((record, index) => {
          const feelings = (record.labels ?? []).map((label) => stateOfMindTerm(label, STATE_OF_MIND_FEELING_LABELS));
          const associations = (record.associations ?? []).map((label) => stateOfMindTerm(label, STATE_OF_MIND_ASSOCIATION_LABELS));
          const time = formatMoodTime(record.start);
          return (
            <section key={`${record.start ?? data.date}-${index}`}>
              <div className={styles.moodRecordHeader}>
                {data.records.length > 1 && (
                  <strong>{stateOfMindTerm(record.valenceClassification, STATE_OF_MIND_CLASSIFICATION_LABELS)}</strong>
                )}
                <span>{[time, moodRecordType(record)].filter(Boolean).join(' · ')}</span>
              </div>
              {feelings.length > 0 && <p><span>感受</span>{feelings.join(' · ')}</p>}
              {associations.length > 0 && <p><span>关联</span>{associations.join(' · ')}</p>}
            </section>
          );
        })}
      </div>
      <footer>近 30 天心情记录 {data.recordedDays} 天 · 来自 Apple Health 主动记录</footer>
      {(data.hrvMs !== null || data.restingHeartRateBpm !== null || data.hrvMeasurements.length > 0 || data.timelineFiles.length > 0 || data.timelineRows.length > 0 || data.sleepStages.length > 0) && (
        <div className={styles.moodPhysiology}>
          <div className={styles.hrvMeasurements}>
            <HealthDayTimeline key={data.date} data={data} sleepScore={sleepScore} />
          </div>
          <p>HRV 与静息心率受睡眠、运动等因素影响，不能单独判断心情。</p>
        </div>
      )}
    </div>
  );
}

function ActivityDetails({data}: {data: ActivitySummary}) {
  const measuredDays = data.trend.filter((item) => item.minutes !== null);
  const totalMinutes = measuredDays.reduce((sum, item) => sum + (item.minutes ?? 0), 0);
  const activeDays = measuredDays.filter((item) => (item.minutes ?? 0) > 0).length;
  const maximum = Math.max(30, ...measuredDays.map((item) => item.minutes ?? 0));
  return (
    <div className={styles.metricDetails}>
      <header>
        <span>运动 · {formatShortDate(data.date)}</span>
        <strong>{Math.round(data.exerciseMinutes)}<small>分钟</small></strong>
      </header>
      <ActivityDayDetails date={data.date} showTimeline={false}>
        <div className={styles.hrvMeasurements}>
          <HealthDayTimeline key={data.date} data={data.timeline} mode="activity" />
          {(data.timeline.movementPeriods.length > 0 || data.timeline.timelineFiles.some((file) => extraActivityMetricNames.has(file.name))) && <Collapsible.Root className={styles.moreActivityMetrics} lazyMount>
            <Collapsible.Trigger asChild><Button unstyled className={styles.moreMetricsToggle}>
              <span className={styles.moreMetricsClosed}>更多指标</span><span className={styles.moreMetricsOpen}>收起更多指标</span>
              <span aria-hidden="true" className={styles.moreMetricsChevron}>⌄</span>
            </Button></Collapsible.Trigger>
            <Collapsible.Content><HealthDayTimeline data={data.timeline} mode="activity-extra" /></Collapsible.Content>
          </Collapsible.Root>}
        </div>
      </ActivityDayDetails>
      <div className={styles.metricTrend}>
        <div className={styles.metricTrendHeader}>
          <span>近 7 天</span>
          <strong>累计 {Math.round(totalMinutes)}分钟</strong>
        </div>
        <SevenDayBars
          values={data.trend.map((item) => ({date: item.date, value: item.minutes}))}
          maximum={maximum}
          formatValue={(value) => `${Math.round(value)}`}
          ariaLabel={`近 7 天累计运动 ${Math.round(totalMinutes)} 分钟，${activeDays} 天有运动`}
          currentDate={data.date}
        />
        <small className={styles.metricTrendNote}>{activeDays}天有运动</small>
      </div>
      <footer>来源：Apple Health</footer>
    </div>
  );
}

function WeightDetails({data}: {data: WeightSummary}) {
  const weightJin = data.weightKg * 2;
  const weightDeltaJin = data.previousWeightKg === null ? null : (data.weightKg - data.previousWeightKg) * 2;
  const fatDelta = data.bodyFatPercentage !== null && data.previousBodyFatPercentage !== null ? data.bodyFatPercentage - data.previousBodyFatPercentage : null;
  const trendStart = shiftDate(data.date, -29);
  const trendValues = data.trend.map((point) => point.weightKg * 2);
  const trendMinimum = Math.min(...trendValues);
  const trendMaximum = Math.max(...trendValues);
  const trendRange = trendMaximum - trendMinimum;
  const chartWidth = 272;
  const chartHeight = 62;
  const chartPadding = 6;
  const points = data.trend.map((point) => {
    const dayIndex = Math.round((parseDate(point.date).getTime() - parseDate(trendStart).getTime()) / 86400000);
    return {
      ...point,
      weightJin: point.weightKg * 2,
      x: chartPadding + dayIndex / 29 * (chartWidth - chartPadding * 2),
      y: trendRange === 0
        ? chartHeight / 2
        : chartPadding + (trendMaximum - point.weightKg * 2) / trendRange * (chartHeight - chartPadding * 2),
    };
  });
  const trendDelta = trendValues.length > 1 ? trendValues.at(-1)! - trendValues[0] : null;
  const formatDelta = (value: number): string => `${value > 0 ? '+' : ''}${value.toFixed(1)}斤`;
  return (
    <div className={styles.metricDetails}>
      <header>
        <span>体重 · {formatShortDate(data.date)}</span>
        <strong>{weightJin.toFixed(1)}<small>斤</small></strong>
      </header>
      <div className={styles.weightTrend}>
        <div className={styles.weightTrendHeader}>
          <span>近 30 天</span>
          <strong>{trendDelta === null ? `${points.length}次测量` : `变化 ${formatDelta(trendDelta)}`}</strong>
        </div>
        {points.length === 1 ? (
          <div className={styles.weightTrendSparse}>
            <i aria-hidden="true" />
            <span>近 30 天仅 1 次测量</span>
          </div>
        ) : (
          <>
            <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label={`近 30 天体重趋势，共 ${points.length} 次测量`}>
              <line x1={chartPadding} y1={chartHeight - chartPadding} x2={chartWidth - chartPadding} y2={chartHeight - chartPadding} />
              <polyline points={points.map((point) => `${point.x},${point.y}`).join(' ')} />
              {points.map((point) => (
                <circle key={point.date} className={point.date === data.date ? styles.weightTrendCurrent : undefined} cx={point.x} cy={point.y} r="3">
                  <title>{formatShortDate(point.date)} {point.weightJin.toFixed(1)}斤</title>
                </circle>
              ))}
            </svg>
            <div className={styles.weightTrendDates}>
              <span>{formatShortDate(trendStart)}</span>
              <span>{formatShortDate(data.date)}</span>
            </div>
            <small className={styles.metricTrendNote}>{points.length === 2 ? '起止变化' : `${points.length}次测量`}</small>
          </>
        )}
      </div>
      <div className={styles.healthStats}>
        {weightDeltaJin !== null && <div><span>较上次{data.previousWeightDate ? `（${formatShortDate(data.previousWeightDate)}）` : ''}</span><strong>{formatDelta(weightDeltaJin)}</strong></div>}
        {data.bodyFatPercentage !== null && <div><span>体脂</span><strong>{data.bodyFatPercentage.toFixed(1)}%</strong></div>}
        {fatDelta !== null && <div><span>体脂较{data.previousBodyFatDate ? formatShortDate(data.previousBodyFatDate) : '上次'}</span><strong>{fatDelta > 0 ? '+' : ''}{fatDelta.toFixed(1)}个百分点</strong></div>}
        {data.bmi !== null && <div><span>BMI</span><strong>{data.bmi.toFixed(1)}</strong></div>}
        {data.leanBodyMassKg !== null && <div><span>去脂体重</span><strong>{(data.leanBodyMassKg * 2).toFixed(1)}斤</strong></div>}
      </div>
      <footer>来源：Fitdays</footer>
    </div>
  );
}

function ReadingDetails({data}: {data: ReadingSummary}) {
  const books = (data.week?.books || [])
    .map((entry) => ({
      id: entry.id || entry.title,
      title: entry.title,
      seconds: entry.readTime || 0,
    }))
    .filter((entry): entry is {id: string; title: string; seconds: number} => Boolean(entry.id && entry.title && entry.seconds > 0))
    .slice(0, 5);
  const weekStart = data.week?.startDate || startOfWeek(data.date);
  const weekEnd = data.week?.endDate || shiftDate(weekStart, 6);
  const trendMinutes = data.trend.map((item) => ({date: item.date, value: Math.round(item.seconds / 60)}));
  const maximum = Math.max(60, ...trendMinutes.map((item) => item.value));
  return (
    <div className={styles.metricDetails}>
      <header>
        <span>阅读 · {formatShortDate(data.date)}</span>
        <strong>{formatReadingTime(data.day.seconds || 0)}</strong>
      </header>
      <div className={styles.metricTrend}>
        <div className={styles.metricTrendHeader}>
          <span>近 7 天</span>
          <strong>日均 {formatReadingTime(data.sevenDayAverage)}</strong>
        </div>
        <SevenDayBars
          values={trendMinutes}
          maximum={maximum * 1.2}
          formatValue={formatReadingTrendTime}
          ariaLabel={`近 7 天日均阅读 ${formatReadingTime(data.sevenDayAverage)}，连续阅读 ${data.streak} 天`}
          currentDate={data.date}
        />
        <small className={styles.metricTrendNote}>连续阅读{data.streak}天</small>
      </div>
      {books.length > 0 && (
        <div className={styles.readingBooks}>
          <div className={styles.readingBooksHeader}>
            <span>本周阅读最多</span>
            {typeof data.week?.totalReadTime === 'number' && data.week.totalReadTime > 0 && (
              <strong>本周累计 {formatReadingTime(data.week.totalReadTime)}</strong>
            )}
          </div>
          <ul>{books.map((book) => (
            <li key={book.id}>
              <span>{book.title}</span>
              <strong>{formatReadingTime(book.seconds)}</strong>
            </li>
          ))}</ul>
        </div>
      )}
      <footer>{formatShortDate(weekStart)}–{formatShortDate(weekEnd)} · 自然周<br />来源：微信读书</footer>
    </div>
  );
}

function MedicationDetails({data}: {data: MedicationSummary}) {
  return (
    <div className={styles.metricDetails}>
      <header>
        <span>用药 · {formatShortDate(data.date)}</span>
        <strong>{data.taken}/{data.records.length}<small>已服用</small></strong>
      </header>
      <ul className={styles.medicationList}>
        {data.records.map((record, index) => {
          const plannedTime = (record.scheduledDate || record.start || '').slice(11, 16) || '--:--';
          const name = record.displayText || record.nickname || record.name || '用药记录';
          const dosage = record.dosage ?? record.scheduledDosage;
          return (
            <li key={`${name}-${record.scheduledDate || record.start || index}`}>
              <time>{plannedTime}</time>
              <span>
                <strong>{name}</strong>
                <small>{[record.status, typeof dosage === 'number' ? `剂量 ${dosage}` : ''].filter(Boolean).join(' · ')}</small>
              </span>
            </li>
          );
        })}
      </ul>
      <footer>来源：Apple Health</footer>
    </div>
  );
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
      : {label: '调休上班'};
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
  const [readingSummary, setReadingSummary] = useState<ReadingSummary | null>(null);
  const [sleepScore, setSleepScore] = useState<SleepScoreSummary | null>(null);
  const [healthSummary, setHealthSummary] = useState<HealthSummary | null>(null);

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
    ? {label: dayStatusOverride}
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
    setReadingSummary(null);
    if (!date) return;
    const controller = new AbortController();
    loadReadingSummary(date, controller.signal)
      .then(setReadingSummary)
      .catch(() => {});
    return () => controller.abort();
  }, [date]);

  useEffect(() => {
    setSleepScore(null);
    if (!date) return;
    const controller = new AbortController();
    loadSleepScore(date, controller.signal)
      .then(setSleepScore)
      .catch(() => {});
    return () => controller.abort();
  }, [date]);

  useEffect(() => {
    setHealthSummary(null);
    if (!date) return;
    const controller = new AbortController();
    loadHealthSummary(date, controller.signal)
      .then(setHealthSummary)
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
      {(readingSummary !== null || sleepScore !== null || healthSummary !== null) && (
        <div className={styles.dailyDataLine} role="group" aria-label="当天健康与阅读数据">
          {sleepScore !== null && (
            <MetricPopover wide label={`睡眠${sleepScore.score}分`} ariaLabel={`睡眠${sleepScore.score}分，查看详情`}>
              <SleepScoreDetails data={sleepScore} />
            </MetricPopover>
          )}
          {sleepScore !== null && (healthSummary?.mood || healthSummary?.activity || healthSummary?.weight || readingSummary || healthSummary?.medication) && '，'}
          {healthSummary?.mood && (
            <MetricPopover scrollable
              label={`${healthSummary.mood.primary.kind === 'daily_mood' ? '心情' : '感受'}${stateOfMindTerm(healthSummary.mood.primary.valenceClassification, STATE_OF_MIND_CLASSIFICATION_LABELS)}`}
              ariaLabel={`${healthSummary.mood.primary.kind === 'daily_mood' ? '心情' : '感受'}${stateOfMindTerm(healthSummary.mood.primary.valenceClassification, STATE_OF_MIND_CLASSIFICATION_LABELS)}，查看详情`}
            >
              <MoodDetails data={healthSummary.mood} sleepScore={sleepScore} />
            </MetricPopover>
          )}
          {healthSummary?.mood && (healthSummary.activity || healthSummary.weight || readingSummary || healthSummary.medication) && '，'}
          {healthSummary?.activity && (
            <MetricPopover scrollable label={`运动${Math.round(healthSummary.activity.exerciseMinutes)}分钟`} ariaLabel={`运动${Math.round(healthSummary.activity.exerciseMinutes)}分钟，查看详情`}>
              <ActivityDetails data={healthSummary.activity} />
            </MetricPopover>
          )}
          {healthSummary?.activity && (healthSummary.weight || readingSummary || healthSummary.medication) && '，'}
          {healthSummary?.weight && (
            <MetricPopover label={`体重${(healthSummary.weight.weightKg * 2).toFixed(1)}斤`} ariaLabel={`体重${(healthSummary.weight.weightKg * 2).toFixed(1)}斤，查看详情`}>
              <WeightDetails data={healthSummary.weight} />
            </MetricPopover>
          )}
          {healthSummary?.weight && (healthSummary.medication || readingSummary !== null) && '，'}
          {healthSummary?.medication && (
            <MetricPopover
              label={`用药${healthSummary.medication.taken}/${healthSummary.medication.records.length}`}
              ariaLabel={`用药已服用${healthSummary.medication.taken}次，共${healthSummary.medication.records.length}次，查看详情`}
            >
              <MedicationDetails data={healthSummary.medication} />
            </MetricPopover>
          )}
          {healthSummary?.medication && readingSummary !== null && '，'}
          {readingSummary !== null && (
            <MetricPopover label={`阅读${formatReadingTime(readingSummary.day.seconds || 0)}`} ariaLabel={`阅读${formatReadingTime(readingSummary.day.seconds || 0)}，查看详情`}>
              <ReadingDetails data={readingSummary} />
            </MetricPopover>
          )}
        </div>
      )}
    </div>
  );
}
