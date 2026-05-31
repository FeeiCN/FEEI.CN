import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import styles from './styles.module.css';

type HistoryPoint = {
  date: string;
  totalAssets: number;
  securitiesValue: number;
  cash: number;
  dailyChange: number;
};

type Holding = {
  name: string;
  value: number;
  currency: string;
};

type PortfolioData = {
  history: HistoryPoint[];
  holdings: Holding[];
};

const PIE_COLORS = [
  '#2563eb', '#0891b2', '#7c3aed', '#db2777',
  '#ea580c', '#65a30d', '#0d9488', '#92400e',
];

function formatWan(v: number): string {
  return `${(v / 10000).toFixed(0)}万`;
}

function formatChange(v: number): string {
  const wan = v / 10000;
  return `${v >= 0 ? '+' : ''}${wan >= 0.1 || wan <= -0.1 ? wan.toFixed(1) + '万' : v.toFixed(0)}`;
}

export default function PortfolioCharts({data}: {data: PortfolioData}) {
  return (
    <div className={styles.wrap}>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>资产走势</div>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart
            data={data.history}
            margin={{top: 12, right: 48, left: 4, bottom: 8}}>
            <CartesianGrid stroke="rgba(148,163,184,0.22)" vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={{stroke: 'rgba(148,163,184,0.4)'}}
              tick={{fill: '#64748b', fontSize: 11}}
              interval="preserveStartEnd"
            />
            <YAxis
              yAxisId="assets"
              tickLine={false}
              axisLine={false}
              tick={{fill: '#64748b', fontSize: 11}}
              tickFormatter={formatWan}
              domain={['auto', 'auto']}
            />
            <YAxis
              yAxisId="change"
              orientation="right"
              tickLine={false}
              axisLine={false}
              tick={{fill: '#64748b', fontSize: 11}}
              tickFormatter={formatChange}
            />
            <Tooltip
              contentStyle={{
                border: '1px solid rgba(148,163,184,0.3)',
                borderRadius: 8,
                background: 'var(--ifm-background-color)',
                fontSize: 13,
              }}
              formatter={(value: unknown, name: unknown) => {
                const v = value as number;
                if (name === '昨日差额') {
                  return [`${v >= 0 ? '+' : ''}${v.toLocaleString()}`, name as string];
                }
                return [v.toLocaleString(), name as string];
              }}
              labelFormatter={(label) => `${label}`}
            />
            <Legend verticalAlign="top" height={28} />
            <Bar
              yAxisId="change"
              dataKey="dailyChange"
              name="昨日差额"
              maxBarSize={8}
              radius={[2, 2, 0, 0]}>
              {data.history.map((entry, index) => (
                <Cell
                  key={index}
                  fill={entry.dailyChange >= 0 ? '#ef4444' : '#22c55e'}
                />
              ))}
            </Bar>
            <Line
              yAxisId="assets"
              type="monotone"
              dataKey="securitiesValue"
              name="证券市值"
              stroke="#0891b2"
              strokeWidth={2}
              dot={false}
              activeDot={{r: 4}}
            />
            <Line
              yAxisId="assets"
              type="monotone"
              dataKey="totalAssets"
              name="总资产"
              stroke="#2563eb"
              strokeWidth={2.5}
              dot={false}
              activeDot={{r: 5}}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>持仓分布</div>
        <div className={styles.pieRow}>
          {(['USD', 'HKD'] as const).map((currency) => {
            const group = data.holdings.filter((h) => h.currency === currency);
            if (group.length === 0) return null;
            const total = group.reduce((sum, h) => sum + h.value, 0);
            return (
              <div key={currency} className={styles.pieCell}>
                <div className={styles.pieLabel}>{currency}</div>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={group}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="44%"
                      outerRadius={80}
                      paddingAngle={2}
                      label={({percent}: {percent?: number}) => percent != null ? `${(percent * 100).toFixed(1)}%` : ''}>
                      {group.map((_, index) => (
                        <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        border: '1px solid rgba(148,163,184,0.3)',
                        borderRadius: 8,
                        background: 'var(--ifm-background-color)',
                        fontSize: 13,
                      }}
                      formatter={(value: unknown, name: unknown) => {
                        const v = value as number;
                        const pct = ((v / total) * 100).toFixed(1);
                        return [`${v.toLocaleString()} ${currency} (${pct}%)`, name as string];
                      }}
                    />
                    <Legend verticalAlign="bottom" height={44} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
