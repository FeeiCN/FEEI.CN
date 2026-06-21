import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import {useColorMode} from '@docusaurus/theme-common';
import styles from './styles.module.css';

type DailyTokenBucket = Record<string, number>;

type DateUsageStats = Record<string, {
  total_requests?: number;
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_cache_tokens?: number;
  total_cache_creation_tokens?: number;
  total_cache_read_tokens?: number;
  total_tokens?: number;
  total_cost?: number;
  total_actual_cost?: number;
  average_duration_ms?: number;
}>;

type ModelUsage = {
  model?: string;
  total_token?: number;
  input_token?: number;
  output_token?: number;
  cache_read_token?: number;
  cache_create_token?: number;
  cache_hit_percent?: string;
};

type DateModelUsage = Array<{
  date?: string;
  models?: ModelUsage[];
  total_token?: number;
  cache_hit_percent?: string;
}>;

type SummaryPayload = {
  vendor?: string;
  fetchedAt?: string;
  total_days?: number;
  total_token_consumed?: string;
  daily_avg_token_consumed?: string;
  usage_ranking_percent?: number;
  active_days?: number;
  current_consecutive_days?: number;
  daily_token_usage?: DailyTokenBucket;
  date_usage_stats?: DateUsageStats;
  date_model_usage?: DateModelUsage | Record<string, ModelUsage[]>;
  base_resp?: {status_code?: number; status_msg?: string};
};

type VendorConfig = {
  id: string;
  label: string;
  path: string;
};

type TimeScope =
  | {mode: 'recent'; range: '7d' | '30d' | '90d' | '1y'}
  | {mode: 'year'; year: number}
  | {mode: 'all'};

type VendorPayload = {
  config: VendorConfig;
  payload: SummaryPayload;
};

type DailyVendorBreakdown = {
  id: string;
  label: string;
  tokens: number;
  stats?: DateUsageStats[string];
  models: ModelUsage[];
};

type DailyBreakdown = Record<string, DailyVendorBreakdown[]>;
type DashboardVariant = 'heatmap' | 'stackedBar';

const VENDORS: VendorConfig[] = [
  {id: 'minimax', label: 'MiniMax', path: '/data/llm-usage/minimax/usage_summary.json'},
  {id: 'openai', label: 'OpenAI', path: '/data/llm-usage/openai/usage_summary.json'},
  {id: 'anthropic', label: 'Anthropic', path: '/data/llm-usage/anthropic/usage_summary.json'},
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
const RANGE_DAYS: Record<string, number> = {'7d': 7, '30d': 30, '90d': 90, '1y': 365};

function filterDateRecord<T>(record: Record<string, T>, scope?: TimeScope): Record<string, T> {
  if (!scope || scope.mode === 'all') return record;
  const entries = Object.entries(record);
  if (scope.mode === 'year') {
    const prefix = `${scope.year}-`;
    return Object.fromEntries(entries.filter(([date]) => date.startsWith(prefix)));
  }
  const dates = entries.map(([date]) => date).sort();
  const latest = dates.at(-1);
  if (!latest) return {};
  const cutoff = new Date(`${latest}T00:00:00`);
  cutoff.setDate(cutoff.getDate() - RANGE_DAYS[scope.range]);
  const cutoffKey = formatDate(cutoff);
  return Object.fromEntries(entries.filter(([date]) => date >= cutoffKey));
}

function getDayRow(date: Date): number {
  const g = date.getDay();
  return g === 0 ? 6 : g - 1;
}

function formatTokenCount(value: number): string {
  if (!value) return '0';
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

function formatLegendTokenCount(value: number): string {
  if (!value) return '0';
  if (value >= 1_000_000_000) return `${Math.round(value / 1_000_000_000)}B`;
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(Math.round(value));
}

function formatCurrency(value: number | undefined): string {
  if (!value) return '$0';
  return `$${value.toFixed(value >= 10 ? 2 : 4)}`;
}

function formatDurationMs(value: number | undefined): string {
  if (!value) return '—';
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.round(value)}ms`;
}

function getDailyTokens(payload: SummaryPayload): DailyTokenBucket {
  const daily = payload.daily_token_usage;
  if (!daily || Array.isArray(daily)) return {};
  return daily;
}

function getModelsForDate(payload: SummaryPayload, date: string): ModelUsage[] {
  const usage = payload.date_model_usage;
  if (!usage) return [];
  if (Array.isArray(usage)) {
    const item = usage.find((entry) => entry.date === date);
    return item?.models || [];
  }
  const direct = usage[date];
  return Array.isArray(direct) ? direct : [];
}

function buildDailyBreakdown(vendors: VendorPayload[]): {
  daily: DailyTokenBucket;
  breakdown: DailyBreakdown;
} {
  const daily: DailyTokenBucket = {};
  const breakdown: DailyBreakdown = {};
  for (const vendor of vendors) {
    const vendorDaily = getDailyTokens(vendor.payload);
    for (const [date, rawTokens] of Object.entries(vendorDaily)) {
      const tokens = Number(rawTokens || 0);
      if (tokens <= 0) continue;
      daily[date] = (daily[date] || 0) + tokens;
      const items = breakdown[date] || [];
      items.push({
        id: vendor.config.id,
        label: vendor.config.label,
        tokens,
        stats: vendor.payload.date_usage_stats?.[date],
        models: getModelsForDate(vendor.payload, date),
      });
      breakdown[date] = items;
    }
  }
  for (const date of Object.keys(breakdown)) {
    breakdown[date].sort((a, b) => b.tokens - a.tokens);
  }
  return {daily, breakdown};
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
    {label: `< ${formatLegendTokenCount(max * 0.2)}`, color: RANK_COLORS[0]},
    {label: formatLegendTokenCount(max * 0.4), color: RANK_COLORS[1]},
    {label: formatLegendTokenCount(max * 0.6), color: RANK_COLORS[2]},
    {label: formatLegendTokenCount(max * 0.8), color: RANK_COLORS[3]},
    {label: `≥ ${formatLegendTokenCount(max * 0.8)}`, color: RANK_COLORS[4]},
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
  breakdown,
  fetchedAt,
  emptyHint,
  onDateSelect,
}: {
  daily: Record<string, number>;
  breakdown: DailyBreakdown;
  fetchedAt: string | null;
  emptyHint: string;
  onDateSelect?: (date: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    date: string;
    tokens: number;
    pct: number;
    vendors: DailyVendorBreakdown[];
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
        vendors: breakdown[cell.date] || [],
      });
    },
    [breakdown, max],
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
                      onClick={() => onDateSelect?.(c.date)}
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
          {hover.vendors.length > 0 && (
            <div className={styles.tooltipVendors}>
              {hover.vendors.map((vendor) => (
                <div key={vendor.id} className={styles.tooltipVendor}>
                  <div className={styles.tooltipVendorHeader}>
                    <span>{vendor.label}</span>
                    <strong>{formatTokenCount(vendor.tokens)}</strong>
                  </div>
                  {vendor.models.length > 0 ? (
                    <div className={styles.tooltipModels}>
                      {vendor.models.slice(0, 4).map((model) => (
                        <div key={model.model || 'unknown'} className={styles.tooltipModel}>
                          <span>{model.model || 'Unknown model'}</span>
                          <span>
                            {formatTokenCount(Number(model.total_token || 0))}
                            {model.cache_hit_percent ? ` · cache ${model.cache_hit_percent}` : ''}
                          </span>
                        </div>
                      ))}
                      {vendor.models.length > 4 && (
                        <div className={styles.tooltipMuted}>
                          另 {vendor.models.length - 4} 个模型
                        </div>
                      )}
                    </div>
                  ) : vendor.stats ? (
                    <div className={styles.tooltipStats}>
                      <span>请求 {vendor.stats.total_requests || 0} 次</span>
                      <span>输入 {formatTokenCount(vendor.stats.total_input_tokens || 0)}</span>
                      <span>输出 {formatTokenCount(vendor.stats.total_output_tokens || 0)}</span>
                      <span>缓存 {formatTokenCount(vendor.stats.total_cache_tokens || 0)}</span>
                      <span>费用 {formatCurrency(vendor.stats.total_cost)}</span>
                      <span>均耗时 {formatDurationMs(vendor.stats.average_duration_ms)}</span>
                    </div>
                  ) : (
                    <div className={styles.tooltipMuted}>暂无模型明细</div>
                  )}
                </div>
              ))}
            </div>
          )}
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

function ActiveVendorSection({vendors, onDateSelect, timeScope}: {vendors: VendorPayload[]; onDateSelect?: (date: string) => void; timeScope?: TimeScope}) {
  const {daily, breakdown} = useMemo(() => buildDailyBreakdown(vendors), [vendors]);
  const scopedDaily = useMemo(() => filterDateRecord(daily, timeScope), [daily, timeScope]);
  const scopedBreakdown = useMemo(() => filterDateRecord(breakdown, timeScope), [breakdown, timeScope]);
  const totalTokens = Object.values(scopedDaily).reduce((sum, value) => sum + Number(value || 0), 0);
  const activeDays = Object.values(scopedDaily).filter((value) => Number(value || 0) > 0).length;
  const vendorSummaries = vendors.map(({config, payload}) => ({
    id: config.id,
    label: config.label,
    total: Object.values(getDailyTokens(payload)).reduce((sum, value) => sum + Number(value || 0), 0),
    fetchedAt: payload.fetchedAt,
  }));
  const latestFetchedAt = vendors
    .map((vendor) => vendor.payload.fetchedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) || null;

  return (
    <section className={styles.section}>
      <div className={styles.statsSummary}>
        <StatCard value={formatTokenCount(totalTokens)} label="累计消耗 (token)" />
        <StatCard
          value={formatTokenCount(activeDays ? totalTokens / activeDays : 0)}
          label="活跃日均消耗"
        />
        <StatCard value={activeDays} label="活跃天数" />
        <StatCard value={vendors.length} label="数据平台" />
      </div>
      <div className={styles.vendorList}>
        {vendorSummaries.map((vendor) => (
          <span
            key={vendor.id}
            className={styles.vendorBadge}
            data-active={vendor.total > 0}
            title={vendor.fetchedAt ? `更新于 ${vendor.fetchedAt}` : undefined}
          >
            {vendor.label}
            <span className={styles.vendorBadgeSuffix}>
              {vendor.total > 0 ? formatTokenCount(vendor.total) : '无数据'}
            </span>
          </span>
        ))}
      </div>
      <Heatmap
        daily={scopedDaily}
        breakdown={scopedBreakdown}
        fetchedAt={latestFetchedAt}
        emptyHint="暂无 token 用量数据"
        onDateSelect={onDateSelect}
      />
    </section>
  );
}

function StackedBarChart({
  vendors,
  onDateSelect,
  timeScope,
}: {
  vendors: VendorPayload[];
  onDateSelect?: (date: string) => void;
  timeScope?: TimeScope;
}) {
  const vendorDaily = useMemo(() => {
    return vendors.map((vendor) => ({
      ...vendor,
      daily: filterDateRecord(getDailyTokens(vendor.payload), timeScope),
    }));
  }, [vendors, timeScope]);
  const dates = useMemo(() => {
    return [...new Set(vendorDaily.flatMap((vendor) => Object.keys(vendor.daily)))].sort();
  }, [vendorDaily]);
  const totals = useMemo(() => {
    return dates.map((date) => vendorDaily.reduce((sum, vendor) => sum + Number(vendor.daily[date] || 0), 0));
  }, [dates, vendorDaily]);
  const max = Math.max(1, ...totals);
  const chartHeight = 240;
  const labelHeight = 32;
  const width = Math.max(520, dates.length * 24);
  const plotHeight = chartHeight - labelHeight - 12;
  const barGap = 8;
  const barWidth = Math.max(8, Math.min(22, (width - barGap * (dates.length + 1)) / Math.max(1, dates.length)));
  const colors: Record<string, string> = {
    minimax: '#f97316',
    openai: '#10b981',
    anthropic: '#7c3aed',
  };

  if (!dates.length) {
    return <div className={styles.error}>当前时间范围暂无 AI 使用数据</div>;
  }

  return (
    <section className={styles.section}>
      <div className={styles.stackedBarScroll}>
        <svg className={styles.stackedBarChart} viewBox={`0 0 ${width} ${chartHeight}`} style={{width, height: chartHeight}} role="img">
          {dates.map((date, index) => {
            const x = barGap + index * (barWidth + barGap);
            let y = plotHeight;
            const dayTotal = totals[index] || 0;
            return (
              <g key={date} className={styles.stackedBarGroup} onClick={() => onDateSelect?.(date)}>
                <title>{date} · {formatTokenCount(dayTotal)} token</title>
                {vendorDaily.map((vendor) => {
                  const value = Number(vendor.daily[date] || 0);
                  if (value <= 0) return null;
                  const height = Math.max(1, (value / max) * plotHeight);
                  y -= height;
                  return (
                    <rect
                      key={vendor.config.id}
                      x={x}
                      y={y}
                      width={barWidth}
                      height={height}
                      rx={2}
                      fill={colors[vendor.config.id] || '#64748b'}
                    />
                  );
                })}
                <text
                  x={x + barWidth / 2}
                  y={plotHeight + 14}
                  textAnchor="middle"
                  className={styles.stackedBarLabel}
                >
                  {dates.length <= 35 || index % Math.ceil(dates.length / 18) === 0 ? date.slice(5) : ''}
                </text>
              </g>
            );
          })}
        </svg>
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

function DashboardInner({onDateSelect, timeScope, variant = 'heatmap'}: {onDateSelect?: (date: string) => void; timeScope?: TimeScope; variant?: DashboardVariant}) {
  const {colorMode} = useColorMode();
  const [data, setData] = useState<VendorPayload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await Promise.all(
          VENDORS.map(async (config) => {
            const res = await fetch(config.path, {cache: 'no-store'});
            if (!res.ok) return null;
            const contentType = res.headers.get('content-type') || '';
            if (!contentType.includes('json')) return null;
            const payload = (await res.json()) as SummaryPayload;
            return {config, payload};
          }),
        );
        if (cancelled) return;
        const valid = loaded.filter((item): item is VendorPayload => item !== null);
        if (!valid.length) {
          setError('暂无可用的模型使用数据');
          setLoading(false);
          return;
        }
        setData(valid);
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
  if (!data.length) return <div className={styles.error}>暂无数据</div>;

  return (
    <div className={styles.dashboard} data-theme-mode={colorMode === 'dark' ? 'dark' : 'light'}>
      {variant === 'stackedBar' ? (
        <StackedBarChart vendors={data} onDateSelect={onDateSelect} timeScope={timeScope} />
      ) : (
        <ActiveVendorSection vendors={data} onDateSelect={onDateSelect} timeScope={timeScope} />
      )}
      {variant !== 'stackedBar' && data.some((vendor) => vendor.payload.fetchedAt) && (
        <div className={styles.footer}>
          <span>
            数据更新于{' '}
            {data
              .map((vendor) => `${vendor.config.label}: ${vendor.payload.fetchedAt || '未知'}`)
              .join(' · ')}
          </span>
        </div>
      )}
    </div>
  );
}

export default function LLMUsageDashboard({onDateSelect, timeScope, variant}: {onDateSelect?: (date: string) => void; timeScope?: TimeScope; variant?: DashboardVariant}) {
  return (
    <BrowserOnly fallback={<div style={{minHeight: 180}} />}>
      {() => <DashboardInner onDateSelect={onDateSelect} timeScope={timeScope} variant={variant} />}
    </BrowserOnly>
  );
}
