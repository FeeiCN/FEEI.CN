import React, {useEffect, useState} from 'react';
import {Collapsible} from '@chakra-ui/react';
import {type HealthDayData, type HealthMetricDefinition} from '@site/src/utils/healthPresentation';
import {type HealthTimelinePeriod} from '@site/src/utils/healthTimeline';
import {HealthEventItem, HealthSeriesChart, loadHealthShard} from './HealthMetricDetails';
import HealthChart, {useHealthChartColors} from './HealthChart';
import {type EChartsOption} from 'echarts';
import styles from './HealthMetricDetails.module.css';

type Quantity = {qty?: number; units?: string};
type Sample = {date?: string; start?: string; qty?: number; Avg?: number; units?: string};
type WorkoutSegment = {start?: string; end?: string; metrics?: {paceKilometre?: Quantity; activeEnergy?: Quantity; heartRateAverage?: Quantity}};
type WorkoutSamples = Record<string, unknown> & {segments?: WorkoutSegment[]; splits?: Array<{targetDistance?: Quantity; items?: WorkoutSegment[]}>};
type RoutePoint = {latitude: number; longitude: number; speed?: number; altitude?: number; timestamp?: string};
type WorkoutMeta = Record<string, unknown> & {speed?: Quantity; avgSpeed?: Quantity; elevationUp?: Quantity; stepCadence?: Quantity; swimCadence?: Quantity; effortScore?: Quantity; totalSwimmingStrokeCount?: Quantity};
const parseTime = (value: string) => Date.parse(value.replace(' ', 'T').replace(/ ([+-]\d{2})(\d{2})$/, '$1:$2'));

function RouteDetails({day, file, id}: {day: HealthDayData; file: string; id: string}) {
  const colors = useHealthChartColors();
  const [result, setResult] = useState<{route?: RoutePoint[]; error?: boolean}>({});
  useEffect(() => {
    const controller = new AbortController();
    loadHealthShard<{workoutId: string; route: RoutePoint[]}>(day.date, file, controller.signal).then((payload) => {
      if (payload.workoutId !== id || !Array.isArray(payload.route)) throw new Error('Invalid workout route');
      if (!controller.signal.aborted) setResult({route: payload.route.filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180)});
    }).catch(() => {if (!controller.signal.aborted) setResult({error: true});});
    return () => controller.abort();
  }, [day, file, id]);
  if (!result.route) return <p className={styles.note} role="status">{result.error ? '路线暂不可用，重新展开可重试。' : '正在加载路线…'}</p>;
  const route = result.route;
  if (!route.length) return <p className={styles.note}>暂无有效路线</p>;
  const origin = route[0];
  const points = route.map((point) => ({x: (point.longitude - origin.longitude) * Math.cos(origin.latitude * Math.PI / 180), y: -(point.latitude - origin.latitude)}));
  const xs = points.map((point) => point.x); const ys = points.map((point) => point.y);
  const lowX = Math.min(...xs); const lowY = Math.min(...ys);
  const width = Math.max(...xs) - lowX; const height = Math.max(...ys) - lowY;
  const routeOption: EChartsOption = {
    animation: false,
    grid: {left: 10, right: 10, top: 22, bottom: 10},
    xAxis: {type: 'value', show: false}, yAxis: {type: 'value', show: false},
    graphic: [{type: 'text', right: 12, top: 8, style: {text: '北 ↑', fill: colors.text, fontSize: 10}}],
    series: [{type: 'custom', data: [0], silent: true, renderItem: (params) => {
      const area = params.coordSys as unknown as {x: number; y: number; width: number; height: number};
      const scale = Math.min((area.width - 10) / (width || 1e-9), (area.height - 10) / (height || 1e-9));
      const projected = points.map((point) => [area.x + area.width / 2 + (point.x - lowX - width / 2) * scale,
        area.y + area.height / 2 + (point.y - lowY - height / 2) * scale]);
      return {type: 'group', children: [
        {type: 'polyline', shape: {points: projected}, style: {fill: 'none', stroke: colors.primary, lineWidth: 2}},
        {type: 'circle', shape: {cx: projected[0][0], cy: projected[0][1], r: 4}, style: {fill: colors.primary}},
        {type: 'circle', shape: {cx: projected.at(-1)![0], cy: projected.at(-1)![1], r: 4}, style: {fill: colors.background, stroke: colors.primary, lineWidth: 2}},
      ]};
    }}],
  };
  const distance = (definition: HealthMetricDefinition, field: 'speed' | 'altitude') => {
    const start = Date.parse(`${day.date}T00:00:00+08:00`);
    const periods = route.flatMap((point): HealthTimelinePeriod[] => {
      const minute = point.timestamp ? (parseTime(point.timestamp) - start) / 60000 : NaN;
      const value = point[field];
      return Number.isFinite(minute) && typeof value === 'number' && Number.isFinite(value) && (field !== 'speed' || value >= 0)
        ? [{start: minute, end: minute, value: field === 'speed' ? value * 3.6 : value, detail: definition.label}] : [];
    });
    return periods.length > 0 && <><HealthSeriesChart periods={periods} definition={definition} zoomToSamples /></>;
  };
  return <>
    <HealthChart className={styles.route} option={routeOption} height={180} label="训练路线，北向上，实心点为起点，空心点为终点" />
    <p className={styles.note}>实测轨迹 · {route.length.toLocaleString()} 个定位点 · 实心点起点，空心点终点</p>
    {distance({name: 'speed', label: '速度', unit: '公里/时', group: 'activity', kind: 'series', field: '', decimals: 1}, 'speed')}
    {distance({name: 'altitude', label: '海拔', unit: '米', group: 'activity', kind: 'series', field: '', decimals: 1}, 'altitude')}
  </>;
}

function WorkoutContent({day, id}: {day: HealthDayData; id: string}) {
  const refs = day.workoutDetails?.find((item) => item.id === id)?.files;
  const resolve = (file?: string) => file ? day.files?.[file]?.path : undefined;
  const metaPath = resolve(refs?.meta); const samplesPath = resolve(refs?.samples); const routePath = resolve(refs?.route);
  const [result, setResult] = useState<{meta?: WorkoutMeta; samples?: WorkoutSamples; error?: boolean}>({});
  useEffect(() => {
    const controller = new AbortController();
    Promise.allSettled([
      metaPath ? loadHealthShard<{workout: WorkoutMeta}>(day.date, metaPath, controller.signal).then((payload) => {
        if (payload.workout?.id !== id) throw new Error('Invalid workout');
        return payload.workout;
      }) : undefined,
      samplesPath ? loadHealthShard<{workoutId: string; samples: WorkoutSamples}>(day.date, samplesPath, controller.signal).then((payload) => {
        if (payload.workoutId !== id) throw new Error('Invalid workout samples');
        return payload.samples;
      }) : undefined,
    ]).then(([meta, samples]) => {if (!controller.signal.aborted) setResult({meta: meta.status === 'fulfilled' ? meta.value : undefined,
      samples: samples.status === 'fulfilled' ? samples.value : undefined, error: meta.status === 'rejected' || samples.status === 'rejected'});})
      .catch(() => {if (!controller.signal.aborted) setResult({error: true});});
    return () => controller.abort();
  }, [day, id, metaPath, samplesPath]);
  const series = (key: string) => {
    const start = Date.parse(`${day.date}T00:00:00+08:00`);
    const records = result.samples?.[key];
    return (Array.isArray(records) ? records as Sample[] : []).flatMap((sample): HealthTimelinePeriod[] => {
      const minute = (parseTime(sample.date ?? sample.start ?? '') - start) / 60000;
      const value = sample.Avg ?? sample.qty;
      const energy = key === 'activeEnergy';
      const converted = typeof value === 'number' ? energy && sample.units === 'kJ' ? value / 4.184 : value : NaN;
      return Number.isFinite(minute) && Number.isFinite(converted)
        ? [{start: minute, end: minute, value: converted, detail: `${energy ? '活动能量' : key === 'heartRateRecovery' ? '恢复心率' : '训练心率'} ${converted.toFixed(energy ? 2 : 0)} ${energy ? '千卡' : '次/分'}`}] : [];
    });
  };
  const heart = series('heartRateData'); const recovery = series('heartRateRecovery');
  const energy = series('activeEnergy');
  const splits = result.samples?.splits?.find((item) => item.targetDistance?.qty === 1 && item.targetDistance.units === 'km')?.items ?? result.samples?.segments ?? [];
  const quantities = [
    ['平均速度', result.meta?.speed, '公里/时'], ['累计爬升', result.meta?.elevationUp, '米'],
    ['步频', result.meta?.stepCadence, '步/分'], ['划水频率', result.meta?.swimCadence, '次/分'],
    ['划水次数', result.meta?.totalSwimmingStrokeCount, '次'], ['体感强度', result.meta?.effortScore, ''],
  ] as const;
  return <>
    {result.error ? <p role="status" className={styles.note}>训练明细暂不可用，重新展开可重试。</p>
      : !result.meta && !result.samples && (metaPath || samplesPath) ? <p role="status" className={styles.note}>正在加载训练明细…</p> : null}
    <ul className={styles.records}>{quantities.flatMap(([label, quantity, unit]) => typeof quantity?.qty === 'number' ? [<li key={label}><span>{label}</span><strong>{quantity.qty.toFixed(1)} {unit}</strong></li>] : [])}</ul>
    {heart.length > 0 && <HealthSeriesChart periods={heart} definition={{name: 'workout_heart_rate', label: '训练心率', unit: '次/分', group: 'activity', kind: 'series', field: ''}} zoomToSamples />}
    {recovery.length > 0 && <><HealthSeriesChart periods={recovery} definition={{name: 'recovery', label: '恢复心率', unit: '次/分', group: 'activity', kind: 'series', field: ''}} zoomToSamples /></>}
    {splits.length > 0 && <Collapsible.Root lazyMount unmountOnExit>
      <Collapsible.Trigger className={styles.trigger}>分段与配速 <span className={styles.indicator}>⌄</span></Collapsible.Trigger>
      <Collapsible.Content><ul className={styles.records}>{splits.map((segment, index) => {
        const pace = segment.metrics?.paceKilometre?.qty;
        const seconds = typeof pace === 'number' ? Math.round(pace) : null;
        return <li key={index}><span>第 {index + 1} 段</span><span>{[segment.start?.slice(11, 16), segment.end?.slice(11, 16)].filter(Boolean).join('–')}</span>
          <strong>{seconds === null ? '—' : `${Math.floor(seconds / 60)}′${String(seconds % 60).padStart(2, '0')}″/公里`}</strong></li>;
      })}</ul><p className={styles.note}>优先展示每公里分段；末段可能不足一公里。</p></Collapsible.Content>
    </Collapsible.Root>}
    {energy.length > 0 && <Collapsible.Root lazyMount unmountOnExit>
      <Collapsible.Trigger className={styles.trigger}>活动能量采样 <span className={styles.indicator}>⌄</span></Collapsible.Trigger>
      <Collapsible.Content><HealthSeriesChart periods={energy} definition={{name: 'energy', label: '单次采样能量', unit: '千卡', group: 'activity', kind: 'series', field: '', decimals: 2}} zoomToSamples /><p className={styles.note}>每点为单条采样能量，不是累计消耗。</p></Collapsible.Content>
    </Collapsible.Root>}
    {routePath && <Collapsible.Root lazyMount unmountOnExit><Collapsible.Trigger className={styles.trigger}>路线、速度与海拔 <span className={styles.indicator}>⌄</span></Collapsible.Trigger>
      <Collapsible.Content><RouteDetails day={day} file={routePath} id={id} /></Collapsible.Content></Collapsible.Root>}
  </>;
}

export default function HealthWorkoutDetails({day}: {day: HealthDayData}) {
  return <>{(day.activity?.workouts ?? []).map((workout, index) => {
    const summary = [typeof workout.durationMinutes === 'number' ? `${Math.round(workout.durationMinutes)} 分钟` : '', typeof workout.distanceKm === 'number' ? `${workout.distanceKm.toFixed(2)} 公里` : ''].filter(Boolean).join(' · ');
    const periods = typeof workout.startMinute === 'number' && typeof workout.endMinute === 'number' ? [{start: workout.startMinute, end: workout.endMinute, detail: summary}] : [];
    return <HealthEventItem key={workout.id ?? index} id={`workout-${workout.id ?? index}`} label={workout.type ?? '训练'} summary={summary} periods={periods}>
      <p className={styles.note}>{periods.map((period) => `${Math.floor(period.start / 60)}:${String(Math.floor(period.start % 60)).padStart(2, '0')}–${Math.floor(period.end / 60)}:${String(Math.floor(period.end % 60)).padStart(2, '0')}`).join(' · ')}{typeof workout.averageHeartRateBpm === 'number' ? ` · 平均心率 ${Math.round(workout.averageHeartRateBpm)} 次/分` : ''}{typeof workout.activeEnergyKJ === 'number' ? ` · 活动能量 ${Math.round(workout.activeEnergyKJ / 4.184)} 千卡` : ''}</p>
      {workout.id && <WorkoutContent day={day} id={workout.id} />}
    </HealthEventItem>;
  })}</>;
}
