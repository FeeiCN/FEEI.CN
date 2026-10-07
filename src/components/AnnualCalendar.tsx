import {useEffect, useState} from 'react';
import {intensityLevel, measureMedia, type RecordMetrics} from './annualCalendarMetrics';
import AnnualDayPreview from './AnnualDayPreview';
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
  const [mediaMonths, setMediaMonths] = useState<Record<string, Record<string, unknown> | null>>({});
  const [touchMode, setTouchMode] = useState(false);
  const monthsKey = [...new Set(yearRecords.map((record) => record.date.slice(0, 7)))].sort().join(',');
  useEffect(() => {
    const controller = new AbortController();
    setMediaMonths({});
    for (const month of monthsKey.split(',').filter(Boolean)) {
      fetch(`https://feei.cn/media/${month.replace('-', '/')}/index.json`, {signal: controller.signal})
        .then(async (response) => {
          if (!response.ok) throw new Error('Media unavailable');
          const index = await response.json();
          if (!index.days || typeof index.days !== 'object' || Array.isArray(index.days)) throw new Error('Invalid media index');
          return index.days as Record<string, unknown>;
        })
        .then((days) => {
          if (!controller.signal.aborted) setMediaMonths((current) => ({...current, [month]: days}));
        })
        .catch(() => {
          if (!controller.signal.aborted) setMediaMonths((current) => ({...current, [month]: null}));
        });
    }
    return () => controller.abort();
  }, [monthsKey]);
  useEffect(() => {
    const query = window.matchMedia('(hover: none), (pointer: coarse)');
    const update = () => setTouchMode(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
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
                  const mediaMonth = mediaMonths[date.slice(0, 7)];
                  const media = measureMedia(mediaMonth?.[date]);
                  const base = record?.metrics ?? {characters: 0, images: 0, videos: 0};
                  const metrics: RecordMetrics = {...base, images: base.images + media.images, videos: base.videos + media.videos};
                  const level = intensityLevel(metrics);
                  const away = Boolean(record?.location && record.location !== '杭州');
                  const moving = Boolean(record?.location?.includes('→'));
                  return record ? (
                    <AnnualDayPreview key={date} record={record} metrics={metrics} touchMode={touchMode}
                      mediaStatus={mediaMonth === undefined ? 'loading' : mediaMonth === null ? 'unavailable' : 'ready'}
                      className={`annual-calendar__day annual-calendar__day--recorded annual-calendar__heat-${level}${away ? ' annual-calendar__day--away' : ''}${moving ? ' annual-calendar__day--moving' : ''}`}>
                      <span aria-hidden="true">{day}</span>{moving ? <b aria-hidden="true" /> : null}
                    </AnnualDayPreview>
                  ) : (
                    <span key={date} className="annual-calendar__day" aria-label={`${date}：暂无记录`}><span aria-hidden="true">{day}</span></span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="annual-calendar__legend" aria-label="记录丰富度由浅到深，共四档">
        <span>记录丰富度 · 少</span>
        {[1, 2, 3, 4].map((level) => <i key={level} className={`annual-calendar__heat-${level}`} aria-hidden="true" />)}
        <span>多</span><span className="annual-calendar__legend-away" aria-hidden="true" /> <span>异地</span><span className="annual-calendar__legend-moving" aria-hidden="true" /> <span>移动</span>
      </div>
      <p className="annual-calendar__hint">文字、图片和视频越多，颜色越深；橙色描边表示异地，右上角小点表示移动。</p>
      {Object.values(mediaMonths).some((month) => month === null) && <p className="annual-calendar__hint" role="status">部分媒体暂不可用，对应日期暂按正文计算。</p>}
    </section>
  );
}
