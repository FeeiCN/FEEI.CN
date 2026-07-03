import React, {useEffect, useMemo, useRef, useState} from 'react';
import AccountAssetsDashboard from '@site/src/components/AccountAssetsDashboard';
import AlipayInvestDashboard from '@site/src/components/AlipayInvestDashboard';
import BrowserOnly from '@docusaurus/BrowserOnly';
import FinanceAssetsTrend from '@site/src/components/FinanceAssetsTrend';
import {HEALTH_CHART_NAV, HealthProvider, HealthSection, type TimeScope as HealthTimeScope} from '@site/src/components/HealthCharts';
import HKIPOCharts from '@site/src/components/HKIPOCharts';
import ReactECharts from 'echarts-for-react';
import {useColorMode} from '@docusaurus/theme-common';
import styles from './styles.module.css';

type DailyReflectionDashboardProps = {
  initialYear?: number;
  children?: React.ReactNode;
};

type AnalysisInsight = {
  expert_view?: string;
  summary?: string;
  positioning?: string;
  evidence?: string[];
  means?: string;
  not_means?: string;
  uncertainty?: string;
  professional_suggestion?: string;
};

type TopSignal = {
  area?: string;
  summary?: string;
  evidence?: string[];
  confidence?: string;
};

type DataStatus = {
  area?: string;
  status?: string;
  detail?: string;
};

type DailyAnalysis = {
  date?: string;
  generatedAt?: string;
  legacy?: boolean;
  legacy_report_markdown?: string;
  top_signals?: TopSignal[];
  health_insights?: AnalysisInsight[];
  reading_insights?: AnalysisInsight[];
  finance_insights?: AnalysisInsight[];
  ai_insights?: AnalysisInsight[];
  life_log_insights?: AnalysisInsight[];
  environment_mobility_insights?: AnalysisInsight[];
  git_insights?: AnalysisInsight[];
  cross_domain_insights?: Array<{summary?: string; evidence?: string[]; uncertainty?: string}>;
  data_status?: DataStatus[];
  follow_ups?: string[];
};

type Manifest = {
  dates?: string[];
};

type HealthMetric = {
  name?: string;
  units?: string;
  data?: Array<Record<string, unknown>>;
};

type HealthData = {
  exportedAt?: string;
  data?: {
    healthMetrics?: {
      metrics?: HealthMetric[];
    };
  };
};

type DailyHealthTimelineRecord = {
  type?: string;
  stage?: string;
  label?: string;
  level?: string;
  name?: string;
  start?: string;
  end?: string;
  durationMinutes?: number;
  durationSeconds?: number;
  steps?: number;
  distanceKm?: number;
  flights?: number;
  activeEnergyKJ?: number;
  energyKJ?: number;
  energyKcal?: number;
  avgHeartRate?: number;
  maxHeartRate?: number;
  status?: string;
  kind?: string;
  valenceClassification?: string;
  valence?: number;
  labels?: string[];
  associations?: string[];
};

type DailyHealthData = {
  exportedAt?: string;
  date?: string;
  summary?: Record<string, unknown>;
  timeline?: DailyHealthTimelineRecord[];
};

type DriveLog = Record<string, {action?: string; address?: string}>;

type LLMSummaryPayload = {
  fetchedAt?: string;
  daily_token_usage?: Record<string, number>;
};

type ReadingYearPayload = {
  year?: string;
  daily?: Record<string, {seconds?: number; books?: string[]}>;
};

type ObjectivePoint = {
  date: string;
  value: number;
  secondary?: number;
  tertiary?: number;
};

type TokenStackPoint = {
  date: string;
  minimax: number;
  openai: number;
  anthropic: number;
};

type WeatherSummary = {
  description: string;
  temperature: string;
  feelsLike: string;
  humidity: string;
  wind: string;
  precip: string;
  area: string;
};

type TimelineItem = {
  type: 'sleep' | 'drive' | 'weather' | 'workout';
  title: string;
  detail?: string;
  startMinute: number;
  endMinute?: number;
  stage?: string;
};

type TimelineBand = {
  type: 'movement' | 'stand' | 'daylight' | 'stairs' | 'active_energy' | 'handwashing';
  startMinute: number;
  endMinute: number;
  intensity: number;
  title: string;
  detail?: string;
};

type SleepSegment = {
  stage?: string;
  label: string;
  startMinute: number;
  endMinute: number;
};

type SleepBlock = {
  startMinute: number;
  endMinute: number;
  detail: string;
  segments: SleepSegment[];
};

type TimelineModel = {
  items: TimelineItem[];
  bands: TimelineBand[];
  sleep: SleepBlock | null;
  weather: TimelineItem[];
};

type TimelineTooltip = {
  text: React.ReactNode;
  x: number;
  y: number;
};

type CalendarCell = {
  date: string;
  score: number;
  hasDaily: boolean;
  hasAnalysis: boolean;
  isElapsed: boolean;
};

type CalendarHover = CalendarCell & {
  x: number;
  y: number;
};

type DataDomain = 'health' | 'career' | 'finance' | 'life';
type DailyDetailTab = 'diary' | 'timeline' | 'analysis';
type FinanceTab = 'income' | 'expense' | 'investment';
type ObjectiveTimeScope =
  | {mode: 'recent'; range: '7d' | '30d' | '90d' | '1y'}
  | {mode: 'year'; year: number}
  | {mode: 'all'};

const OBJECTIVE_RANGE_LABELS: Record<string, string> = {'7d': '7天', '30d': '30天', '90d': '90天', '1y': '近1年'};
const RANGE_DAYS: Record<'7d' | '30d' | '90d' | '1y', number> = {'7d': 7, '30d': 30, '90d': 90, '1y': 365};
const LLM_VENDOR_CONFIGS = [
  {id: 'minimax', label: 'MiniMax', path: '/data/llm-usage/minimax/usage_summary.json'},
  {id: 'openai', label: 'OpenAI', path: '/data/llm-usage/openai/usage_summary.json'},
  {id: 'anthropic', label: 'Anthropic', path: '/data/llm-usage/anthropic/usage_summary.json'},
];

const MONTH_LABELS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
const LIFE_START_DATE = '1992-01-01';
const LIFE_END_DATE = '2092-12-31';
const HANGZHOU_LATITUDE = 30.2741;
const HANGZHOU_LONGITUDE = 120.1551;
const WEATHER_CODE_LABELS: Record<number, string> = {
  0: '晴',
  1: '大部晴朗',
  2: '局部多云',
  3: '阴',
  45: '雾',
  48: '雾凇',
  51: '小毛毛雨',
  53: '毛毛雨',
  55: '强毛毛雨',
  56: '冻毛毛雨',
  57: '强冻毛毛雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  66: '冻雨',
  67: '强冻雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  77: '雪粒',
  80: '小阵雨',
  81: '阵雨',
  82: '强阵雨',
  85: '小阵雪',
  86: '强阵雪',
  95: '雷暴',
  96: '雷暴伴小冰雹',
  99: '雷暴伴强冰雹',
};

function getDayRow(date: Date): number {
  const value = date.getDay();
  return value === 0 ? 6 : value - 1;
}

function dateToPath(date: string, suffix: string): string {
  const [year, month, day] = date.split('-');
  return `${year}/${month}/${day}.${suffix}`;
}

function formatChineseDate(date: string): string {
  const [year, month, day] = date.split('-');
  return `${Number(year)}年${Number(month)}月${Number(day)}日`;
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateKey(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function getPreviousDateKey(date: string): string {
  const value = parseDateKey(date);
  value.setDate(value.getDate() - 1);
  return formatDateKey(value);
}

function diffDays(start: string, end: string): number {
  const startTime = parseDateKey(start).getTime();
  const endTime = parseDateKey(end).getTime();
  return Math.max(0, Math.floor((endTime - startTime) / 86400000));
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0%';
  return `${formatNumber(value, 1)}%`;
}

function getYearProgress(date: string): number {
  const current = parseDateKey(date);
  const start = new Date(current.getFullYear(), 0, 1);
  const end = new Date(current.getFullYear(), 11, 31);
  const elapsed = diffDays(formatDateKey(start), date) + 1;
  const total = diffDays(formatDateKey(start), formatDateKey(end)) + 1;
  return (elapsed / total) * 100;
}

function getLifeProgress(date: string): {progress: number; livedDays: number; remainingDays: number} {
  const totalDays = diffDays(LIFE_START_DATE, LIFE_END_DATE) + 1;
  const livedDays = Math.min(totalDays, Math.max(0, diffDays(LIFE_START_DATE, date) + 1));
  return {
    progress: (livedDays / totalDays) * 100,
    livedDays,
    remainingDays: Math.max(0, totalDays - livedDays),
  };
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dateRange(start: string, end: string): string[] {
  const output: string[] = [];
  for (let cursor = parseDateKey(start); formatDateKey(cursor) <= end; cursor = addDays(cursor, 1)) {
    output.push(formatDateKey(cursor));
  }
  return output;
}

function getScopeDates(scope: ObjectiveTimeScope, availableDates: string[] = []): string[] {
  const today = formatDateKey(new Date());
  if (scope.mode === 'recent') {
    const days = RANGE_DAYS[scope.range];
    return dateRange(formatDateKey(addDays(parseDateKey(today), -(days - 1))), today);
  }
  if (scope.mode === 'year') {
    return dateRange(`${scope.year}-01-01`, `${scope.year}-12-31`);
  }
  const sorted = availableDates.filter(Boolean).sort();
  if (sorted.length) return sorted;
  return dateRange(formatDateKey(addDays(parseDateKey(today), -29)), today);
}

function scopeLabel(scope: ObjectiveTimeScope): string {
  if (scope.mode === 'recent') return OBJECTIVE_RANGE_LABELS[scope.range];
  if (scope.mode === 'year') return `${scope.year}年`;
  return '全部历史';
}

function formatCompactNumber(value: number, maximumFractionDigits = 1): string {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 1_000_000_000) return `${formatNumber(value / 1_000_000_000, maximumFractionDigits)}B`;
  if (Math.abs(value) >= 1_000_000) return `${formatNumber(value / 1_000_000, maximumFractionDigits)}M`;
  if (Math.abs(value) >= 1_000) return `${formatNumber(value / 1_000, maximumFractionDigits)}K`;
  return formatNumber(value, maximumFractionDigits);
}

function formatHoursFromSeconds(seconds: number): string {
  if (!seconds) return '0h';
  const hours = seconds / 3600;
  if (hours < 1) return `${Math.round(seconds / 60)}m`;
  return `${formatNumber(hours, hours >= 10 ? 0 : 1)}h`;
}

function extractFirstNumber(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const value = Number(match[1].replace(/,/g, ''));
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

function parseChineseCount(value: string | undefined): number | null {
  if (!value) return null;
  const numeric = Number(value.replace(/,/g, ''));
  if (Number.isFinite(numeric)) return numeric;
  const map: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  return map[value] ?? null;
}

function extractFirstCount(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = parseChineseCount(match?.[1]);
    if (value !== null) return value;
  }
  return null;
}

function parseGitCounts(analysis: DailyAnalysis | null): {total: number; auto: number; manual: number} {
  const text = [
    ...(analysis?.git_insights || []).flatMap((item) => [
      item.summary,
      item.positioning,
      ...(item.evidence || []),
      item.professional_suggestion,
    ]),
    ...(analysis?.data_status || []).filter((item) => item.area === 'Git').map((item) => item.detail),
  ].filter(Boolean).join(' ');

  const total = extractFirstNumber(text, [
    /commit_count\s*=\s*(\d+)/i,
    /(\d+)\s*个\s*commit/i,
    /(\d+)\s*次\s*commit/i,
    /目标日共\s*(\d+)/,
  ]) || 0;
  const auto = extractFirstNumber(text, [
    /自动化\s*commit\s*占比\s*≈?\s*(\d+)\s*\/\s*(\d+)/,
    /其中\s*(\d+)\+?\s*个为\s*\[auto\]/i,
    /\[auto\][^，。；;]*(?:超过|约)\s*(\d+)/i,
    /(\d+)\s*条\s*\[auto\]/i,
  ]);
  const manual = extractFirstCount(text, [
    /剩余\s*(\d+)[-–]\d+\s*次手动/,
    /剩余\s*(\d+)\s*次手动/,
    /真正的人工推进只有[^。；;]*?(\d+|一|二|两|三|四|五|六|七|八|九|十)\s*条/,
    /人工\s*commit[^。；;]*?(\d+|一|二|两|三|四|五|六|七|八|九|十)\s*条/,
  ]);
  const inferredAuto = auto ?? (manual !== null && total ? Math.max(0, total - manual) : 0);
  const inferredManual = manual ?? (total ? Math.max(0, total - inferredAuto) : 0);
  return {total, auto: inferredAuto, manual: inferredManual};
}

function getAnalysisCompleteness(analysis: DailyAnalysis | null): number {
  if (!analysis) return 0;
  return [
    analysis.health_insights?.length,
    analysis.reading_insights?.length,
    analysis.finance_insights?.length,
    analysis.ai_insights?.length,
    analysis.life_log_insights?.length,
    analysis.git_insights?.length,
  ].filter((value) => Number(value || 0) > 0).length;
}

function getWeekdayLabel(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(year, month - 1, day).getDay();
  return `星期${['日', '一', '二', '三', '四', '五', '六'][value]}`;
}

function getHolidayLabel(date: string): string {
  const holidays: Record<string, string> = {
    '2026-01-01': '元旦',
    '2026-02-17': '春节假期',
    '2026-02-18': '春节假期',
    '2026-02-19': '春节假期',
    '2026-02-20': '春节假期',
    '2026-02-21': '春节假期',
    '2026-02-22': '春节假期',
    '2026-02-23': '春节假期',
    '2026-04-04': '清明节',
    '2026-04-05': '清明节假期',
    '2026-04-06': '清明节假期',
    '2026-05-01': '劳动节假期',
    '2026-05-02': '劳动节假期',
    '2026-05-03': '劳动节假期',
    '2026-05-04': '劳动节假期',
    '2026-05-05': '劳动节假期',
    '2026-06-19': '端午节',
    '2026-06-20': '端午节假期',
    '2026-06-21': '端午节假期',
    '2026-09-25': '中秋节',
    '2026-09-26': '中秋节假期',
    '2026-09-27': '中秋节假期',
    '2026-10-01': '国庆节假期',
    '2026-10-02': '国庆节假期',
    '2026-10-03': '国庆节假期',
    '2026-10-04': '国庆节假期',
    '2026-10-05': '国庆节假期',
    '2026-10-06': '国庆节假期',
    '2026-10-07': '国庆节假期',
  };
  if (holidays[date]) return holidays[date];
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Date(year, month - 1, day).getDay();
  return weekday === 0 || weekday === 6 ? '周末' : '工作日';
}

function getNestedValue(source: unknown, path: Array<string | number>): unknown {
  return path.reduce<unknown>((current, key) => {
    if (current === null || current === undefined) return undefined;
    return (current as Record<string | number, unknown>)[key];
  }, source);
}

function getWeatherCodeLabel(code: unknown): string {
  const value = Number(code);
  if (!Number.isFinite(value)) return '天气';
  return WEATHER_CODE_LABELS[value] || `天气代码 ${value}`;
}

function getOpenMeteoValue(weather: unknown, section: 'daily' | 'hourly', key: string, index = 0): unknown {
  const value = getNestedValue(weather, [section, key]);
  return Array.isArray(value) ? value[index] : undefined;
}

function getOpenMeteoHourIndex(weather: unknown, hour: number): number {
  const times = getNestedValue(weather, ['hourly', 'time']);
  if (!Array.isArray(times)) return -1;
  return times.findIndex((value) => String(value).endsWith(`T${String(hour).padStart(2, '0')}:00`));
}

function formatTemperatureRange(min: unknown, max: unknown): string {
  const minValue = Number(min);
  const maxValue = Number(max);
  if (Number.isFinite(minValue) && Number.isFinite(maxValue)) {
    return `${Math.round(minValue)}-${Math.round(maxValue)}°C`;
  }
  if (Number.isFinite(maxValue)) return `${Math.round(maxValue)}°C`;
  if (Number.isFinite(minValue)) return `${Math.round(minValue)}°C`;
  return '暂无';
}

function getWeatherSummary(weather: unknown): WeatherSummary {
  if (getNestedValue(weather, ['daily', 'weather_code'])) {
    const noonIndex = getOpenMeteoHourIndex(weather, 12);
    const hourlyIndex = noonIndex >= 0 ? noonIndex : 0;
    const code = getOpenMeteoValue(weather, 'daily', 'weather_code');
    const maxTemp = getOpenMeteoValue(weather, 'daily', 'temperature_2m_max');
    const minTemp = getOpenMeteoValue(weather, 'daily', 'temperature_2m_min');
    const maxFeelsLike = getOpenMeteoValue(weather, 'daily', 'apparent_temperature_max');
    const minFeelsLike = getOpenMeteoValue(weather, 'daily', 'apparent_temperature_min');
    const humidity = getOpenMeteoValue(weather, 'hourly', 'relative_humidity_2m', hourlyIndex);
    const wind = getOpenMeteoValue(weather, 'daily', 'wind_speed_10m_max');
    const precip = getOpenMeteoValue(weather, 'daily', 'precipitation_sum');

    return {
      description: getWeatherCodeLabel(code),
      temperature: formatTemperatureRange(minTemp, maxTemp),
      feelsLike: formatTemperatureRange(minFeelsLike, maxFeelsLike) !== '暂无' ? `体感 ${formatTemperatureRange(minFeelsLike, maxFeelsLike)}` : '',
      humidity: Number.isFinite(Number(humidity)) ? `湿度 ${Math.round(Number(humidity))}%` : '',
      wind: Number.isFinite(Number(wind)) ? `最大风速 ${Math.round(Number(wind))} km/h` : '',
      precip: Number.isFinite(Number(precip)) ? `降水 ${Number(precip).toFixed(Number(precip) >= 10 ? 0 : 1)} mm` : '',
      area: '杭州',
    };
  }

  const current = getNestedValue(weather, ['current_condition', 0]);
  const day = getNestedValue(weather, ['weather', 0]);
  const area = getNestedValue(weather, ['nearest_area', 0, 'region', 0, 'value'])
    || getNestedValue(weather, ['nearest_area', 0, 'areaName', 0, 'value']);
  const description = getNestedValue(current, ['lang_zh-cn', 0, 'value'])
    || getNestedValue(current, ['weatherDesc', 0, 'value'])
    || getNestedValue(day, ['hourly', 4, 'lang_zh-cn', 0, 'value']);
  const temp = getNestedValue(current, ['temp_C']) || getNestedValue(day, ['avgtempC']);
  const feelsLike = getNestedValue(current, ['FeelsLikeC']);
  const humidity = getNestedValue(current, ['humidity']);
  const wind = getNestedValue(current, ['windspeedKmph']);
  const precip = getNestedValue(current, ['precipMM']);

  return {
    description: description ? String(description) : '暂无天气',
    temperature: temp ? `${temp}°C` : '暂无',
    feelsLike: feelsLike ? `体感 ${feelsLike}°C` : '',
    humidity: humidity ? `湿度 ${humidity}%` : '',
    wind: wind ? `风 ${wind} km/h` : '',
    precip: precip ? `雨量 ${precip} mm` : '',
    area: area ? String(area) : '未知地点',
  };
}

function getWeatherKind(description: string): 'sunny' | 'cloudy' | 'rainy' | 'snowy' | 'foggy' {
  if (/雪|冰雹|雪粒/.test(description)) return 'snowy';
  if (/雨|阵雨|雷暴/.test(description)) return 'rainy';
  if (/雾/.test(description)) return 'foggy';
  if (/阴|云/.test(description)) return 'cloudy';
  return 'sunny';
}

function formatNumber(value: unknown, maximumFractionDigits = 0): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return '暂无';
  return new Intl.NumberFormat('zh-CN', {maximumFractionDigits}).format(number);
}

function formatDuration(seconds: unknown): string {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return '0 分钟';
  const minutes = Math.round(value / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}

function formatSleepEntry(sleep: Record<string, unknown> | null): string {
  const duration = Number(sleep?.sleepDuration || sleep?.durationMinutes);
  if (Number.isFinite(duration) && duration > 0) {
    return duration > 24 ? formatDuration(duration * 60) : formatDuration(duration * 3600);
  }
  const toMinute = (value: unknown): number | null => {
    const time = String(value || '').match(/(\d{1,2}):(\d{2})/);
    if (!time) return null;
    return Number(time[1]) * 60 + Number(time[2]);
  };
  const start = toMinute(sleep?.sleepStart);
  const end = toMinute(sleep?.sleepEnd);
  if (start !== null && end !== null) {
    const minutes = end >= start ? end - start : end + 1440 - start;
    return formatDuration(minutes * 60);
  }
  return '';
}

function timeToMinute(value: unknown): number | null {
  if (!value) return null;
  const text = String(value);
  const time = text.match(/(\d{1,2}):(\d{2})/);
  if (!time) return null;
  const hour = Number(time[1]);
  const minute = Number(time[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return Math.min(1439, Math.max(0, hour * 60 + minute));
}

function minuteToLabel(minute: number): string {
  const hour = Math.floor(minute / 60);
  const rest = minute % 60;
  return `${String(hour).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function daysInYear(year: number): string[] {
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);
  const out: string[] = [];
  for (let cursor = new Date(start); cursor < end; cursor.setDate(cursor.getDate() + 1)) {
    const month = String(cursor.getMonth() + 1).padStart(2, '0');
    const day = String(cursor.getDate()).padStart(2, '0');
    out.push(`${year}-${month}-${day}`);
  }
  return out;
}

function pickInitialDate(dates: string[]): string {
  if (typeof window !== 'undefined') {
    const value = new URLSearchParams(window.location.search).get('date');
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }
  }
  return dates[dates.length - 1] || '';
}

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(path);
    if (!response.ok) return null;
    return JSON.parse(await response.text()) as T;
  } catch {
    return null;
  }
}

async function fetchText(path: string): Promise<string> {
  try {
    const response = await fetch(path);
    if (!response.ok) return '';
    const text = await response.text();
    if (/^\s*<!doctype html/i.test(text) || text.includes('<div id="__docusaurus"></div>')) {
      return '';
    }
    return text;
  } catch {
    return '';
  }
}

async function fetchWeather(date: string): Promise<unknown | null> {
  const params = new URLSearchParams({
    latitude: String(HANGZHOU_LATITUDE),
    longitude: String(HANGZHOU_LONGITUDE),
    start_date: date,
    end_date: date,
    daily: [
      'weather_code',
      'temperature_2m_max',
      'temperature_2m_min',
      'apparent_temperature_max',
      'apparent_temperature_min',
      'precipitation_sum',
      'wind_speed_10m_max',
    ].join(','),
    hourly: [
      'temperature_2m',
      'relative_humidity_2m',
      'apparent_temperature',
      'precipitation',
      'weather_code',
      'wind_speed_10m',
    ].join(','),
    timezone: 'Asia/Shanghai',
  });
  return fetchJson(`https://archive-api.open-meteo.com/v1/archive?${params.toString()}`);
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

function normalizeImageSrc(src: string): string {
  if (/^https?:\/\//.test(src) || src.startsWith('/')) return src;
  return `/data/daily/assets/${src.replace(/^\.?\//, '')}`;
}

function DiaryImageView({image}: {image: DiaryImage}): React.ReactNode {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');

  return (
    <span className={`${styles.diaryImageFrame} ${status === 'loaded' ? styles.diaryImageFrameLoaded : ''} ${status === 'error' ? styles.diaryImageFrameError : ''}`}>
      {status === 'loading' ? <span className={styles.diaryImageSkeleton} aria-hidden="true" /> : null}
      {status === 'error' ? <span className={styles.diaryImageError}>图片加载失败</span> : null}
      <img
        src={normalizeImageSrc(image.src)}
        alt={image.alt}
        loading="lazy"
        onLoad={() => setStatus('loaded')}
        onError={() => setStatus('error')}
      />
    </span>
  );
}

type DiaryImage = {
  src: string;
  alt: string;
};

function renderDiaryImages(images: DiaryImage[], key: string): React.ReactNode {
  return (
    <div key={key} className={`${styles.diaryImages} ${images.length === 1 ? styles.diaryImagesSingle : styles.diaryImagesGrid}`}>
      {images.map((image) => (
        <DiaryImageView key={image.src} image={image} />
      ))}
    </div>
  );
}

function renderMixedImageBlock(block: string, index: number): React.ReactNode[] | null {
  const imagePattern = /!\[([^\]]*)\]\(([^)]+)\)|!([^\s!]+\.(?:png|jpe?g|webp|gif))/gi;
  const nodes: React.ReactNode[] = [];
  const pendingImages: DiaryImage[] = [];
  let lastIndex = 0;
  let matched = false;

  const flushImages = () => {
    if (!pendingImages.length) return;
    nodes.push(renderDiaryImages([...pendingImages], `${index}-images-${nodes.length}`));
    pendingImages.length = 0;
  };

  const flushText = (text: string) => {
    const content = text.trim();
    if (!content) return;
    flushImages();
    nodes.push(<p key={`${index}-text-${nodes.length}`}>{renderInlineMarkdown(content)}</p>);
  };

  for (const match of block.matchAll(imagePattern)) {
    matched = true;
    flushText(block.slice(lastIndex, match.index));
    const src = match[2] || match[3];
    if (!src) continue;
    pendingImages.push({
      src,
      alt: match[1] || match[3] || '日记图片',
    });
    lastIndex = (match.index || 0) + match[0].length;
  }

  if (!matched) return null;
  flushText(block.slice(lastIndex));
  flushImages();
  return nodes;
}

function markdownToBlocks(markdown: string): React.ReactNode[] {
  const blocks = markdown
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks
    .map((block, index) => {
      if (block.startsWith('# ')) return null;
      if (block.startsWith('## ')) {
        return <h4 key={index}>{renderInlineMarkdown(block.replace(/^##\s+/, ''))}</h4>;
      }
      const imageBlock = renderMixedImageBlock(block, index);
      if (imageBlock) return imageBlock;
      if (/^-\s+/m.test(block)) {
        return (
          <ul key={index}>
            {block.split('\n').filter(Boolean).map((line) => (
              <li key={line}>{renderInlineMarkdown(line.replace(/^-\s+/, ''))}</li>
            ))}
          </ul>
        );
      }
      return <p key={index}>{renderInlineMarkdown(block)}</p>;
    })
    .filter(Boolean);
}

function getMetricEntry(health: HealthData | null, metricName: string, date: string): Record<string, unknown> | null {
  const metric = health?.data?.healthMetrics?.metrics?.find((item) => item.name === metricName);
  return metric?.data?.find((item) => String(item.date || '').startsWith(date)) || null;
}

function recordTitle(record: DailyHealthTimelineRecord): string {
  if (record.type === 'sleep') return record.label || '睡眠';
  if (record.type === 'workout') return record.name || '运动';
  if (record.type === 'handwashing') return '洗手';
  return record.type || '健康';
}

function recordDetail(record: DailyHealthTimelineRecord): string {
  const parts: string[] = [];
  if (record.durationMinutes) parts.push(`${formatNumber(record.durationMinutes)} 分钟`);
  if (record.steps) parts.push(`${formatNumber(record.steps)} 步`);
  if (record.distanceKm) parts.push(`${formatNumber(record.distanceKm, 1)} km`);
  if (record.flights) parts.push(`${formatNumber(record.flights, 1)} 层`);
  if (record.activeEnergyKJ) parts.push(`${formatNumber(record.activeEnergyKJ)} kJ`);
  if (record.energyKcal) parts.push(`${formatNumber(record.energyKcal)} kcal`);
  if (record.avgHeartRate) parts.push(`均心 ${formatNumber(record.avgHeartRate)} bpm`);
  if (record.maxHeartRate) parts.push(`峰值 ${formatNumber(record.maxHeartRate)} bpm`);
  if (record.durationSeconds) parts.push(`${formatNumber(record.durationSeconds)} 秒`);
  if (record.status) parts.push(record.status);
  return parts.join(' · ');
}

function compactWorkoutDetail(detail: string, duration: number): string {
  const parts = detail.split(' · ').filter(Boolean);
  if (!parts.length) return duration ? `${formatNumber(duration)} 分钟` : '';
  if (duration < 45) return parts[0] || '';
  return parts.slice(0, 3).join(' · ');
}

function timelineType(type?: string): TimelineItem['type'] | null {
  if (type === 'sleep' || type === 'workout') {
    return type;
  }
  return null;
}

function bandType(type?: string): TimelineBand['type'] | null {
  if (
    type === 'movement'
    || type === 'stand'
    || type === 'daylight'
    || type === 'stairs'
    || type === 'active_energy'
    || type === 'handwashing'
  ) {
    return type;
  }
  return null;
}

function bandIntensity(record: DailyHealthTimelineRecord): number {
  if (record.type === 'movement') return Math.min(1, Number(record.steps || 0) / 5000);
  if (record.type === 'stand') return Math.min(1, Number(record.durationMinutes || 0) / 60);
  if (record.type === 'daylight') return Math.min(1, Number(record.durationMinutes || 0) / 120);
  if (record.type === 'stairs') return Math.min(1, Number(record.flights || 0) / 30);
  if (record.type === 'active_energy') return Math.min(1, Number(record.energyKJ || record.activeEnergyKJ || 0) / 1000);
  if (record.type === 'handwashing') return Math.min(1, Number(record.durationSeconds || 0) / 20);
  return 0.4;
}

function buildHealthTimeline(dailyHealth: DailyHealthData | null): TimelineModel {
  const selectedDate = dailyHealth?.date;
  return (dailyHealth?.timeline || []).reduce<TimelineModel>((model, record) => {
    if (selectedDate && String(record.start || '').includes('-') && !String(record.start).startsWith(selectedDate)) {
      return model;
    }
    const startMinute = timeToMinute(record.start);
    const endMinute = timeToMinute(record.end);
    if (startMinute === null || endMinute === null) return model;

    const band = bandType(record.type);
    if (band) {
      model.bands.push({
        type: band,
        startMinute,
        endMinute: Math.max(startMinute + 5, endMinute),
        intensity: bandIntensity(record),
        title: recordTitle(record),
        detail: recordDetail(record),
      });
      return model;
    }

    const type = timelineType(record.type);
    if (!type) return model;
    const duration = Math.max(5, endMinute - startMinute);
    if (type === 'sleep') {
      model.sleep ||= {
        startMinute,
        endMinute: startMinute + duration,
        detail: '',
        segments: [],
      };
      model.sleep.startMinute = Math.min(model.sleep.startMinute, startMinute);
      model.sleep.endMinute = Math.max(model.sleep.endMinute, startMinute + duration);
      model.sleep.segments.push({
        stage: record.stage,
        label: record.label || '睡眠',
        startMinute,
        endMinute: startMinute + duration,
      });
      return model;
    }
    model.items.push({
      type,
      title: recordTitle(record),
      detail: recordDetail(record),
      startMinute,
      endMinute: startMinute + duration,
      stage: record.stage,
    });
    return model;
  }, {items: [], bands: [], sleep: null, weather: []});
}

function summarizeSleep(block: SleepBlock): string {
  const minutes = block.endMinute - block.startMinute;
  return `${Math.floor(minutes / 60)}h${minutes % 60 ? `${minutes % 60}m` : ''}`;
}

function getSleepStageMinutes(block: SleepBlock): Record<string, number> {
  return block.segments.reduce<Record<string, number>>((result, segment) => {
    const key = segment.stage || segment.label;
    result[key] = (result[key] || 0) + Math.max(0, segment.endMinute - segment.startMinute);
    return result;
  }, {});
}

const SLEEP_STAGE_ROWS = [
  {key: 'awake', label: '清醒', className: 'sleepStageLabel_awake'},
  {key: 'rem', label: '快速动眼', className: 'sleepStageLabel_rem'},
  {key: 'core', label: '核心', className: 'sleepStageLabel_core'},
  {key: 'deep', label: '深度', className: 'sleepStageLabel_deep'},
];

function SleepStageChart({
  block,
  compact = false,
  onSegmentEnter,
  onSegmentMove,
}: {
  block: SleepBlock;
  compact?: boolean;
  onSegmentEnter?: (event: React.MouseEvent<HTMLElement>, segment: SleepSegment) => void;
  onSegmentMove?: (event: React.MouseEvent<HTMLElement>) => void;
}): React.ReactNode {
  const sortedSegments = block.segments.slice().sort((first, second) => first.startMinute - second.startMinute);
  const totalMinutes = Math.max(1, block.endMinute - block.startMinute);
  const stageMinutes = getSleepStageMinutes(block);

  return (
    <div className={`${styles.sleepStageChart} ${compact ? styles.sleepStageChartCompact : ''}`}>
      <div className={styles.sleepStageLabels}>
        {SLEEP_STAGE_ROWS.map((stage) => (
          <span key={stage.key} className={styles[stage.className]}>
            <strong>{stage.label}</strong>
            {stageMinutes[stage.key] ? <small>{formatNumber(stageMinutes[stage.key])}m</small> : null}
          </span>
        ))}
      </div>
      <div className={styles.sleepStagePlot}>
        {SLEEP_STAGE_ROWS.map((stage) => <i key={stage.key} className={styles.sleepStageGridLine} />)}
        <div className={styles.sleepStageAxis}>
          <span>{minuteToLabel(block.startMinute)}</span>
          <span>{minuteToLabel(block.startMinute + Math.round(totalMinutes / 2))}</span>
          <span>{minuteToLabel(block.endMinute)}</span>
        </div>
        {sortedSegments.map((segment, index) => {
          const left = ((segment.startMinute - block.startMinute) / totalMinutes) * 100;
          const width = Math.max(1.5, ((segment.endMinute - segment.startMinute) / totalMinutes) * 100);
          const rowIndex = Math.max(0, SLEEP_STAGE_ROWS.findIndex((stage) => stage.key === segment.stage));
          return (
            <i
              key={`${segment.startMinute}-${index}`}
              className={`${styles.sleepStageSegment} ${segment.stage ? styles[`sleepStageSegment_${segment.stage}`] : ''}`}
              style={{
                left: `${left}%`,
                top: `calc(${rowIndex * 25}% + 0.34rem)`,
                width: `${width}%`,
              }}
              title={`${minuteToLabel(segment.startMinute)}-${minuteToLabel(segment.endMinute)} ${segment.label}`}
              onMouseEnter={(event) => onSegmentEnter?.(event, segment)}
              onMouseMove={onSegmentMove}
            />
          );
        })}
      </div>
    </div>
  );
}

function buildTimelineModel({
  sleep,
  dailyHealth,
  drive,
  weather,
}: {
  sleep: Record<string, unknown> | null;
  dailyHealth: DailyHealthData | null;
  drive: DriveLog | null;
  weather: unknown;
}): TimelineModel {
  const model = buildHealthTimeline(dailyHealth);
  const sleepStart = timeToMinute(sleep?.sleepStart);
  const sleepEnd = timeToMinute(sleep?.sleepEnd);
  if (!model.sleep && sleepStart !== null && sleepEnd !== null) {
    model.sleep = {
      startMinute: sleepStart,
      endMinute: Math.max(sleepStart + 30, sleepEnd),
      detail: '',
      segments: [{
        label: '睡眠',
        startMinute: sleepStart,
        endMinute: Math.max(sleepStart + 30, sleepEnd),
      }],
    };
  }
  if (model.sleep) model.sleep.detail = summarizeSleep(model.sleep);

  Object.entries(drive || {}).forEach(([time, item]) => {
    const minute = timeToMinute(time);
    if (minute === null) return;
    model.items.push({
      type: 'drive',
      title: item.action || '行车',
      detail: item.address,
      startMinute: minute,
    });
  });

  if (getNestedValue(weather, ['hourly', 'weather_code'])) {
    [0, 6, 12, 18].forEach((hour) => {
      const index = getOpenMeteoHourIndex(weather, hour);
      if (index < 0) return;
      const code = getOpenMeteoValue(weather, 'hourly', 'weather_code', index);
      const temp = getOpenMeteoValue(weather, 'hourly', 'temperature_2m', index);
      const precip = Number(getOpenMeteoValue(weather, 'hourly', 'precipitation', index));
      const detail = [
        Number.isFinite(Number(temp)) ? `${Math.round(Number(temp))}°C` : '',
        Number.isFinite(precip) && precip > 0 ? `降水 ${precip.toFixed(1)}mm` : '',
      ].filter(Boolean).join(' · ');
      model.weather.push({
        type: 'weather',
        title: getWeatherCodeLabel(code),
        detail: detail || undefined,
        startMinute: hour * 60,
      });
    });
  } else {
    const hourly = (getNestedValue(weather, ['weather', 0, 'hourly']) as Array<Record<string, unknown>> | undefined) || [];
    [0, 6, 12, 18].forEach((hour) => {
      const entry = hourly.find((item) => Number(item.time || 0) === hour * 100);
      if (!entry) return;
      const description = getNestedValue(entry, ['lang_zh-cn', 0, 'value'])
        || getNestedValue(entry, ['weatherDesc', 0, 'value']);
      const temp = entry.tempC || entry.FeelsLikeC;
      model.weather.push({
        type: 'weather',
        title: description ? String(description) : '天气',
        detail: temp ? `${temp}°C` : undefined,
        startMinute: hour * 60,
      });
    });
  }

  model.items.sort((left, right) => left.startMinute - right.startMinute);
  model.bands.sort((left, right) => left.startMinute - right.startMinute);
  model.weather.sort((left, right) => left.startMinute - right.startMinute);
  return model;
}

function ReflectionCalendar({
  year,
  dailyDates,
  analysisDates,
  selectedDate,
  onSelect,
  compact = false,
  onToggleCompact,
}: {
  year: number;
  dailyDates: Set<string>;
  analysisDates: Set<string>;
  selectedDate: string;
  onSelect: (date: string) => void;
  compact?: boolean;
  onToggleCompact?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<CalendarHover | null>(null);
  const {grid, monthLabels, elapsedDays, futureDays, elapsedPercent, activeDays, completeDays, numWeeks} = useMemo(() => {
    const days = daysInYear(year);
    const first = new Date(year, 0, 1);
    const today = formatDateKey(new Date());
    const weeks = Math.ceil((getDayRow(first) + days.length) / 7);
    const columns: Array<Array<CalendarCell | null>> = Array.from({length: weeks}, () => Array.from({length: 7}, () => null));
    const labels: Array<{label: string; col: number}> = [];
    let previousMonth = -1;
    let elapsedCount = 0;
    let futureCount = 0;
    let activeCount = 0;
    let completeCount = 0;

    days.forEach((date, index) => {
      const cursor = new Date(year, 0, index + 1);
      const row = getDayRow(cursor);
      const col = Math.floor((getDayRow(first) + index) / 7);
      const hasDaily = dailyDates.has(date);
      const hasAnalysis = analysisDates.has(date);
      const score = Number(hasDaily) + Number(hasAnalysis);
      const isElapsed = date <= today;
      if (isElapsed) elapsedCount += 1;
      else futureCount += 1;
      if (score > 0) activeCount += 1;
      if (score === 2) completeCount += 1;
      columns[col][row] = {date, score, hasDaily, hasAnalysis, isElapsed};

      const month = cursor.getMonth();
      if (month !== previousMonth) {
        labels.push({label: MONTH_LABELS[month], col});
        previousMonth = month;
      }
    });

    return {
      grid: columns,
      monthLabels: labels,
      elapsedDays: elapsedCount,
      futureDays: futureCount,
      elapsedPercent: (elapsedCount / days.length) * 100,
      activeDays: activeCount,
      completeDays: completeCount,
      numWeeks: weeks,
    };
  }, [analysisDates, dailyDates, year]);

  if (compact) {
    return (
      <section className={styles.calendarSummary} aria-label={`${year} 年日历摘要`}>
        <div>
          <strong>{selectedDate ? formatChineseDate(selectedDate) : `${year}年`}</strong>
          <span>今年已经过去 {formatPercent(elapsedPercent)} · {activeDays} 天有记录 · {completeDays} 天完整</span>
        </div>
        <button type="button" onClick={onToggleCompact}>
          展开日历
        </button>
      </section>
    );
  }

  function handleEnter(event: React.MouseEvent<HTMLButtonElement>, cell: CalendarCell) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({
      ...cell,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  }

  function handleMove(event: React.MouseEvent<HTMLButtonElement>) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover((previous) => previous ? {...previous, x: event.clientX - rect.left, y: event.clientY - rect.top} : previous);
  }

  return (
    <section ref={containerRef} className={styles.reflectionCalendar} aria-label={`${year} 年日历`} onMouseLeave={() => setHover(null)}>
      <div className={styles.calendarBody}>
        <div className={styles.weekdayColumn}>
          <span className={styles.weekdaySpacer} aria-hidden="true" />
          {WEEKDAY_LABELS.map((label) => (
            <span key={label} className={styles.weekdayLabel}>周{label}</span>
          ))}
        </div>
        <div className={styles.scrollArea}>
          <div className={styles.calendarStack} style={{'--col-count': numWeeks} as React.CSSProperties}>
            <div className={styles.monthHeader}>
              {monthLabels.map((month) => (
                <span key={`${month.label}-${month.col}`} className={styles.monthLabel} style={{'--col': month.col} as React.CSSProperties}>
                  {month.label}
                </span>
              ))}
            </div>
            <div className={styles.calendarGrid}>
              {grid.flatMap((column, columnIndex) =>
                column.map((cell, rowIndex) => {
                  if (!cell) {
                    return <span key={`${columnIndex}-${rowIndex}`} className={styles.cellPlaceholder} />;
                  }

                  return (
                    <button
                      key={cell.date}
                      type="button"
                      aria-label={`${cell.date} ${cell.score ? '有三省数据' : '无数据'}`}
                      title={cell.date}
                      className={[
                        styles.calendarCell,
                        cell.isElapsed ? styles.calendarCellElapsed : styles.calendarCellFuture,
                        selectedDate === cell.date ? styles.calendarCellSelected : '',
                      ].join(' ')}
                      onClick={() => onSelect(cell.date)}
                      onMouseEnter={(event) => handleEnter(event, cell)}
                      onMouseMove={handleMove}
                    />
                  );
                }),
              )}
            </div>
          </div>
        </div>
      </div>
      {hover ? (
        <div
          className={styles.calendarTooltip}
          style={{
            transform: `translate(calc(${hover.x}px - 50%), calc(${hover.y}px - 100% - 10px))`,
          }}
          role="tooltip"
        >
          <div className={styles.tooltipDate}>{formatChineseDate(hover.date)}</div>
          <div className={styles.tooltipValue}>
            {hover.score === 2 ? '日记与 AI 分析完整' : hover.score === 1 ? '已有部分三省数据' : '暂无三省数据'}
          </div>
          <div className={styles.tooltipMeta}>
            <span>{hover.hasDaily ? '公开日记已保存' : '无公开日记'}</span>
            <span>{hover.hasAnalysis ? 'AI 分析已生成' : '无 AI 分析'}</span>
          </div>
        </div>
      ) : null}
      <div className={styles.calendarFooter}>
        <span className={styles.calendarProgress}>今年已经过去 {formatPercent(elapsedPercent)}</span>
        <span className={styles.calendarMeta}>{elapsedDays} 天已过去 · {futureDays} 天未到来 · {activeDays} 天有记录 · {completeDays} 天完整</span>
        {onToggleCompact ? (
          <button type="button" className={styles.calendarCollapseButton} onClick={onToggleCompact}>
            收起日历
          </button>
        ) : null}
        <div className={styles.calendarLegend}>
          <span>未来</span>
          <i className={styles.calendarCellFuture} />
          <i className={styles.calendarCellElapsed} />
          <span>已过去</span>
        </div>
      </div>
    </section>
  );
}

function LifeCalendar(): React.ReactNode {
  const today = formatDateKey(new Date());
  const startYear = Number(LIFE_START_DATE.slice(0, 4));
  const endYear = Number(LIFE_END_DATE.slice(0, 4));
  const years = Array.from({length: endYear - startYear + 1}, (_, index) => startYear + index);
  const totalDays = diffDays(LIFE_START_DATE, LIFE_END_DATE) + 1;
  const livedDays = Math.min(totalDays, diffDays(LIFE_START_DATE, today) + 1);
  const progress = Math.min(100, (livedDays / totalDays) * 100);

  return (
    <section className={styles.lifeCalendar}>
      <div className={styles.lifeStats}>
        <div>
          <strong>{formatNumber(livedDays)}</strong>
          <span>已度过的日子</span>
        </div>
        <div>
          <strong>{formatNumber(Math.max(0, totalDays - livedDays))}</strong>
          <span>预计剩余日子</span>
        </div>
        <div>
          <strong>{formatNumber(progress, 1)}%</strong>
          <span>{LIFE_START_DATE} - {LIFE_END_DATE}</span>
        </div>
      </div>
      <div className={styles.lifeProgress}>
        <div className={styles.lifeProgressTrack}>
          <span className={styles.lifeProgressFill} style={{width: `${progress}%`}} />
          <span className={styles.lifeProgressToday} style={{left: `${progress}%`}} />
        </div>
        <div className={styles.lifeProgressLabels}>
          <span>出生</span>
          <strong>今天</strong>
          <span>预期终点</span>
        </div>
      </div>
      <div className={styles.lifeYearMap}>
        {years.map((year) => {
          const isPast = year < new Date().getFullYear();
          const isCurrent = year === new Date().getFullYear();
          return (
            <span
              key={year}
              className={[
                styles.lifeYearCell,
                isPast ? styles.lifeYearPast : '',
                isCurrent ? styles.lifeYearCurrent : '',
              ].join(' ')}
              title={`${year} 年`}
            >
              {year % 10 === 0 ? year : ''}
            </span>
          );
        })}
      </div>
      <div className={styles.calendarFooter}>
        <span>一格一年，压缩显示整个人生进度。</span>
        <div className={styles.calendarLegend}>
          <span>过去</span>
          <i className={styles.lifeYearPast} />
          <i className={styles.lifeYearCell} />
          <span>未来</span>
        </div>
      </div>
    </section>
  );
}

function InsightList({items}: {items: AnalysisInsight[]}): React.ReactNode {
  const valid = items.filter((item) => item.summary || item.positioning || item.evidence?.length);
  if (!valid.length) {
    return <p className={styles.muted}>暂无 AI 分析。</p>;
  }

  return valid.map((item, index) => (
    <article key={index} className={styles.insight}>
      {item.expert_view ? <span className={styles.pill}>{item.expert_view}</span> : null}
      {item.summary ? <p className={styles.lead}>{item.summary}</p> : null}
      {item.positioning ? <p>{item.positioning}</p> : null}
      {item.evidence?.length ? (
        <ul>
          {item.evidence.map((value) => (
            <li key={value}>{value}</li>
          ))}
        </ul>
      ) : null}
      {item.uncertainty ? <p className={styles.boundary}>边界：{item.uncertainty}</p> : null}
      {item.professional_suggestion ? <p className={styles.action}>{item.professional_suggestion}</p> : null}
    </article>
  ));
}

function TimelinePanel({model}: {model: TimelineModel}): React.ReactNode {
  const legend = [
    ['移动', styles.timelineBand_movement],
    ['负荷', styles.timelineBand_active_energy],
    ['站立', styles.timelineBand_stand],
    ['日照', styles.timelineBand_daylight],
    ['爬楼', styles.timelineBand_stairs],
    ['洗手', styles.timelineBand_handwashing],
  ];

  return (
    <section className={styles.timelinePanel}>
      <div className={styles.panelHead}>
        <div>
          <strong>24 小时客观轨迹</strong>
          <small>天气、睡眠、运动、出行与行为切片</small>
        </div>
        <div className={styles.timelineLegend}>
          {legend.map(([label, className]) => (
            <span key={label}>
              <i className={className} />
              {label}
            </span>
          ))}
        </div>
      </div>
      <DayTimeline model={model} />
    </section>
  );
}

function DayTimeline({model}: {model: TimelineModel}): React.ReactNode {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [tooltip, setTooltip] = useState<TimelineTooltip | null>(null);
  const hours = Array.from({length: 25}, (_, hour) => hour);
  const eventLanes: Array<{key: string; label: string; types: TimelineItem['type'][]}> = [
    {key: 'behavior', label: '行为', types: ['workout', 'drive']},
  ];
  const bandLanes: Array<{key: TimelineBand['type']; label: string}> = [
    {key: 'movement', label: '移'},
    {key: 'active_energy', label: '荷'},
    {key: 'stand', label: '站'},
    {key: 'daylight', label: '晒'},
    {key: 'stairs', label: '楼'},
    {key: 'handwashing', label: '洗'},
  ];

  function showTooltip(event: React.MouseEvent<HTMLElement>, text: React.ReactNode) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({
      text,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  }

  function moveTooltip(event: React.MouseEvent<HTMLElement>) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip((previous) => previous ? {...previous, x: event.clientX - rect.left, y: event.clientY - rect.top} : previous);
  }

  return (
    <div ref={containerRef} className={styles.dayTimeline} onMouseLeave={() => setTooltip(null)}>
      <div className={styles.timelineScale}>
        {hours.map((hour) => (
          <span
            key={hour}
            className={hour % 6 === 0 ? styles.timelineScaleMajor : styles.timelineScaleMinor}
            style={{top: `${(hour / 24) * 100}%`}}
          >
            {String(hour).padStart(2, '0')}:00
          </span>
        ))}
        {model.weather.map((item) => (
          <div
            key={`${item.type}-${item.startMinute}`}
            className={styles.timelineWeatherMark}
            style={{top: `${(item.startMinute / 1440) * 100}%`}}
            onMouseEnter={(event) => showTooltip(event, `${minuteToLabel(item.startMinute)} ${item.title}${item.detail ? ` · ${item.detail}` : ''}`)}
            onMouseMove={moveTooltip}
          >
            <strong>{item.title}</strong>
            {item.detail ? <small>{item.detail}</small> : null}
          </div>
        ))}
        {model.sleep ? (
          <>
            <span className={styles.timelineSleepBoundary} style={{top: `${(model.sleep.startMinute / 1440) * 100}%`}}>
              {minuteToLabel(model.sleep.startMinute)}
            </span>
            <span className={styles.timelineSleepBoundary} style={{top: `${(model.sleep.endMinute / 1440) * 100}%`}}>
              {minuteToLabel(model.sleep.endMinute)}
            </span>
          </>
        ) : null}
      </div>
      <div className={styles.timelineTrack}>
        {eventLanes.map((lane) => (
          <div key={lane.key} className={styles.timelineLane}>
            {model.sleep ? (
              <div
                className={styles.sleepBlock}
                style={{
                  top: `${(model.sleep.startMinute / 1440) * 100}%`,
                  height: `${Math.max(4, ((model.sleep.endMinute - model.sleep.startMinute) / 1440) * 100)}%`,
                }}
              >
                <div className={styles.sleepBlockSummary}>
                  <strong>睡眠 {model.sleep.detail}</strong>
                </div>
                <SleepStageChart
                  block={model.sleep}
                  compact
                  onSegmentEnter={(event, segment) => {
                    const minutes = Math.max(0, segment.endMinute - segment.startMinute);
                    showTooltip(event, `${minuteToLabel(segment.startMinute)}-${minuteToLabel(segment.endMinute)} ${segment.label} · ${formatNumber(minutes)}m`);
                  }}
                  onSegmentMove={moveTooltip}
                />
              </div>
            ) : null}
            {model.items.filter((item) => lane.types.includes(item.type)).map((item, index) => {
              const top = (item.startMinute / 1440) * 100;
              const duration = item.endMinute ? item.endMinute - item.startMinute : 0;
              const height = item.endMinute ? Math.max(2, (duration / 1440) * 100) : undefined;
              const densityClass = item.type === 'workout'
                ? duration >= 90
                  ? styles.timelineEventFeatured
                  : duration >= 40
                    ? styles.timelineEventMedium
                    : styles.timelineEventCompact
                : '';
              return (
                <div
                  key={`${item.type}-${item.startMinute}-${index}`}
                  className={[
                    styles.timelineEvent,
                    styles.timelineEventMulti,
                    styles[`timelineEvent_${item.type}`],
                    densityClass,
                  ].join(' ')}
                  style={{top: `${top}%`, height: height ? `${height}%` : undefined}}
                  onMouseEnter={(event) => showTooltip(event, `${minuteToLabel(item.startMinute)}${item.endMinute ? `-${minuteToLabel(item.endMinute)}` : ''} ${item.title}${item.detail ? ` · ${item.detail}` : ''}`)}
                  onMouseMove={moveTooltip}
                >
                  <strong>{item.title}</strong>
                  {item.detail ? (
                    <span>{item.type === 'workout' ? compactWorkoutDetail(item.detail, duration) : item.detail}</span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
        <div className={styles.timelineBandPanel}>
          {bandLanes.map((lane) => (
            <div key={lane.key} className={styles.timelineBandLane}>
              <span>{lane.label}</span>
              <div>
                {model.bands.filter((band) => band.type === lane.key).map((band, index) => {
                  const top = (band.startMinute / 1440) * 100;
                  const height = Math.max(1.2, ((band.endMinute - band.startMinute) / 1440) * 100);
                  return (
                    <i
                      key={`${band.type}-${band.startMinute}-${index}`}
                      className={`${styles.timelineBand} ${styles[`timelineBand_${band.type}`]}`}
                      style={{
                        top: `${top}%`,
                        height: `${height}%`,
                        opacity: 0.28 + band.intensity * 0.55,
                      }}
                      title={band.detail || band.title}
                      onMouseEnter={(event) => showTooltip(event, `${minuteToLabel(band.startMinute)}-${minuteToLabel(band.endMinute)} ${band.title}${band.detail ? ` · ${band.detail}` : ''}`)}
                      onMouseMove={moveTooltip}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      {tooltip ? (
        <div
          className={styles.timelineTooltip}
          style={{
            transform: `translate(calc(${tooltip.x}px + 10px), calc(${tooltip.y}px - 100% - 10px))`,
          }}
        >
          {tooltip.text}
        </div>
      ) : null}
    </div>
  );
}

function DailyDiary({
  diary,
}: {
  diary: string;
}): React.ReactNode {
  return (
    <div className={styles.dailyDiary}>
      <div className={styles.markdown}>
        {diary ? markdownToBlocks(diary) : <p className={styles.muted}>暂无公开日记。</p>}
      </div>
    </div>
  );
}

function DailyAnalysisReport({analysis}: {analysis: DailyAnalysis | null}): React.ReactNode {
  if (!analysis) {
    return (
      <section className={styles.analysisReport}>
        <div className={styles.dailyDiaryHead}>
          <span>AI 分析报告</span>
        </div>
        <p className={styles.muted}>暂无 AI 分析报告。</p>
      </section>
    );
  }

  const insightGroups = [
    {title: '健康', items: analysis.health_insights || []},
    {title: '阅读', items: analysis.reading_insights || []},
    {title: '财务', items: analysis.finance_insights || []},
    {title: 'AI 使用', items: analysis.ai_insights || []},
    {title: '生活记录', items: analysis.life_log_insights || []},
    {title: '环境与出行', items: analysis.environment_mobility_insights || []},
    {title: 'Git 推进', items: analysis.git_insights || []},
  ].filter((group) => group.items.length);

  return (
    <section className={styles.analysisReport}>
      <div className={styles.dailyDiaryHead}>
        <span>AI 分析报告</span>
      </div>

      {analysis.legacy_report_markdown ? (
        <div className={styles.markdown}>{markdownToBlocks(analysis.legacy_report_markdown)}</div>
      ) : (
        <>
          {analysis.top_signals?.length ? (
            <div className={styles.reportBlock}>
              <h3>今日判断</h3>
              <div className={styles.reportSignals}>
                {analysis.top_signals.map((signal, index) => (
                  <article key={index}>
                    <strong>{signal.area || '观察'}</strong>
                    <p>{signal.summary}</p>
                  </article>
                ))}
              </div>
            </div>
          ) : null}

          {insightGroups.map((group) => (
            <div key={group.title} className={styles.reportBlock}>
              <h3>{group.title}</h3>
              <InsightList items={group.items} />
            </div>
          ))}

          {analysis.cross_domain_insights?.length ? (
            <div className={styles.reportBlock}>
              <h3>跨板块洞察</h3>
              {analysis.cross_domain_insights.map((item, index) => (
                <article key={index} className={styles.insight}>
                  <p>{item.summary}</p>
                  {item.uncertainty ? <p className={styles.muted}>{item.uncertainty}</p> : null}
                </article>
              ))}
            </div>
          ) : null}

          {analysis.follow_ups?.length ? (
            <div className={styles.reportBlock}>
              <h3>接下来值得关注</h3>
              <ul>
                {analysis.follow_ups.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {analysis.data_status?.length ? (
            <div className={styles.reportBlock}>
              <h3>数据状态</h3>
              <ul className={styles.statusList}>
                {analysis.data_status.map((item, index) => (
                  <li key={index}>
                    <strong>{item.area || '来源'}</strong>
                    <span>{item.status || '未知'}</span>
                    <p>{item.detail}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function DataDomainTabs({
  active,
  onChange,
}: {
  active: DataDomain;
  onChange: (domain: DataDomain) => void;
}): React.ReactNode {
  const domains: Array<{key: DataDomain; label: string}> = [
    {key: 'health', label: '健康'},
    {key: 'career', label: '事业'},
    {key: 'finance', label: '财务'},
    {key: 'life', label: '人生'},
  ];

  return (
    <div className={`${styles.filterTier} ${styles.dataDomainTier}`}>
      <span className={styles.filterTierLabel}>领域</span>
      <div className={styles.dataDomainTabs} role="tablist" aria-label="客观数据分类">
        {domains.map((domain) => (
          <button
            key={domain.key}
            type="button"
            role="tab"
            aria-selected={active === domain.key}
            className={active === domain.key ? styles.dataDomainTabActive : ''}
            onClick={() => onChange(domain.key)}
          >
            {domain.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function DailyDetailTabs({
  active,
  onChange,
}: {
  active: DailyDetailTab;
  onChange: (tab: DailyDetailTab) => void;
}): React.ReactNode {
  const tabs: Array<{key: DailyDetailTab; label: string}> = [
    {key: 'diary', label: '日记'},
    {key: 'timeline', label: '24小时轨迹'},
    {key: 'analysis', label: 'AI分析'},
  ];

  return (
    <div className={styles.dailyDetailTabs} role="tablist" aria-label="当日细节">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={active === tab.key}
          className={active === tab.key ? styles.dailyDetailTabActive : ''}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function FinanceTabs({
  active,
  onChange,
}: {
  active: FinanceTab;
  onChange: (tab: FinanceTab) => void;
}): React.ReactNode {
  const tabs: Array<{key: FinanceTab; label: string}> = [
    {key: 'income', label: '收入'},
    {key: 'expense', label: '支出'},
    {key: 'investment', label: '投资'},
  ];

  return (
    <div className={styles.financeTabs} role="tablist" aria-label="财务数据分类">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={active === tab.key}
          className={active === tab.key ? styles.financeTabActive : ''}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function HealthChartSubtabs(): React.ReactNode {
  const handleClick = (id: string) => {
    const target = document.getElementById(id);
    const scroller = target?.closest(`.${styles.healthChartsPanel}`);
    if (!target || !(scroller instanceof HTMLElement)) return;
    scroller.scrollTo({
      top: target.offsetTop - scroller.offsetTop - 8,
      behavior: 'smooth',
    });
  };

  return (
    <nav className={styles.healthChartSubtabs} aria-label="健康图表跳转">
      {HEALTH_CHART_NAV.flatMap((section) => section.charts).map((chart) => (
        <button key={chart.id} type="button" onClick={() => handleClick(chart.id)}>
          {chart.label}
        </button>
      ))}
    </nav>
  );
}

function DomainSubtabs({items}: {items: Array<{id: string; label: string}>}): React.ReactNode {
  const handleClick = (id: string) => {
    const target = document.getElementById(id);
    const scroller = target?.closest(`.${styles.healthChartsPanel}`);
    if (!target || !(scroller instanceof HTMLElement)) return;
    scroller.scrollTo({
      top: target.offsetTop - scroller.offsetTop - 8,
      behavior: 'smooth',
    });
  };

  return (
    <nav className={styles.healthChartSubtabs} aria-label="图表跳转">
      {items.map((item) => (
        <button key={item.id} type="button" onClick={() => handleClick(item.id)}>
          {item.label}
        </button>
      ))}
    </nav>
  );
}

function ObjectiveStatGrid({items}: {items: Array<{value: React.ReactNode; label: string; tone?: 'accent' | 'green' | 'orange'}>}): React.ReactNode {
  return (
    <div className={styles.objectiveStatGrid}>
      {items.map((item) => (
        <div key={item.label} className={`${styles.objectiveStatCard} ${item.tone ? styles[`objectiveStatCard_${item.tone}`] : ''}`}>
          <strong>{item.value}</strong>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function ObjectiveBarLineChart({
  points,
  valueLabel,
  secondaryLabel,
  tertiaryLabel,
  formatValue = (value) => formatCompactNumber(value, 0),
  selectedDate,
  onDateSelect,
}: {
  points: ObjectivePoint[];
  valueLabel: string;
  secondaryLabel?: string;
  tertiaryLabel?: string;
  formatValue?: (value: number) => string;
  selectedDate?: string;
  onDateSelect: (date: string) => void;
}): React.ReactNode {
  const chartHeight = 238;
  const labelHeight = 30;
  const plotHeight = chartHeight - labelHeight - 16;
  const width = Math.max(520, points.length * 24);
  const gap = points.length > 120 ? 3 : 7;
  const barWidth = Math.max(3, Math.min(18, (width - gap * (points.length + 1)) / Math.max(1, points.length)));
  const groupedBarWidth = tertiaryLabel ? Math.max(2, (barWidth - 2) / 3) : barWidth;
  const showSecondaryLine = Boolean(secondaryLabel && !tertiaryLabel);
  const maxValue = Math.max(1, ...points.flatMap((point) => [point.value, tertiaryLabel ? point.tertiary || 0 : 0, !showSecondaryLine ? point.secondary || 0 : 0]));
  const maxSecondary = Math.max(1, ...points.map((point) => point.secondary || 0));
  const yForValue = (value: number) => plotHeight - (Math.max(0, value) / maxValue) * plotHeight;
  const yForSecondary = (value: number) => plotHeight - (Math.max(0, value) / maxSecondary) * plotHeight;
  const linePoints = points
    .map((point, index) => {
      const x = gap + index * (barWidth + gap) + barWidth / 2;
      return `${x},${yForSecondary(point.secondary || 0)}`;
    })
    .join(' ');
  const selectedIndex = selectedDate ? points.findIndex((point) => point.date === selectedDate) : -1;
  const selectedX = selectedIndex >= 0 ? gap + selectedIndex * (barWidth + gap) : null;

  if (!points.length) {
    return <div className={styles.financeEmptyPanel}>当前时间范围暂无数据</div>;
  }

  return (
    <div className={styles.objectiveChartScroll}>
      <svg className={styles.objectiveChart} viewBox={`0 0 ${width} ${chartHeight}`} style={{width, height: chartHeight}} role="img">
        {selectedX !== null ? (
          <g className={styles.objectiveSelectedDate}>
            <rect x={Math.max(0, selectedX - gap / 2)} y={0} width={barWidth + gap} height={plotHeight} rx={5} />
            <line x1={selectedX + barWidth / 2} x2={selectedX + barWidth / 2} y1={0} y2={plotHeight + 18} />
            <text x={selectedX + barWidth / 2} y={plotHeight + 28} textAnchor="middle">
              {selectedDate?.slice(5)}
            </text>
          </g>
        ) : null}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
          <g key={ratio}>
            <line x1={0} x2={width} y1={ratio * plotHeight} y2={ratio * plotHeight} className={styles.objectiveGridLine} />
            <text x={0} y={Math.max(10, ratio * plotHeight - 3)} className={styles.objectiveAxisLabel}>
              {formatValue(maxValue * (1 - ratio))}
            </text>
          </g>
        ))}
        {points.map((point, index) => {
          const x = gap + index * (barWidth + gap);
          const barHeight = Math.max(point.value ? 1 : 0, (point.value / maxValue) * plotHeight);
          const secondaryHeight = Math.max(point.secondary ? 1 : 0, ((point.secondary || 0) / maxValue) * plotHeight);
          const tertiaryHeight = Math.max(point.tertiary ? 1 : 0, ((point.tertiary || 0) / maxValue) * plotHeight);
          const showLabel = points.length <= 35 || index % Math.ceil(points.length / 18) === 0;
          return (
            <g key={point.date} className={styles.objectiveChartPoint} onClick={() => onDateSelect(point.date)}>
              <title>
                {[`${point.date}`, `${valueLabel}: ${formatValue(point.value)}`, secondaryLabel && `${secondaryLabel}: ${formatValue(point.secondary || 0)}`, tertiaryLabel && `${tertiaryLabel}: ${formatValue(point.tertiary || 0)}`].filter(Boolean).join(' · ')}
              </title>
              <rect x={Math.max(0, x - gap / 2)} y={0} width={barWidth + gap} height={plotHeight + labelHeight} rx={5} className={styles.objectiveHoverBand} />
              {tertiaryLabel ? (
                <rect x={x + groupedBarWidth * 2 + 2} y={plotHeight - tertiaryHeight} width={groupedBarWidth} height={tertiaryHeight} rx={2} className={styles.objectiveBarTertiary} />
              ) : null}
              {secondaryLabel && !showSecondaryLine ? (
                <rect x={x + (tertiaryLabel ? groupedBarWidth + 1 : 0)} y={plotHeight - secondaryHeight} width={groupedBarWidth} height={secondaryHeight} rx={2} className={styles.objectiveBarSecondary} />
              ) : null}
              <rect x={x} y={plotHeight - barHeight} width={groupedBarWidth} height={barHeight} rx={2} className={styles.objectiveBarPrimary} />
              <text x={x + barWidth / 2} y={plotHeight + 14} textAnchor="middle" className={styles.objectiveXAxisLabel}>
                {showLabel ? point.date.slice(5) : ''}
              </text>
            </g>
          );
        })}
        {showSecondaryLine ? (
          <>
            <polyline points={linePoints} className={styles.objectiveLine} />
            {points.map((point, index) => {
              const x = gap + index * (barWidth + gap) + barWidth / 2;
              return <circle key={`${point.date}-line`} cx={x} cy={yForSecondary(point.secondary || 0)} r={2.4} className={styles.objectiveLineDot} />;
            })}
          </>
        ) : null}
      </svg>
    </div>
  );
}

function TokenStackedBarChart({
  points,
  selectedDate,
  onDateSelect,
}: {
  points: TokenStackPoint[];
  selectedDate?: string;
  onDateSelect: (date: string) => void;
}): React.ReactNode {
  const chartHeight = 238;
  const labelHeight = 30;
  const plotHeight = chartHeight - labelHeight - 16;
  const width = Math.max(520, points.length * 24);
  const gap = points.length > 120 ? 3 : 7;
  const barWidth = Math.max(5, Math.min(18, (width - gap * (points.length + 1)) / Math.max(1, points.length)));
  const totals = points.map((point) => point.minimax + point.openai + point.anthropic);
  const maxValue = Math.max(1, ...totals);
  const selectedIndex = selectedDate ? points.findIndex((point) => point.date === selectedDate) : -1;
  const selectedX = selectedIndex >= 0 ? gap + selectedIndex * (barWidth + gap) : null;

  if (!points.length) {
    return <div className={styles.financeEmptyPanel}>当前时间范围暂无数据</div>;
  }

  return (
    <div className={styles.objectiveChartScroll}>
      <svg className={styles.objectiveChart} viewBox={`0 0 ${width} ${chartHeight}`} style={{width, height: chartHeight}} role="img">
        {selectedX !== null ? (
          <g className={styles.objectiveSelectedDate}>
            <rect x={Math.max(0, selectedX - gap / 2)} y={0} width={barWidth + gap} height={plotHeight} rx={5} />
            <line x1={selectedX + barWidth / 2} x2={selectedX + barWidth / 2} y1={0} y2={plotHeight + 18} />
            <text x={selectedX + barWidth / 2} y={plotHeight + 28} textAnchor="middle">
              {selectedDate?.slice(5)}
            </text>
          </g>
        ) : null}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
          <g key={ratio}>
            <line x1={0} x2={width} y1={ratio * plotHeight} y2={ratio * plotHeight} className={styles.objectiveGridLine} />
            <text x={0} y={Math.max(10, ratio * plotHeight - 3)} className={styles.objectiveAxisLabel}>
              {formatCompactNumber(maxValue * (1 - ratio), 1)}
            </text>
          </g>
        ))}
        {points.map((point, index) => {
          const x = gap + index * (barWidth + gap);
          const total = point.minimax + point.openai + point.anthropic;
          let y = plotHeight;
          const showLabel = points.length <= 35 || index % Math.ceil(points.length / 18) === 0;
          const segments = [
            {key: 'minimax', label: 'MiniMax', value: point.minimax, className: styles.objectiveBarPrimary},
            {key: 'openai', label: 'OpenAI', value: point.openai, className: styles.objectiveBarSecondary},
            {key: 'anthropic', label: 'Anthropic', value: point.anthropic, className: styles.objectiveBarTertiary},
          ];
          return (
            <g key={point.date} className={styles.objectiveChartPoint} onClick={() => onDateSelect(point.date)}>
              <title>
                {[
                  point.date,
                  `总量: ${formatCompactNumber(total, 1)}`,
                  `MiniMax: ${formatCompactNumber(point.minimax, 1)}`,
                  `OpenAI: ${formatCompactNumber(point.openai, 1)}`,
                  `Anthropic: ${formatCompactNumber(point.anthropic, 1)}`,
                ].join(' · ')}
              </title>
              <rect x={Math.max(0, x - gap / 2)} y={0} width={barWidth + gap} height={plotHeight + labelHeight} rx={5} className={styles.objectiveHoverBand} />
              {segments.map((segment) => {
                if (segment.value <= 0) return null;
                const height = Math.max(1, (segment.value / maxValue) * plotHeight);
                y -= height;
                return (
                  <rect
                    key={segment.key}
                    x={x}
                    y={y}
                    width={barWidth}
                    height={height}
                    rx={2}
                    className={segment.className}
                  />
                );
              })}
              <text x={x + barWidth / 2} y={plotHeight + 14} textAnchor="middle" className={styles.objectiveXAxisLabel}>
                {showLabel ? point.date.slice(5) : ''}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function ObjectiveChartCard({
  id,
  title,
  meta,
  children,
  legend,
}: {
  id: string;
  title: string;
  meta?: string;
  children: React.ReactNode;
  legend?: Array<{label: string; className: string}>;
}): React.ReactNode {
  return (
    <section id={id} className={styles.objectiveChartCard}>
      <div className={styles.objectiveChartHead}>
        <div>
          <h3>{title}</h3>
          {meta ? <span>{meta}</span> : null}
        </div>
        {legend?.length ? (
          <div className={styles.objectiveLegend}>
            {legend.map((item) => (
              <span key={item.label}>
                <i className={item.className} />
                {item.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function DailyBasicInfo({date, weather}: {date: string; weather: unknown}): React.ReactNode {
  if (!date) return null;
  const weatherSummary = getWeatherSummary(weather);
  const weatherKind = getWeatherKind(weatherSummary.description);
  const weekdayLabel = getWeekdayLabel(date).replace(/^星期/, '周');
  const holidayLabel = getHolidayLabel(date);
  const weatherMetrics = [
    ['体感', weatherSummary.feelsLike.replace(/^体感\s*/, '')],
    ['湿度', weatherSummary.humidity.replace(/^湿度\s*/, '')],
    ['风速', weatherSummary.wind.replace(/^最大风速\s*/, '')],
    ['降水', weatherSummary.precip.replace(/^降水\s*/, '')],
  ].filter(([, value]) => Boolean(value));

  return (
    <section className={styles.dailyBasicInfo}>
      <div className={styles.dailyDateBlock}>
        <strong>{formatChineseDate(date)}（{weekdayLabel}，{holidayLabel}）</strong>
      </div>
      <div className={`${styles.dailyWeather} ${styles[`dailyWeather_${weatherKind}`]}`}>
        <div className={styles.weatherIcon} aria-hidden="true">
          <span />
          <i />
        </div>
        <div className={styles.weatherMain}>
          <strong>{weatherSummary.area} · {weatherSummary.description}</strong>
          <span>{weatherSummary.temperature}</span>
        </div>
        <div className={styles.weatherMetrics}>
          {weatherMetrics.map(([label, value]) => (
            <small key={label}>
              <em>{label}</em>
              <b>{value}</b>
            </small>
          ))}
        </div>
      </div>
    </section>
  );
}

function DailyYearHeatmap({
  year,
  selectedDate,
  dailyDates,
  onDateSelect,
}: {
  year: number;
  selectedDate: string;
  dailyDates: Set<string>;
  onDateSelect: (date: string) => void;
}): React.ReactNode {
  const {colorMode} = useColorMode();
  const isDark = colorMode === 'dark';
  const today = formatDateKey(new Date());
  const yearProgress = getYearProgress(selectedDate);
  const lifeProgress = getLifeProgress(selectedDate);
  const diaryColor = isDark ? '#64d2ff' : '#0a84ff';
  const pastEmptyColor = isDark ? 'rgba(148, 163, 184, 0.24)' : 'rgba(100, 116, 139, 0.18)';
  const futureColor = isDark ? 'rgba(148, 163, 184, 0.08)' : 'rgba(100, 116, 139, 0.08)';
  const mutedLabelColor = isDark ? 'rgba(226, 232, 240, 0.68)' : 'rgba(51, 65, 85, 0.62)';
  const {values, diaryDays, elapsedDays, futureDays} = useMemo(() => {
    const days = daysInYear(year);
    const today = formatDateKey(new Date());
    let diaryCount = 0;
    let elapsedCount = 0;
    let futureCount = 0;
    const data = days.map((date) => {
      const hasDaily = dailyDates.has(date);
      const isElapsed = date <= today;
      if (hasDaily) diaryCount += 1;
      if (isElapsed) elapsedCount += 1;
      else futureCount += 1;
      const day = Number(date.slice(8, 10));
      const month = Number(date.slice(5, 7));
      const lastDayOfMonth = new Date(year, month, 0).getDate();
      const isSelected = date === selectedDate;
      const isToday = date === today;
      const shouldShowDayNumber = isElapsed && (isSelected || isToday || day === 1 || day === 15 || day === lastDayOfMonth);
      return {
        value: [date, hasDaily ? 2 : isElapsed ? 1 : 0],
        itemStyle: !hasDaily && !isElapsed ? {
          decal: {
            symbol: 'rect',
            dashArrayX: [1, 0],
            dashArrayY: [1, 7],
            rotation: Math.PI / 4,
            color: isDark ? 'rgba(148, 163, 184, 0.1)' : 'rgba(100, 116, 139, 0.08)',
          },
        } : undefined,
        label: shouldShowDayNumber ? {
          show: true,
          formatter: String(day),
          color: isSelected || isToday ? hasDaily ? '#ffffff' : diaryColor : hasDaily ? '#ffffff' : mutedLabelColor,
          fontSize: isSelected || isToday ? 7 : 6,
          fontWeight: isSelected || isToday ? 900 : 760,
          textBorderColor: hasDaily ? (isDark ? 'rgba(2, 6, 23, 0.32)' : 'rgba(10, 132, 255, 0.36)') : 'transparent',
          textBorderWidth: hasDaily ? 1.2 : 0,
        } : undefined,
        disabled: !isElapsed,
      };
    });

    return {values: data, diaryDays: diaryCount, elapsedDays: elapsedCount, futureDays: futureCount};
  }, [dailyDates, diaryColor, isDark, mutedLabelColor, selectedDate, year]);
  const option = useMemo(() => ({
    backgroundColor: 'transparent',
    visualMap: {
      type: 'piecewise',
      show: false,
      dimension: 1,
      pieces: [
        {value: 2, label: '有日记', color: diaryColor},
        {value: 1, label: '过去无日记', color: pastEmptyColor},
        {value: 0, label: '未来', color: futureColor},
      ],
    },
    tooltip: {
      trigger: 'item',
      formatter: (params: {value?: [string, number]}) => {
        const date = params.value?.[0] || '';
        const state = dailyDates.has(date) ? '有日记' : date > today ? '未来' : '无日记';
        return `<b>${formatChineseDate(date)}</b><br/>${state}`;
      },
    },
    calendar: {
      top: 18,
      left: 28,
      right: 8,
      bottom: 2,
      range: `${year}`,
      cellSize: ['auto', 10],
      splitLine: {lineStyle: {color: isDark ? 'rgba(148, 163, 184, 0.12)' : 'rgba(100, 116, 139, 0.12)', width: 0.7}},
      itemStyle: {borderWidth: 0.5, borderColor: isDark ? 'rgba(148, 163, 184, 0.16)' : 'rgba(100, 116, 139, 0.16)'},
      yearLabel: {show: false},
      monthLabel: {color: isDark ? '#94a3b8' : '#64748b', fontSize: 8, margin: 4, nameMap: MONTH_LABELS.map((label) => label.replace('月', ''))},
      dayLabel: {color: isDark ? '#94a3b8' : '#64748b', fontSize: 8, firstDay: 1, nameMap: ['日', '一', '二', '三', '四', '五', '六']},
    },
    series: [{
      type: 'heatmap',
      coordinateSystem: 'calendar',
      data: values,
      label: {
        show: false,
      },
      emphasis: {
        itemStyle: {
          shadowBlur: 6,
          shadowColor: isDark ? 'rgba(100, 210, 255, 0.3)' : 'rgba(10, 132, 255, 0.25)',
        },
      },
      markPoint: selectedDate ? {
        symbol: 'roundRect',
        symbolSize: 10,
        itemStyle: {color: 'transparent', borderColor: isDark ? '#64d2ff' : '#0a84ff', borderWidth: 2},
        data: [{coord: [selectedDate]}],
        label: {show: false},
        silent: true,
      } : undefined,
    }],
  }), [dailyDates, diaryColor, futureColor, isDark, pastEmptyColor, selectedDate, today, values, year]);
  const onEvents = {
    click: (params: {value?: [string, number]; data?: {disabled?: boolean}}) => {
      const date = params.value?.[0];
      if (date && !params.data?.disabled) onDateSelect(date);
    },
  };

  return (
    <section className={styles.dailyYearHeatmap} aria-label={`${year} 年日记热力图`}>
      <div className={styles.dailyYearHeatmapHead}>
        <strong>{year} 年日记</strong>
        <div className={styles.dailyYearHeatmapProgress}>
          <span>
            今年已过去 {formatPercent(yearProgress)} · 人生已过去 {formatPercent(lifeProgress.progress)}
            （过去 {formatNumber(lifeProgress.livedDays)} 天 / 还剩 {formatNumber(lifeProgress.remainingDays)} 天）
          </span>
          <i><b style={{width: `${yearProgress}%`}} /></i>
        </div>
      </div>
      <BrowserOnly fallback={<div className={styles.dailyYearHeatmapChart} />}>
        {() => (
          <ReactECharts
            option={option}
            style={{height: 104, width: '100%'}}
            opts={{renderer: 'svg'}}
            notMerge
            lazyUpdate
            onEvents={onEvents}
          />
        )}
      </BrowserOnly>
      <div className={styles.dailyYearHeatmapLegend}>
        <span>{diaryDays} 天有日记 · {elapsedDays - diaryDays} 天过去无日记 · {futureDays} 天未到来</span>
        <span><i className={styles.dailyYearHeatmapLegendDiary} />有日记</span>
        <span><i className={styles.dailyYearHeatmapLegendPastEmpty} />过去无日记</span>
        <span><i className={styles.dailyYearHeatmapLegendFuture} />未来</span>
      </div>
    </section>
  );
}

function ObjectiveTimeControls({
  scope,
  onChange,
}: {
  scope: ObjectiveTimeScope;
  onChange: (scope: ObjectiveTimeScope) => void;
}): React.ReactNode {
  const years = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016];

  return (
    <div className={styles.objectiveTimeControls} aria-label="客观数据时间范围">
      <div className={styles.objectiveTimeModes}>
        {(['recent', 'year', 'all'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={scope.mode === mode ? styles.objectiveTimeActive : ''}
            onClick={() => {
              if (mode === 'recent') onChange({mode, range: scope.mode === 'recent' ? scope.range : '7d'});
              if (mode === 'year') onChange({mode, year: scope.mode === 'year' ? scope.year : new Date().getFullYear()});
              if (mode === 'all') onChange({mode});
            }}
          >
            {mode === 'recent' ? '近况' : mode === 'year' ? '年度' : '历史'}
          </button>
        ))}
      </div>
      {scope.mode !== 'all' ? <span className={styles.objectiveTimeDivider} aria-hidden="true" /> : null}
      {scope.mode === 'recent' ? (
        <div className={styles.objectiveTimeOptions}>
          {(Object.keys(OBJECTIVE_RANGE_LABELS) as Array<'7d' | '30d' | '90d' | '1y'>).map((range) => (
            <button
              key={range}
              type="button"
              className={scope.range === range ? styles.objectiveTimeActive : ''}
              onClick={() => onChange({mode: 'recent', range})}
            >
              {OBJECTIVE_RANGE_LABELS[range]}
            </button>
          ))}
        </div>
      ) : null}
      {scope.mode === 'year' ? (
        <div className={styles.objectiveTimeOptions}>
          {years.map((year) => (
            <button
              key={year}
              type="button"
              className={scope.year === year ? styles.objectiveTimeActive : ''}
              onClick={() => onChange({mode: 'year', year})}
            >
              {year}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function HealthChartsPanel({
  selectedDate,
  onDateSelect,
  timeScope,
  setTimeScope,
}: {
  selectedDate: string;
  onDateSelect: (date: string) => void;
  timeScope: ObjectiveTimeScope;
  setTimeScope: (scope: ObjectiveTimeScope) => void;
}): React.ReactNode {
  const sections = HEALTH_CHART_NAV.map((section) => section.title);
  return (
    <>
      <HealthProvider
        onDateSelect={onDateSelect}
        selectedDate={selectedDate}
        scope={timeScope as HealthTimeScope}
        setScope={(nextScope) => setTimeScope(nextScope as ObjectiveTimeScope)}
      >
        <HealthChartSubtabs />
        <div className={styles.healthChartsGrid}>
          {sections.map((section) => (
            <section key={section} className={styles.healthChartSection}>
              <HealthSection name={section} />
            </section>
          ))}
        </div>
      </HealthProvider>
    </>
  );
}

const CAREER_CHART_NAV = [
  {id: 'career-ai-tokens', label: 'AI 使用'},
  {id: 'career-git', label: 'Git 推进'},
];

const LIFE_CHART_NAV = [
  {id: 'life-reading-time', label: '阅读时长'},
  {id: 'life-rhythm', label: '生活节奏'},
];

function CareerDataPanel({
  selectedDate,
  onDateSelect,
  timeScope,
}: {
  selectedDate: string;
  onDateSelect: (date: string) => void;
  timeScope: ObjectiveTimeScope;
}): React.ReactNode {
  const [llmPayloads, setLlmPayloads] = useState<Array<{id: string; label: string; payload: LLMSummaryPayload}>>([]);
  const [analyses, setAnalyses] = useState<Record<string, DailyAnalysis>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [llmLoaded, manifest] = await Promise.all([
        Promise.all(LLM_VENDOR_CONFIGS.map(async (vendor) => {
          const payload = await fetchJson<LLMSummaryPayload>(vendor.path);
          return payload ? {id: vendor.id, label: vendor.label, payload} : null;
        })),
        fetchJson<Manifest>('/data/daily-analysis/index.json'),
      ]);
      const dates = manifest?.dates || [];
      const analysisList = await Promise.all(dates.map(async (date) => {
        const analysis = await fetchJson<DailyAnalysis>(`/data/daily-analysis/${dateToPath(date, 'json')}`);
        return analysis ? [date, analysis] as const : null;
      }));
      if (cancelled) return;
      setLlmPayloads(llmLoaded.filter((item): item is {id: string; label: string; payload: LLMSummaryPayload} => Boolean(item)));
      setAnalyses(Object.fromEntries(analysisList.filter((item): item is readonly [string, DailyAnalysis] => Boolean(item))));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const allDates = useMemo(() => {
    const dates = new Set<string>(Object.keys(analyses));
    llmPayloads.forEach((vendor) => Object.keys(vendor.payload.daily_token_usage || {}).forEach((date) => dates.add(date)));
    return [...dates].sort();
  }, [analyses, llmPayloads]);
  const axisDates = useMemo(() => getScopeDates(timeScope, allDates), [allDates, timeScope]);
  const tokenPoints = useMemo<TokenStackPoint[]>(() => axisDates.map((date) => {
    const [minimax, openai, anthropic] = LLM_VENDOR_CONFIGS.map((vendor) =>
      Number(llmPayloads.find((item) => item.id === vendor.id)?.payload.daily_token_usage?.[date] || 0));
    return {
      date,
      minimax,
      openai,
      anthropic,
    };
  }), [axisDates, llmPayloads]);
  const gitPoints = useMemo<ObjectivePoint[]>(() => axisDates.map((date) => {
    const counts = parseGitCounts(analyses[date]);
    return {date, value: counts.auto, secondary: counts.manual, tertiary: counts.total};
  }), [analyses, axisDates]);
  const totalTokens = tokenPoints.reduce((sum, point) => sum + point.minimax + point.openai + point.anthropic, 0);
  const activeAiDays = tokenPoints.filter((point) => point.minimax + point.openai + point.anthropic > 0).length;
  const manualCommits = gitPoints.reduce((sum, point) => sum + Number(point.secondary || 0), 0);
  const totalCommits = gitPoints.reduce((sum, point) => sum + Number(point.tertiary || 0), 0);

  return (
    <>
      <DomainSubtabs items={CAREER_CHART_NAV} />
      <div className={styles.objectiveChartStack}>
        <ObjectiveStatGrid
          items={[
            {value: formatCompactNumber(totalTokens, 1), label: `${scopeLabel(timeScope)} AI token`, tone: 'accent'},
            {value: activeAiDays, label: 'AI 活跃天数', tone: 'green'},
            {value: manualCommits, label: '人工推进提交', tone: 'orange'},
            {value: totalCommits ? `${formatNumber((manualCommits / totalCommits) * 100, 0)}%` : '0%', label: '人工提交占比'},
          ]}
        />
        <ObjectiveChartCard
          id="career-ai-tokens"
          title="AI 使用强度"
          meta={loading ? '加载中' : `${scopeLabel(timeScope)} · 平台 token 堆叠`}
          legend={[
            {label: 'MiniMax', className: styles.legendPrimary},
            {label: 'OpenAI', className: styles.legendSecondary},
            {label: 'Anthropic', className: styles.legendTertiary},
          ]}
        >
          <TokenStackedBarChart
            points={tokenPoints}
            selectedDate={selectedDate}
            onDateSelect={onDateSelect}
          />
        </ObjectiveChartCard>
        <ObjectiveChartCard
          id="career-git"
          title="Git 推进结构"
          meta="从每日 AI 分析中抽取 commit 总量、自动同步与人工推进"
          legend={[
            {label: '自动同步', className: styles.legendPrimary},
            {label: '人工推进', className: styles.legendLine},
            {label: '总提交', className: styles.legendTertiary},
          ]}
        >
          <ObjectiveBarLineChart
            points={gitPoints}
            valueLabel="自动同步"
            secondaryLabel="人工推进"
            tertiaryLabel="总提交"
            selectedDate={selectedDate}
            onDateSelect={onDateSelect}
          />
        </ObjectiveChartCard>
      </div>
    </>
  );
}

function FinanceDataPanel({
  date,
  onDateSelect,
  timeScope,
}: {
  date: string;
  onDateSelect: (date: string) => void;
  timeScope: ObjectiveTimeScope;
}): React.ReactNode {
  const [activeTab, setActiveTab] = useState<FinanceTab>('investment');

  return (
    <>
      <FinanceTabs active={activeTab} onChange={setActiveTab} />
      {activeTab === 'income' ? (
        <div className={styles.financeEmptyPanel}>
          <strong>收入数据</strong>
          <p>暂未接入收入流水数据。</p>
        </div>
      ) : null}
      {activeTab === 'expense' ? (
        <div className={styles.financeEmptyPanel}>
          <strong>支出数据</strong>
          <p>暂未接入支出流水数据。</p>
        </div>
      ) : null}
      {activeTab === 'investment' ? (
        <div className={styles.embeddedDashboardStack}>
          <section className={styles.embeddedDashboardSection}>
            <h3>总资产趋势</h3>
            <FinanceAssetsTrend onDateSelect={onDateSelect} timeScope={timeScope} />
          </section>
          <section className={styles.embeddedDashboardSection}>
            <h3>支付宝持仓</h3>
            <AlipayInvestDashboard date={date} />
          </section>
          <section className={styles.embeddedDashboardSection}>
            <h3>指数账户</h3>
            <AccountAssetsDashboard dataUrl="/data/account-assets/index.json" onDateSelect={onDateSelect} timeScope={timeScope} compact />
          </section>
          <section className={styles.embeddedDashboardSection}>
            <h3>个股账户</h3>
            <AccountAssetsDashboard dataUrl="/data/account-assets/stock.json" onDateSelect={onDateSelect} timeScope={timeScope} compact />
          </section>
          <section className={styles.embeddedDashboardSection}>
            <h3>港股打新</h3>
            <HKIPOCharts dataUrl="/data/hk-ipo/data.json" onDateSelect={onDateSelect} timeScope={timeScope} compact />
          </section>
        </div>
      ) : null}
    </>
  );
}

function LifeDataPanel({
  selectedDate,
  onDateSelect,
  timeScope,
}: {
  selectedDate: string;
  onDateSelect: (date: string) => void;
  timeScope: ObjectiveTimeScope;
}): React.ReactNode {
  const [readingDaily, setReadingDaily] = useState<Record<string, number>>({});
  const [dailyDates, setDailyDates] = useState<string[]>([]);
  const [analysisDates, setAnalysisDates] = useState<string[]>([]);
  const [analyses, setAnalyses] = useState<Record<string, DailyAnalysis>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [readingIndex, dailyManifest, analysisManifest] = await Promise.all([
        fetchJson<{activeYears?: string[]; exportedAt?: string}>('/data/reading/index.json'),
        fetchJson<Manifest>('/data/daily/index.json'),
        fetchJson<Manifest>('/data/daily-analysis/index.json'),
      ]);
      const readingYears = await Promise.all((readingIndex?.activeYears || []).map(async (year) =>
        fetchJson<ReadingYearPayload>(`/data/reading/${year}.json`)));
      const mergedReading: Record<string, number> = {};
      readingYears.forEach((yearData) => {
        Object.entries(yearData?.daily || {}).forEach(([date, value]) => {
          mergedReading[date] = (mergedReading[date] || 0) + Number(value.seconds || 0);
        });
      });
      const dates = analysisManifest?.dates || [];
      const analysisList = await Promise.all(dates.map(async (date) => {
        const analysis = await fetchJson<DailyAnalysis>(`/data/daily-analysis/${dateToPath(date, 'json')}`);
        return analysis ? [date, analysis] as const : null;
      }));
      if (cancelled) return;
      setReadingDaily(mergedReading);
      setDailyDates(dailyManifest?.dates || []);
      setAnalysisDates(dates);
      setAnalyses(Object.fromEntries(analysisList.filter((item): item is readonly [string, DailyAnalysis] => Boolean(item))));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const allDates = useMemo(() => [...new Set([...Object.keys(readingDaily), ...dailyDates, ...analysisDates])].sort(), [analysisDates, dailyDates, readingDaily]);
  const axisDates = useMemo(() => getScopeDates(timeScope, allDates), [allDates, timeScope]);
  const readingPoints = useMemo<ObjectivePoint[]>(() => axisDates.map((date) => ({
    date,
    value: Number(readingDaily[date] || 0),
    secondary: dailyDates.includes(date) ? 1 : 0,
  })), [axisDates, dailyDates, readingDaily]);
  const rhythmPoints = useMemo<ObjectivePoint[]>(() => axisDates.map((date) => ({
    date,
    value: dailyDates.includes(date) ? 1 : 0,
    secondary: analysisDates.includes(date) ? getAnalysisCompleteness(analyses[date]) : 0,
  })), [analyses, analysisDates, axisDates, dailyDates]);
  const totalReadSeconds = readingPoints.reduce((sum, point) => sum + point.value, 0);
  const readingDays = readingPoints.filter((point) => point.value > 0).length;
  const diaryDays = rhythmPoints.filter((point) => point.value > 0).length;
  const analysisDays = rhythmPoints.filter((point) => Number(point.secondary || 0) > 0).length;

  return (
    <>
      <DomainSubtabs items={LIFE_CHART_NAV} />
      <div className={styles.objectiveChartStack}>
        <ObjectiveStatGrid
          items={[
            {value: formatHoursFromSeconds(totalReadSeconds), label: `${scopeLabel(timeScope)} 阅读时长`, tone: 'accent'},
            {value: readingDays, label: '阅读天数', tone: 'green'},
            {value: diaryDays, label: '公开日记天数', tone: 'orange'},
            {value: analysisDays, label: 'AI 分析天数'},
          ]}
        />
        <ObjectiveChartCard
          id="life-reading-time"
          title="阅读投入"
          meta={loading ? '加载中' : '柱为阅读时长，线为公开日记是否存在'}
          legend={[
            {label: '阅读时长', className: styles.legendPrimary},
            {label: '日记', className: styles.legendLine},
          ]}
        >
          <ObjectiveBarLineChart
            points={readingPoints}
            valueLabel="阅读"
            secondaryLabel="日记"
            formatValue={formatHoursFromSeconds}
            selectedDate={selectedDate}
            onDateSelect={onDateSelect}
          />
        </ObjectiveChartCard>
        <ObjectiveChartCard
          id="life-rhythm"
          title="生活记录节奏"
          meta="日记与 AI 分析完整度，用来观察输入、记录、复盘是否闭环"
          legend={[
            {label: '日记', className: styles.legendPrimary},
            {label: '分析完整度', className: styles.legendLine},
          ]}
        >
          <ObjectiveBarLineChart
            points={rhythmPoints}
            valueLabel="日记"
            secondaryLabel="分析完整度"
            selectedDate={selectedDate}
            onDateSelect={onDateSelect}
          />
        </ObjectiveChartCard>
      </div>
    </>
  );
}

function ObjectiveDataPanel({
  selectedDate,
  onDateSelect,
  timeScope,
  setTimeScope,
}: {
  selectedDate: string;
  onDateSelect: (date: string) => void;
  timeScope: ObjectiveTimeScope;
  setTimeScope: (scope: ObjectiveTimeScope) => void;
}): React.ReactNode {
  const [activeDomain, setActiveDomain] = useState<DataDomain>('health');

  return (
    <section className={styles.healthChartsPanel}>
      <DataDomainTabs active={activeDomain} onChange={setActiveDomain} />
      {activeDomain === 'health' ? <HealthChartsPanel selectedDate={selectedDate} onDateSelect={onDateSelect} timeScope={timeScope} setTimeScope={setTimeScope} /> : null}
      {activeDomain === 'career' ? <CareerDataPanel selectedDate={selectedDate} onDateSelect={onDateSelect} timeScope={timeScope} /> : null}
      {activeDomain === 'finance' ? <FinanceDataPanel date={selectedDate} onDateSelect={onDateSelect} timeScope={timeScope} /> : null}
      {activeDomain === 'life' ? <LifeDataPanel selectedDate={selectedDate} onDateSelect={onDateSelect} timeScope={timeScope} /> : null}
    </section>
  );
}

function DailyDetailPanel({
  date,
  year,
  dailyDates,
  weather,
  diary,
  analysis,
  timelineModel,
  loading,
  onDateSelect,
}: {
  date: string;
  year: number;
  dailyDates: Set<string>;
  weather: unknown;
  diary: string;
  analysis: DailyAnalysis | null;
  timelineModel: TimelineModel;
  loading: boolean;
  onDateSelect: (date: string) => void;
}): React.ReactNode {
  const defaultTab = analysis ? 'analysis' : diary ? 'diary' : 'timeline';
  const [activeTab, setActiveTab] = useState<DailyDetailTab>(defaultTab);

  useEffect(() => {
    setActiveTab(analysis ? 'analysis' : diary ? 'diary' : 'timeline');
  }, [analysis, date, diary]);

  return (
    <section className={styles.dailyDetailPanel}>
      <DailyYearHeatmap year={year} selectedDate={date} dailyDates={dailyDates} onDateSelect={onDateSelect} />
      <DailyBasicInfo date={date} weather={weather} />
      <DailyDetailTabs active={activeTab} onChange={setActiveTab} />
      <div className={styles.dailyDetailBody}>
        {loading ? (
          <section className={styles.dailyLoading}>正在加载当日数据...</section>
        ) : (
          <>
            {activeTab === 'diary' ? <DailyDiary diary={diary} /> : null}
            {activeTab === 'timeline' ? <TimelinePanel model={timelineModel} /> : null}
            {activeTab === 'analysis' ? <DailyAnalysisReport analysis={analysis} /> : null}
          </>
        )}
      </div>
    </section>
  );
}

function DailyContext({
  date,
  weather,
  diary,
  analysis,
  timelineModel,
  loading,
  onDateSelect,
  timeScope,
  setTimeScope,
  year,
  dailyDates,
}: {
  date: string;
  weather: unknown;
  diary: string;
  analysis: DailyAnalysis | null;
  timelineModel: TimelineModel;
  loading: boolean;
  onDateSelect: (date: string) => void;
  timeScope: ObjectiveTimeScope;
  setTimeScope: (scope: ObjectiveTimeScope) => void;
  year: number;
  dailyDates: Set<string>;
}): React.ReactNode {
  return (
    <section className={styles.dailyContext}>
      <div className={styles.dailyContextLeft}>
        <ObjectiveDataPanel selectedDate={date} onDateSelect={onDateSelect} timeScope={timeScope} setTimeScope={setTimeScope} />
      </div>
      <div className={styles.dailyContextRight}>
        <DailyDetailPanel
          date={date}
          year={year}
          dailyDates={dailyDates}
          weather={weather}
          diary={diary}
          analysis={analysis}
          timelineModel={timelineModel}
          loading={loading}
          onDateSelect={onDateSelect}
        />
      </div>
    </section>
  );
}

export default function DailyReflectionDashboard({initialYear, children}: DailyReflectionDashboardProps): React.JSX.Element {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [allDates, setAllDates] = useState<string[]>([]);
  const [dailyDates, setDailyDates] = useState<string[]>([]);
  const [analysisDates, setAnalysisDates] = useState<string[]>([]);
  const [selectedYear, setSelectedYear] = useState(initialYear);
  const [viewMode, setViewMode] = useState<'year' | 'life'>('year');
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const [selectedDate, setSelectedDate] = useState('');
  const [diary, setDiary] = useState('');
  const [analysis, setAnalysis] = useState<DailyAnalysis | null>(null);
  const [weather, setWeather] = useState<unknown>(null);
  const [drive, setDrive] = useState<DriveLog | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [dailyHealth, setDailyHealth] = useState<DailyHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [timeScope, setTimeScope] = useState<ObjectiveTimeScope>({mode: 'recent', range: '7d'});

  useEffect(() => {
    let mounted = true;
    Promise.all([
      fetchJson<Manifest>('/data/daily/index.json'),
      fetchJson<Manifest>('/data/daily-analysis/index.json'),
    ])
      .then(([dailyManifest, analysisManifest]) => {
        if (!mounted) return;
        const nextDailyDates = dailyManifest?.dates || [];
        const nextAnalysisDates = analysisManifest?.dates || [];
        const merged = [...new Set([...nextDailyDates, ...nextAnalysisDates])].sort();
        const initialDate = pickInitialDate(nextAnalysisDates.length ? nextAnalysisDates : merged);
        setDailyDates(nextDailyDates);
        setAnalysisDates(nextAnalysisDates);
        setAllDates(merged);
        setSelectedDate(initialDate);
        setSelectedYear(initialYear || Number(initialDate.slice(0, 4)) || new Date().getFullYear());
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [initialYear]);

  useEffect(() => {
    if (!selectedDate) return;
    let cancelled = false;
    const [selectedYearPart, selectedMonth, selectedDay] = selectedDate.split('-');
    setSelectedYear(Number(selectedYearPart));

    setDailyLoading(true);
    Promise.all([
      fetchText(`/data/daily/${dateToPath(selectedDate, 'md')}`),
      fetchJson<DailyAnalysis>(`/data/daily-analysis/${dateToPath(selectedDate, 'json')}`),
      fetchWeather(selectedDate),
      fetchJson<DriveLog>(`/data/drive/${selectedYearPart}/${selectedMonth}/${selectedDay}.json`),
      fetchJson<HealthData>(`/data/health/${selectedYearPart}/${selectedMonth}.json`),
      fetchJson<DailyHealthData>(`/data/health/${selectedYearPart}/${selectedMonth}/${selectedDay}.json`),
    ])
      .then(([
        diaryText,
        analysisJson,
        weatherJson,
        driveJson,
        healthJson,
        dailyHealthJson,
      ]) => {
        if (cancelled) return;
        setDiary(diaryText);
        setAnalysis(analysisJson);
        setWeather(weatherJson);
        setDrive(driveJson);
        setHealth(healthJson);
        setDailyHealth(dailyHealthJson);
      })
      .finally(() => {
        if (!cancelled) setDailyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDate]);

  const years = [2024, 2025, 2026];
  const yearDates = useMemo(
    () => allDates.filter((date) => String(selectedYear) === date.slice(0, 4)),
    [allDates, selectedYear],
  );
  const dailyDateSet = useMemo(
    () => new Set(dailyDates.filter((date) => String(selectedYear) === date.slice(0, 4))),
    [dailyDates, selectedYear],
  );
  const analysisDateSet = useMemo(
    () => new Set(analysisDates.filter((date) => String(selectedYear) === date.slice(0, 4))),
    [analysisDates, selectedYear],
  );
  const sleep = getMetricEntry(health, 'sleep_analysis', selectedDate);
  const timelineModel = useMemo(
    () => buildTimelineModel({sleep, dailyHealth, drive, weather}),
    [dailyHealth, drive, sleep, weather],
  );
  const handleSelectYear = (year: number, latest?: string) => {
    setViewMode('year');
    setSelectedYear(year);
    setCalendarExpanded(false);
    if (latest) setSelectedDate(latest);
  };
  const handleSelectLife = () => {
    setViewMode('life');
    setCalendarExpanded(true);
  };

  return (
    <div className={styles.page}>
      <header className={styles.dashboardHeader}>
        <div className={styles.dashboardHeaderText}>
          <h1>三省吾身</h1>
        </div>
        <ObjectiveTimeControls scope={timeScope} onChange={setTimeScope} />
      </header>

      {(viewMode === 'life' || calendarExpanded) ? (
        <section className={styles.calendarShell}>
          <div className={styles.calendarTopline}>
            <div>
              <span>{viewMode === 'life' ? '人生日历' : '年度日历'}</span>
              {viewMode === 'life' ? <h2>一生</h2> : null}
            </div>
            <div className={styles.yearSwitch}>
              {years.map((year) => {
                const latest = allDates.filter((date) => date.startsWith(`${year}-`)).at(-1);
                return (
                  <button
                    key={year}
                    type="button"
                    className={viewMode === 'year' && year === selectedYear ? styles.yearSelected : ''}
                    onClick={() => handleSelectYear(year, latest)}
                  >
                    {year}
                  </button>
                );
              })}
              <button type="button" className={viewMode === 'life' ? styles.yearSelected : ''} onClick={handleSelectLife}>
                人生
              </button>
            </div>
          </div>
          {viewMode === 'life' ? (
            <LifeCalendar />
          ) : selectedYear ? (
            <ReflectionCalendar
              year={selectedYear}
              dailyDates={dailyDateSet}
              analysisDates={analysisDateSet}
              selectedDate={selectedDate}
              onToggleCompact={() => setCalendarExpanded((value) => !value)}
              onSelect={(date) => {
                setSelectedDate(date);
                setCalendarExpanded(false);
              }}
            />
          ) : (
            <p className={styles.muted}>正在加载日历...</p>
          )}
        </section>
      ) : null}

      {viewMode === 'life' ? (
        <div ref={contentRef} className={styles.lifeContent}>
          {children}
        </div>
      ) : (
        <>
          {loading && !selectedDate ? (
            <section className={styles.dailyLoading}>
              正在加载数据...
            </section>
          ) : (
            <DailyContext
              date={selectedDate}
              weather={weather}
              diary={diary}
              analysis={analysis}
              timelineModel={timelineModel}
              loading={dailyLoading}
              onDateSelect={setSelectedDate}
              timeScope={timeScope}
              setTimeScope={setTimeScope}
              year={selectedYear || new Date().getFullYear()}
              dailyDates={dailyDateSet}
            />
          )}

          <div ref={contentRef} className={styles.contentAnchor} />
        </>
      )}
    </div>
  );
}
