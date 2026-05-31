import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import styles from './styles.module.css';

const summary = {
  invested: 8640,
  current: 9800,
  returnPct: 13.4,
};

const holdings = [
  {name: 'SPY', label: '标普 500', shares: 10, avgPrice: 480, currentPrice: 535},
  {name: 'QQQ', label: '纳斯达克 100', shares: 6, avgPrice: 390, currentPrice: 460},
  {name: 'VGT', label: 'Vanguard 科技 ETF', shares: 3, avgPrice: 500, currentPrice: 565},
];

const portfolioHistory = [
  {month: '2024 Q1', cost: 3000, value: 3100},
  {month: '2024 Q2', cost: 4000, value: 4300},
  {month: '2024 Q3', cost: 5000, value: 5200},
  {month: '2024 Q4', cost: 6500, value: 7000},
  {month: '2025 Q1', cost: 7500, value: 7200},
  {month: '2025 Q2', cost: 8000, value: 8400},
  {month: '2025 Q3', cost: 8500, value: 9200},
  {month: '2025 Q4', cost: 8640, value: 9600},
  {month: '2026 Q1', cost: 8640, value: 9100},
  {month: '2026 Q2', cost: 8640, value: 9800},
];

function formatUSD(value: number): string {
  return `$${value.toLocaleString()}`;
}

function returnClass(pct: number): string {
  return pct >= 0 ? styles.positive : styles.negative;
}

export default function IndexFundData() {
  return (
    <div className={styles.wrap}>
      <div className={styles.cards}>
        <div className={styles.card}>
          <div className={styles.cardLabel}>总投入</div>
          <div className={styles.cardValue}>{formatUSD(summary.invested)}</div>
        </div>
        <div className={styles.card}>
          <div className={styles.cardLabel}>当前市值</div>
          <div className={styles.cardValue}>{formatUSD(summary.current)}</div>
        </div>
        <div className={`${styles.card} ${returnClass(summary.returnPct)}`}>
          <div className={styles.cardLabel}>综合收益率</div>
          <div className={styles.cardValue}>
            {summary.returnPct >= 0 ? '+' : ''}{summary.returnPct}%
          </div>
        </div>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>基金</th>
              <th>持仓量</th>
              <th>均价</th>
              <th>现价</th>
              <th>收益率</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => {
              const ret = ((h.currentPrice - h.avgPrice) / h.avgPrice) * 100;
              return (
                <tr key={h.name}>
                  <td>
                    <span className={styles.ticker}>{h.name}</span>
                    <span className={styles.tickerLabel}>{h.label}</span>
                  </td>
                  <td>{h.shares}</td>
                  <td>${h.avgPrice}</td>
                  <td>${h.currentPrice}</td>
                  <td className={returnClass(ret)}>
                    {ret >= 0 ? '+' : ''}{ret.toFixed(1)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className={styles.chartWrap}>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart
            data={portfolioHistory}
            margin={{top: 16, right: 16, left: 4, bottom: 8}}>
            <defs>
              <linearGradient id="valueGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#2563eb" stopOpacity={0.18} />
                <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.1} />
                <stop offset="95%" stopColor="#94a3b8" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(148,163,184,0.25)" vertical={false} />
            <XAxis
              dataKey="month"
              tickLine={false}
              axisLine={{stroke: 'rgba(148,163,184,0.4)'}}
              tick={{fill: '#64748b', fontSize: 12}}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{fill: '#64748b', fontSize: 12}}
              tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
            />
            <Tooltip
              contentStyle={{
                border: '1px solid rgba(148,163,184,0.3)',
                borderRadius: 8,
                background: 'var(--ifm-background-color)',
              }}
              formatter={(value: unknown, name: unknown) => [
                `$${(value as number).toLocaleString()}`,
                name === 'value' ? '市值' : '投入成本',
              ]}
            />
            <Area
              type="monotone"
              dataKey="cost"
              name="cost"
              stroke="#94a3b8"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              fill="url(#costGrad)"
              dot={false}
            />
            <Area
              type="monotone"
              dataKey="value"
              name="value"
              stroke="#2563eb"
              strokeWidth={2.5}
              fill="url(#valueGrad)"
              dot={false}
              activeDot={{r: 5}}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
