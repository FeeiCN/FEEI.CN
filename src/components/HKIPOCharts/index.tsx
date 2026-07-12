import {useEffect, useMemo, useState} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import {useColorMode} from '@docusaurus/theme-common';
import ReactECharts from 'echarts-for-react';
import {
  fetchJsonCached,
  filterByFinanceTimeScope,
  latestDateKey,
  type FinanceTimeScope,
} from '@site/src/components/financeShared';
import styles from './styles.module.css';

type Trade = {
  date: string;
  account: 'FeeiCN' | 'FeeiCN2';
  name: string;
  pnl: number;
  sold?: boolean;
};

type Summary = {
  totalCount: number;
  totalPnl: number;
  currency: string;
};

type IPORow = {
  account: string;
  code: string;
  stockName: string;
  tradeDate: string;
  listingDate: string;
  delta: number | null;
  deltaText: string;
  qty: number;
  issuePrice: number | null;
  price: number;
  amount: number;
  pnl: number | null;
  pnlPct: number | null;
};

type IPOPayload = {
  fetchedAt?: string;
  summary: Summary;
  trades: Trade[];
  rows: IPORow[];
};

function filterPayloadByScope(
  payload: IPOPayload,
  scope?: FinanceTimeScope,
  endDate?: string,
): IPOPayload {
  if ((!scope || scope.mode === 'all') && !endDate) return payload;
  const dates = [
    ...payload.trades.map((trade) => trade.date),
    ...payload.rows.map((row) => row.tradeDate.slice(0, 10)),
  ];
  const rangeEnd = endDate || latestDateKey(dates, (date) => date);
  const trades = filterByFinanceTimeScope(payload.trades, (trade) => trade.date, scope, rangeEnd);
  const rows = filterByFinanceTimeScope(payload.rows, (row) => row.tradeDate.slice(0, 10), scope, rangeEnd);
  return {
    ...payload,
    trades,
    rows,
    summary: {
      ...payload.summary,
      totalCount: trades.length,
      totalPnl: trades.reduce((sum, trade) => sum + trade.pnl, 0),
    },
  };
}

function processData(trades: Trade[]) {
  const dates = [...new Set(trades.map((t) => t.date))].sort();

  let cnCumul = 0;
  let cn2Cumul = 0;
  let totalCumul = 0;
  let cn2Started = false;

  const cnPnl: number[] = [];
  const cn2Pnl: number[] = [];
  const total: number[] = [];
  const feeiCN: number[] = [];
  const feeiCN2: (number | null)[] = [];

  for (const date of dates) {
    const day = trades.filter((t) => t.date === date);
    const cn = day.filter((t) => t.account === 'FeeiCN').reduce((s, t) => s + t.pnl, 0);
    const cn2 = day.filter((t) => t.account === 'FeeiCN2').reduce((s, t) => s + t.pnl, 0);

    if (cn2 > 0) cn2Started = true;
    cnCumul += cn;
    cn2Cumul += cn2;
    totalCumul += cn + cn2;

    cnPnl.push(cn);
    cn2Pnl.push(cn2);
    total.push(totalCumul);
    feeiCN.push(cnCumul);
    feeiCN2.push(cn2Started ? cn2Cumul : null);
  }

  return {dates, cnPnl, cn2Pnl, total, feeiCN, feeiCN2};
}

function buildOption(trades: Trade[], isDark: boolean) {
  const {dates, cnPnl, cn2Pnl, total, feeiCN, feeiCN2} = processData(trades);

  const labelColor = isDark ? '#94a3b8' : '#64748b';
  const splitColor = isDark ? 'rgba(148,163,184,0.1)' : 'rgba(148,163,184,0.2)';
  const axisColor = isDark ? '#475569' : '#cbd5e1';

  return {
    backgroundColor: 'transparent',
    grid: {top: 36, right: 56, bottom: 56, left: 12, containLabel: true},
    legend: {
      data: ['总累计', 'FeeiCN累计', 'FeeiCN2累计', 'FeeiCN', 'FeeiCN2'],
      top: 0,
      right: 0,
      textStyle: {fontSize: 11, color: labelColor},
      itemHeight: 10,
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: {type: 'cross', label: {backgroundColor: '#7c3aed'}},
      formatter: (params: Array<{seriesName: string; value?: number | null; axisValue?: string}>) => {
        const date = params[0]?.axisValue ?? '';
        const dayTrades = trades.filter((t) => t.date === date);
        const cnDay = dayTrades.filter((t) => t.account === 'FeeiCN');
        const cn2Day = dayTrades.filter((t) => t.account === 'FeeiCN2');

        const lines: string[] = [date];

        if (cnDay.length > 0) {
          lines.push(
            `FeeiCN：${cnDay
              .map((t) => `${t.name}${t.sold !== false ? ` +${t.pnl.toLocaleString()}` : ' 未卖出'}`)
              .join('、')}`,
          );
        }
        if (cn2Day.length > 0) {
          lines.push(
            `FeeiCN2：${cn2Day
              .map((t) => `${t.name}${t.sold !== false ? ` +${t.pnl.toLocaleString()}` : ' 未卖出'}`)
              .join('、')}`,
          );
        }

        params
          .filter(
            (p) =>
              ['总累计', 'FeeiCN累计', 'FeeiCN2累计'].includes(p.seriesName) &&
              typeof p.value === 'number' &&
              Number.isFinite(p.value),
          )
          .forEach((p) => lines.push(`${p.seriesName}：+${p.value!.toLocaleString()} HKD`));

        return lines.join('<br/>');
      },
    },
    xAxis: {
      type: 'category',
      data: dates,
      axisTick: {show: false},
      axisLine: {lineStyle: {color: axisColor}},
      axisLabel: {color: labelColor, fontSize: 10, rotate: 35, interval: 0},
    },
    yAxis: [
      {
        type: 'value',
        min: 0,
        axisLabel: {
          formatter: (v: number) => `${(v / 10000).toFixed(0)}万`,
          color: labelColor,
          fontSize: 11,
        },
        splitLine: {lineStyle: {color: splitColor}},
      },
      {
        type: 'value',
        axisLabel: {
          formatter: (v: number) => `${(v / 1000).toFixed(0)}k`,
          color: labelColor,
          fontSize: 11,
        },
        splitLine: {show: false},
      },
    ],
    series: [
      {
        name: 'FeeiCN',
        type: 'bar',
        stack: 'pnl',
        yAxisIndex: 1,
        barMaxWidth: 14,
        itemStyle: {color: '#ef4444'},
        data: cnPnl,
      },
      {
        name: 'FeeiCN2',
        type: 'bar',
        stack: 'pnl',
        yAxisIndex: 1,
        barMaxWidth: 14,
        itemStyle: {color: '#f97316', borderRadius: [2, 2, 0, 0]},
        data: cn2Pnl,
      },
      {
        name: 'FeeiCN累计',
        type: 'line',
        yAxisIndex: 0,
        data: feeiCN,
        smooth: false,
        symbol: 'none',
        lineStyle: {width: 2, color: '#2563eb'},
      },
      {
        name: 'FeeiCN2累计',
        type: 'line',
        yAxisIndex: 0,
        data: feeiCN2,
        smooth: false,
        symbol: 'none',
        connectNulls: false,
        lineStyle: {width: 2, color: '#0891b2'},
      },
      {
        name: '总累计',
        type: 'line',
        yAxisIndex: 0,
        data: total,
        smooth: false,
        symbol: 'none',
        lineStyle: {width: 2.5, color: '#7c3aed'},
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              {offset: 0, color: 'rgba(124,58,237,0.12)'},
              {offset: 1, color: 'rgba(124,58,237,0)'},
            ],
          },
        },
      },
    ],
  };
}

function formatValue(value: number | string | null | undefined, digits = 2) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number') return value.toFixed(digits);
  return String(value);
}

function formatPnl(value: number | null | undefined, digits = 0) {
  if (typeof value !== 'number') return '';
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function formatPnlPct(value: number | null | undefined) {
  if (typeof value !== 'number') return '';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function toneClass(value: number | null | undefined) {
  if (typeof value !== 'number' || value === 0) return undefined;
  return value > 0 ? styles.gain : styles.loss;
}

function buildPayloadFromTrades(trades: Trade[]): IPOPayload {
  const totalPnl = trades.reduce((sum, trade) => sum + trade.pnl, 0);
  return {
    summary: {
      totalCount: trades.length,
      totalPnl,
      currency: 'HKD',
    },
    trades,
    rows: [],
  };
}

function getDateFromChartParams(params: unknown): string | null {
  const record = params && typeof params === 'object' ? params as Record<string, unknown> : {};
  const candidates = [record.axisValue, record.name, record.value];
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const match = candidate.match(/\d{4}-\d{2}-\d{2}/);
      if (match) return match[0];
    }
    if (Array.isArray(candidate)) {
      const date = candidate.find((item) => typeof item === 'string' && /\d{4}-\d{2}-\d{2}/.test(item));
      if (typeof date === 'string') return date.slice(0, 10);
    }
  }
  return null;
}

function IPOChart({trades, onDateSelect}: {trades: Trade[]; onDateSelect?: (date: string) => void}) {
  const {colorMode} = useColorMode();
  const isDark = colorMode === 'dark';
  const onEvents = onDateSelect
    ? {
        click: (params: unknown) => {
          const date = getDateFromChartParams(params);
          if (date) onDateSelect(date);
        },
      }
    : undefined;

  return (
    <div className={styles.wrap}>
      <ReactECharts
        option={buildOption(trades, isDark)}
        theme={isDark ? 'dark' : undefined}
        style={{height: 320}}
        opts={{renderer: 'svg'}}
        onEvents={onEvents}
      />
    </div>
  );
}

function SummaryLine({summary}: {summary: Summary}) {
  const pnl = formatPnl(summary.totalPnl, 0);
  return (
    <p className={styles.summary}>
      共 {summary.totalCount} 条，合计盈亏{' '}
      <span className={toneClass(summary.totalPnl)}>{pnl} {summary.currency}</span>
    </p>
  );
}

function IPOTable({rows}: {rows: IPORow[]}) {
  if (rows.length === 0) return null;

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>账户</th>
            <th>代码</th>
            <th>名称</th>
            <th>交易时间</th>
            <th>上市日期</th>
            <th>距上市</th>
            <th>数量</th>
            <th>发行价</th>
            <th>交易价</th>
            <th>交易金额</th>
            <th>盈亏</th>
            <th>盈亏率</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.account}-${row.code}-${row.tradeDate}-${index}`}>
              <td>{row.account}</td>
              <td>{row.code}</td>
              <td>{row.stockName}</td>
              <td>{row.tradeDate}</td>
              <td>{row.listingDate}</td>
              <td>{row.deltaText}</td>
              <td>{formatValue(row.qty)}</td>
              <td>{formatValue(row.issuePrice)}</td>
              <td>{formatValue(row.price)}</td>
              <td>{formatValue(row.amount, 0)}</td>
              <td className={toneClass(row.pnl)}>{formatPnl(row.pnl, 0)}</td>
              <td className={toneClass(row.pnlPct)}>{formatPnlPct(row.pnlPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Skeleton() {
  return (
    <div className={styles.skeleton}>
      <div className={styles.skeletonChart} />
      <div className={styles.skeletonTable} />
    </div>
  );
}

function Dashboard({
  payload,
  date,
  onDateSelect,
  timeScope,
  compact = false,
}: {
  payload: IPOPayload;
  date?: string;
  onDateSelect?: (date: string) => void;
  timeScope?: FinanceTimeScope;
  compact?: boolean;
}) {
  const scopedPayload = useMemo(
    () => filterPayloadByScope(payload, timeScope, date),
    [date, payload, timeScope],
  );
  return (
    <div>
      <IPOChart trades={scopedPayload.trades} onDateSelect={onDateSelect} />
      {compact ? null : (
        <>
          <SummaryLine summary={scopedPayload.summary} />
          <IPOTable rows={scopedPayload.rows} />
          {payload.fetchedAt && <div className={styles.footer}>数据更新于 {payload.fetchedAt}</div>}
        </>
      )}
    </div>
  );
}

function HKIPOInner({
  trades,
  dataUrl,
  date,
  onDateSelect,
  timeScope,
  compact,
}: {
  trades?: Trade[];
  dataUrl?: string;
  date?: string;
  onDateSelect?: (date: string) => void;
  timeScope?: FinanceTimeScope;
  compact?: boolean;
}) {
  const fallbackPayload = useMemo(() => buildPayloadFromTrades(trades ?? []), [trades]);
  const [payload, setPayload] = useState<IPOPayload>(fallbackPayload);
  const [loading, setLoading] = useState(Boolean(dataUrl));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dataUrl) {
      setPayload(fallbackPayload);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const json = await fetchJsonCached<IPOPayload>(dataUrl);
        if (cancelled) return;
        setPayload(json);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message || '加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dataUrl, fallbackPayload]);

  if (loading) return <Skeleton />;
  if (error) return <div className={styles.error}>{error}</div>;

  return (
    <Dashboard
      payload={payload}
      date={date}
      onDateSelect={onDateSelect}
      timeScope={timeScope}
      compact={compact}
    />
  );
}

export default function HKIPOCharts({
  trades,
  dataUrl,
  date,
  onDateSelect,
  timeScope,
  compact,
}: {
  trades?: Trade[];
  dataUrl?: string;
  date?: string;
  onDateSelect?: (date: string) => void;
  timeScope?: FinanceTimeScope;
  compact?: boolean;
}) {
  return (
    <BrowserOnly fallback={<div style={{minHeight: 320}} />}>
      {() => (
        <HKIPOInner
          trades={trades}
          dataUrl={dataUrl}
          date={date}
          onDateSelect={onDateSelect}
          timeScope={timeScope}
          compact={compact}
        />
      )}
    </BrowserOnly>
  );
}
