import React, {useContext, useEffect, useMemo, useRef, useState} from 'react';
import ReactDOM from 'react-dom';
import BrowserOnly from '@docusaurus/BrowserOnly';
import {useColorMode} from '@docusaurus/theme-common';
import ReactECharts from 'echarts-for-react';
import {transform, computeDashboard, getDateRange, type HealthData, type DashCard} from './transform';
import {
  RANGE_DAYS, RANGE_LABELS, EMPTY, getAvailableMonthMap,
  YearCtx, type RecentRange, type TimeScope,
} from './index-shared';
import styles from './styles.module.css';

export {YearCtx} from './index-shared';
export type {TimeScope, YearCtxType} from './index-shared';

type CC = {axis: string; label: string; split: string};
type HealthDeviationLevel = 'notice' | 'warning';
type HealthDeviation = {
  level: HealthDeviationLevel;
  tooltip: string;
};
type DeviationPoint = {date: string; value: number};
type DeviationSeries = {name: string; points: DeviationPoint[]};

const HEALTH_CHART_COLORS = ['#16a34a', '#f97316', '#ef4444', '#0d9488', '#db2777', '#eab308', '#64748b'];
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const MIN_BASELINE_SAMPLES = 4;
const HEALTH_FETCH_CONCURRENCY = 3;
const ECHARTS_RENDERER_OPTIONS = {renderer: 'canvas' as const, useDirtyRect: false};
const HEALTH_MONTH_CACHE_LIMIT = 12;
const CURRENT_MONTH_CACHE_TTL_MS = 60_000;
const healthMonthCache = new Map<string, {data: HealthData; cachedAt: number}>();
const healthMonthRequestCache = new Map<string, Promise<HealthData | null>>();
let healthHistoryCache: HealthData | null = null;
let healthHistoryRequestCache: Promise<HealthData | null> | null = null;

type HealthHistoryPayload = {
  data?: HealthData;
};

export function loadHealthChartHistory(): Promise<HealthData | null> {
  if (healthHistoryCache) return Promise.resolve(healthHistoryCache);
  if (healthHistoryRequestCache) return healthHistoryRequestCache;

  healthHistoryRequestCache = fetch('/data/health/history.json', {cache: 'no-store'})
    .then(async (response) => {
      if (!response.ok) return null;
      const payload = await response.json() as HealthHistoryPayload;
      if (!payload.data || !Array.isArray(payload.data.steps)) return null;
      healthHistoryCache = payload.data;
      return payload.data;
    })
    .catch(() => null)
    .finally(() => {
      healthHistoryRequestCache = null;
    });
  return healthHistoryRequestCache;
}

function readCachedHealthMonth(key: string, currentKey: string): HealthData | null {
  const cached = healthMonthCache.get(key);
  if (!cached || (key === currentKey && Date.now() - cached.cachedAt > CURRENT_MONTH_CACHE_TTL_MS)) {
    if (cached) healthMonthCache.delete(key);
    return null;
  }
  healthMonthCache.delete(key);
  healthMonthCache.set(key, cached);
  return cached.data;
}

function cacheHealthMonth(key: string, data: HealthData) {
  healthMonthCache.delete(key);
  healthMonthCache.set(key, {data, cachedAt: Date.now()});
  while (healthMonthCache.size > HEALTH_MONTH_CACHE_LIMIT) {
    const oldestKey = healthMonthCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    healthMonthCache.delete(oldestKey);
  }
}

function fetchHealthMonth(key: string, currentKey: string): Promise<HealthData | null> {
  const cached = readCachedHealthMonth(key, currentKey);
  if (cached) return Promise.resolve(cached);

  const inFlight = healthMonthRequestCache.get(key);
  if (inFlight) return inFlight;

  const [year, month] = key.split('-');
  const request = fetch(`/data/health/${year}/${month}.json`, {
    cache: key === currentKey ? 'no-store' : 'default',
  })
    .then(async (response) => {
      if (!response.ok) return null;
      const data = transform(await response.json());
      cacheHealthMonth(key, data);
      return data;
    })
    .catch(() => null)
    .finally(() => healthMonthRequestCache.delete(key));
  healthMonthRequestCache.set(key, request);
  return request;
}

function cc(isDark: boolean): CC {
  return {
    axis: isDark ? 'rgba(148,163,184,0.22)' : 'rgba(100,116,139,0.20)',
    label: isDark ? '#94a3b8' : '#64748b',
    split: isDark ? 'rgba(148,163,184,0.10)' : 'rgba(100,116,139,0.14)',
  };
}

function xCat(c: CC, data: [string, number][], interval?: number) {
  const n = data.length;
  const isLong = n > 400;
  const auto = interval ?? (n <= 30 ? 0 : isLong ? Math.max(1, Math.floor(n / 14)) : 13);
  const fmt = n <= 30
    ? formatMonthDay
    : isLong ? (v: string) => v?.slice(0, 7) ?? '' : (v: string) => v?.slice(5) ?? '';
  return {
    type: 'category',
    data: data.map(([d]) => d),
    axisTick: {show: false},
    axisLine: {lineStyle: {color: c.axis}},
    axisLabel: {color: c.label, fontSize: 10, interval: auto, formatter: fmt},
  };
}

function xAxisFromDates(c: CC, dates: string[], interval?: number) {
  return xCat(c, dates.map((date) => [date, 0] as [string, number]), interval);
}

function formatMonthDay(value: string | number) {
  const raw = typeof value === 'number' ? new Date(value).toISOString().slice(0, 10) : value;
  return raw && raw.length >= 10 ? raw.slice(5, 10) : raw?.toString() ?? '';
}

function formatMonthDayWeekday(value: string | number) {
  const raw = typeof value === 'number' ? new Date(value).toISOString().slice(0, 10) : value;
  if (!raw || raw.length < 10) return raw?.toString() ?? '';
  const date = raw.slice(0, 10);
  const d = new Date(`${date}T00:00:00`);
  return `${date.slice(5, 10)}（${WEEKDAYS[d.getDay()]}）`;
}

function yVal(c: CC, opts: {unit?: string; min?: number; max?: number; right?: boolean; fmt?: (v: number) => string}) {
  return {
    type: 'value',
    name: opts.unit ?? '',
    nameTextStyle: {color: c.label, fontSize: 9},
    min: opts.min,
    max: opts.max,
    position: opts.right ? 'right' : 'left',
    axisLabel: {color: c.label, fontSize: 10, formatter: opts.fmt ?? ((v: number) => String(v))},
    splitLine: opts.right ? {show: false} : {lineStyle: {color: c.split}},
  };
}

function ml(color: string, yVal_: number, label: string) {
  return {
    silent: true, symbol: 'none',
    lineStyle: {color, type: 'dashed', width: 1, opacity: 0.72},
    label: {
      show: true,
      position: 'insideEndTop',
      distance: 4,
      formatter: label,
      color,
      fontSize: 10,
      fontWeight: 400,
      padding: [0, 2],
    },
    data: [{yAxis: yVal_}],
  };
}

function smoothLine(name: string, data: number[], color: string, yIdx = 0) {
  return {name, type: 'line', yAxisIndex: yIdx, data, smooth: false, symbol: 'none', lineStyle: {color, width: 1.5}};
}

function areaLine(name: string, data: number[], color: string, yIdx = 0) {
  return {
    ...smoothLine(name, data, color, yIdx),
    areaStyle: {color: {type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{offset: 0, color: color.replace(')', ',0.12)').replace('rgb', 'rgba')}, {offset: 1, color: color.replace(')', ',0)').replace('rgb', 'rgba')}]}},
  };
}

function tooltipFmt(p: {seriesName: string; value: number; axisValue?: string}[]) {
  return `${p[0]?.axisValue ?? ''}<br/>${p.map((x) => `${x.seriesName}：${x.value}`).join('<br/>')}`;
}

function rolling7(data: [string, number][]): number[] {
  return data.map((_, i) => {
    const w = data.slice(Math.max(0, i - 6), i + 1);
    return Math.round(w.reduce((s, [, v]) => s + v, 0) / w.length);
  });
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function isValidDateKey(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = parseDate(value);
  return Number.isFinite(parsed.getTime()) && dateKey(parsed) === value;
}

function selectedDateOrToday(selectedDate?: string): string {
  return isValidDateKey(selectedDate) ? selectedDate : dateKey(new Date());
}

function cappedYearEnd(year: number, selectedDate?: string): string {
  const endOfYear = `${year}-12-31`;
  const cap = selectedDateOrToday(selectedDate);
  return cap < endOfYear ? cap : endOfYear;
}

function buildDateRange(start: string, end: string): string[] {
  const result: string[] = [];
  const cursor = parseDate(start);
  const endDate = parseDate(end);
  while (cursor <= endDate) {
    result.push(dateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return result;
}

function collectHealthDates(data: HealthData): string[] {
  const dates = new Set<string>();
  for (const key of Object.keys(EMPTY) as Array<keyof HealthData>) {
    if (key === 'lastUpdated') continue;
    for (const entry of data[key] as unknown[]) {
      if (Array.isArray(entry) && isValidDateKey(typeof entry[0] === 'string' ? entry[0] : undefined)) {
        dates.add(entry[0]);
      }
    }
  }
  return [...dates].sort();
}

function hasHealthData(data: HealthData): boolean {
  return (Object.keys(EMPTY) as Array<keyof HealthData>).some(
    (key) => key !== 'lastUpdated' && (data[key] as unknown[]).length > 0,
  );
}

function getScopeAxisDates(scope: TimeScope, data: HealthData, selectedDate?: string): string[] {
  if (scope.mode === 'period') {
    return isValidDateKey(scope.start) && isValidDateKey(scope.end) && scope.start <= scope.end
      ? buildDateRange(scope.start, scope.end)
      : [];
  }
  if (scope.mode === 'year') {
    const start = `${scope.year}-01-01`;
    const end = cappedYearEnd(scope.year, selectedDate);
    return end < start ? [] : buildDateRange(start, end);
  }
  if (scope.mode === 'recent') {
    const end = selectedDateOrToday(selectedDate);
    const start = parseDate(end);
    start.setDate(start.getDate() - RANGE_DAYS[scope.range] + 1);
    return buildDateRange(dateKey(start), end);
  }

  const allDates = collectHealthDates(data);
  if (!allDates.length) return [];
  return buildDateRange(allDates[0], allDates.at(-1)!);
}

// Auto x-axis for sparse series (vo2, mindful, etc.) — adapts to multi-year data
function xSparse(c: CC, data: [string, number][]) {
  const n = data.length;
  const interval = n > 50 ? Math.max(1, Math.floor(n / 10)) : 1;
  const fmt = n > 50 ? (v: string) => v?.slice(0, 7) ?? '' : (v: string) => v?.slice(5) ?? '';
  return {
    type: 'category', data: data.map(([d]) => d),
    axisTick: {show: false}, axisLine: {lineStyle: {color: c.axis}},
    axisLabel: {color: c.label, fontSize: 10, interval, formatter: fmt},
  };
}

// Merge two date-keyed series onto a shared x-axis so indices always align.
// Returns { dates, a, b } where a/b are sparse arrays (null = no data that day).
function alignTwo(
  seriesA: [string, number][],
  seriesB: [string, number][],
  convA?: (v: number) => number,
  convB?: (v: number) => number,
) {
  const dateSet = new Set([...seriesA.map(([d]) => d), ...seriesB.map(([d]) => d)]);
  const dates = [...dateSet].sort();
  const mapA = new Map(seriesA.map(([d, v]) => [d, convA ? convA(v) : v]));
  const mapB = new Map(seriesB.map(([d, v]) => [d, convB ? convB(v) : v]));
  return {
    dates,
    a: dates.map((d) => mapA.get(d) ?? null),
    b: dates.map((d) => mapB.get(d) ?? null),
  };
}

// Dynamic y-axis range from actual data with optional padding
function dynGoal(arr: [string, number][], pct: number, minCount = 5): number | null {
  const vals = arr.map(([, v]) => v).filter(Number.isFinite).sort((a, b) => a - b);
  if (vals.length < minCount) return null;
  return Math.round(vals[Math.floor(vals.length * pct)]);
}

function dynRange(arr: [string, number][], pad = 2, conv?: (v: number) => number) {
  const vals = arr.map(([, v]) => conv ? conv(v) : v).filter(Number.isFinite);
  if (!vals.length) return {};
  return {min: Math.floor(Math.min(...vals) - pad), max: Math.ceil(Math.max(...vals) + pad)};
}

function base(isDark: boolean) {
  return {backgroundColor: 'transparent', color: HEALTH_CHART_COLORS, grid: chartGrid(16)};
}

function chartGrid(right = 16, left = 12, top = 32, bottom = 28) {
  return {top, right, bottom, left, containLabel: true};
}

function dailyBarWidth(count: number): number {
  if (count <= 14) return 8;
  if (count <= 30) return 6;
  return 4;
}

function dualAxisGrid(isMobile: boolean) {
  return chartGrid(isMobile ? 16 : 40);
}

function topLegend(c: CC, data: string[]) {
  return {data, top: 2, left: 'center', textStyle: {fontSize: 11, color: c.label}, itemHeight: 8};
}

function scrollLegend(c: CC, data: string[]) {
  return {type: 'scroll', data, top: 2, left: 120, right: 16, textStyle: {fontSize: 11, color: c.label}, itemHeight: 8, pageIconColor: c.label, pageTextStyle: {color: c.label}};
}

function baseTip() {
  return {tooltip: {trigger: 'axis', formatter: tooltipFmt}};
}

// ── chart option builders ────────────────────────────────────────────────────

function stepsDistanceOpt(isDark: boolean, D: HealthData, isMobile = false) {
  const c = cc(isDark);
  const stepsGoal = dynGoal(D.steps, 0.75);
  const {dates, a, b} = alignTwo(D.steps, D.distance);
  const stepsArr = a as (number | null)[];
  const r7 = dates.map((_, i) => {
    const w = stepsArr.slice(Math.max(0, i - 6), i + 1).filter((v): v is number => v !== null);
    return w.length ? Math.round(w.reduce((s, v) => s + v, 0) / w.length) : null;
  });
  return {
    ...base(isDark),
    grid: dualAxisGrid(isMobile),
    legend: topLegend(c, ['步数', '7日均', '距离']),
    tooltip: {
      trigger: 'axis',
      formatter: (p: {seriesName: string; value: number | null; axisValue?: string}[]) => {
        const lines = p.filter((x) => x.value != null).map((x) => {
          if (x.seriesName === '距离') return `距离：${Number(x.value).toFixed(1)} km`;
          return `${x.seriesName}：${Number(x.value).toLocaleString()}`;
        });
        return `${p[0]?.axisValue ?? ''}<br/>${lines.join('<br/>')}`;
      },
    },
    xAxis: xCat(c, dates.map((d) => [d, 0] as [string, number])),
    yAxis: [
      yVal(c, {unit: '步', fmt: (v) => v >= 1000 ? `${v / 1000}k` : String(v)}),
      yVal(c, {unit: 'km', right: true, fmt: (v) => `${v}`}),
    ],
    series: [
      {
        name: '步数', type: 'bar', yAxisIndex: 0, barWidth: dailyBarWidth(dates.length),
        itemStyle: {color: '#64748b'},
        data: stepsArr.map((v) => v === null ? null : {value: v, itemStyle: {color: stepsGoal !== null && v >= stepsGoal ? '#22c55e' : '#64748b', borderRadius: [2, 2, 0, 0]}}),
        ...(stepsGoal !== null ? {markLine: ml('#f59e0b', stepsGoal, `目标 ${stepsGoal.toLocaleString()}`)} : {}),
      },
      {
        name: '7日均', type: 'line', yAxisIndex: 0, data: r7,
        smooth: false, symbol: 'none', connectNulls: true,
        lineStyle: {color: '#f59e0b', width: 1.5},
      },
      {
        name: '距离', type: 'line', yAxisIndex: 1,
        data: b as (number | null)[],
        smooth: false, symbol: 'none', connectNulls: true,
        lineStyle: {color: '#ef4444', width: 1.5},
        areaStyle: {color: {type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [
          {offset: 0, color: 'rgba(239,68,68,0.12)'}, {offset: 1, color: 'rgba(239,68,68,0)'},
        ]}},
      },
    ],
  };
}

function exerciseOpt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  const goal = dynGoal(D.exercise, 0.75);
  return {
    ...base(isDark), ...baseTip(),
    xAxis: xCat(c, D.exercise),
    yAxis: yVal(c, {unit: '分钟'}),
    series: [{
      name: '运动时长', type: 'bar', barWidth: dailyBarWidth(D.exercise.length),
      itemStyle: {color: '#94a3b8'},
      data: D.exercise.map(([, v]) => ({value: v, itemStyle: {color: goal !== null && v >= goal ? '#22c55e' : '#94a3b8', borderRadius: [2, 2, 0, 0]}})),
      ...(goal !== null ? {markLine: {...ml('#f59e0b', goal, `目标 ${goal} 分钟`), label: {show: false}}} : {}),
    }],
  };
}

function energyOpt(isDark: boolean, D: HealthData, isMobile = false) {
  const c = cc(isDark);
  return {
    ...base(isDark),
    grid: dualAxisGrid(isMobile),
    tooltip: {trigger: 'axis', formatter: tooltipFmt},
    legend: topLegend(c, ['活跃热量', '基础代谢']),
    ...(() => {
      const {dates, a, b} = alignTwo(D.energy_active, D.energy_basal);
      return {
        xAxis: xCat(c, dates.map((d) => [d, 0] as [string, number])),
        yAxis: [yVal(c, {unit: 'kcal', fmt: (v) => `${v}`}), yVal(c, {unit: 'kcal', right: true, fmt: (v) => `${v}`})],
        series: [
          {...smoothLine('活跃热量', a as number[], '#ef4444', 0), connectNulls: true},
          {...smoothLine('基础代谢', b as number[], '#16a34a', 1), connectNulls: true},
        ],
      };
    })(),
  };
}

function flightsOpt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  const goal = dynGoal(D.flights, 0.75);
  return {
    ...base(isDark), ...baseTip(),
    xAxis: xCat(c, D.flights),
    yAxis: yVal(c, {unit: '层'}),
    series: [{
      name: '爬楼层数', type: 'bar', barWidth: dailyBarWidth(D.flights.length),
      itemStyle: {color: '#0891b2'},
      data: D.flights.map(([, v]) => ({value: v, itemStyle: {color: goal !== null && v >= goal ? '#22c55e' : '#0891b2', borderRadius: [2, 2, 0, 0]}})),
      ...(goal !== null ? {markLine: {...ml('#f59e0b', goal, `目标 ${goal}`), label: {show: false}}} : {}),
    }],
  };
}

function standOpt(isDark: boolean, D: HealthData, isMobile = false) {
  const c = cc(isDark);
  const standHourGoal = 12;
  return {
    ...base(isDark),
    grid: dualAxisGrid(isMobile),
    tooltip: {trigger: 'axis', formatter: tooltipFmt},
    legend: topLegend(c, ['站立时间', '站立小时数']),
    ...(() => {
      const {dates, a, b} = alignTwo(D.stand_time, D.stand_hour);
      return {
        xAxis: xCat(c, dates.map((d) => [d, 0] as [string, number])),
        yAxis: [yVal(c, {unit: '分钟', fmt: (v) => `${v}m`}), yVal(c, {unit: '小时', right: true, min: 0, max: 16})],
        series: [
          {...smoothLine('站立时间', a as number[], '#0d9488', 0), connectNulls: true},
          {
            ...smoothLine('站立小时数', b as number[], '#f97316', 1),
            connectNulls: true,
            markLine: ml('#f59e0b', standHourGoal, `目标 ${standHourGoal} 小时`),
          },
        ],
      };
    })(),
  };
}

function sleepOpt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  const dates = D.sleep.map(([d]) => d);
  return {
    ...base(isDark),
    grid: chartGrid(16, 42),
    tooltip: {
      trigger: 'axis', axisPointer: {type: 'shadow'},
      formatter: (p: {seriesName: string; value: number | null; axisValue: string}[]) => {
        const total = p.reduce((s, x) => s + (x.value || 0), 0);
        return `${p[0]?.axisValue ?? ''}<br/>合计：${total.toFixed(1)}h<br/>${p.filter(x => Number(x.value) > 0).map(x => `${x.seriesName}：${Number(x.value).toFixed(1)}h`).join('<br/>')}`;
      },
    },
    legend: topLegend(c, ['深睡', 'REM', '浅睡', '清醒']),
    xAxis: xAxisFromDates(c, dates),
    yAxis: yVal(c, {unit: 'h', max: 12, fmt: (v) => `${v}h`}),
    series: [
      {name: '深睡', type: 'bar', stack: 'sleep', barMaxWidth: 10, data: D.sleep.map(x => x[2]), itemStyle: {color: '#16a34a', borderRadius: [2, 2, 0, 0]}},
      {name: 'REM', type: 'bar', stack: 'sleep', barMaxWidth: 10, data: D.sleep.map(x => x[3]), itemStyle: {color: '#db2777'}},
      {name: '浅睡', type: 'bar', stack: 'sleep', barMaxWidth: 10, data: D.sleep.map(x => x[4]), itemStyle: {color: '#14b8a6'}},
      {name: '清醒', type: 'bar', stack: 'sleep', barMaxWidth: 10, data: D.sleep.map(x => x[5]), itemStyle: {color: '#fb923c'}},
    ],
  };
}

function wristTempOpt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  const wristTemp = D.wrist_temp.filter(([, value]) => Number.isFinite(value));
  const vals = wristTemp.map(([, value]) => value);
  const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  return {
    ...base(isDark), ...baseTip(),
    xAxis: xCat(c, wristTemp),
    yAxis: yVal(c, {
      unit: '°C',
      ...(avg === null ? {} : {min: Math.floor(avg * 10 - 5) / 10, max: Math.ceil(avg * 10 + 5) / 10}),
    }),
    series: [areaLine('睡眠腕温', vals, '#f97316')],
  };
}

function heartOpt(isDark: boolean, D: HealthData, isMobile = false) {
  const c = cc(isDark);
  const rhrR = dynRange(D.rhr, 3);
  const hrvR = dynRange(D.hrv, 5);
  return {
    ...base(isDark),
    grid: dualAxisGrid(isMobile),
    tooltip: {trigger: 'axis', formatter: tooltipFmt},
    legend: topLegend(c, ['静息心率', 'HRV']),
    ...(() => {
      const {dates, a, b} = alignTwo(D.rhr, D.hrv);
      return {
        xAxis: xCat(c, dates.map((d) => [d, 0] as [string, number])),
        yAxis: [yVal(c, {unit: 'bpm', ...rhrR}), yVal(c, {unit: 'ms', right: true, ...hrvR})],
        series: [
          {
            ...areaLine('静息心率', a as number[], '#ef4444', 0), connectNulls: true,
            markPoint: {
              symbol: 'pin', symbolSize: 28,
              data: D.hr_notifications.map(([date]) => {
                const idx = dates.indexOf(date);
                const val = (a as (number|null)[])[idx];
                return idx >= 0 && val != null ? {name: '心率预警', coord: [date, val], itemStyle: {color: '#ef4444'}, label: {show: false}} : null;
              }).filter(Boolean),
            },
          },
          {...areaLine('HRV', b as number[], '#22c55e', 1), connectNulls: true},
        ],
      };
    })(),
  };
}

function cardioRecoveryOpt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  return {
    ...base(isDark),
    grid: chartGrid(16, 40),
    tooltip: {trigger: 'item', formatter: (p: {value: (string | number)[]; name: string}) => `${p.value[0]}<br/>心肺恢复：${p.value[1]} bpm`},
    xAxis: xSparse(c, D.cardio_recovery),
    yAxis: yVal(c, {unit: 'bpm', min: 0}),
    series: [{
      name: '心肺恢复', type: 'scatter', symbolSize: 10,
      data: D.cardio_recovery.map(([, v]) => v),
      itemStyle: {color: '#ef4444'},
      label: {show: true, position: 'top', formatter: (p: {value: number}) => String(p.value), color: c.label, fontSize: 10},
    }],
  };
}

function respSpo2Opt(isDark: boolean, D: HealthData, isMobile = false) {
  const c = cc(isDark);
  const {dates, a, b} = alignTwo(D.resp_rate, D.spo2);
  return {
    ...base(isDark),
    grid: dualAxisGrid(isMobile),
    tooltip: {
      trigger: 'axis',
      formatter: (p: {seriesName: string; value: number | null; axisValue?: string}[]) => {
        const lines = p.filter((x) => x.value != null).map((x) =>
          x.seriesName === '血氧' ? `血氧：${Number(x.value).toFixed(1)}%` : `呼吸频率：${Number(x.value).toFixed(1)} 次/分`
        );
        return `${p[0]?.axisValue ?? ''}<br/>${lines.join('<br/>')}`;
      },
    },
    legend: topLegend(c, ['呼吸频率', '血氧']),
    xAxis: xCat(c, dates.map((d) => [d, 0] as [string, number])),
    yAxis: [
      yVal(c, {unit: '次/分', ...dynRange(D.resp_rate, 1)}),
      yVal(c, {unit: '%', right: true, ...dynRange(D.spo2, 0.5), fmt: (v) => `${v}%`}),
    ],
    series: [
      {
        name: '呼吸频率', type: 'line', yAxisIndex: 0,
        data: a as (number | null)[],
        smooth: false, symbol: 'none', connectNulls: true,
        lineStyle: {color: '#0891b2', width: 1.5},
        areaStyle: {color: {type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [
          {offset: 0, color: 'rgba(8,145,178,0.12)'}, {offset: 1, color: 'rgba(8,145,178,0)'},
        ]}},
      },
      {
        name: '血氧', type: 'line', yAxisIndex: 1,
        data: b as (number | null)[],
        smooth: false, symbol: 'none', connectNulls: true,
        lineStyle: {color: '#db2777', width: 1.5},
        markLine: ml('#ef4444', 95, '95% 警戒'),
      },
    ],
  };
}

function bodyOpt(isDark: boolean, D: HealthData, isMobile = false) {
  const c = cc(isDark);
  const wR = dynRange(D.weight, 2, (v) => v * 2);
  const rightR = dynRange([...D.fat, ...D.bmi], 1);
  const weightGoal = (() => {
    if (D.weight.length < 5) return null;
    const vals = D.weight.map(([, v]) => Math.round(v * 2 * 10) / 10).sort((a, b) => a - b);
    return vals[Math.floor(vals.length * 0.1)];
  })();
  return {
    ...base(isDark),
    grid: dualAxisGrid(isMobile),
    tooltip: {trigger: 'axis', formatter: tooltipFmt},
    legend: topLegend(c, ['体重', '体脂率', 'BMI']),
    ...(() => {
      const dateSet = new Set([...D.weight.map(([d]) => d), ...D.fat.map(([d]) => d), ...D.bmi.map(([d]) => d)]);
      const dates = [...dateSet].sort();
      const weight = new Map(D.weight.map(([d, v]) => [d, Math.round(v * 2 * 10) / 10]));
      const fat = new Map(D.fat);
      const bmi = new Map(D.bmi);
      return {
        xAxis: xCat(c, dates.map((d) => [d, 0] as [string, number])),
        yAxis: [yVal(c, {unit: '斤', ...wR, fmt: (v) => `${v}`}), yVal(c, {unit: '% / BMI', right: true, ...rightR, fmt: (v) => `${v}`})],
        series: [
          {
            ...smoothLine('体重', dates.map((d) => weight.get(d) ?? null) as number[], '#0d9488', 0),
            connectNulls: true,
            ...(weightGoal !== null ? {markLine: ml('#f59e0b', weightGoal, `目标 ${weightGoal.toFixed(1)}`)} : {}),
          },
          {...smoothLine('体脂率', dates.map((d) => fat.get(d) ?? null) as number[], '#f97316', 1), connectNulls: true},
          {...smoothLine('BMI', dates.map((d) => bmi.get(d) ?? null) as number[], '#db2777', 1), connectNulls: true},
        ],
      };
    })(),
  };
}

function walkQualityOpt(isDark: boolean, D: HealthData, isMobile = false) {
  const c = cc(isDark);
  return {
    ...base(isDark),
    grid: chartGrid(isMobile ? 52 : 78),
    tooltip: {trigger: 'axis', formatter: tooltipFmt},
    legend: topLegend(c, ['步行速度', '步长', '步行平均心率']),
    ...(() => {
      const dateSet = new Set([...D.walk_speed.map(([d]) => d), ...D.step_length.map(([d]) => d), ...D.walking_hr.map(([d]) => d)]);
      const dates = [...dateSet].sort();
      const speed = new Map(D.walk_speed);
      const length = new Map(D.step_length);
      const hr = new Map(D.walking_hr);
      return {
        xAxis: xCat(c, dates.map((d) => [d, 0] as [string, number])),
        yAxis: [
          yVal(c, {unit: 'km/h', ...dynRange(D.walk_speed, 0.3), fmt: (v) => `${v}`}),
          yVal(c, {unit: 'cm', right: true, ...dynRange(D.step_length, 2), fmt: (v) => `${v}`}),
          {...yVal(c, {unit: 'bpm', right: true, ...dynRange(D.walking_hr, 3), fmt: (v) => `${v}`}), offset: 38},
        ],
        series: [
          {...smoothLine('步行速度', dates.map((d) => speed.get(d) ?? null) as number[], '#22c55e', 0), connectNulls: true},
          {...smoothLine('步长', dates.map((d) => length.get(d) ?? null) as number[], '#f97316', 1), connectNulls: true},
          {...smoothLine('步行平均心率', dates.map((d) => hr.get(d) ?? null) as number[], '#db2777', 2), connectNulls: true},
        ],
      };
    })(),
  };
}

function gaitOpt(isDark: boolean, D: HealthData, isMobile = false) {
  const c = cc(isDark);
  return {
    ...base(isDark),
    grid: dualAxisGrid(isMobile),
    tooltip: {trigger: 'axis', formatter: tooltipFmt},
    legend: topLegend(c, ['步态不对称性', '双支撑时间占比']),
    ...(() => {
      const {dates, a, b} = alignTwo(D.asym, D.double_supp);
      return {
        xAxis: xCat(c, dates.map((d) => [d, 0] as [string, number])),
        yAxis: [yVal(c, {unit: '%', ...dynRange(D.asym, 1), fmt: (v) => `${v}%`}), yVal(c, {unit: '%', right: true, ...dynRange(D.double_supp, 1), fmt: (v) => `${v}%`})],
        series: [
          {...smoothLine('步态不对称性', a as number[], '#ef4444', 0), connectNulls: true},
          {...smoothLine('双支撑时间占比', b as number[], '#db2777', 1), connectNulls: true},
        ],
      };
    })(),
  };
}

function stairOpt(isDark: boolean, D: HealthData, isMobile = false) {
  const c = cc(isDark);
  return {
    ...base(isDark),
    grid: dualAxisGrid(isMobile),
    tooltip: {trigger: 'axis', formatter: tooltipFmt},
    legend: topLegend(c, ['上楼梯速度', '下楼梯速度']),
    ...(() => {
      const {dates, a, b} = alignTwo(D.stair_up, D.stair_down);
      const r = dynRange([...D.stair_up, ...D.stair_down], 0.05);
      return {
        xAxis: xCat(c, dates.map((d) => [d, 0] as [string, number])),
        yAxis: [yVal(c, {unit: 'm/s', ...r, fmt: (v) => `${v}`}), yVal(c, {unit: 'm/s', right: true, ...r, fmt: (v) => `${v}`})],
        series: [
          {...smoothLine('上楼梯速度', a as number[], '#22c55e', 0), connectNulls: true},
          {...smoothLine('下楼梯速度', b as number[], '#db2777', 1), connectNulls: true},
        ],
      };
    })(),
  };
}

function sixMinWalkOpt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  return {
    ...base(isDark),
    grid: chartGrid(16, 40),
    tooltip: {trigger: 'axis', formatter: (p: {value: number; axisValue: string}[]) => `${p[0]?.axisValue ?? ''}<br/>六分钟步行：${p[0]?.value} m`},
    xAxis: xSparse(c, D.six_min_walk),
    yAxis: yVal(c, {unit: '米', ...dynRange(D.six_min_walk, 10)}),
    series: [{
      name: '六分钟步行', type: 'line', data: D.six_min_walk.map(([, v]) => v),
      smooth: false, symbol: 'circle', symbolSize: 5,
      lineStyle: {color: '#0891b2', width: 2}, itemStyle: {color: '#0891b2'},
      label: {show: true, position: 'top', fontSize: 9, color: c.label, formatter: (p: {value: number}) => String(p.value)},
    }],
  };
}

function audioOpt(isDark: boolean, D: HealthData, isMobile = false) {
  const c = cc(isDark);
  return {
    ...base(isDark),
    grid: dualAxisGrid(isMobile),
    tooltip: {trigger: 'axis', formatter: tooltipFmt},
    legend: topLegend(c, ['环境音量', '耳机音量']),
    xAxis: xCat(c, D.audio_env),
    yAxis: [yVal(c, {unit: 'dB', ...dynRange(D.audio_env, 2), fmt: (v) => `${v}dB`}), yVal(c, {unit: 'dB', right: true, ...dynRange(D.audio_hp, 2), fmt: (v) => `${v}dB`})],
    series: [
      smoothLine('环境音量', D.audio_env.map(([, v]) => v), '#f97316', 0),
      {
        name: '耳机音量', type: 'scatter', yAxisIndex: 1, symbolSize: 5,
        data: D.audio_hp.map(([, v]) => v), itemStyle: {color: '#db2777'},
      },
    ],
  };
}

function daylightOpt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  const goal = dynGoal(D.daylight, 0.75);
  return {
    ...base(isDark), ...baseTip(),
    xAxis: xCat(c, D.daylight, 5),
    yAxis: yVal(c, {unit: '分钟', min: 0, fmt: (v) => `${v}m`}),
    series: [{
      name: '日晒时间', type: 'bar', barWidth: dailyBarWidth(D.daylight.length),
      itemStyle: {color: '#94a3b8'},
      data: D.daylight.map(([, v]) => ({value: v, itemStyle: {color: goal !== null && v >= goal ? '#f59e0b' : '#94a3b8', borderRadius: [2, 2, 0, 0]}})),
      ...(goal !== null ? {markLine: ml('#f59e0b', goal, `目标 ${goal} 分钟`)} : {}),
    }],
  };
}

function mindfulOpt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  return {
    ...base(isDark),
    grid: chartGrid(16, 40),
    tooltip: {trigger: 'axis', formatter: (p: {value: number; axisValue: string}[]) => `${p[0]?.axisValue ?? ''}<br/>正念时长：${p[0]?.value} 分钟`},
    xAxis: xSparse(c, D.mindful),
    yAxis: yVal(c, {unit: '分钟', min: 0}),
    series: [{
      name: '正念时长', type: 'scatter', symbolSize: 8,
      data: D.mindful.map(([, v]) => v), itemStyle: {color: '#db2777'},
      label: {show: true, position: 'top', fontSize: 9, color: c.label, formatter: (p: {value: number}) => `${p.value}m`},
    }],
  };
}

function handwashOpt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  const goal = 20;
  return {
    ...base(isDark), ...baseTip(),
    xAxis: xCat(c, D.handwash),
    yAxis: yVal(c, {unit: '秒', min: 0, fmt: (v) => `${v}s`}),
    series: [{
      ...areaLine('洗手时长', D.handwash.map(([, v]) => v), '#22c55e'),
      markLine: ml('#f59e0b', goal, `目标 ${goal} 秒`),
    }],
  };
}

function effortOpt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  return {
    ...base(isDark), ...baseTip(),
    xAxis: xCat(c, D.physical_effort),
    yAxis: yVal(c, {unit: 'kcal/hr·kg'}),
    series: [areaLine('体力强度', D.physical_effort.map(([, v]) => v), '#ef4444')],
  };
}

function vo2Opt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  return {
    ...base(isDark),
    grid: chartGrid(16, 40),
    tooltip: {trigger: 'axis', formatter: (p: {value: number; axisValue: string}[]) => `${p[0]?.axisValue ?? ''}<br/>VO₂ Max：${p[0]?.value} ml/(kg·min)`},
    xAxis: xSparse(c, D.vo2),
    yAxis: yVal(c, {unit: 'ml/(kg·min)', ...dynRange(D.vo2, 0.5)}),
    series: [{
      name: 'VO₂ Max', type: 'line', data: D.vo2.map(([, v]) => v), smooth: false, symbol: 'circle', symbolSize: 5,
      lineStyle: {color: '#0891b2', width: 2}, itemStyle: {color: '#0891b2'},
      label: {show: true, position: 'top', fontSize: 9, color: c.label, formatter: (p: {value: number}) => p.value.toFixed(1)},
    }],
  };
}

// ── workouts ─────────────────────────────────────────────────────────────────

const WORKOUT_COLORS: Record<string, string> = {
  '户外步行': '#22c55e', '室内步行': '#86efac',
  '划船': '#0891b2', '羽毛球': '#f97316',
  '室内骑行': '#ef4444', '室内跑步': '#f59e0b', '核心训练': '#94a3b8',
};

function workoutTimelineOpt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  const types = [...new Set(D.workouts.map(([, n]) => n))];
  const dates = [...new Set(D.workouts.map(([d]) => d))].sort();
  return {
    ...base(isDark),
    grid: chartGrid(16),
    legend: scrollLegend(c, types),
    tooltip: {
      trigger: 'item',
      formatter: (p: {value: [string, string, number, number, number]}) => {
        const [date, type, dur, kcal, hr] = p.value;
        return `${formatMonthDayWeekday(date)}<br/>${type}<br/>时长：${dur} 分钟<br/>消耗：${kcal} kcal<br/>心率：${hr} bpm`;
      },
    },
    xAxis: {
      type: 'category',
      data: dates,
      axisTick: {show: false},
      axisLabel: {color: c.label, fontSize: 10, interval: 0, formatter: formatMonthDay},
      axisLine: {lineStyle: {color: c.axis}},
      splitLine: {lineStyle: {color: c.split}},
    },
    yAxis: {type: 'value', name: '分钟', nameTextStyle: {color: c.label, fontSize: 9}, axisLabel: {color: c.label, fontSize: 10}, splitLine: {lineStyle: {color: c.split}}},
    series: types.map((type) => ({
      name: type, type: 'scatter',
      symbolSize: (val: [string, string, number, number, number]) => {
        const calories = Number(val?.[3]);
        return Number.isFinite(calories) ? Math.max(8, Math.sqrt(Math.max(0, calories)) * 1.4) : 8;
      },
      data: D.workouts.filter(([, n]) => n === type).map(([date, , dur, kcal, hr]) => ({value: [date, type, dur, kcal, hr], name: type})),
      itemStyle: {color: WORKOUT_COLORS[type] ?? '#94a3b8', opacity: 0.85},
      encode: {x: 0, y: 2},
    })),
  };
}

function workoutTypeOpt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  const totals: Record<string, {sessions: number; mins: number; kcal: number}> = {};
  for (const [, name, dur, kcal] of D.workouts) {
    if (!totals[name]) totals[name] = {sessions: 0, mins: 0, kcal: 0};
    totals[name].sessions += 1;
    totals[name].mins += dur;
    totals[name].kcal += kcal;
  }
  const sorted = Object.entries(totals).sort((a, b) => b[1].mins - a[1].mins);
  return {
    ...base(isDark),
    grid: chartGrid(16, 40, 32, 56),
    tooltip: {
      trigger: 'axis', axisPointer: {type: 'shadow'},
      formatter: (p: {name: string; seriesName: string; value: number}[]) => {
        const name = p[0]?.name ?? '';
        const t = totals[name];
        return `${name}<br/>次数：${t.sessions} 次<br/>总时长：${t.mins.toFixed(0)} 分钟<br/>总消耗：${t.kcal.toFixed(0)} kcal`;
      },
    },
    xAxis: {
      type: 'category',
      data: sorted.map(([n]) => n),
      axisLabel: {color: c.label, fontSize: 10, interval: 0, rotate: 30},
      axisTick: {show: false},
      axisLine: {lineStyle: {color: c.axis}},
    },
    yAxis: {type: 'value', name: '分钟', axisLabel: {color: c.label, fontSize: 10}, splitLine: {lineStyle: {color: c.split}}},
    series: [
      {
        name: '总时长', type: 'bar', barMaxWidth: 28,
        data: sorted.map(([n]) => ({value: Math.round(totals[n].mins), itemStyle: {color: WORKOUT_COLORS[n] ?? '#94a3b8', borderRadius: [4, 4, 0, 0]}})),
        label: {show: true, position: 'top', fontSize: 10, color: c.label, formatter: (p: {value: number}) => `${p.value}m`},
      },
    ],
  };
}

// ── medications ───────────────────────────────────────────────────────────────

function medDailyCombinedOpt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  const nahMap = new Map(D.nah_daily.map(([d, t]) => [d, t]));
  const bnsMap = new Map(D.bns_daily.map(([d, t]) => [d, t]));
  const dates = [...new Set([...D.nah_daily.map(([d]) => d), ...D.bns_daily.map(([d]) => d)])].sort();
  const rows = ['碳酸氢钠片', '苯溴马隆片'];
  const value = (drug: string, date: string) => {
    const v = drug === '碳酸氢钠片' ? nahMap.get(date) : bnsMap.get(date);
    if (v === undefined) return -1;
    const total = drug === '碳酸氢钠片' ? 3 : 1;
    return v >= total ? 2 : v > 0 ? 1 : 0;
  };
  return {
    ...base(isDark),
    grid: chartGrid(16, 82, 32, 42),
    tooltip: {
      trigger: 'item',
      formatter: (p: {value: [number, number, number]}) => {
        const [x, y, status] = p.value;
        const drug = rows[y];
        const date = dates[x];
        const taken = drug === '碳酸氢钠片' ? nahMap.get(date) : bnsMap.get(date);
        const total = drug === '碳酸氢钠片' ? 3 : 1;
        const label = status === 2 ? '已完成' : status === 1 ? '部分完成' : status === 0 ? '未完成' : '无记录';
        return `${date}<br/>${drug}<br/>${label}${taken === undefined ? '' : `：${taken}/${total}`}`;
      },
    },
    visualMap: {
      show: false, min: -1, max: 2,
      pieces: [
        {value: -1, color: 'rgba(148,163,184,0.18)'},
        {value: 0, color: '#ef4444'},
        {value: 1, color: '#f59e0b'},
        {value: 2, color: '#22c55e'},
      ],
    },
    xAxis: {
      type: 'category', data: dates,
      axisTick: {show: false}, axisLine: {lineStyle: {color: c.axis}},
      axisLabel: {color: c.label, fontSize: 10, interval: Math.max(0, Math.floor(dates.length / 10)), formatter: (v: string) => v?.slice(5) ?? ''},
    },
    yAxis: {type: 'category', data: rows, axisTick: {show: false}, axisLine: {show: false}, axisLabel: {color: c.label, fontSize: 11}},
    series: [
      {
        name: '每日服药', type: 'heatmap',
        data: rows.flatMap((drug, y) => dates.map((date, x) => [x, y, value(drug, date)])),
        itemStyle: {borderColor: c.split, borderWidth: 1, borderRadius: 2},
        label: {show: false},
      },
    ],
  };
}

// ── state of mind ─────────────────────────────────────────────────────────────

const VALENCE_COLOR: Record<string, string> = {
  very_pleasant: '#16a34a', pleasant: '#22c55e',
  slightly_pleasant: '#86efac', neutral: '#94a3b8',
  slightly_unpleasant: '#fca5a5', unpleasant: '#f87171', very_unpleasant: '#ef4444',
};
const KIND_ZH: Record<string, string> = {daily: '日常情绪', emotion: '即时感受'};

const LABEL_ZH: Record<string, string> = {
  amazed: '惊奇',
  amused: '愉快',
  angry: '生气',
  annoyed: '烦恼',
  anxious: '焦虑',
  ashamed: '羞愧',
  brave: '勇敢',
  calm: '平静',
  confident: '自信',
  content: '满足',
  disappointed: '失望',
  discouraged: '气馁',
  disgusted: '厌恶',
  drained: '疲惫',
  embarrassed: '尴尬',
  excited: '兴奋',
  frustrated: '沮丧',
  grateful: '感激',
  guilty: '内疚',
  happy: '快乐',
  hopeful: '充满希望',
  hopeless: '绝望',
  indifferent: '无所谓',
  irritated: '易怒',
  jealous: '嫉妒',
  joyful: '喜悦',
  lonely: '孤独',
  overwhelmed: '不堪重负',
  passionate: '热情',
  peaceful: '安宁',
  proud: '自豪',
  relieved: '如释重负',
  sad: '伤心',
  satisfied: '满意',
  scared: '害怕',
  stressed: '有压力',
  surprised: '惊讶',
  worried: '忧虑',
};
const ASSOC_ZH: Record<string, string> = {
  community: '社区',
  current_events: '时事',
  currentEvents: '时事',
  dating: '约会',
  education: '教育',
  family: '家人',
  fitness: '健身',
  friends: '朋友',
  health: '健康',
  hobbies: '爱好',
  identity: '身份认同',
  money: '金钱',
  partner: '伴侣',
  self_care: '自我照护',
  selfCare: '自我照护',
  spirituality: '精神信仰',
  tasks: '任务',
  travel: '旅行',
  weather: '天气',
  work: '工作',
};

function translateList(str: string, map: Record<string, string>) {
  return str.split(',').map((s) => map[s.trim()] ?? s.trim()).join('、');
}

function stateOfMindOpt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  const clsList = ['very_pleasant','pleasant','slightly_pleasant','neutral','slightly_unpleasant','unpleasant','very_unpleasant'];
  const dates = [...new Set(D.state_of_mind.map(([date]) => date))].sort();
  return {
    backgroundColor: 'transparent',
    grid: chartGrid(16, 44, 28, 30),
    tooltip: {
      trigger: 'item',
      formatter: (p: {value: [string, number, string, string, string]}) => {
        const [date, val, kind, labs, assoc] = p.value;
        return `${date}<br/>类型：${KIND_ZH[kind] ?? kind}<br/>愉悦度：${val > 0 ? '+' : ''}${val.toFixed(2)}<br/>标签：${labs ? translateList(labs, LABEL_ZH) : '—'}<br/>关联：${assoc ? translateList(assoc, ASSOC_ZH) : '—'}`;
      },
    },
    xAxis: {
      type: 'category',
      data: dates,
      axisLabel: {color: c.label, fontSize: 10, formatter: formatMonthDay},
      axisLine: {lineStyle: {color: c.axis}}, splitLine: {lineStyle: {color: c.split}},
    },
    yAxis: {
      type: 'value', min: -1, max: 1,
      axisLabel: {
        color: c.label,
        fontSize: 10,
        formatter: (v: number) => v === 1 ? '快乐' : v === 0 ? '平静' : v === -1 ? '低落' : v > 0 ? `+${v}` : String(v),
      },
      splitLine: {lineStyle: {color: c.split}},
      markLine: {silent: true, symbol: 'none', lineStyle: {color: c.axis, type: 'dashed', width: 1}, data: [{yAxis: 0}], label: {show: false}},
    },
    visualMap: {show: false, dimension: 1, pieces: clsList.map((cls, i) => {
      const borders = [-1, -0.6, -0.2, -0.01, 0.01, 0.2, 0.6, 1];
      return {gte: borders[i], lte: borders[i+1], color: VALENCE_COLOR[cls]};
    })},
    series: Object.entries(KIND_ZH).map(([kind, label]) => ({
      name: label, type: 'scatter', symbolSize: kind === 'daily' ? 14 : 12,
      symbol: kind === 'daily' ? 'circle' : 'diamond',
      data: D.state_of_mind.filter(([,, k]) => k === kind).map(([date, val,, labs, assoc]) => ({
        value: [date, val, kind, labs, assoc],
        name: label,
      })),
      label: {
        show: true, position: 'top', distance: 6, fontSize: 9, color: c.label,
        formatter: (p: {value: [string, number, string, string]}) => {
          const first = p.value[3]?.split(',')[0] ?? '';
          return LABEL_ZH[first] ?? first;
        },
      },
      labelLayout: {hideOverlap: true},
    })),
  };
}

// ── weekend highlighting ──────────────────────────────────────────────────────

function addWeekends(option: object, isDark: boolean): object {
  const opt = option as Record<string, unknown>;
  const xAxisRaw = opt.xAxis as Record<string, unknown> | undefined;
  const xObj = Array.isArray(xAxisRaw) ? (xAxisRaw as Record<string, unknown>[])[0] : xAxisRaw;
  if (!xObj) return option;

  const bgColor = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
  const series = opt.series as Record<string, unknown>[];
  if (!series?.length) return option;

  const mkArea = (data: unknown[]) => ({silent: true, label: {show: false}, itemStyle: {color: bgColor}, data});
  // Ghost line series to host markArea — explicit axis indices for dual-axis charts
  const ghostLine = (data: unknown[], pointCount = 0) => ({
    type: 'line', data: Array.from({length: pointCount}, () => 0), markArea: mkArea(data),
    silent: true, symbol: 'none', lineStyle: {opacity: 0},
    tooltip: {show: false},
    xAxisIndex: 0, yAxisIndex: 0, z: -1, animation: false,
  });

  const fmt = (dt: Date) =>
    `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

  // ── Time axis (运动时间轴, 愉悦度走势) ──────────────────────────────────
  if (xObj.type === 'time') {
    const ds: string[] = [];
    for (const s of series) {
      for (const pt of ((s as {data?: unknown[]}).data ?? []) as {value?: unknown[]}[]) {
        const v0 = pt?.value?.[0];
        if (typeof v0 === 'string' && v0.length >= 10) ds.push(v0.slice(0, 10));
      }
    }
    if (!ds.length) return option;
    const minD = ds.reduce((a, b) => a < b ? a : b);
    const maxD = ds.reduce((a, b) => a > b ? a : b);

    // Use timestamps so ECharts time axis parses them unambiguously
    const areas: [{xAxis: number}, {xAxis: number}][] = [];
    const cur = new Date(minD + 'T12:00:00');
    const endDt = new Date(maxD + 'T12:00:00');
    while (cur <= endDt) {
      if (cur.getDay() === 6) {
        const satTs = new Date(fmt(cur) + 'T00:00:00').getTime();
        cur.setDate(cur.getDate() + 2);
        areas.push([{xAxis: satTs}, {xAxis: new Date(fmt(cur) + 'T00:00:00').getTime()}]);
      } else {
        cur.setDate(cur.getDate() + 1);
      }
    }
    if (!areas.length) return option;
    // Attach to series[0] — ghost line with data:[] won't render its markArea in ECharts
    const newSeries = series.map((s, i) => i === 0 ? {...s, markArea: mkArea(areas)} : s);
    return {...opt, series: newSeries};
  }

  // ── Category axis ─────────────────────────────────────────────────────────
  if (xObj.type !== 'category') return option;
  const dates = xObj.data as string[];
  if (!dates?.length || dates[0].length < 10) return option;

  // Map each unique date → its first/last index (handles duplicate raw entries)
  const dateIdx = new Map<string, {first: number; last: number}>();
  for (let i = 0; i < dates.length; i++) {
    const d = dates[i];
    const r = dateIdx.get(d);
    if (!r) dateIdx.set(d, {first: i, last: i}); else r.last = i;
  }

  // Unique sorted dates → keep only weekends
  const wkDates = [...dateIdx.keys()].sort().filter(d => { const day = new Date(d + 'T12:00:00').getDay(); return day === 0 || day === 6; });
  if (!wkDates.length) return option;

  const nextDay = (d: string) => { const dt = new Date(d + 'T12:00:00'); dt.setDate(dt.getDate() + 1); return fmt(dt); };

  // Group calendar-consecutive weekend dates → index-based areas
  const areas: [{xAxis: number}, {xAxis: number}][] = [];
  let wi = 0;
  while (wi < wkDates.length) {
    let wj = wi;
    while (wj + 1 < wkDates.length && wkDates[wj + 1] === nextDay(wkDates[wj])) wj++;
    const startIdx = dateIdx.get(wkDates[wi])!.first;
    const rawEnd = dateIdx.get(wkDates[wj])!.last;
    const endIdx = rawEnd > startIdx ? rawEnd : Math.min(startIdx + 1, dates.length - 1);
    areas.push([{xAxis: startIdx}, {xAxis: endIdx}]);
    wi = wj + 1;
  }

  if (!areas.length) return option;
  const markArea = mkArea(areas);

  const lineIdx = series.findIndex((s) => (s as {type?: string}).type === 'line');
  if (lineIdx >= 0) {
    const newSeries = series.map((s, i) => i === lineIdx ? {...s, markArea} : s);
    return {...opt, series: newSeries};
  }
  // Bar-only charts need a non-empty host series for markArea to render reliably.
  const barIdx = series.findIndex((s) => (s as {type?: string}).type === 'bar');
  if (barIdx >= 0) {
    return {...opt, series: [ghostLine(areas, dates.length), ...series]};
  }
  return {...opt, series: [...series, ghostLine(areas, dates.length)]};
}

function addSelectedDateHighlight(option: object, selectedDate: string | undefined, isDark: boolean): object {
  if (!isValidDateKey(selectedDate)) return option;
  const opt = option as Record<string, unknown>;
  const series = opt.series as Record<string, unknown>[] | undefined;
  if (!series?.length) return option;
  const xAxisRaw = opt.xAxis as Record<string, unknown> | Record<string, unknown>[] | undefined;
  const xObj = Array.isArray(xAxisRaw) ? xAxisRaw[0] : xAxisRaw;
  const selectedColor = isDark ? 'rgba(100,210,255,0.18)' : 'rgba(10,132,255,0.13)';
  const lineColor = isDark ? 'rgba(100,210,255,0.82)' : 'rgba(10,132,255,0.72)';
  const markArea = (data: unknown[]) => ({
    silent: true,
    label: {show: false},
    itemStyle: {color: selectedColor, borderColor: lineColor, borderWidth: 1},
    data,
  });
  const ghost = (data: unknown[], pointCount = 0) => ({
    type: 'line',
    data: Array.from({length: pointCount}, () => 0),
    markArea: markArea(data),
    silent: true,
    symbol: 'none',
    lineStyle: {opacity: 0},
    tooltip: {show: false},
    xAxisIndex: 0,
    yAxisIndex: 0,
    z: 0,
    animation: false,
  });

  if (opt.calendar) {
    return option;
  }

  if (xObj?.type === 'time') {
    const start = new Date(`${selectedDate}T00:00:00`).getTime();
    const end = new Date(`${selectedDate}T23:59:59`).getTime();
    return {...opt, series: [ghost([[{xAxis: start}, {xAxis: end}]]), ...series]};
  }

  if (xObj?.type === 'category' && Array.isArray(xObj.data)) {
    const dates = xObj.data as string[];
    const first = dates.findIndex((date) => String(date).slice(0, 10) === selectedDate);
    if (first < 0) return option;
    let last = first;
    while (last + 1 < dates.length && String(dates[last + 1]).slice(0, 10) === selectedDate) last += 1;
    const end = last > first ? last : Math.min(first + 1, dates.length - 1);
    return {...opt, series: [ghost([[{xAxis: first}, {xAxis: end}]], dates.length), ...series]};
  }

  return option;
}

// ── today latest-point highlighting ──────────────────────────────────────────

type ChartSeries = Record<string, unknown> & {
  data?: unknown[];
  encode?: {y?: number};
  markPoint?: Record<string, unknown> & {data?: unknown[]};
};

type TodayPoint<X, Y> = {date: string; coord: [X, Y]; color?: string};

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function numericValue(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (raw && typeof raw === 'object' && 'value' in raw) {
    return numericValue((raw as {value?: unknown}).value);
  }
  return null;
}

function colorValue(raw: unknown): string | null {
  return typeof raw === 'string' && raw.startsWith('#') ? raw : null;
}

function objectColor(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as {color?: unknown; itemStyle?: {color?: unknown}; lineStyle?: {color?: unknown}};
  return colorValue(obj.color) ?? colorValue(obj.itemStyle?.color) ?? colorValue(obj.lineStyle?.color);
}

function seriesColor(series: ChartSeries): string {
  return objectColor(series) ?? '#64748b';
}

function latestCategoryPoint(series: ChartSeries, dates: string[]): TodayPoint<string, number> | null {
  const data = series.data ?? [];
  for (let i = Math.min(data.length, dates.length) - 1; i >= 0; i--) {
    const value = numericValue(data[i]);
    if (value !== null) return {date: dates[i], coord: [dates[i], value], color: objectColor(data[i]) ?? seriesColor(series)};
  }
  return null;
}

function latestValueCategoryPoint(series: ChartSeries, dates: string[]): TodayPoint<number, string> | null {
  const data = series.data ?? [];
  for (let i = Math.min(data.length, dates.length) - 1; i >= 0; i--) {
    const value = numericValue(data[i]);
    if (value !== null) return {date: dates[i], coord: [value, dates[i]], color: objectColor(data[i]) ?? seriesColor(series)};
  }
  return null;
}

function latestTimePoint(series: ChartSeries): TodayPoint<string, number> | null {
  const data = series.data ?? [];
  for (let i = data.length - 1; i >= 0; i--) {
    const raw = data[i];
    const value = raw && typeof raw === 'object' && 'value' in raw ? (raw as {value?: unknown}).value : raw;
    if (!Array.isArray(value) || typeof value[0] !== 'string' || value[0].length < 10) continue;

    const yIndex = typeof series.encode?.y === 'number' ? series.encode.y : 1;
    const encoded = numericValue(value[yIndex]);
    const fallback = value.find((item, idx) => idx > 0 && numericValue(item) !== null);
    const y = encoded ?? numericValue(fallback);
    if (y !== null) return {date: value[0].slice(0, 10), coord: [value[0], y], color: objectColor(raw) ?? seriesColor(series)};
  }
  return null;
}

function latestCalendarPoint(series: ChartSeries): TodayPoint<string, number> | null {
  const data = series.data ?? [];
  for (let i = data.length - 1; i >= 0; i--) {
    const raw = data[i];
    const value = raw && typeof raw === 'object' && 'value' in raw ? (raw as {value?: unknown}).value : raw;
    if (!Array.isArray(value) || typeof value[0] !== 'string' || value[0].length < 10) continue;
    const y = numericValue(value[1]);
    if (y !== null) return {date: value[0].slice(0, 10), coord: [value[0], y], color: objectColor(raw) ?? seriesColor(series)};
  }
  return null;
}

function withTodayMark(series: ChartSeries, coord: unknown, color?: string): ChartSeries {
  const oldMarkPoint = series.markPoint ?? {};
  const oldData = Array.isArray(oldMarkPoint.data) ? oldMarkPoint.data : [];
  const markColor = color ?? seriesColor(series);
  return {
    ...series,
    markPoint: {
      ...oldMarkPoint,
      symbol: oldMarkPoint.symbol ?? 'circle',
      symbolSize: oldMarkPoint.symbolSize ?? 14,
      data: [
        ...oldData,
        {
          name: '今日最新',
          coord,
          symbol: 'circle',
          symbolSize: 8,
          itemStyle: {
            color: 'transparent',
            borderColor: markColor,
            borderWidth: 2,
          },
          label: {show: false},
        },
      ],
    },
  };
}

function addTodayLatestHighlight(option: object, isDark: boolean): object {
  const opt = option as Record<string, unknown>;
  const series = opt.series as ChartSeries[] | undefined;
  if (!series?.length) return option;

  const xAxisRaw = opt.xAxis as Record<string, unknown> | Record<string, unknown>[] | undefined;
  const yAxisRaw = opt.yAxis as Record<string, unknown> | Record<string, unknown>[] | undefined;
  const xObj = Array.isArray(xAxisRaw) ? xAxisRaw[0] : xAxisRaw;
  const yObj = Array.isArray(yAxisRaw) ? yAxisRaw[0] : yAxisRaw;
  const today = todayLocal();

  if (opt.calendar) {
    const newSeries = series.map((s) => {
      const point = latestCalendarPoint(s);
      return point?.date === today ? withTodayMark(s, point.coord, point.color) : s;
    });
    return {...opt, series: newSeries};
  }

  if (xObj?.type === 'time') {
    const newSeries = series.map((s) => {
      const point = latestTimePoint(s);
      return point?.date === today ? withTodayMark(s, point.coord, point.color) : s;
    });
    return {...opt, series: newSeries};
  }

  if (xObj?.type === 'category' && Array.isArray(xObj.data) && typeof xObj.data.at(-1) === 'string') {
    const dates = (xObj.data as string[]).filter((d) => d.length >= 10);
    const newSeries = series.map((s) => {
      if (s.type === 'heatmap') return s;
      const point = latestCategoryPoint(s, dates);
      return point?.date === today ? withTodayMark(s, point.coord, point.color) : s;
    });
    return {...opt, series: newSeries};
  }

  if (xObj?.type === 'value' && yObj?.type === 'category' && Array.isArray(yObj.data) && typeof yObj.data.at(-1) === 'string') {
    const dates = yObj.data as string[];
    const newSeries = series.map((s) => {
      const point = latestValueCategoryPoint(s, dates);
      return point?.date === today ? withTodayMark(s, point.coord, point.color) : s;
    });
    return {...opt, series: newSeries};
  }

  return option;
}

// ── shared chart visual style ────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function mapAxis(axis: unknown, c: CC) {
  const normalize = (raw: unknown) => {
    const obj = asRecord(raw);
    const axisLine = asRecord(obj.axisLine);
    const axisTick = asRecord(obj.axisTick);
    const axisLabel = asRecord(obj.axisLabel);
    const splitLine = asRecord(obj.splitLine);
    const lineStyle = asRecord(splitLine.lineStyle);
    const nameTextStyle = asRecord(obj.nameTextStyle);
    return {
      ...obj,
      axisLine: {...axisLine, lineStyle: {...asRecord(axisLine.lineStyle), color: c.axis}},
      axisTick: {show: false, ...axisTick},
      axisLabel: {
        margin: 8,
        hideOverlap: true,
        color: c.label,
        fontSize: 10,
        fontWeight: 400,
        ...axisLabel,
      },
      nameTextStyle: {color: c.label, fontSize: 10, fontWeight: 500, ...nameTextStyle},
      splitLine: {
        ...splitLine,
        lineStyle: {color: c.split, width: 1, ...lineStyle},
      },
    };
  };
  return Array.isArray(axis) ? axis.map(normalize) : normalize(axis);
}

function mapSeries(series: unknown) {
  const normalize = (raw: unknown) => {
    const obj = asRecord(raw);
    const type = obj.type;
    const decorative = isDecorativeSeries(obj);
    const markLine = asRecord(obj.markLine);
    const markPoint = asRecord(obj.markPoint);
    const itemStyle = asRecord(obj.itemStyle);
    const explicitColor = objectColor(obj);
    return {
      ...obj,
      ...(decorative ? {
        name: obj.name ?? '__decorative__',
        legendHoverLink: false,
        silent: true,
        emphasis: {disabled: true},
        endLabel: {show: false},
      } : {}),
      ...(explicitColor ? {itemStyle: {color: explicitColor, ...itemStyle}} : {}),
      ...(type === 'line' && !decorative ? {
        symbol: obj.symbol ?? 'none',
        lineStyle: {width: 1.75, ...asRecord(obj.lineStyle)},
        endLabel: {
          show: true,
          formatter: '{a}',
          color: explicitColor ?? '#64748b',
          fontSize: 10,
          fontWeight: 500,
          distance: 6,
          ...asRecord(obj.endLabel),
        },
      } : {}),
      ...(type === 'bar' ? {
        barCategoryGap: obj.barCategoryGap ?? '42%',
      } : {}),
      ...(obj.markLine ? {
        markLine: {
          ...markLine,
          z: markLine.z ?? 6,
          label: {
            overflow: 'truncate',
            width: 92,
            ...asRecord(markLine.label),
          },
        },
      } : {}),
      ...(obj.markPoint ? {
        markPoint: {
          ...markPoint,
          z: markPoint.z ?? 8,
          silent: markPoint.silent ?? true,
        },
      } : {}),
      emphasis: decorative ? {disabled: true} : {focus: 'series', ...asRecord(obj.emphasis)},
    };
  };
  return Array.isArray(series) ? series.map(normalize) : series;
}

function legendName(item: unknown): string | null {
  if (typeof item === 'string') return item;
  const obj = asRecord(item);
  return typeof obj.name === 'string' ? obj.name : null;
}

function seriesValue(raw: unknown, series: ChartSeries): number | null {
  const value = raw && typeof raw === 'object' && 'value' in raw ? (raw as {value?: unknown}).value : raw;
  const direct = numericValue(value);
  if (direct !== null) return Math.abs(direct);
  if (!Array.isArray(value)) return null;
  const yIndex = typeof series.encode?.y === 'number' ? series.encode.y : 1;
  const encoded = numericValue(value[yIndex]);
  if (encoded !== null) return Math.abs(encoded);
  const fallback = value.find((item, idx) => idx > 0 && numericValue(item) !== null);
  const num = numericValue(fallback);
  return num === null ? null : Math.abs(num);
}

function seriesTotal(series: ChartSeries): number {
  let total = 0;
  for (const item of series.data ?? []) {
    total += seriesValue(item, series) ?? 0;
  }
  return total;
}

function orderLegendBySeriesTotal(legend: Record<string, unknown>, series: unknown): Record<string, unknown> {
  if (!Array.isArray(legend.data) || !Array.isArray(series)) return legend;
  const totals = new Map<string, number>();
  for (const raw of series) {
    const obj = asRecord(raw) as ChartSeries;
    if (typeof obj.name === 'string') totals.set(obj.name, seriesTotal(obj));
  }
  return {
    ...legend,
    data: [...legend.data].sort((a, b) => (totals.get(legendName(b) ?? '') ?? -1) - (totals.get(legendName(a) ?? '') ?? -1)),
  };
}

function isDecorativeSeries(series: Record<string, unknown>): boolean {
  const tooltip = asRecord(series.tooltip);
  const lineStyle = asRecord(series.lineStyle);
  return series.silent === true && tooltip.show === false && lineStyle.opacity === 0;
}

function hasFiniteChartPoint(raw: unknown): boolean {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw) && 'value' in raw
    ? (raw as {value?: unknown}).value
    : raw;
  if (typeof value === 'number') return Number.isFinite(value);
  return Array.isArray(value) && value.some((item) => typeof item === 'number' && Number.isFinite(item));
}

function optionHasData(option: object): boolean {
  const series = (option as {series?: unknown}).series;
  if (!Array.isArray(series)) return false;
  return series.some((raw) => {
    const data = asRecord(raw).data;
    return Array.isArray(data) && data.some(hasFiniteChartPoint);
  });
}

function applyHealthChartStyle(option: object, isDark: boolean): object {
  const opt = option as Record<string, unknown>;
  const c = cc(isDark);
  const tooltip = asRecord(opt.tooltip);
  const legend = orderLegendBySeriesTotal(asRecord(opt.legend), opt.series);
  return {
    ...opt,
    color: opt.color ?? HEALTH_CHART_COLORS,
    animationDuration: opt.animationDuration ?? 450,
    animationDurationUpdate: opt.animationDurationUpdate ?? 250,
    tooltip: opt.tooltip ? {
      confine: true,
      trigger: 'axis',
      backgroundColor: isDark ? 'rgba(15,23,42,0.96)' : 'rgba(255,255,255,0.96)',
      borderColor: isDark ? 'rgba(148,163,184,0.22)' : 'rgba(100,116,139,0.18)',
      borderWidth: 1,
      padding: [8, 10],
      textStyle: {color: isDark ? '#e2e8f0' : '#334155', fontSize: 12, lineHeight: 18},
      extraCssText: 'box-shadow:0 8px 28px rgba(15,23,42,0.14);border-radius:8px;',
      axisPointer: {
        type: 'line',
        lineStyle: {color: isDark ? 'rgba(148,163,184,0.35)' : 'rgba(100,116,139,0.30)', width: 1},
        shadowStyle: {color: isDark ? 'rgba(148,163,184,0.08)' : 'rgba(100,116,139,0.08)'},
      },
      ...tooltip,
    } : opt.tooltip,
    legend: opt.legend ? {
      itemWidth: 18,
      itemHeight: 8,
      itemGap: 16,
      icon: 'roundRect',
      ...legend,
      textStyle: {color: c.label, fontSize: 12, fontWeight: 500, ...asRecord(legend.textStyle)},
    } : opt.legend,
    xAxis: opt.xAxis ? mapAxis(opt.xAxis, c) : opt.xAxis,
    yAxis: opt.yAxis ? mapAxis(opt.yAxis, c) : opt.yAxis,
    series: opt.series ? mapSeries(opt.series) : opt.series,
  };
}

function isDateString(value: unknown): value is string {
  return typeof value === 'string' && isValidDateKey(value);
}

function remapIndexedSeriesData(data: unknown[], oldDates: string[], axisDates: string[]): unknown[] {
  const oldIndex = new Map(oldDates.map((date, index) => [date, index]));
  return axisDates.map((date) => {
    const index = oldIndex.get(date);
    return index === undefined ? null : data[index];
  });
}

function embeddedDate(raw: unknown): string | null {
  const value = raw && typeof raw === 'object' && 'value' in raw ? (raw as {value?: unknown}).value : raw;
  return Array.isArray(value) && isDateString(value[0]) ? value[0] : null;
}

function remapEmbeddedDateSeriesData(data: unknown[], axisDates: string[]): unknown[] {
  const grouped = new Map<string, unknown[]>();
  for (const item of data) {
    const date = embeddedDate(item);
    if (!date) continue;
    const items = grouped.get(date) ?? [];
    items.push(item);
    grouped.set(date, items);
  }
  return axisDates.flatMap((date) => grouped.get(date) ?? []);
}

function alignDateCategoryAxes(option: object, axisDates: string[]): object {
  if (!axisDates.length) return option;
  const opt = option as Record<string, unknown>;
  const xAxes = normalizeAxisList(opt.xAxis);
  if (!xAxes.length) return option;

  let changed = false;
  const nextAxes = xAxes.map((axis) => {
    const data = axis.data;
    if (axis.type !== 'category' || !Array.isArray(data) || !data.every(isDateString)) return axis;
    const oldDates = data as string[];
    if (oldDates.length === axisDates.length && oldDates.every((date, index) => date === axisDates[index])) return axis;
    changed = true;
    return {...axis, data: axisDates, __oldDates: oldDates};
  });
  if (!changed) return option;

  const firstChangedAxis = nextAxes.find((axis) => Array.isArray(axis.__oldDates)) as (Record<string, unknown> & {__oldDates?: string[]}) | undefined;
  const oldDates = firstChangedAxis?.__oldDates;
  const cleanAxes = nextAxes.map(({__oldDates, ...axis}) => axis);
  const series = Array.isArray(opt.series) && oldDates
    ? opt.series.map((raw) => {
        const item = asRecord(raw);
        const data = item.data;
        if (!Array.isArray(data)) return raw;
        if (data.some((entry) => embeddedDate(entry))) return {...item, data: remapEmbeddedDateSeriesData(data, axisDates)};
        if (data.length !== oldDates.length) return raw;
        return {...item, data: remapIndexedSeriesData(data, oldDates, axisDates)};
      })
    : opt.series;

  return {
    ...opt,
    xAxis: Array.isArray(opt.xAxis) ? cleanAxes : cleanAxes[0],
    series,
  };
}

function alignCalendarRange(option: object, axisDates: string[]): object {
  if (axisDates.length < 2) return option;
  const opt = option as Record<string, unknown>;
  if (!opt.calendar) return option;
  const calendars = Array.isArray(opt.calendar) ? opt.calendar : [opt.calendar];
  const nextCalendars = calendars.map((raw) => {
    const calendar = asRecord(raw);
    return {...calendar, range: [axisDates[0], axisDates.at(-1)!]};
  });
  return {...opt, calendar: Array.isArray(opt.calendar) ? nextCalendars : nextCalendars[0]};
}

// ── layout ───────────────────────────────────────────────────────────────────

function chartHeight(label: string, isMobile: boolean) {
  return isMobile ? 200 : 240;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function formatDeviationValue(value: number): string {
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString();
  if (Math.abs(value) >= 100) return Math.round(value).toString();
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function dateFromValue(raw: unknown): string | null {
  if (typeof raw === 'string' && raw.length >= 10 && isDateString(raw.slice(0, 10))) return raw.slice(0, 10);
  return null;
}

function seriesDisplayName(series: ChartSeries, index: number): string {
  return typeof series.name === 'string' && series.name ? series.name : `序列 ${index + 1}`;
}

function getAxisData(axis: unknown, index = 0): unknown[] {
  const axisObj = Array.isArray(axis) ? axis[index] : axis;
  const data = asRecord(axisObj).data;
  return Array.isArray(data) ? data : [];
}

function numericAt(value: unknown, index: number): number | null {
  return Array.isArray(value) ? numericValue(value[index]) : numericValue(value);
}

function extractChartSeries(option: object): DeviationSeries[] {
  const opt = option as Record<string, unknown>;
  const rawSeries = Array.isArray(opt.series) ? opt.series as ChartSeries[] : [];
  if (!rawSeries.length) return [];

  const xAxis = Array.isArray(opt.xAxis) ? opt.xAxis : opt.xAxis ? [opt.xAxis] : [];
  const yAxis = Array.isArray(opt.yAxis) ? opt.yAxis : opt.yAxis ? [opt.yAxis] : [];
  const firstX = asRecord(xAxis[0]);
  const firstY = asRecord(yAxis[0]);
  const xDates = getAxisData(opt.xAxis).map((item) => dateFromValue(item));
  const yDates = getAxisData(opt.yAxis).map((item) => dateFromValue(item));

  return rawSeries.flatMap((series, seriesIndex) => {
    if (series.silent === true || asRecord(series.lineStyle).opacity === 0 || series.tooltip === false) return [];
    const data = Array.isArray(series.data) ? series.data : [];
    if (!data.length) return [];

    const points: DeviationPoint[] = [];
    for (let index = 0; index < data.length; index++) {
      const raw = data[index];
      const value = raw && typeof raw === 'object' && 'value' in raw ? (raw as {value?: unknown}).value : raw;
      let date: string | null = null;
      let numeric: number | null = null;

      if (Array.isArray(value)) {
        const encode = asRecord(series.encode);
        const xEncode = typeof encode.x === 'number' ? encode.x : 0;
        const yEncode = typeof encode.y === 'number' ? encode.y : 1;
        date = dateFromValue(value[xEncode]) ?? dateFromValue(value[0]);
        numeric = numericAt(value, yEncode) ?? value.map(numericValue).find((item): item is number => item !== null) ?? null;

        if (!date && series.type === 'heatmap') {
          const xIndex = numericValue(value[0]);
          const yIndex = numericValue(value[1]);
          const heatValue = numericValue(value[2]);
          date = xIndex !== null ? dateFromValue(xDates[xIndex] ?? getAxisData(opt.xAxis)[xIndex]) : null;
          numeric = heatValue ?? yIndex;
        }
      } else if (firstX.type === 'category' && xDates[index]) {
        date = xDates[index];
        numeric = numericValue(raw);
      } else if (firstY.type === 'category' && yDates[index]) {
        date = yDates[index];
        numeric = numericValue(raw);
      }

      if (date && numeric !== null) points.push({date, value: numeric});
    }

    return points.length ? [{name: seriesDisplayName(series, seriesIndex), points}] : [];
  });
}

function buildSeriesDeviation(series: DeviationSeries, selectedDate: string): HealthDeviation | null {
  const currentValues = series.points.filter((point) => point.date === selectedDate).map((point) => point.value);
  if (!currentValues.length) return null;
  const current = currentValues.reduce((sum, value) => sum + value, 0);
  const baselineValues = series.points
    .filter((point) => point.date !== selectedDate)
    .map((point) => point.value)
    .filter((value) => Number.isFinite(value));
  if (baselineValues.length < MIN_BASELINE_SAMPLES) return null;

  const baseline = median(baselineValues);
  const deviations = baselineValues.map((value) => Math.abs(value - baseline));
  const mad = median(deviations);
  const delta = current - baseline;
  const absPct = baseline === 0 ? (current === 0 ? 0 : Infinity) : Math.abs(delta / baseline);
  const robustScore = mad > 0 ? Math.abs(current - baseline) / mad : 0;
  const isWarning = robustScore >= 5 || absPct >= 1;
  const isNotice = isWarning || robustScore >= 3 || absPct >= 0.45;
  if (!isNotice) return null;

  const direction = delta > 0 ? '+' : '-';
  const change = Number.isFinite(absPct) ? `${direction}${Math.round(absPct * 100)}%` : `${direction}${formatDeviationValue(Math.abs(delta))}`;
  return {
    level: isWarning ? 'warning' : 'notice',
    tooltip: `${series.name} ${change} vs 当前范围中位数（${formatDeviationValue(current)} / ${formatDeviationValue(baseline)}）`,
  };
}

function computeOptionDeviation(option: object, selectedDate: string | undefined): HealthDeviation | null {
  if (!isValidDateKey(selectedDate)) return null;
  const deviations = extractChartSeries(option)
    .map((series) => buildSeriesDeviation(series, selectedDate))
    .filter((item): item is HealthDeviation => Boolean(item))
    .sort((a, b) => (a.level === b.level ? 0 : a.level === 'warning' ? -1 : 1));

  if (!deviations.length) return null;
  return {
    level: deviations.some((item) => item.level === 'warning') ? 'warning' : 'notice',
    tooltip: deviations.slice(0, 2).map((item) => item.tooltip).join('\n'),
  };
}

type OptionFn = (isDark: boolean, D: HealthData, isMobile?: boolean) => object;

const SECTIONS: Array<{title: string; charts: Array<{label: string; opt: OptionFn}>}> = [
  {title: '体重', charts: [
    {label: '体重 & 体脂率', opt: bodyOpt},
  ]},
  {title: '活动', charts: [
    {label: '每日步数 & 距离', opt: stepsDistanceOpt},
    {label: '运动时长', opt: exerciseOpt},
    {label: '爬楼层数', opt: flightsOpt},
    {label: '活跃热量 & 基础代谢', opt: energyOpt},
    {label: '站立时间 & 站立小时数', opt: standOpt},
    {label: '体力强度', opt: effortOpt},
  ]},
  {title: '运动记录', charts: [
    {label: '运动时间轴', opt: workoutTimelineOpt},
    {label: '运动类型统计', opt: workoutTypeOpt},
  ]},
  {title: '睡眠', charts: [
    {label: '睡眠结构', opt: sleepOpt},
    {label: '睡眠腕温', opt: wristTempOpt},
  ]},
  {title: '心血管', charts: [
    {label: '静息心率 & HRV', opt: heartOpt},
    {label: '心肺恢复速率', opt: cardioRecoveryOpt},
    {label: '呼吸频率 & 血氧饱和度', opt: respSpo2Opt},
    {label: '最大摄氧量 VO₂ Max', opt: vo2Opt},
  ]},
  {title: '步态质量', charts: [
    {label: '步行速度 & 步长', opt: walkQualityOpt},
    {label: '步态不对称性 & 双支撑时间', opt: gaitOpt},
    {label: '楼梯速度（上 / 下）', opt: stairOpt},
    {label: '六分钟步行测试', opt: sixMinWalkOpt},
  ]},
  {title: '用药', charts: [
    {label: '每日服药（碳酸氢钠片 & 苯溴马隆片）', opt: medDailyCombinedOpt},
  ]},
  {title: '环境 & 习惯', charts: [
    {label: '声音暴露（环境 & 耳机）', opt: audioOpt},
    {label: '日晒时间', opt: daylightOpt},
    {label: '洗手时长', opt: handwashOpt},
  ]},
  {title: '心理状态', charts: [
    {label: '正念时长', opt: mindfulOpt},
    {label: '愉悦度走势', opt: stateOfMindOpt},
  ]},
];

const HEALTH_CHART_METRIC_KEYS: Record<string, string[]> = {
  '体重 & 体脂率': ['weight', 'fat'],
  '每日步数 & 距离': ['steps'],
  '运动时长': ['exercise'],
  '爬楼层数': ['flights'],
  '活跃热量 & 基础代谢': ['active_energy'],
  '站立时间 & 站立小时数': ['stand_time'],
  '睡眠结构': ['sleep_total', 'sleep_deep', 'sleep_rem'],
  '静息心率 & HRV': ['rhr', 'hrv'],
  '心肺恢复速率': ['cardio_recovery'],
  '呼吸频率 & 血氧饱和度': ['resp_rate', 'spo2'],
  '步行速度 & 步长': ['walking_hr'],
  '日晒时间': ['daylight'],
  '正念时长': ['mindful'],
  '愉悦度走势': ['mood'],
};

function slugifyChartLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-|-$/g, '');
}

export function healthChartAnchorId(label: string): string {
  return `health-chart-${slugifyChartLabel(label)}`;
}

export const HEALTH_CHART_NAV = SECTIONS.map((section) => ({
  title: section.title,
  charts: section.charts.map((chart) => ({
    label: chart.label,
    id: healthChartAnchorId(chart.label),
    metricKeys: HEALTH_CHART_METRIC_KEYS[chart.label] || [],
  })),
}));

const HEALTH_CHART_REGISTRY = new Map(SECTIONS.flatMap((section) => section.charts.map((chart) => [
  healthChartAnchorId(chart.label),
  chart,
] as const)));

export function HealthChartDeviationMark({label}: {label: string}): React.ReactNode {
  const {data, axisDates, selectedDate, loading} = useContext(YearCtx);
  const deviation = useMemo(
    () => {
      if (loading) return null;
      const chart = SECTIONS.flatMap((section) => section.charts).find((item) => item.label === label);
      if (!chart) return null;
      const option = alignCalendarRange(alignDateCategoryAxes(chart.opt(false, data, false), axisDates), axisDates);
      return computeOptionDeviation(option, selectedDate);
    },
    [axisDates, data, label, loading, selectedDate],
  );

  if (!deviation) return null;

  return (
    <span
      className={`${styles.deviationMark} ${deviation.level === 'warning' ? styles.deviationMarkWarning : ''}`}
      title={deviation.tooltip}
      aria-label={deviation.tooltip}
    >
      !
    </span>
  );
}

// ── year / data context ───────────────────────────────────────────────────────

function mergeData(all: Record<string, HealthData>, keys: string[]): HealthData {
  const loadedKeys = keys.filter((key) => all[key]).sort();
  if (loadedKeys.length === 0) return EMPTY;
  if (loadedKeys.length === 1) return all[loadedKeys[0]];
  const result = {} as Record<string, unknown[]>;
  for (const key of Object.keys(EMPTY) as Array<keyof HealthData>) {
    if (key === 'lastUpdated') continue;
    const merged = loadedKeys.flatMap((monthKey) => all[monthKey][key] as [string, ...number[]][]);
    result[key] = merged.sort((a, b) => (a[0] as string).localeCompare(b[0] as string));
  }
  // Pick the latest exportedAt across all loaded months
  const latestDate = loadedKeys.map((key) => all[key].lastUpdated).filter(Boolean).sort().at(-1) ?? null;
  return {...result, lastUpdated: latestDate} as HealthData;
}

function getVisibleHealthYears(availableMonths: Record<number, number[]>, selectedDate?: string): number[] {
  const capYear = Number(selectedDateOrToday(selectedDate).slice(0, 4));
  return Object.keys(availableMonths).map(Number).filter((year) => year <= capYear).sort((a, b) => a - b);
}

function monthKeysThroughDate(year: number, months: number[], selectedDate?: string): string[] {
  const cap = selectedDateOrToday(selectedDate);
  const capYear = Number(cap.slice(0, 4));
  const capMonth = Number(cap.slice(5, 7));
  if (year > capYear) return [];
  const maxMonth = year === capYear ? capMonth : 12;
  return months
    .filter((month) => month <= maxMonth)
    .map((month) => `${year}-${String(month).padStart(2, '0')}`);
}

function getTargetMonthKeys(scope: TimeScope, availableMonths: Record<number, number[]>, selectedDate?: string): string[] {
  if (scope.mode === 'period') {
    if (!isValidDateKey(scope.start) || !isValidDateKey(scope.end) || scope.start > scope.end) return [];
    const keys: string[] = [];
    const cursor = parseDate(`${scope.start.slice(0, 7)}-01`);
    const end = parseDate(`${scope.end.slice(0, 7)}-01`);
    while (cursor <= end) {
      const year = cursor.getFullYear();
      const month = cursor.getMonth() + 1;
      if (availableMonths[year]?.includes(month)) keys.push(`${year}-${String(month).padStart(2, '0')}`);
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return keys;
  }

  if (scope.mode === 'year') {
    return monthKeysThroughDate(scope.year, availableMonths[scope.year] ?? [], selectedDate);
  }

  if (scope.mode === 'all') {
    return [];
  }

  const endDate = parseDate(selectedDateOrToday(selectedDate));
  const start = new Date(endDate);
  start.setDate(start.getDate() - RANGE_DAYS[scope.range] + 1);
  const keys: string[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
  while (cursor <= end) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth() + 1;
    if (availableMonths[year]?.includes(month)) keys.push(`${year}-${String(month).padStart(2, '0')}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return keys;
}

function filterDataByDateRange(data: HealthData, start: string, end: string): HealthData {
  const result = {} as Record<string, unknown>;
  for (const key of Object.keys(EMPTY) as Array<keyof HealthData>) {
    if (key === 'lastUpdated') continue;
    const values = data[key] as unknown as Array<[string, ...unknown[]]>;
    result[key] = values.filter(([date]) => {
      const itemStart = start.slice(0, date.length);
      const itemEnd = end.slice(0, date.length);
      return date >= itemStart && date <= itemEnd;
    });
  }
  return {...result, lastUpdated: data.lastUpdated} as HealthData;
}

async function fetchHealthMonths(keys: string[], signal: AbortSignal): Promise<Record<string, HealthData>> {
  const result: Record<string, HealthData> = {};
  const now = new Date();
  const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (!signal.aborted) {
      const key = keys[nextIndex++];
      if (!key) return;
      const data = await fetchHealthMonth(key, currentKey);
      if (data) result[key] = data;
    }
  }

  const workerCount = Math.min(HEALTH_FETCH_CONCURRENCY, keys.length);
  await Promise.all(Array.from({length: workerCount}, () => worker()));
  return result;
}

function retainTargetMonths(
  previous: Record<string, HealthData>,
  targetKeys: string[],
  loaded: Record<string, HealthData> = {},
): Record<string, HealthData> {
  const next: Record<string, HealthData> = {};
  for (const key of targetKeys) {
    const value = loaded[key] ?? previous[key];
    if (value) next[key] = value;
  }
  const previousKeys = Object.keys(previous);
  const nextKeys = Object.keys(next);
  if (previousKeys.length === nextKeys.length && nextKeys.every((key) => previous[key] === next[key])) return previous;
  return next;
}

function extractDateFromChartEvent(params: unknown): string | null {
  const queue: unknown[] = [params];
  const seen = new Set<unknown>();

  while (queue.length) {
    const value = queue.shift();
    if (value === null || value === undefined || seen.has(value)) continue;
    seen.add(value);

    if (typeof value === 'string') {
      const match = value.match(/\d{4}-\d{2}-\d{2}/);
      if (match) return match[0];
      continue;
    }

    if (typeof value === 'number') continue;

    if (Array.isArray(value)) {
      queue.push(...value);
      continue;
    }

    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      queue.push(record.axisValue, record.name, record.value, record.data);
    }
  }

  return null;
}

function normalizeAxisList(axis: unknown): Array<Record<string, unknown>> {
  if (!axis) return [];
  return Array.isArray(axis) ? axis as Array<Record<string, unknown>> : [axis as Record<string, unknown>];
}

function extractDateFromChartOption(option: Record<string, unknown>, params: unknown): string | null {
  const record = params && typeof params === 'object' ? params as Record<string, unknown> : {};
  const dataIndex = Number(record.dataIndex);
  if (!Number.isFinite(dataIndex) || dataIndex < 0) return null;

  const axes = [
    ...normalizeAxisList(option.xAxis),
    ...normalizeAxisList(option.yAxis),
  ];

  for (const axis of axes) {
    const data = axis.data;
    if (!Array.isArray(data)) continue;
    const value = data[dataIndex];
    const date = extractDateFromChartEvent(value);
    if (date) return date;
  }

  return null;
}

function pickAxisDate(option: Record<string, unknown>, axisKey: 'xAxis' | 'yAxis', axisIndex: number, rawIndex: unknown): string | null {
  const index = Math.round(Number(rawIndex));
  if (!Number.isFinite(index) || index < 0) return null;
  const axis = normalizeAxisList(option[axisKey])[axisIndex];
  const data = axis?.data;
  if (!Array.isArray(data)) return null;
  return extractDateFromChartEvent(data[index]);
}

type ChartLike = {
  getOption: () => Record<string, unknown>;
  getZr: () => {on: (event: string, handler: (params: unknown) => void) => void; off: (event: string, handler: (params: unknown) => void) => void};
  convertFromPixel: (finder: Record<string, number>, value: [number, number]) => unknown;
};

const zrenderClickHandlers = new WeakMap<ChartLike, (params: unknown) => void>();

function extractDateFromZrenderClick(chart: ChartLike, event: unknown): string | null {
  const record = event && typeof event === 'object' ? event as Record<string, unknown> : {};
  const offsetX = Number(record.offsetX);
  const offsetY = Number(record.offsetY);
  if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) return null;

  const option = chart.getOption();
  const point: [number, number] = [offsetX, offsetY];
  const xAxes = normalizeAxisList(option.xAxis);
  const yAxes = normalizeAxisList(option.yAxis);

  for (let seriesIndex = 0; seriesIndex < normalizeAxisList(option.series).length; seriesIndex++) {
    const converted = chart.convertFromPixel({seriesIndex}, point);
    if (Array.isArray(converted)) {
      const xDate = pickAxisDate(option, 'xAxis', 0, converted[0]);
      if (xDate) return xDate;
      const yDate = pickAxisDate(option, 'yAxis', 0, converted[1]);
      if (yDate) return yDate;
    }
  }

  for (let axisIndex = 0; axisIndex < xAxes.length; axisIndex++) {
    const converted = chart.convertFromPixel({xAxisIndex: axisIndex}, point);
    const date = pickAxisDate(option, 'xAxis', axisIndex, Array.isArray(converted) ? converted[0] : converted);
    if (date) return date;
  }

  for (let axisIndex = 0; axisIndex < yAxes.length; axisIndex++) {
    const converted = chart.convertFromPixel({yAxisIndex: axisIndex}, point);
    const date = pickAxisDate(option, 'yAxis', axisIndex, Array.isArray(converted) ? converted[1] : converted);
    if (date) return date;
  }

  return null;
}

function HealthProviderInner({
  children,
  onDateSelect,
  selectedDate,
  scope: controlledScope,
  setScope: setControlledScope,
}: {
  children: React.ReactNode;
  onDateSelect?: (date: string) => void;
  selectedDate?: string;
  scope?: TimeScope;
  setScope?: (scope: TimeScope) => void;
}) {
  const [internalScope, setInternalScope] = useState<TimeScope>({mode: 'recent', range: '7d'});
  const [allData, setAllData] = useState<Record<string, HealthData>>({});
  const [historyData, setHistoryData] = useState<HealthData | null>(healthHistoryCache);
  const [loading, setLoading] = useState(true);
  const [settledTarget, setSettledTarget] = useState('');
  const scope = controlledScope ?? internalScope;
  const setScope = setControlledScope ?? setInternalScope;
  const availableMonths = useMemo(() => getAvailableMonthMap(), []);
  const targetMonthKeys = useMemo(
    () => getTargetMonthKeys(scope, availableMonths, selectedDate),
    [availableMonths, scope, selectedDate],
  );
  const targetSignature = scope.mode === 'all' ? 'all-history' : targetMonthKeys.join(',');

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    if (scope.mode === 'all') {
      setLoading(true);
      void loadHealthChartHistory()
        .then((loaded) => {
          if (!cancelled) setHistoryData(loaded);
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
            setSettledTarget(targetSignature);
          }
        });
      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    const missingKeys = targetMonthKeys.filter((key) => !allData[key]);
    if (missingKeys.length === 0) {
      setAllData((previous) => retainTargetMonths(previous, targetMonthKeys));
      setLoading(false);
      setSettledTarget(targetSignature);
      return () => controller.abort();
    }

    setLoading(true);
    void fetchHealthMonths(missingKeys, controller.signal)
      .then((loaded) => {
        if (!cancelled) setAllData((previous) => retainTargetMonths(previous, targetMonthKeys, loaded));
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setSettledTarget(targetSignature);
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [scope.mode, targetMonthKeys, targetSignature]);

  const data = useMemo(() => {
    if (scope.mode === 'all') return historyData ?? EMPTY;
    const merged = mergeData(allData, targetMonthKeys);
    if (scope.mode === 'period') {
      if (!isValidDateKey(scope.start) || !isValidDateKey(scope.end) || scope.start > scope.end) return EMPTY;
      return filterDataByDateRange(merged, scope.start, scope.end);
    }
    if (scope.mode === 'year') {
      return filterDataByDateRange(merged, `${scope.year}-01-01`, cappedYearEnd(scope.year, selectedDate));
    }
    const end = selectedDateOrToday(selectedDate);
    const start = parseDate(end);
    start.setDate(start.getDate() - RANGE_DAYS[scope.range] + 1);
    return filterDataByDateRange(merged, dateKey(start), end);
  }, [allData, historyData, scope, selectedDate, targetMonthKeys]);
  const axisDates = useMemo(() => getScopeAxisDates(scope, data, selectedDate), [scope, data, selectedDate]);

  const scopeLoading = loading || settledTarget !== targetSignature;

  return <YearCtx.Provider value={{scope, setScope, data, axisDates, loading: scopeLoading, availableMonths, onDateSelect, selectedDate}}>{children}</YearCtx.Provider>;
}

// ── inner components ──────────────────────────────────────────────────────────

function Sparkline({values, dates, color, uid, unit, rangeMin, rangeMax}: {
  values: number[]; dates: string[]; color: string; uid: string; unit: string;
  rangeMin: number; rangeMax: number;
}) {
  const [hovIdx, setHovIdx] = useState<number | null>(null);

  if (values.length < 2) return <div style={{height: 24}} />;
  const W = 100, H = 44, pad = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [
    pad + (i / (values.length - 1)) * (W - 2 * pad),
    H - pad - ((v - min) / span) * (H - 2 * pad),
  ]);
  const polyline = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = [
    `M${pts[0][0].toFixed(1)},${H}`,
    ...pts.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`),
    `L${pts[pts.length - 1][0].toFixed(1)},${H}`,
    'Z',
  ].join(' ');
  const gid = `sg-${uid.replace(/[^a-z0-9]/gi, '')}`;

  // Ideal range band: map goodMin/goodMax to SVG y-coords and clamp to chart area
  const toY = (v: number) => H - pad - ((v - min) / span) * (H - 2 * pad);
  const bandTop = Math.min(H - pad, Math.max(pad, toY(rangeMax)));
  const bandBot = Math.min(H - pad, Math.max(pad, toY(rangeMin)));
  const showBand = bandBot > bandTop + 0.5;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    setHovIdx(Math.min(values.length - 1, Math.max(0, Math.round(relX * (values.length - 1)))));
  };

  const hovPt = hovIdx !== null ? pts[hovIdx] : null;
  const tooltipPct = hovIdx !== null ? `${(hovIdx / (values.length - 1)) * 100}%` : '50%';
  const fmtV = (v: number) => Number.isInteger(v) ? String(v) : v.toFixed(1);

  return (
    <div style={{position: 'relative'}}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{width: '100%', height: H, display: 'block', cursor: 'crosshair'}}
        preserveAspectRatio="none"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHovIdx(null)}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.2} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {showBand && (
          <rect
            x={pad} y={bandTop.toFixed(1)}
            width={W - 2 * pad} height={(bandBot - bandTop).toFixed(1)}
            fill="#22c55e" fillOpacity={0.12}
          />
        )}
        <path d={area} fill={`url(#${gid})`} />
        <polyline points={polyline} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        {hovPt && (
          <line
            x1={hovPt[0].toFixed(1)} y1={pad.toString()}
            x2={hovPt[0].toFixed(1)} y2={(H - pad).toString()}
            stroke={color} strokeWidth="0.6" opacity="0.7"
          />
        )}
      </svg>
      {hovIdx !== null && (
        <div style={{
          position: 'absolute',
          bottom: 'calc(100% + 4px)',
          left: tooltipPct,
          transform: 'translateX(-50%)',
          background: 'var(--ifm-background-color)',
          border: `1px solid ${color}`,
          borderRadius: 4,
          padding: '2px 6px',
          fontSize: '0.65rem',
          color: 'var(--ifm-color-content)',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          zIndex: 100,
          lineHeight: 1.5,
          boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        }}>
          {dates[hovIdx]?.slice(5)} {fmtV(values[hovIdx])}{unit}
        </div>
      )}
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = {
  good: '#15803d', warn: '#a16207', bad: '#b91c1c', neutral: '#64748b',
};

const STATUS_LABEL: Record<string, string> = {
  good: '理想', warn: '关注', bad: '偏离', neutral: '观察',
};

const STATUS_CLASS: Record<string, string> = {
  good: styles.dashCardGood, warn: styles.dashCardWarn, bad: styles.dashCardBad, neutral: styles.dashCardNeutral,
};

function DashCardComp({card}: {card: DashCard}) {
  const color = STATUS_COLOR[card.rangeStatus];
  const changeColor = card.changeGood === true ? '#15803d' : card.changeGood === false ? '#b91c1c' : '#64748b';
  const arrow = card.changeDir === 'up' ? '↑' : card.changeDir === 'down' ? '↓' : null;
  return (
    <div className={`${styles.dashCard} ${STATUS_CLASS[card.rangeStatus]}`}>
      <div className={styles.dashCardTop}>
        <span className={styles.dashCardLabel}>{card.label}</span>
        <div className={styles.dashCardMeta}>
          <span className={styles.dashCardStatus} style={{color}}>{STATUS_LABEL[card.rangeStatus]}</span>
          {card.change7d !== '—' && arrow && (
            <span className={styles.dashCardChange} style={{color: changeColor}}>
              {arrow}{card.change7d}
              <span className={styles.dashCardChangePeriod}>7d</span>
            </span>
          )}
        </div>
      </div>
      <div className={styles.dashCardMain}>
        <span className={styles.dashCardValue} style={{color}}>{card.value}</span>
        <span className={styles.dashCardUnit}>{card.unit}</span>
      </div>
      <div className={styles.dashCardRange}>{card.rangeLabel}</div>
      <div className={styles.dashCardSpark}>
        <Sparkline values={card.sparkline} dates={card.sparklineDates} color={color} uid={card.label} unit={card.unit} rangeMin={card.rangeMin} rangeMax={card.rangeMax} />
      </div>
    </div>
  );
}

function FloatingBar() {
  const {scope, setScope, availableMonths, loading, selectedDate} = useContext(YearCtx);
  const years = getVisibleHealthYears(availableMonths, selectedDate).reverse();

  return ReactDOM.createPortal(
    <div className={styles.floatingStack}>
      <div className={styles.floatingBar} role="group" aria-label="健康数据范围模式">
        {(['recent', 'year', 'all'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={`${styles.floatingBtn} ${scope.mode === mode ? styles.floatingBtnActive : ''}`}
            aria-pressed={scope.mode === mode}
            onClick={() => {
              if (mode === 'recent') setScope({mode, range: scope.mode === 'recent' ? scope.range : '30d'});
              if (mode === 'year') setScope({mode, year: scope.mode === 'year' ? scope.year : (years[0] ?? new Date().getFullYear())});
              if (mode === 'all') setScope({mode});
            }}
          >{mode === 'recent' ? '最近' : mode === 'year' ? '按年' : '全部记录'}</button>
        ))}
      </div>
      <div className={`${styles.floatingBar} ${styles.floatingOptionBar}`} role="group" aria-label="健康数据范围选项">
        {scope.mode === 'recent' && (Object.keys(RANGE_DAYS) as RecentRange[]).map((r) => (
          <button
            key={r}
            type="button"
            className={`${styles.floatingBtn} ${scope.range === r ? styles.floatingBtnActive : ''}`}
            aria-pressed={scope.range === r}
            onClick={() => setScope({mode: 'recent', range: r})}
          >{RANGE_LABELS[r]}</button>
        ))}
        {scope.mode === 'year' && years.map((y) => (
          <button
            key={y}
            type="button"
            className={`${styles.floatingBtn} ${scope.year === y ? styles.floatingBtnActive : ''}`}
            aria-pressed={scope.year === y}
            onClick={() => setScope({mode: 'year', year: y})}
          >{y}</button>
        ))}
        {scope.mode === 'all' && (
          <button type="button" className={`${styles.floatingBtn} ${styles.floatingBtnActive}`} aria-pressed="true" onClick={() => setScope({mode: 'all'})}>
            全部历史
          </button>
        )}
        {loading && <span className={styles.floatingLoading} role="status" aria-live="polite">加载中…</span>}
      </div>
    </div>,
    document.body,
  );
}

function ScopeControlsInner() {
  const {scope, setScope, availableMonths, loading, selectedDate} = useContext(YearCtx);
  const years = getVisibleHealthYears(availableMonths, selectedDate).reverse();

  return (
    <div className={styles.scopeControls} aria-label="健康数据时间范围">
      <div className={styles.scopeBar} role="group" aria-label="健康数据范围模式">
        {(['recent', 'year', 'all'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={`${styles.scopeBtn} ${scope.mode === mode ? styles.scopeBtnActive : ''}`}
            aria-pressed={scope.mode === mode}
            onClick={() => {
              if (mode === 'recent') setScope({mode, range: scope.mode === 'recent' ? scope.range : '30d'});
              if (mode === 'year') setScope({mode, year: scope.mode === 'year' ? scope.year : (years[0] ?? new Date().getFullYear())});
              if (mode === 'all') setScope({mode});
            }}
          >
            {mode === 'recent' ? '最近' : mode === 'year' ? '按年' : '全部记录'}
          </button>
        ))}
      </div>
      <div className={`${styles.scopeBar} ${styles.scopeOptionBar}`} role="group" aria-label="健康数据范围选项">
        {scope.mode === 'recent' && (Object.keys(RANGE_DAYS) as RecentRange[]).map((range) => (
          <button
            key={range}
            type="button"
            className={`${styles.scopeBtn} ${scope.range === range ? styles.scopeBtnActive : ''}`}
            aria-pressed={scope.range === range}
            onClick={() => setScope({mode: 'recent', range})}
          >
            {RANGE_LABELS[range]}
          </button>
        ))}
        {scope.mode === 'year' && years.map((year) => (
          <button
            key={year}
            type="button"
            className={`${styles.scopeBtn} ${scope.mode === 'year' && scope.year === year ? styles.scopeBtnActive : ''}`}
            aria-pressed={scope.mode === 'year' && scope.year === year}
            onClick={() => setScope({mode: 'year', year})}
          >
            {year}
          </button>
        ))}
        {scope.mode === 'all' && (
          <button type="button" className={`${styles.scopeBtn} ${styles.scopeBtnActive}`} aria-pressed="true" onClick={() => setScope({mode: 'all'})}>
            全部历史
          </button>
        )}
        {loading && <span className={styles.scopeLoading} role="status" aria-live="polite">加载中…</span>}
      </div>
    </div>
  );
}

function StatsInner() {
  const {scope, data, availableMonths, loading} = useContext(YearCtx);
  if (loading) {
    return (
      <>
        <FloatingBar />
        <div className={styles.statsLoading} role="status" aria-live="polite">健康摘要加载中…</div>
      </>
    );
  }
  const dashboard = computeDashboard(data);
  const dateRange = getDateRange(data);
  const noData = !loading && scope.mode === 'year' && !(scope.year in availableMonths);

  const lastUpdated = data.lastUpdated
    ? (() => {
        const d = new Date(data.lastUpdated!);
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      })()
    : null;

  return (
    <>
      <FloatingBar />
      {!noData && dateRange && (
        <div className={styles.dateRange}>
          {dateRange}
          {lastUpdated && <span className={styles.lastUpdated}>（{lastUpdated} 更新）</span>}
        </div>
      )}
      {!noData && dashboard.length > 0 && (
        <div className={styles.dashGrid}>
          {dashboard.map((card) =><DashCardComp key={card.label} card={card} />)}
        </div>
      )}
    </>
  );
}

function LazyHealthChart({
  label,
  optionBuilder,
  data,
  axisDates,
  isDark,
  isMobile,
  selectedDate,
  onDateSelect,
}: {
  label: string;
  optionBuilder: OptionFn;
  data: HealthData;
  axisDates: string[];
  isDark: boolean;
  isMobile: boolean;
  selectedDate?: string;
  onDateSelect?: (date: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldRender, setShouldRender] = useState(false);
  const height = chartHeight(label, isMobile);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setShouldRender(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry], activeObserver) => {
        if (!entry.isIntersecting) return;
        setShouldRender(true);
        activeObserver.disconnect();
      },
      {rootMargin: '480px 0px', threshold: 0.01},
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const chartState = useMemo<{status: 'ready'; option: Record<string, unknown>} | {status: 'empty'} | null>(() => {
    if (!shouldRender) return null;
    const sourceOption = optionBuilder(isDark, data, isMobile);
    if (!optionHasData(sourceOption)) return {status: 'empty'};
    const rawOption = alignCalendarRange(
      alignDateCategoryAxes(sourceOption, axisDates),
      axisDates,
    );
    const styledOption = applyHealthChartStyle(
      addSelectedDateHighlight(
        addWeekends(addTodayLatestHighlight(rawOption, isDark), isDark),
        selectedDate,
        isDark,
      ),
      isDark,
    ) as Record<string, unknown>;
    return {status: 'ready', option: {...styledOption, animation: axisDates.length <= 90}};
  }, [axisDates, data, isDark, isMobile, optionBuilder, selectedDate, shouldRender]);

  const chartEvents = useMemo(() => {
    if (!onDateSelect || chartState?.status !== 'ready') return undefined;
    const {option} = chartState;
    return {
      click: (params: unknown) => {
        const date = extractDateFromChartEvent(params) || extractDateFromChartOption(option, params);
        if (date) onDateSelect(date);
      },
    };
  }, [chartState, onDateSelect]);

  function bindChartClick(chart: ChartLike) {
    const previous = zrenderClickHandlers.get(chart);
    if (previous) chart.getZr().off('click', previous);
    if (!onDateSelect) return;

    const handler = (params: unknown) => {
      const date = extractDateFromZrenderClick(chart, params);
      if (date) onDateSelect(date);
    };
    zrenderClickHandlers.set(chart, handler);
    chart.getZr().on('click', handler);
  }

  return (
    <div
      ref={containerRef}
      id={healthChartAnchorId(label)}
      className={styles.section}
      role="img"
      aria-label={`${label}图表${chartState?.status === 'empty' ? '，当前时间范围暂无数据' : ''}`}
    >
      <div className={styles.sectionTitle}>{label}</div>
      {chartState?.status === 'ready' ? (
        <ReactECharts
          option={chartState.option}
          theme={isDark ? 'dark' : undefined}
          style={{height}}
          opts={ECHARTS_RENDERER_OPTIONS}
          notMerge
          lazyUpdate
          onEvents={chartEvents}
          onChartReady={bindChartClick}
        />
      ) : chartState?.status === 'empty' ? (
        <div className={styles.chartEmpty} style={{height}}>当前时间范围暂无数据</div>
      ) : (
        <div className={styles.chartPlaceholder} style={{height}} aria-hidden="true" />
      )}
    </div>
  );
}

function ChartCollectionInner({charts}: {charts: Array<{label: string; opt: OptionFn}>}) {
  const {data, axisDates, loading, scope, availableMonths, onDateSelect, selectedDate} = useContext(YearCtx);
  const {colorMode} = useColorMode();
  const isDark = colorMode === 'dark';
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const handle = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    setIsMobile(media.matches);
    media.addEventListener('change', handle);
    return () => media.removeEventListener('change', handle);
  }, []);

  if (loading) {
    const reservedHeight = charts.length * (chartHeight('', isMobile) + 42) + Math.max(0, charts.length - 1) * 12;
    return <div className={styles.loading} style={{minHeight: reservedHeight}} role="status" aria-live="polite">健康图表加载中…</div>;
  }
  const noData = !hasHealthData(data);
  if (noData) {
    const label = scope.mode === 'year' && !(scope.year in availableMonths) ? `${scope.year} 年` : '当前时间范围';
    return <div className={styles.noData}>暂无 {label}健康数据</div>;
  }

  return (
    <div className={styles.wrap} aria-busy={loading}>
      {charts.map(({label, opt}: {label: string; opt: OptionFn}) => (
        <LazyHealthChart
          key={label}
          label={label}
          optionBuilder={opt}
          data={data}
          axisDates={axisDates}
          isDark={isDark}
          isMobile={isMobile}
          selectedDate={selectedDate}
          onDateSelect={onDateSelect}
        />
      ))}
    </div>
  );
}

function SectionInner({name}: {name: string}) {
  const section = SECTIONS.find((item) => item.title === name);
  return section ? <ChartCollectionInner charts={section.charts} /> : null;
}

function ChartSelectionInner({chartIds}: {chartIds: string[]}) {
  const charts = chartIds
    .map((id) => HEALTH_CHART_REGISTRY.get(id))
    .filter((chart): chart is {label: string; opt: OptionFn} => Boolean(chart));
  return charts.length ? <ChartCollectionInner charts={charts} /> : null;
}

// ── exports ───────────────────────────────────────────────────────────────────

export function HealthProvider({
  children,
  onDateSelect,
  selectedDate,
  scope,
  setScope,
}: {
  children: React.ReactNode;
  onDateSelect?: (date: string) => void;
  selectedDate?: string;
  scope?: TimeScope;
  setScope?: (scope: TimeScope) => void;
}) {
  return (
    <BrowserOnly fallback={<>{children}</>}>
      {() => (
        <HealthProviderInner onDateSelect={onDateSelect} selectedDate={selectedDate} scope={scope} setScope={setScope}>
          {children}
        </HealthProviderInner>
      )}
    </BrowserOnly>
  );
}

export function HealthStats() {
  return (
    <BrowserOnly fallback={<div style={{minHeight: 80}} />}>
      {() => <StatsInner />}
    </BrowserOnly>
  );
}

export function HealthScopeControls() {
  return (
    <BrowserOnly fallback={<div style={{minHeight: 36}} />}>
      {() => <ScopeControlsInner />}
    </BrowserOnly>
  );
}

export function HealthSection({name}: {name: string}) {
  return (
    <BrowserOnly fallback={<div style={{minHeight: 240}} />}>
      {() => <SectionInner name={name} />}
    </BrowserOnly>
  );
}

export function HealthChartSelection({chartIds}: {chartIds: string[]}) {
  return (
    <BrowserOnly fallback={<div style={{minHeight: 240}} />}>
      {() => <ChartSelectionInner chartIds={chartIds} />}
    </BrowserOnly>
  );
}

export {HealthAnalysis} from './HealthAnalysis';

export default HealthSection;
