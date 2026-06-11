import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import {useColorMode} from '@docusaurus/theme-common';
import styles from './styles.module.css';

type DailyTokenBucket = number | null;

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
  usage_ranking_percent?: number;
  most_active_day?: MostActiveDay;
  active_days?: number;
  current_consecutive_days?: number;
  daily_token_usage?: DailyTokenBucket[];
  base_resp?: {status_code?: number; status_msg?: string};
};

const VENDORS: {key: string; label: string; path: string}[] = [
  {key: 'minimax', label: 'MiniMax', path: '/llm-usage/minimax/usage_summary.json'},
  {key: 'anthropic', label: 'Anthropic (Claude)', path: '/llm-usage/anthropic/usage_summary.json'},
  {key: 'openai', label: 'OpenAI (GPT)', path: '/llm-usage/openai/usage_summary.json'},
];

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
  daily: number[];
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
    if (!fetchedAt) return new Date();
    const d = new Date(fetchedAt.replace(/-/g, '/'));
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }, [fetchedAt]);

  const {grid, monthLabels, total, max, numWeeks} = useMemo(() => {
    let totalAcc = 0;
    let maxVal = 0;
    const nonZero = daily.filter((v) => v && v > 0) as number[];
    if (nonZero.length) {
      maxVal = Math.max(...nonZero);
    }
    if (daily.length === 0) {
      return {grid: [] as ({date: string; tokens: number; level: 0 | 1 | 2 | 3 | 4 | 5} | null)[][], monthLabels: [] as {col: number; label: string}[], total: 0, max: 0, numWeeks: 0};
    }
    const startDate = dateMinusDays(endDate, daily.length - 1);
    const startRow = getDayRow(startDate);
    const totalCells = startRow + daily.length;
    const weeks = Math.ceil(totalCells / 7);

    const columns: ({date: string; tokens: number; level: 0 | 1 | 2 | 3 | 4 | 5} | null)[][] = [];
    for (let c = 0; c < weeks; c++) {
      const col: ({date: string; tokens: number; level: 0 | 1 | 2 | 3 | 4 | 5} | null)[] = [];
      for (let r = 0; r < 7; r++) {
        const dayIndex = c * 7 + r - startRow;
        if (dayIndex < 0 || dayIndex >= daily.length) {
          col.push(null);
          continue;
        }
        const tokens = Number(daily[dayIndex] || 0);
        totalAcc += tokens;
        const d = new Date(startDate);
        d.setDate(d.getDate() + dayIndex);
        col.push({date: formatDate(d), tokens, level: stripLevelForTokens(tokens, maxVal)});
      }
      columns.push(col);
    }

    const labels: {col: number; label: string}[] = [];
    let prevMonth = -1;
    columns.forEach((col, colIdx) => {
      const first = col.find((c) => c !== null);
      if (!first) return;
      const m = Number(first.date.slice(5, 7));
      if (m !== prevMonth) {
        labels.push({col: colIdx, label: MONTH_LABELS[m - 1]});
        prevMonth = m;
      }
    });

    return {grid: columns, monthLabels: labels, total: totalAcc, max: maxVal, numWeeks: weeks};
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
      <div className={styles.calendarHead}>
        <div className={styles.calendarCorner} />
        <div
          className={styles.monthRow}
          style={{'--col-count': numWeeks} as React.CSSProperties}
        >
          {monthLabels.map((m) => (
            <span
              key={`${m.col}-${m.label}`}
              className={styles.monthLabel}
              style={{'--col': m.col + 1} as React.CSSProperties}
            >
              {m.label}
            </span>
          ))}
        </div>
      </div>
      <div className={styles.calendarBody}>
        <div className={styles.weekdayColumn}>
          {WEEKDAY_LABELS.map((w, i) => (
            <span
              key={w}
              className={styles.weekdayLabel}
              data-show={i % 2 === 0 ? 'true' : 'false'}
            >
              {i % 2 === 0 ? `周${w}` : ''}
            </span>
          ))}
        </div>
        <div
          className={styles.calendarGrid}
          style={{'--col-count': numWeeks} as React.CSSProperties}
        >
          {grid.flatMap((col, colIdx) =>
            col.map((c, rowIdx) =>
              c ? (
                <div
                  key={`${colIdx}-${rowIdx}`}
                  role="img"
                  aria-label={`${c.date} ${formatTokenCount(c.tokens)} token`}
                  className={styles.cell}
                  style={{backgroundColor: vendorColor(c.level)}}
                  onMouseEnter={(e) => handleEnter(e, c)}
                  onMouseMove={handleMove}
                />
              ) : (
                <div
                  key={`${colIdx}-${rowIdx}`}
                  className={styles.cellPlaceholder}
                />
              ),
            ),
          )}
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
          {hover.tokens > 0 && max > 0 && (
            <div className={styles.tooltipPct}>峰值占比 {hover.pct.toFixed(1)}%</div>
          )}
        </div>
      )}
      <div className={styles.footer}>
        <span>
          近 {daily.length} 天 · 累计 {formatTokenCount(total)} token
          {max > 0 && ` · 单日峰值 ${formatTokenCount(max)}`}
        </span>
        <Legend max={max} />
      </div>
    </div>
  );
}

function VendorSection({vendor, payload}: {vendor: string; payload: SummaryPayload}) {
  const daily = (payload.daily_token_usage || []).map((v) => Number(v || 0));
  const totalTokens = parseTokenString(payload.total_token_consumed);
  const activeDays = Number(payload.active_days || 0);
  const consecutiveDays = Number(payload.current_consecutive_days || 0);
  const ranking = Number(payload.usage_ranking_percent || 0);

  return (
    <section className={styles.section}>
      <div className={styles.statsSummary}>
        <StatCard value={formatTokenCount(totalTokens)} label="累计消耗 (token)" />
        <StatCard value={activeDays} label="活跃天数" />
        <StatCard value={consecutiveDays} label="连续活跃" />
        <StatCard
          value={ranking > 0 ? `前 ${ranking.toFixed(1)}%` : '—'}
          label="使用排名"
        />
      </div>
      <div className={styles.section}>
        <p className={styles.sectionTitle}>
          <span className={styles.vendorBadge}>{vendor}</span>
        </p>
        <Heatmap daily={daily} fetchedAt={payload.fetchedAt ?? null} emptyHint="暂无 token 用量数据" />
      </div>
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
  const [data, setData] = useState<Record<string, SummaryPayload> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const results = await Promise.all(
          VENDORS.map(async (v) => {
            try {
              const res = await fetch(v.path, {cache: 'no-store'});
              if (!res.ok) return [v.key, null] as const;
              const contentType = res.headers.get('content-type') || '';
              if (!contentType.includes('json')) return [v.key, null] as const;
              const json = (await res.json()) as SummaryPayload;
              return [v.key, json] as const;
            } catch {
              return [v.key, null] as const;
            }
          }),
        );
        if (cancelled) return;
        const map: Record<string, SummaryPayload> = {};
        for (const [k, v] of results) {
          if (v) map[k] = v;
        }
        if (Object.keys(map).length === 0) {
          setError('暂无可用的模型使用数据');
        } else {
          setData(map);
        }
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

  const lastFetched = data
    ? Object.values(data)
        .map((p) => p.fetchedAt || '')
        .filter(Boolean)
        .sort()
        .pop()
    : '';

  return (
    <div className={styles.dashboard} data-theme-mode={colorMode === 'dark' ? 'dark' : 'light'}>
      {data &&
        Object.entries(data).map(([vendor, payload]) => (
          <VendorSection key={vendor} vendor={vendor} payload={payload} />
        ))}
      {lastFetched && (
        <div className={styles.footer}>
          <span>数据更新于 {lastFetched}</span>
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
