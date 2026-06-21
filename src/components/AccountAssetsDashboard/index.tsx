import {useEffect, useState} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import PortfolioCharts from '@site/src/components/PortfolioCharts';
import styles from './styles.module.css';

type HistoryPoint = {
  date: string;
  fullDate?: string;
  totalAssets: number;
  securitiesValue: number;
  dailyChange: number;
};

type Holding = {
  name: string;
  value: number;
  currency: string;
  pnl: number;
  pnlPct: number;
};

type PortfolioData = {
  history: HistoryPoint[];
  holdings: Holding[];
};

type FundRow = {
  date: string;
  accountLabel: string;
  currency: string;
  totalAssets: number | null;
  totalAssetsDelta: number | null;
  cash: number | null;
  marketVal: number | null;
  power: number | null;
  avlWithdrawalCash: number | null;
};

type PositionRow = {
  accountLabel: string;
  stockName: string;
  positionMarket: string;
  currency: string;
  plVal: number | null;
  plRatio: number | null;
  todayPlVal: number | null;
  marketVal: number | null;
  qty: number | null;
  nominalPrice: number | null;
  dilutedCost: number | null;
  todayBuyVal: number | null;
  todayBuyQty: number | null;
  todayTrdVal: number | null;
  todaySellVal: number | null;
  todaySellQty: number | null;
  unrealizedPl: number | null;
  realizedPl: number | null;
  isSummary?: boolean;
};

type AccountAssetsPayload = {
  fetchedAt?: string;
  accountLabel: string;
  portfolio: PortfolioData;
  fundRows: FundRow[];
  positionRows: PositionRow[];
};

type TimeScope =
  | {mode: 'recent'; range: '7d' | '30d' | '90d' | '1y'}
  | {mode: 'year'; year: number}
  | {mode: 'all'};

type Tone = 'gain' | 'loss' | 'neutral';

type CellLine = {
  text: string;
  tone?: Tone;
};

function formatValue(value: number | string | null | undefined) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return value.toFixed(1);
  return String(value);
}

function formatSignedValue(value: number | null | undefined) {
  if (typeof value !== 'number') return '';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
}

function formatPercent(value: number | null | undefined) {
  if (typeof value !== 'number') return '';
  return `${value.toFixed(1)}%`;
}

function formatMoney(value: number | null | undefined, currency?: string) {
  const text = formatValue(value);
  if (!text) return '';
  return currency ? `${text} ${currency}` : text;
}

function formatSignedMoney(value: number | null | undefined, currency?: string) {
  const text = formatSignedValue(value);
  if (!text) return '';
  return currency ? `${text} ${currency}` : text;
}

function toneForNumber(value: number | null | undefined): Tone {
  if (typeof value !== 'number' || value === 0) return 'neutral';
  return value > 0 ? 'gain' : 'loss';
}

function joinLines(...values: Array<string | number | null | undefined>): CellLine[] {
  return values
    .map((value) => formatValue(value))
    .filter(Boolean)
    .map((text) => ({text}));
}

function Cell({lines, strong}: {lines: CellLine[]; strong?: boolean}) {
  if (lines.length === 0) return <td />;

  return (
    <td className={strong ? styles.strongCell : undefined}>
      {lines.map((line, index) => (
        <span
          key={`${line.text}-${index}`}
          className={line.tone && line.tone !== 'neutral' ? styles[line.tone] : undefined}
        >
          {line.text}
          {index < lines.length - 1 && <br />}
        </span>
      ))}
    </td>
  );
}

function FundTable({rows}: {rows: FundRow[]}) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>日期</th>
            <th>账户</th>
            <th>币种</th>
            <th>总资产</th>
            <th>昨日差额</th>
            <th>现金</th>
            <th>证券市值</th>
            <th>最大购买力</th>
            <th>可提现金</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.date}-${row.accountLabel}`}>
              <Cell lines={[{text: row.date}]} />
              <Cell lines={[{text: row.accountLabel}]} />
              <Cell lines={[{text: row.currency}]} />
              <Cell lines={[{text: formatValue(row.totalAssets)}]} />
              <Cell lines={[{text: formatSignedValue(row.totalAssetsDelta), tone: toneForNumber(row.totalAssetsDelta)}]} />
              <Cell lines={[{text: formatValue(row.cash)}]} />
              <Cell lines={[{text: formatValue(row.marketVal)}]} />
              <Cell lines={[{text: formatValue(row.power)}]} />
              <Cell lines={[{text: formatValue(row.avlWithdrawalCash)}]} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PositionTable({rows}: {rows: PositionRow[]}) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>账户</th>
            <th>名称</th>
            <th>市场</th>
            <th>盈亏 / 盈亏比例</th>
            <th>今日盈亏</th>
            <th>市值 / 持仓数量</th>
            <th>市价 / 摊薄成本</th>
            <th>今日买入金额 / 数量</th>
            <th>今日交易金额</th>
            <th>今日卖出金额 / 数量</th>
            <th>未实现盈亏</th>
            <th>已实现盈亏</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const strong = row.isSummary === true;
            const rowKey = `${row.accountLabel}-${row.stockName}-${index}`;
            return (
              <tr key={rowKey} className={strong ? styles.summaryRow : undefined}>
                <Cell lines={[{text: row.accountLabel}]} strong={strong} />
                <Cell lines={[{text: row.stockName}]} strong={strong} />
                <Cell lines={[{text: row.positionMarket}]} />
                <Cell
                  lines={[
                    {text: formatMoney(row.plVal, strong ? row.currency : undefined), tone: toneForNumber(row.plVal)},
                    {text: formatPercent(row.plRatio), tone: toneForNumber(row.plRatio)},
                  ]}
                />
                <Cell lines={[{text: formatSignedMoney(row.todayPlVal, row.currency), tone: toneForNumber(row.todayPlVal)}]} />
                <Cell lines={joinLines(formatMoney(row.marketVal, strong ? row.currency : undefined), row.qty)} />
                <Cell lines={joinLines(row.nominalPrice, row.dilutedCost)} />
                <Cell lines={joinLines(formatMoney(row.todayBuyVal, strong ? row.currency : undefined), row.todayBuyQty)} />
                <Cell lines={[{text: formatMoney(row.todayTrdVal, strong ? row.currency : undefined)}]} />
                <Cell lines={joinLines(formatMoney(row.todaySellVal, strong ? row.currency : undefined), row.todaySellQty)} />
                <Cell lines={[{text: formatMoney(row.unrealizedPl, strong ? row.currency : undefined)}]} />
                <Cell lines={[{text: formatMoney(row.realizedPl, strong ? row.currency : undefined)}]} />
              </tr>
            );
          })}
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
      <div className={styles.skeletonTable} />
    </div>
  );
}

function DashboardInner({
  dataUrl,
  onDateSelect,
  timeScope,
  compact = false,
}: {
  dataUrl: string;
  onDateSelect?: (date: string) => void;
  timeScope?: TimeScope;
  compact?: boolean;
}) {
  const [data, setData] = useState<AccountAssetsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(dataUrl, {cache: 'no-store'});
        if (!response.ok) {
          throw new Error('暂无账户资产数据');
        }
        const json = (await response.json()) as AccountAssetsPayload;
        if (cancelled) return;
        setData(json);
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
  }, [dataUrl]);

  if (loading) return <Skeleton />;
  if (error) return <div className={styles.error}>{error}</div>;
  if (!data) return <div className={styles.error}>暂无数据</div>;

  return (
    <div className={styles.dashboard}>
      <PortfolioCharts data={data.portfolio} onDateSelect={onDateSelect} timeScope={timeScope} compact={compact} />
      {compact ? null : (
        <>
          <h2>资金</h2>
          <FundTable rows={data.fundRows} />
          <h2>持仓</h2>
          <PositionTable rows={data.positionRows} />
          {data.fetchedAt && <div className={styles.footer}>数据更新于 {data.fetchedAt}</div>}
        </>
      )}
    </div>
  );
}

export default function AccountAssetsDashboard({
  dataUrl,
  onDateSelect,
  timeScope,
  compact,
}: {
  dataUrl: string;
  onDateSelect?: (date: string) => void;
  timeScope?: TimeScope;
  compact?: boolean;
}) {
  return (
    <BrowserOnly fallback={<div style={{minHeight: 620}} />}>
      {() => <DashboardInner dataUrl={dataUrl} onDateSelect={onDateSelect} timeScope={timeScope} compact={compact} />}
    </BrowserOnly>
  );
}
