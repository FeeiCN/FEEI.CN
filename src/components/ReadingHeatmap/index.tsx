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

function pickYears(payload: DailyPayload | null): number[] {
  if (!payload?.daily || Object.keys(payload.daily).length === 0) return [];
  const set = new Set<number>();
  for (const date of Object.keys(payload.daily)) {
    const y = Number(date.slice(0, 4));
    if (Number.isFinite(y)) set.add(y);
  }
  return Array.from(set).sort((a, b) => a - b);
}

function makeOption(year: number, payload: DailyPayload, palette: Palette) {
  const daily = payload.daily ?? {};
  const data: [string, number][] = [];
  for (const [date, bucket] of Object.entries(daily)) {
    if (!date.startsWith(`${year}-`)) continue;
    const seconds = Number(bucket?.seconds ?? 0);
    if (seconds > 0) data.push([date, seconds]);
  }

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
    calendar: {
      top: 18,
      left: 38,
      right: 12,
      cellSize: 13,
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
    },
    series: [{
      type: 'heatmap',
      coordinateSystem: 'calendar',
      data,
      itemStyle: {borderRadius: 2},
    }],
  };
}

function YearRow({year, payload, palette}: {year: number; payload: DailyPayload; palette: Palette}) {
  const option = useMemo(() => makeOption(year, payload, palette), [year, payload, palette]);
  return (
    <div className={styles.yearRow}>
      <div className={styles.yearLabel}>{year}</div>
      <ReactECharts
        option={option}
        style={{height: 132, width: 820}}
        opts={{renderer: 'svg'}}
        notMerge
        lazyUpdate
      />
    </div>
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

async function fetchSplitPayload(): Promise<DailyPayload> {
  const indexRes = await fetch('/reading/index.json', {cache: 'no-store'});
  if (!indexRes.ok) {
    const legacyRes = await fetch('/reading/reading_daily.json', {cache: 'no-store'});
    if (!legacyRes.ok) throw new Error('index 与 legacy 均不可访问');
    return legacyRes.json() as Promise<DailyPayload>;
  }
  const index = (await indexRes.json()) as IndexPayload;
  const years = index.activeYears ?? [];
  const yearFiles = await Promise.all(
    years.map(async (y) => {
      const r = await fetch(`/reading/${y}.json`, {cache: 'force-cache'});
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


function HeatmapInner() {
  const {colorMode} = useColorMode();
  const isDark = colorMode === 'dark';
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [payload, setPayload] = useState<DailyPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [palette, setPalette] = useState<Palette>(isDark ? FALLBACK_DARK : FALLBACK_LIGHT);

  useEffect(() => {
    let cancelled = false;
    fetchSplitPayload()
      .then((data) => {
        if (!cancelled) setPayload(data);
      })
      .catch(() => {
        if (!cancelled) setError('数据加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setPalette(readPalette(rootRef.current, isDark));
  }, [isDark, payload]);

  const years = useMemo(() => pickYears(payload), [payload]);
  const hasData = years.length > 0;

  return (
    <div ref={rootRef} className={styles.heatmap} data-theme-mode={isDark ? 'dark' : 'light'}>
      {!payload && !error && <div className={styles.skeleton}>加载阅读日历…</div>}
      {error && <div className={styles.skeleton}>{error}</div>}
      {payload && !hasData && (
        <div className={styles.skeleton}>暂无阅读划线数据，运行 scripts/export_weread_daily_activity.py 后刷新。</div>
      )}
      {payload && hasData && (
        <>
          <div className={styles.scrollWrap}>
            <div className={styles.stack}>
              {years.map((y) => (
                <YearRow key={y} year={y} payload={payload} palette={palette} />
              ))}
            </div>
          </div>
          <div className={styles.footer}>
            <span className={styles.meta}>
              {payload.totals?.activeDays ?? 0} 个阅读日 · 累计 {formatDuration(payload.totals?.totalReadSeconds ?? 0)}
              {payload.exportedAt ? ` · 更新于 ${payload.exportedAt.slice(0, 10)}` : ''}
            </span>
            <Legend palette={palette} />
          </div>
        </>
      )}
    </div>
  );
}

export default function ReadingHeatmap() {
  return (
    <BrowserOnly fallback={<div style={{minHeight: 160}} />}>
      {() => <HeatmapInner />}
    </BrowserOnly>
  );
}
