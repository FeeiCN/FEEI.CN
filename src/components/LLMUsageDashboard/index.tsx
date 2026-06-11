import React, {useEffect, useMemo, useState} from 'react';
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
];

const RANK_COLORS: string[] = [
  'var(--llm-l1)',
  'var(--llm-l2)',
  'var(--llm-l3)',
  'var(--llm-l4)',
  'var(--llm-l5)',
];

const STRIP_LAYERS = 5;

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
  const endDate = useMemo(() => {
    if (!fetchedAt) return new Date();
    const d = new Date(fetchedAt.replace(/-/g, '/'));
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }, [fetchedAt]);

  const {cells, total, max} = useMemo(() => {
    let totalAcc = 0;
    let maxVal = 0;
    const nonZero = daily.filter((v) => v && v > 0) as number[];
    if (nonZero.length) {
      maxVal = Math.max(...nonZero);
    }
    const list: {date: string; tokens: number; level: 0 | 1 | 2 | 3 | 4 | 5}[] = [];
    daily.forEach((tokens, idx) => {
      const daysAgo = daily.length - 1 - idx;
      const date = formatDate(dateMinusDays(endDate, daysAgo));
      const v = Number(tokens || 0);
      totalAcc += v;
      list.push({date, tokens: v, level: stripLevelForTokens(v, maxVal)});
    });
    return {cells: list, total: totalAcc, max: maxVal};
  }, [daily, endDate]);

  if (cells.length === 0) {
    return <div className={styles.error}>{emptyHint}</div>;
  }

  return (
    <div className={styles.heatmap}>
      <div className={styles.heatmapGrid}>
        {cells.map((c) => (
          <div
            key={c.date}
            role="img"
            aria-label={`${c.date} ${formatTokenCount(c.tokens)} token`}
            className={styles.cell}
            style={{backgroundColor: vendorColor(c.level)}}
            title={`${c.date} · ${formatTokenCount(c.tokens)} token`}
          />
        ))}
      </div>
      <div className={styles.footer}>
        <span>
          近 {cells.length} 天 · 累计 {formatTokenCount(total)} token
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
          value={ranking > 0 ? `前 ${(100 - ranking).toFixed(1)}%` : '—'}
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
