import {useEffect, useMemo, useState} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import {useColorMode} from '@docusaurus/theme-common';
import ReactECharts from 'echarts-for-react';
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

type TimeScope =
  | {mode: 'recent'; range: '7d' | '30d' | '90d' | '1y'}
  | {mode: 'year'; year: number}
  | {mode: 'all'};
const RANGE_DAYS: Record<string, number> = {'7d': 7, '30d': 30, '90d': 90, '1y': 365};

function getItemDate(item: {date: string; fullDate?: string}): string {
  return item.fullDate || item.date;
}

function filterByScope<T extends {date: string; fullDate?: string}>(items: T[], scope?: TimeScope): T[] {
  if (!scope || scope.mode === 'all') return items;
  if (scope.mode === 'year') return items.filter((item) => getItemDate(item).startsWith(`${scope.year}-`));
  const latest = items.map(getItemDate).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort().at(-1);
  if (!latest) return [];
  const cutoff = new Date(`${latest}T00:00:00`);
  cutoff.setDate(cutoff.getDate() - RANGE_DAYS[scope.range]);
  const cutoffKey = cutoff.toISOString().slice(0, 10);
  return items.filter((item) => getItemDate(item) >= cutoffKey);
}

function buildLineOption(data: PortfolioData, isDark: boolean, isMobile: boolean) {
  const axisColor = isDark ? '#475569' : '#cbd5e1';
  const labelColor = isDark ? '#94a3b8' : '#64748b';
  const splitColor = isDark ? 'rgba(148,163,184,0.1)' : 'rgba(148,163,184,0.2)';

  return {
    backgroundColor: 'transparent',
    grid: {top: 36, right: isMobile ? 36 : 64, bottom: 28, left: 12, containLabel: true},
    legend: {
      data: ['总资产', '证券市值', '昨日差额'],
      top: 0,
      right: 0,
      textStyle: {fontSize: 12, color: labelColor},
      itemHeight: 10,
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: {type: 'cross', label: {backgroundColor: '#2563eb'}},
      formatter: (params: Array<{seriesName: string; value: number; axisValue: string}>) => {
        const date = params[0]?.axisValue ?? '';
        const lines = params.map((p) => {
          const v = p.value;
          const isChange = p.seriesName === '昨日差额';
          const formatted = isChange
            ? `${v >= 0 ? '+' : ''}${v.toLocaleString()}`
            : v.toLocaleString();
          return `${p.seriesName}：${formatted}`;
        });
        return `${date}<br/>${lines.join('<br/>')}`;
      },
    },
    xAxis: {
      type: 'category',
      data: data.history.map((h) => h.date),
      axisTick: {show: false},
      axisLine: {lineStyle: {color: axisColor}},
      axisLabel: {color: labelColor, fontSize: 11},
    },
    yAxis: [
      {
        type: 'value',
        min: (value: {min: number; max: number}) => {
          const range = value.max - value.min;
          return Math.floor((value.min - range * 0.15) / 10000) * 10000;
        },
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
          formatter: (v: number) => `${v >= 0 ? '+' : ''}${(v / 1000).toFixed(0)}k`,
          color: labelColor,
          fontSize: 11,
        },
        splitLine: {show: false},
      },
    ],
    series: [
      {
        name: '昨日差额',
        type: 'bar',
        yAxisIndex: 1,
        barMaxWidth: 8,
        data: data.history.map((h) => ({
          value: h.dailyChange,
          date: getItemDate(h),
          itemStyle: {
            color: h.dailyChange >= 0 ? '#ef4444' : '#22c55e',
            borderRadius: [2, 2, 0, 0],
          },
        })),
      },
      {
        name: '证券市值',
        type: 'line',
        yAxisIndex: 0,
        data: data.history.map((h) => ({value: h.securitiesValue, date: getItemDate(h)})),
        smooth: false,
        symbol: 'none',
        lineStyle: {width: 2, color: '#0891b2'},
      },
      {
        name: '总资产',
        type: 'line',
        yAxisIndex: 0,
        data: data.history.map((h) => ({value: h.totalAssets, date: getItemDate(h)})),
        smooth: false,
        symbol: 'none',
        lineStyle: {width: 2.5, color: '#2563eb'},
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              {offset: 0, color: 'rgba(37,99,235,0.14)'},
              {offset: 1, color: 'rgba(37,99,235,0)'},
            ],
          },
        },
      },
    ],
  };
}

function buildPnlOption(holdings: Holding[], isDark: boolean, isMobile: boolean) {
  const labelColor = isDark ? '#94a3b8' : '#64748b';
  const splitColor = isDark ? 'rgba(148,163,184,0.1)' : 'rgba(148,163,184,0.2)';

  const sorted = [...holdings].sort((a, b) => a.pnl - b.pnl);

  return {
    backgroundColor: 'transparent',
    grid: {
      top: 8,
      right: isMobile ? 12 : 120,
      bottom: 8,
      left: isMobile ? 88 : 16,
      containLabel: !isMobile,
    },
    tooltip: {
      trigger: 'item',
      formatter: (params: {name: string; dataIndex: number}) => {
        const h = sorted[params.dataIndex];
        if (!h) return '';
        const sign = h.pnl >= 0 ? '+' : '';
        return `${params.name}<br/>盈亏：${sign}${h.pnl.toLocaleString()} ${h.currency}<br/>盈亏比例：${sign}${h.pnlPct}%`;
      },
    },
    xAxis: {
      type: 'value',
      axisLabel: {
        show: !isMobile,
        formatter: (v: number) => `${v > 0 ? '+' : ''}${(v / 1000).toFixed(0)}k`,
        color: labelColor,
        fontSize: 11,
      },
      splitLine: {show: !isMobile, lineStyle: {color: splitColor}},
      axisLine: {show: false},
    },
    yAxis: {
      type: 'category',
      data: sorted.map((h) => h.name),
      axisLabel: {
        color: labelColor,
        fontSize: isMobile ? 10 : 12,
        width: isMobile ? 76 : undefined,
        overflow: isMobile ? 'truncate' : 'none',
      },
      axisTick: {show: false},
      axisLine: {show: false},
    },
    series: [
      {
        type: 'bar',
        barMaxWidth: 28,
        data: sorted.map((h) => ({
          value: h.pnl,
          itemStyle: {
            color: h.pnl >= 0 ? '#ef4444' : '#22c55e',
            borderRadius: h.pnl >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4],
          },
          label: {
            show: !isMobile,
            position: 'right',
            formatter: () => {
              const sign = h.pnl >= 0 ? '+' : '';
              const amt = Math.abs(h.pnl) >= 1000
                ? `${sign}${(h.pnl / 1000).toFixed(1)}k`
                : `${sign}${h.pnl.toFixed(0)}`;
              return `${amt}  ${sign}${h.pnlPct}%`;
            },
            color: labelColor,
            fontSize: 11,
          },
        })),
      },
    ],
  };
}

function buildPieOption(data: PortfolioData, isDark: boolean, isMobile: boolean) {
  const labelColor = isDark ? '#94a3b8' : '#64748b';
  const usd = data.holdings.filter((h) => h.currency === 'USD');
  const hkd = data.holdings.filter((h) => h.currency === 'HKD');

  const pieColors = ['#2563eb', '#0891b2', '#7c3aed', '#db2777', '#ea580c', '#65a30d', '#0d9488'];

  const layout = isMobile
    ? {
        usdCenter: ['50%', '26%'] as [string, string],
        hkdCenter: ['50%', '74%'] as [string, string],
        radius: ['28%', '46%'] as [string, string],
        usdTitle: {left: '50%', top: '1%'},
        hkdTitle: {left: '50%', top: '50%'},
        legend: {show: false} as Record<string, unknown>,
      }
    : {
        usdCenter: ['26%', '50%'] as [string, string],
        hkdCenter: ['74%', '50%'] as [string, string],
        radius: ['36%', '62%'] as [string, string],
        usdTitle: {left: '25%', top: '4%'},
        hkdTitle: {left: '75%', top: '4%'},
        legend: {type: 'scroll', orient: 'horizontal', bottom: 0, textStyle: {fontSize: 11, color: labelColor}} as Record<string, unknown>,
      };

  return {
    backgroundColor: 'transparent',
    title: [
      {text: 'USD', ...layout.usdTitle, textAlign: 'center', textStyle: {fontSize: 12, fontWeight: 500, color: labelColor}},
      {text: 'HKD', ...layout.hkdTitle, textAlign: 'center', textStyle: {fontSize: 12, fontWeight: 500, color: labelColor}},
    ],
    tooltip: {
      trigger: 'item',
      formatter: (params: {name: string; value: number; percent: number; seriesName: string}) =>
        `${params.name}<br/>${params.value.toLocaleString()} ${params.seriesName}　${params.percent}%`,
    },
    legend: layout.legend,
    color: pieColors,
    series: [
      {
        name: 'USD',
        type: 'pie',
        radius: layout.radius,
        center: layout.usdCenter,
        label: {formatter: '{d}%', fontSize: 11, color: labelColor},
        labelLine: {length: 8, length2: 6},
        data: usd.map((h) => ({name: h.name, value: h.value})),
      },
      {
        name: 'HKD',
        type: 'pie',
        radius: layout.radius,
        center: layout.hkdCenter,
        label: {formatter: '{d}%', fontSize: 11, color: labelColor},
        labelLine: {length: 8, length2: 6},
        data: hkd.map((h) => ({name: h.name, value: h.value})),
      },
    ],
  };
}

function getDateFromChartParams(params: unknown): string | null {
  const record = params && typeof params === 'object' ? params as Record<string, unknown> : {};
  const data = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : {};
  const candidates = [data.date, data.fullDate, record.axisValue, record.name, record.value];
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

function getAxisLabelFromChartParams(params: unknown): string | null {
  const record = params && typeof params === 'object' ? params as Record<string, unknown> : {};
  for (const candidate of [record.axisValue, record.name]) {
    if (typeof candidate === 'string' && candidate) return candidate;
  }
  return null;
}

function Charts({
  data,
  onDateSelect,
  timeScope,
  compact = false,
}: {
  data: PortfolioData;
  onDateSelect?: (date: string) => void;
  timeScope?: TimeScope;
  compact?: boolean;
}) {
  const {colorMode} = useColorMode();
  const isDark = colorMode === 'dark';
  const theme = isDark ? 'dark' : undefined;
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);

  useEffect(() => {
    const handle = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handle);
    return () => window.removeEventListener('resize', handle);
  }, []);
  const scopedData = useMemo(
    () => ({...data, history: filterByScope(data.history, timeScope)}),
    [data, timeScope],
  );

  const dateEvents = onDateSelect
    ? {
        click: (params: unknown) => {
          const date = getDateFromChartParams(params)
            || scopedData.history.find((item) => item.date === getAxisLabelFromChartParams(params))?.fullDate;
          if (date) onDateSelect(date);
        },
      }
    : undefined;

  return (
    <div className={styles.wrap}>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>资产走势</div>
        <ReactECharts
          option={buildLineOption(scopedData, isDark, isMobile)}
          theme={theme}
          style={{height: 300}}
          opts={{renderer: 'svg'}}
          onEvents={dateEvents}
        />
      </div>
      {compact ? null : (
        <>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>持仓分布</div>
        <ReactECharts
          option={buildPieOption(data, isDark, isMobile)}
          theme={theme}
          style={{height: isMobile ? 500 : 320}}
          opts={{renderer: 'svg'}}
        />
      </div>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>盈亏明细</div>
        <div className={styles.pnlRow} style={isMobile ? {flexDirection: 'column', alignItems: 'stretch'} : undefined}>
          {(['USD', 'HKD'] as const).map((currency) => {
            const group = data.holdings.filter((h) => h.currency === currency);
            if (group.length === 0) return null;
            return (
              <div key={currency} className={styles.pnlCell}>
                <div className={styles.currencyLabel}>{currency}</div>
                <ReactECharts
                  option={buildPnlOption(group, isDark, isMobile)}
                  theme={theme}
                  style={{height: group.length * 44 + 24}}
                  opts={{renderer: 'svg'}}
                />
              </div>
            );
          })}
        </div>
      </div>
        </>
      )}
    </div>
  );
}

export default function PortfolioCharts({
  data,
  onDateSelect,
  timeScope,
  compact,
}: {
  data: PortfolioData;
  onDateSelect?: (date: string) => void;
  timeScope?: TimeScope;
  compact?: boolean;
}) {
  return (
    <BrowserOnly fallback={<div style={{minHeight: 620}} />}>
      {() => <Charts data={data} onDateSelect={onDateSelect} timeScope={timeScope} compact={compact} />}
    </BrowserOnly>
  );
}
