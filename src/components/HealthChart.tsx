import React, {useEffect, useRef, useState} from 'react';
import {useColorMode} from '@docusaurus/theme-common';
import ReactECharts from 'echarts-for-react';
import {type EChartsOption} from 'echarts';
import styles from './HealthChart.module.css';

export function useHealthChartColors(scope?: React.RefObject<HTMLElement | null>) {
  const {colorMode} = useColorMode();
  const [colors, setColors] = useState({primary: '#555', text: '#555', muted: '#888', border: '#ddd', background: '#fff', secondary: '#aaa'});
  useEffect(() => {
    const css = getComputedStyle(scope?.current ?? document.documentElement);
    const read = (name: string) => css.getPropertyValue(name).trim();
    setColors({primary: read('--sleep-accent') || read('--ifm-color-primary'), text: read('--ifm-font-color-base'), muted: read('--ifm-color-emphasis-600'),
      border: read('--ifm-color-emphasis-200'), background: read('--ifm-background-surface-color'), secondary: read('--sleep-history') || read('--ifm-color-emphasis-400')});
  }, [colorMode, scope]);
  return colors;
}

export default function HealthChart({option, height, label, className, onEvents, onReady, passive = false}: {
  option: EChartsOption; height: number; label: string; className?: string;
  onEvents?: Record<string, (event: any) => void>;
  onReady?: (chart: ReturnType<ReactECharts['getEchartsInstance']>) => void;
  passive?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const chart = useRef<ReactECharts>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!root.current) return;
    let frame = 0;
    const observer = new ResizeObserver(([entry]) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = entry.contentRect.width;
        setWidth(next);
        if (next > 0) chart.current?.getEchartsInstance().resize({width: next});
      });
    });
    observer.observe(root.current);
    return () => {observer.disconnect(); cancelAnimationFrame(frame);};
  }, []);
  return <div ref={root} className={className} role="img" aria-label={label} style={{height, minWidth: 0, width: '100%', pointerEvents: passive ? 'none' : undefined}}>
    {width > 0 && <ReactECharts ref={chart} option={option} notMerge autoResize={false} opts={{renderer: 'svg'}} style={{height}} onEvents={onEvents} onChartReady={(instance) => onReady?.(instance)} />}
  </div>;
}

export function healthChartTooltip(colors: ReturnType<typeof useHealthChartColors>) {
  return {confine: true, renderMode: 'richText' as const, backgroundColor: colors.background, borderColor: colors.border,
    textStyle: {color: colors.text, fontSize: 12}, padding: [7, 9]};
}

export function HealthDateTrend({values, endDate, label, unit = '', minimum, maximum, neutral, connect = false, valueLabel, axisLabel}: {
  values: Array<{date: string; value: number; description?: string}>; endDate: string; label: string; unit?: string;
  minimum?: number; maximum?: number; neutral?: number; connect?: boolean; valueLabel?: (value: number) => string; axisLabel?: (value: number) => string;
}) {
  const colors = useHealthChartColors();
  const [selection, setSelection] = useState<number | null>(null);
  const chart = useRef<ReturnType<ReactECharts['getEchartsInstance']> | null>(null);
  const start = Date.parse(`${endDate}T00:00:00Z`) - 29 * 86400000;
  const dates = Array.from({length: 30}, (_, index) => new Date(start + index * 86400000).toISOString().slice(0, 10));
  const byDate = new Map(values.map((item) => [item.date, item]));
  const available = dates.flatMap((date, index) => byDate.has(date) ? [index] : []);
  const selectedIndex = selection !== null && available.includes(selection) ? selection : available.at(-1) ?? null;
  const selected = selectedIndex === null ? undefined : byDate.get(dates[selectedIndex]);
  const format = (value: number) => valueLabel?.(value) ?? `${value.toLocaleString('zh-CN', {maximumFractionDigits: 2})}${unit ? ` ${unit}` : ''}`;
  const option: EChartsOption = {
    animation: false,
    grid: {left: axisLabel ? 48 : 36, right: 16, top: 12, bottom: 25},
    tooltip: {...healthChartTooltip(colors), trigger: 'item', formatter: (params) => {
      const point = Array.isArray(params) ? params[0] : params;
      const record = byDate.get(dates[point.dataIndex]);
      return record ? `${record.date}\n${record.description ?? format(record.value)}` : '';
    }},
    xAxis: {type: 'category', data: dates, boundaryGap: false, axisLabel: {color: colors.muted, fontSize: 10, interval: 28, showMaxLabel: true, formatter: (date: string) => date.slice(5)}, axisLine: {lineStyle: {color: colors.border}}, axisTick: {show: false}},
    yAxis: {type: 'value', scale: true, min: minimum, max: maximum, splitNumber: 2, axisLabel: {color: colors.muted, fontSize: 10, formatter: axisLabel}, splitLine: {lineStyle: {color: colors.border}}},
    series: [{type: connect ? 'line' : 'scatter', connectNulls: false, data: dates.map((date, index) => ({value: byDate.get(date)?.value ?? null, symbolSize: index === selectedIndex ? 8 : 5,
        itemStyle: {opacity: index === selectedIndex ? 1 : 0.65}})), symbol: 'circle', showSymbol: true, showAllSymbol: true,
      lineStyle: {width: 1.5}, itemStyle: {color: colors.primary},
      markLine: neutral === undefined ? undefined : {silent: true, symbol: 'none', label: {show: false}, lineStyle: {color: colors.muted, type: 'dashed'}, data: [{yAxis: neutral}]}}],
  };
  return <div className={styles.explorer} tabIndex={0} role="group" onBlur={() => chart.current?.dispatchAction({type: 'hideTip'})} aria-label={`${label}，左右方向键查看记录，Home 和 End 跳至首尾。`} onKeyDown={(event) => {
    if (!available.length) return;
    const current = selectedIndex === null ? -1 : available.indexOf(selectedIndex);
    let next: number;
    if (event.key === 'ArrowRight') next = available[Math.min(available.length - 1, current + 1)];
    else if (event.key === 'ArrowLeft') next = available[current < 0 ? available.length - 1 : Math.max(0, current - 1)];
    else if (event.key === 'Home') next = available[0];
    else if (event.key === 'End') next = available.at(-1)!;
    else return;
    event.preventDefault(); setSelection(next);
    chart.current?.dispatchAction({type: 'showTip', seriesIndex: 0, dataIndex: next});
  }}>
    <HealthChart option={option} height={120} label={label} onReady={(instance) => {chart.current = instance;}} onEvents={{click: (event: {dataIndex: number}) => setSelection(event.dataIndex)}} />
    <output className={styles.readout} aria-live="polite"><span>{selectedIndex === null ? '暂无记录' : dates[selectedIndex]}</span><strong>{selected ? selected.description ?? format(selected.value) : '—'}</strong></output>
  </div>;
}
