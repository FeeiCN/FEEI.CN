import React, {type ReactNode, useEffect, useState} from 'react';
import {Portal, Tooltip} from '@chakra-ui/react';
import styles from './ActivityDayDetails.module.css';

type ActivityRecord = {
  type: string;
  start?: string;
  end?: string;
  id?: string;
  name?: string;
  durationMinutes?: number;
  steps?: number;
  distanceKm?: number;
  activeEnergyKJ?: number;
  avgHeartRate?: number;
};
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const clock = (value?: string) => value?.match(/(?:^|T| )(\d{2}:\d{2})/)?.[1] ?? '';
const minute = (value?: string) => {
  const time = clock(value);
  if (!time) return null;
  const [h, m] = time.split(':').map(Number);
  return h <= 24 && m < 60 && (h !== 24 || m === 0) ? h * 60 + m : null;
};

export default function ActivityDayDetails({date, children}: {date: string; children: ReactNode}) {
  const [records, setRecords] = useState<ActivityRecord[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setRecords(null);
    setFailed(false);
    setOpened(null);
    fetch(`/data/health/${date.replaceAll('-', '/')}.json`, {signal: controller.signal})
      .then(async (response) => {
        if (!response.ok) throw new Error('Daily activity unavailable');
        const payload = await response.json();
        if (!Array.isArray(payload.timeline)) throw new Error('Invalid activity timeline');
        if (!controller.signal.aborted) {
          const unique = new Map<string, ActivityRecord>();
          for (const record of payload.timeline) {
            if (!record || !['movement', 'stand', 'workout'].includes(record.type)) continue;
            unique.set(record.id ?? `${record.type}-${record.start}-${record.end}`, record);
          }
          setRecords([...unique.values()].sort((a, b) => (a.start ?? '').localeCompare(b.start ?? '')));
        }
      })
      .catch(() => {if (!controller.signal.aborted) {setFailed(true); setRecords([]);}});
    return () => controller.abort();
  }, [date]);
  const workouts = records?.filter((record) => record.type === 'workout') ?? [];
  const segments = records?.flatMap((record) => {
    const start = minute(record.start);
    const end = minute(record.end);
    return record.type !== 'workout' && start !== null && end !== null && end > start ? [{record, start, end}] : [];
  }) ?? [];

  return <>
    <section className={styles.timeline} aria-label="当天活动时段">
      <div className={styles.heading}>当天活动时段</div>
      {records === null ? <p className={styles.note} role="status">正在加载活动记录…</p>
        : failed ? <p className={styles.note} role="status">当天活动明细暂不可用</p>
          : segments.length === 0 ? <p className={styles.note}>暂无活动片段记录</p>
            : <>
              {(['movement', 'stand'] as const).map((type) => <div key={type} className={styles.row}>
                <span>{type === 'movement' ? '移动' : '站立'}</span>
                <div className={styles.track}>
                  {segments.filter(({record}) => record.type === type).map(({record, start, end}) => {
                    const key = `${type}-${start}-${end}`;
                    const label = `${type === 'movement' ? '移动' : '站立'} ${clock(record.start)}–${clock(record.end)}`;
                    return <Tooltip.Root key={key} open={opened === key} onOpenChange={({open}) => setOpened((current) => open ? key : current === key ? null : current)} openDelay={120} closeDelay={80} positioning={{placement: 'top'}}>
                      <Tooltip.Trigger asChild>
                        <button type="button" className={`${styles.segment} ${type === 'stand' ? styles.stand : ''}`}
                          style={{left: `${start / 1440 * 100}%`, width: `${(end - start) / 1440 * 100}%`}}
                          aria-label={label} onClick={() => setOpened(key)} />
                      </Tooltip.Trigger>
                      <Portal><Tooltip.Positioner><Tooltip.Content className={styles.tooltip}>
                        <strong>{label}</strong>
                        {type === 'movement' && <span>{[isNumber(record.steps) ? `约${Math.round(record.steps)}步` : null, isNumber(record.distanceKm) ? `${record.distanceKm.toFixed(2)}公里` : null].filter(Boolean).join(' · ')}</span>}
                        {type === 'stand' && isNumber(record.durationMinutes) && <span>累计站立{Math.round(record.durationMinutes)}分钟</span>}
                      </Tooltip.Content></Tooltip.Positioner></Portal>
                    </Tooltip.Root>;
                  })}
                </div>
              </div>)}
              <div className={styles.axis}><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
              <p className={styles.note}>记录到的活动片段，不等同于全天运动分钟数</p>
            </>}
    </section>
    {children}
    {workouts.length > 0 && <section className={styles.workouts} aria-label="当天训练记录">
      <div className={styles.heading}>当天训练 · {workouts.length}次</div>
      <ul>{workouts.map((workout, index) => <li key={workout.id ?? index}>
        <div className={styles.workoutHeading}><strong>{workout.name || '训练'}</strong>{isNumber(workout.durationMinutes) && <span>{Math.round(workout.durationMinutes)}分钟</span>}</div>
        <time>{clock(workout.start)}–{clock(workout.end)}</time>
        <div className={styles.details}>
          {isNumber(workout.distanceKm) && workout.distanceKm > 0 && <span>{workout.distanceKm.toFixed(2)}公里</span>}
          {isNumber(workout.activeEnergyKJ) && <span>活动{Math.round(workout.activeEnergyKJ / 4.184)}千卡</span>}
          {isNumber(workout.avgHeartRate) && <span>平均心率{Math.round(workout.avgHeartRate)}次/分</span>}
        </div>
      </li>)}</ul>
    </section>}
  </>;
}
