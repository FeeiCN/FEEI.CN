import {useEffect, useMemo, useState} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import {useColorMode} from '@docusaurus/theme-common';
import ReactECharts from 'echarts-for-react';
import styles from './styles.module.css';

type HoldingRecord = {
  name: string;
  tags?: string[];
  amount?: number;
  amountText?: string;
  dayProfit?: number;
  dayProfitText?: string;
  holdingProfit?: number;
  holdingProfitText?: string;
  cumulativeProfit?: number;
  cumulativeProfitText?: string;
  assetRatio?: number;
  assetRatioText?: string;
  holdingReturnRate?: number;
  holdingReturnRateText?: string;
};

type AssetRecord = {
  name: string;
  amount?: number;
  amountText?: string;
  yesterdayProfit?: number;
  yesterdayProfitText?: string;
};

type InvestPayload = {
  capturedAt?: string;
  source?: string;
  assetRecords?: AssetRecord[];
  holdingRecords?: HoldingRecord[];
  holdingCount?: number;
  holdingAmountSum?: number;
};

type InvestDailyPoint = {
  date: string;
  totalAssets: number;
  dayProfit: number | undefined;
  holdingProfit: number | undefined;
};

type InvestManifest = {
  dates?: string[];
};

type AlipayInvestDashboardProps = {
  date?: string;
};

type Tone = 'gain' | 'loss' | 'neutral';

function dateToDataPath(date: string): string {
  const [year, month, day] = date.split('-');
  return `/data/invest/${year}/${month}/${day}/alipay.json`;
}

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(path);
    if (!response.ok) return null;
    return JSON.parse(await response.text()) as T;
  } catch {
    return null;
  }
}

function formatMoney(value: number | undefined, digits = 2): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '暂无';
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

function formatSigned(value: number | undefined, digits = 2): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '暂无';
  return `${value >= 0 ? '+' : ''}${formatMoney(value, digits)}`;
}

function toneFor(value: number | undefined): Tone {
  if (typeof value !== 'number' || value === 0) return 'neutral';
  return value > 0 ? 'gain' : 'loss';
}

function pickDisplayDate(date: string | undefined, dates: string[]): string {
  if (date && dates.includes(date)) return date;
  if (date) {
    const previous = dates.filter((item) => item <= date).at(-1);
    if (previous) return previous;
  }
  return dates.at(-1) || date || '';
}

function buildDistributionOption(records: HoldingRecord[], isDark: boolean, isMobile: boolean) {
  const labelColor = isDark ? '#94a3b8' : '#64748b';
  const colors = ['#2563eb', '#0891b2', '#7c3aed', '#db2777', '#ea580c', '#65a30d', '#0d9488', '#ca8a04'];
  const sorted = records
    .filter((record) => typeof record.amount === 'number' && record.amount > 0)
    .sort((left, right) => (right.amount || 0) - (left.amount || 0));

  return {
    backgroundColor: 'transparent',
    color: colors,
    tooltip: {
      trigger: 'item',
      formatter: (params: {name: string; value: number; percent: number}) =>
        `${params.name}<br/>金额：${formatMoney(params.value)}<br/>占比：${params.percent}%`,
    },
    legend: isMobile
      ? {show: false}
      : {type: 'scroll', orient: 'vertical', right: 0, top: 12, bottom: 12, textStyle: {fontSize: 11, color: labelColor}},
    series: [
      {
        name: '持仓金额',
        type: 'pie',
        radius: isMobile ? ['42%', '68%'] : ['45%', '72%'],
        center: isMobile ? ['50%', '50%'] : ['38%', '50%'],
        label: {formatter: '{d}%', color: labelColor, fontSize: 11},
        labelLine: {length: 8, length2: 6},
        data: sorted.map((record) => ({name: record.name, value: record.amount || 0})),
      },
    ],
  };
}

function buildProfitOption(records: HoldingRecord[], isDark: boolean, isMobile: boolean) {
  const labelColor = isDark ? '#94a3b8' : '#64748b';
  const splitColor = isDark ? 'rgba(148,163,184,0.1)' : 'rgba(148,163,184,0.2)';
  const sorted = records
    .filter((record) => typeof record.holdingProfit === 'number')
    .sort((left, right) => (left.holdingProfit || 0) - (right.holdingProfit || 0));

  return {
    backgroundColor: 'transparent',
    grid: {top: 8, right: isMobile ? 12 : 86, bottom: 8, left: isMobile ? 92 : 10, containLabel: !isMobile},
    tooltip: {
      trigger: 'item',
      formatter: (params: {dataIndex: number; name: string}) => {
        const item = sorted[params.dataIndex];
        return `${params.name}<br/>持有收益：${formatSigned(item?.holdingProfit)}<br/>收益率：${item?.holdingReturnRateText || '暂无'}`;
      },
    },
    xAxis: {
      type: 'value',
      axisLabel: {
        show: !isMobile,
        formatter: (value: number) => `${value > 0 ? '+' : ''}${(value / 1000).toFixed(0)}k`,
        color: labelColor,
        fontSize: 11,
      },
      splitLine: {show: !isMobile, lineStyle: {color: splitColor}},
      axisLine: {show: false},
    },
    yAxis: {
      type: 'category',
      data: sorted.map((record) => record.name),
      axisLabel: {
        color: labelColor,
        fontSize: isMobile ? 10 : 12,
        width: isMobile ? 80 : undefined,
        overflow: isMobile ? 'truncate' : 'none',
      },
      axisTick: {show: false},
      axisLine: {show: false},
    },
    series: [
      {
        type: 'bar',
        barMaxWidth: 24,
        data: sorted.map((record) => ({
          value: record.holdingProfit || 0,
          itemStyle: {
            color: (record.holdingProfit || 0) >= 0 ? '#ef4444' : '#22c55e',
            borderRadius: (record.holdingProfit || 0) >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4],
          },
          label: {
            show: !isMobile,
            position: 'right',
            formatter: () => `${formatSigned(record.holdingProfit, 0)} ${record.holdingReturnRateText || ''}`,
            color: labelColor,
            fontSize: 11,
          },
        })),
      },
    ],
  };
}

function buildDailyTrendOption(points: InvestDailyPoint[], isDark: boolean, isMobile: boolean) {
  const axisColor = isDark ? '#475569' : '#cbd5e1';
  const labelColor = isDark ? '#94a3b8' : '#64748b';
  const splitColor = isDark ? 'rgba(148,163,184,0.1)' : 'rgba(148,163,184,0.2)';

  return {
    backgroundColor: 'transparent',
    color: ['#2563eb', '#ef4444', '#7c3aed'],
    grid: {top: isMobile ? 54 : 42, right: 18, bottom: 28, left: 12, containLabel: true},
    legend: {
      top: 0,
      right: 0,
      textStyle: {fontSize: 12, color: labelColor},
      itemHeight: 10,
    },
    tooltip: {
      trigger: 'axis',
      formatter: (params: Array<{seriesName: string; value: number; dataIndex: number}>) => {
        const date = points[params[0]?.dataIndex || 0]?.date || '';
        const lines = params.map((item) => `${item.seriesName}：${item.seriesName === '总资产' ? formatMoney(item.value) : formatSigned(item.value)}`);
        return `${date}<br/>${lines.join('<br/>')}`;
      },
    },
    xAxis: {
      type: 'category',
      data: points.map((point) => point.date.slice(5)),
      axisTick: {show: false},
      axisLine: {lineStyle: {color: axisColor}},
      axisLabel: {color: labelColor, fontSize: 11},
    },
    yAxis: [
      {
        type: 'value',
        axisLabel: {
          formatter: (value: number) => `${(value / 10000).toFixed(0)}万`,
          color: labelColor,
          fontSize: 11,
        },
        splitLine: {lineStyle: {color: splitColor}},
      },
      {
        type: 'value',
        axisLabel: {
          show: !isMobile,
          formatter: (value: number) => `${value >= 0 ? '+' : ''}${(value / 1000).toFixed(0)}k`,
          color: labelColor,
          fontSize: 11,
        },
        splitLine: {show: false},
      },
    ],
    series: [
      {
        name: '总资产',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
        data: points.map((point) => point.totalAssets),
        lineStyle: {width: 2.4},
      },
      {
        name: '昨日收益',
        type: 'bar',
        yAxisIndex: 1,
        barMaxWidth: 10,
        data: points.map((point) => ({
          value: point.dayProfit || 0,
          itemStyle: {
            color: (point.dayProfit || 0) >= 0 ? '#ef4444' : '#22c55e',
            borderRadius: [2, 2, 0, 0],
          },
        })),
      },
      {
        name: '持有收益',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        symbol: 'none',
        data: points.map((point) => point.holdingProfit || 0),
        lineStyle: {width: 1.8},
      },
    ],
  };
}

function MetricCard({label, value, tone = 'neutral'}: {label: string; value: string; tone?: Tone}) {
  return (
    <div className={styles.metricCard}>
      <span>{label}</span>
      <strong className={tone !== 'neutral' ? styles[tone] : undefined}>{value}</strong>
    </div>
  );
}

function AlipayInvestCharts({
  data,
  displayDate,
  dailyPoints,
}: {
  data: InvestPayload;
  displayDate: string;
  dailyPoints: InvestDailyPoint[];
}) {
  const {colorMode} = useColorMode();
  const isDark = colorMode === 'dark';
  const theme = isDark ? 'dark' : undefined;
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const holdings = useMemo(
    () => [...(data.holdingRecords || [])].sort((left, right) => (right.amount || 0) - (left.amount || 0)),
    [data.holdingRecords],
  );
  const totalAsset = data.assetRecords?.find((record) => record.name === '总资产')?.amount ?? data.holdingAmountSum;
  const dayProfit = data.assetRecords
    ?.filter((record) => typeof record.yesterdayProfit === 'number')
    .reduce((sum, record) => sum + (record.yesterdayProfit || 0), 0);
  const holdingProfit = holdings.reduce((sum, record) => sum + (record.holdingProfit || 0), 0);

  return (
    <div className={styles.dashboard}>
      <div className={styles.summaryGrid}>
        <MetricCard label="总资产" value={formatMoney(totalAsset)} />
        <MetricCard label="昨日收益" value={formatSigned(dayProfit)} tone={toneFor(dayProfit)} />
        <MetricCard label="持有收益" value={formatSigned(holdingProfit)} tone={toneFor(holdingProfit)} />
        <MetricCard label="持仓数量" value={`${data.holdingCount || holdings.length} 项`} />
      </div>
      <div className={styles.metaLine}>
        <span>{displayDate}</span>
        {data.capturedAt ? <span>采集 {data.capturedAt.replace('T', ' ').slice(0, 16)}</span> : null}
      </div>
      {holdings.length ? (
        <>
          <section className={styles.trendSection}>
            <h4>支付宝日趋势</h4>
            <ReactECharts
              option={buildDailyTrendOption(dailyPoints.length ? dailyPoints : [{
                date: displayDate,
                totalAssets: totalAsset || 0,
                dayProfit,
                holdingProfit,
              }], isDark, isMobile)}
              theme={theme}
              style={{height: isMobile ? 320 : 300}}
              opts={{renderer: 'svg'}}
            />
          </section>
          <div className={styles.chartGrid}>
            <section>
              <h4>持仓金额分布</h4>
              <ReactECharts
                option={buildDistributionOption(holdings, isDark, isMobile)}
                theme={theme}
                style={{height: isMobile ? 340 : 320}}
                opts={{renderer: 'svg'}}
              />
            </section>
            <section>
              <h4>持有收益</h4>
              <ReactECharts
                option={buildProfitOption(holdings, isDark, isMobile)}
                theme={theme}
                style={{height: Math.max(320, holdings.length * 34)}}
                opts={{renderer: 'svg'}}
              />
            </section>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>名称</th>
                  <th>金额</th>
                  <th>占比</th>
                  <th>日收益</th>
                  <th>持有收益</th>
                  <th>收益率</th>
                  <th>累计收益</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((record) => (
                  <tr key={`${record.name}-${record.amountText}`}>
                    <td>
                      <strong>{record.name}</strong>
                      {record.tags?.length ? <small>{record.tags.join(' · ')}</small> : null}
                    </td>
                    <td>{record.amountText || formatMoney(record.amount)}</td>
                    <td>{record.assetRatioText || '暂无'}</td>
                    <td className={styles[toneFor(record.dayProfit)]}>{record.dayProfitText || '暂无'}</td>
                    <td className={styles[toneFor(record.holdingProfit)]}>{record.holdingProfitText || '暂无'}</td>
                    <td className={styles[toneFor(record.holdingReturnRate)]}>{record.holdingReturnRateText || '暂无'}</td>
                    <td className={styles[toneFor(record.cumulativeProfit)]}>{record.cumulativeProfitText || '暂无'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className={styles.empty}>当天没有可展示的支付宝持仓记录。</p>
      )}
    </div>
  );
}

function AlipayInvestClient({date}: AlipayInvestDashboardProps) {
  const [manifest, setManifest] = useState<InvestManifest | null>(null);
  const [data, setData] = useState<InvestPayload | null>(null);
  const [dailyPoints, setDailyPoints] = useState<InvestDailyPoint[]>([]);
  const [displayDate, setDisplayDate] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchJson<InvestManifest>('/data/invest/index.json')
      .then((nextManifest) => {
        if (cancelled) return;
        const dates = (nextManifest?.dates || []).slice().sort();
        const nextDate = pickDisplayDate(date, dates);
        setManifest(nextManifest);
        setDisplayDate(nextDate);
        if (!nextDate) return null;
        return Promise.all([
          fetchJson<InvestPayload>(dateToDataPath(nextDate)),
          Promise.all(dates.map(async (itemDate) => {
            const payload = await fetchJson<InvestPayload>(dateToDataPath(itemDate));
            const totalAssets = payload?.assetRecords?.find((record) => record.name === '总资产')?.amount ?? payload?.holdingAmountSum;
            if (typeof totalAssets !== 'number') return null;
            const dayProfit = payload?.assetRecords
              ?.filter((record) => typeof record.yesterdayProfit === 'number')
              .reduce((sum, record) => sum + (record.yesterdayProfit || 0), 0);
            const holdingProfit = payload?.holdingRecords
              ?.reduce((sum, record) => sum + (record.holdingProfit || 0), 0);
            return {date: itemDate, totalAssets, dayProfit, holdingProfit};
          })),
        ]);
      })
      .then((result) => {
        if (cancelled) return;
        if (!result) {
          setData(null);
          setDailyPoints([]);
          return;
        }
        const [nextData, nextDailyPoints] = result;
        setData(nextData || null);
        setDailyPoints(nextDailyPoints.filter((point): point is InvestDailyPoint => point !== null));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [date]);

  const hasManifest = Boolean(manifest?.dates?.length);
  if (loading) return <div className={styles.skeleton} />;
  if (!hasManifest) return <p className={styles.empty}>暂无支付宝持仓数据。</p>;
  if (!data) return <p className={styles.empty}>选中日期附近没有支付宝持仓数据。</p>;

  return <AlipayInvestCharts data={data} displayDate={displayDate} dailyPoints={dailyPoints} />;
}

export default function AlipayInvestDashboard(props: AlipayInvestDashboardProps) {
  return (
    <BrowserOnly fallback={<div className={styles.skeleton} />}>
      {() => <AlipayInvestClient {...props} />}
    </BrowserOnly>
  );
}
