import Link from '@docusaurus/Link';
import {usePluginData} from '@docusaurus/useGlobalData';
import type {HomeRecord} from '../../plugins/homeRecordsPlugin';

type Props = {year: number; month: number};

const weekdayLabels = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

function weekdayIndex(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export default function MonthlyRecords({year, month}: Props) {
  const {dailyRecords} = usePluginData('home-records-plugin') as {dailyRecords: HomeRecord[]};
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  const records = dailyRecords.filter((record) => record.date.startsWith(prefix));

  if (!records.length) return <p>暂无记录。</p>;

  return (
    <div className="year-record-list">
      {records.map((record) => {
        const weekday = weekdayIndex(record.date);
        const weekendClass = weekday === 0 ? ' sunday' : weekday === 6 ? ' saturday' : '';
        const [, monthPart, dayPart] = record.date.split('-');
        return (
          <Link key={record.to} className={`year-record${weekendClass}`} to={record.to}>
            <time dateTime={record.date}>{monthPart}/{dayPart}<br/><small>{weekdayLabels[weekday]}</small></time>
            <span>
              <strong>{record.title}</strong>
              {record.location && <small>{record.location}</small>}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
