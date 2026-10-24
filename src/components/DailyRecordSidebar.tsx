import {useEffect, useId, useMemo, useState} from 'react';
import {Popover, Portal, Tooltip} from '@chakra-ui/react';
import Link from '@docusaurus/Link';
import {usePluginData} from '@docusaurus/useGlobalData';
import type {HomeRecord} from '../../plugins/homeRecordsPlugin';
import AnnualDayPreview from './AnnualDayPreview';
import DiaryLifeTime from './DiaryLifeTime';
import {intensityLevel, measureMedia} from './annualCalendarMetrics';
import {adjacentRecordedMonths, calendarDay, calendarYearPosition, daysInCalendarMonth, shiftCalendarMonth, yearPosition} from './diaryCalendar';
import styles from './DailyRecordSidebar.module.css';

function Arrow({next = false}: {next?: boolean}) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"
    style={next ? {transform: 'rotate(180deg)'} : undefined}><path d="m14 6-6 6 6 6" /></svg>;
}

function useToday() {
  const [today, setToday] = useState('');
  useEffect(() => {
    const update = () => setToday(new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date()));
    update();
    const timer = setInterval(update, 60000);
    return () => clearInterval(timer);
  }, []);
  return today;
}

export default function DailyRecordSidebar({date}: {date: string}) {
  const {dailyRecords} = usePluginData('home-records-plugin') as {dailyRecords: HomeRecord[]};
  const id = useId();
  const today = useToday();
  const [month, setMonth] = useState(date.slice(0, 7));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(Number(date.slice(0, 4)));
  const [touchMode, setTouchMode] = useState(false);
  const [media, setMedia] = useState<{month: string; days: Record<string, unknown> | null} | null>(null);
  const recordMap = useMemo(() => new Map(dailyRecords.map((record) => [record.date, record])), [dailyRecords]);
  const recordMonths = useMemo(() => [...new Set(dailyRecords.map((record) => record.date.slice(0, 7)))].sort(), [dailyRecords]);
  const position = yearPosition(date);
  const currentPosition = today ? yearPosition(today) : null;
  const elapsed = today ? calendarDay(today) - calendarDay(date) : null;
  const count = dailyRecords.filter((record) => record.date.startsWith(month)).length;
  const [year, monthNumber] = month.split('-').map(Number);
  const viewedYear = today ? calendarYearPosition(year, today) : null;
  const leadingBlanks = (new Date(`${month}-01T00:00:00Z`).getUTCDay() + 6) % 7;
  const firstYear = Math.min(position.year, Number(recordMonths[0]?.slice(0, 4) ?? position.year));
  const lastYear = Math.max(position.year, currentPosition?.year ?? position.year, Number(recordMonths.at(-1)?.slice(0, 4) ?? position.year));
  const adjacent = adjacentRecordedMonths(recordMonths, month);

  useEffect(() => setMonth(date.slice(0, 7)), [date]);
  useEffect(() => {
    const query = window.matchMedia('(hover: none), (pointer: coarse)');
    const update = () => setTouchMode(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    if (!recordMonths.includes(month)) {
      setMedia({month, days: {}});
      return () => controller.abort();
    }
    fetch(`https://feei.cn/media/${month.replace('-', '/')}/index.json`, {signal: controller.signal})
      .then(async (response) => {
        if (!response.ok) throw new Error('Media unavailable');
        const data = await response.json();
        if (!data.days || typeof data.days !== 'object' || Array.isArray(data.days)) throw new Error('Invalid media index');
        return data.days as Record<string, unknown>;
      })
      .then((days) => { if (!controller.signal.aborted) setMedia({month, days}); })
      .catch(() => { if (!controller.signal.aborted) setMedia({month, days: null}); });
    return () => controller.abort();
  }, [month, recordMonths]);

  const mediaStatus = media?.month !== month ? 'loading' : media.days === null ? 'unavailable' : 'ready';
  return <div className={styles.sidebar} aria-label="日记时间与回顾">
    {today && <DiaryLifeTime today={today} readingDate={date} />}
    <section className={styles.yearSection} aria-labelledby={`${id}-year`}>
      <div className={styles.yearProgress}>
        <Tooltip.Root openDelay={200}><Tooltip.Trigger asChild><h2 id={`${id}-year`} tabIndex={0}>{year} 年</h2></Tooltip.Trigger>
          <Portal><Tooltip.Positioner><Tooltip.Content className={styles.timeTooltip}>{viewedYear?.day ? `已到第 ${viewedYear.day} 天，全年 ${viewedYear.total} 天` : '这一年尚未开始'}</Tooltip.Content></Tooltip.Positioner></Portal>
        </Tooltip.Root>
        {viewedYear && <span className={styles.timePercent}>{viewedYear.percent.toFixed(1)}%</span>}
      </div>
      <div className={styles.yearContext}><span>十二个月 · 查看 {monthNumber} 月</span><Link to={`/annual-review/${year}`} aria-label={`查看 ${year} 全年`}>全年 ↗</Link></div>
      <div className={styles.yearMonthGrid} role="group" aria-label={`${year} 年的十二个月`}>
        {Array.from({length: 12}, (_, index) => {
          const key = `${year}-${String(index + 1).padStart(2, '0')}`;
          const phase = !today || key > today.slice(0, 7) ? 'future' : key === today.slice(0, 7) ? 'current' : 'past';
          return <button key={key} type="button" aria-label={`${year} 年 ${index + 1} 月，查看月历`} aria-pressed={key === month}
            data-phase={phase} data-reading-month={key === date.slice(0, 7) || undefined} onClick={() => setMonth(key)}><span>{index + 1}</span></button>;
        })}
      </div>
      {viewedYear && <p className={styles.yearAsOf}>
        <time dateTime={today}>截至今天 {Number(today.slice(5, 7))} 月 {Number(today.slice(8))} 日</time>
        <span>{viewedYear.day === 0 ? '尚未开始' : viewedYear.day === viewedYear.total ? '已经走过' : `还剩 ${viewedYear.total - viewedYear.day} 天`}</span>
      </p>}
    </section>
    <section className={styles.calendar} aria-labelledby={`${id}-month`}>
      <header className={styles.monthHeader}>
        <div className={styles.monthTitle}>
          <h2 id={`${id}-month`} aria-label={`${year} 年 ${monthNumber} 月`}>
            <Popover.Root open={pickerOpen} onOpenChange={({open}) => { setPickerOpen(open); if (open) setPickerYear(year); }} lazyMount unmountOnExit
              positioning={{placement: 'bottom-start', strategy: 'fixed', gutter: 8, hideWhenDetached: true}}>
              <Popover.Trigger asChild><button type="button" className={styles.monthPickerTrigger} aria-label={`选择年月，当前 ${year} 年 ${monthNumber} 月`}>
                <time dateTime={month}>{monthNumber} 月</time><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
              </button></Popover.Trigger>
              <Portal><Popover.Positioner><Popover.Content className={styles.monthPicker}>
                <Popover.Title>选择年月</Popover.Title>
                <select aria-label="选择年份" value={pickerYear} onChange={(event) => setPickerYear(Number(event.target.value))}>
                  {Array.from({length: lastYear - firstYear + 1}, (_, index) => firstYear + index).map((value) => <option key={value} value={value}>{value} 年</option>)}
                </select>
                <div className={styles.monthPickerGrid}>{Array.from({length: 12}, (_, index) => {
                  const key = `${pickerYear}-${String(index + 1).padStart(2, '0')}`;
                  const hasRecords = recordMonths.includes(key);
                  return <button key={key} type="button" aria-pressed={key === month} aria-label={`${pickerYear} 年 ${index + 1} 月，${hasRecords ? '有记录' : '暂无记录'}`}
                    onClick={() => { setMonth(key); setPickerOpen(false); }}>{index + 1} 月{hasRecords && <i aria-hidden="true" />}</button>;
                })}</div>
                <p>小点表示有日记的月份</p>
                <Popover.CloseTrigger className={styles.explanationClose} aria-label="关闭年月选择">×</Popover.CloseTrigger>
              </Popover.Content></Popover.Positioner></Portal>
            </Popover.Root>
          </h2>
        </div>
        <div className={styles.monthNavigation}>
          <button type="button" aria-label="上个月" disabled={month <= `${firstYear}-01`} onClick={() => setMonth(shiftCalendarMonth(month, -1))}><Arrow /></button>
          <button type="button" aria-label="下个月" disabled={month >= `${lastYear}-12`} onClick={() => setMonth(shiftCalendarMonth(month, 1))}><Arrow next /></button>
        </div>
        <span className={styles.recordCount} aria-live="polite">{count} 天记录</span>
        <div className={styles.quickMonths}>
          {today && month !== today.slice(0, 7) && <button type="button" aria-label="跳到今天所在月份" onClick={() => setMonth(today.slice(0, 7))}>今天</button>}
          {month !== date.slice(0, 7) && <button type="button" aria-label="返回日记月份" onClick={() => setMonth(date.slice(0, 7))}>日记月</button>}
        </div>
      </header>
      <div className="annual-calendar__weekdays" aria-hidden="true">{['一', '二', '三', '四', '五', '六', '日'].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="annual-calendar__days">
        {Array.from({length: leadingBlanks}, (_, index) => <i key={`blank-${index}`} aria-hidden="true" />)}
        {Array.from({length: daysInCalendarMonth(month)}, (_, index) => {
          const day = index + 1;
          const key = `${month}-${String(day).padStart(2, '0')}`;
          const record = recordMap.get(key);
          const future = Boolean(today && key > today);
          const extra = measureMedia(media?.month === month ? media.days?.[key] : undefined);
          const base = record?.metrics ?? {characters: 0, images: 0, videos: 0};
          const metrics = {...base, images: base.images + extra.images, videos: base.videos + extra.videos};
          const className = `annual-calendar__day ${styles.day}${key === today ? ` ${styles.today}` : ''}${future ? ` ${styles.future}` : ''}`;
          return record ? <AnnualDayPreview key={key} record={record} metrics={metrics} mediaStatus={mediaStatus} touchMode={touchMode} current={key === date} today={key === today}
            className={`${className} annual-calendar__day--recorded annual-calendar__heat-${intensityLevel(metrics)}`}>
            <span aria-hidden="true">{day}</span>
          </AnnualDayPreview> : <span key={key} className={className} aria-label={`${key}：${key === today ? '今天，暂无记录' : future ? '尚未到来' : '暂无记录'}`}><span aria-hidden="true">{day}</span></span>;
        })}
      </div>
      {count === 0 && <div className={styles.emptyMonth}>
        <p>{today && month > today.slice(0, 7) ? '这个月尚未到来' : '本月暂无记录'}</p>
        <div>{adjacent.previous && <button type="button" aria-label={`跳到上个有记录月份 ${adjacent.previous}`} onClick={() => setMonth(adjacent.previous!)}>← 上个记录月</button>}
          {adjacent.next && <button type="button" aria-label={`跳到下个有记录月份 ${adjacent.next}`} onClick={() => setMonth(adjacent.next!)}>下个记录月 →</button>}</div>
      </div>}
      {count > 0 && <div className={styles.legend}>
        <Popover.Root lazyMount unmountOnExit positioning={{placement: 'top', strategy: 'fixed', gutter: 8, hideWhenDetached: true}}>
          <Popover.Trigger asChild><button type="button" className={styles.legendHelp} aria-label="查看内容量说明">内容量 ⓘ</button></Popover.Trigger>
          <Portal><Popover.Positioner><Popover.Content className={styles.explanation}>
            <Popover.Title>灰阶表示内容量</Popover.Title>
            <p>按正文文字、图片和视频的数量综合分为四档。内容越多，对比越鲜明；深色主题反向显示。</p>
            <p>{mediaStatus === 'ready' ? '日期摘要中可查看具体字数、图片与视频数。' : mediaStatus === 'loading' ? '媒体统计正在加载，当前颜色暂按正文计算。' : '媒体暂不可用，当前颜色仅按正文计算。'}</p>
            <Popover.CloseTrigger className={styles.explanationClose} aria-label="关闭内容量说明">×</Popover.CloseTrigger>
          </Popover.Content></Popover.Positioner></Portal>
        </Popover.Root>
        <span>少</span>{[1, 2, 3, 4].map((level) => <i key={level} className={`annual-calendar__heat-${level}`} aria-hidden="true" />)}<span>多</span>
        {mediaStatus === 'unavailable' && <span className={styles.mediaNote}>仅正文</span>}
      </div>}
      <div className={styles.dateKeys}><span><i className={styles.currentKey} />正在阅读</span><span><i className={styles.todayKey} />今天</span></div>
    </section>

    <section className={styles.readingSection} aria-labelledby={`${id}-reading`}>
      <h2 id={`${id}-reading`}>正在阅读</h2>
      <p className={styles.diaryTime}><span><time dateTime={date}>{date.replaceAll('-', '.')}</time> · 第 {position.day} 天</span>
        {elapsed !== null && <span className={styles.distance}>{elapsed > 0 ? <>距今 <strong>{elapsed.toLocaleString('zh-CN')}</strong> 天</> : elapsed === 0 ? '写于今天' : <>还有 <strong>{-elapsed}</strong> 天</>}</span>}
      </p>
    </section>
  </div>;
}
