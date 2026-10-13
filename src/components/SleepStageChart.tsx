import React, {type ReactNode, useEffect, useMemo, useRef, useState} from 'react';
import {useColorMode} from '@docusaurus/theme-common';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';
import stageInstaller from '@echarts-x/custom-stage';

echarts.use(stageInstaller);
import styles from './SleepStageChart.module.css';

type SleepRecord = {type?: string; stage?: string; start?: string; end?: string};
type Segment = {stage: string; start: number; end: number};
const stages = [
  {key: 'awake', label: '清醒时间', color: 'var(--sleep-stage-awake)'},
  {key: 'rem', label: '快速动眼睡眠', color: 'var(--sleep-stage-rem)'},
  {key: 'core', label: '核心睡眠', color: 'var(--sleep-accent)'},
  {key: 'deep', label: '深度睡眠', color: 'var(--sleep-stage-deep)'},
];
const hour = 3600000;
const formatMinutes = (value: number) => value >= 60 ? `${Math.floor(value / 60)}小时${value % 60}分钟` : `${value}分钟`;
const timestamp = (value?: string) => value ? Date.parse(value.replace(' ', 'T').replace(' +0800', '+08:00')) : NaN;

function sleepMinutes(segments: Segment[]) {
  let end = -Infinity;
  let duration = 0;
  for (const segment of segments.filter((item) => item.stage !== 'awake')) {
    duration += Math.max(0, segment.end - Math.max(end, segment.start));
    end = Math.max(end, segment.end);
  }
  return Math.round(duration / 60000);
}

export default function SleepStageChart({date, durationMinutes, score, scoreDetails}: {date: string; durationMinutes: number | null; score: ReactNode; scoreDetails: ReactNode}) {
  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setSegments(null);
    setSelected(null);
    fetch(`/data/health/${date.replaceAll('-', '/')}.json`, {signal: controller.signal})
      .then(async (response) => response.ok ? response.json() : null)
      .then((payload: {timeline?: SleepRecord[]} | null) => {
        if (controller.signal.aborted) return;
        const unique = new Map<string, Segment>();
        for (const record of payload?.timeline ?? []) {
          if (record.type !== 'sleep' || !stages.some((stage) => stage.key === record.stage)) continue;
          const start = timestamp(record.start);
          const end = timestamp(record.end);
          if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
          unique.set(`${record.stage}-${start}-${end}`, {stage: record.stage!, start, end});
        }
        setSegments([...unique.values()].sort((a, b) => a.start - b.start));
      })
      .catch(() => {if (!controller.signal.aborted) setSegments([]);});
    return () => controller.abort();
  }, [date]);

  if (!segments?.length) return (
    <section className={styles.card} aria-label="睡眠分期">
      <div className={styles.header}><div className={styles.heading}>睡眠 · {date}</div>{score}</div>
      {scoreDetails}
      <div className={styles.placeholder} role="status">{segments === null ? '正在加载睡眠分期…' : '当天暂无睡眠分期数据'}</div>
    </section>
  );
  const minutes = durationMinutes ?? sleepMinutes(segments);
  const [, month, day] = date.split('-').map(Number);
  return (
    <section className={styles.card} aria-label="睡眠分期">
      <div className={styles.header}>
        <div>
          <div className={styles.heading}>睡眠 · {month}月{day}日</div>
          <div className={styles.total} title="总时长与 Apple Health 睡眠评分记录一致；各分期时长按实际采样独立计算、取整。"><strong>{Math.floor(minutes / 60)}</strong><span>小时</span><strong>{minutes % 60}</strong><span>分钟</span></div>
        </div>
        {score}
      </div>
      {scoreDetails}
      <StagePlot segments={segments} selected={selected} onSelect={setSelected} />
    </section>
  );
}

function StagePlot({segments, selected, onSelect}: {segments: Segment[]; selected: number | null; onSelect: (index: number | null) => void}) {
  const {colorMode} = useColorMode();
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<ReactECharts>(null);
  const [width, setWidth] = useState(320);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const [palette, setPalette] = useState<string[]>([]);
  useEffect(() => {
    if (!container.current) return;
    const css = getComputedStyle(container.current);
    setPalette(['--sleep-stage-awake', '--sleep-stage-rem', '--sleep-accent', '--sleep-stage-deep', '--ifm-color-emphasis-700', '--ifm-color-emphasis-300', '--ifm-background-surface-color', '--ifm-color-emphasis-600']
      .map((name) => css.getPropertyValue(name).trim()));
  }, [colorMode]);
  const stageLabels = useMemo(() => stages.map((stage) => {
    const minutes = sleepMinutes(segments.filter((segment) => segment.stage === stage.key).map((segment) => ({...segment, stage: 'sleep'})));
    return `${stage.label} · ${minutes === 0 && segments.some((segment) => segment.stage === stage.key) ? '不足1分钟' : formatMinutes(minutes)}`;
  }), [segments]);
  const bounds = useMemo(() => {
    const asleep = segments.filter((segment) => segment.stage !== 'awake');
    if (!asleep.length) return null;
    return {start: asleep[0].start, end: Math.max(...asleep.map((segment) => segment.end))};
  }, [segments]);
  const axisSpan = Math.max(hour, Math.ceil(Math.max(...segments.map((segment) => segment.end)) / hour) * hour - Math.floor(segments[0].start / hour) * hour);
  const crossesMidnight = bounds && Math.floor((bounds.start + 8 * hour) / (24 * hour)) !== Math.floor((bounds.end + 8 * hour) / (24 * hour));
  const labelWidth = crossesMidnight ? 86 : 44;
  const staggerLabels = bounds && (bounds.end - bounds.start) / axisSpan * (width - 10) < labelWidth * 2 + 6;
  const rowHeight = 65;
  const plotHeight = rowHeight * stages.length;
  const chartHeight = plotHeight + (staggerLabels ? 66 : 40);
  const option = useMemo<echarts.EChartsOption>(() => {
    const start = Math.floor(segments[0].start / hour) * hour;
    const end = Math.ceil(Math.max(...segments.map((segment) => segment.end)) / hour) * hour;
    const span = Math.max(hour, end - start);
    const interval = (span <= 6 * hour ? 1 : span <= 12 * hour ? 2 : Math.ceil(span / hour / 6)) * hour;
    const timeLabel = (time: number) => new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit'}).format(Math.round(time / 60000) * 60000);
    const x = (time: number) => 5 + (time - start) / span * (width - 10);
    const boxLeft = (time: number) => time === bounds?.start ? x(time) : x(time) - labelWidth;
    const dayLabel = (time: number, first: boolean) => {
      if (!crossesMidnight || !bounds) return '';
      const days = Math.floor((bounds.end + 8 * hour) / (24 * hour)) - Math.floor((bounds.start + 8 * hour) / (24 * hour));
      const localHour = new Date(time + 8 * hour).getUTCHours();
      if (days === 1 && (first ? localHour >= 18 : localHour < 12)) return first ? '昨晚 ' : '今早 ';
      return new Intl.DateTimeFormat('zh-CN', {timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric'}).format(time) + ' ';
    };
    const candidates = Array.from({length: Math.ceil(span / hour)}, (_, index) => start + index * hour)
      .filter((time) => !bounds || (time > bounds.start && time < bounds.end && [bounds.start, bounds.end].every((boundary) => x(time) + 18 < boxLeft(boundary) - 12 || x(time) - 18 > boxLeft(boundary) + labelWidth + 12)));
    const tickCount = Math.min(candidates.length, Math.max(1, Math.floor(width / 150)));
    const ticks: number[] = [];
    for (let index = 1; index <= tickCount; index++) {
      const target = (bounds?.start ?? start) + ((bounds?.end ?? end) - (bounds?.start ?? start)) * index / (tickCount + 1);
      const next = [...candidates].filter((time) => ticks.every((tick) => Math.abs(x(tick) - x(time)) >= 50))
        .sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0];
      if (next !== undefined) ticks.push(next);
    }
    const endpoints: echarts.GraphicComponentOption[] = bounds ? [bounds.start, bounds.end].flatMap((time, index) => {
      const labelTop = plotHeight + (index === 1 && staggerLabels ? 39 : 8);
      return [{
        type: 'line', silent: true,
        shape: {x1: x(time), x2: x(time), y1: plotHeight, y2: labelTop - 3},
        style: {stroke: palette[4], opacity: 0.55},
      }, {
        type: 'text', x: x(time), y: labelTop, silent: true,
        style: {text: `${dayLabel(time, index === 0)}${timeLabel(time)}\n${index === 0 ? '入睡' : '醒来'}`, align: index === 0 ? 'left' : 'right', verticalAlign: 'top', fill: palette[4], fontSize: 11, lineHeight: 13},
      }];
    }) : [];
    return {
      animation: false,
      tooltip: {
        trigger: 'item', confine: true,
        backgroundColor: palette[6], borderColor: palette[5], borderWidth: 0.5, padding: [8, 10],
        extraCssText: 'box-shadow:0 3px 12px rgba(0,0,0,0.09);border-radius:6px;',
        position: (point, params, _element, _rect, size) => {
          const item = Array.isArray(params) ? params[0] : params;
          const row = stages.findIndex((stage) => stage.key === segments[item.dataIndex]?.stage);
          const barTop = Math.max(0, row) * rowHeight + 29;
          const left = Math.max(0, Math.min(size.viewSize[0] - size.contentSize[0], point[0] - size.contentSize[0] / 2));
          const top = barTop - size.contentSize[1] - 10;
          return [left, top >= 0 ? top : barTop + 36];
        },
        textStyle: {color: palette[4], fontSize: 12},
        formatter: (params) => {
          const item = Array.isArray(params) ? params[0] : params;
          const segment = segments[item.dataIndex];
          if (!segment) return '';
          const short = segment.end - segment.start < 60000;
          const timeWithSeconds = (time: number) => new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit'}).format(time);
          const formatTime = short ? timeWithSeconds : timeLabel;
          const duration = short ? `${Math.floor(segment.end / 1000) - Math.floor(segment.start / 1000)}秒` : formatMinutes(Math.round(segment.end / 60000) - Math.round(segment.start / 60000));
          const stageIndex = stages.findIndex((stage) => stage.key === segment.stage);
          return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><i style="width:6px;height:6px;border-radius:50%;background:${palette[stageIndex]}"></i>${stages[stageIndex].label}</div><div style="display:flex;align-items:baseline;gap:16px"><span style="font-variant-numeric:tabular-nums">${formatTime(segment.start)}–${formatTime(segment.end)}</span><strong>${duration}</strong></div>`;
        },
      },
      grid: {left: 5, right: 5, top: 0, bottom: chartHeight - plotHeight},
      xAxis: {
        type: 'value', min: start, max: start + span, interval,
        axisLabel: {show: false},
        axisLine: {show: false}, axisTick: {show: false},
        splitLine: {show: true, lineStyle: {color: palette[5], type: 'dashed', opacity: 0.25}},
      },
      yAxis: {
        type: 'category', data: [...stages].reverse().map((stage) => stage.key),
        axisLine: {show: false}, axisTick: {show: false}, axisLabel: {show: false},
        splitLine: {show: true, lineStyle: {color: palette[5], opacity: 0.4}},
      },
      graphic: [...stages.map((stage, index) => ({
        type: 'text' as const, left: 9, top: index * rowHeight + 4, silent: true,
        style: {
          text: `{name|${stage.label}}\n{duration|${stageLabels[index].split(' · ')[1]}}`,
          rich: {
            name: {fill: palette[7], fontSize: 11, lineHeight: 12},
            duration: {fill: palette[4], fontSize: 11, fontWeight: 500, lineHeight: 12},
          },
        },
      })), ...endpoints, ...ticks.map((time) => ({type: 'text' as const, x: x(time), y: plotHeight + 8, silent: true, style: {text: timeLabel(time), align: 'center' as const, verticalAlign: 'top' as const, fill: palette[7], fontSize: 11}}))],
      series: [{
        type: 'custom',
        // ECharts supports registered names at runtime, but its type only declares callbacks.
        renderItem: 'stage' as unknown as echarts.CustomSeriesRenderItem,
        encode: {x: [0, 1], y: 2},
        itemPayload: {
          itemStyle: {borderRadius: 6, verticalMargin: 10, minHorizontalSize: 3},
          axisLabel: {formatter: () => ''},
          envelope: {color: palette[2], opacity: 0.2, externalRadius: 6, margin: 1.5},
        },
        data: segments.map((segment) => ({
          value: [segment.start, segment.end, segment.stage],
          itemStyle: {color: palette[stages.findIndex((stage) => stage.key === segment.stage)]},
        })),
        emphasis: {focus: 'none', itemStyle: {opacity: 1}},
      }],
    };
  }, [segments, palette, stageLabels, bounds, width, crossesMidnight, labelWidth, staggerLabels, chartHeight, plotHeight]);
  const events = useMemo(() => ({click: (event: {dataIndex?: number}) => {
    if (typeof event.dataIndex === 'number') onSelect(event.dataIndex);
  }}), [onSelect]);
  useEffect(() => {
    if (!chart.current) return;
    const instance = chart.current.getEchartsInstance();
    instance.dispatchAction({type: 'downplay', seriesIndex: 0});
    if (selected !== null) {
      instance.dispatchAction({type: 'highlight', seriesIndex: 0, dataIndex: selected});
      instance.dispatchAction({type: 'showTip', seriesIndex: 0, dataIndex: selected});
    }
  }, [selected, option]);
  return <div ref={container} className={styles.chart} style={{height: chartHeight}} tabIndex={0} role="group"
    aria-label={`睡眠分期图，${stageLabels.join('，')}。悬停或轻点时段查看详情；使用左右方向键切换时段，Home 和 End 跳到首尾`}
    onKeyDown={(event) => {
      let next: number;
      if (event.key === 'ArrowRight') next = selected === null ? 0 : Math.min(segments.length - 1, selected + 1);
      else if (event.key === 'ArrowLeft') next = selected === null ? segments.length - 1 : Math.max(0, selected - 1);
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = segments.length - 1;
      else return;
      event.preventDefault();
      onSelect(next);
    }}>
    {palette.length > 0 && <ReactECharts ref={chart} option={option} notMerge opts={{renderer: 'svg'}} style={{height: chartHeight}} onEvents={events} />}
  </div>;
}
