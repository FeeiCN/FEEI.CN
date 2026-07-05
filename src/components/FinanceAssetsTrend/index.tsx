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
  assetRecords?: Array<{
    field?: string;
    name?: string;
    amount?: number | null;
  }>;
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
  caitongAssets: number | null;
  totalAssets: number | null;
};

type FinanceAssetsTrendProps = {
  onDateSelect?: (date: string) => void;
  timeScope?: TimeScope;
};

type AssetKey = 'totalAssets' | 'indexAssets' | 'stockAssets' | 'alipayAssets' | 'caitongAssets';
type ChangeInfo = {
  delta: number;
  ratio: number | null;
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

function dateToInvestPath(date: string, source: 'alipay' | 'caitong'): string {
  const [year, month, day] = date.split('-');
  return `/data/invest/${year}/${month}/${day}/${source}.json`;
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

function formatChangeMoney(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatCompactMoney(value)}`;
}

function formatPercent(value: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  const sign = value > 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(1)}%`;
}

function valueChange(points: TrendPoint[], key: AssetKey): ChangeInfo | null {
  const latestIndex = [...points].reverse().findIndex((point) => typeof point[key] === 'number');
  if (latestIndex < 0) return null;
  const latestPosition = points.length - 1 - latestIndex;
  const latestValue = points[latestPosition][key];
  if (typeof latestValue !== 'number') return null;
  for (let index = latestPosition - 1; index >= 0; index -= 1) {
    const previousValue = points[index][key];
    if (typeof previousValue !== 'number') continue;
    const delta = latestValue - previousValue;
    return {
      delta,
      ratio: previousValue === 0 ? null : delta / previousValue,
    };
  }
  return null;
}

function SummaryCard({label, value, change}: {label: string; value: number | null | undefined; change: ChangeInfo | null}) {
  const tone = change && change.delta !== 0 ? (change.delta > 0 ? styles.gain : styles.loss) : styles.neutral;
  const percent = change ? formatPercent(change.ratio) : '';
  return (
    <div>
      <span>{label}</span>
      <strong>{formatCompactMoney(value)}</strong>
      <small className={tone}>
        {change ? `${formatChangeMoney(change.delta)}${percent ? ` / ${percent}` : ''}` : '暂无变化'}
      </small>
    </div>
  );
}

function investTotalAssets(payload: InvestPayload | null): number | undefined {
  const totalAsset = payload?.assetRecords?.find((record) =>
    record.field === 'totalAsset' ||
    record.name === '总资产' ||
    record.name === '总资产(人民币)'
  )?.amount;
  if (typeof totalAsset === 'number') return totalAsset;
  return payload?.holdingAmountSum;
}

function buildTrendPoints(
  indexHistory: Map<string, number>,
  stockHistory: Map<string, number>,
  alipayHistory: Map<string, number>,
  caitongHistory: Map<string, number>,
): TrendPoint[] {
  const dates = [...new Set([
    ...indexHistory.keys(),
    ...stockHistory.keys(),
    ...alipayHistory.keys(),
    ...caitongHistory.keys(),
  ])].sort();
  let latestIndex: number | null = null;
  let latestStock: number | null = null;
  let latestAlipay: number | null = null;
  let latestCaitong: number | null = null;

  return dates.map((date) => {
    if (indexHistory.has(date)) latestIndex = indexHistory.get(date) || null;
    if (stockHistory.has(date)) latestStock = stockHistory.get(date) || null;
    if (alipayHistory.has(date)) latestAlipay = alipayHistory.get(date) || null;
    if (caitongHistory.has(date)) latestCaitong = caitongHistory.get(date) || null;
    const values = [latestIndex, latestStock, latestAlipay, latestCaitong].filter((value): value is number => typeof value === 'number');
    return {
      date,
      indexAssets: latestIndex,
      stockAssets: latestStock,
      alipayAssets: latestAlipay,
      caitongAssets: latestCaitong,
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
    color: ['#2563eb', '#0891b2', '#7c3aed', '#ea580c', '#16a34a'],
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
        name: '指数账户',
        type: 'bar',
        stack: 'assets',
        barMaxWidth: 22,
        itemStyle: {borderRadius: [0, 0, 3, 3]},
        data: points.map((point) => point.indexAssets),
      },
      {
        name: '个股账户',
        type: 'bar',
        stack: 'assets',
        barMaxWidth: 22,
        data: points.map((point) => point.stockAssets),
      },
      {
        name: '支付宝',
        type: 'bar',
        stack: 'assets',
        barMaxWidth: 22,
        data: points.map((point) => point.alipayAssets),
      },
      {
        name: '财通',
        type: 'bar',
        stack: 'assets',
        barMaxWidth: 22,
        itemStyle: {borderRadius: [3, 3, 0, 0]},
        data: points.map((point) => point.caitongAssets),
      },
      {
        name: '总资产',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: {width: 2.8},
        data: points.map((point) => point.totalAssets),
        z: 4,
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
            const [alipayPayload, caitongPayload] = await Promise.all([
              fetchJson<InvestPayload>(dateToInvestPath(date, 'alipay')),
              fetchJson<InvestPayload>(dateToInvestPath(date, 'caitong')),
            ]);
            return {
              date,
              alipay: investTotalAssets(alipayPayload),
              caitong: investTotalAssets(caitongPayload),
            };
          }),
        );
        if (cancelled) return;
        const alipayHistory = new Map(
          investEntries
            .filter((entry): entry is {date: string; alipay: number; caitong: number | undefined} => typeof entry.alipay === 'number')
            .map((entry) => [entry.date, entry.alipay] as const),
        );
        const caitongHistory = new Map(
          investEntries
            .filter((entry): entry is {date: string; alipay: number | undefined; caitong: number} => typeof entry.caitong === 'number')
            .map((entry) => [entry.date, entry.caitong] as const),
        );
        setPoints(buildTrendPoints(
          normalizeHistory(indexPayload?.portfolio?.history),
          normalizeHistory(stockPayload?.portfolio?.history),
          alipayHistory,
          caitongHistory,
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
  const changes = useMemo(() => ({
    totalAssets: valueChange(scopedPoints, 'totalAssets'),
    indexAssets: valueChange(scopedPoints, 'indexAssets'),
    stockAssets: valueChange(scopedPoints, 'stockAssets'),
    alipayAssets: valueChange(scopedPoints, 'alipayAssets'),
    caitongAssets: valueChange(scopedPoints, 'caitongAssets'),
  }), [scopedPoints]);
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
        <SummaryCard label="最新总资产" value={latest?.totalAssets} change={changes.totalAssets} />
        <SummaryCard label="指数账户" value={latest?.indexAssets} change={changes.indexAssets} />
        <SummaryCard label="个股账户" value={latest?.stockAssets} change={changes.stockAssets} />
        <SummaryCard label="支付宝" value={latest?.alipayAssets} change={changes.alipayAssets} />
        <SummaryCard label="财通" value={latest?.caitongAssets} change={changes.caitongAssets} />
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
