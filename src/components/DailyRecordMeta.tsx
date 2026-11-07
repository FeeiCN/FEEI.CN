import React, {type ReactNode, useEffect, useMemo, useRef, useState} from 'react';
import {Button, Collapsible, Popover, Portal} from '@chakra-ui/react';
import {useDoc} from '@docusaurus/plugin-content-docs/client';
import HealthMetricDetails, {HealthEventItem, HealthTimeBands} from './HealthMetricDetails';
import HealthWorkoutDetails from './HealthWorkoutDetails';
import HealthChart, {HealthDateTrend, healthChartTooltip, useHealthChartColors} from './HealthChart';
import {type EChartsOption} from 'echarts';
import {activityEntryLabel, vitalsEntryLabel, availableHealthMetrics, type HealthDayData} from '@site/src/utils/healthPresentation';
import XIcon from '@site/src/components/ItsHoverIcon/icons/x-icon';
import {
  summarizeWeather,
  type RawWeatherDay,
  type WeatherSummary,
} from '@site/src/utils/weather';
import {resolvePlace, type ResolvedPlace} from '@site/src/utils/locationResolver';
import {staticAssetUrl} from '@site/src/utils/staticAssets';
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
  observations?: {durationDisplay?: string; durationPrecision?: string};
  quality?: {warnings?: Array<{code: string; message: string; time?: string}>};
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

type HealthDay = HealthDayData;

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
  unit?: string;
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
  primary?: StateOfMindRecord;
  history: HealthDay[];
  records: StateOfMindRecord[];
  recordedDays: number;
};

type HealthTimelineSummary = {
  date: string;
  day: HealthDay;
  history: HealthDay[];
};

type ActivitySummary = {
  date: string;
  timeline: HealthTimelineSummary;
  exerciseMinutes: number | null;
  label: string;
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
  weightKg: number | null;
  day: HealthDay;
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
  day: HealthDay;
  vitals: HealthTimelineSummary | null;
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
    const response = await fetch(staticAssetUrl(`/data/sleep-score/${year}/${month}/${day}.json`), {signal, cache: 'no-store'});
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
      displayText: dose.displayText ?? dose.name,
      scheduledDate: dateAtMinute(day.date, dose.scheduledMinute),
      start: dateAtMinute(day.date, dose.takenMinute),
      status: dose.status,
      dosage: dose.dosage,
      scheduledDosage: dose.scheduledDosage,
      unit: dose.unit ?? dose.units,
    })))
    .filter((record) => (record.scheduledDate || record.start || '').slice(0, 10) === date)
    .sort((left, right) => String(left.scheduledDate || left.start).localeCompare(String(right.scheduledDate || right.start)));
  const recordForDate = (name: string): HealthMetricRecord | undefined =>
    records.get(name)?.find((record) => record.date?.slice(0, 10) === date);
  const valueForDate = (name: string): number | null => {
    const value = recordForDate(name)?.qty;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
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
  const weight = !currentDay.bodyMeasurements && !availableHealthMetrics(currentDay, ['body']).length ? null : {
    date,
    day: currentDay,
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
  const timeline: HealthTimelineSummary = {date, day: currentDay, history: healthDays};
  const activityLabel = activityEntryLabel(currentDay);
  const activity = activityLabel === null ? null : {
    date,
    label: activityLabel,
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
  const mood = primaryMood || availableHealthMetrics(currentDay, ['mindfulness']).length ? {
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

  const vitals = availableHealthMetrics(currentDay, ['vitals', 'environment']).length || currentDay.heart?.notifications?.length ? timeline : null;
  return {day: currentDay, activity, weight, mood, medication, vitals};
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
            <Popover.Body ref={bodyRef} className={styles.metricPopoverBody}><HealthTimeBands>{children}</HealthTimeBands></Popover.Body>
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
  const colors = useHealthChartColors();
  const [selection, setSelection] = useState<number | null>(null);
  const option: EChartsOption = {
    animation: false,
    grid: {left: 10, right: 10, top: 25, bottom: 24},
    tooltip: {...healthChartTooltip(colors), trigger: 'item', formatter: (params) => {
      const point = Array.isArray(params) ? params[0] : params;
      const record = values[point.dataIndex];
      return `${record.date}\n${record.value === null ? '未记录' : formatValue(record.value)}`;
    }},
    xAxis: {type: 'category', data: values.map((item) => item.date), axisLine: {lineStyle: {color: colors.border}}, axisTick: {show: false},
      axisLabel: {interval: 0, color: colors.muted, fontSize: 10, formatter: (date: string) => `${Number(date.slice(-2))}日`}},
    yAxis: {type: 'value', min: 0, max: maximum, show: false},
    series: [{type: 'bar', barMaxWidth: 20, barMinHeight: 2, labelLayout: {hideOverlap: true},
      data: values.map((item) => ({value: item.value, itemStyle: {color: colors.primary, opacity: item.date === currentDate ? 1 : 0.55, borderRadius: [3, 3, 0, 0]}})),
      label: {show: true, position: 'top', color: colors.text, fontSize: 9, formatter: (params) => {
        const value = values[params.dataIndex].value;
        return value === null ? '' : formatValue(value);
      }} }],
  };
  return <div role="group" tabIndex={0} aria-label={`${ariaLabel}。左右方向键查看每日数值。`} onKeyDown={(event) => {
    let next: number;
    if (event.key === 'ArrowRight') next = Math.min(values.length - 1, (selection ?? -1) + 1);
    else if (event.key === 'ArrowLeft') next = selection === null ? values.length - 1 : Math.max(0, selection - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = values.length - 1;
    else return;
    event.preventDefault(); setSelection(next);
  }}>
    <HealthChart option={option} height={112} label={ariaLabel} onEvents={{click: (event: {dataIndex: number}) => setSelection(event.dataIndex)}} />
    {selection !== null && <small className={styles.metricTrendNote} aria-live="polite">{values[selection].date} · {values[selection].value === null ? '未记录' : formatValue(values[selection].value!)}</small>}
  </div>;
}

function SleepTrend({data, selectedDate, onSelect}: {data: SleepScoreSummary; selectedDate: string; onSelect: (date: string) => void}) {
  const root = useRef<HTMLDivElement>(null);
  const colors = useHealthChartColors(root);
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
  const durationMaximum = Math.max(600, Math.ceil(Math.max(0, ...durations) / 120) * 120);
  const option: EChartsOption = {
    animation: false,
    grid: {left: 14, right: 14, top: 22, bottom: 4},
    tooltip: {...healthChartTooltip(colors), trigger: 'axis', formatter: (params) => {
      const point = Array.isArray(params) ? params[0] : params;
      const item = values[point.dataIndex];
      return `${item.date}\n评分 ${item.score === null ? '未记录' : `${item.score} 分`}\n时长 ${item.durationMinutes === null ? '未记录' : formatDuration(item.durationMinutes)}`;
    }},
    xAxis: {type: 'category', data: values.map((item) => item.date), show: false},
    yAxis: [{type: 'value', min: 0, max: 100, show: false}, {type: 'value', min: 0, max: durationMaximum, show: false}],
    series: [{type: 'bar', yAxisIndex: 1, barWidth: 14, data: values.map((item) => ({value: item.durationMinutes,
      itemStyle: {color: colors.primary, opacity: item.date === selectedDate ? 0.35 : 0.15, borderRadius: [2, 2, 0, 0]}}))},
      {type: 'line', connectNulls: false, symbol: 'circle', symbolSize: 6, lineStyle: {width: 1.5, color: colors.primary},
        data: values.map((item) => ({value: item.score, symbolSize: item.date === selectedDate ? 9 : 6,
          itemStyle: {color: item.date === selectedDate ? colors.primary : colors.background, borderColor: colors.primary, borderWidth: 2}})),
        label: {show: true, position: 'top', color: colors.text, fontSize: 10}}],
  };

  return (
    <div ref={root} className={styles.metricTrend}>
      <div className={styles.metricTrendHeader}>
        <span>近 7 天</span>
        <strong>均分 {averageScore}</strong>
      </div>
      <div className={styles.sleepTrendLegend} aria-hidden="true">
        <span><i />评分 0–100分</span>
        <span><b />时长 0–{durationMaximum / 60}小时</span>
      </div>
      <div className={styles.sleepTrendPlot}>
        <HealthChart option={option} height={90} label={`近 7 天睡眠平均 ${averageScore} 分，平均时长 ${formatDuration(averageDuration)}；评分范围 0 至 100 分，时长范围 0 至 ${durationMaximum / 60} 小时`}
          onEvents={{click: (event: {dataIndex: number}) => {
            const item = values[event.dataIndex];
            if (typeof item?.score === 'number') onSelect(item.date);
          }}} />
        <div className={styles.sevenDayLabels} role="group" aria-label="选择睡眠记录日期">
          {values.map((item) => (
            <Button
              unstyled
              type="button"
              key={item.date}
              data-sleep-date={item.date}
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
        {data.observations?.durationPrecision === 'display_hours' && data.observations.durationDisplay && (
          <p>健康 App 显示时长：{data.observations.durationDisplay}</p>
        )}
        {data.quality?.warnings?.map((warning) => <p key={warning.code} role="note">{warning.message}</p>)}
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

function HealthSection({title, children, open, onOpenChange}: {title: string; children: ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void}) {
  return <Collapsible.Root className={styles.moreActivityMetrics} lazyMount unmountOnExit open={open} onOpenChange={({open}) => onOpenChange?.(open)}>
    <Collapsible.Trigger className={styles.moreMetricsToggle}>{title}<span aria-hidden="true" className={styles.moreMetricsChevron}>⌄</span></Collapsible.Trigger>
    <Collapsible.Content>{children}</Collapsible.Content>
  </Collapsible.Root>;
}

function VitalsDetails({data}: {data: HealthTimelineSummary}) {
  const labels: Record<string, string> = {high_heart_rate_notification: '高心率通知', low_heart_rate_notification: '低心率通知', irregular_heart_rhythm_notification: '心律不齐通知'};
  return <div className={`${styles.metricDetails} ${styles.healthDetails}`}>
    <header className={styles.vitalsHeading}><strong>体征</strong><span>{formatShortDate(data.date)}</span></header>
    {(data.day.heart?.notifications ?? []).length > 0 && <section className={styles.healthNotifications} aria-label="心率通知">
      <strong>当日心率通知</strong>
      {data.day.heart!.notifications!.map((item, index) => <p key={index}><time>{formatMoodTime(item.start)}</time> {labels[item.heartNotification ?? ''] ?? '心率通知'}{typeof item.threshold === 'number' ? ` · 阈值 ${item.threshold} 次/分` : ''}</p>)}
    </section>}
    <HealthMetricDetails day={data.day} history={data.history} groups={['vitals']} />
    {availableHealthMetrics(data.day, ['environment']).length > 0 && <HealthSection title="生活环境">
      <HealthMetricDetails day={data.day} history={data.history} groups={['environment']} />
      <p className={styles.metricTrendNote}>日照为设备记录的日光暴露时长；声音为采样记录。可作生活背景参考。</p>
    </HealthSection>}
    <footer>HRV、心率等受睡眠、运动和测量条件影响，请结合个人基线观察；不代表心情评分。</footer>
  </div>;
}

function MoodDetails({data, sleepScore}: {data: MoodSummary; sleepScore: SleepScoreSummary | null}) {
  const [view, setView] = useState<'mood' | 'vitals' | 'sleep'>('mood');
  const [referencesOpen, setReferencesOpen] = useState(false);
  const navigationRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (view !== 'mood') navigationRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [view]);
  if (view !== 'mood') return <div className={styles.healthDetails}>
    <div ref={navigationRef}><Button unstyled className={styles.healthBack} onClick={() => {
      setView('mood');
      requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-health-reference="${view}"]`)?.focus());
    }}>← 返回心情</Button></div>
    {view === 'vitals' ? <VitalsDetails data={data} /> : sleepScore ? <SleepScoreDetails data={sleepScore} />
      : <SleepStageChart date={data.date} durationMinutes={null} score={null} scoreDetails={null}>{null}</SleepStageChart>}
  </div>;
  const primaryLabel = data.primary ? stateOfMindTerm(data.primary.valenceClassification, STATE_OF_MIND_CLASSIFICATION_LABELS) : '正念记录';
  const moodTrend = data.history.flatMap((day) => {
    const entries = day.mindfulness?.stateOfMindEntries ?? [];
    const primary = [...entries].reverse().find((entry) => entry.kind === 'daily_mood');
    return typeof primary?.valence === 'number' ? [{date: day.date, value: primary.valence, label: stateOfMindTerm(primary.classification, STATE_OF_MIND_CLASSIFICATION_LABELS)}] : [];
  }).sort((a, b) => a.date.localeCompare(b.date));
  return <div className={`${styles.metricDetails} ${styles.healthDetails}`}>
    <header><span>心情 · {formatShortDate(data.date)}</span><strong>{primaryLabel}</strong></header>
    <div className={styles.moodRecords}>
      {data.records.map((record, index) => {
        const feelings = (record.labels ?? []).map((label) => stateOfMindTerm(label, STATE_OF_MIND_FEELING_LABELS));
        const associations = (record.associations ?? []).map((label) => stateOfMindTerm(label, STATE_OF_MIND_ASSOCIATION_LABELS));
        return <section key={`${record.start ?? data.date}-${index}`}>
          <div className={styles.moodRecordHeader}>
            {data.records.length > 1 && <strong>{stateOfMindTerm(record.valenceClassification, STATE_OF_MIND_CLASSIFICATION_LABELS)}</strong>}
            <span>{[formatMoodTime(record.start), moodRecordType(record)].filter(Boolean).join(' · ')}</span>
          </div>
          {feelings.length > 0 && <p><span>感受</span>{feelings.join(' · ')}</p>}
          {associations.length > 0 && <p><span>关联</span>{associations.join(' · ')}</p>}
        </section>;
      })}
    </div>
    <HealthMetricDetails day={data.day} groups={['mindfulness']} />
    {moodTrend.length > 0 && <section className={styles.healthMoodTrend}>
      <strong>近 30 天心情</strong>
      <HealthDateTrend values={moodTrend.map((item) => ({...item, description: item.label}))} endDate={data.date} minimum={-1} maximum={1} neutral={0} axisLabel={(value) => value === 1 ? '愉快' : value === -1 ? '不愉快' : value === 0 ? '中性' : ''}
        label={`近30天心情，共${moodTrend.length}天主动记录`} />
      <p className={styles.metricTrendNote}>仅显示每日心情；空缺为未记录，瞬时感受另见当日记录。</p>
    </section>}
    <HealthSection title="当天参考" open={referencesOpen} onOpenChange={setReferencesOpen}>
      <div className={styles.healthReferenceLinks}>
        {(sleepScore || data.day.sleep?.stages?.length) && <Button unstyled data-health-reference="sleep" onClick={() => setView('sleep')}>睡眠 {sleepScore ? `${sleepScore.score} 分` : '详情'} →</Button>}
        {(availableHealthMetrics(data.day, ['vitals', 'environment']).length > 0) && <Button unstyled data-health-reference="vitals" onClick={() => setView('vitals')}>体征与生活环境 →</Button>}
      </div>
      <p className={styles.metricTrendNote}>{[
        typeof data.day.heart?.hrv?.dailyMs === 'number' ? `HRV ${Math.round(data.day.heart.hrv.dailyMs)} 毫秒` : '',
        typeof data.day.activity?.daylightMinutes === 'number' ? `日照 ${Math.round(data.day.activity.daylightMinutes)} 分钟` : '',
      ].filter(Boolean).join(' · ')}</p>
      <p className={styles.metricTrendNote}>身体数据作为背景参考，不据此判断心情好坏。</p>
    </HealthSection>
    <footer>近 30 天每日心情 {moodTrend.length} 天 · Apple Health 主动记录</footer>
  </div>;
}

function ActivityDetails({data}: {data: ActivitySummary}) {
  const measuredDays = data.trend.filter((item) => item.minutes !== null);
  const totalMinutes = measuredDays.reduce((sum, item) => sum + (item.minutes ?? 0), 0);
  const activeDays = measuredDays.filter((item) => (item.minutes ?? 0) > 0).length;
  const maximum = Math.max(30, ...measuredDays.map((item) => item.minutes ?? 0));
  return <div className={`${styles.metricDetails} ${styles.healthDetails}`}>
    <header><span>活动 · {formatShortDate(data.date)}</span><strong>{data.label.replace(/^活动|^训练/, '') || '当日记录'}</strong></header>
    <HealthMetricDetails day={data.timeline.day} history={data.timeline.history} groups={['activity']}>
      <HealthWorkoutDetails day={data.timeline.day} />
    </HealthMetricDetails>
    {availableHealthMetrics(data.timeline.day, ['capability']).length > 0 && <HealthSection title="体能与步态"><HealthMetricDetails day={data.timeline.day} history={data.timeline.history} groups={['capability']} /></HealthSection>}
    {(availableHealthMetrics(data.timeline.day, ['other']).length > 0 || (data.timeline.day.activity?.movementPeriods?.length ?? 0) > 0) && <HealthSection title="其他记录">
      <HealthMetricDetails day={data.timeline.day} history={data.timeline.history} groups={['other']}>
        {(data.timeline.day.activity?.movementPeriods?.length ?? 0) > 0 && <HealthEventItem id="movement" label="移动记录" summary="采样覆盖时段" periods={(data.timeline.day.activity?.movementPeriods ?? []).map(([start, end, steps]) => ({start, end, detail: typeof steps === 'number' ? `约 ${Math.round(steps)} 步；记录覆盖时段不等同于实际运动时长` : '记录覆盖时段不等同于实际运动时长'}))} />}
      </HealthMetricDetails>
    </HealthSection>}
    <div className={styles.metricTrend}>
      <div className={styles.metricTrendHeader}><span>近 7 天运动</span><strong>累计 {Math.round(totalMinutes)}分钟</strong></div>
      <SevenDayBars values={data.trend.map((item) => ({date: item.date, value: item.minutes}))} maximum={maximum} formatValue={(value) => `${Math.round(value)}分`}
        ariaLabel={`近 7 天累计运动 ${Math.round(totalMinutes)} 分钟，${activeDays} 天有运动`} currentDate={data.date} />
      <small className={styles.metricTrendNote}>{activeDays}天有运动 · 缺失数据不计为零</small>
    </div>
    <footer>来源：Apple Health</footer>
  </div>;
}

function WeightDetails({data}: {data: WeightSummary}) {
  const weightJin = data.weightKg === null ? null : data.weightKg * 2;
  const weightDeltaJin = data.previousWeightKg === null || data.weightKg === null ? null : (data.weightKg - data.previousWeightKg) * 2;
  const fatDelta = data.bodyFatPercentage !== null && data.previousBodyFatPercentage !== null ? data.bodyFatPercentage - data.previousBodyFatPercentage : null;
  const trendValues = data.trend.map((point) => point.weightKg * 2);
  const points = data.trend.map((point) => ({date: point.date, value: point.weightKg * 2}));
  const trendDelta = trendValues.length > 1 ? trendValues.at(-1)! - trendValues[0] : null;
  const formatDelta = (value: number): string => `${value > 0 ? '+' : ''}${value.toFixed(1)}斤`;
  return (
    <div className={`${styles.metricDetails} ${styles.healthDetails}`}>
      <header>
        <span>身体测量 · {formatShortDate(data.date)}</span>
        <strong>{weightJin === null ? '身体测量' : <>{weightJin.toFixed(1)}<small>斤</small></>}</strong>
      </header>
      {points.length > 0 && <div className={styles.weightTrend}>
        <div className={styles.weightTrendHeader}>
          <span>近 30 天</span>
          <strong>{trendDelta === null ? `${points.length}次测量` : `变化 ${formatDelta(trendDelta)}`}</strong>
        </div>
        <HealthDateTrend values={points} endDate={data.date} unit="斤" connect label={`近30天体重趋势，共${points.length}次测量`} valueLabel={(value) => `${value.toFixed(1)} 斤`} />
        <small className={styles.metricTrendNote}>{points.length === 1 ? '近 30 天仅 1 次测量' : `${points.length}次测量 · 空缺表示未测量`}</small>
      </div>}
      <div className={styles.healthStats}>
        {weightDeltaJin !== null && <div><span>较上次{data.previousWeightDate ? `（${formatShortDate(data.previousWeightDate)}）` : ''}</span><strong>{formatDelta(weightDeltaJin)}</strong></div>}
        {data.bodyFatPercentage !== null && <div><span>体脂</span><strong>{data.bodyFatPercentage.toFixed(1)}%</strong></div>}
        {fatDelta !== null && <div><span>体脂较{data.previousBodyFatDate ? formatShortDate(data.previousBodyFatDate) : '上次'}</span><strong>{fatDelta > 0 ? '+' : ''}{fatDelta.toFixed(1)}个百分点</strong></div>}
        {data.bmi !== null && <div><span>BMI</span><strong>{data.bmi.toFixed(1)}</strong></div>}
        {data.leanBodyMassKg !== null && <div><span>去脂体重</span><strong>{(data.leanBodyMassKg * 2).toFixed(1)}斤</strong></div>}
      </div>
      <HealthSection title="测量详情">
        <HealthMetricDetails day={data.day} groups={['body']} />
        {(data.day.bodyMeasurements?.weight?.measurements ?? []).length > 0 && <ul className={styles.medicationList}>
          {data.day.bodyMeasurements!.weight!.measurements!.map(([minute, kg], index) => <li key={index}><time>{String(Math.floor(minute / 60)).padStart(2, '0')}:{String(Math.floor(minute % 60)).padStart(2, '0')}</time><span>{(kg * 2).toFixed(1)} 斤</span></li>)}
        </ul>}
      </HealthSection>
      <footer>来源：Apple Health 身体测量</footer>
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
    <div className={`${styles.metricDetails} ${styles.healthDetails}`}>
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
              <time>{plannedTime}<small>计划</small></time>
              <span>
                <strong>{name}</strong>
                <small>{record.start ? `实际记录 ${record.start.slice(11, 16)} · ` : ''}{[record.status, typeof dosage === 'number' ? `剂量 ${dosage}${record.unit === 'count' ? ' 单位' : record.unit ? ` ${record.unit}` : ''}` : ''].filter(Boolean).join(' · ')}</small>
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
          {([
            sleepScore ? {key: 'sleep', label: `睡眠${sleepScore.score}分`, content: <SleepScoreDetails data={sleepScore} />, wide: true}
              : healthSummary?.day.sleep?.stages?.length ? {key: 'sleep', label: '睡眠', content: <SleepStageChart date={healthSummary.day.date} durationMinutes={null} score={null} scoreDetails={null}>{null}</SleepStageChart>, wide: true} : null,
            healthSummary?.vitals ? {key: 'vitals', label: vitalsEntryLabel(healthSummary.vitals.day), content: <VitalsDetails data={healthSummary.vitals} />, scrollable: true} : null,
            healthSummary?.mood ? {key: 'mood', label: healthSummary.mood.primary ? `${healthSummary.mood.primary.kind === 'daily_mood' ? '心情' : '感受'}${stateOfMindTerm(healthSummary.mood.primary.valenceClassification, STATE_OF_MIND_CLASSIFICATION_LABELS)}` : '正念', content: <MoodDetails data={healthSummary.mood} sleepScore={sleepScore} />, scrollable: true} : null,
            healthSummary?.activity ? {key: 'activity', label: healthSummary.activity.label, content: <ActivityDetails data={healthSummary.activity} />, scrollable: true} : null,
            healthSummary?.weight ? {key: 'weight', label: healthSummary.weight.weightKg === null ? '身体测量' : `体重${(healthSummary.weight.weightKg * 2).toFixed(1)}斤`, content: <WeightDetails data={healthSummary.weight} />, scrollable: true} : null,
            healthSummary?.medication ? {key: 'medication', label: `用药${healthSummary.medication.taken}/${healthSummary.medication.records.length}`, content: <MedicationDetails data={healthSummary.medication} />, scrollable: true} : null,
            readingSummary ? {key: 'reading', label: `阅读${formatReadingTime(readingSummary.day.seconds || 0)}`, content: <ReadingDetails data={readingSummary} />} : null,
          ].filter((entry) => entry !== null)).map((entry, index) => <React.Fragment key={entry.key}>
            {index > 0 && '，'}<MetricPopover label={entry.label} ariaLabel={`${entry.label}，查看详情`} wide={entry.wide} scrollable={entry.scrollable}>{entry.content}</MetricPopover>
          </React.Fragment>)}
        </div>
      )}
    </div>
  );
}
