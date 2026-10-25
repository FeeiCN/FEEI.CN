import React, {type ReactNode, useEffect, useMemo, useRef, useState} from 'react';
import {useColorMode} from '@docusaurus/theme-common';
import ReactECharts from 'echarts-for-react';
import * as echarts from 'echarts';
import stageInstaller from '@echarts-x/custom-stage';

echarts.use(stageInstaller);
import styles from './SleepStageChart.module.css';

type SleepRecord = {type?: string; stage?: string; start?: string; end?: string};
type Segment = {stage: string; start: number; end: number};
const allStages = [
  {key: 'awake', label: '清醒时间', color: 'var(--sleep-stage-awake)'},
  {key: 'rem', label: '快速动眼睡眠', color: 'var(--sleep-stage-rem)'},
  {key: 'core', label: '核心睡眠', color: 'var(--sleep-accent)'},
  {key: 'deep', label: '深度睡眠', color: 'var(--sleep-stage-deep)'},
  {key: 'asleep', label: '睡眠', color: 'var(--sleep-history)'},
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

export default function SleepStageChart({date, durationMinutes, score, scoreDetails, children}: {date: string; durationMinutes: number | null; score: ReactNode; scoreDetails: ReactNode; children: ReactNode}) {
  const [record, setRecord] = useState<{date: string; segments: Segment[]} | null>(null);
  const segments = record?.date === date ? record.segments : null;
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setRecord(null);
    setSelected(null);
    fetch(`/data/health/${date.replaceAll('-', '/')}.json`, {signal: controller.signal})
      .then(async (response) => response.ok ? response.json() : null)
      .then((payload: {timeline?: SleepRecord[]} | null) => {
        if (controller.signal.aborted) return;
        const unique = new Map<string, Segment>();
        for (const record of payload?.timeline ?? []) {
          const stage = record.stage === '睡眠时长' ? 'asleep' : record.stage;
          if (record.type !== 'sleep' || !allStages.some((item) => item.key === stage)) continue;
          const start = timestamp(record.start);
          const end = timestamp(record.end);
          if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
          unique.set(`${stage}-${start}-${end}`, {stage: stage!, start, end});
        }
        setRecord({date, segments: [...unique.values()].sort((a, b) => a.start - b.start)});
      })
      .catch(() => {if (!controller.signal.aborted) setRecord({date, segments: []});});
    return () => controller.abort();
  }, [date]);

  const minutes = durationMinutes ?? (segments?.length ? sleepMinutes(segments) : null);
  const [, month, day] = date.split('-').map(Number);
  return (
    <section className={styles.card} aria-label="睡眠分期">
      <header className={styles.header}>
        <div>
          <div className={styles.heading}>睡眠 · {month}月{day}日</div>
          {minutes !== null && <div className={styles.total} title="总时长与 Apple Health 睡眠评分记录一致；各分期时长按实际采样独立计算、取整。"><strong>{Math.floor(minutes / 60)}</strong><span>小时</span><strong>{minutes % 60}</strong><span>分钟</span></div>}
        </div>
        {score}
      </header>
      {scoreDetails}
      {segments?.length ? <StagePlot segments={segments} selected={selected} onSelect={setSelected} /> : (
        <div className={styles.placeholder} role="status">{segments === null ? '正在加载睡眠分期…' : '当天暂无睡眠分期数据'}</div>
      )}
      {children}
    </section>
  );
}

function StagePlot({segments, selected, onSelect}: {segments: Segment[]; selected: number | null; onSelect: (index: number | null) => void}) {
  const stages = useMemo(() => allStages.filter((stage) => stage.key !== 'asleep' || segments.some((segment) => segment.stage === stage.key)), [segments]);
  const {colorMode} = useColorMode();
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<ReactECharts>(null);
  const [ready, setReady] = useState(false);
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
    setPalette(['--sleep-stage-awake', '--sleep-stage-rem', '--sleep-accent', '--sleep-stage-deep', '--ifm-color-emphasis-700', '--ifm-color-emphasis-300', '--ifm-background-surface-color', '--ifm-color-emphasis-600', '--sleep-history']
      .map((name) => css.getPropertyValue(name).trim()));
  }, [colorMode]);
  const stageLabels = useMemo(() => stages.map((stage) => {
    const minutes = sleepMinutes(segments.filter((segment) => segment.stage === stage.key).map((segment) => ({...segment, stage: 'sleep'})));
    return `${stage.label} · ${minutes === 0 && segments.some((segment) => segment.stage === stage.key) ? '不足1分钟' : formatMinutes(minutes)}`;
  }), [segments, stages]);
  const sessions = useMemo(() => {
    const groups: {start: number; end: number; recordedEnd: number}[] = [];
    for (const segment of segments) {
      const previous = groups.at(-1);
      // A gap without any sleep record separates chart sessions, not sleep stages.
      if (!previous || segment.start - previous.recordedEnd > hour) {
        if (segment.stage !== 'awake') groups.push({start: segment.start, end: segment.end, recordedEnd: segment.end});
      } else {
        previous.recordedEnd = Math.max(previous.recordedEnd, segment.end);
        if (segment.stage !== 'awake') previous.end = Math.max(previous.end, segment.end);
      }
    }
    return groups;
  }, [segments]);
  const bounds = sessions.length ? {start: sessions[0].start, end: sessions.at(-1)!.end} : null;
  const axisStart = Math.floor(segments[0].start / hour) * hour;
  const axisSpan = Math.max(hour, Math.ceil(Math.max(...segments.map((segment) => segment.end)) / hour) * hour - axisStart);
  const {endpointLabels, axisInset} = useMemo(() => {
    const nightSessions = sessions.filter((session) => {
      const startHour = new Date(session.start + 8 * hour).getUTCHours();
      return startHour >= 18 || startHour < 6;
    });
    const labels = nightSessions.flatMap((session) => [session.start, session.end].map((time, index) => {
      const first = index === 0;
      const crossesMidnight = Math.floor((session.start + 8 * hour) / (24 * hour)) !== Math.floor((session.end + 8 * hour) / (24 * hour));
      const days = Math.floor((session.end + 8 * hour) / (24 * hour)) - Math.floor((session.start + 8 * hour) / (24 * hour));
      const localHour = new Date(time + 8 * hour).getUTCHours();
      const prefix = !crossesMidnight ? '' : days === 1 && (first ? localHour >= 18 : localHour < 12)
        ? first ? '昨晚 ' : '今早 '
        : new Intl.DateTimeFormat('zh-CN', {timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric'}).format(time) + ' ';
      const formattedTime = new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit'}).format(Math.round(time / 60000) * 60000);
      const text = `${prefix}${formattedTime}\n${first ? '入睡' : '醒来'}`;
      const labelWidth = echarts.format.getTextRect(text, '11px sans-serif').width;
      return {time, text, labelWidth};
    }));
    const axisInset = Math.max(5, ...labels.map((label) => label.labelWidth / 2 + 5));
    const rows: number[] = [];
    const endpointLabels = labels.map((label) => {
      const x = axisInset + (label.time - axisStart) / axisSpan * (width - 2 * axisInset);
      const left = x - label.labelWidth / 2;
      let row = rows.findIndex((right) => left >= right + 8);
      if (row < 0) row = rows.length;
      rows[row] = left + label.labelWidth;
      return {...label, x, left, right: left + label.labelWidth, row};
    });
    return {endpointLabels, axisInset};
  }, [sessions, axisStart, axisSpan, width]);
  const rowHeight = 54;
  const plotHeight = rowHeight * stages.length;
  const chartHeight = plotHeight + 40 + Math.max(0, ...endpointLabels.map((label) => label.row)) * 31;
  const option = useMemo<echarts.EChartsOption>(() => {
    const start = Math.floor(segments[0].start / hour) * hour;
    const end = Math.ceil(Math.max(...segments.map((segment) => segment.end)) / hour) * hour;
    const span = Math.max(hour, end - start);
    const interval = (span <= 6 * hour ? 1 : span <= 12 * hour ? 2 : Math.ceil(span / hour / 6)) * hour;
    const timeLabel = (time: number) => new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit'}).format(Math.round(time / 60000) * 60000);
    const x = (time: number) => axisInset + (time - start) / span * (width - 2 * axisInset);
    const candidates = Array.from({length: Math.ceil(span / hour)}, (_, index) => start + index * hour)
      .filter((time) => !bounds || (time > bounds.start && time < bounds.end && endpointLabels.every((label) => x(time) + 18 < label.left - 12 || x(time) - 18 > label.right + 12)));
    const tickCount = Math.min(candidates.length, Math.max(1, Math.floor(width / 150)));
    const ticks: number[] = [];
    for (let index = 1; index <= tickCount; index++) {
      const target = (bounds?.start ?? start) + ((bounds?.end ?? end) - (bounds?.start ?? start)) * index / (tickCount + 1);
      const next = [...candidates].filter((time) => ticks.every((tick) => Math.abs(x(tick) - x(time)) >= 50))
        .sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0];
      if (next !== undefined) ticks.push(next);
    }
    const endpoints: echarts.GraphicComponentOption[] = endpointLabels.flatMap((label) => {
      const labelTop = plotHeight + 8 + label.row * 31;
      return [{
        type: 'line', silent: true,
        shape: {x1: label.x, x2: label.x, y1: plotHeight, y2: plotHeight + 5},
        style: {stroke: palette[4], opacity: 0.55},
      }, {
        type: 'text', x: label.x, y: labelTop, silent: true,
        style: {text: label.text, align: 'center', verticalAlign: 'top', fill: palette[4], fontSize: 11, lineHeight: 13},
      }];
    });
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
          return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><i style="width:6px;height:6px;border-radius:50%;background:${palette[stageIndex === 4 ? 8 : stageIndex]}"></i>${stages[stageIndex].label}</div><div style="display:flex;align-items:baseline;gap:16px"><span style="font-variant-numeric:tabular-nums">${formatTime(segment.start)}–${formatTime(segment.end)}</span><strong>${duration}</strong></div>`;
        },
      },
      grid: {left: axisInset, right: axisInset, top: 0, bottom: chartHeight - plotHeight},
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
          text: `{name|${stage.label}} {duration|${stageLabels[index].split(' · ')[1]}}`,
          rich: {
            name: {fill: palette[4], fontSize: 12, width: 84, lineHeight: 15},
            duration: {fill: palette[4], fontSize: 12, fontWeight: 600, lineHeight: 15},
          },
        },
      })), ...endpoints, ...(endpointLabels.length ? [{
        type: 'text' as const, x: width / 2, y: chartHeight - 19, silent: true,
        style: {text: '中断', align: 'center' as const, verticalAlign: 'top' as const, fill: palette[4], fontSize: 11, lineHeight: 13},
      }] : []), ...ticks.map((time) => ({type: 'text' as const, x: x(time), y: plotHeight + 8, silent: true, style: {text: timeLabel(time), align: 'center' as const, verticalAlign: 'top' as const, fill: palette[7], fontSize: 11}}))],
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
          itemStyle: {color: palette[segment.stage === 'asleep' ? 8 : stages.findIndex((stage) => stage.key === segment.stage)]},
        })),
        emphasis: {focus: 'none', itemStyle: {opacity: 1}},
      }],
    };
  }, [segments, stages, palette, stageLabels, bounds, width, endpointLabels, axisInset, chartHeight, plotHeight]);
  const events = useMemo(() => ({click: (event: {dataIndex?: number}) => {
    if (typeof event.dataIndex === 'number') onSelect(event.dataIndex);
  }}), [onSelect]);
  useEffect(() => {
    const instance = chart.current?.getEchartsInstance();
    if (!ready || !instance) return;
    // 连接带缩放时路径数量会变化，重建系列以避免复用旧的复合路径。
    instance.clear();
    instance.resize({width, height: chartHeight});
    instance.setOption(option, true);
  }, [width, chartHeight, ready]);
  useEffect(() => {
    if (!chart.current || !ready) return;
    const instance = chart.current.getEchartsInstance();
    instance.dispatchAction({type: 'downplay', seriesIndex: 0});
    if (selected !== null) {
      instance.dispatchAction({type: 'highlight', seriesIndex: 0, dataIndex: selected});
      instance.dispatchAction({type: 'showTip', seriesIndex: 0, dataIndex: selected});
    }
  }, [selected, option, ready]);
  return <div ref={container} className={styles.chart} data-has-endpoints={endpointLabels.length > 0} style={{height: chartHeight}} tabIndex={0} role="group"
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
    {palette.length > 0 && <ReactECharts ref={chart} option={option} notMerge autoResize={false} opts={{renderer: 'svg'}} style={{height: '100%'}} onEvents={events} onChartReady={() => setReady(true)} />}
  </div>;
}
