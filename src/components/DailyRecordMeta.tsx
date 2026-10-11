import React, {type ReactNode, useEffect, useMemo, useState} from 'react';
import {Popover, Portal} from '@chakra-ui/react';
import {useDoc} from '@docusaurus/plugin-content-docs/client';
import XIcon from '@site/src/components/ItsHoverIcon/icons/x-icon';
import {
  summarizeWeather,
  type RawWeatherDay,
  type WeatherSummary,
} from '@site/src/utils/weather';
import {resolvePlace, type ResolvedPlace} from '@site/src/utils/locationResolver';
import {
  STATE_OF_MIND_ASSOCIATION_LABELS,
  STATE_OF_MIND_CLASSIFICATION_LABELS,
  STATE_OF_MIND_FEELING_LABELS,
  STATE_OF_MIND_KIND_LABELS,
  stateOfMindTerm,
} from '@site/src/utils/stateOfMind';
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
  trend: Array<{
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

type HealthMonth = {
  data?: {
    healthMetrics?: {
      metrics?: HealthMetric[];
    };
    stateOfMind?: {
      stateOfMind?: StateOfMindRecord[];
    };
    medications?: {
      medications?: MedicationRecord[];
    };
  };
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

type MoodSummary = {
  date: string;
  primary: StateOfMindRecord;
  records: StateOfMindRecord[];
  recordedDays: number;
};

type ActivitySummary = {
  date: string;
  exerciseMinutes: number;
  activeEnergyKJ: number | null;
  distanceKm: number | null;
  trend: Array<{
    date: string;
    minutes: number | null;
  }>;
};

type WeightSummary = {
  date: string;
  weightKg: number;
  previousWeightKg: number | null;
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
        date: item.date,
        score: item.data.score,
        durationMinutes: parseDurationMinutes(item.data.components?.duration?.detail),
      })),
  };
}

async function loadHealthSummary(date: string, signal: AbortSignal): Promise<HealthSummary | null> {
  const trendStart = shiftDate(date, -6);
  const moodStart = shiftDate(date, -29);
  const months = [...new Set([date.slice(0, 7), trendStart.slice(0, 7), moodStart.slice(0, 7)])];
  const payloads = await Promise.all(months.map(async (monthKey) => {
    const response = await fetch(`/data/health/${monthKey.replace('-', '/')}.json`, {signal});
    return response.ok ? await response.json() as HealthMonth : null;
  }));
  const records = new Map<string, HealthMetricRecord[]>();
  payloads.forEach((payload) => {
    payload?.data?.healthMetrics?.metrics?.forEach((metric) => {
      if (!metric.name) return;
      records.set(metric.name, [...(records.get(metric.name) ?? []), ...(metric.data ?? [])]);
    });
  });
  const moodRecords = payloads
    .flatMap((payload) => payload?.data?.stateOfMind?.stateOfMind ?? [])
    .filter((record) => typeof record.start === 'string')
    .sort((left, right) => (left.start || '').localeCompare(right.start || ''));
  const medicationRecords = payloads
    .flatMap((payload) => payload?.data?.medications?.medications ?? [])
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
    .sort((left, right) => (right.date || '').localeCompare(left.date || ''))[0]?.qty;
  const weightTrend = weightRecords
    .filter((record): record is HealthMetricRecord & {date: string; qty: number} => (
      typeof record.date === 'string'
      && record.date.slice(0, 10) >= trendStart
      && record.date.slice(0, 10) <= date
      && typeof record.qty === 'number'
      && Number.isFinite(record.qty)
    ))
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((record) => ({date: record.date.slice(0, 10), weightKg: record.qty}));
  const activity = exerciseMinutes === null ? null : {
    date,
    exerciseMinutes,
    activeEnergyKJ: valueForDate('active_energy'),
    distanceKm: valueForDate('walking_running_distance'),
    trend: Array.from({length: 7}, (_, index) => {
      const trendDate = shiftDate(trendStart, index);
      return {date: trendDate, minutes: exerciseByDate.get(trendDate) ?? null};
    }),
  };
  const weight = weightKg === null ? null : {
    date,
    weightKg,
    previousWeightKg: typeof previousWeight === 'number' ? previousWeight : null,
    bodyFatPercentage: valueForDate('body_fat_percentage'),
    bmi: valueForDate('body_mass_index'),
    leanBodyMassKg: valueForDate('lean_body_mass'),
    trend: weightTrend,
  };
  const currentMoodRecords = moodRecords.filter((record) => formatMoodDate(record.start) === date);
  const primaryMood = [...currentMoodRecords].reverse().find((record) => record.kind === 'daily_mood')
    ?? currentMoodRecords.at(-1);
  const mood = primaryMood ? {
    date,
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

function MetricPopover({label, ariaLabel, children}: {label: string; ariaLabel: string; children: ReactNode}) {
  return (
    <Popover.Root lazyMount unmountOnExit positioning={{placement: 'bottom-start', gutter: 8, strategy: 'fixed', hideWhenDetached: true}}>
      <Popover.Trigger asChild>
        <button type="button" className={styles.metricTrigger} aria-label={ariaLabel}>{label}</button>
      </Popover.Trigger>
      <Portal>
        <Popover.Positioner>
          <Popover.Content className={styles.metricPopover}>
            <Popover.Body className={styles.metricPopoverBody}>{children}</Popover.Body>
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

function SleepTrend({data}: {data: SleepScoreSummary}) {
  const trendStart = shiftDate(data.date, -6);
  const values = Array.from({length: 7}, (_, index) => {
    const date = shiftDate(trendStart, index);
    return data.trend.find((item) => item.date === date) ?? {date, score: null, durationMinutes: null};
  });
  const scores = values.flatMap((item) => typeof item.score === 'number' ? [item.score] : []);
  const durations = values.flatMap((item) => typeof item.durationMinutes === 'number' ? [item.durationMinutes] : []);
  const averageScore = Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
  const averageDuration = Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length);
  const currentScore = typeof data.score === 'number' ? data.score : averageScore;
  const width = 272;
  const height = 76;
  const paddingX = 10;
  const top = 14;
  const bottom = 5;
  const durationMaximum = Math.max(600, ...durations);
  const scoreMinimum = Math.max(0, Math.min(...scores) - 5);
  const scoreRange = Math.max(10, 100 - scoreMinimum);
  const points = values.map((item, index) => ({
    ...item,
    x: paddingX + index / 6 * (width - paddingX * 2),
    y: typeof item.score === 'number'
      ? top + (100 - item.score) / scoreRange * (height - top - bottom)
      : null,
  }));

  return (
    <div className={styles.metricTrend}>
      <div className={styles.metricTrendHeader}>
        <span>近 7 天</span>
        <strong>均分 {averageScore}</strong>
      </div>
      <div className={styles.sleepTrendLegend} aria-hidden="true">
        <span><i />评分</span>
        <span><b />时长</span>
      </div>
      <svg className={styles.sleepTrendChart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`近 7 天睡眠平均 ${averageScore} 分，平均时长 ${formatCompactDuration(averageDuration)}`}>
        {points.map((point) => point.durationMinutes !== null && (
          <rect
            key={`bar-${point.date}`}
            className={point.date === data.date ? styles.sleepTrendCurrentBar : undefined}
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
          <g key={`point-${point.date}`} className={point.date === data.date ? styles.sleepTrendCurrentPoint : undefined}>
            <circle cx={point.x} cy={point.y} r="2.8" />
            <text x={point.x} y={Math.max(8, point.y - 6)} textAnchor="middle">{point.score}</text>
            <title>{formatShortDate(point.date)}：{point.score}分，{point.durationMinutes === null ? '时长暂无' : formatCompactDuration(point.durationMinutes)}</title>
          </g>
        ))}
      </svg>
      <div className={styles.sevenDayLabels} aria-hidden="true">
        {values.map((item) => (
          <div
            key={item.date}
            className={[
              item.date === data.date ? styles.sevenDayCurrent : '',
              item.score === null ? styles.sevenDayMissing : '',
            ].filter(Boolean).join(' ') || undefined}
          >
            <span>{Number(item.date.slice(-2))}日</span>
            <small>{item.durationMinutes === null ? '' : formatCompactDuration(item.durationMinutes)}</small>
          </div>
        ))}
      </div>
      <small className={styles.metricTrendNote}>
        {scores.length}次记录 · 平均睡眠{formatCompactDuration(averageDuration)} · 当天较均值{currentScore - averageScore > 0 ? '+' : ''}{currentScore - averageScore}
      </small>
    </div>
  );
}

function SleepScoreDetails({data}: {data: SleepScoreSummary}) {
  const components = [
    ['duration', '睡眠时长'],
    ['bedtime', '入睡时间'],
    ['interruptions', '睡眠中断'],
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
    <div className={styles.metricDetails}>
      <header>
        <span>睡眠评分</span>
        <strong>{data.score}<small>/ 100</small></strong>
      </header>
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
      <SleepTrend data={data} />
      <div className={styles.metricBreakdown}>
        {components.map(([key, label], index) => {
          const item = data.components?.[key];
          if (!item) return null;
          const rate = componentRates[index];
          const isLowest = rate !== null && rate === lowestRate;
          return (
            <div key={key} className={isLowest ? styles.metricBreakdownLowest : undefined}>
              <span>{label}</span>
              <strong>{item.score ?? '—'} / {item.maximum ?? '—'}</strong>
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
              {item.detail && <small>{item.detail}</small>}
            </div>
          );
        })}
      </div>
      {data.source && <footer>来源：{data.source}</footer>}
    </div>
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

function MoodDetails({data}: {data: MoodSummary}) {
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
      <footer>近 30 天记录 {data.recordedDays} 天 · 来自 Apple Health 主动记录</footer>
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
      <div className={styles.healthStats}>
        {data.activeEnergyKJ !== null && (
          <div><span>活动能量</span><strong>{Math.round(data.activeEnergyKJ / 4.184)}千卡</strong></div>
        )}
        {data.distanceKm !== null && (
          <div><span>步行与跑步</span><strong>{data.distanceKm.toFixed(1)}公里</strong></div>
        )}
      </div>
      <footer>来源：Apple Health</footer>
    </div>
  );
}

function WeightDetails({data}: {data: WeightSummary}) {
  const weightJin = data.weightKg * 2;
  const weightDeltaJin = data.previousWeightKg === null ? null : (data.weightKg - data.previousWeightKg) * 2;
  const trendStart = shiftDate(data.date, -6);
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
      x: chartPadding + dayIndex / 6 * (chartWidth - chartPadding * 2),
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
          <span>近 7 天</span>
          <strong>{trendDelta === null ? `${points.length}次测量` : `变化 ${formatDelta(trendDelta)}`}</strong>
        </div>
        {points.length === 1 ? (
          <div className={styles.weightTrendSparse}>
            <i aria-hidden="true" />
            <span>近 7 天仅 1 次测量</span>
          </div>
        ) : (
          <>
            <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label={`近 7 天体重趋势，共 ${points.length} 次测量`}>
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
        {weightDeltaJin !== null && <div><span>较上次</span><strong>{formatDelta(weightDeltaJin)}</strong></div>}
        {data.bodyFatPercentage !== null && <div><span>体脂</span><strong>{data.bodyFatPercentage.toFixed(1)}%</strong></div>}
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
      <footer>{formatShortDate(weekStart)}–{formatShortDate(weekEnd)} · 自然周</footer>
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
            <MetricPopover label={`睡眠${sleepScore.score}分`} ariaLabel={`睡眠${sleepScore.score}分，查看详情`}>
              <SleepScoreDetails data={sleepScore} />
            </MetricPopover>
          )}
          {sleepScore !== null && (healthSummary?.mood || healthSummary?.activity || healthSummary?.weight || readingSummary || healthSummary?.medication) && '，'}
          {healthSummary?.mood && (
            <MetricPopover
              label={`${healthSummary.mood.primary.kind === 'daily_mood' ? '心情' : '感受'}${stateOfMindTerm(healthSummary.mood.primary.valenceClassification, STATE_OF_MIND_CLASSIFICATION_LABELS)}`}
              ariaLabel={`${healthSummary.mood.primary.kind === 'daily_mood' ? '心情' : '感受'}${stateOfMindTerm(healthSummary.mood.primary.valenceClassification, STATE_OF_MIND_CLASSIFICATION_LABELS)}，查看详情`}
            >
              <MoodDetails data={healthSummary.mood} />
            </MetricPopover>
          )}
          {healthSummary?.mood && (healthSummary.activity || healthSummary.weight || readingSummary || healthSummary.medication) && '，'}
          {healthSummary?.activity && (
            <MetricPopover label={`运动${Math.round(healthSummary.activity.exerciseMinutes)}分钟`} ariaLabel={`运动${Math.round(healthSummary.activity.exerciseMinutes)}分钟，查看详情`}>
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
