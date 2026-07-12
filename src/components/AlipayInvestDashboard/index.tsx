import {useEffect, useMemo, useState} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import {useColorMode} from '@docusaurus/theme-common';
import ReactECharts from 'echarts-for-react';
import {fetchJsonCached, filterByFinanceTimeScope, type FinanceTimeScope} from '@site/src/components/financeShared';
import styles from './styles.module.css';

type HoldingRecord = {
  name: string;
  source?: string;
  tags?: string[];
  amount?: number;
  amountText?: string;
  marketValue?: number;
  marketValueText?: string;
  dayProfit?: number;
  dayProfitText?: string;
  profit?: number;
  profitText?: string;
  holdingProfit?: number;
  holdingProfitText?: string;
  cumulativeProfit?: number;
  cumulativeProfitText?: string;
  assetRatio?: number;
  assetRatioText?: string;
  holdingReturnRate?: number;
  holdingReturnRateText?: string;
  quantityText?: string;
  costText?: string;
  priceText?: string;
};

type AssetRecord = {
  name: string;
  field?: string;
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
  timeScope?: FinanceTimeScope;
};

type Tone = 'gain' | 'loss' | 'neutral';
type InvestSource = 'alipay' | 'caitong';

type InvestSourceData = {
  source: InvestSource;
  displayDate: string;
  data: InvestPayload;
  dailyPoints: InvestDailyPoint[];
};

const INVEST_SOURCES: InvestSource[] = ['alipay', 'caitong'];

function dateToDataPath(date: string, source: InvestSource): string {
  const [year, month, day] = date.split('-');
  return `/data/invest/${year}/${month}/${day}/${source}.json`;
}

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    return await fetchJsonCached<T>(path);
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

function sourceLabel(source: string | undefined): string {
  if (source === 'alipay') return '支付宝';
  if (source === 'caitong') return '财通';
  return source || '投资';
}

function recordAmount(record: HoldingRecord): number | undefined {
  if (typeof record.amount === 'number') return record.amount;
  if (typeof record.marketValue === 'number') return record.marketValue;
  return undefined;
}

function recordProfit(record: HoldingRecord): number | undefined {
  if (typeof record.holdingProfit === 'number') return record.holdingProfit;
  if (typeof record.profit === 'number') return record.profit;
  if (typeof record.cumulativeProfit === 'number') return record.cumulativeProfit;
  return undefined;
}

function recordProfitText(record: HoldingRecord): string {
  return record.holdingProfitText || record.profitText || record.cumulativeProfitText || '暂无';
}

function payloadTotalAssets(payload: InvestPayload | null | undefined): number | undefined {
  const totalAsset = payload?.assetRecords?.find((record) =>
    record.field === 'totalAsset' ||
    record.name === '总资产' ||
    record.name === '总资产(人民币)'
  )?.amount;
  if (typeof totalAsset === 'number') return totalAsset;
  return payload?.holdingAmountSum;
}

function payloadDayProfit(payload: InvestPayload | null | undefined): number | undefined {
  const dayProfitRecord = payload?.assetRecords?.find((record) => record.field === 'dayProfit')?.amount;
  if (typeof dayProfitRecord === 'number') return dayProfitRecord;
  const yesterdayProfit = payload?.assetRecords
    ?.filter((record) => typeof record.yesterdayProfit === 'number')
    .reduce((sum, record) => sum + (record.yesterdayProfit || 0), 0);
  return yesterdayProfit;
}

function payloadHoldingProfit(payload: InvestPayload | null | undefined): number | undefined {
  const records = payload?.holdingRecords || [];
  if (!records.length) return undefined;
  return records.reduce((sum, record) => sum + (recordProfit(record) || 0), 0);
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
    .filter((record) => typeof recordAmount(record) === 'number' && (recordAmount(record) || 0) > 0)
    .sort((left, right) => (recordAmount(right) || 0) - (recordAmount(left) || 0));

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
        data: sorted.map((record) => ({name: record.name, value: recordAmount(record) || 0})),
      },
    ],
  };
}

function buildProfitOption(records: HoldingRecord[], isDark: boolean, isMobile: boolean) {
  const labelColor = isDark ? '#94a3b8' : '#64748b';
  const splitColor = isDark ? 'rgba(148,163,184,0.1)' : 'rgba(148,163,184,0.2)';
  const sorted = records
    .filter((record) => typeof recordProfit(record) === 'number')
    .sort((left, right) => (recordProfit(left) || 0) - (recordProfit(right) || 0));

  return {
    backgroundColor: 'transparent',
    grid: {top: 8, right: isMobile ? 12 : 86, bottom: 8, left: isMobile ? 92 : 10, containLabel: !isMobile},
    tooltip: {
      trigger: 'item',
      formatter: (params: {dataIndex: number; name: string}) => {
        const item = sorted[params.dataIndex];
        return `${params.name}<br/>持有收益：${formatSigned(recordProfit(item))}<br/>收益率：${item?.holdingReturnRateText || '暂无'}`;
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
          value: recordProfit(record) || 0,
          itemStyle: {
            color: (recordProfit(record) || 0) >= 0 ? '#ef4444' : '#22c55e',
            borderRadius: (recordProfit(record) || 0) >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4],
          },
          label: {
            show: !isMobile,
            position: 'right',
            formatter: () => `${formatSigned(recordProfit(record), 0)} ${record.holdingReturnRateText || ''}`,
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
        smooth: false,
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
        smooth: false,
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
  source,
  data,
  displayDate,
  dailyPoints,
}: {
  source: InvestSource;
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
    () => [...(data.holdingRecords || [])].sort((left, right) => (recordAmount(right) || 0) - (recordAmount(left) || 0)),
    [data.holdingRecords],
  );
  const totalAsset = payloadTotalAssets(data);
  const dayProfit = payloadDayProfit(data);
  const holdingProfit = holdings.reduce((sum, record) => sum + (recordProfit(record) || 0), 0);

  return (
    <div className={styles.dashboard}>
      <div className={styles.sourceHeading}>
        <h4>{sourceLabel(source)}</h4>
        <span>{displayDate}</span>
      </div>
      <div className={styles.summaryGrid}>
        <MetricCard label="总资产" value={formatMoney(totalAsset)} />
        <MetricCard label="昨日收益" value={formatSigned(dayProfit)} tone={toneFor(dayProfit)} />
        <MetricCard label="持有收益" value={formatSigned(holdingProfit)} tone={toneFor(holdingProfit)} />
        <MetricCard label="持仓数量" value={`${data.holdingCount || holdings.length} 项`} />
      </div>
      <div className={styles.metaLine}>
        {data.capturedAt ? <span>采集 {data.capturedAt.replace('T', ' ').slice(0, 16)}</span> : null}
      </div>
      {holdings.length ? (
        <>
          <section className={styles.trendSection}>
            <h4>{sourceLabel(source)}日趋势</h4>
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
                  <th>数量 / 成本 / 现价</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((record) => (
                  <tr key={`${record.name}-${record.amountText}`}>
                    <td>
                      <strong>{record.name}</strong>
                      {record.tags?.length ? <small>{record.tags.join(' · ')}</small> : null}
                    </td>
                    <td>{record.amountText || record.marketValueText || formatMoney(recordAmount(record))}</td>
                    <td>{record.assetRatioText || '暂无'}</td>
                    <td className={styles[toneFor(record.dayProfit)]}>{record.dayProfitText || '暂无'}</td>
                    <td className={styles[toneFor(recordProfit(record))]}>{recordProfitText(record)}</td>
                    <td className={styles[toneFor(record.holdingReturnRate)]}>{record.holdingReturnRateText || '暂无'}</td>
                    <td className={styles[toneFor(record.cumulativeProfit)]}>{record.cumulativeProfitText || '暂无'}</td>
                    <td>{[record.quantityText, record.costText, record.priceText].filter(Boolean).join(' / ') || '暂无'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className={styles.empty}>当天没有可展示的投资持仓记录。</p>
      )}
    </div>
  );
}

function AlipayInvestClient({date, timeScope}: AlipayInvestDashboardProps) {
  const [manifest, setManifest] = useState<InvestManifest | null>(null);
  const [sourceData, setSourceData] = useState<InvestSourceData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSourceData([]);
    (async () => {
      try {
        const nextManifest = await fetchJson<InvestManifest>('/data/invest/index.json');
        if (cancelled) return;
        setManifest(nextManifest);
        const dates = [...new Set(nextManifest?.dates || [])].sort();
        const cappedDates = filterByFinanceTimeScope(dates, (item) => item, undefined, date);
        const scopedDates = filterByFinanceTimeScope(cappedDates, (item) => item, timeScope, date);
        const nextDate = pickDisplayDate(date, scopedDates);
        if (!nextDate) {
          setSourceData([]);
          return;
        }

        const result = await Promise.all(INVEST_SOURCES.map(async (source): Promise<InvestSourceData | null> => {
          const entries = await Promise.all(scopedDates.map(async (itemDate) => ({
            date: itemDate,
            payload: await fetchJson<InvestPayload>(dateToDataPath(itemDate, source)),
          })));
          const availableEntries = entries.filter(
            (entry): entry is {date: string; payload: InvestPayload} => Boolean(entry.payload),
          );
          const sourceDate = pickDisplayDate(nextDate, availableEntries.map((entry) => entry.date));
          const data = availableEntries.find((entry) => entry.date === sourceDate)?.payload;
          if (!sourceDate || !data) return null;
          const dailyPoints = availableEntries.flatMap(({date: itemDate, payload}) => {
            const totalAssets = payloadTotalAssets(payload);
            if (typeof totalAssets !== 'number') return [];
            return [{
              date: itemDate,
              totalAssets,
              dayProfit: payloadDayProfit(payload),
              holdingProfit: payloadHoldingProfit(payload),
            }];
          });
          return {
            source,
            displayDate: sourceDate,
            data: {
              ...data,
              source,
              holdingRecords: (data.holdingRecords || []).map((record) => ({...record, source})),
            },
            dailyPoints,
          };
        }));
        if (!cancelled) setSourceData(result.filter((item): item is InvestSourceData => Boolean(item)));
      } catch {
        if (!cancelled) {
          setManifest(null);
          setSourceData([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date, timeScope]);

  const hasManifest = Boolean(manifest?.dates?.length);
  if (loading) return <div className={styles.skeleton} />;
  if (!hasManifest) return <p className={styles.empty}>暂无投资持仓数据。</p>;
  if (!sourceData.length) return <p className={styles.empty}>选中日期附近没有投资持仓数据。</p>;

  return (
    <div className={styles.sourceStack}>
      {sourceData.map((item) => (
        <AlipayInvestCharts
          key={item.source}
          source={item.source}
          data={item.data}
          displayDate={item.displayDate}
          dailyPoints={item.dailyPoints}
        />
      ))}
    </div>
  );
}

export default function AlipayInvestDashboard(props: AlipayInvestDashboardProps) {
  return (
    <BrowserOnly fallback={<div className={styles.skeleton} />}>
      {() => <AlipayInvestClient {...props} />}
    </BrowserOnly>
  );
}
