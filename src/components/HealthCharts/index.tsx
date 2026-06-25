import React, {useContext, useEffect, useMemo, useState} from 'react';
import ReactDOM from 'react-dom';
import BrowserOnly from '@docusaurus/BrowserOnly';
import {useColorMode} from '@docusaurus/theme-common';
import ReactECharts from 'echarts-for-react';
import {transform, computeDashboard, getDateRange, filterByTimeRange, type HealthData, type DashCard} from './transform';
import {
  YEARS, RANGE_DAYS, RANGE_LABELS, EMPTY, MONTH_MAP,
  YearCtx, type RecentRange, type TimeScope, type YearCtxType,
} from './index-shared';
import styles from './styles.module.css';

export {YearCtx} from './index-shared';
export type {TimeScope, YearCtxType} from './index-shared';

type CC = {axis: string; label: string; split: string};

const HEALTH_CHART_COLORS = ['#16a34a', '#f97316', '#ef4444', '#0d9488', '#db2777', '#eab308', '#64748b'];
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

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
    ? formatMonthDayWeekday
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
  return {name, type: 'line', yAxisIndex: yIdx, data, smooth: true, symbol: 'none', lineStyle: {color, width: 1.5}};
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
  return Object.keys(data)
    .filter((key) => key !== 'lastUpdated')
    .flatMap((key) => (data[key as keyof HealthData] as unknown[])
      .map((entry) => Array.isArray(entry) && typeof entry[0] === 'string' ? entry[0] : null)
      .filter((date): date is string => Boolean(date)),
    )
    .sort();
}

function getScopeAxisDates(scope: TimeScope, data: HealthData): string[] {
  if (scope.mode === 'year') {
    return buildDateRange(`${scope.year}-01-01`, `${scope.year}-12-31`);
  }
  if (scope.mode === 'recent') {
    const end = dateKey(new Date());
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
  if (arr.length < minCount) return null;
  const vals = arr.map(([, v]) => v).sort((a, b) => a - b);
  return Math.round(vals[Math.floor(vals.length * pct)]);
}

function dynRange(arr: [string, number][], pad = 2, conv?: (v: number) => number) {
  const vals = arr.map(([, v]) => conv ? conv(v) : v);
  if (!vals.length) return {};
  return {min: Math.floor(Math.min(...vals) - pad), max: Math.ceil(Math.max(...vals) + pad)};
}

function base(isDark: boolean) {
  return {backgroundColor: 'transparent', color: HEALTH_CHART_COLORS, grid: chartGrid(16)};
}

function chartGrid(right = 16, left = 12, top = 32, bottom = 28) {
  return {top, right, bottom, left, containLabel: true};
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
        name: '步数', type: 'bar', yAxisIndex: 0, barMaxWidth: dates.length <= 14 ? 12 : dates.length <= 30 ? 10 : 6,
        itemStyle: {color: '#64748b'},
        data: stepsArr.map((v) => v === null ? null : {value: v, itemStyle: {color: stepsGoal !== null && v >= stepsGoal ? '#22c55e' : '#64748b', borderRadius: [2, 2, 0, 0]}}),
        ...(stepsGoal !== null ? {markLine: ml('#f59e0b', stepsGoal, `目标 ${stepsGoal.toLocaleString()}`)} : {}),
      },
      {
        name: '7日均', type: 'line', yAxisIndex: 0, data: r7,
        smooth: true, symbol: 'none', connectNulls: true,
        lineStyle: {color: '#f59e0b', width: 1.5},
      },
      {
        name: '距离', type: 'line', yAxisIndex: 1,
        data: b as (number | null)[],
        smooth: true, symbol: 'none', connectNulls: true,
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
      name: '运动时长', type: 'bar', barMaxWidth: 6,
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
      name: '爬楼层数', type: 'bar', barMaxWidth: 6,
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
  const vals = D.wrist_temp.map(([, v]) => v);
  const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
  return {
    ...base(isDark), ...baseTip(),
    xAxis: xCat(c, D.wrist_temp),
    yAxis: yVal(c, {unit: '°C', min: Math.floor(avg * 10 - 5) / 10, max: Math.ceil(avg * 10 + 5) / 10}),
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
        smooth: true, symbol: 'none', connectNulls: true,
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
      smooth: true, symbol: 'circle', symbolSize: 5,
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
      name: '日晒时间', type: 'bar', barMaxWidth: 6,
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
      name: 'VO₂ Max', type: 'line', data: D.vo2.map(([, v]) => v), smooth: true, symbol: 'circle', symbolSize: 5,
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
      axisLabel: {color: c.label, fontSize: 10, interval: 0, formatter: formatMonthDayWeekday},
      axisLine: {lineStyle: {color: c.axis}},
      splitLine: {lineStyle: {color: c.split}},
    },
    yAxis: {type: 'value', name: '分钟', nameTextStyle: {color: c.label, fontSize: 9}, axisLabel: {color: c.label, fontSize: 10}, splitLine: {lineStyle: {color: c.split}}},
    series: types.map((type) => ({
      name: type, type: 'scatter',
      symbolSize: (val: [string, string, number, number, number]) => Math.max(8, Math.sqrt(val[3]) * 1.4),
      data: D.workouts.filter(([, n]) => n === type).map(([date, , dur, kcal, hr]) => ({value: [date, type, dur, kcal, hr], name: type})),
      itemStyle: {color: WORKOUT_COLORS[type] ?? '#94a3b8', opacity: 0.85},
      encode: {x: 0, y: 2},
    })),
  };
}

type WorkoutItem = {name: string; dur: number; kcal: number; avgHr: number; minHr: number; maxHr: number; dist: number; steps: number; elev: number; time: string};

function workoutCalendarOpt(isDark: boolean, D: HealthData, isMobile = false) {
  const c = cc(isDark);
  const byDay = new Map<string, {mins: number; kcal: number; count: number; names: Set<string>; items: WorkoutItem[]}>();
  for (const [date, name, dur, kcal, avgHr, minHr, maxHr, dist, steps, elev, time] of D.workouts) {
    const cur = byDay.get(date) ?? {mins: 0, kcal: 0, count: 0, names: new Set<string>(), items: []};
    cur.mins += dur;
    cur.kcal += kcal;
    cur.count += 1;
    cur.names.add(name);
    cur.items.push({name, dur, kcal, avgHr, minHr, maxHr, dist, steps, elev, time});
    byDay.set(date, cur);
  }
  const dates = D.workouts.map(([d]) => d).sort();
  const start = dates[0] ?? new Date().toISOString().slice(0, 10);
  const end = dates.at(-1) ?? start;
  const values: Array<{value: [string, number]; kcal: number; count: number; names: string; items: WorkoutItem[]}> = [];
  const cur = new Date(start);
  const endDate = new Date(end);
  while (cur <= endDate) {
    const dateStr = cur.toISOString().slice(0, 10);
    const v = byDay.get(dateStr);
    values.push(v
      ? {value: [dateStr, Math.round(v.mins)], kcal: Math.round(v.kcal), count: v.count, names: [...v.names].join('、'), items: v.items}
      : {value: [dateStr, 0], kcal: 0, count: 0, names: '', items: []},
    );
    cur.setDate(cur.getDate() + 1);
  }
  const maxMins = Math.max(30, ...values.map((item) => item.value[1]));
  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      formatter: (p: {value: [string, number]; data: {items: WorkoutItem[]}}) => {
        const dateLabel = formatMonthDayWeekday(p.value[0]);
        if (!p.data.items.length) return dateLabel;
        const lines = [`<b>${dateLabel}</b>`];
        for (const w of p.data.items) {
          const parts: string[] = [`<b>${w.name}</b>`, w.time, `${Math.round(w.dur)}分钟`, `${w.kcal}kcal`];
          if (w.avgHr > 0) parts.push(`${w.avgHr}bpm${w.minHr > 0 && w.maxHr > 0 ? `(${w.minHr}~${w.maxHr})` : ''}`);
          if (w.dist > 0) parts.push(`${w.dist}km`);
          if (w.steps > 0) parts.push(`${w.steps.toLocaleString()}步`);
          if (w.elev > 0) parts.push(`↑${w.elev}m`);
          lines.push(parts.join('&nbsp;&nbsp;'));
        }
        return lines.join('<br/>');
      },
    },
    visualMap: {
      min: 0, max: maxMins, show: true, orient: 'horizontal', left: 'center', bottom: 0,
      itemWidth: 10, itemHeight: 70, textStyle: {color: c.label, fontSize: 10},
      inRange: {color: isDark ? ['#1e293b', '#16a34a'] : ['#e2e8f0', '#22c55e']},
    },
    calendar: {
      top: 22, left: 34, right: 16, bottom: 34,
      range: [start, end],
      cellSize: ['auto', isMobile ? 22 : 20],
      splitLine: {lineStyle: {color: c.split}},
      itemStyle: {borderWidth: 1, borderColor: c.split},
      yearLabel: {show: false},
      monthLabel: {color: c.label, fontSize: 10},
      dayLabel: {color: c.label, fontSize: 10, firstDay: 1, nameMap: ['日', '一', '二', '三', '四', '五', '六']},
    },
    series: [{
      name: '运动时长', type: 'heatmap', coordinateSystem: 'calendar',
      data: values,
      label: {
        show: true,
        color: c.label,
        fontSize: 8,
        lineHeight: 10,
        formatter: (p: {value: [string, number]; data: {names: string}}) => {
          const monthDay = p.value[0].slice(5, 10);
          const name = p.data.names.split('、')[0] ?? '';
          return name ? `${monthDay}\n${name}` : monthDay;
        },
      },
    }],
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

function medMonthlyOpt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  const months = D.med_monthly.map(([m]) => m.slice(5));
  return {
    ...base(isDark),
    grid: chartGrid(16),
    tooltip: {
      trigger: 'axis',
      formatter: (p: {seriesName: string; value: number; axisValue: string}[]) =>
        `${p[0]?.axisValue ?? ''}<br/>${p.map((x) => `${x.seriesName}：${x.value}%`).join('<br/>')}`,
    },
    legend: topLegend(c, ['碳酸氢钠片', '苯溴马隆片']),
    xAxis: {type: 'category', data: months, axisTick: {show: false}, axisLine: {lineStyle: {color: c.axis}}, axisLabel: {color: c.label, fontSize: 11}},
    yAxis: {type: 'value', min: 0, max: 100, axisLabel: {color: c.label, fontSize: 10, formatter: (v: number) => `${v}%`}, splitLine: {lineStyle: {color: c.split}}},
    series: [
      {
        name: '碳酸氢钠片', type: 'bar', barMaxWidth: 28, barGap: '20%',
        itemStyle: {color: '#22c55e'},
        data: D.med_monthly.map(([, nah]) => ({value: nah, itemStyle: {color: nah >= 80 ? '#22c55e' : nah >= 50 ? '#f59e0b' : '#ef4444', borderRadius: [4, 4, 0, 0]}})),
        label: {show: true, position: 'top', fontSize: 10, color: c.label, formatter: (p: {value: number}) => `${p.value}%`},
      },
      {
        name: '苯溴马隆片', type: 'bar', barMaxWidth: 28,
        itemStyle: {color: '#db2777'},
        data: D.med_monthly.map(([,, bns]) => ({value: bns, itemStyle: {color: bns >= 80 ? '#db2777' : bns >= 50 ? '#f59e0b' : '#ef4444', borderRadius: [4, 4, 0, 0]}})),
        label: {show: true, position: 'top', fontSize: 10, color: c.label, formatter: (p: {value: number}) => `${p.value}%`},
      },
    ],
  };
}

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
      axisLabel: {color: c.label, fontSize: 10, formatter: formatMonthDayWeekday},
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
  if (!selectedDate) return option;
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
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
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
  if (label === '运动日历热力图') {
    return isMobile ? 260 : 280;
  }
  return isMobile ? 200 : 240;
}

const SECTIONS = [
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
    {label: '运动日历热力图', opt: workoutCalendarOpt},
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
    {label: '月度服药依从率', opt: medMonthlyOpt},
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

type OptionFn = (isDark: boolean, D: HealthData, isMobile?: boolean) => object;

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
  })),
}));

// ── year / data context ───────────────────────────────────────────────────────

function mergeData(all: Record<string, HealthData>): HealthData {
  const keys = Object.keys(all).sort();
  if (keys.length === 0) return EMPTY;
  if (keys.length === 1) return all[keys[0]];
  const result = {} as Record<string, unknown[]>;
  for (const key of Object.keys(EMPTY) as Array<keyof HealthData>) {
    if (key === 'lastUpdated') continue;
    const merged = keys.flatMap((k) => all[k][key] as [string, ...number[]][]);
    result[key] = merged.sort((a, b) => (a[0] as string).localeCompare(b[0] as string));
  }
  // Pick the latest exportedAt across all loaded months
  const latestDate = keys.map((k) => all[k].lastUpdated).filter(Boolean).sort().at(-1) ?? null;
  return {...result, lastUpdated: latestDate} as HealthData;
}

function mergeDataByYear(all: Record<string, HealthData>, year: number, months: number[]): HealthData {
  const keys = months.map((m) => `${year}-${String(m).padStart(2, '0')}`).filter((k) => all[k]);
  if (keys.length === 0) return EMPTY;
  if (keys.length === 1) return all[keys[0]];
  const result = {} as Record<string, unknown[]>;
  for (const key of Object.keys(EMPTY) as Array<keyof HealthData>) {
    if (key === 'lastUpdated') continue;
    const merged = keys.flatMap((k) => all[k][key] as [string, ...number[]][]);
    result[key] = merged.sort((a, b) => (a[0] as string).localeCompare(b[0] as string));
  }
  const latestDate = keys.map((k) => all[k].lastUpdated).filter(Boolean).sort().at(-1) ?? null;
  return {...result, lastUpdated: latestDate} as HealthData;
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
  const [loading, setLoading] = useState(true);
  const scope = controlledScope ?? internalScope;
  const setScope = setControlledScope ?? setInternalScope;

  useEffect(() => {
    let cancelled = false;
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;

    // Determine which month keys (YYYY-MM) to load
    let targetMonthKeys: string[] = [];
    if (scope.mode === 'year') {
      targetMonthKeys = MONTH_MAP[scope.year]?.map((m) => `${scope.year}-${String(m).padStart(2, '0')}`) ?? [];
    } else if (scope.mode === 'all') {
      targetMonthKeys = Object.entries(MONTH_MAP)
        .flatMap(([y, months]) => months.map((m) => `${y}-${String(m).padStart(2, '0')}`))
        .sort();
    } else {
      // recent: walk back `range` days and collect every month key on the way
      const days = RANGE_DAYS[scope.range];
      const today = new Date();
      const start = new Date(today);
      start.setDate(start.getDate() - days);
      const keys: string[] = [];
      const cur = new Date(start.getFullYear(), start.getMonth(), 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 1);
      while (cur <= end) {
        const y = cur.getFullYear();
        const m = cur.getMonth() + 1;
        const key = `${y}-${String(m).padStart(2, '0')}`;
        if (MONTH_MAP[y]?.includes(m)) keys.push(key);
        cur.setMonth(cur.getMonth() + 1);
      }
      targetMonthKeys = keys;
    }

    const missingKeys = targetMonthKeys.filter((k) => !allData[k]);
    if (missingKeys.length === 0) {
      setLoading(false);
      return () => { cancelled = true; };
    }

    setLoading(true);
    let done = 0;
    missingKeys.forEach((key) => {
      const isCurrent = key === `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
      const [y, m] = key.split('-');
      fetch(`/data/health/${y}/${m}.json`, {
        cache: isCurrent ? 'no-store' : 'default',
      })
        .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
        .then((raw) => {
          if (cancelled) return;
          const d = transform(raw);
          setAllData((prev) => ({...prev, [key]: d}));
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled && ++done === missingKeys.length) setLoading(false);
        });
    });
    return () => { cancelled = true; };
  }, [scope]);

  const data = useMemo(() => {
    if (scope.mode === 'year') {
      const months = MONTH_MAP[scope.year] ?? [];
      const merged = mergeDataByYear(allData, scope.year, months);
      return merged;
    }
    if (scope.mode === 'all') {
      const merged = mergeData(allData);
      return merged;
    }
    // recent: merge current year data and filter
    const currentYear = new Date().getFullYear();
    const currentMonths = MONTH_MAP[currentYear] ?? [];
    const merged = mergeDataByYear(allData, currentYear, currentMonths);
    return filterByTimeRange(merged, RANGE_DAYS[scope.range]);
  }, [scope, allData]);
  const axisDates = useMemo(() => getScopeAxisDates(scope, data), [scope, data]);

  return <YearCtx.Provider value={{scope, setScope, data, axisDates, loading, availableMonths: MONTH_MAP, onDateSelect, selectedDate}}>{children}</YearCtx.Provider>;
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
  good: '#22c55e', warn: '#f59e0b', bad: '#ef4444', neutral: '#94a3b8',
};

const STATUS_LABEL: Record<string, string> = {
  good: '理想', warn: '关注', bad: '偏离', neutral: '观察',
};

const STATUS_CLASS: Record<string, string> = {
  good: styles.dashCardGood, warn: styles.dashCardWarn, bad: styles.dashCardBad, neutral: styles.dashCardNeutral,
};

function DashCardComp({card}: {card: DashCard}) {
  const color = STATUS_COLOR[card.rangeStatus];
  const changeColor = card.changeGood === true ? '#22c55e' : card.changeGood === false ? '#ef4444' : '#94a3b8';
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
  const {scope, setScope, availableMonths, loading} = useContext(YearCtx);
  const years = [...new Set(Object.keys(availableMonths).map(Number))].sort((a, b) => b - a);

  return ReactDOM.createPortal(
    <div className={styles.floatingStack}>
      <div className={styles.floatingBar}>
        {(['recent', 'year', 'all'] as const).map((mode) => (
          <button
            key={mode}
            className={`${styles.floatingBtn} ${scope.mode === mode ? styles.floatingBtnActive : ''}`}
            onClick={() => {
              if (mode === 'recent') setScope({mode, range: scope.mode === 'recent' ? scope.range : '30d'});
              if (mode === 'year') setScope({mode, year: scope.mode === 'year' ? scope.year : (years[0] ?? new Date().getFullYear())});
              if (mode === 'all') setScope({mode});
            }}
          >{mode === 'recent' ? '近况' : mode === 'year' ? '年度' : '历史'}</button>
        ))}
      </div>
      <div className={`${styles.floatingBar} ${styles.floatingOptionBar}`}>
        {scope.mode === 'recent' && (Object.keys(RANGE_DAYS) as RecentRange[]).map((r) => (
          <button
            key={r}
            className={`${styles.floatingBtn} ${scope.range === r ? styles.floatingBtnActive : ''}`}
            onClick={() => setScope({mode: 'recent', range: r})}
          >{RANGE_LABELS[r]}</button>
        ))}
        {scope.mode === 'year' && years.map((y) => (
          <button
            key={y}
            className={`${styles.floatingBtn} ${scope.year === y ? styles.floatingBtnActive : ''}`}
            onClick={() => setScope({mode: 'year', year: y})}
          >{y}</button>
        ))}
        {scope.mode === 'all' && (
          <button className={`${styles.floatingBtn} ${styles.floatingBtnActive}`} onClick={() => setScope({mode: 'all'})}>
            全部历史
          </button>
        )}
        {loading && <span className={styles.floatingLoading}>…</span>}
      </div>
    </div>,
    document.body,
  );
}

function ScopeControlsInner() {
  const {scope, setScope, availableMonths, loading} = useContext(YearCtx);
  const years = [...new Set(Object.keys(availableMonths).map(Number))].sort((a, b) => b - a);

  return (
    <div className={styles.scopeControls} aria-label="健康数据时间范围">
      <div className={styles.scopeBar}>
        {(['recent', 'year', 'all'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={`${styles.scopeBtn} ${scope.mode === mode ? styles.scopeBtnActive : ''}`}
            onClick={() => {
              if (mode === 'recent') setScope({mode, range: scope.mode === 'recent' ? scope.range : '30d'});
              if (mode === 'year') setScope({mode, year: scope.mode === 'year' ? scope.year : (years[0] ?? new Date().getFullYear())});
              if (mode === 'all') setScope({mode});
            }}
          >
            {mode === 'recent' ? '近况' : mode === 'year' ? '年度' : '历史'}
          </button>
        ))}
      </div>
      <div className={`${styles.scopeBar} ${styles.scopeOptionBar}`}>
        {scope.mode === 'recent' && (Object.keys(RANGE_DAYS) as RecentRange[]).map((range) => (
          <button
            key={range}
            type="button"
            className={`${styles.scopeBtn} ${scope.range === range ? styles.scopeBtnActive : ''}`}
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
            onClick={() => setScope({mode: 'year', year})}
          >
            {year}
          </button>
        ))}
        {scope.mode === 'all' && (
          <button type="button" className={`${styles.scopeBtn} ${styles.scopeBtnActive}`} onClick={() => setScope({mode: 'all'})}>
            全部历史
          </button>
        )}
        {loading && <span className={styles.scopeLoading}>…</span>}
      </div>
    </div>
  );
}

function StatsInner() {
  const {scope, data, availableMonths, loading} = useContext(YearCtx);
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

function SectionInner({name}: {name: string}) {
  const {data, axisDates, loading, scope, availableMonths, onDateSelect, selectedDate} = useContext(YearCtx);
  const {colorMode} = useColorMode();
  const isDark = colorMode === 'dark';
  const theme = isDark ? 'dark' : undefined;
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);

  useEffect(() => {
    const handle = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handle);
    return () => window.removeEventListener('resize', handle);
  }, []);

  const noData = !loading && scope.mode === 'year' && !(scope.year in availableMonths);
  if (noData) return <div className={styles.noData}>暂无 {scope.year} 年数据</div>;
  if (loading && data.steps.length === 0) return <div className={styles.loading}>加载中…</div>;

  const displayData = data;
  const opts = {renderer: 'svg' as const};
  const sec = SECTIONS.find((s) => s.title === name);
  if (!sec) return null;

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
    <div className={styles.wrap}>
      {sec.charts.map(({label, opt}: {label: string; opt: OptionFn}) => {
        const rawOption = alignCalendarRange(alignDateCategoryAxes(opt(isDark, displayData, isMobile), axisDates), axisDates);
        const option = applyHealthChartStyle(addSelectedDateHighlight(addWeekends(addTodayLatestHighlight(rawOption, isDark), isDark), selectedDate, isDark), isDark) as Record<string, unknown>;
        const chartEvents = onDateSelect
          ? {
              click: (params: unknown) => {
                const date = extractDateFromChartEvent(params) || extractDateFromChartOption(option, params);
                if (date) onDateSelect(date);
              },
            }
          : undefined;

        return (
          <div key={label} id={healthChartAnchorId(label)} className={styles.section}>
            <div className={styles.sectionTitle}>{label}</div>
            <ReactECharts
              option={option}
            theme={theme}
            style={{height: chartHeight(label, isMobile)}}
            opts={opts}
            onEvents={chartEvents}
            onChartReady={bindChartClick}
          />
          </div>
        );
      })}
    </div>
  );
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

export {HealthAnalysis} from './HealthAnalysis';

export default HealthSection;
