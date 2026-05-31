import BrowserOnly from '@docusaurus/BrowserOnly';
import {useColorMode} from '@docusaurus/theme-common';
import ReactECharts from 'echarts-for-react';
import styles from './styles.module.css';

type Trade = {
  date: string;
  name: string;
  pnl: number;
  cumulative: number;
};

type IPOData = {
  trades: Trade[];
};

function buildOption(data: IPOData, isDark: boolean) {
  const labelColor = isDark ? '#94a3b8' : '#64748b';
  const splitColor = isDark ? 'rgba(148,163,184,0.1)' : 'rgba(148,163,184,0.2)';
  const axisColor = isDark ? '#475569' : '#cbd5e1';

  return {
    backgroundColor: 'transparent',
    grid: {top: 36, right: 56, bottom: 56, left: 12, containLabel: true},
    legend: {
      data: ['累计盈亏', '单笔盈亏'],
      top: 0,
      right: 0,
      textStyle: {fontSize: 12, color: labelColor},
      itemHeight: 10,
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: {type: 'cross', label: {backgroundColor: '#2563eb'}},
      formatter: (params: Array<{seriesName: string; value: number; dataIndex: number; axisValue: string}>) => {
        const idx = params[0]?.dataIndex ?? 0;
        const item = data.trades[idx];
        if (!item) return '';
        const bar = params.find((p) => p.seriesName === '单笔盈亏');
        const line = params.find((p) => p.seriesName === '累计盈亏');
        return [
          item.date,
          item.name,
          `单笔：+${(bar?.value ?? 0).toLocaleString()} HKD`,
          `累计：+${(line?.value ?? 0).toLocaleString()} HKD`,
        ].join('<br/>');
      },
    },
    xAxis: {
      type: 'category',
      data: data.trades.map((t) => t.date),
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
        name: '单笔盈亏',
        type: 'bar',
        yAxisIndex: 1,
        barMaxWidth: 14,
        data: data.trades.map((t) => ({
          value: t.pnl,
          itemStyle: {color: '#ef4444', borderRadius: [2, 2, 0, 0]},
        })),
      },
      {
        name: '累计盈亏',
        type: 'line',
        yAxisIndex: 0,
        data: data.trades.map((t) => t.cumulative),
        smooth: true,
        symbol: 'none',
        lineStyle: {width: 2.5, color: '#2563eb'},
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              {offset: 0, color: 'rgba(37,99,235,0.15)'},
              {offset: 1, color: 'rgba(37,99,235,0)'},
            ],
          },
        },
      },
    ],
  };
}

function Charts({data}: {data: IPOData}) {
  const {colorMode} = useColorMode();
  const isDark = colorMode === 'dark';

  return (
    <div className={styles.wrap}>
      <ReactECharts
        option={buildOption(data, isDark)}
        theme={isDark ? 'dark' : undefined}
        style={{height: 320}}
        opts={{renderer: 'svg'}}
      />
    </div>
  );
}

export default function HKIPOCharts({data}: {data: IPOData}) {
  return (
    <BrowserOnly fallback={<div style={{minHeight: 320}} />}>
      {() => <Charts data={data} />}
    </BrowserOnly>
  );
}
