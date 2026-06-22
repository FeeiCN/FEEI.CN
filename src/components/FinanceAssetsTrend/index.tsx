import {useEffect, useMemo, useState} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import {useColorMode} from '@docusaurus/theme-common';
import ReactECharts from 'echarts-for-react';
import styles from './styles.module.css';

type HistoryPoint = {
  date: string;
  fullDate?: string;
  totalAssets?: number;
};

type AccountAssetsPayload = {
  portfolio?: {
    history?: HistoryPoint[];
  };
};

type InvestManifest = {
  dates?: string[];
};

type InvestPayload = {
  holdingAmountSum?: number;
};

type TimeScope =
  | {mode: 'recent'; range: '7d' | '30d' | '90d' | '1y'}
  | {mode: 'year'; year: number}
  | {mode: 'all'};

type TrendPoint = {
  date: string;
  indexAssets: number | null;
  stockAssets: number | null;
  alipayAssets: number | null;
  totalAssets: number | null;
};

type FinanceAssetsTrendProps = {
  onDateSelect?: (date: string) => void;
  timeScope?: TimeScope;
};

const RANGE_DAYS: Record<string, number> = {'7d': 7, '30d': 30, '90d': 90, '1y': 365};

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(path, {cache: 'no-store'});
    if (!response.ok) return null;
    return JSON.parse(await response.text()) as T;
  } catch {
    return null;
  }
}

function dateToInvestPath(date: string): string {
  const [year, month, day] = date.split('-');
  return `/data/invest/${year}/${month}/${day}/alipay.json`;
}

function normalizeHistory(history: HistoryPoint[] | undefined): Map<string, number> {
  const entries: Array<[string, number]> = [];
  (history || []).forEach((item) => {
    const date = item.fullDate || item.date;
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && typeof item.totalAssets === 'number') {
      entries.push([date, item.totalAssets]);
    }
  });
  return new Map(entries);
}

function filterByScope(items: TrendPoint[], scope?: TimeScope): TrendPoint[] {
  if (!scope || scope.mode === 'all') return items;
  if (scope.mode === 'year') return items.filter((item) => item.date.startsWith(`${scope.year}-`));
  const latest = items.map((item) => item.date).sort().at(-1);
  if (!latest) return [];
  const cutoff = new Date(`${latest}T00:00:00`);
  cutoff.setDate(cutoff.getDate() - RANGE_DAYS[scope.range]);
  const cutoffKey = cutoff.toISOString().slice(0, 10);
  return items.filter((item) => item.date >= cutoffKey);
}

function formatCompactMoney(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '暂无';
  if (Math.abs(value) >= 10000) return `${(value / 10000).toFixed(1)}万`;
  return value.toLocaleString('zh-CN', {maximumFractionDigits: 0});
}

function buildTrendPoints(
  indexHistory: Map<string, number>,
  stockHistory: Map<string, number>,
  alipayHistory: Map<string, number>,
): TrendPoint[] {
  const dates = [...new Set([
    ...indexHistory.keys(),
    ...stockHistory.keys(),
    ...alipayHistory.keys(),
  ])].sort();
  let latestIndex: number | null = null;
  let latestStock: number | null = null;
  let latestAlipay: number | null = null;

  return dates.map((date) => {
    if (indexHistory.has(date)) latestIndex = indexHistory.get(date) || null;
    if (stockHistory.has(date)) latestStock = stockHistory.get(date) || null;
    if (alipayHistory.has(date)) latestAlipay = alipayHistory.get(date) || null;
    const values = [latestIndex, latestStock, latestAlipay].filter((value): value is number => typeof value === 'number');
    return {
      date,
      indexAssets: latestIndex,
      stockAssets: latestStock,
      alipayAssets: latestAlipay,
      totalAssets: values.length ? values.reduce((sum, value) => sum + value, 0) : null,
    };
  });
}

function buildOption(points: TrendPoint[], isDark: boolean, isMobile: boolean) {
  const axisColor = isDark ? '#475569' : '#cbd5e1';
  const labelColor = isDark ? '#94a3b8' : '#64748b';
  const splitColor = isDark ? 'rgba(148,163,184,0.1)' : 'rgba(148,163,184,0.2)';
  const dates = points.map((point) => point.date.slice(5));

  return {
    backgroundColor: 'transparent',
    color: ['#2563eb', '#0891b2', '#7c3aed', '#ea580c'],
    grid: {top: isMobile ? 54 : 42, right: 18, bottom: 28, left: 12, containLabel: true},
    legend: {
      top: 0,
      right: 0,
      textStyle: {fontSize: 12, color: labelColor},
      itemHeight: 10,
    },
    tooltip: {
      trigger: 'axis',
      formatter: (params: Array<{seriesName: string; value: number | null; axisValue: string; dataIndex: number}>) => {
        const index = params[0]?.dataIndex || 0;
        const date = points[index]?.date || params[0]?.axisValue || '';
        const lines = params.map((item) => `${item.seriesName}：${formatCompactMoney(item.value)}`);
        return `${date}<br/>${lines.join('<br/>')}`;
      },
    },
    xAxis: {
      type: 'category',
      data: dates,
      axisTick: {show: false},
      axisLine: {lineStyle: {color: axisColor}},
      axisLabel: {color: labelColor, fontSize: 11},
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        formatter: (value: number) => `${(value / 10000).toFixed(0)}万`,
        color: labelColor,
        fontSize: 11,
      },
      splitLine: {lineStyle: {color: splitColor}},
    },
    series: [
      {
        name: '总资产',
        type: 'line',
        smooth: true,
        symbol: 'none',
        lineStyle: {width: 2.8},
        data: points.map((point) => point.totalAssets),
      },
      {
        name: '指数账户',
        type: 'line',
        smooth: true,
        symbol: 'none',
        lineStyle: {width: 1.7},
        data: points.map((point) => point.indexAssets),
      },
      {
        name: '个股账户',
        type: 'line',
        smooth: true,
        symbol: 'none',
        lineStyle: {width: 1.7},
        data: points.map((point) => point.stockAssets),
      },
      {
        name: '支付宝',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: {width: 1.7},
        data: points.map((point) => point.alipayAssets),
      },
    ],
  };
}

function FinanceAssetsTrendClient({onDateSelect, timeScope}: FinanceAssetsTrendProps) {
  const {colorMode} = useColorMode();
  const isDark = colorMode === 'dark';
  const theme = isDark ? 'dark' : undefined;
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  const [points, setPoints] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchJson<AccountAssetsPayload>('/data/account-assets/index.json'),
      fetchJson<AccountAssetsPayload>('/data/account-assets/stock.json'),
      fetchJson<InvestManifest>('/data/invest/index.json'),
    ])
      .then(async ([indexPayload, stockPayload, investManifest]) => {
        const investEntries = await Promise.all(
          (investManifest?.dates || []).map(async (date) => {
            const payload = await fetchJson<InvestPayload>(dateToInvestPath(date));
            return [date, payload?.holdingAmountSum] as const;
          }),
        );
        if (cancelled) return;
        const alipayHistory = new Map(
          investEntries.filter((entry): entry is readonly [string, number] => typeof entry[1] === 'number'),
        );
        setPoints(buildTrendPoints(
          normalizeHistory(indexPayload?.portfolio?.history),
          normalizeHistory(stockPayload?.portfolio?.history),
          alipayHistory,
        ));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const scopedPoints = useMemo(() => filterByScope(points, timeScope), [points, timeScope]);
  const latest = scopedPoints.at(-1);
  const chartEvents = onDateSelect
    ? {
        click: (params: {dataIndex?: number}) => {
          const point = typeof params.dataIndex === 'number' ? scopedPoints[params.dataIndex] : null;
          if (point?.date) onDateSelect(point.date);
        },
      }
    : undefined;

  if (loading) return <div className={styles.skeleton} />;
  if (!scopedPoints.length) return <p className={styles.empty}>暂无总资产趋势数据。</p>;

  return (
    <div className={styles.dashboard}>
      <div className={styles.summary}>
        <div>
          <span>最新总资产</span>
          <strong>{formatCompactMoney(latest?.totalAssets)}</strong>
        </div>
        <div>
          <span>指数账户</span>
          <strong>{formatCompactMoney(latest?.indexAssets)}</strong>
        </div>
        <div>
          <span>个股账户</span>
          <strong>{formatCompactMoney(latest?.stockAssets)}</strong>
        </div>
        <div>
          <span>支付宝</span>
          <strong>{formatCompactMoney(latest?.alipayAssets)}</strong>
        </div>
      </div>
      <ReactECharts
        option={buildOption(scopedPoints, isDark, isMobile)}
        theme={theme}
        style={{height: isMobile ? 320 : 340}}
        opts={{renderer: 'svg'}}
        onEvents={chartEvents}
      />
    </div>
  );
}

export default function FinanceAssetsTrend(props: FinanceAssetsTrendProps) {
  return (
    <BrowserOnly fallback={<div className={styles.skeleton} />}>
      {() => <FinanceAssetsTrendClient {...props} />}
    </BrowserOnly>
  );
}
