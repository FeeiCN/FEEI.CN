import React, {useMemo, useState} from 'react';
import styles from './styles.module.css';
import {
  AnalysisInsight,
  DailyHealthTimelineRecord,
  DailyHealthData,
  DriveLog,
  TimelineItem,
  TimelineBand,
  SleepSegment,
  SleepBlock,
  TimelineModel,
  LIFE_START_DATE,
  LIFE_END_DATE,
  formatDateKey,
  diffDays,
  getNestedValue,
  getWeatherCodeLabel,
  getOpenMeteoValue,
  getOpenMeteoHourIndex,
  formatNumber,
  timeToMinute,
  minuteToLabel,
} from './model';

export const MIND_TERM_LABELS: Record<string, string> = {
  pleasant: '愉悦',
  very_pleasant: '非常愉悦',
  slightly_pleasant: '略愉悦',
  neutral: '平静',
  slightly_unpleasant: '略不愉悦',
  unpleasant: '不愉悦',
  happy: '开心',
  confident: '自信',
  calm: '平和',
  satisfied: '满足',
  grateful: '感恩',
  anxious: '焦虑',
  stressed: '有压力',
  work: '工作',
  self_care: '自我照顾',
  family: '家庭',
  health: '健康',
  fitness: '运动',
  money: '财务',
  weather: '天气',
};

export function recordTitle(record: DailyHealthTimelineRecord): string {
  if (record.type === 'sleep') return record.label || '睡眠';
  if (record.type === 'workout') return record.name || '运动';
  if (record.type === 'handwashing') return '洗手';
  if (record.type === 'medication') return '用药记录';
  if (record.type === 'state_of_mind') return '心境记录';
  return record.type || '健康';
}

export function recordDetail(record: DailyHealthTimelineRecord): string {
  const parts: string[] = [];
  if (record.durationMinutes) parts.push(`${formatNumber(record.durationMinutes)} 分钟`);
  if (record.steps) parts.push(`${formatNumber(record.steps)} 步`);
  if (record.distanceKm) parts.push(`${formatNumber(record.distanceKm, 1)} km`);
  if (record.flights) parts.push(`${formatNumber(record.flights, 1)} 层`);
  if (record.activeEnergyKJ) parts.push(`${formatNumber(record.activeEnergyKJ)} kJ`);
  if (record.energyKcal) parts.push(`${formatNumber(record.energyKcal)} kcal`);
  if (record.avgHeartRate) parts.push(`均心 ${formatNumber(record.avgHeartRate)} bpm`);
  if (record.maxHeartRate) parts.push(`峰值 ${formatNumber(record.maxHeartRate)} bpm`);
  if (record.durationSeconds) parts.push(`${formatNumber(record.durationSeconds)} 秒`);
  if (record.status) parts.push(record.status);
  if (record.valenceClassification) parts.push(MIND_TERM_LABELS[record.valenceClassification] || record.valenceClassification);
  if (record.labels?.length) parts.push(record.labels.map((label) => MIND_TERM_LABELS[label] || label).join(' / '));
  if (record.associations?.length) parts.push(`关联 ${record.associations.map((label) => MIND_TERM_LABELS[label] || label).join(' / ')}`);
  return parts.join(' · ');
}

export function timelineType(type?: string): TimelineItem['type'] | null {
  if (type === 'sleep' || type === 'workout') {
    return type;
  }
  if (type === 'medication') return 'medication';
  if (type === 'state_of_mind') return 'mind';
  return null;
}

export function bandType(type?: string): TimelineBand['type'] | null {
  if (
    type === 'movement'
    || type === 'stand'
    || type === 'daylight'
    || type === 'stairs'
    || type === 'active_energy'
    || type === 'handwashing'
  ) {
    return type;
  }
  return null;
}

export function bandIntensity(record: DailyHealthTimelineRecord): number {
  if (record.type === 'movement') return Math.min(1, Number(record.steps || 0) / 5000);
  if (record.type === 'stand') return Math.min(1, Number(record.durationMinutes || 0) / 60);
  if (record.type === 'daylight') return Math.min(1, Number(record.durationMinutes || 0) / 120);
  if (record.type === 'stairs') return Math.min(1, Number(record.flights || 0) / 30);
  if (record.type === 'active_energy') return Math.min(1, Number(record.energyKJ || record.activeEnergyKJ || 0) / 1000);
  if (record.type === 'handwashing') return Math.min(1, Number(record.durationSeconds || 0) / 20);
  return 0.4;
}

export function timelineBoundaryMinute(value: unknown, selectedDate: string | undefined): number | null {
  const text = String(value || '');
  const minute = timeToMinute(text);
  if (minute === null) return null;
  const date = text.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  if (!selectedDate || !date) return minute;
  if (date < selectedDate) return 0;
  if (date > selectedDate) return 1440;
  return minute;
}

export function buildHealthTimeline(dailyHealth: DailyHealthData | null): TimelineModel {
  const selectedDate = dailyHealth?.date;
  const exerciseValue = getNestedValue(dailyHealth?.summary, ['exerciseTime', 'totalMinutes']);
  const exerciseNumber = Number(exerciseValue);
  const model: TimelineModel = {
    items: [],
    bands: [],
    sleep: [],
    weather: [],
    exerciseMinutes: exerciseValue !== undefined && exerciseValue !== null && Number.isFinite(exerciseNumber)
      ? exerciseNumber
      : null,
    healthAvailable: Boolean(dailyHealth),
    healthObservedUntil: null,
    driveAvailable: false,
  };
  const sleepSegments: SleepSegment[] = [];

  (dailyHealth?.timeline || []).forEach((record) => {
    const startMinute = timelineBoundaryMinute(record.start, selectedDate);
    const type = timelineType(record.type);
    let endMinute = timelineBoundaryMinute(record.end, selectedDate);
    if (startMinute === null) return;
    if (endMinute === null && (type === 'medication' || type === 'mind')) endMinute = startMinute;
    if (endMinute === null) return;
    const startDate = String(record.start || '').slice(0, 10);
    const endDate = String(record.end || '').slice(0, 10);
    if (selectedDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate) && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      if (endDate < selectedDate || startDate > selectedDate) return;
    } else if (endMinute < startMinute) {
      endMinute = 1440;
    }
    if (type === 'medication' || type === 'mind') {
      model.healthObservedUntil = Math.max(model.healthObservedUntil || 0, startMinute);
      model.items.push({
        type,
        title: recordTitle(record),
        detail: recordDetail(record),
        startMinute,
      });
      return;
    }
    if (endMinute <= startMinute) {
      const durationSeconds = Number(record.durationSeconds);
      const durationMinutes = Number(record.durationMinutes);
      const statedDuration = Number.isFinite(durationSeconds) && durationSeconds > 0
        ? durationSeconds / 60
        : Number.isFinite(durationMinutes) && durationMinutes > 0 ? durationMinutes : 0;
      if (statedDuration > 0) endMinute = Math.min(1440, startMinute + statedDuration);
    }
    if (endMinute <= startMinute) return;
    endMinute = Math.min(1440, endMinute);
    model.healthObservedUntil = Math.max(model.healthObservedUntil || 0, endMinute);

    const band = bandType(record.type);
    if (band) {
      model.bands.push({
        type: band,
        startMinute,
        endMinute,
        intensity: bandIntensity(record),
        title: recordTitle(record),
        detail: recordDetail(record),
      });
      return;
    }

    if (!type) return;
    if (type === 'sleep') {
      sleepSegments.push({
        stage: record.stage,
        label: record.label || '睡眠',
        startMinute,
        endMinute,
      });
      return;
    }
    model.items.push({
      type,
      title: recordTitle(record),
      detail: recordDetail(record),
      startMinute,
      endMinute,
      stage: record.stage,
    });
  });

  sleepSegments
    .sort((left, right) => left.startMinute - right.startMinute)
    .forEach((segment) => {
      const current = model.sleep.at(-1);
      if (!current || segment.startMinute - current.endMinute > 60) {
        model.sleep.push({
          startMinute: segment.startMinute,
          endMinute: segment.endMinute,
          detail: '',
          segments: [segment],
        });
        return;
      }
      current.startMinute = Math.min(current.startMinute, segment.startMinute);
      current.endMinute = Math.max(current.endMinute, segment.endMinute);
      current.segments.push(segment);
    });
  model.sleep.forEach((block) => {
    block.detail = summarizeSleep(block);
  });
  return model;
}

export function summarizeSleep(block: SleepBlock): string {
  const minutes = Math.round(block.segments.reduce(
    (total, segment) => segment.stage === 'awake'
      ? total
      : total + Math.max(0, segment.endMinute - segment.startMinute),
    0,
  ));
  return `${Math.floor(minutes / 60)}h${minutes % 60 ? `${minutes % 60}m` : ''}`;
}

export function getSleepStageMinutes(block: SleepBlock): Record<string, number> {
  return block.segments.reduce<Record<string, number>>((result, segment) => {
    const key = segment.stage || segment.label;
    result[key] = (result[key] || 0) + Math.max(0, segment.endMinute - segment.startMinute);
    return result;
  }, {});
}

export const SLEEP_STAGE_ROWS = [
  {key: 'awake', label: '清醒'},
  {key: 'rem', label: '快速动眼'},
  {key: 'core', label: '核心'},
  {key: 'deep', label: '深度'},
];

export function buildTimelineModel({
  dailyHealth,
  drive,
  weather,
}: {
  dailyHealth: DailyHealthData | null;
  drive: DriveLog | null;
  weather: unknown;
}): TimelineModel {
  const model = buildHealthTimeline(dailyHealth);
  model.driveAvailable = drive !== null;

  Object.entries(drive || {}).forEach(([time, item]) => {
    const minute = timeToMinute(time);
    if (minute === null) return;
    model.items.push({
      type: 'drive',
      title: item.action || '行车',
      detail: item.address,
      startMinute: minute,
    });
  });

  if (getNestedValue(weather, ['hourly', 'weather_code'])) {
    [0, 6, 12, 18].forEach((hour) => {
      const index = getOpenMeteoHourIndex(weather, hour);
      if (index < 0) return;
      const code = getOpenMeteoValue(weather, 'hourly', 'weather_code', index);
      const temp = getOpenMeteoValue(weather, 'hourly', 'temperature_2m', index);
      const precip = Number(getOpenMeteoValue(weather, 'hourly', 'precipitation', index));
      const detail = [
        Number.isFinite(Number(temp)) ? `${Math.round(Number(temp))}°C` : '',
        Number.isFinite(precip) && precip > 0 ? `降水 ${precip.toFixed(1)}mm` : '',
      ].filter(Boolean).join(' · ');
      model.weather.push({
        type: 'weather',
        title: getWeatherCodeLabel(code),
        detail: detail || undefined,
        startMinute: hour * 60,
      });
    });
  } else {
    const hourly = (getNestedValue(weather, ['weather', 0, 'hourly']) as Array<Record<string, unknown>> | undefined) || [];
    [0, 6, 12, 18].forEach((hour) => {
      const entry = hourly.find((item) => Number(item.time || 0) === hour * 100);
      if (!entry) return;
      const description = getNestedValue(entry, ['lang_zh-cn', 0, 'value'])
        || getNestedValue(entry, ['weatherDesc', 0, 'value']);
      const temp = entry.tempC || entry.FeelsLikeC;
      model.weather.push({
        type: 'weather',
        title: description ? String(description) : '天气',
        detail: temp ? `${temp}°C` : undefined,
        startMinute: hour * 60,
      });
    });
  }

  model.items.sort((left, right) => left.startMinute - right.startMinute);
  model.bands.sort((left, right) => left.startMinute - right.startMinute);
  model.weather.sort((left, right) => left.startMinute - right.startMinute);
  return model;
}

export function LifeCalendar(): React.ReactNode {
  const today = formatDateKey(new Date());
  const startYear = Number(LIFE_START_DATE.slice(0, 4));
  const endYear = Number(LIFE_END_DATE.slice(0, 4));
  const years = Array.from({length: endYear - startYear + 1}, (_, index) => startYear + index);
  const totalDays = diffDays(LIFE_START_DATE, LIFE_END_DATE) + 1;
  const livedDays = Math.min(totalDays, diffDays(LIFE_START_DATE, today) + 1);
  const progress = Math.min(100, (livedDays / totalDays) * 100);

  return (
    <section className={styles.lifeCalendar}>
      <div className={styles.lifeStats}>
        <div>
          <strong>{formatNumber(livedDays)}</strong>
          <span>已度过的日子</span>
        </div>
        <div>
          <strong>{formatNumber(Math.max(0, totalDays - livedDays))}</strong>
            <span>参照剩余日子</span>
        </div>
        <div>
          <strong>{formatNumber(progress, 1)}%</strong>
          <span>{LIFE_START_DATE} - {LIFE_END_DATE}</span>
        </div>
      </div>
      <div className={styles.lifeProgress}>
        <div className={styles.lifeProgressTrack}>
          <span className={styles.lifeProgressFill} style={{width: `${progress}%`}} />
          <span className={styles.lifeProgressToday} style={{left: `${progress}%`}} />
        </div>
        <div className={styles.lifeProgressLabels}>
          <span>出生</span>
          <strong>今天</strong>
          <span>100 岁参照</span>
        </div>
      </div>
      <div className={styles.lifeYearMap} aria-label={`${startYear} 至 ${endYear} 年人生年份进度`}>
        {years.map((year) => {
          const isPast = year < new Date().getFullYear();
          const isCurrent = year === new Date().getFullYear();
          return (
            <span
              key={year}
              className={[
                styles.lifeYearCell,
                isPast ? styles.lifeYearPast : '',
                isCurrent ? styles.lifeYearCurrent : '',
              ].join(' ')}
              title={`${year} 年`}
            >
              {year % 10 === 0 ? year : ''}
            </span>
          );
        })}
      </div>
    </section>
  );
}
export function InsightList({items}: {items: AnalysisInsight[]}): React.ReactNode {
  const valid = items.filter((item) => item.summary || item.positioning || item.evidence?.length);
  if (!valid.length) {
    return <p className={styles.muted}>暂无 AI 分析。</p>;
  }

  return valid.map((item, index) => (
    <article key={index} className={styles.insight}>
      {item.expert_view ? <span className={styles.pill}>{item.expert_view}</span> : null}
      {item.summary ? <p className={styles.lead}>{item.summary}</p> : null}
      {item.positioning ? <p>{item.positioning}</p> : null}
      {item.means ? <p><strong>说明：</strong>{item.means}</p> : null}
      {item.not_means ? <p className={styles.boundary}><strong>不代表：</strong>{item.not_means}</p> : null}
      {item.evidence?.length ? (
        <ul>
          {item.evidence.map((value) => (
            <li key={value}>{value}</li>
          ))}
        </ul>
      ) : null}
      {item.uncertainty ? <p className={styles.boundary}>边界：{item.uncertainty}</p> : null}
    </article>
  ));
}

export type TimelineFlowEntry = TimelineItem & {key: string; completedTrip?: boolean};

export function getSleepStageSummary(block: SleepBlock): string {
  const stages = getSleepStageMinutes(block);
  const knownKeys = new Set(SLEEP_STAGE_ROWS.map((stage) => stage.key));
  return [
    ...SLEEP_STAGE_ROWS
      .filter((stage) => stages[stage.key])
      .map((stage) => `${stage.label} ${formatNumber(stages[stage.key])}m`),
    ...Object.entries(stages)
      .filter(([key, minutes]) => !knownKeys.has(key) && minutes > 0)
      .map(([key, minutes]) => `${key || '未细分睡眠'} ${formatNumber(minutes)}m`),
  ].join(' · ');
}

export function buildTimelineFlowEntries(model: TimelineModel): TimelineFlowEntry[] {
  const entries: TimelineFlowEntry[] = model.sleep.map((block, index) => ({
    key: `sleep-${index}`,
    type: 'sleep',
    title: `睡眠 ${block.detail}`,
    detail: getSleepStageSummary(block),
    startMinute: block.startMinute,
    endMinute: block.endMinute,
  }));

  model.items
    .filter((item) => item.type !== 'drive')
    .sort((left, right) => left.startMinute - right.startMinute)
    .filter((item, index, values) => {
      const previous = values[index - 1];
      if (item.type !== 'medication' && item.type !== 'mind') return true;
      return !previous
        || item.type !== previous.type
        || item.title !== previous.title
        || item.detail !== previous.detail
        || item.startMinute - previous.startMinute > 1;
    })
    .forEach((item, index) => {
      entries.push({...item, key: `${item.type}-${item.startMinute}-${index}`});
    });

  const drives = model.items
    .filter((item) => item.type === 'drive')
    .sort((left, right) => left.startMinute - right.startMinute)
    .filter((item, index, values) => {
      const previous = values[index - 1];
      return !previous
        || item.title !== previous.title
        || item.detail !== previous.detail
        || item.startMinute - previous.startMinute > 2;
    });
  let openDrive: TimelineItem | null = null;
  for (const [index, current] of drives.entries()) {
    if (/上车/.test(current.title)) {
      if (openDrive) {
        entries.push({...openDrive, key: `drive-open-${openDrive.startMinute}-${index}`, title: '上车记录'});
      }
      openDrive = current;
      continue;
    }
    if (/下车/.test(current.title) && openDrive && current.startMinute >= openDrive.startMinute) {
      entries.push({
        key: `drive-${openDrive.startMinute}-${current.startMinute}`,
        type: 'drive',
        title: '行程',
        detail: [openDrive.detail, current.detail].filter(Boolean).join(' -> '),
        startMinute: openDrive.startMinute,
        endMinute: current.startMinute,
        completedTrip: true,
      });
      openDrive = null;
      continue;
    }
    entries.push({...current, key: `drive-point-${current.startMinute}-${index}`, title: /下车/.test(current.title) ? '下车记录' : current.title});
  }
  if (openDrive) entries.push({...openDrive, key: `drive-open-${openDrive.startMinute}-last`, title: '上车记录'});

  model.weather.forEach((item, index) => entries.push({...item, key: `weather-${item.startMinute}-${index}`}));
  return entries.sort((left, right) => left.startMinute - right.startMinute);
}

export function TimelinePanel({model}: {model: TimelineModel}): React.ReactNode {
  const flowItems = useMemo(() => buildTimelineFlowEntries(model), [model]);
  return (
    <section className={styles.timelinePanel}>
      <div className={styles.panelHead}>
        <div>
          <strong>24 小时客观轨迹</strong>
          <small>{flowItems.length} 个关键记录 · {model.bands.length} 个行为切片</small>
        </div>
      </div>
      <CompactDayTimeline model={model} flowItems={flowItems} />
    </section>
  );
}

export function CompactDayTimeline({model, flowItems}: {model: TimelineModel; flowItems: TimelineFlowEntry[]}): React.ReactNode {
  const [showFullDay, setShowFullDay] = useState(false);
  const sleepMinutes = Math.round(model.sleep.reduce(
    (total, block) => total + block.segments.reduce(
      (blockTotal, segment) => segment.stage === 'awake'
        ? blockTotal
        : blockTotal + Math.max(0, segment.endMinute - segment.startMinute),
      0,
    ),
    0,
  ));
  const movementMinutes = model.bands
    .filter((band) => band.type === 'movement')
    .reduce((total, band) => total + Math.max(0, band.endMinute - band.startMinute), 0);
  const tripCount = flowItems.filter((item) => item.completedTrip).length;
  let observedMinutes = [
    ...flowItems
      .filter((item) => item.type !== 'sleep' && item.type !== 'weather')
      .flatMap((item) => [item.startMinute, item.endMinute ?? item.startMinute]),
    ...model.bands.flatMap((band) => [band.startMinute, band.endMinute]),
  ].filter((minute) => Number.isFinite(minute));
  if (!observedMinutes.length) {
    observedMinutes = model.sleep.flatMap((block) => [block.startMinute, block.endMinute]);
  }
  let focusStart = observedMinutes.length ? Math.max(0, Math.floor((Math.min(...observedMinutes) - 60) / 60) * 60) : 0;
  let focusEnd = observedMinutes.length ? Math.min(1440, Math.ceil((Math.max(...observedMinutes) + 60) / 60) * 60) : 1440;
  if (focusEnd - focusStart < 360) {
    const center = (focusStart + focusEnd) / 2;
    focusStart = Math.max(0, Math.floor((center - 180) / 60) * 60);
    focusEnd = Math.min(1440, focusStart + 360);
    focusStart = Math.max(0, focusEnd - 360);
  }
  const windowStart = showFullDay ? 0 : focusStart;
  const windowEnd = showFullDay ? 1440 : focusEnd;
  const windowMinutes = Math.max(1, windowEnd - windowStart);
  const axisStep = windowMinutes > 1200 ? 240 : windowMinutes > 480 ? 120 : 60;
  const axisMarks: number[] = [windowStart];
  for (let minute = Math.ceil((windowStart + 1) / axisStep) * axisStep; minute < windowEnd; minute += axisStep) {
    if (minute - windowStart >= axisStep * 0.65 && windowEnd - minute >= axisStep * 0.65) axisMarks.push(minute);
  }
  axisMarks.push(windowEnd);
  const position = (minute: number) => Math.min(100, Math.max(0, ((minute - windowStart) / windowMinutes) * 100));
  const segmentStyle = (start: number, end: number) => {
    const clippedStart = Math.max(windowStart, start);
    const clippedEnd = Math.min(windowEnd, Math.max(start + 1, end));
    if (clippedEnd <= clippedStart) return null;
    return {left: `${position(clippedStart)}%`, width: `${Math.max(0.7, position(clippedEnd) - position(clippedStart))}%`};
  };
  const densityRows: Array<{label: string; types: TimelineBand['type'][]}> = [
    {label: '移动', types: ['movement']},
    {label: '活动能量', types: ['active_energy']},
    {label: '站立', types: ['stand']},
    {label: '日照', types: ['daylight']},
    {label: '爬楼', types: ['stairs']},
    {label: '洗手', types: ['handwashing']},
  ];
  const allSleepSegments = model.sleep.flatMap((block) => block.segments);
  const visibleSleepSegments = allSleepSegments.filter(
    (segment) => segment.endMinute > windowStart && segment.startMinute < windowEnd,
  );
  const healthStatus = !model.healthAvailable
    ? '健康数据缺失'
    : model.healthObservedUntil === null ? '健康轨迹无记录' : `健康记录至 ${minuteToLabel(model.healthObservedUntil)}`;

  return (
    <div className={styles.compactDayTimeline}>
      <div className={styles.timelineSummaryStrip}>
        <div><strong>{!model.healthAvailable ? '无数据' : sleepMinutes ? `${Math.floor(sleepMinutes / 60)}h${sleepMinutes % 60 ? `${sleepMinutes % 60}m` : ''}` : '无记录'}</strong><span>睡眠</span></div>
        <div><strong>{model.exerciseMinutes === null ? '无数据' : `${formatNumber(model.exerciseMinutes)}m`}</strong><span>锻炼时间</span></div>
        <div><strong>{!model.healthAvailable ? '无数据' : `${formatNumber(movementMinutes)}m`}</strong><span>移动片段</span></div>
        <div><strong>{model.driveAvailable ? tripCount : '无数据'}</strong><span>完整行程</span></div>
      </div>

      <div className={styles.timelineWindowHead}>
        <div>
          <strong>{showFullDay ? '完整一天' : '记录窗口'} · {minuteToLabel(windowStart)}-{minuteToLabel(windowEnd)}</strong>
          <span>{healthStatus}</span>
        </div>
        <button
          type="button"
          aria-controls="daily-timeline-overview"
          aria-pressed={showFullDay}
          onClick={() => setShowFullDay((value) => !value)}
        >
          {showFullDay ? '聚焦记录' : '完整 24 小时'}
        </button>
      </div>

      <div id="daily-timeline-overview" className={styles.timelineOverview}>
        <div className={styles.timelineHorizontalAxis} aria-hidden="true">
          {axisMarks.map((minute) => <span key={minute} style={{left: `${position(minute)}%`}}>{minuteToLabel(minute)}</span>)}
        </div>
        {allSleepSegments.length ? (
          <details className={styles.timelineDensityDetails}>
            <summary className={styles.timelineDensityRow} aria-label={`睡眠 ${allSleepSegments.length} 个阶段切片`}>
              <span>睡眠</span>
              <div aria-hidden="true">
                {visibleSleepSegments.map((segment, index) => {
                  const range = segmentStyle(segment.startMinute, segment.endMinute);
                  return range ? (
                    <i
                      key={`${segment.startMinute}-${index}`}
                      className={segment.stage && ['awake', 'rem', 'core', 'deep'].includes(segment.stage)
                        ? styles[`sleepStageSegment_${segment.stage}`]
                        : styles.timelineDensitySleep}
                      style={range}
                      title={`${minuteToLabel(segment.startMinute, true)}-${minuteToLabel(segment.endMinute, true)} ${segment.label}`}
                    />
                  ) : null;
                })}
              </div>
            </summary>
            <ol className={styles.timelineSliceList}>
              {allSleepSegments.map((segment, index) => (
                <li key={`${segment.startMinute}-${segment.endMinute}-${index}`}>
                  <time>{minuteToLabel(segment.startMinute, true)}-{minuteToLabel(segment.endMinute, true)}</time>
                  <span>{segment.label}</span>
                </li>
              ))}
            </ol>
          </details>
        ) : null}
        {densityRows.map((row) => {
          const rowBands = model.bands.filter((band) => row.types.includes(band.type));
          const visibleBands = rowBands.filter((band) => band.endMinute > windowStart && band.startMinute < windowEnd);
          const totalMinutes = rowBands.reduce((total, band) => total + Math.max(0, band.endMinute - band.startMinute), 0);
          if (!rowBands.length) {
            return (
              <div key={row.label} className={styles.timelineDensityRow}>
                <span>{row.label}</span>
                <div role="img" aria-label={`${row.label}无记录`} />
              </div>
            );
          }
          return (
            <details key={row.label} className={styles.timelineDensityDetails}>
              <summary className={styles.timelineDensityRow} aria-label={`${row.label} ${rowBands.length} 个切片，共 ${formatNumber(totalMinutes, 1)} 分钟`}>
                <span>{row.label}</span>
                <div aria-hidden="true">
                  {visibleBands.map((band, index) => {
                    const range = segmentStyle(band.startMinute, band.endMinute);
                    return range ? (
                      <i
                        key={`${band.type}-${band.startMinute}-${index}`}
                        className={styles[`timelineBand_${band.type}`]}
                        style={{...range, opacity: 0.35 + band.intensity * 0.55}}
                        title={`${minuteToLabel(band.startMinute, true)}-${minuteToLabel(band.endMinute, true)} ${band.detail || band.title}`}
                      />
                    ) : null;
                  })}
                </div>
              </summary>
              <ol className={styles.timelineSliceList}>
                {rowBands.map((band, index) => (
                  <li key={`${band.type}-${band.startMinute}-${band.endMinute}-${index}`}>
                    <time>{minuteToLabel(band.startMinute, true)}-{minuteToLabel(band.endMinute, true)}</time>
                    <span>{band.detail || band.title}</span>
                  </li>
                ))}
              </ol>
            </details>
          );
        })}
      </div>

      {flowItems.length ? (
        <ol className={styles.timelineEventList}>
          {flowItems.map((item) => (
            <li key={item.key} className={styles[`timelineFlow_${item.type}`]}>
              <time>{minuteToLabel(item.startMinute)}{item.endMinute !== undefined ? `-${minuteToLabel(item.endMinute)}` : ''}</time>
              <div>
                <strong>{item.title}</strong>
                {item.detail ? <span>{item.detail}</span> : null}
              </div>
            </li>
          ))}
        </ol>
      ) : <p className={styles.muted}>当日暂无可用的客观轨迹。</p>}
    </div>
  );
}
