import Link from '@docusaurus/Link';
import {usePluginData} from '@docusaurus/useGlobalData';
import type {HomeRecord} from '../../plugins/homeRecordsPlugin';

type Props = {year: number};

const monthLabels = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
const weekdayLabels = ['一', '二', '三', '四', '五', '六', '日'];

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function mondayFirstWeekday(year: number, month: number): number {
  const sundayFirst = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return (sundayFirst + 6) % 7;
}

export default function AnnualCalendar({year}: Props) {
  const {dailyRecords} = usePluginData('home-records-plugin') as {dailyRecords: HomeRecord[]};
  const yearRecords = dailyRecords.filter((record) => record.date.startsWith(`${year}-`));
  const recordMap = new Map(yearRecords.map((record) => [record.date, record]));
  const recordedDays = recordMap.size;
  const yearDays = (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 366 : 365;
  const coverage = Math.round((recordedDays / yearDays) * 100);

  return (
    <section className="annual-calendar" aria-labelledby={`annual-calendar-${year}`}>
      <div className="annual-calendar__head">
        <div>
          <p className="annual-calendar__eyebrow">YEAR IN REVIEW</p>
          <h2 id={`annual-calendar-${year}`} className="doc-heading--manual-number">{year} 年度进度</h2>
        </div>
        <div className="annual-calendar__stats" aria-label={`${year} 年记录统计`}>
          <strong>{recordedDays}<small>次已打卡</small></strong>
          <span>/ {yearDays} 次 · 完成 {coverage}%</span>
        </div>
      </div>
      <div className="annual-calendar__bar" aria-hidden="true"><span style={{width: `${coverage}%`}} /></div>
      <div className="annual-calendar__months">
        {monthLabels.map((label, monthIndex) => {
          const month = monthIndex + 1;
          const monthPrefix = `${year}-${String(month).padStart(2, '0')}-`;
          const monthRecords = yearRecords.filter((record) => record.date.startsWith(monthPrefix));
          const totalDays = daysInMonth(year, month);
          const leadingBlanks = mondayFirstWeekday(year, month);
          return (
            <div className="annual-calendar__month" key={label}>
              <div className="annual-calendar__month-head"><strong>{label}</strong><span>{monthRecords.length || '—'}</span></div>
              <div className="annual-calendar__weekdays" aria-hidden="true">
                {weekdayLabels.map((weekday) => <span key={weekday}>{weekday}</span>)}
              </div>
              <div className="annual-calendar__days">
                {Array.from({length: leadingBlanks}, (_, index) => <i key={`blank-${index}`} aria-hidden="true" />)}
                {Array.from({length: totalDays}, (_, index) => {
                  const day = index + 1;
                  const date = dateKey(year, month, day);
                  const record = recordMap.get(date);
                  return record ? (
                    <Link key={date} to={record.to} className="annual-calendar__day annual-calendar__day--recorded" aria-label={`${date}：${record.title}`} title={record.title}><span aria-hidden="true">{day}</span></Link>
                  ) : (
                    <span key={date} className="annual-calendar__day" aria-label={`${date}：暂无记录`}><span aria-hidden="true">{day}</span></span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <p className="annual-calendar__hint"><span aria-hidden="true" /> 有日记 · 点击日期查看当天记录</p>
    </section>
  );
}
