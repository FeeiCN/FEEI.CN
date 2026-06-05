import React, {createContext, useContext, useEffect, useMemo, useState} from 'react';
import ReactDOM from 'react-dom';
import BrowserOnly from '@docusaurus/BrowserOnly';
import {useColorMode} from '@docusaurus/theme-common';
import ReactECharts from 'echarts-for-react';
import {transform, computeDashboard, getDateRange, filterByTimeRange, HealthData, DashCard} from './transform';
import styles from './styles.module.css';

const YEARS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

const DAILY_STEPS_GOAL = 3000;
const DAILY_EXERCISE_GOAL = 20;
const DAILY_FLIGHTS_GOAL = 10;
const WEIGHT_GOAL_JIN = 140;
const DAILY_DAYLIGHT_GOAL = 30;

const RANGE_DAYS: Record<string, number> = {'7d': 7, '30d': 30, '90d': 90, '1y': 365};
const RANGE_LABELS: Record<string, string> = {'7d': '7天', '30d': '30天', '90d': '90天', '1y': '1年'};

type CC = {axis: string; label: string; split: string};

function cc(isDark: boolean): CC {
  return {
    axis: isDark ? '#475569' : '#cbd5e1',
    label: isDark ? '#94a3b8' : '#64748b',
    split: isDark ? 'rgba(148,163,184,0.08)' : 'rgba(148,163,184,0.18)',
  };
}

function xCat(c: CC, data: [string, number][], interval?: number) {
  const n = data.length;
  const isLong = n > 400;
  const auto = interval ?? (isLong ? Math.max(1, Math.floor(n / 14)) : 13);
  const fmt = isLong ? (v: string) => v?.slice(0, 7) ?? '' : (v: string) => v?.slice(5) ?? '';
  return {
    type: 'category',
    data: data.map(([d]) => d),
    axisTick: {show: false},
    axisLine: {lineStyle: {color: c.axis}},
    axisLabel: {color: c.label, fontSize: 10, interval: auto, formatter: fmt},
  };
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
    lineStyle: {color, type: 'dashed', width: 1},
    label: {show: true, position: 'end', formatter: label, color, fontSize: 10},
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
function dynRange(arr: [string, number][], pad = 2, conv?: (v: number) => number) {
  const vals = arr.map(([, v]) => conv ? conv(v) : v);
  if (!vals.length) return {};
  return {min: Math.floor(Math.min(...vals) - pad), max: Math.ceil(Math.max(...vals) + pad)};
}

function base(isDark: boolean) {
  return {backgroundColor: 'transparent', grid: chartGrid(16)};
}

function chartGrid(right = 16, left = 12, top = 32, bottom = 28) {
  return {top, right, bottom, left, containLabel: true};
}

function dualAxisGrid(isMobile: boolean) {
  return chartGrid(isMobile ? 16 : 52);
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
        name: '步数', type: 'bar', yAxisIndex: 0, barMaxWidth: 6,
        data: stepsArr.map((v) => v === null ? null : {value: v, itemStyle: {color: v >= DAILY_STEPS_GOAL ? '#22c55e' : '#3b82f6', borderRadius: [2, 2, 0, 0]}}),
        markLine: ml('#f59e0b', DAILY_STEPS_GOAL, `目标 ${DAILY_STEPS_GOAL}`),
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
        lineStyle: {color: '#2563eb', width: 1.5},
        areaStyle: {color: {type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [
          {offset: 0, color: 'rgba(37,99,235,0.12)'}, {offset: 1, color: 'rgba(37,99,235,0)'},
        ]}},
      },
    ],
  };
}

function exerciseOpt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  return {
    ...base(isDark), ...baseTip(),
    xAxis: xCat(c, D.exercise),
    yAxis: yVal(c, {unit: '分钟'}),
    series: [{
      name: '运动时长', type: 'bar', barMaxWidth: 6,
      data: D.exercise.map(([, v]) => ({value: v, itemStyle: {color: v >= DAILY_EXERCISE_GOAL ? '#22c55e' : '#94a3b8', borderRadius: [2, 2, 0, 0]}})),
      markLine: ml('#f59e0b', DAILY_EXERCISE_GOAL, `${DAILY_EXERCISE_GOAL} 分钟`),
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
          {...smoothLine('基础代谢', b as number[], '#7c3aed', 1), connectNulls: true},
        ],
      };
    })(),
  };
}

function flightsOpt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  return {
    ...base(isDark), ...baseTip(),
    xAxis: xCat(c, D.flights),
    yAxis: yVal(c, {unit: '层'}),
    series: [{
      name: '爬楼层数', type: 'bar', barMaxWidth: 6,
      data: D.flights.map(([, v]) => ({value: v, itemStyle: {color: v >= DAILY_FLIGHTS_GOAL ? '#22c55e' : '#0891b2', borderRadius: [2, 2, 0, 0]}})),
      markLine: ml('#f59e0b', DAILY_FLIGHTS_GOAL, `目标 ${DAILY_FLIGHTS_GOAL}`),
    }],
  };
}

function standOpt(isDark: boolean, D: HealthData, isMobile = false) {
  const c = cc(isDark);
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
          {...smoothLine('站立时间', a as number[], '#0891b2', 0), connectNulls: true},
          {...smoothLine('站立小时数', b as number[], '#22c55e', 1), connectNulls: true},
        ],
      };
    })(),
  };
}

function sleepOpt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  const dates = D.sleep.map(([d]) => d);
  const isDense = D.sleep.length > 35;
  if (isDense) {
    return {
      ...base(isDark),
      grid: chartGrid(16),
      tooltip: {
        trigger: 'axis',
        formatter: (p: {seriesName: string; value: number; axisValue: string}[]) =>
          `${p[0]?.axisValue ?? ''}<br/>${p.map((x) => `${x.seriesName}：${Number(x.value).toFixed(1)}h`).join('<br/>')}`,
      },
      legend: topLegend(c, ['总睡眠', '深睡', 'REM', '清醒']),
      xAxis: xCat(c, D.sleep.map(([d]) => [d, 0] as [string, number])),
      yAxis: yVal(c, {unit: 'h', max: 12, fmt: (v) => `${v}h`}),
      series: [
        {
          name: '总睡眠', type: 'bar', barMaxWidth: 6,
          data: D.sleep.map(([, total]) => ({value: total, itemStyle: {color: total >= 7 && total <= 9 ? '#22c55e' : total >= 6 ? '#f59e0b' : '#ef4444', borderRadius: [2, 2, 0, 0]}})),
        },
        {...smoothLine('深睡', D.sleep.map((x) => x[2]), '#1d4ed8'), connectNulls: true},
        {...smoothLine('REM', D.sleep.map((x) => x[3]), '#7c3aed'), connectNulls: true},
        {...smoothLine('清醒', D.sleep.map((x) => x[5]), '#fb923c'), connectNulls: true},
      ],
    };
  }
  return {
    ...base(isDark),
    grid: chartGrid(16, 42),
    tooltip: {
      trigger: 'axis', axisPointer: {type: 'shadow'},
      formatter: (p: {seriesName: string; value: number; axisValue: string}[]) => {
        const total = p.reduce((s, x) => s + (x.value || 0), 0);
        return `${p[0]?.axisValue ?? ''}<br/>合计：${total.toFixed(1)}h<br/>${p.filter(x => x.value > 0).map(x => `${x.seriesName}：${x.value.toFixed(1)}h`).join('<br/>')}`;
      },
    },
    legend: topLegend(c, ['深睡', 'REM', '浅睡', '清醒']),
    xAxis: {type: 'value', axisLabel: {color: c.label, fontSize: 10, formatter: (v: number) => `${v}h`}, splitLine: {lineStyle: {color: c.split}}, max: 12},
    yAxis: {type: 'category', data: dates, inverse: true, axisTick: {show: false}, axisLine: {lineStyle: {color: c.axis}}, axisLabel: {color: c.label, fontSize: 10, interval: 0, formatter: (v: string) => v?.slice(5) ?? ''}},
    series: [
      {name: '深睡', type: 'bar', stack: 'sleep', barMaxWidth: 10, data: D.sleep.map(x => x[2]), itemStyle: {color: '#1d4ed8', borderRadius: [2, 0, 0, 2]}},
      {name: 'REM', type: 'bar', stack: 'sleep', barMaxWidth: 10, data: D.sleep.map(x => x[3]), itemStyle: {color: '#7c3aed'}},
      {name: '浅睡', type: 'bar', stack: 'sleep', barMaxWidth: 10, data: D.sleep.map(x => x[4]), itemStyle: {color: '#38bdf8'}},
      {name: '清醒', type: 'bar', stack: 'sleep', barMaxWidth: 10, data: D.sleep.map(x => x[5]), itemStyle: {color: '#fb923c', borderRadius: [0, 2, 2, 0]}},
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
                return idx >= 0 && val != null ? {name: '心率预警', coord: [idx, val], itemStyle: {color: '#ef4444'}, label: {show: false}} : null;
              }).filter(Boolean),
            },
          },
          {...areaLine('HRV', b as number[], '#22c55e', 1), connectNulls: true},
        ],
      };
    })(),
  };
}

function walkingHrOpt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  return {
    ...base(isDark), ...baseTip(),
    xAxis: xCat(c, D.walking_hr),
    yAxis: yVal(c, {unit: 'bpm', ...dynRange(D.walking_hr, 3)}),
    series: [areaLine('步行平均心率', D.walking_hr.map(([, v]) => v), '#f97316')],
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
        lineStyle: {color: '#7c3aed', width: 1.5},
        markLine: ml('#ef4444', 95, '95% 警戒'),
      },
    ],
  };
}

function bodyOpt(isDark: boolean, D: HealthData, isMobile = false) {
  const c = cc(isDark);
  const wR = dynRange(D.weight, 2, (v) => v * 2);
  const fR = dynRange(D.fat, 1);
  return {
    ...base(isDark),
    grid: dualAxisGrid(isMobile),
    tooltip: {trigger: 'axis', formatter: tooltipFmt},
    legend: topLegend(c, ['体重', '体脂率']),
    ...(() => {
      const {dates, a, b} = alignTwo(D.weight, D.fat, (v) => Math.round(v * 2 * 10) / 10);
      return {
        xAxis: xCat(c, dates.map((d) => [d, 0] as [string, number])),
        yAxis: [yVal(c, {unit: '斤', ...wR, fmt: (v) => `${v}`}), yVal(c, {unit: '%', right: true, ...fR, fmt: (v) => `${v}%`})],
        series: [
          {...smoothLine('体重', a as number[], '#2563eb', 0), connectNulls: true, markLine: ml('#f59e0b', WEIGHT_GOAL_JIN, `目标 ${WEIGHT_GOAL_JIN}`)},
          {...smoothLine('体脂率', b as number[], '#f97316', 1), connectNulls: true},
        ],
      };
    })(),
  };
}

function bmiLeanOpt(isDark: boolean, D: HealthData, isMobile = false) {
  const c = cc(isDark);
  const bmiR = dynRange(D.bmi, 0.5);
  const leanR = dynRange(D.lean, 1, (v) => v * 2);
  return {
    ...base(isDark),
    grid: dualAxisGrid(isMobile),
    tooltip: {trigger: 'axis', formatter: tooltipFmt},
    legend: topLegend(c, ['BMI', '瘦体重']),
    ...(() => {
      const {dates, a, b} = alignTwo(D.bmi, D.lean, undefined, (v) => Math.round(v * 2 * 10) / 10);
      return {
        xAxis: xCat(c, dates.map((d) => [d, 0] as [string, number])),
        yAxis: [yVal(c, {unit: '', ...bmiR, fmt: (v) => `${v}`}), yVal(c, {unit: '斤', right: true, ...leanR, fmt: (v) => `${v}斤`})],
        series: [
          {...smoothLine('BMI', a as number[], '#7c3aed', 0), connectNulls: true},
          {...smoothLine('瘦体重', b as number[], '#0891b2', 1), connectNulls: true},
        ],
      };
    })(),
  };
}

function walkQualityOpt(isDark: boolean, D: HealthData, isMobile = false) {
  const c = cc(isDark);
  return {
    ...base(isDark),
    grid: dualAxisGrid(isMobile),
    tooltip: {trigger: 'axis', formatter: tooltipFmt},
    legend: topLegend(c, ['步行速度', '步长']),
    ...(() => {
      const {dates, a, b} = alignTwo(D.walk_speed, D.step_length);
      return {
        xAxis: xCat(c, dates.map((d) => [d, 0] as [string, number])),
        yAxis: [yVal(c, {unit: 'km/h', ...dynRange(D.walk_speed, 0.3), fmt: (v) => `${v}`}), yVal(c, {unit: 'cm', right: true, ...dynRange(D.step_length, 2), fmt: (v) => `${v}`})],
        series: [
          {...smoothLine('步行速度', a as number[], '#22c55e', 0), connectNulls: true},
          {...smoothLine('步长', b as number[], '#f97316', 1), connectNulls: true},
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
          {...smoothLine('双支撑时间占比', b as number[], '#7c3aed', 1), connectNulls: true},
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
          {...smoothLine('下楼梯速度', b as number[], '#0891b2', 1), connectNulls: true},
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
        data: D.audio_hp.map(([, v]) => v), itemStyle: {color: '#7c3aed'},
      },
    ],
  };
}

function daylightOpt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  return {
    ...base(isDark), ...baseTip(),
    xAxis: xCat(c, D.daylight, 5),
    yAxis: yVal(c, {unit: '分钟', min: 0, fmt: (v) => `${v}m`}),
    series: [{
      name: '日晒时间', type: 'bar', barMaxWidth: 6,
      data: D.daylight.map(([, v]) => ({value: v, itemStyle: {color: v >= DAILY_DAYLIGHT_GOAL ? '#f59e0b' : '#94a3b8', borderRadius: [2, 2, 0, 0]}})),
      markLine: ml('#f59e0b', DAILY_DAYLIGHT_GOAL, `目标 ${DAILY_DAYLIGHT_GOAL} 分钟`),
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
      data: D.mindful.map(([, v]) => v), itemStyle: {color: '#7c3aed'},
      label: {show: true, position: 'top', fontSize: 9, color: c.label, formatter: (p: {value: number}) => `${p.value}m`},
    }],
  };
}

function handwashOpt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  return {
    ...base(isDark), ...baseTip(),
    xAxis: xCat(c, D.handwash),
    yAxis: yVal(c, {unit: '秒', min: 0, fmt: (v) => `${v}s`}),
    series: [areaLine('洗手时长', D.handwash.map(([, v]) => v), '#22c55e')],
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
  return {
    ...base(isDark),
    grid: chartGrid(16),
    legend: scrollLegend(c, types),
    tooltip: {
      trigger: 'item',
      formatter: (p: {value: [string, number, number, number, number, number]}) => {
        const [date, , dur, kcal, hr] = p.value;
        return `${date}<br/>${p.value[1]}<br/>时长：${dur} 分钟<br/>消耗：${kcal} kcal<br/>心率：${hr} bpm`;
      },
    },
    xAxis: {type: 'time', axisLabel: {color: c.label, fontSize: 10, formatter: (v: number) => new Date(v).toISOString().slice(5, 10)}, axisLine: {lineStyle: {color: c.axis}}, splitLine: {lineStyle: {color: c.split}}},
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
        if (!p.data.items.length) return p.value[0];
        const lines = [`<b>${p.value[0]}</b>`];
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
    grid: chartGrid(60, 12, 32, 8),
    tooltip: {
      trigger: 'axis', axisPointer: {type: 'shadow'},
      formatter: (p: {name: string; seriesName: string; value: number}[]) => {
        const name = p[0]?.name ?? '';
        const t = totals[name];
        return `${name}<br/>次数：${t.sessions} 次<br/>总时长：${t.mins.toFixed(0)} 分钟<br/>总消耗：${t.kcal.toFixed(0)} kcal`;
      },
    },
    legend: topLegend(c, ['总时长', '次数']),
    xAxis: {type: 'value', axisLabel: {color: c.label, fontSize: 10}, splitLine: {lineStyle: {color: c.split}}},
    yAxis: {type: 'category', data: sorted.map(([n]) => n), axisLabel: {color: c.label, fontSize: 11}, axisTick: {show: false}, axisLine: {show: false}},
    series: [
      {
        name: '总时长', type: 'bar', barMaxWidth: 16,
        data: sorted.map(([n]) => ({value: Math.round(totals[n].mins), itemStyle: {color: WORKOUT_COLORS[n] ?? '#94a3b8', borderRadius: [0, 4, 4, 0]}})),
        label: {show: true, position: 'right', fontSize: 10, color: c.label, formatter: (p: {value: number}) => `${p.value}m`},
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
        data: D.med_monthly.map(([, nah]) => ({value: nah, itemStyle: {color: nah >= 80 ? '#22c55e' : nah >= 50 ? '#f59e0b' : '#ef4444', borderRadius: [4, 4, 0, 0]}})),
        label: {show: true, position: 'top', fontSize: 10, color: c.label, formatter: (p: {value: number}) => `${p.value}%`},
      },
      {
        name: '苯溴马隆片', type: 'bar', barMaxWidth: 28,
        data: D.med_monthly.map(([,, bns]) => ({value: bns, itemStyle: {color: bns >= 80 ? '#0891b2' : bns >= 50 ? '#f59e0b' : '#ef4444', borderRadius: [4, 4, 0, 0]}})),
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
  content: '满足', happy: '快乐', hopeful: '充满希望', stressed: '有压力',
  satisfied: '满意', amused: '开心', anxious: '焦虑', peaceful: '平静',
  worried: '忧虑', frustrated: '沮丧', annoyed: '烦恼', hopeless: '绝望',
  irritated: '易怒', relieved: '如释重负',
};
const ASSOC_ZH: Record<string, string> = {
  work: '工作', health: '健康', partner: '伴侣', family: '家人',
  fitness: '健身', hobbies: '爱好', tasks: '任务', weather: '天气', money: '金钱',
};

function translateList(str: string, map: Record<string, string>) {
  return str.split(',').map((s) => map[s] ?? s).join('、');
}

function stateOfMindOpt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  const clsList = ['very_pleasant','pleasant','slightly_pleasant','neutral','slightly_unpleasant','unpleasant','very_unpleasant'];
  return {
    backgroundColor: 'transparent',
    grid: chartGrid(16, 40),
    legend: topLegend(c, Object.entries(KIND_ZH).map(([, v]) => v)),
    tooltip: {
      trigger: 'item',
      formatter: (p: {value: [string, number, string, string, string]}) => {
        const [date, val,, labs, assoc] = p.value;
        return `${date}<br/>愉悦度：${val > 0 ? '+' : ''}${val.toFixed(2)}<br/>标签：${labs ? translateList(labs, LABEL_ZH) : '—'}<br/>关联：${assoc ? translateList(assoc, ASSOC_ZH) : '—'}`;
      },
    },
    xAxis: {
      type: 'time',
      axisLabel: {color: c.label, fontSize: 10, formatter: (v: number) => new Date(v).toISOString().slice(5, 10)},
      axisLine: {lineStyle: {color: c.axis}}, splitLine: {lineStyle: {color: c.split}},
    },
    yAxis: {
      type: 'value', min: -1, max: 1,
      axisLabel: {color: c.label, fontSize: 10, formatter: (v: number) => v > 0 ? `+${v}` : String(v)},
      splitLine: {lineStyle: {color: c.split}},
      markLine: {silent: true, symbol: 'none', lineStyle: {color: c.axis, type: 'dashed', width: 1}, data: [{yAxis: 0}], label: {show: false}},
    },
    visualMap: {show: false, dimension: 1, pieces: clsList.map((cls, i) => {
      const borders = [-1, -0.6, -0.2, -0.01, 0.01, 0.2, 0.6, 1];
      return {gte: borders[i], lte: borders[i+1], color: VALENCE_COLOR[cls]};
    })},
    series: Object.entries(KIND_ZH).map(([kind, label]) => ({
      name: label, type: 'scatter', symbolSize: 12,
      symbol: kind === 'daily' ? 'circle' : 'diamond',
      data: D.state_of_mind.filter(([,, k]) => k === kind).map(([date, val,, labs, assoc]) => ({
        value: [date, val, kind, labs, assoc],
        name: label,
      })),
      label: {
        show: true, position: 'top', fontSize: 9, color: c.label,
        formatter: (p: {value: [string, number, string, string]}) => {
          const first = p.value[3]?.split(',')[0] ?? '';
          return LABEL_ZH[first] ?? first;
        },
      },
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

// ── layout ───────────────────────────────────────────────────────────────────

function chartHeight(label: string, isMobile: boolean) {
  if (label === '运动日历热力图') {
    return isMobile ? 260 : 280;
  }
  return isMobile ? 200 : 240;
}

const SECTIONS = [
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
    {label: '步行平均心率', opt: walkingHrOpt},
    {label: '心肺恢复速率', opt: cardioRecoveryOpt},
    {label: '呼吸频率 & 血氧饱和度', opt: respSpo2Opt},
    {label: '最大摄氧量 VO₂ Max', opt: vo2Opt},
  ]},
  {title: '体成分', charts: [
    {label: '体重 & 体脂率', opt: bodyOpt},
    {label: 'BMI & 瘦体重', opt: bmiLeanOpt},
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

// ── year / data context ───────────────────────────────────────────────────────

const EMPTY: HealthData = {
  steps:[], distance:[], exercise:[], energy_active:[], energy_basal:[],
  flights:[], stand_time:[], stand_hour:[], sleep:[], wrist_temp:[],
  rhr:[], hrv:[], walking_hr:[], resp_rate:[], spo2:[], weight:[],
  fat:[], bmi:[], lean:[], walk_speed:[], step_length:[], asym:[],
  double_supp:[], stair_up:[], stair_down:[], six_min_walk:[],
  audio_env:[], audio_hp:[], daylight:[], mindful:[], handwash:[],
  physical_effort:[], cardio_recovery:[], vo2:[], workouts:[],
  nah_daily:[], bns_daily:[], med_monthly:[], state_of_mind:[], hr_notifications:[],
};

function mergeData(all: Record<number, HealthData>): HealthData {
  const years = Object.keys(all).map(Number).sort();
  if (years.length === 0) return EMPTY;
  if (years.length === 1) return all[years[0]];
  const result = {} as Record<string, unknown[]>;
  for (const key of Object.keys(EMPTY) as Array<keyof HealthData>) {
    const merged = years.flatMap((y) => all[y][key] as [string, ...number[]][]);
    result[key] = merged.sort((a, b) => (a[0] as string).localeCompare(b[0] as string));
  }
  return result as unknown as HealthData;
}

type YearCtxType = {
  selectedYear: number | null;
  setYear: (y: number | null) => void;
  data: HealthData;
  loading: boolean;
  availableYears: number[];
  timeRange: string;
  setTimeRange: (r: string) => void;
};
const YearCtx = createContext<YearCtxType>({
  selectedYear: 2026, setYear: () => {}, data: EMPTY, loading: true, availableYears: [],
  timeRange: '30d', setTimeRange: () => {},
});

function HealthProviderInner({children}: {children: React.ReactNode}) {
  const [selectedYear, setSelectedYear] = useState<number | null>(2026);
  const [allData, setAllData] = useState<Record<number, HealthData>>({});
  const [loading, setLoading] = useState(true);
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [timeRange, setTimeRange] = useState('30d');

  useEffect(() => {
    let done = 0;
    YEARS.forEach((y) => {
      fetch(`/health/health_data_${y}.json`)
        .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
        .then((raw) => {
          const d = transform(raw);
          setAllData((prev) => ({...prev, [y]: d}));
          setAvailableYears((prev) => Array.from(new Set([...prev, y])).sort((a, b) => a - b));
        })
        .catch(() => {})
        .finally(() => { if (++done === YEARS.length) setLoading(false); });
    });
  }, []);

  const data = useMemo(
    () => selectedYear === null ? mergeData(allData) : (allData[selectedYear] ?? EMPTY),
    [selectedYear, allData],
  );

  const setYear = (y: number | null) => setSelectedYear(y);

  return <YearCtx.Provider value={{selectedYear, setYear, data, loading, availableYears, timeRange, setTimeRange}}>{children}</YearCtx.Provider>;
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
  const {selectedYear, setYear, availableYears, timeRange, setTimeRange, loading} = useContext(YearCtx);

  const handleSetYear = (y: number | null) => {
    setYear(y);
    setTimeRange(y !== null ? '1y' : '30d');
  };

  return ReactDOM.createPortal(
    <div className={styles.floatingStack}>
      <div className={styles.floatingBar}>
        {(['7d', '30d', '90d', '1y'] as const).map((r) => (
          <button
            key={r}
            className={`${styles.floatingBtn} ${r === timeRange ? styles.floatingBtnActive : ''}`}
            onClick={() => setTimeRange(r)}
          >{RANGE_LABELS[r]}</button>
        ))}
      </div>
      <div className={styles.floatingBar}>
        <button
          className={`${styles.floatingBtn} ${selectedYear === null ? styles.floatingBtnActive : ''}`}
          onClick={() => handleSetYear(null)}
        >全部</button>
        {availableYears.map((y) => (
          <button
            key={y}
            className={`${styles.floatingBtn} ${y === selectedYear ? styles.floatingBtnActive : ''}`}
            onClick={() => handleSetYear(y)}
          >{y}</button>
        ))}
        {loading && <span className={styles.floatingLoading}>…</span>}
      </div>
    </div>,
    document.body,
  );
}

function StatsInner() {
  const {selectedYear, data, availableYears, loading} = useContext(YearCtx);
  const dashboard = computeDashboard(data);
  const dateRange = getDateRange(data);
  const noData = !loading && selectedYear !== null && !availableYears.includes(selectedYear);
  return (
    <>
      <FloatingBar />
      {!noData && dateRange && <div className={styles.dateRange}>{dateRange}</div>}
      {!noData && dashboard.length > 0 && (
        <div className={styles.dashGrid}>
          {dashboard.map((card) => <DashCardComp key={card.label} card={card} />)}
        </div>
      )}
    </>
  );
}

function SectionInner({name}: {name: string}) {
  const {data, loading, selectedYear, availableYears, timeRange} = useContext(YearCtx);
  const {colorMode} = useColorMode();
  const isDark = colorMode === 'dark';
  const theme = isDark ? 'dark' : undefined;
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);

  useEffect(() => {
    const handle = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handle);
    return () => window.removeEventListener('resize', handle);
  }, []);

  const noData = !loading && selectedYear !== null && !availableYears.includes(selectedYear);
  if (noData) return <div className={styles.noData}>暂无 {selectedYear} 年数据</div>;
  if (loading && data.steps.length === 0) return <div className={styles.loading}>加载中…</div>;

  const displayData = RANGE_DAYS[timeRange] ? filterByTimeRange(data, RANGE_DAYS[timeRange]) : data;
  const opts = {renderer: 'svg' as const};
  const sec = SECTIONS.find((s) => s.title === name);
  if (!sec) return null;

  return (
    <div className={styles.wrap}>
      {sec.charts.map(({label, opt}: {label: string; opt: OptionFn}) => (
        <div key={label} className={styles.section}>
          <div className={styles.sectionTitle}>{label}</div>
          <ReactECharts option={addWeekends(opt(isDark, displayData, isMobile), isDark)} theme={theme} style={{height: chartHeight(label, isMobile)}} opts={opts} />
        </div>
      ))}
    </div>
  );
}

// ── exports ───────────────────────────────────────────────────────────────────

export function HealthProvider({children}: {children: React.ReactNode}) {
  return (
    <BrowserOnly fallback={<>{children}</>}>
      {() => <HealthProviderInner>{children}</HealthProviderInner>}
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

export function HealthSection({name}: {name: string}) {
  return (
    <BrowserOnly fallback={<div style={{minHeight: 240}} />}>
      {() => <SectionInner name={name} />}
    </BrowserOnly>
  );
}

export default HealthSection;
