import React, {createContext, useContext, useEffect, useMemo, useState} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import {useColorMode} from '@docusaurus/theme-common';
import ReactECharts from 'echarts-for-react';
import {D as DEFAULT_DATA} from './data';
import {transform, computeStats, getDateRange, HealthData, StatStatus} from './transform';
import styles from './styles.module.css';

const YEARS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];

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
  const fmt = isLong ? (v: string) => v.slice(0, 7) : (v: string) => v.slice(5);
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
  const fmt = n > 50 ? (v: string) => v.slice(0, 7) : (v: string) => v.slice(5);
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
  return {backgroundColor: 'transparent', grid: {top: 32, right: 16, bottom: 28, left: 12, containLabel: true}};
}

function baseTip() {
  return {tooltip: {trigger: 'axis', formatter: tooltipFmt}};
}

// ── chart option builders ────────────────────────────────────────────────────

function stepsOpt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  return {
    ...base(isDark), ...baseTip(),
    legend: {data: ['步数', '7日均线'], top: 0, right: 0, textStyle: {fontSize: 11, color: c.label}, itemHeight: 8},
    xAxis: xCat(c, D.steps),
    yAxis: yVal(c, {unit: '步', fmt: (v) => v >= 1000 ? `${v / 1000}k` : String(v)}),
    series: [
      {
        name: '步数', type: 'bar', barMaxWidth: 6,
        data: D.steps.map(([, v]) => ({value: v, itemStyle: {color: v >= 8000 ? '#22c55e' : '#3b82f6', borderRadius: [2, 2, 0, 0]}})),
        markLine: ml('#f59e0b', 8000, '目标 8000'),
      },
      {name: '7日均线', type: 'line', data: rolling7(D.steps), smooth: true, symbol: 'none', lineStyle: {color: '#f59e0b', width: 1.5}},
    ],
  };
}

function distanceOpt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  return {
    ...base(isDark), ...baseTip(),
    xAxis: xCat(c, D.distance),
    yAxis: yVal(c, {unit: 'km', fmt: (v) => `${v}`}),
    series: [areaLine('步行距离', D.distance.map(([, v]) => v), '#2563eb')],
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
      data: D.exercise.map(([, v]) => ({value: v, itemStyle: {color: v >= 30 ? '#22c55e' : '#94a3b8', borderRadius: [2, 2, 0, 0]}})),
      markLine: ml('#f59e0b', 30, '30 分钟'),
    }],
  };
}

function energyOpt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  return {
    ...base(isDark),
    grid: {top: 32, right: 52, bottom: 28, left: 12, containLabel: true},
    tooltip: {trigger: 'axis', formatter: tooltipFmt},
    legend: {data: ['活跃热量', '基础代谢'], top: 0, right: 0, textStyle: {fontSize: 11, color: c.label}, itemHeight: 8},
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
      data: D.flights.map(([, v]) => ({value: v, itemStyle: {color: '#0891b2', borderRadius: [2, 2, 0, 0]}})),
    }],
  };
}

function standOpt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  return {
    ...base(isDark),
    grid: {top: 32, right: 52, bottom: 28, left: 12, containLabel: true},
    tooltip: {trigger: 'axis', formatter: tooltipFmt},
    legend: {data: ['站立时间', '站立小时数'], top: 0, right: 0, textStyle: {fontSize: 11, color: c.label}, itemHeight: 8},
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
  return {
    ...base(isDark),
    tooltip: {
      trigger: 'axis', axisPointer: {type: 'shadow'},
      formatter: (p: {seriesName: string; value: number; axisValue: string}[]) => {
        const total = p.reduce((s, x) => s + (x.value || 0), 0);
        return `${p[0]?.axisValue ?? ''}<br/>合计：${total.toFixed(1)}h<br/>${p.filter(x => x.value > 0).map(x => `${x.seriesName}：${x.value.toFixed(1)}h`).join('<br/>')}`;
      },
    },
    legend: {data: ['深睡', 'REM', '浅睡', '清醒'], top: 0, right: 0, textStyle: {fontSize: 11, color: c.label}, itemHeight: 8},
    xAxis: {type: 'category', data: dates, axisTick: {show: false}, axisLine: {lineStyle: {color: c.axis}}, axisLabel: {color: c.label, fontSize: 10, interval: 13, formatter: (v: string) => v.slice(5)}},
    yAxis: {type: 'value', axisLabel: {color: c.label, fontSize: 10, formatter: (v: number) => `${v}h`}, splitLine: {lineStyle: {color: c.split}}, max: 12},
    series: [
      {name: '深睡', type: 'bar', stack: 'sleep', barMaxWidth: 8, data: D.sleep.map(x => x[2]), itemStyle: {color: '#1d4ed8'}},
      {name: 'REM', type: 'bar', stack: 'sleep', barMaxWidth: 8, data: D.sleep.map(x => x[3]), itemStyle: {color: '#7c3aed'}},
      {name: '浅睡', type: 'bar', stack: 'sleep', barMaxWidth: 8, data: D.sleep.map(x => x[4]), itemStyle: {color: '#38bdf8'}},
      {name: '清醒', type: 'bar', stack: 'sleep', barMaxWidth: 8, data: D.sleep.map(x => x[5]), itemStyle: {color: '#fb923c', borderRadius: [2, 2, 0, 0]}},
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

function heartOpt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  const rhrR = dynRange(D.rhr, 3);
  const hrvR = dynRange(D.hrv, 5);
  return {
    ...base(isDark),
    grid: {top: 32, right: 52, bottom: 28, left: 12, containLabel: true},
    tooltip: {trigger: 'axis', formatter: tooltipFmt},
    legend: {data: ['静息心率', 'HRV'], top: 0, right: 0, textStyle: {fontSize: 11, color: c.label}, itemHeight: 8},
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
    grid: {top: 32, right: 16, bottom: 28, left: 40, containLabel: true},
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

function respOpt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  return {
    ...base(isDark), ...baseTip(),
    xAxis: xCat(c, D.resp_rate),
    yAxis: yVal(c, {unit: '次/分', ...dynRange(D.resp_rate, 1)}),
    series: [areaLine('呼吸频率', D.resp_rate.map(([, v]) => v), '#0891b2')],
  };
}

function spo2Opt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  const r = dynRange(D.spo2, 0.5);
  return {
    ...base(isDark), ...baseTip(),
    xAxis: xCat(c, D.spo2),
    yAxis: yVal(c, {unit: '%', ...r, fmt: (v) => `${v}%`}),
    series: [{
      name: '血氧', type: 'line', data: D.spo2.map(([, v]) => v), smooth: false, symbol: 'none',
      lineStyle: {color: '#0891b2', width: 1.5},
      markLine: ml('#ef4444', 95, '95% 警戒'),
    }],
  };
}

function bodyOpt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  const wR = dynRange(D.weight, 2, (v) => v * 2);
  const fR = dynRange(D.fat, 1);
  return {
    ...base(isDark),
    grid: {top: 32, right: 52, bottom: 28, left: 12, containLabel: true},
    tooltip: {trigger: 'axis', formatter: tooltipFmt},
    legend: {data: ['体重', '体脂率'], top: 0, right: 0, textStyle: {fontSize: 11, color: c.label}, itemHeight: 8},
    ...(() => {
      const {dates, a, b} = alignTwo(D.weight, D.fat, (v) => Math.round(v * 2 * 10) / 10);
      return {
        xAxis: xCat(c, dates.map((d) => [d, 0] as [string, number])),
        yAxis: [yVal(c, {unit: '斤', ...wR, fmt: (v) => `${v}`}), yVal(c, {unit: '%', right: true, ...fR, fmt: (v) => `${v}%`})],
        series: [
          {...smoothLine('体重', a as number[], '#2563eb', 0), connectNulls: true},
          {...smoothLine('体脂率', b as number[], '#f97316', 1), connectNulls: true},
        ],
      };
    })(),
  };
}

function bmiLeanOpt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  const bmiR = dynRange(D.bmi, 0.5);
  const leanR = dynRange(D.lean, 1, (v) => v * 2);
  return {
    ...base(isDark),
    grid: {top: 32, right: 52, bottom: 28, left: 12, containLabel: true},
    tooltip: {trigger: 'axis', formatter: tooltipFmt},
    legend: {data: ['BMI', '瘦体重'], top: 0, right: 0, textStyle: {fontSize: 11, color: c.label}, itemHeight: 8},
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

function walkQualityOpt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  return {
    ...base(isDark),
    grid: {top: 32, right: 52, bottom: 28, left: 12, containLabel: true},
    tooltip: {trigger: 'axis', formatter: tooltipFmt},
    legend: {data: ['步行速度', '步长'], top: 0, right: 0, textStyle: {fontSize: 11, color: c.label}, itemHeight: 8},
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

function gaitOpt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  return {
    ...base(isDark),
    grid: {top: 32, right: 52, bottom: 28, left: 12, containLabel: true},
    tooltip: {trigger: 'axis', formatter: tooltipFmt},
    legend: {data: ['步态不对称性', '双支撑时间占比'], top: 0, right: 0, textStyle: {fontSize: 11, color: c.label}, itemHeight: 8},
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

function stairOpt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  return {
    ...base(isDark),
    grid: {top: 32, right: 52, bottom: 28, left: 12, containLabel: true},
    tooltip: {trigger: 'axis', formatter: tooltipFmt},
    legend: {data: ['上楼梯速度', '下楼梯速度'], top: 0, right: 0, textStyle: {fontSize: 11, color: c.label}, itemHeight: 8},
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
    grid: {top: 32, right: 16, bottom: 28, left: 40, containLabel: true},
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

function audioOpt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  return {
    ...base(isDark),
    grid: {top: 32, right: 52, bottom: 28, left: 12, containLabel: true},
    tooltip: {trigger: 'axis', formatter: tooltipFmt},
    legend: {data: ['环境音量', '耳机音量'], top: 0, right: 0, textStyle: {fontSize: 11, color: c.label}, itemHeight: 8},
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
      data: D.daylight.map(([, v]) => ({value: v, itemStyle: {color: v >= 30 ? '#f59e0b' : '#94a3b8', borderRadius: [2, 2, 0, 0]}})),
      markLine: ml('#f59e0b', 30, '建议 30 分钟'),
    }],
  };
}

function mindfulOpt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  return {
    ...base(isDark),
    grid: {top: 32, right: 16, bottom: 28, left: 40, containLabel: true},
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
    grid: {top: 32, right: 16, bottom: 28, left: 40, containLabel: true},
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
  '户外 步行': '#22c55e', '室内 步行': '#86efac',
  '划船': '#0891b2', '羽毛球': '#f97316',
  '室内 骑行': '#ef4444', '室内 跑步': '#f59e0b', '核心训练': '#94a3b8',
};

function workoutTimelineOpt(isDark: boolean, D: HealthData) {
  const c = cc(isDark);
  const types = [...new Set(D.workouts.map(([, n]) => n))];
  return {
    ...base(isDark),
    grid: {top: 32, right: 16, bottom: 28, left: 12, containLabel: true},
    legend: {data: types, top: 0, right: 0, textStyle: {fontSize: 11, color: c.label}, itemHeight: 8},
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
    grid: {top: 32, right: 60, bottom: 8, left: 12, containLabel: true},
    tooltip: {
      trigger: 'axis', axisPointer: {type: 'shadow'},
      formatter: (p: {name: string; seriesName: string; value: number}[]) => {
        const name = p[0]?.name ?? '';
        const t = totals[name];
        return `${name}<br/>次数：${t.sessions} 次<br/>总时长：${t.mins.toFixed(0)} 分钟<br/>总消耗：${t.kcal.toFixed(0)} kcal`;
      },
    },
    legend: {data: ['总时长', '次数'], top: 0, right: 0, textStyle: {fontSize: 11, color: c.label}, itemHeight: 8},
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
    grid: {top: 32, right: 16, bottom: 28, left: 12, containLabel: true},
    tooltip: {
      trigger: 'axis',
      formatter: (p: {seriesName: string; value: number; axisValue: string}[]) =>
        `${p[0]?.axisValue ?? ''}<br/>${p.map((x) => `${x.seriesName}：${x.value}%`).join('<br/>')}`,
    },
    legend: {data: ['碳酸氢钠片', '苯溴马隆片'], top: 0, right: 0, textStyle: {fontSize: 11, color: c.label}, itemHeight: 8},
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

function medDailyOpt(isDark: boolean, D: HealthData, drug: '碳酸氢钠片' | '苯溴马隆片') {
  const c = cc(isDark);
  const data = drug === '碳酸氢钠片' ? D.nah_daily : D.bns_daily;
  const maxDose = drug === '碳酸氢钠片' ? 3 : 1;
  const color = drug === '碳酸氢钠片' ? '#22c55e' : '#0891b2';
  return {
    ...base(isDark),
    grid: {top: 16, right: 16, bottom: 28, left: 12, containLabel: true},
    tooltip: {
      trigger: 'axis',
      formatter: (p: {axisValue: string; value: number}[]) => `${p[0]?.axisValue ?? ''}<br/>${drug}：${p[0]?.value}/${maxDose}`,
    },
    xAxis: {
      type: 'category', data: data.map(([d]) => d),
      axisTick: {show: false}, axisLine: {lineStyle: {color: c.axis}},
      axisLabel: {color: c.label, fontSize: 10, interval: 13, formatter: (v: string) => v.slice(5)},
    },
    yAxis: {type: 'value', min: 0, max: maxDose, axisLabel: {color: c.label, fontSize: 10}, splitLine: {lineStyle: {color: c.split}}, interval: 1},
    series: [{
      name: drug, type: 'bar', barMaxWidth: 6,
      data: data.map(([, taken, total]) => ({
        value: taken,
        itemStyle: {color: taken === total ? color : taken > 0 ? '#f59e0b' : '#ef4444', borderRadius: [2, 2, 0, 0]},
      })),
    }],
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
    grid: {top: 32, right: 16, bottom: 28, left: 40, containLabel: true},
    legend: {
      data: Object.entries(KIND_ZH).map(([, v]) => v),
      top: 0, right: 0, textStyle: {fontSize: 11, color: c.label}, itemHeight: 8,
    },
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

// ── layout ───────────────────────────────────────────────────────────────────

const SECTIONS = [
  {title: '活动', charts: [
    {label: '每日步数', opt: stepsOpt},
    {label: '步行跑步距离', opt: distanceOpt},
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
    {label: '步行平均心率', opt: walkingHrOpt},
    {label: '心肺恢复速率', opt: cardioRecoveryOpt},
    {label: '呼吸频率', opt: respOpt},
    {label: '血氧饱和度', opt: spo2Opt},
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
    {label: '碳酸氢钠片·每日服用', opt: (d: boolean, D: HealthData) => medDailyOpt(d, D, '碳酸氢钠片')},
    {label: '苯溴马隆片·每日服用', opt: (d: boolean, D: HealthData) => medDailyOpt(d, D, '苯溴马隆片')},
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

type OptionFn = (isDark: boolean, D: HealthData) => object;

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
};
const YearCtx = createContext<YearCtxType>({
  selectedYear: null, setYear: () => {}, data: DEFAULT_DATA, loading: true, availableYears: [2026],
});

function HealthProviderInner({children}: {children: React.ReactNode}) {
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [allData, setAllData] = useState<Record<number, HealthData>>({2026: DEFAULT_DATA});
  const [loading, setLoading] = useState(true);
  const [availableYears, setAvailableYears] = useState<number[]>([2026]);

  useEffect(() => {
    const others = YEARS.filter((y) => y !== 2026);
    let done = 0;
    if (others.length === 0) { setLoading(false); return; }
    others.forEach((y) => {
      fetch(`/health/health_data_${y}.json`)
        .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
        .then((raw) => {
          const d = transform(raw);
          setAllData((prev) => ({...prev, [y]: d}));
          setAvailableYears((prev) => [...prev, y].sort((a, b) => a - b));
        })
        .catch(() => {})
        .finally(() => { if (++done === others.length) setLoading(false); });
    });
  }, []);

  const data = useMemo(
    () => selectedYear === null ? mergeData(allData) : (allData[selectedYear] ?? EMPTY),
    [selectedYear, allData],
  );

  const setYear = (y: number | null) => setSelectedYear(y);

  return <YearCtx.Provider value={{selectedYear, setYear, data, loading, availableYears}}>{children}</YearCtx.Provider>;
}

// ── inner components ──────────────────────────────────────────────────────────

const DOT_CLASS: Record<StatStatus, string> = {
  good: styles.statDotGood, warn: styles.statDotWarn,
  bad: styles.statDotBad, neutral: styles.statDotNeutral,
};

function StatsInner() {
  const {selectedYear, setYear, data, loading, availableYears} = useContext(YearCtx);
  const stats = computeStats(data);
  const dateRange = getDateRange(data);
  const noData = selectedYear !== null && !availableYears.includes(selectedYear);
  return (
    <>
      <div className={styles.yearRow}>
        <button
          className={`${styles.yearBtn} ${selectedYear === null ? styles.yearBtnActive : ''}`}
          onClick={() => setYear(null)}
        >全部</button>
        {availableYears.map((y) => (
          <button
            key={y}
            className={`${styles.yearBtn} ${y === selectedYear ? styles.yearBtnActive : ''}`}
            onClick={() => setYear(y)}
          >{y}</button>
        ))}
        {YEARS.filter((y) => !availableYears.includes(y)).map((y) => (
          <button key={y} className={styles.yearBtn} style={{opacity: 0.35, cursor: 'default'}}>{y}</button>
        ))}
        {loading && <span style={{fontSize: '0.8rem', color: '#94a3b8', marginLeft: 4}}>加载中…</span>}
      </div>
      {!noData && dateRange && (
        <div className={styles.dateRange}>{dateRange}</div>
      )}
      {!noData && (
        <div className={styles.stats}>
          {stats.map((s) => (
            <div key={s.l} className={styles.statCard}>
              <div className={styles.statValue}>
                <span className={`${styles.statDot} ${DOT_CLASS[s.status]}`} />
                {s.v}
              </div>
              <div className={styles.statLabel}>{s.l}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function SectionInner({name}: {name: string}) {
  const {data, loading, selectedYear, availableYears} = useContext(YearCtx);
  const {colorMode} = useColorMode();
  const isDark = colorMode === 'dark';
  const theme = isDark ? 'dark' : undefined;
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);

  useEffect(() => {
    const handle = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handle);
    return () => window.removeEventListener('resize', handle);
  }, []);

  const noData = selectedYear !== null && !availableYears.includes(selectedYear);
  if (noData) return <div className={styles.noData}>暂无 {selectedYear} 年数据</div>;
  if (loading && data.steps.length === 0) return <div className={styles.loading}>加载中…</div>;

  const h = isMobile ? 200 : 240;
  const opts = {renderer: 'svg' as const};
  const sec = SECTIONS.find((s) => s.title === name);
  if (!sec) return null;

  return (
    <div className={styles.wrap}>
      {sec.charts.map(({label, opt}: {label: string; opt: OptionFn}) => (
        <div key={label} className={styles.section}>
          <div className={styles.sectionTitle}>{label}</div>
          <ReactECharts option={opt(isDark, data)} theme={theme} style={{height: h}} opts={opts} />
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
