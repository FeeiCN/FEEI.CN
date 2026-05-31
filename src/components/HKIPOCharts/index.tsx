import BrowserOnly from '@docusaurus/BrowserOnly';
import {useColorMode} from '@docusaurus/theme-common';
import ReactECharts from 'echarts-for-react';
import styles from './styles.module.css';

type Trade = {
  date: string;
  account: 'FeeiCN' | 'FeeiCN2';
  name: string;
  pnl: number;
};

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
      formatter: (params: Array<{seriesName: string; value: number | null; axisValue: string}>) => {
        const date = params[0]?.axisValue ?? '';
        const dayTrades = trades.filter((t) => t.date === date);
        const cnDay = dayTrades.filter((t) => t.account === 'FeeiCN');
        const cn2Day = dayTrades.filter((t) => t.account === 'FeeiCN2');

        const lines: string[] = [date];

        if (cnDay.length > 0) {
          lines.push(`FeeiCN：${cnDay.map((t) => `${t.name} +${t.pnl.toLocaleString()}`).join('、')}`);
        }
        if (cn2Day.length > 0) {
          lines.push(`FeeiCN2：${cn2Day.map((t) => `${t.name} +${t.pnl.toLocaleString()}`).join('、')}`);
        }

        params
          .filter((p) => ['总累计', 'FeeiCN累计', 'FeeiCN2累计'].includes(p.seriesName) && p.value !== null)
          .forEach((p) => lines.push(`${p.seriesName}：+${(p.value as number).toLocaleString()} HKD`));

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
        smooth: true,
        symbol: 'none',
        lineStyle: {width: 2, color: '#2563eb'},
      },
      {
        name: 'FeeiCN2累计',
        type: 'line',
        yAxisIndex: 0,
        data: feeiCN2,
        smooth: true,
        symbol: 'none',
        connectNulls: false,
        lineStyle: {width: 2, color: '#0891b2'},
      },
      {
        name: '总累计',
        type: 'line',
        yAxisIndex: 0,
        data: total,
        smooth: true,
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

function Charts({trades}: {trades: Trade[]}) {
  const {colorMode} = useColorMode();
  const isDark = colorMode === 'dark';

  return (
    <div className={styles.wrap}>
      <ReactECharts
        option={buildOption(trades, isDark)}
        theme={isDark ? 'dark' : undefined}
        style={{height: 320}}
        opts={{renderer: 'svg'}}
      />
    </div>
  );
}

export default function HKIPOCharts({trades}: {trades: Trade[]}) {
  return (
    <BrowserOnly fallback={<div style={{minHeight: 320}} />}>
      {() => <Charts trades={trades} />}
    </BrowserOnly>
  );
}
