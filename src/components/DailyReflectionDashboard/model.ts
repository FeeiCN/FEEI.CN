import type React from 'react';
import {getWeatherCodeLabel, WEATHER_CODE_LABELS} from '@site/src/utils/weather';

export {getWeatherCodeLabel, WEATHER_CODE_LABELS};

export type DailyReflectionDashboardProps = {
  initialYear?: number;
  children?: React.ReactNode;
};

export type AnalysisInsight = {
  expert_view?: string;
  summary?: string;
  positioning?: string;
  evidence?: string[];
  means?: string;
  not_means?: string;
  uncertainty?: string;
  professional_suggestion?: string;
};

export type TopSignal = {
  area?: string;
  summary?: string;
  evidence?: string[];
  confidence?: string;
};

export type DataStatus = {
  area?: string;
  status?: string;
  detail?: string;
};

export type DailyAnalysis = {
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

export type Manifest = {
  dates?: string[];
};

export type DailyHealthTimelineRecord = {
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

export type DailyHealthData = {
  exportedAt?: string;
  date?: string;
  summary?: Record<string, unknown>;
  timeline?: DailyHealthTimelineRecord[];
};

export type DriveLog = Record<string, {action?: string; address?: string}>;
export type DriveDaySummary = {
  trips: number;
  minutes: number;
  tripRanges: Array<{start: number; end: number}>;
  firstDeparture?: number;
  lastArrival?: number;
};

export function summarizeDriveLog(log: DriveLog | null): DriveDaySummary {
  const events = Object.entries(log || {})
    .map(([key, value]) => ({minute: timeToMinute(key.split('#')[0]), action: value.action || '', address: value.address || ''}))
    .filter((event): event is {minute: number; action: string; address: string} => event.minute !== null)
    .sort((left, right) => left.minute - right.minute);
  let departure: number | null = null;
  let trips = 0;
  let minutes = 0;
  let firstDeparture: number | undefined;
  let lastArrival: number | undefined;
  const tripRanges: Array<{start: number; end: number}> = [];
  events.forEach((event) => {
    if (/上车/.test(event.action)) {
      departure = event.minute;
      firstDeparture ??= event.minute;
    } else if (/下车/.test(event.action) && departure !== null && event.minute >= departure) {
      trips += 1;
      minutes += event.minute - departure;
      tripRanges.push({start: departure, end: event.minute});
      lastArrival = event.minute;
      departure = null;
    }
  });
  return {trips, minutes, tripRanges, firstDeparture, lastArrival};
}

export type LLMSummaryPayload = {
  fetchedAt?: string;
  daily_token_usage?: Record<string, number>;
};

export type ReadingYearPayload = {
  year?: string;
  daily?: Record<string, {seconds?: number; books?: string[]}>;
};

export type ObjectivePoint = {
  date: string;
  value: number;
  secondary?: number;
  tertiary?: number;
};

export type TokenStackPoint = {
  date: string;
  minimax: number;
  openai: number;
  anthropic: number;
};

export type WeatherSummary = {
  description: string;
  temperature: string;
  feelsLike: string;
  humidity: string;
  wind: string;
  precip: string;
  area: string;
};

export type TimelineItem = {
  type: 'sleep' | 'drive' | 'weather' | 'workout' | 'medication' | 'mind';
  title: string;
  detail?: string;
  startMinute: number;
  endMinute?: number;
  stage?: string;
};

export type TimelineBand = {
  type: 'movement' | 'stand' | 'daylight' | 'stairs' | 'active_energy' | 'handwashing';
  startMinute: number;
  endMinute: number;
  intensity: number;
  title: string;
  detail?: string;
};

export type SleepSegment = {
  stage?: string;
  label: string;
  startMinute: number;
  endMinute: number;
};

export type SleepBlock = {
  startMinute: number;
  endMinute: number;
  detail: string;
  segments: SleepSegment[];
};

export type TimelineModel = {
  items: TimelineItem[];
  bands: TimelineBand[];
  sleep: SleepBlock[];
  weather: TimelineItem[];
  exerciseMinutes: number | null;
  healthAvailable: boolean;
  healthObservedUntil: number | null;
  driveAvailable: boolean;
};

export type ObjectiveChartTooltip = {
  x: number;
  y: number;
  title: string;
  lines: string[];
};

export type DataDomain = 'health' | 'career' | 'finance' | 'life' | 'compare';
export type DailyDetailTab = 'diary' | 'timeline' | 'analysis';
export type FinanceTab = 'income' | 'expense' | 'investment';
export type DatedReviewPeriodKind = 'day' | 'week' | 'month' | 'year';
export type ReviewPeriodKind = DatedReviewPeriodKind | 'life';
export type DatedReviewPeriod =
  | {kind: 'day'; key: string}
  | {kind: 'week'; key: string}
  | {kind: 'month'; key: string}
  | {kind: 'year'; key: string};
export type ReviewPeriod = DatedReviewPeriod | {kind: 'life'};
export type PeriodBounds = {
  start: string;
  naturalEnd: string;
  end: string;
  label: string;
};
export type ObjectiveTimeScope =
  | {mode: 'recent'; range: '7d' | '30d' | '90d' | '1y'}
  | {mode: 'period'; start: string; end: string; label?: string}
  | {mode: 'year'; year: number}
  | {mode: 'all'; label?: string};

export const OBJECTIVE_RANGE_LABELS: Record<string, string> = {'7d': '7天', '30d': '30天', '90d': '90天', '1y': '1年'};
export const RANGE_DAYS: Record<'7d' | '30d' | '90d' | '1y', number> = {'7d': 7, '30d': 30, '90d': 90, '1y': 365};
export const DATED_REVIEW_PERIOD_KINDS: DatedReviewPeriodKind[] = ['day', 'week', 'month', 'year'];
export const REVIEW_PERIOD_LABELS: Record<ReviewPeriodKind, string> = {day: '日', week: '周', month: '月', year: '年', life: '人生'};
export const LLM_VENDOR_CONFIGS = [
  {id: 'minimax', label: 'MiniMax', path: '/data/llm-usage/minimax/usage_summary.json'},
  {id: 'openai', label: 'OpenAI', path: '/data/llm-usage/openai/usage_summary.json'},
  {id: 'anthropic', label: 'Anthropic', path: '/data/llm-usage/anthropic/usage_summary.json'},
];

export const MONTH_LABELS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
export const REVIEW_START_YEAR = 2014;
export const LIFE_START_DATE = '1992-01-01';
export const LIFE_END_DATE = '2092-12-31';
export const HEALTH_HISTORY_START_DATE = '2016-08-13';
export const HANGZHOU_LATITUDE = 30.2741;
export const HANGZHOU_LONGITUDE = 120.1551;
export const jsonRequestCache = new Map<string, Promise<unknown | null>>();
export const textRequestCache = new Map<string, Promise<string>>();
export type AuthoredPeriodReview = {
  title: string;
  summary: string;
  href: string;
  load: () => Promise<{default: React.ComponentType<unknown>}>;
};
export const AUTHORED_PERIOD_REVIEWS: Record<string, AuthoredPeriodReview> = {
  'year:2019': {
    title: '2019 年度总结：一个安全工程师的七年之痒',
    summary: '从蘑菇街到蚂蚁金服，复盘七年安全工程经历、平台选择与职业阶段转换。',
    href: '/a-security-engineer-2019',
    load: () => import('@site/docs/05-吴飞飞/02-年度总结/a-security-engineer-2019/index.md'),
  },
  'year:2023': {
    title: '2023 年度总结：成家立业',
    summary: '这一年完成从网商银行到支付宝的职业转折，也建立家庭，在变化与压力中重新寻找平衡。',
    href: '/annual-review-2023',
    load: () => import('@site/docs/05-吴飞飞/02-年度总结/annual-review-2023/index.md'),
  },
  'year:2024': {
    title: '2024 年度总结',
    summary: '复盘工作晋升、知识沉淀、AI 实践、生活空间、旅行、财务与健康状态。',
    href: '/annual-review-for-2024',
    load: () => import('@site/docs/05-吴飞飞/02-年度总结/annual-review-for-2024/index.md'),
  },
  'year:2025': {
    title: '2025 年度总结：量变到质变',
    summary: '围绕健康幸福、事业有成、财务自由与探索世界持续积累，个人成长系统开始显现复利。',
    href: '/annual-review-for-2025',
    load: () => import('@site/docs/05-吴飞飞/02-年度总结/annual-review-for-2025/index.md'),
  },
  'month:2024-11': {
    title: '2024 年 11 月复盘：Happiness',
    summary: '以 Happiness 为关键词，记录工作反馈、知识结构、AI 实践与生活空间带来的幸福感。',
    href: '/the-happiness-of-nov-2024',
    load: () => import('@site/docs/05-吴飞飞/02-年度总结/annual-review-for-2024/the-happiness-of-nov-2024/index.md'),
  },
  'month:2024-12': {
    title: '2024 年 12 月复盘：Trend',
    summary: '以 Trend 为关键词，复盘工作、行业、投资与健康中的趋势，以及下一阶段判断。',
    href: '/december-2024-in-review-trend',
    load: () => import('@site/docs/05-吴飞飞/02-年度总结/annual-review-for-2024/december-2024-in-review-trend/index.md'),
  },
};
export function dateToPath(date: string, suffix: string): string {
  const [year, month, day] = date.split('-');
  return `${year}/${month}/${day}.${suffix}`;
}

export function formatChineseDate(date: string): string {
  const [year, month, day] = date.split('-');
  return `${Number(year)}年${Number(month)}月${Number(day)}日`;
}

export function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDateKey(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function isValidDateKey(value: string, allowFuture = false): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = parseDateKey(value);
  if (Number.isNaN(parsed.getTime()) || formatDateKey(parsed) !== value) return false;
  return allowFuture || value <= formatDateKey(new Date());
}

export function getPreviousDateKey(date: string): string {
  const value = parseDateKey(date);
  value.setDate(value.getDate() - 1);
  return formatDateKey(value);
}

export function diffDays(start: string, end: string): number {
  const startTime = parseDateKey(start).getTime();
  const endTime = parseDateKey(end).getTime();
  return Math.max(0, Math.floor((endTime - startTime) / 86400000));
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '0%';
  return `${formatNumber(value, 1)}%`;
}

export function getYearProgress(date: string): number {
  const current = parseDateKey(date);
  const start = new Date(current.getFullYear(), 0, 1);
  const end = new Date(current.getFullYear(), 11, 31);
  const elapsed = diffDays(formatDateKey(start), date) + 1;
  const total = diffDays(formatDateKey(start), formatDateKey(end)) + 1;
  return (elapsed / total) * 100;
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function dateRange(start: string, end: string): string[] {
  const output: string[] = [];
  if (!isValidDateKey(start, true) || !isValidDateKey(end, true) || start > end) return output;
  for (let cursor = parseDateKey(start); formatDateKey(cursor) <= end; cursor = addDays(cursor, 1)) {
    output.push(formatDateKey(cursor));
  }
  return output;
}

export function getIsoWeekKey(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1, day));
  const weekday = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - weekday);
  const weekYear = target.getUTCFullYear();
  const yearStart = new Date(Date.UTC(weekYear, 0, 1));
  const week = Math.ceil((((target.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${weekYear}-W${String(week).padStart(2, '0')}`;
}

export function getIsoWeekStart(weekKey: string): string {
  const match = weekKey.match(/^(\d{4})-W(\d{2})$/);
  if (!match) return '';
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (week < 1 || week > 53) return '';
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const weekday = januaryFourth.getUTCDay() || 7;
  const monday = new Date(januaryFourth);
  monday.setUTCDate(januaryFourth.getUTCDate() - weekday + 1 + (week - 1) * 7);
  return monday.toISOString().slice(0, 10);
}

export function getReviewPeriodBounds(period: DatedReviewPeriod): PeriodBounds {
  const today = formatDateKey(new Date());
  if (period.kind === 'day') {
    const date = isValidDateKey(period.key) ? period.key : today;
    return {start: date, naturalEnd: date, end: date, label: formatChineseDate(date)};
  }
  if (period.kind === 'week') {
    const start = getIsoWeekStart(period.key) || getIsoWeekStart(getIsoWeekKey(today));
    const naturalEnd = formatDateKey(addDays(parseDateKey(start), 6));
    const end = naturalEnd > today ? today : naturalEnd;
    return {
      start,
      naturalEnd,
      end,
      label: `${period.key} · ${Number(start.slice(5, 7))}月${Number(start.slice(8, 10))}日-${Number(naturalEnd.slice(5, 7))}月${Number(naturalEnd.slice(8, 10))}日`,
    };
  }
  if (period.kind === 'month') {
    const key = /^\d{4}-\d{2}$/.test(period.key) ? period.key : today.slice(0, 7);
    const [year, month] = key.split('-').map(Number);
    const naturalEnd = formatDateKey(new Date(year, month, 0));
    const end = naturalEnd > today ? today : naturalEnd;
    return {start: `${key}-01`, naturalEnd, end, label: `${year}年${month}月`};
  }
  const year = /^\d{4}$/.test(period.key) ? Number(period.key) : Number(today.slice(0, 4));
  const naturalEnd = `${year}-12-31`;
  const end = naturalEnd > today ? today : naturalEnd;
  return {start: `${year}-01-01`, naturalEnd, end, label: `${year}年`};
}

export function periodFromAnchor(kind: DatedReviewPeriodKind, anchorDate: string): DatedReviewPeriod {
  const date = isValidDateKey(anchorDate) ? anchorDate : formatDateKey(new Date());
  if (kind === 'day') return {kind, key: date};
  if (kind === 'week') return {kind, key: getIsoWeekKey(date)};
  if (kind === 'month') return {kind, key: date.slice(0, 7)};
  return {kind, key: date.slice(0, 4)};
}

export function shiftReviewPeriod(period: DatedReviewPeriod, amount: number): DatedReviewPeriod {
  const bounds = getReviewPeriodBounds(period);
  if (period.kind === 'day') return periodFromAnchor('day', formatDateKey(addDays(parseDateKey(bounds.start), amount)));
  if (period.kind === 'week') return periodFromAnchor('week', formatDateKey(addDays(parseDateKey(bounds.start), amount * 7)));
  if (period.kind === 'month') {
    const [year, month] = period.key.split('-').map(Number);
    const shifted = new Date(year, month - 1 + amount, 1);
    return {kind: 'month', key: `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, '0')}`};
  }
  return {kind: 'year', key: String(Number(period.key) + amount)};
}

export function isFutureReviewPeriod(period: DatedReviewPeriod): boolean {
  return getReviewPeriodBounds(period).start > formatDateKey(new Date());
}

export function getScopeDates(scope: ObjectiveTimeScope, availableDates: string[] = [], anchorDate?: string): string[] {
  const today = formatDateKey(new Date());
  const rangeEnd = /^\d{4}-\d{2}-\d{2}$/.test(anchorDate || '') ? anchorDate! : today;
  if (scope.mode === 'period') return dateRange(scope.start, scope.end);
  if (scope.mode === 'recent') {
    const days = RANGE_DAYS[scope.range];
    return dateRange(formatDateKey(addDays(parseDateKey(rangeEnd), -(days - 1))), rangeEnd);
  }
  if (scope.mode === 'year') {
    const start = `${scope.year}-01-01`;
    const end = [`${scope.year}-12-31`, rangeEnd].sort()[0];
    return dateRange(start, end);
  }
  const sorted = availableDates.filter((date) => Boolean(date) && date <= today).sort();
  if (sorted.length) return sorted;
  return dateRange(formatDateKey(addDays(parseDateKey(today), -29)), today);
}

export function getScopedAvailableDates(scope: ObjectiveTimeScope, availableDates: string[], anchorDate?: string): string[] {
  if (scope.mode === 'all') {
    const today = formatDateKey(new Date());
    return availableDates.filter((date) => date <= today).sort();
  }
  const scoped = new Set(getScopeDates(scope, availableDates, anchorDate));
  return availableDates.filter((date) => scoped.has(date));
}

export function scopeLabel(scope: ObjectiveTimeScope): string {
  if (scope.mode === 'period') return scope.label || `${scope.start} 至 ${scope.end}`;
  if (scope.mode === 'recent') return OBJECTIVE_RANGE_LABELS[scope.range];
  if (scope.mode === 'year') return `${scope.year}年`;
  return scope.label || '全部数据';
}

export function formatCompactNumber(value: number, maximumFractionDigits = 1): string {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 1_000_000_000) return `${formatNumber(value / 1_000_000_000, maximumFractionDigits)}B`;
  if (Math.abs(value) >= 1_000_000) return `${formatNumber(value / 1_000_000, maximumFractionDigits)}M`;
  if (Math.abs(value) >= 1_000) return `${formatNumber(value / 1_000, maximumFractionDigits)}K`;
  return formatNumber(value, maximumFractionDigits);
}

export function formatHoursFromSeconds(seconds: number): string {
  if (!seconds) return '0h';
  const hours = seconds / 3600;
  if (hours < 1) return `${Math.round(seconds / 60)}m`;
  return `${formatNumber(hours, hours >= 10 ? 0 : 1)}h`;
}

export function extractFirstNumber(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const value = Number(match[1].replace(/,/g, ''));
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

export function parseChineseCount(value: string | undefined): number | null {
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

export function extractFirstCount(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = parseChineseCount(match?.[1]);
    if (value !== null) return value;
  }
  return null;
}

export function parseGitCounts(analysis: DailyAnalysis | null): {total: number; auto: number; manual: number} {
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
    /commit_count\s*[:=]?\s*(\d+)/i,
    /当天\s*(\d+)\s*次提交/,
    /(\d+)\s*次提交/,
    /(\d+)\s*个\s*commit/i,
    /(\d+)\s*次\s*commit/i,
    /目标日共\s*(\d+)/,
  ]) || 0;
  const auto = extractFirstNumber(text, [
    /自动化\s*commit\s*占比\s*≈?\s*(\d+)\s*\/\s*(\d+)/,
    /其中\s*(\d+)\+?\s*个为\s*\[auto\]/i,
    /\[auto\][^，。；;]*(?:超过|约)\s*(\d+)/i,
    /其中\s*(\d+)\s*条?\s*为\s*\[auto\]/i,
    /(\d+)\s*条?\s*\[auto\]/i,
  ]);
  const manual = extractFirstCount(text, [
    /剩余\s*(\d+)[-–]\d+\s*次手动/,
    /剩余\s*(\d+)\s*次手动/,
    /真正的人工推进只有[^。；;]*?(\d+|一|二|两|三|四|五|六|七|八|九|十)\s*条/,
    /人工\s*commit[^。；;]*?(\d+|一|二|两|三|四|五|六|七|八|九|十)\s*条/,
    /(\d+|一|二|两|三|四|五|六|七|八|九|十)\s*条\s*手动\s*commit/i,
  ]);
  const inferredAuto = auto ?? (manual !== null && total ? Math.max(0, total - manual) : 0);
  const inferredManual = manual ?? (total ? Math.max(0, total - inferredAuto) : 0);
  return {total, auto: inferredAuto, manual: inferredManual};
}

export function getAnalysisCompleteness(analysis: DailyAnalysis | null): number {
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

export function getWeekdayLabel(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(year, month - 1, day).getDay();
  return `星期${['日', '一', '二', '三', '四', '五', '六'][value]}`;
}

export function getHolidayLabel(date: string): string {
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

export function getNestedValue(source: unknown, path: Array<string | number>): unknown {
  return path.reduce<unknown>((current, key) => {
    if (current === null || current === undefined) return undefined;
    return (current as Record<string | number, unknown>)[key];
  }, source);
}

export function getOpenMeteoValue(weather: unknown, section: 'daily' | 'hourly', key: string, index = 0): unknown {
  const value = getNestedValue(weather, [section, key]);
  return Array.isArray(value) ? value[index] : undefined;
}

export function getOpenMeteoHourIndex(weather: unknown, hour: number): number {
  const times = getNestedValue(weather, ['hourly', 'time']);
  if (!Array.isArray(times)) return -1;
  return times.findIndex((value) => String(value).endsWith(`T${String(hour).padStart(2, '0')}:00`));
}

export function formatTemperatureRange(min: unknown, max: unknown): string {
  const minValue = Number(min);
  const maxValue = Number(max);
  if (Number.isFinite(minValue) && Number.isFinite(maxValue)) {
    return `${Math.round(minValue)}-${Math.round(maxValue)}°C`;
  }
  if (Number.isFinite(maxValue)) return `${Math.round(maxValue)}°C`;
  if (Number.isFinite(minValue)) return `${Math.round(minValue)}°C`;
  return '暂无';
}

export function getWeatherSummary(weather: unknown): WeatherSummary {
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

export function getWeatherKind(description: string): 'sunny' | 'cloudy' | 'rainy' | 'snowy' | 'foggy' {
  if (/雪|冰雹|雪粒/.test(description)) return 'snowy';
  if (/雨|阵雨|雷暴/.test(description)) return 'rainy';
  if (/雾/.test(description)) return 'foggy';
  if (/阴|云/.test(description)) return 'cloudy';
  return 'sunny';
}

export function formatNumber(value: unknown, maximumFractionDigits = 0): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return '暂无';
  return new Intl.NumberFormat('zh-CN', {maximumFractionDigits}).format(number);
}

export function formatDuration(seconds: unknown): string {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return '0 分钟';
  const minutes = Math.round(value / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}

export function timeToMinute(value: unknown): number | null {
  if (!value) return null;
  const text = String(value);
  const time = text.match(/(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?/);
  if (!time) return null;
  const hour = Number(time[1]);
  const minute = Number(time[2]);
  const second = Number(time[3] || 0);
  if (
    !Number.isFinite(hour)
    || !Number.isFinite(minute)
    || !Number.isFinite(second)
    || hour < 0
    || hour > 24
    || minute < 0
    || minute > 59
    || second < 0
    || second >= 60
    || (hour === 24 && (minute > 0 || second > 0))
  ) return null;
  return hour * 60 + minute + second / 60;
}

export function minuteToLabel(minute: number, includeSeconds = false): string {
  const totalSeconds = Math.max(0, Math.min(86400, Math.round(minute * 60)));
  const hour = Math.floor(totalSeconds / 3600);
  const rest = totalSeconds % 3600;
  const minutes = Math.floor(rest / 60);
  const seconds = rest % 60;
  const base = `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  return includeSeconds && seconds ? `${base}:${String(seconds).padStart(2, '0')}` : base;
}

export function daysInYear(year: number): string[] {
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

export function pickInitialDate(dates: string[]): string {
  if (typeof window !== 'undefined') {
    const value = new URLSearchParams(window.location.search).get('date');
    if (value && isValidDateKey(value)) {
      return value;
    }
  }
  return dates[dates.length - 1] || '';
}

export function pickInitialReviewPeriod(fallbackDate: string): ReviewPeriod {
  const fallback: DatedReviewPeriod = fallbackDate
    ? periodFromAnchor('day', fallbackDate)
    : {kind: 'day', key: ''};
  if (typeof window === 'undefined') return fallback;
  const params = new URLSearchParams(window.location.search);
  const legacyView = params.get('view');
  const rawKind = legacyView === 'year' ? 'year' : params.get('period');
  if (legacyView === 'life' || rawKind === 'life') return {kind: 'life'};
  if (!rawKind || !DATED_REVIEW_PERIOD_KINDS.includes(rawKind as DatedReviewPeriodKind)) return fallback;
  const kind = rawKind as DatedReviewPeriodKind;
  const paramName = kind === 'day' ? 'date' : kind;
  const key = params.get(paramName);
  if (!key) return fallback;
  const candidate = {kind, key} as DatedReviewPeriod;
  if (kind === 'day' && !isValidDateKey(key)) return fallback;
  if (kind === 'week' && !getIsoWeekStart(key)) return fallback;
  if (kind === 'month' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) return fallback;
  if (kind === 'year' && !/^\d{4}$/.test(key)) return fallback;
  return isFutureReviewPeriod(candidate) ? fallback : candidate;
}

export async function fetchJson<T>(path: string): Promise<T | null> {
  const cached = jsonRequestCache.get(path);
  if (cached) return cached as Promise<T | null>;

  const request = (async (): Promise<T | null> => {
    try {
      const response = await fetch(path);
      if (!response.ok) {
        jsonRequestCache.delete(path);
        return null;
      }
      const text = await response.text();
      if (/^\s*<!doctype html/i.test(text) || text.includes('<div id="__docusaurus"></div>')) {
        jsonRequestCache.delete(path);
        return null;
      }
      return JSON.parse(text) as T;
    } catch {
      jsonRequestCache.delete(path);
      return null;
    }
  })();
  jsonRequestCache.set(path, request);
  return request;
}

export async function fetchText(path: string): Promise<string> {
  const cached = textRequestCache.get(path);
  if (cached) return cached;

  const request = (async (): Promise<string> => {
    try {
      const response = await fetch(path);
      if (!response.ok) {
        textRequestCache.delete(path);
        return '';
      }
      const text = await response.text();
      if (/^\s*<!doctype html/i.test(text) || text.includes('<div id="__docusaurus"></div>')) {
        textRequestCache.delete(path);
        return '';
      }
      return text;
    } catch {
      textRequestCache.delete(path);
      return '';
    }
  })();
  textRequestCache.set(path, request);
  return request;
}

export async function fetchDailyAnalysis(date: string): Promise<DailyAnalysis | null> {
  const markdown = await fetchText(`/data/daily-analysis/${dateToPath(date, 'md')}`);
  if (markdown.trim()) {
    return {date, legacy_report_markdown: markdown};
  }
  // Historical reports remain readable while new reports use Markdown.
  return fetchJson<DailyAnalysis>(`/data/daily-analysis/${dateToPath(date, 'json')}`);
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, () => worker()));
  return results;
}

export async function fetchWeather(date: string): Promise<unknown | null> {
  const archived = await fetchJson(`/data/weather/${dateToPath(date, 'json')}`);
  if (archived) return archived;
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
