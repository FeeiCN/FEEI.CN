import BrowserOnly from '@docusaurus/BrowserOnly';
import {useColorMode} from '@docusaurus/theme-common';
import ReactECharts from 'echarts-for-react';
import styles from './styles.module.css';

type MonthlyPoint = {
  month: string;
  monthlyPnl: number;
  cumulativePnl: number;
};

type StockPnl = {
  name: string;
  pnl: number;
};

type IPOData = {
  cumulative: MonthlyPoint[];
  stocks: StockPnl[];
};

function buildCumulativeOption(data: IPOData, isDark: boolean) {
  const labelColor = isDark ? '#94a3b8' : '#64748b';
  const splitColor = isDark ? 'rgba(148,163,184,0.1)' : 'rgba(148,163,184,0.2)';
  const axisColor = isDark ? '#475569' : '#cbd5e1';

  return {
    backgroundColor: 'transparent',
    grid: {top: 16, right: 16, bottom: 8, left: 12, containLabel: true},
    tooltip: {
      trigger: 'axis',
      contentStyle: {
        border: '1px solid rgba(148,163,184,0.3)',
        borderRadius: 8,
        background: 'var(--ifm-background-color)',
        fontSize: 13,
      },
      formatter: (params: Array<{dataIndex: number; value: number}>) => {
        const p = params[0];
        if (!p) return '';
        const item = data.cumulative[p.dataIndex];
        if (!item) return '';
        const monthly = item.monthlyPnl > 0 ? `+${item.monthlyPnl.toLocaleString()}` : item.monthlyPnl.toLocaleString();
        return `${item.month}<br/>当月：${monthly} HKD<br/>累计：+${p.value.toLocaleString()} HKD`;
      },
    },
    xAxis: {
      type: 'category',
      data: data.cumulative.map((d) => d.month),
      axisTick: {show: false},
      axisLine: {lineStyle: {color: axisColor}},
      axisLabel: {color: labelColor, fontSize: 11, rotate: 30},
    },
    yAxis: {
      type: 'value',
      min: 0,
      axisLabel: {
        formatter: (v: number) => `${(v / 10000).toFixed(0)}万`,
        color: labelColor,
        fontSize: 11,
      },
      splitLine: {lineStyle: {color: splitColor}},
    },
    series: [
      {
        type: 'line',
        data: data.cumulative.map((d) => d.cumulativePnl),
        smooth: true,
        symbol: 'none',
        lineStyle: {width: 2.5, color: '#ef4444'},
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              {offset: 0, color: 'rgba(239,68,68,0.15)'},
              {offset: 1, color: 'rgba(239,68,68,0)'},
            ],
          },
        },
      },
    ],
  };
}

function buildStocksOption(data: IPOData, isDark: boolean) {
  const labelColor = isDark ? '#94a3b8' : '#64748b';
  const splitColor = isDark ? 'rgba(148,163,184,0.1)' : 'rgba(148,163,184,0.2)';

  const sorted = [...data.stocks].sort((a, b) => a.pnl - b.pnl);

  return {
    backgroundColor: 'transparent',
    grid: {top: 8, right: 100, bottom: 8, left: 12, containLabel: true},
    tooltip: {
      trigger: 'item',
      formatter: (params: {name: string; value: number}) =>
        `${params.name}<br/>盈亏：+${params.value.toLocaleString()} HKD`,
    },
    xAxis: {
      type: 'value',
      axisLabel: {
        formatter: (v: number) => `${(v / 1000).toFixed(0)}k`,
        color: labelColor,
        fontSize: 11,
      },
      splitLine: {lineStyle: {color: splitColor}},
      axisLine: {show: false},
    },
    yAxis: {
      type: 'category',
      data: sorted.map((s) => s.name),
      axisLabel: {color: labelColor, fontSize: 11},
      axisTick: {show: false},
      axisLine: {show: false},
    },
    series: [
      {
        type: 'bar',
        barMaxWidth: 22,
        data: sorted.map((s) => ({
          value: s.pnl,
          itemStyle: {color: '#ef4444', borderRadius: [0, 4, 4, 0]},
          label: {
            show: true,
            position: 'right',
            formatter: () => `+${(s.pnl / 1000).toFixed(1)}k`,
            color: labelColor,
            fontSize: 11,
          },
        })),
      },
    ],
  };
}

function Charts({data}: {data: IPOData}) {
  const {colorMode} = useColorMode();
  const isDark = colorMode === 'dark';
  const theme = isDark ? 'dark' : undefined;

  return (
    <div className={styles.wrap}>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>累计盈亏</div>
        <ReactECharts
          option={buildCumulativeOption(data, isDark)}
          theme={theme}
          style={{height: 240}}
          opts={{renderer: 'svg'}}
        />
      </div>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>各股盈亏</div>
        <ReactECharts
          option={buildStocksOption(data, isDark)}
          theme={theme}
          style={{height: data.stocks.length * 28 + 32}}
          opts={{renderer: 'svg'}}
        />
      </div>
    </div>
  );
}

export default function HKIPOCharts({data}: {data: IPOData}) {
  return (
    <BrowserOnly fallback={<div style={{minHeight: 500}} />}>
      {() => <Charts data={data} />}
    </BrowserOnly>
  );
}
