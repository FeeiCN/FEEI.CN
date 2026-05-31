import BrowserOnly from '@docusaurus/BrowserOnly';
import {useColorMode} from '@docusaurus/theme-common';
import ReactECharts from 'echarts-for-react';
import styles from './styles.module.css';

type HistoryPoint = {
  date: string;
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

function buildLineOption(data: PortfolioData, isDark: boolean) {
  const axisColor = isDark ? '#475569' : '#cbd5e1';
  const labelColor = isDark ? '#94a3b8' : '#64748b';
  const splitColor = isDark ? 'rgba(148,163,184,0.1)' : 'rgba(148,163,184,0.2)';

  return {
    backgroundColor: 'transparent',
    grid: {top: 36, right: 64, bottom: 28, left: 12, containLabel: true},
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
        data: data.history.map((h) => h.securitiesValue),
        smooth: true,
        symbol: 'none',
        lineStyle: {width: 2, color: '#0891b2'},
      },
      {
        name: '总资产',
        type: 'line',
        yAxisIndex: 0,
        data: data.history.map((h) => h.totalAssets),
        smooth: true,
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

function buildPnlOption(holdings: Holding[], isDark: boolean) {
  const labelColor = isDark ? '#94a3b8' : '#64748b';
  const splitColor = isDark ? 'rgba(148,163,184,0.1)' : 'rgba(148,163,184,0.2)';

  const sorted = [...holdings].sort((a, b) => a.pnl - b.pnl);

  return {
    backgroundColor: 'transparent',
    grid: {top: 8, right: 120, bottom: 8, left: 16, containLabel: true},
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
        formatter: (v: number) => `${v > 0 ? '+' : ''}${(v / 1000).toFixed(0)}k`,
        color: labelColor,
        fontSize: 11,
      },
      splitLine: {lineStyle: {color: splitColor}},
      axisLine: {show: false},
    },
    yAxis: {
      type: 'category',
      data: sorted.map((h) => h.name),
      axisLabel: {color: labelColor, fontSize: 12},
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
            show: true,
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

function buildPieOption(data: PortfolioData, isDark: boolean) {
  const labelColor = isDark ? '#94a3b8' : '#64748b';
  const usd = data.holdings.filter((h) => h.currency === 'USD');
  const hkd = data.holdings.filter((h) => h.currency === 'HKD');

  const pieColors = ['#2563eb', '#0891b2', '#7c3aed', '#db2777', '#ea580c', '#65a30d', '#0d9488'];

  return {
    backgroundColor: 'transparent',
    title: [
      {
        text: 'USD',
        left: '25%',
        top: '4%',
        textAlign: 'center',
        textStyle: {fontSize: 12, fontWeight: 500, color: labelColor},
      },
      {
        text: 'HKD',
        left: '75%',
        top: '4%',
        textAlign: 'center',
        textStyle: {fontSize: 12, fontWeight: 500, color: labelColor},
      },
    ],
    tooltip: {
      trigger: 'item',
      formatter: (params: {name: string; value: number; percent: number; seriesName: string}) =>
        `${params.name}<br/>${params.value.toLocaleString()} ${params.seriesName}　${params.percent}%`,
    },
    legend: {
      type: 'scroll',
      orient: 'horizontal',
      bottom: 0,
      textStyle: {fontSize: 11, color: labelColor},
    },
    color: pieColors,
    series: [
      {
        name: 'USD',
        type: 'pie',
        radius: ['36%', '62%'],
        center: ['26%', '50%'],
        label: {
          formatter: '{d}%',
          fontSize: 11,
          color: labelColor,
        },
        labelLine: {length: 8, length2: 6},
        data: usd.map((h) => ({name: h.name, value: h.value})),
      },
      {
        name: 'HKD',
        type: 'pie',
        radius: ['36%', '62%'],
        center: ['74%', '50%'],
        label: {
          formatter: '{d}%',
          fontSize: 11,
          color: labelColor,
        },
        labelLine: {length: 8, length2: 6},
        data: hkd.map((h) => ({name: h.name, value: h.value})),
      },
    ],
  };
}

function Charts({data}: {data: PortfolioData}) {
  const {colorMode} = useColorMode();
  const isDark = colorMode === 'dark';
  const theme = isDark ? 'dark' : undefined;

  return (
    <div className={styles.wrap}>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>资产走势</div>
        <ReactECharts
          option={buildLineOption(data, isDark)}
          theme={theme}
          style={{height: 300}}
          opts={{renderer: 'svg'}}
        />
      </div>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>持仓分布</div>
        <ReactECharts
          option={buildPieOption(data, isDark)}
          theme={theme}
          style={{height: 320}}
          opts={{renderer: 'svg'}}
        />
      </div>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>盈亏明细</div>
        <div className={styles.pnlRow}>
          {(['USD', 'HKD'] as const).map((currency) => {
            const group = data.holdings.filter((h) => h.currency === currency);
            if (group.length === 0) return null;
            return (
              <div key={currency} className={styles.pnlCell}>
                <div className={styles.currencyLabel}>{currency}</div>
                <ReactECharts
                  option={buildPnlOption(group, isDark)}
                  theme={theme}
                  style={{height: group.length * 44 + 24}}
                  opts={{renderer: 'svg'}}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function PortfolioCharts({data}: {data: PortfolioData}) {
  return (
    <BrowserOnly fallback={<div style={{minHeight: 620}} />}>
      {() => <Charts data={data} />}
    </BrowserOnly>
  );
}
