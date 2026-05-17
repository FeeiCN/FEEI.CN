import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import styles from './styles.module.css';

type ReadingYear = {
  year: string;
  hours: number;
  finished: number;
};

const readingYears: ReadingYear[] = [
  {year: '2018', hours: 3.1, finished: 1},
  {year: '2021', hours: 194.5, finished: 28},
  {year: '2022', hours: 115.5, finished: 21},
  {year: '2023', hours: 58.1, finished: 7},
  {year: '2024', hours: 158.0, finished: 12},
  {year: '2025', hours: 368.8, finished: 80},
  {year: '2026', hours: 109.0, finished: 16},
];

function formatTooltip(value: unknown, name: unknown): [string, string] {
  const numericValue = Array.isArray(value)
    ? Number(value[0] ?? 0)
    : typeof value === 'number'
      ? value
      : Number(value ?? 0);

  if (name === 'hours' || name === '阅读/收听时长') {
    return [`${numericValue.toFixed(1)} 小时`, '阅读/收听时长'];
  }

  return [`${numericValue} 本`, '读完本数'];
}

export default function ReadingYearChart() {
  return (
    <div className={styles.chartWrap}>
      <ResponsiveContainer width="100%" height={320}>
        <LineChart
          data={readingYears}
          margin={{top: 18, right: 22, left: 4, bottom: 8}}>
          <CartesianGrid stroke="var(--reading-chart-grid)" vertical={false} />
          <XAxis
            dataKey="year"
            tickLine={false}
            axisLine={{stroke: 'var(--reading-chart-axis)'}}
            tick={{fill: 'var(--reading-chart-muted)', fontSize: 12}}
          />
          <YAxis
            yAxisId="hours"
            tickLine={false}
            axisLine={false}
            tick={{fill: 'var(--reading-chart-muted)', fontSize: 12}}
            tickFormatter={(value: number) => `${value}h`}
          />
          <YAxis
            yAxisId="finished"
            orientation="right"
            tickLine={false}
            axisLine={false}
            tick={{fill: 'var(--reading-chart-muted)', fontSize: 12}}
            tickFormatter={(value: number) => `${value}本`}
          />
          <Tooltip
            contentStyle={{
              border: '1px solid var(--reading-chart-border)',
              borderRadius: 8,
              background: 'var(--reading-chart-tooltip)',
              boxShadow: '0 12px 30px rgba(15, 23, 42, 0.12)',
            }}
            formatter={formatTooltip}
            labelFormatter={(label) => `${label} 年`}
          />
          <Legend verticalAlign="top" height={32} />
          <Line
            yAxisId="hours"
            type="monotone"
            dataKey="hours"
            name="阅读/收听时长"
            stroke="#2563eb"
            strokeWidth={3}
            dot={{r: 4}}
            activeDot={{r: 6}}
          />
          <Line
            yAxisId="finished"
            type="monotone"
            dataKey="finished"
            name="读完本数"
            stroke="#16a34a"
            strokeWidth={3}
            strokeDasharray="6 5"
            dot={{r: 4}}
            activeDot={{r: 6}}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
