import React, {useEffect, useMemo, useRef, useState} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import {useColorMode} from '@docusaurus/theme-common';
import ReactECharts from 'echarts-for-react';
import styles from './styles.module.css';

type DailyBucket = {seconds?: number; count?: number; books?: string[]};

type DailyPayload = {
  exportedAt?: string;
  source?: string;
  dateRange?: {start: string; end: string};
  daily?: Record<string, DailyBucket>;
  totals?: {activeDays?: number; totalReadSeconds?: number; activeYears?: string[]};
};

type IndexPayload = {
  exportedAt?: string;
  source?: string;
  activeYears?: string[];
  yearRange?: {start: string; end: string};
  dateRange?: {start: string; end: string};
  totals?: {activeDays?: number; totalReadSeconds?: number};
};

type YearFile = {
  year?: string;
  exportedAt?: string;
  daily?: Record<string, DailyBucket>;
  yearTotals?: {activeDays?: number; totalReadSeconds?: number};
};

type ReadingHeatmapProps = {
  daily?: Record<string, DailyBucket>;
  years?: number[];
  dateRange?: {start: string; end: string};
  totals?: {activeDays?: number; totalReadSeconds?: number};
  exportedAt?: string;
  emptyHint?: string;
};

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return s ? `${m} 分 ${s} 秒` : `${m} 分钟`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h} 小时 ${rm} 分` : `${h} 小时`;
}

type Palette = {
  empty: string;
  l1: string; l2: string; l3: string; l4: string; l5: string;
  split: string;
  label: string;
  tooltipBg: string;
  tooltipBorder: string;
};

const FALLBACK_LIGHT: Palette = {
  empty: '#ebedf0',
  l1: '#9be9a8', l2: '#40c463', l3: '#30a14e', l4: '#216e39', l5: '#0a4622',
  split: 'rgba(15, 23, 42, 0.08)',
  label: '#64748b',
  tooltipBg: '#ffffff',
  tooltipBorder: 'rgba(148, 163, 184, 0.32)',
};

const FALLBACK_DARK: Palette = {
  empty: '#161b22',
  l1: '#0e4429', l2: '#006d32', l3: '#26a641', l4: '#39d353', l5: '#7ee787',
  split: 'rgba(148, 163, 184, 0.12)',
  label: '#94a3b8',
  tooltipBg: '#1e293b',
  tooltipBorder: 'rgba(148, 163, 184, 0.28)',
};

const DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];
const MONTH_NAMES = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

const CHART_WIDTH = 820;
const CHART_LEFT = 38;
const CHART_RIGHT = 12;
const CHART_TOP = 18;
const CHART_BOTTOM = 14;
const CELL_SIZE = 13;
const YEAR_ROW_HEIGHT = 120;

function readPalette(el: HTMLElement | null, isDark: boolean): Palette {
  const base = isDark ? FALLBACK_DARK : FALLBACK_LIGHT;
  if (!el || typeof window === 'undefined') return base;
  const cs = window.getComputedStyle(el);
  const pick = (key: string, fallback: string) => {
    const v = cs.getPropertyValue(key).trim();
    return v || fallback;
  };
  return {
    empty: pick('--hm-empty', base.empty),
    l1: pick('--hm-l1', base.l1),
    l2: pick('--hm-l2', base.l2),
    l3: pick('--hm-l3', base.l3),
    l4: pick('--hm-l4', base.l4),
    l5: pick('--hm-l5', base.l5),
    split: pick('--hm-split', base.split),
    label: pick('--hm-label', base.label),
    tooltipBg: pick('--hm-tooltip-bg', base.tooltipBg),
    tooltipBorder: pick('--hm-tooltip-border', base.tooltipBorder),
  };
}

function pickYearsFromDaily(daily: Record<string, DailyBucket> | undefined): number[] {
  if (!daily) return [];
  const set = new Set<number>();
  for (const date of Object.keys(daily)) {
    const y = Number(date.slice(0, 4));
    if (Number.isFinite(y)) set.add(y);
  }
  return Array.from(set).sort((a, b) => b - a);
}

function makeOption(years: number[], payload: DailyPayload, palette: Palette) {
  const daily = payload.daily ?? {};
  const calendars: Record<string, unknown>[] = [];
  const series: Record<string, unknown>[] = [];

  years.forEach((year, idx) => {
    const data: [string, number][] = [];
    for (const [date, bucket] of Object.entries(daily)) {
      if (!date.startsWith(`${year}-`)) continue;
      const seconds = Number(bucket?.seconds ?? 0);
      if (seconds > 0) data.push([date, seconds]);
    }

    calendars.push({
      top: CHART_TOP + idx * YEAR_ROW_HEIGHT,
      left: CHART_LEFT,
      right: CHART_RIGHT,
      cellSize: CELL_SIZE,
      range: [`${year}-01-01`, `${year}-12-31`],
      splitLine: {show: false},
      itemStyle: {
        color: palette.empty,
        borderWidth: 2,
        borderColor: 'transparent',
        borderRadius: 2,
      },
      yearLabel: {show: false},
      monthLabel: {
        color: palette.label,
        fontSize: 10,
        nameMap: MONTH_NAMES,
        margin: 6,
      },
      dayLabel: {
        color: palette.label,
        fontSize: 10,
        firstDay: 1,
        nameMap: DAY_NAMES,
        margin: 6,
      },
    });

    series.push({
      type: 'heatmap',
      coordinateSystem: 'calendar',
      calendarIndex: idx,
      data,
      itemStyle: {borderRadius: 2},
    });
  });

  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      backgroundColor: palette.tooltipBg,
      borderColor: palette.tooltipBorder,
      borderWidth: 1,
      textStyle: {color: palette.label, fontSize: 12},
      formatter: (p: any) => {
        const value = p?.value as [string, number] | undefined;
        if (!Array.isArray(value)) return '';
        const [date, seconds] = value;
        const bucket = daily[date];
        const books = bucket?.books ?? [];
        const head = `<b>${date}</b><br/>阅读 ${formatDuration(seconds)}`;
        if (!books.length) return head;
        const top = books.slice(0, 3).map((b) => `《${b}》`).join('、');
        const more = books.length > 3 ? ` 等 ${books.length} 本` : '';
        return `${head}<br/>${top}${more}`;
      },
    },
    visualMap: {
      type: 'piecewise',
      show: false,
      pieces: [
        {min: 1, max: 300, color: palette.l1, label: '< 5分钟'},
        {min: 301, max: 900, color: palette.l2, label: '5-15分钟'},
        {min: 901, max: 1800, color: palette.l3, label: '15-30分钟'},
        {min: 1801, max: 3600, color: palette.l4, label: '30-60分钟'},
        {min: 3601, color: palette.l5, label: '> 1小时'},
      ],
    },
    aria: {enabled: true, description: '阅读日历热力图'},
    calendar: calendars,
    series,
  };
}

function YearHeatmap({
  years,
  payload,
  palette,
}: {
  years: number[];
  payload: DailyPayload;
  palette: Palette;
}) {
  const option = useMemo(() => makeOption(years, payload, palette), [years, payload, palette]);
  const totalHeight = CHART_TOP + years.length * YEAR_ROW_HEIGHT + CHART_BOTTOM;
  const showYearLabels = years.length > 1;
  return (
    <div className={styles.chartInner} style={{height: totalHeight, width: CHART_WIDTH}}>
      {showYearLabels &&
        years.map((year, idx) => (
          <div
            key={year}
            className={styles.yearLabel}
            style={{top: CHART_TOP + idx * YEAR_ROW_HEIGHT, height: YEAR_ROW_HEIGHT}}
          >
            {year}
          </div>
        ))}
      <ReactECharts
        option={option}
        style={{height: totalHeight, width: CHART_WIDTH}}
        opts={{renderer: 'svg'}}
        notMerge
        lazyUpdate
      />
    </div>
  );
}

function stripLevel(seconds: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (seconds <= 0) return 0;
  if (seconds <= 300) return 1;
  if (seconds <= 900) return 2;
  if (seconds <= 1800) return 3;
  if (seconds <= 3600) return 4;
  return 5;
}

function HeatmapStrip({
  daily,
  palette,
  yearLabel,
  exportedAt,
}: {
  daily: Record<string, {seconds?: number; count?: number; books?: string[]}>;
  palette: Palette;
  yearLabel: string;
  exportedAt?: string;
}) {
  const entries = useMemo<[string, number][]>(() => {
    return Object.entries(daily)
      .map(([date, b]) => [date, Number(b?.seconds ?? 0)] as [string, number])
      .filter(([, s]) => s > 0)
      .sort(([a], [b]) => a.localeCompare(b));
  }, [daily]);

  return (
    <>
      <div className={styles.strip}>
        {entries.map(([date, sec]) => (
          <div
            key={date}
            role="img"
            aria-label={`${date} 阅读 ${formatDuration(sec)}`}
            className={styles.stripCell}
            data-level={stripLevel(sec)}
            style={{
              backgroundColor:
                stripLevel(sec) === 0
                  ? palette.empty
                  : [
                      palette.l1,
                      palette.l2,
                      palette.l3,
                      palette.l4,
                      palette.l5,
                    ][stripLevel(sec) - 1],
            }}
            title={`${date} · ${formatDuration(sec)}`}
          />
        ))}
      </div>
      <div className={styles.footer}>
        <Legend palette={palette} />
      </div>
    </>
  );
}

function Legend({palette}: {palette: Palette}) {
  const cells = [
    {color: palette.empty, label: '无'},
    {color: palette.l1, label: '< 5分'},
    {color: palette.l2, label: '5-15分'},
    {color: palette.l3, label: '15-30分'},
    {color: palette.l4, label: '30-60分'},
    {color: palette.l5, label: '> 1时'},
  ];
  return (
    <div className={styles.legend}>
      {cells.map((c, i) => (
        <span key={i} className={styles.legendItem}>
          <span className={styles.legendCell} style={{backgroundColor: c.color}} />
          <span className={styles.legendText}>{c.label}</span>
        </span>
      ))}
    </div>
  );
}

const SKELETON_COLS = 52;
const SKELETON_ROWS = 7;
const SKELETON_CELLS = SKELETON_COLS * SKELETON_ROWS;

function HeatmapSkeleton() {
  return (
    <div className={styles.skeleton}>
      <div className={styles.skeletonGrid}>
        {Array.from({length: SKELETON_CELLS}).map((_, i) => (
          <span
            key={i}
            className={styles.skeletonCell}
            style={{animationDelay: `${((i * 37) % 100) / 100}s`}}
          />
        ))}
      </div>
      <div className={styles.skeletonMessage}>加载阅读日历…</div>
    </div>
  );
}

async function fetchSplitPayload(): Promise<DailyPayload> {
  const indexRes = await fetch('/data/reading/index.json', {cache: 'no-store'});
  if (!indexRes.ok) {
    throw new Error('阅读索引不可访问');
  }
  const index = (await indexRes.json()) as IndexPayload;
  const years = index.activeYears ?? [];
  const yearCacheBust = index.exportedAt ? `?v=${encodeURIComponent(index.exportedAt)}` : '';
  const yearFiles = await Promise.all(
    years.map(async (y) => {
      const r = await fetch(`/data/reading/${y}.json${yearCacheBust}`, {cache: 'default'});
      if (!r.ok) return {year: y, daily: {}} as YearFile;
      return (await r.json()) as YearFile;
    })
  );

  const mergedDaily: Record<string, DailyBucket> = {};
  for (const yf of yearFiles) {
    for (const [date, bucket] of Object.entries(yf.daily ?? {})) {
      mergedDaily[date] = {
        seconds: Number(bucket.seconds ?? 0),
        books: Array.isArray(bucket.books) ? bucket.books : [],
      };
    }
  }

  return {
    exportedAt: index.exportedAt,
    source: index.source,
    dateRange: index.dateRange,
    daily: mergedDaily,
    totals: index.totals,
  };
}


function HeatmapInner(props: ReadingHeatmapProps) {
  const {colorMode} = useColorMode();
  const isDark = colorMode === 'dark';
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [fetched, setFetched] = useState<DailyPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [palette, setPalette] = useState<Palette>(isDark ? FALLBACK_DARK : FALLBACK_LIGHT);
  const {daily: providedDaily, years: yearsProp, dateRange, totals, exportedAt, emptyHint} = props;

  useEffect(() => {
    if (providedDaily) return;
    let cancelled = false;
    fetchSplitPayload()
      .then((data) => {
        if (!cancelled) setFetched(data);
      })
      .catch(() => {
        if (!cancelled) setError('数据加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [providedDaily]);

  useEffect(() => {
    setPalette(readPalette(rootRef.current, isDark));
  }, [isDark, providedDaily, fetched]);

  const payload: DailyPayload | null = useMemo(() => {
    if (providedDaily) {
      return {daily: providedDaily, dateRange, totals, exportedAt};
    }
    return fetched;
  }, [providedDaily, dateRange, totals, exportedAt, fetched]);

  const years = useMemo<number[]>(() => {
    if (yearsProp && yearsProp.length) return yearsProp;
    return pickYearsFromDaily(payload?.daily);
  }, [yearsProp, payload]);

  const hasData = years.length > 0;
  const dailySize = Object.keys(payload?.daily ?? {}).length;
  const useStrip = years.length === 1 && dailySize > 0 && dailySize <= 90;
  const headerLabel = useMemo(() => {
    if (!years.length) return '';
    if (years.length === 1) return String(years[0]);
    return `${years[years.length - 1]}–${years[0]}`;
  }, [years]);

  return (
    <div ref={rootRef} className={styles.heatmap} data-theme-mode={isDark ? 'dark' : 'light'}>
      {!payload && !error && <HeatmapSkeleton />}
      {error && <div className={styles.message}>{error}</div>}
      {payload && !hasData && (
        <div className={styles.message}>
          {emptyHint ?? '当前范围暂无阅读数据'}
        </div>
      )}
      {payload && hasData && useStrip && (
        <HeatmapStrip
          daily={payload.daily ?? {}}
          palette={palette}
          yearLabel={headerLabel}
          exportedAt={payload.exportedAt}
        />
      )}
      {payload && hasData && !useStrip && (
        <>
          <div className={styles.scrollWrap}>
            <YearHeatmap years={years} payload={payload} palette={palette} />
          </div>
          <div className={styles.footer}>
            <Legend palette={palette} />
          </div>
        </>
      )}
    </div>
  );
}

export default function ReadingHeatmap(props: ReadingHeatmapProps) {
  return (
    <BrowserOnly fallback={<div style={{minHeight: 160}} />}>
      {() => <HeatmapInner {...props} />}
    </BrowserOnly>
  );
}
