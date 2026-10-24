import {Popover, Portal} from '@chakra-ui/react';
import {lifePosition} from './diaryCalendar';
import styles from './DailyRecordSidebar.module.css';

const birthDate = '1992-10-28';
const referenceYears = 79.25;
const calendarSource = 'https://www.hko.gov.hk/tc/gts/time/calendar/pdf/files/1992.pdf';
const lifespanSource = 'https://www.nhc.gov.cn/wjw/xwdt/202603/7076807d73b44189ac97c6eecc87a80c.shtml';

export default function DiaryLifeTime({today, readingDate}: {today: string; readingDate: string}) {
  const life = lifePosition(today, birthDate, referenceYears);
  const readingLife = lifePosition(readingDate, birthDate, referenceYears);
  return <section className={styles.lifeSection} aria-label="人生时间">
    <div className={styles.lifeHeader}>
      <div className={styles.lifeTitle}><h2>人生时间</h2>
        <Popover.Root lazyMount unmountOnExit positioning={{placement: 'bottom-start', strategy: 'fixed', gutter: 8, hideWhenDetached: true}}>
          <Popover.Trigger asChild><button type="button" className={styles.referenceButton} aria-label="查看人生时间计算依据">ⓘ</button></Popover.Trigger>
          <Portal><Popover.Positioner><Popover.Content className={styles.explanation}>
            <Popover.Title>人生时间的计算依据</Popover.Title>
            <p>出生日期：农历 1992 年十月初三，对应公历 1992 年 10 月 28 日。<a href={calendarSource} target="_blank" rel="noopener noreferrer">历法对照 ↗</a></p>
            <p>以国家卫健委公布的 2025 年全国人均预期寿命 79.25 岁作参考，一格一年，末格为 0.25 年。<a href={lifespanSource} target="_blank" rel="noopener noreferrer">统计来源 ↗</a></p>
            <p>实心表示截至今天已走过的时间，描边定位正在阅读的日记。月份中虚线描边表示当前查看的其他月份，日期的灰阶表示内容量。</p>
            <p>按公历出生日期计算已走过的年数与天数；这是一把时间刻度，不代表个人寿命预测。</p>
            <Popover.CloseTrigger className={styles.explanationClose} aria-label="关闭计算依据">×</Popover.CloseTrigger>
          </Popover.Content></Popover.Positioner></Portal>
        </Popover.Root>
      </div>
      <span className={styles.timePercent}>{life.percent.toFixed(1)}%</span>
    </div>
    <p className={styles.lifeAge}>已走过 <strong>{life.years}</strong> 年 {life.days} 天</p>
    <div className={styles.lifeGrid} role="progressbar" aria-label="人生时间，按全国人均预期寿命参考" aria-valuemin={0} aria-valuemax={referenceYears}
      aria-valuenow={Math.min(referenceYears, life.age)} aria-valuetext={`已走过 ${life.years} 年 ${life.days} 天，参考刻度 ${referenceYears} 年`}>
      {Array.from({length: Math.ceil(referenceYears)}, (_, index) => {
        const duration = Math.min(1, referenceYears - index);
        const elapsed = Math.max(0, Math.min(duration, life.age - index));
        return <i key={index} data-life-year={index + 1} data-current-year={life.age >= index && life.age < index + duration || undefined}
          data-reading-year={readingLife.age >= index && readingLife.age < index + duration || undefined}
          data-reference-partial={duration < 1 || undefined}
          style={{background: `linear-gradient(to right, var(--ifm-color-emphasis-200) ${duration * 100}%, transparent ${duration * 100}%)`}} aria-hidden="true">
          <span style={{width: `${elapsed * 100}%`}} /><b>{index + 1}</b>
        </i>;
      })}
    </div>
    <div className={styles.lifeScale}>一格一年 · 日记第 {readingLife.years + 1} 年</div>
    <div className={styles.timeKeys}><span><i className={styles.elapsedKey} />实心：已走过</span><span><i className={styles.currentKey} />描边：日记位置</span></div>
  </section>;
}
