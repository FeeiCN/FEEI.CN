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
  indexDelta: number | null;
  stockDelta: number | null;
  alipayDelta: number | null;
  caitongDelta: number | null;
  totalDelta: number | null;
};

type FinanceAssetsTrendProps = {
  date?: string;
  onDateSelect?: (date: string) => void;
  timeScope?: TimeScope;
};

type AssetKey = 'totalAssets' | 'indexAssets' | 'stockAssets' | 'alipayAssets' | 'caitongAssets';
type ChangeInfo = {
  delta: number;
  ratio: number | null;
};

const RANGE_DAYS: Record<string, number> = {'7d': 7, '30d': 30, '90d': 90, '1y': 365};
const ASSET_ROWS: Array<{label: string; assetKey: AssetKey; deltaKey: keyof TrendPoint}> = [
  {label: '指数账户', assetKey: 'indexAssets', deltaKey: 'indexDelta'},
  {label: '个股账户', assetKey: 'stockAssets', deltaKey: 'stockDelta'},
  {label: '支付宝', assetKey: 'alipayAssets', deltaKey: 'alipayDelta'},
  {label: '财通', assetKey: 'caitongAssets', deltaKey: 'caitongDelta'},
];

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

function formatFullMoney(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '暂无';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toLocaleString('zh-CN', {maximumFractionDigits: 0})}`;
}

function formatPercent(value: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  const sign = value > 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(1)}%`;
}

function valueChange(points: TrendPoint[], key: AssetKey, targetDate?: string): ChangeInfo | null {
  const latestPosition = targetDate
    ? points.findIndex((point) => point.date === targetDate && typeof point[key] === 'number')
    : points.length - 1 - [...points].reverse().findIndex((point) => typeof point[key] === 'number');
  if (latestPosition < 0 || latestPosition >= points.length) return null;
  const latestValue = points[latestPosition]?.[key];
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

function TotalAssetCard({
  date,
  value,
  change,
}: {
  date: string | undefined;
  value: number | null | undefined;
  change: ChangeInfo | null;
}) {
  const tone = change && change.delta !== 0 ? (change.delta > 0 ? styles.gain : styles.loss) : styles.neutral;
  const percent = change ? formatPercent(change.ratio) : '';
  return (
    <div className={styles.totalAssetCard}>
      <div>
        <span>总资产</span>
        <strong>{formatCompactMoney(value)}</strong>
        <small>{date || '最新日期'}</small>
      </div>
      <div className={styles.totalAssetChange}>
        <span>当日变动</span>
        <strong className={tone}>
          {change ? formatChangeMoney(change.delta) : '暂无变化'}
        </strong>
        <small className={tone}>{percent || '暂无比例'}</small>
      </div>
    </div>
  );
}

function PlaceholderSummaryCard({label}: {label: string}) {
  return (
    <div className={styles.summaryPlaceholder}>
      <span>{label}</span>
      <strong>待接入</strong>
      <small>暂无数据</small>
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
  let latestTotal: number | null = null;

  return dates.map((date) => {
    const prevIndex = latestIndex;
    const prevStock = latestStock;
    const prevAlipay = latestAlipay;
    const prevCaitong = latestCaitong;
    const prevTotal = latestTotal;
    if (indexHistory.has(date)) latestIndex = indexHistory.get(date) ?? null;
    if (stockHistory.has(date)) latestStock = stockHistory.get(date) ?? null;
    if (alipayHistory.has(date)) latestAlipay = alipayHistory.get(date) ?? null;
    if (caitongHistory.has(date)) latestCaitong = caitongHistory.get(date) ?? null;
    const values = [latestIndex, latestStock, latestAlipay, latestCaitong].filter((value): value is number => typeof value === 'number');
    latestTotal = values.length ? values.reduce((sum, value) => sum + value, 0) : null;
    const indexDelta = typeof latestIndex === 'number' && typeof prevIndex === 'number' ? latestIndex - prevIndex : null;
    const stockDelta = typeof latestStock === 'number' && typeof prevStock === 'number' ? latestStock - prevStock : null;
    const alipayDelta = typeof latestAlipay === 'number' && typeof prevAlipay === 'number' ? latestAlipay - prevAlipay : null;
    const caitongDelta = typeof latestCaitong === 'number' && typeof prevCaitong === 'number' ? latestCaitong - prevCaitong : null;
    return {
      date,
      indexAssets: latestIndex,
      stockAssets: latestStock,
      alipayAssets: latestAlipay,
      caitongAssets: latestCaitong,
      totalAssets: latestTotal,
      indexDelta,
      stockDelta,
      alipayDelta,
      caitongDelta,
      totalDelta: typeof latestTotal === 'number' && typeof prevTotal === 'number' ? latestTotal - prevTotal : null,
    };
  });
}

function buildAllocationOption(point: TrendPoint | undefined, isDark: boolean) {
  const labelColor = isDark ? '#cbd5e1' : '#475569';
  const mutedColor = isDark ? '#94a3b8' : '#64748b';
  const data = ASSET_ROWS
    .map((row) => ({
      name: row.label,
      value: point?.[row.assetKey],
    }))
    .filter((item): item is {name: string; value: number} => typeof item.value === 'number' && item.value > 0);

  return {
    backgroundColor: 'transparent',
    color: ['#2563eb', '#0891b2', '#7c3aed', '#ea580c'],
    tooltip: {
      trigger: 'item',
      formatter: (params: {name: string; value: number; percent: number}) =>
        `${params.name}<br/>${formatCompactMoney(params.value)} / ${params.percent.toFixed(1)}%`,
    },
    legend: {
      bottom: 0,
      left: 'center',
      textStyle: {fontSize: 11, color: mutedColor},
      itemWidth: 10,
      itemHeight: 10,
    },
    series: [
      {
        name: '资产结构',
        type: 'pie',
        radius: ['52%', '76%'],
        center: ['50%', '43%'],
        avoidLabelOverlap: true,
        label: {
          color: labelColor,
          formatter: (params: {name: string; value: number; percent: number}) =>
            `${params.name}\n${formatCompactMoney(params.value)} / ${params.percent.toFixed(1)}%`,
          fontSize: 11,
        },
        labelLine: {
          length: 8,
          length2: 6,
        },
        data,
      },
    ],
  };
}

function buildOption(points: TrendPoint[], isDark: boolean, isMobile: boolean) {
  const axisColor = isDark ? '#475569' : '#cbd5e1';
  const labelColor = isDark ? '#94a3b8' : '#64748b';
  const splitColor = isDark ? 'rgba(148,163,184,0.1)' : 'rgba(148,163,184,0.2)';
  const dates = points.map((point) => point.date.slice(5));

  return {
    backgroundColor: 'transparent',
    color: ['#2563eb', '#0891b2', '#7c3aed', '#ea580c', '#16a34a'],
    grid: {top: isMobile ? 64 : 48, right: isMobile ? 16 : 56, bottom: 28, left: 12, containLabel: true},
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
        const point = points[index];
        const date = point?.date || params[0]?.axisValue || '';
        const assetLine = `总资产：${formatCompactMoney(point?.totalAssets)}`;
        const totalChangeLine = `当日变动：${formatFullMoney(point?.totalDelta)}`;
        const sourceLines = ASSET_ROWS.map((row) => `${row.label}：${formatFullMoney(point?.[row.deltaKey] as number | null)}`);
        return `${date}<br/>${assetLine}<br/>${totalChangeLine}<br/><br/>贡献拆解<br/>${sourceLines.join('<br/>')}`;
      },
    },
    xAxis: {
      type: 'category',
      data: dates,
      axisTick: {show: false},
      axisLine: {lineStyle: {color: axisColor}},
      axisLabel: {color: labelColor, fontSize: 11},
    },
    yAxis: [
      {
        type: 'value',
        name: '变动',
        nameTextStyle: {color: labelColor, fontSize: 10},
        axisLabel: {
          formatter: (value: number) => `${(value / 10000).toFixed(0)}万`,
          color: labelColor,
          fontSize: 11,
        },
        splitLine: {lineStyle: {color: splitColor}},
      },
      {
        type: 'value',
        name: '总资产',
        nameTextStyle: {color: labelColor, fontSize: 10},
        position: 'right',
        axisLabel: {
          formatter: (value: number) => `${(value / 10000).toFixed(0)}万`,
          color: labelColor,
          fontSize: 11,
        },
        splitLine: {show: false},
      },
    ],
    series: [
      {
        name: '指数账户',
        type: 'bar',
        stack: 'dailyChange',
        yAxisIndex: 0,
        barMaxWidth: 24,
        data: points.map((point) => point.indexDelta),
      },
      {
        name: '个股账户',
        type: 'bar',
        stack: 'dailyChange',
        yAxisIndex: 0,
        barMaxWidth: 24,
        data: points.map((point) => point.stockDelta),
      },
      {
        name: '支付宝',
        type: 'bar',
        stack: 'dailyChange',
        yAxisIndex: 0,
        barMaxWidth: 24,
        data: points.map((point) => point.alipayDelta),
      },
      {
        name: '财通',
        type: 'bar',
        stack: 'dailyChange',
        yAxisIndex: 0,
        barMaxWidth: 24,
        data: points.map((point) => point.caitongDelta),
      },
      {
        name: '总资产',
        type: 'line',
        yAxisIndex: 1,
        smooth: false,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: {width: 2.8},
        data: points.map((point) => point.totalAssets),
        z: 4,
      },
    ],
  };
}

function FinanceAssetsTrendClient({date, onDateSelect, timeScope}: FinanceAssetsTrendProps) {
  const {colorMode} = useColorMode();
  const isDark = colorMode === 'dark';
  const theme = isDark ? 'dark' : undefined;
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  const [points, setPoints] = useState<TrendPoint[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    setSelectedDate(date || null);
  }, [date]);

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
  const selectedPoint = useMemo(
    () => scopedPoints.find((point) => point.date === selectedDate) || scopedPoints.at(-1),
    [scopedPoints, selectedDate],
  );
  const changes = useMemo(() => ({
    totalAssets: valueChange(scopedPoints, 'totalAssets', selectedPoint?.date),
    indexAssets: valueChange(scopedPoints, 'indexAssets', selectedPoint?.date),
    stockAssets: valueChange(scopedPoints, 'stockAssets', selectedPoint?.date),
    alipayAssets: valueChange(scopedPoints, 'alipayAssets', selectedPoint?.date),
    caitongAssets: valueChange(scopedPoints, 'caitongAssets', selectedPoint?.date),
  }), [scopedPoints, selectedPoint?.date]);
  const chartEvents = {
    click: (params: {dataIndex?: number}) => {
      const point = typeof params.dataIndex === 'number' ? scopedPoints[params.dataIndex] : null;
      if (!point?.date) return;
      setSelectedDate(point.date);
      onDateSelect?.(point.date);
    },
  };

  if (loading) return <div className={styles.skeleton} />;
  if (!scopedPoints.length) return <p className={styles.empty}>暂无总资产趋势数据。</p>;

  return (
    <div className={styles.dashboard}>
      <TotalAssetCard date={selectedPoint?.date} value={selectedPoint?.totalAssets} change={changes.totalAssets} />
      <div className={styles.summary}>
        <SummaryCard label="指数账户" value={selectedPoint?.indexAssets} change={changes.indexAssets} />
        <SummaryCard label="个股账户" value={selectedPoint?.stockAssets} change={changes.stockAssets} />
        <SummaryCard label="支付宝" value={selectedPoint?.alipayAssets} change={changes.alipayAssets} />
        <SummaryCard label="财通" value={selectedPoint?.caitongAssets} change={changes.caitongAssets} />
        <PlaceholderSummaryCard label="招行账户" />
        <PlaceholderSummaryCard label="工行账户" />
        <PlaceholderSummaryCard label="中行账户" />
        <PlaceholderSummaryCard label="期权账户" />
      </div>
      <ReactECharts
        option={buildOption(scopedPoints, isDark, isMobile)}
        theme={theme}
        style={{height: isMobile ? 320 : 340}}
        opts={{renderer: 'svg'}}
        onEvents={chartEvents}
      />
      <div className={styles.allocationPanel}>
        <div className={styles.allocationHeader}>
          <div>
            <span>资产结构</span>
            <strong>{selectedPoint?.date || '最新日期'}</strong>
          </div>
          <small>当前只包含已接入账户</small>
        </div>
        <ReactECharts
          option={buildAllocationOption(selectedPoint, isDark)}
          theme={theme}
          style={{height: isMobile ? 260 : 300}}
          opts={{renderer: 'svg'}}
        />
      </div>
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
