import React from 'react';
import Link from '@docusaurus/Link';
import styles from './styles.module.css';

type ReflectionCalendarProps = {
  year: number;
  month?: number;
  activeDates: string[];
  basePath: string;
  title?: string;
  description?: string;
};

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
const MONTH_LABELS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function buildMonthGrid(year: number, month: number) {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const firstWeekday = (firstDay.getDay() + 6) % 7;
  const daysInMonth = lastDay.getDate();
  const cells: Array<{day?: number; date?: string}> = [];

  for (let i = 0; i < firstWeekday; i += 1) {
    cells.push({});
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({day, date: formatDate(year, month, day)});
  }
  while (cells.length % 7 !== 0) {
    cells.push({});
  }
  return cells;
}

function MonthCard({
  year,
  month,
  activeDates,
  basePath,
}: {
  year: number;
  month: number;
  activeDates: Set<string>;
  basePath: string;
}) {
  const cells = buildMonthGrid(year, month);

  return (
    <section className={styles.monthCard}>
      <div className={styles.monthHeader}>
        <h2>{MONTH_LABELS[month - 1]}</h2>
      </div>
      <div className={styles.weekdays}>
        {WEEKDAY_LABELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className={styles.grid}>
        {cells.map((cell, index) => {
          if (!cell.day || !cell.date) {
            return <span key={`empty-${month}-${index}`} className={styles.emptyCell} />;
          }
          const isActive = activeDates.has(cell.date);
          if (!isActive) {
            return (
              <span key={cell.date} className={styles.dayCell}>
                {cell.day}
              </span>
            );
          }
          return (
            <Link
              key={cell.date}
              to={`${basePath}/${cell.date}`}
              className={`${styles.dayCell} ${styles.activeCell}`}
            >
              {cell.day}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export default function ReflectionCalendar({
  year,
  month,
  activeDates,
  basePath,
  title,
  description,
}: ReflectionCalendarProps): JSX.Element {
  const activeDateSet = new Set(activeDates);
  const months = month ? [month] : Array.from({length: 12}, (_, index) => index + 1);

  return (
    <div className={styles.calendarPage}>
      {(title || description) && (
        <div className={styles.hero}>
          {title ? <h1>{title}</h1> : null}
          {description ? <p>{description}</p> : null}
        </div>
      )}
      <div className={styles.months}>
        {months.map((value) => (
          <MonthCard
            key={`${year}-${value}`}
            year={year}
            month={value}
            activeDates={activeDateSet}
            basePath={basePath}
          />
        ))}
      </div>
    </div>
  );
}
