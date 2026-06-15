import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import {useColorMode} from '@docusaurus/theme-common';
import styles from './styles.module.css';

type DailyTokenBucket = Record<string, number>;

type MostActiveDay = {
  date?: string;
  token_count?: string;
  image_count?: number;
  video_count?: number;
  music_count?: number;
  voice_character_count?: number;
};

type SummaryPayload = {
  vendor?: string;
  fetchedAt?: string;
  total_days?: number;
  total_token_consumed?: string;
  daily_avg_token_consumed?: string;
  usage_ranking_percent?: number;
  most_active_day?: MostActiveDay;
  active_days?: number;
  current_consecutive_days?: number;
  daily_token_usage?: DailyTokenBucket[];
  base_resp?: {status_code?: number; status_msg?: string};
};

const DATA_PATH = '/llm-usage/minimax/usage_summary.json';

const RANK_COLORS: string[] = [
  'var(--llm-l1)',
  'var(--llm-l2)',
  'var(--llm-l3)',
  'var(--llm-l4)',
  'var(--llm-l5)',
];

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
const MONTH_LABELS = [
  '1月', '2月', '3月', '4月', '5月', '6月',
  '7月', '8月', '9月', '10月', '11月', '12月',
];

function getDayRow(date: Date): number {
  const g = date.getDay();
  return g === 0 ? 6 : g - 1;
}

function parseTokenString(value: string | undefined | null): number {
  if (!value) return 0;
  const trimmed = value.trim();
  const match = /^([\d.]+)\s*([KkMmBb])?/.exec(trimmed);
  if (!match) return 0;
  const num = Number(match[1]);
  const unit = (match[2] || '').toUpperCase();
  if (!Number.isFinite(num)) return 0;
  if (unit === 'K') return num * 1_000;
  if (unit === 'M') return num * 1_000_000;
  if (unit === 'B') return num * 1_000_000_000;
  return num;
}

function formatTokenCount(value: number): string {
  if (!value) return '0';
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

function pickLevel(tokens: number, max: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (!tokens || tokens <= 0 || max <= 0) return 0;
  const ratio = tokens / max;
  if (ratio <= 0.2) return 1;
  if (ratio <= 0.4) return 2;
  if (ratio <= 0.6) return 3;
  if (ratio <= 0.8) return 4;
  return 5;
}

function dateMinusDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() - days);
  return d;
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function stripLevelForTokens(tokens: number, max: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (!tokens || tokens <= 0) return 0;
  return pickLevel(tokens, max);
}

function vendorColor(level: 0 | 1 | 2 | 3 | 4 | 5): string {
  if (level === 0) return 'var(--llm-empty)';
  return RANK_COLORS[level - 1];
}

function StatCard({value, label}: {value: React.ReactNode; label: string}) {
  return (
    <div className={styles.statCard}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

function Legend({max}: {max: number}) {
  const items = [
    {label: '无', color: 'var(--llm-empty)'},
    {label: `< ${formatTokenCount(max * 0.2)}`, color: RANK_COLORS[0]},
    {label: formatTokenCount(max * 0.4), color: RANK_COLORS[1]},
    {label: formatTokenCount(max * 0.6), color: RANK_COLORS[2]},
    {label: formatTokenCount(max * 0.8), color: RANK_COLORS[3]},
    {label: `≥ ${formatTokenCount(max * 0.8)}`, color: RANK_COLORS[4]},
  ];
  return (
    <div className={styles.legend}>
      {items.map((it, i) => (
        <span key={i} className={styles.legendItem}>
          <span className={styles.legendCell} style={{backgroundColor: it.color}} />
          <span>{it.label}</span>
        </span>
      ))}
    </div>
  );
}

function Heatmap({
  daily,
  fetchedAt,
  emptyHint,
}: {
  daily: Record<string, number>;
  fetchedAt: string | null;
  emptyHint: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    date: string;
    tokens: number;
    pct: number;
  } | null>(null);

  const endDate = useMemo(() => {
    const dates = Object.keys(daily || {});
    if (dates.length) {
      const maxKey = dates.reduce((a, b) => (a > b ? a : b));
      const d = new Date(maxKey.replace(/-/g, '/'));
      if (!Number.isNaN(d.getTime())) return d;
    }
    if (fetchedAt) {
      const d = new Date(fetchedAt.replace(/-/g, '/'));
      if (!Number.isNaN(d.getTime())) return d;
    }
    return new Date();
  }, [daily, fetchedAt]);

  const {grid, monthLabels, total, max, numWeeks, dateSpan} = useMemo(() => {
    let totalAcc = 0;
    let maxVal = 0;
    const dateMap = new Map<string, number>();
    for (const [k, v] of Object.entries(daily || {})) {
      const tokens = Number(v || 0);
      if (tokens > 0) {
        dateMap.set(k, tokens);
        if (tokens > maxVal) maxVal = tokens;
      }
    }
    totalAcc = Array.from(dateMap.values()).reduce((a, b) => a + b, 0);
    const sortedDates = Array.from(dateMap.keys()).sort();

    const year = endDate.getFullYear();
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31);
    const startRow = getDayRow(yearStart);
    const totalDays = Math.floor(
      (yearEnd.getTime() - yearStart.getTime()) / 86400000,
    ) + 1;
    const weeks = Math.ceil((startRow + totalDays) / 7);

    const endDateStr = formatDate(endDate);
    const columns: ({date: string; tokens: number; level: 0 | 1 | 2 | 3 | 4 | 5; future: boolean} | null)[][] = [];
    for (let c = 0; c < weeks; c++) {
      const col: ({date: string; tokens: number; level: 0 | 1 | 2 | 3 | 4 | 5; future: boolean} | null)[] = [];
      for (let r = 0; r < 7; r++) {
        const dayIndex = c * 7 + r - startRow;
        if (dayIndex < 0 || dayIndex >= totalDays) {
          col.push(null);
          continue;
        }
        const d = new Date(yearStart);
        d.setDate(d.getDate() + dayIndex);
        const key = formatDate(d);
        const tokens = dateMap.get(key) || 0;
        col.push({
          date: key,
          tokens,
          level: stripLevelForTokens(tokens, maxVal),
          future: key > endDateStr,
        });
      }
      columns.push(col);
    }

    const labels: {col: number; label: string}[] = [];
    let prevMonth = -1;
    columns.forEach((col, colIdx) => {
      for (let r = 0; r < 7; r++) {
        const c = col[r];
        if (!c) continue;
        const m = Number(c.date.slice(5, 7));
        if (m !== prevMonth) {
          labels.push({col: colIdx, label: MONTH_LABELS[m - 1]});
          prevMonth = m;
          break;
        }
      }
    });

    const dateSpan = sortedDates.length > 1
      ? Math.round(
          (new Date(sortedDates[sortedDates.length - 1]).getTime() -
            new Date(sortedDates[0]).getTime()) / 86400000,
        ) + 1
      : sortedDates.length;

    return {grid: columns, monthLabels: labels, total: totalAcc, max: maxVal, numWeeks: weeks, dateSpan};
  }, [daily, endDate]);

  const handleEnter = useCallback(
    (event: React.MouseEvent<HTMLDivElement>, cell: {date: string; tokens: number}) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const pct = max > 0 ? (cell.tokens / max) * 100 : 0;
      setHover({
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        date: cell.date,
        tokens: cell.tokens,
        pct,
      });
    },
    [max],
  );

  const handleMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover((prev) =>
      prev
        ? {...prev, x: event.clientX - rect.left, y: event.clientY - rect.top}
        : prev,
    );
  }, []);

  const handleLeave = useCallback(() => setHover(null), []);

  if (grid.length === 0) {
    return <div className={styles.error}>{emptyHint}</div>;
  }

  return (
    <div
      ref={containerRef}
      className={styles.heatmap}
      onMouseLeave={handleLeave}
    >
      <div className={styles.calendarBody}>
        <div className={styles.weekdayColumn}>
          <span className={styles.weekdaySpacer} aria-hidden="true" />
          {WEEKDAY_LABELS.map((w) => (
            <span key={w} className={styles.weekdayLabel}>
              周{w}
            </span>
          ))}
        </div>
        <div className={styles.scrollArea}>
          <div
            className={styles.calendarStack}
            style={{'--col-count': numWeeks} as React.CSSProperties}
          >
            <div className={styles.monthHeader}>
              {monthLabels.map((m) => (
                <span
                  key={`m-${m.col}-${m.label}`}
                  className={styles.monthLabel}
                  style={{'--col': m.col} as React.CSSProperties}
                >
                  {m.label}
                </span>
              ))}
            </div>
            <div className={styles.calendarGrid}>
              {grid.flatMap((col, colIdx) =>
                col.map((c, rowIdx) => {
                  if (!c) {
                    return (
                      <div
                        key={`${colIdx}-${rowIdx}`}
                        className={styles.cellPlaceholder}
                      />
                    );
                  }
                  if (c.future) {
                    return (
                      <div
                        key={`${colIdx}-${rowIdx}`}
                        className={styles.cellFuture}
                        aria-label={`${c.date} 未来`}
                        title={`${c.date} · 未来`}
                      />
                    );
                  }
                  return (
                    <div
                      key={`${colIdx}-${rowIdx}`}
                      role="img"
                      aria-label={`${c.date} ${formatTokenCount(c.tokens)} token`}
                      className={c.tokens > 0 ? styles.cell : styles.cellEmpty}
                      style={c.tokens > 0 ? {backgroundColor: vendorColor(c.level)} : undefined}
                      onMouseEnter={(e) => handleEnter(e, c)}
                      onMouseMove={handleMove}
                    />
                  );
                }),
              )}
            </div>
          </div>
        </div>
      </div>
      {hover && (
        <div
          className={styles.tooltip}
          style={{
            transform: `translate(calc(${hover.x}px - 50%), calc(${hover.y}px - 100% - 8px))`,
          }}
          role="tooltip"
        >
          <div className={styles.tooltipDate}>{hover.date}</div>
          <div className={styles.tooltipValue}>
            {hover.tokens > 0
              ? `${formatTokenCount(hover.tokens)} token`
              : '无 token 用量'}
          </div>
        </div>
      )}
      <div className={styles.footer}>
        <span>
          累计 {formatTokenCount(total)} token
          {max > 0 && ` · 单日峰值 ${formatTokenCount(max)}`}
          {dateSpan > 1 && ` · 跨 ${dateSpan} 天`}
        </span>
        <Legend max={max} />
      </div>
    </div>
  );
}

function ActiveVendorSection({payload}: {payload: SummaryPayload}) {
  const daily = payload.daily_token_usage || {};
  const totalTokens = parseTokenString(payload.total_token_consumed);
  const dailyAvgTokens = parseTokenString(payload.daily_avg_token_consumed);
  const activeDays = Number(payload.active_days || 0);
  const consecutiveDays = Number(payload.current_consecutive_days || 0);
  const ranking = Number(payload.usage_ranking_percent || 0);

  return (
    <section className={styles.section}>
      <div className={styles.statsSummary}>
        <StatCard value={formatTokenCount(totalTokens)} label="累计消耗 (token)" />
        <StatCard value={formatTokenCount(dailyAvgTokens)} label="日均消耗 (token)" />
        <StatCard value={activeDays} label="活跃天数" />
        <StatCard value={consecutiveDays} label="连续活跃" />
        <StatCard
          value={ranking > 0 ? `前 ${ranking.toFixed(1)}%` : '—'}
          label="使用排名"
        />
      </div>
      <Heatmap daily={daily} fetchedAt={payload.fetchedAt ?? null} emptyHint="暂无 token 用量数据" />
    </section>
  );
}

function Skeleton() {
  return (
    <div className={styles.skeleton}>
      <div className={styles.skeletonCards}>
        {Array.from({length: 4}).map((_, i) => (
          <div key={i} className={styles.skeletonCard} />
        ))}
      </div>
      <div className={styles.skeletonStrip} />
    </div>
  );
}

function DashboardInner() {
  const {colorMode} = useColorMode();
  const [data, setData] = useState<SummaryPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(DATA_PATH, {cache: 'no-store'});
        if (!res.ok) {
          if (!cancelled) {
            setError('暂无可用的模型使用数据');
            setLoading(false);
          }
          return;
        }
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('json')) {
          if (!cancelled) {
            setError('暂无可用的模型使用数据');
            setLoading(false);
          }
          return;
        }
        const json = (await res.json()) as SummaryPayload;
        if (cancelled) return;
        setData(json);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message || '加载失败');
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <Skeleton />;
  if (error) return <div className={styles.error}>{error}</div>;
  if (!data) return <div className={styles.error}>暂无数据</div>;

  return (
    <div className={styles.dashboard} data-theme-mode={colorMode === 'dark' ? 'dark' : 'light'}>
      <ActiveVendorSection payload={data} />
      {data.fetchedAt && (
        <div className={styles.footer}>
          <span>数据更新于 {data.fetchedAt}</span>
        </div>
      )}
    </div>
  );
}

export default function LLMUsageDashboard() {
  return (
    <BrowserOnly fallback={<div style={{minHeight: 180}} />}>
      {() => <DashboardInner />}
    </BrowserOnly>
  );
}
