import React, {createContext, useContext, useEffect, useMemo, useRef, useState} from 'react';
import {Accordion, Collapsible, Tabs, useAccordionContext} from '@chakra-ui/react';
import {useColorMode} from '@docusaurus/theme-common';
import type ReactECharts from 'echarts-for-react';
import {type EChartsOption, type CustomSeriesRenderItemParams, type CustomSeriesRenderItemAPI} from 'echarts';
import {staticAssetUrl} from '@site/src/utils/staticAssets';
import {healthTimelinePeriodLabel, type HealthMetricPayload, type HealthTimelinePeriod} from '@site/src/utils/healthTimeline';
import {
  availableHealthMetrics, formatHealthMetric, healthMetricBaseline, healthMetricFile, healthMetricPeriods,
  healthMetricValue, healthSampleSeries, healthBandOpacity, healthBandBuckets, healthBandSample, healthMetricComparison, type HealthDayData, type HealthMetricDefinition, type MetricGroup,
} from '@site/src/utils/healthPresentation';
import {createHealthPeriodCache, healthMetricCacheKey} from '@site/src/utils/healthMetricCache';
import HealthChart, {HealthDateTrend, useHealthChartColors} from './HealthChart';
import styles from './HealthMetricDetails.module.css';

export async function loadHealthShard<T>(date: string, path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(staticAssetUrl(`/data/health/${date.slice(0, 7).replace('-', '/')}/${path}`), {signal});
  if (!response.ok) throw new Error('Health detail unavailable');
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const stream = new Blob([buffer]).stream();
  const payload = await new Response(bytes[0] === 0x1f && bytes[1] === 0x8b
    ? stream.pipeThrough(new DecompressionStream('gzip')) : stream).json();
  if (payload?.version !== 5 || payload.date !== date) throw new Error('Invalid health detail');
  return payload as T;
}

const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(Math.floor(minute % 60)).padStart(2, '0')}`;

type TimeSelection = {minute: number | null; pinned: boolean};
const TimeBandContext = createContext({
  selection: {minute: null, pinned: false} as TimeSelection,
  hover: (_minute: number | null) => {}, pin: (_minute: number) => {}, clear: () => {},
});

export function HealthTimeBands({children}: {children: React.ReactNode}) {
  const [selection, setSelection] = useState<TimeSelection>({minute: null, pinned: false});
  const context = useMemo(() => ({selection,
    hover: (minute: number | null) => setSelection((current) => current.pinned ? current : {minute, pinned: false}),
    pin: (minute: number) => setSelection({minute, pinned: true}),
    clear: () => setSelection({minute: null, pinned: false}),
  }), [selection]);
  return <TimeBandContext.Provider value={context}>{children}</TimeBandContext.Provider>;
}

function TimeBand({periods, definition, label = '记录', axisOnly = false}: {periods: HealthTimelinePeriod[]; definition?: HealthMetricDefinition; label?: string; axisOnly?: boolean}) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const {selection, hover, pin} = useContext(TimeBandContext);
  const hrv = definition?.name === 'heart_rate_variability';
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const buckets = useMemo(() => healthBandBuckets(periods, Math.max(1, width - 16), definition?.kind === 'total'), [periods, width, definition]);
  const values = buckets.flatMap((period) => typeof period.value === 'number' ? [period.value] : []);
  const range: [number, number] | undefined = values.length ? [Math.min(...values), Math.max(...values)] : undefined;
  const sample = selection.minute === null ? undefined : healthBandSample(periods, selection.minute, 1440 / Math.max(1, width - 16) * 2);
  const readout = sample ? `${healthTimelinePeriodLabel(sample)} · ${sample.value !== undefined && definition ? formatHealthMetric(sample.value, definition) : sample.detail}` : '无采样';
  const colors = useHealthChartColors();
  const option: EChartsOption = {
    animation: false,
    grid: {left: 8, right: 8, top: 0, bottom: axisOnly ? 17 : 0},
    xAxis: {type: 'value', min: 0, max: 1440, interval: 360, axisLine: {show: false}, axisTick: {show: false}, splitLine: {show: false},
      axisLabel: {show: axisOnly, color: colors.muted, fontSize: 9, margin: 4, hideOverlap: true, formatter: (minute: number) => String(minute / 60).padStart(2, '0')}},
    yAxis: {type: 'value', min: 0, max: 1, show: false},
    series: [...(axisOnly ? [] : [{type: 'custom' as const, silent: true, data: [[0, 1440]], renderItem: (_: CustomSeriesRenderItemParams, api: CustomSeriesRenderItemAPI) => {
      const start = api.coord([0, 0.5]); const end = api.coord([1440, 0.5]);
      return {type: 'rect' as const, shape: {x: start[0], y: start[1] - 6, width: end[0] - start[0], height: 12, r: 3}, style: {fill: colors.border}};
    }}, {type: 'custom' as const, silent: true, data: buckets.map((period, index) => [period.start, period.end, index]), renderItem: (_: CustomSeriesRenderItemParams, api: CustomSeriesRenderItemAPI) => {
      const start = api.coord([api.value(0), 0.5]); const end = api.coord([api.value(1), 0.5]);
      return {type: 'rect' as const, shape: {x: start[0], y: start[1] - 5, width: end[0] - start[0], height: 10},
        style: {fill: colors.primary, opacity: healthBandOpacity(buckets[Number(api.value(2))].value, range, hrv)}};
    }}]), ...(selection.minute === null ? [] : [{type: 'custom' as const, silent: true, data: [[selection.minute]], renderItem: (_: CustomSeriesRenderItemParams, api: CustomSeriesRenderItemAPI) => {
      const point = api.coord([api.value(0), 0.5]);
      return {type: 'line' as const, shape: {x1: point[0], x2: point[0], y1: 0, y2: axisOnly ? 5 : 20}, style: {stroke: colors.text, lineWidth: 1}};
    }}])],
  };
  return <div ref={root} className={`${styles.band} ${axisOnly ? styles.bandAxis : styles.bandControl}`}>
    <HealthChart option={option} height={axisOnly ? 22 : 20} passive label={axisOnly ? '全天时间轴：00、06、12、18、24时' : `${label}全天时间带，颜色越深数值越高`} />
    {!axisOnly && <>
      <input className={styles.bandInput} type="range" min={0} max={1439} step={1} value={selection.minute ?? 720}
        aria-label={`${label}时间带，左右方向键调整时刻`} aria-valuetext={`${clock(selection.minute ?? 720)}，${selection.minute === null ? '尚未选择时刻' : readout}`}
        onPointerMove={(event) => {
          if (event.pointerType !== 'mouse' || event.buttons) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          hover(Math.max(0, Math.min(1439, Math.round((event.clientX - bounds.left - 8) / Math.max(1, bounds.width - 16) * 1440))));
        }} onPointerLeave={() => hover(null)} onPointerDown={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          pin(Math.max(0, Math.min(1439, Math.round((event.clientX - bounds.left - 8) / Math.max(1, bounds.width - 16) * 1440))));
        }} onChange={(event) => pin(Number(event.target.value))}
        onFocus={() => {if (selection.minute === null) pin(720);}} />
      <span className={styles.bandReadout} title={selection.minute === null ? undefined : readout}>{selection.minute === null ? '\u00a0' : readout}</span>
    </>}
  </div>;
}

function BandAxis() {
  const {selection, clear} = useContext(TimeBandContext);
  return <div className={styles.axisHeader}>
    <span className={styles.label}>{selection.minute === null ? '全天记录' : <button type="button" className={styles.clearTime} onClick={(event) => {
      const section = event.currentTarget.closest('section');
      clear();
      section?.focus({preventScroll: true});
    }} aria-label="清除所选时刻">{clock(selection.minute)} ×</button>}</span>
    <TimeBand periods={[]} axisOnly /><span className={styles.indicator} aria-hidden="true">⌄</span>
  </div>;
}

export function HealthEventItem({id, label, summary, periods, children}: {id: string; label: string; summary: string; periods: HealthTimelinePeriod[]; children?: React.ReactNode}) {
  return <Accordion.Item value={id} className={styles.item}>
    <div className={styles.metricRow}>
      <Accordion.ItemTrigger className={`${styles.trigger} ${styles.rowTrigger}`}>
        <span className={styles.label}><strong>{label}</strong><span>{summary}</span></span>
        <Accordion.ItemIndicator className={styles.indicator}>⌄</Accordion.ItemIndicator>
      </Accordion.ItemTrigger>
      {periods.length > 0 && <TimeBand periods={periods} label={label} />}
    </div>
    <Accordion.ItemContent className={styles.content}><Accordion.ItemBody className={styles.itemBody}>
      <div className={styles.detailScroll} tabIndex={0} role="region" aria-label={`${label}详情`}>{children ?? <ul className={styles.records}>{periods.map((period, index) => <li key={index}><time>{healthTimelinePeriodLabel(period)}</time><span>{period.detail}</span></li>)}</ul>}</div>
      <CollapseDetail label={label} />
    </Accordion.ItemBody></Accordion.ItemContent>
  </Accordion.Item>;
}

function CollapseDetail({label}: {label: string}) {
  const accordion = useAccordionContext();
  return <button type="button" className={styles.collapseDetail} onClick={(event) => {
    const trigger = event.currentTarget.closest('[data-part="item"]')?.querySelector<HTMLElement>('button[aria-expanded]');
    accordion.setValue([]);
    requestAnimationFrame(() => {trigger?.focus({preventScroll: true}); if (trigger) keepMetricVisible(trigger);});
  }}>收起{label}详情 ↑</button>;
}

const periodCache = createHealthPeriodCache();
function cachedPeriods(day: HealthDayData, definition: HealthMetricDefinition) {
  const file = healthMetricFile(day, definition.name);
  return file ? periodCache.get(healthMetricCacheKey(day, definition.name, file.path)) : undefined;
}

async function loadMetricPeriods(day: HealthDayData, definition: HealthMetricDefinition, signal: AbortSignal) {
  const file = healthMetricFile(day, definition.name);
  if (!file) return [];
  return periodCache.load(healthMetricCacheKey(day, definition.name, file.path), signal, async () => {
    const payload = await loadHealthShard<HealthMetricPayload>(day.date, file.path, signal);
    return healthMetricPeriods(day, definition, payload);
  });
}

function keepMetricVisible(trigger: HTMLElement) {
  let container = trigger.parentElement;
  while (container && container.getAttribute('role') !== 'dialog') {
    if (getComputedStyle(container).overflowY === 'auto') {
      const bounds = container.getBoundingClientRect();
      const row = trigger.getBoundingClientRect();
      const item = trigger.closest('[data-part="item"]')?.getBoundingClientRect() ?? row;
      if (row.top < bounds.top + 8) container.scrollTop += row.top - bounds.top - 8;
      else if (item.bottom > bounds.bottom - 8) container.scrollTop += Math.min(row.top - bounds.top - 8, item.bottom - bounds.bottom + 8);
      return;
    }
    container = container.parentElement;
  }
}

export function HealthSeriesChart({periods, definition, dailyValue, zoomToSamples = false}: {periods: HealthTimelinePeriod[]; definition: HealthMetricDefinition; dailyValue?: number | null; zoomToSamples?: boolean}) {
  const {colorMode} = useColorMode();
  const root = useRef<HTMLDivElement>(null);
  const chart = useRef<ReturnType<ReactECharts['getEchartsInstance']> | null>(null);
  const [colors, setColors] = useState<string[]>([]);
  const [selected, setSelected] = useState<HealthTimelinePeriod | null>(null);
  const records = useMemo(() => periods.filter((period) => typeof period.value === 'number').sort((a, b) => a.start - b.start), [periods]);
  const currentRecord = selected ?? records.at(-1);
  useEffect(() => {
    if (!root.current) return;
    const css = getComputedStyle(root.current);
    setColors(['--ifm-color-primary', '--ifm-font-color-base', '--ifm-color-emphasis-200', '--ifm-background-surface-color'].map((name) => css.getPropertyValue(name).trim()));
  }, [colorMode]);
  const option = useMemo<EChartsOption>(() => {
    const scatter = definition.kind === 'measurements' || definition.kind === 'statistic';
    const series = healthSampleSeries(periods);
    const times = periods.map((period) => period.start);
    const minimum = zoomToSamples && times.length ? Math.floor(Math.min(...times)) : 0;
    const maximum = zoomToSamples && times.length ? Math.max(minimum + 1, Math.ceil(Math.max(...times))) : 1440;
    return {
      animation: false,
      grid: {left: 40, right: 18, top: 12, bottom: 25},
      tooltip: {trigger: scatter ? 'item' : 'axis', triggerOn: 'mousemove|click|mousewheel', confine: true, renderMode: 'richText', backgroundColor: colors[3], borderColor: colors[2], textStyle: {color: colors[1], fontSize: 12}, axisPointer: {type: 'line', snap: true},
        formatter: (params) => {
          const item = Array.isArray(params) ? params[0] : params;
          const point = item?.value as [number, number] | undefined;
          if (!point || typeof point[1] !== 'number' || !Number.isFinite(point[1])) return '';
          return `${clock(point[0])}\n${definition.label} ${formatHealthMetric(point[1], definition)}`;
        }},
      xAxis: {type: 'value', min: minimum, max: maximum, interval: zoomToSamples ? undefined : 360, splitNumber: 4, axisLabel: {formatter: clock, color: colors[1], fontSize: 10, hideOverlap: true}, splitLine: {show: false}},
      yAxis: {type: 'value', scale: true, splitNumber: 3, axisLabel: {color: colors[1], fontSize: 10}, splitLine: {lineStyle: {color: colors[2]}}},
      series: [{type: scatter ? 'scatter' : definition.kind === 'total' ? 'bar' : 'line', data: scatter ? series.filter(([, value]) => value !== null).map((point) => ({value: point,
        itemStyle: definition.name === 'heart_rate_variability' ? {color: colors[0], opacity: 0.25 + 0.75 * Math.max(0, Math.min(1, point[1]! / 100))} : undefined})) : series,
        connectNulls: false, showSymbol: scatter || records.length <= 60, symbol: 'circle', symbolSize: scatter ? 7 : 3, lineStyle: {width: 1.5}, color: colors[0],
        markLine: definition.name === 'heart_rate_variability' && dailyValue != null ? {silent: true, symbol: 'none', label: {show: false}, lineStyle: {type: 'dashed', color: colors[1]}, data: [{yAxis: dailyValue}]} : undefined}],
    };
  }, [periods, definition, colors, dailyValue, zoomToSamples, records.length]);
  return <div ref={root} className={styles.chart} tabIndex={0} role="group" aria-label={`${definition.label}采样图。左右方向键切换记录，Home 和 End 跳至首尾。`}
    onKeyDown={(event) => {
      if (!records.length) return;
      const current = currentRecord ? records.indexOf(currentRecord) : -1;
      let next: number;
      if (event.key === 'ArrowRight') next = Math.min(records.length - 1, current + 1);
      else if (event.key === 'ArrowLeft') next = current < 0 ? records.length - 1 : Math.max(0, current - 1);
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = records.length - 1;
      else return;
      event.preventDefault();
      const record = records[next];
      setSelected(record);
      const points = healthSampleSeries(periods).filter(([, value]) => !['measurements', 'statistic'].includes(definition.kind) || value !== null);
      chart.current?.dispatchAction({type: 'showTip', seriesIndex: 0, dataIndex: points.findIndex(([minute, value]) => minute === record.start && value === record.value)});
    }}>
    <div className={styles.chartHeading}><span><strong>{definition.label}</strong> · {records.length.toLocaleString('zh-CN')} 次</span><span>{definition.unit}{definition.name === 'heart_rate_variability' && dailyValue != null ? ' · 虚线为日汇总' : ''}</span></div>
    {colors.length > 0 && <HealthChart option={option} height={170} label={`${definition.label}当日采样`} onReady={(instance) => {chart.current = instance;}} onEvents={{click: (event: {value?: [number, number]}) => {
      const point = event.value;
      if (point) setSelected(periods.find((period) => period.start === point[0] && period.value === point[1]) ?? null);
    }, updateAxisPointer: (event: {axesInfo?: Array<{axisDim?: string; value?: number}>}) => {
      const minute = event.axesInfo?.find((axis) => axis.axisDim === 'x')?.value;
      const record = records.find((period) => period.start === minute);
      if (record) setSelected(record);
    }}} />}
    <output className={styles.readout} aria-live="polite"><time>{currentRecord ? healthTimelinePeriodLabel(currentRecord) : '暂无采样'}</time><strong>{currentRecord?.value !== undefined ? formatHealthMetric(currentRecord.value, definition) : '—'}</strong></output>
    <p className={styles.hint}>悬停或轻点查看；方向键逐条浏览，空缺表示无采样。</p>
  </div>;
}

type MetricSamples = {periods: HealthTimelinePeriod[]; error?: boolean; pending?: boolean};

function MetricContent({day, history, definition, preview, onLoad}: {day: HealthDayData; history: HealthDayData[]; definition: HealthMetricDefinition; preview?: MetricSamples; onLoad?: (periods: HealthTimelinePeriod[]) => void}) {
  const file = healthMetricFile(day, definition.name);
  const inline = healthMetricPeriods(day, definition);
  const initial = inline.length ? inline : cachedPeriods(day, definition) ?? [];
  const [result, setResult] = useState<MetricSamples>({periods: initial, pending: !initial.length && Boolean(file)});
  useEffect(() => {
    const controller = new AbortController();
    if ((preview && !preview.error) || !file || initial.length) return;
    setResult({periods: [], pending: true});
    loadMetricPeriods(day, definition, controller.signal).then((periods) => {
      if (!controller.signal.aborted) {setResult({periods}); onLoad?.(periods);}
    }).catch(() => {if (!controller.signal.aborted) setResult({periods: [], error: true});});
    return () => controller.abort();
  }, [day, definition, preview]);
  const samples = preview && !preview.error ? preview : result;
  const value = healthMetricValue(day, definition);
  const trend = history.map((item) => ({date: item.date, value: healthMetricValue(item, definition)})).sort((a, b) => a.date.localeCompare(b.date));
  const measured = trend.filter((item) => item.value !== null);
  const baseline = healthMetricBaseline(history, day.date, definition);
  const statistic = definition.kind === 'statistic';
  const hasTrend = (statistic || definition.kind === 'measurements') && measured.length > 0;
  const hasDay = samples.pending || samples.error || samples.periods.length > 0;
  const dayContent = <>
    {samples.pending ? <p className={styles.note} role="status">正在加载采样…</p> : samples.error ? <p className={styles.note} role="status">采样暂不可用，日汇总仍保留。重新展开可重试。</p>
      : samples.periods.length > 0 ? <>
        {!statistic && <HealthSeriesChart periods={samples.periods} definition={definition} dailyValue={value} />}
        {(definition.kind === 'measurements' && definition.name !== 'heart_rate_variability' || definition.name === 'mindful_minutes' || statistic && samples.periods.length === 1) && <ul className={styles.records}>{samples.periods.map((period, index) => <li key={index}><time>{healthTimelinePeriodLabel(period)}</time><span>{period.detail}</span></li>)}</ul>}
        {statistic && samples.periods.length > 1 && <Collapsible.Root lazyMount unmountOnExit>
          <Collapsible.Trigger className={styles.trigger}>当日测量 · {samples.periods.length} 条 <span className={styles.indicator}>⌄</span></Collapsible.Trigger>
          <Collapsible.Content><ul className={styles.records}>{samples.periods.map((period, index) => <li key={index}><time>{healthTimelinePeriodLabel(period)}</time><span>{period.detail}</span></li>)}</ul></Collapsible.Content>
        </Collapsible.Root>}
        {definition.kind === 'total' && <p className={styles.note}>分时原始采样与日汇总采用不同统计口径，采样合计可能不同。</p>}
        {['apple_stand_time', 'time_in_daylight'].includes(definition.name) && <p className={styles.note}>时间带标识记录覆盖区间，区间内累计分钟数不等于区间长度。</p>}
      </> : <p className={styles.note}>暂无分时采样</p>}
    {definition.name === 'heart_rate_variability' && <p className={styles.hint}>颜色由浅至深表示 0–100+ 毫秒。</p>}
  </>;
  const trendContent = <>
    {hasTrend && <section className={styles.trend}>
      <div className={styles.note}>近 30 天 · {measured.length} 天有记录</div>
      <HealthDateTrend values={measured.map((item) => ({date: item.date, value: item.value!}))} endDate={day.date}
        label={`${definition.label}近30天趋势，${measured.length}天有记录`} valueLabel={(value) => formatHealthMetric(value, definition)} />
    </section>}
  </>;
  return <>
    {baseline !== null && <p className={styles.baseline}>前 7 日中位数 <strong>{formatHealthMetric(baseline, definition)}</strong>{value !== null ? ` · 今日${value > baseline ? '+' : ''}${(value - baseline).toFixed(definition.decimals ?? 0)} ${definition.unit}` : ''}</p>}
    {hasDay && hasTrend ? <Tabs.Root defaultValue="day" lazyMount unmountOnExit>
      <Tabs.List className={styles.tabList} aria-label={`${definition.label}数据范围`}>
        <Tabs.Trigger className={styles.tab} value="day">当日记录</Tabs.Trigger>
        <Tabs.Trigger className={styles.tab} value="trend">近 30 天</Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content className={styles.tabContent} value="day">{dayContent}</Tabs.Content>
      <Tabs.Content className={styles.tabContent} value="trend">{trendContent}</Tabs.Content>
    </Tabs.Root> : hasTrend ? trendContent : dayContent}
  </>;
}

export default function HealthMetricDetails({day, history = [], groups, title, children}: {day: HealthDayData; history?: HealthDayData[]; groups: MetricGroup[]; title?: string; children?: React.ReactNode}) {
  const section = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  useEffect(() => {
    if (!expanded.length) return;
    const trigger = section.current?.querySelector<HTMLElement>('button[data-state="open"]');
    if (!trigger) return;
    const observer = new ResizeObserver(() => keepMetricVisible(trigger));
    observer.observe(trigger.closest('[data-part="item"]') ?? trigger);
    return () => observer.disconnect();
  }, [expanded]);
  const groupKey = groups.join(',');
  const definitions = useMemo(() => availableHealthMetrics(day, groups), [day, groupKey]);
  const [loaded, setLoaded] = useState<{day: HealthDayData; items: Record<string, MetricSamples>}>({day, items: {}});
  const previews = loaded.day === day ? loaded.items : {};
  useEffect(() => {
    const controller = new AbortController();
    const jobs = definitions.flatMap((definition) => {
      const file = healthMetricFile(day, definition.name);
      return ['series', 'total'].includes(definition.kind) && file && !healthMetricPeriods(day, definition).length && !cachedPeriods(day, definition) ? [{definition, file}] : [];
    });
    setLoaded({day, items: {}});
    let cursor = 0;
    const worker = async () => {
      while (cursor < jobs.length && !controller.signal.aborted) {
        const {definition} = jobs[cursor++];
        let sample: MetricSamples;
        try {
          sample = {periods: await loadMetricPeriods(day, definition, controller.signal)};
        } catch {
          if (controller.signal.aborted) return;
          sample = {periods: [], error: true};
        }
        if (!controller.signal.aborted) setLoaded((current) => ({day, items: {...(current.day === day ? current.items : {}), [definition.name]: sample}}));
      }
    };
    void Promise.all(Array.from({length: Math.min(3, jobs.length)}, worker));
    return () => controller.abort();
  }, [day, definitions]);
  const hasBands = definitions.some((definition) => ['series', 'total'].includes(definition.kind) || healthMetricPeriods(day, definition).length > 0);

  return <section ref={section} className={styles.section} tabIndex={-1}>
    {title && <h4>{title}</h4>}
    {hasBands && <BandAxis />}
    <Accordion.Root value={expanded} onValueChange={({value}) => setExpanded(value)} collapsible lazyMount unmountOnExit className={styles.list}>
      {definitions.map((definition) => {
        const value = healthMetricValue(day, definition);
        const initial = healthMetricPeriods(day, definition);
        const preload = ['series', 'total'].includes(definition.kind) && Boolean(healthMetricFile(day, definition.name)) && !initial.length;
        const cached = cachedPeriods(day, definition);
        const preview: MetricSamples | undefined = preload ? previews[definition.name] ?? (cached ? {periods: cached} : {periods: [], pending: true}) : undefined;
        const periods = preview?.periods ?? initial;
        return <Accordion.Item key={definition.name} value={definition.name} className={styles.item}>
          <div className={styles.metricRow}>
            <Accordion.ItemTrigger className={`${styles.trigger} ${styles.rowTrigger}`}>
              <span className={styles.label}><strong>{definition.label}</strong><span>{value === null ? '查看测量' : formatHealthMetric(value, definition)}{definition.kind === 'series' && value !== null && <small>日均</small>}</span></span>
              {!periods.length && ((preload || definition.kind === 'series' || definition.kind === 'total')
                ? <span className={styles.bandStatus} role={preview?.pending ? 'status' : undefined}>{preview?.pending ? '正在加载时间带…' : preview?.error ? '时间带暂不可用' : '无分时记录'}</span>
                : <span className={styles.comparison}>{healthMetricComparison(history, day, definition)}</span>)}
              <Accordion.ItemIndicator className={styles.indicator}>⌄</Accordion.ItemIndicator>
            </Accordion.ItemTrigger>
            {periods.length > 0 && <TimeBand periods={periods} definition={definition} label={definition.label} />}
          </div>
          <Accordion.ItemContent className={styles.content}><Accordion.ItemBody className={styles.itemBody}>
            <div className={styles.detailScroll} tabIndex={0} role="region" aria-label={`${definition.label}详情`}>
              <MetricContent day={day} history={history} definition={definition} preview={preview}
                onLoad={preload ? (periods) => setLoaded((current) => ({day, items: {...(current.day === day ? current.items : {}), [definition.name]: {periods}}})) : undefined} />
            </div>
            <CollapseDetail label={definition.label} />
          </Accordion.ItemBody></Accordion.ItemContent>
        </Accordion.Item>;
      })}
      {children}
    </Accordion.Root>
    {hasBands && <p className={styles.hint}>悬停或轻点联动查看附近采样，点击名称展开。读数标注实际时段；深浅仅在同一指标内比较，空白为无记录。</p>}
  </section>;
}
