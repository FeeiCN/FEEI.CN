import React, {useEffect, useMemo, useRef, useState} from 'react';
import ReactDOM from 'react-dom';
import AccountAssetsDashboard from '@site/src/components/AccountAssetsDashboard';
import AlipayInvestDashboard from '@site/src/components/AlipayInvestDashboard';
import BrowserOnly from '@docusaurus/BrowserOnly';
import FinanceAssetsTrend from '@site/src/components/FinanceAssetsTrend';
import {HEALTH_CHART_NAV, HealthChartSelection, HealthProvider, loadHealthChartHistory, type TimeScope as HealthTimeScope} from '@site/src/components/HealthCharts';
import type {HealthData} from '@site/src/components/HealthCharts/transform';
import HKIPOCharts from '@site/src/components/HKIPOCharts';
import ReactECharts from 'echarts-for-react';
import {useColorMode} from '@docusaurus/theme-common';
import styles from './styles.module.css';
import {
  DailyReflectionDashboardProps,
  DailyAnalysis,
  Manifest,
  DailyHealthData,
  DriveLog,
  DriveDaySummary,
  summarizeDriveLog,
  LLMSummaryPayload,
  ReadingYearPayload,
  ObjectivePoint,
  TokenStackPoint,
  TimelineModel,
  ObjectiveChartTooltip,
  DataDomain,
  DailyDetailTab,
  FinanceTab,
  DatedReviewPeriodKind,
  ReviewPeriodKind,
  DatedReviewPeriod,
  ReviewPeriod,
  PeriodBounds,
  ObjectiveTimeScope,
  REVIEW_PERIOD_LABELS,
  LLM_VENDOR_CONFIGS,
  MONTH_LABELS,
  REVIEW_START_YEAR,
  HEALTH_HISTORY_START_DATE,
  AuthoredPeriodReview,
  AUTHORED_PERIOD_REVIEWS,
  dateToPath,
  formatChineseDate,
  formatDateKey,
  parseDateKey,
  isValidDateKey,
  diffDays,
  formatPercent,
  getYearProgress,
  addDays,
  getIsoWeekKey,
  getReviewPeriodBounds,
  periodFromAnchor,
  shiftReviewPeriod,
  isFutureReviewPeriod,
  getScopeDates,
  getScopedAvailableDates,
  scopeLabel,
  formatCompactNumber,
  formatHoursFromSeconds,
  parseGitCounts,
  getAnalysisCompleteness,
  getWeekdayLabel,
  getHolidayLabel,
  getWeatherSummary,
  getWeatherKind,
  formatNumber,
  minuteToLabel,
  daysInYear,
  pickInitialDate,
  pickInitialReviewPeriod,
  fetchJson,
  fetchText,
  fetchDailyAnalysis,
  mapWithConcurrency,
  fetchWeather,
} from './model';
import {
  buildTimelineModel,
  LifeCalendar,
  InsightList,
  TimelinePanel,
} from './timeline';

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.filter(Boolean).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

function renderFollowUp(text: string): React.ReactNode {
  const match = text.match(/^\*\*(明日动作|观察项)\*\*[：:]\s*(.*)$/);
  if (!match) return renderInlineMarkdown(text);
  return (
    <>
      {match[1] === '观察项' ? <strong>观察：</strong> : null}
      {renderInlineMarkdown(match[2])}
    </>
  );
}

function normalizeImageSrc(src: string): string {
  if (/^https?:\/\//.test(src) || src.startsWith('/')) return src;
  return `/data/daily/assets/${src.replace(/^\.?\//, '')}`;
}

function DiaryImageView({image}: {image: DiaryImage}): React.ReactNode {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');

  return (
    <span className={`${styles.diaryImageFrame} ${status === 'loaded' ? styles.diaryImageFrameLoaded : ''} ${status === 'error' ? styles.diaryImageFrameError : ''}`}>
      {status === 'loading' ? <span className={styles.diaryImageSkeleton} aria-hidden="true" /> : null}
      {status === 'error' ? <span className={styles.diaryImageError}>图片加载失败</span> : null}
      <img
        src={normalizeImageSrc(image.src)}
        alt={image.alt}
        loading="lazy"
        onLoad={() => setStatus('loaded')}
        onError={() => setStatus('error')}
      />
    </span>
  );
}

type DiaryImage = {
  src: string;
  alt: string;
};

function renderDiaryImages(images: DiaryImage[], key: string): React.ReactNode {
  return (
    <div key={key} className={`${styles.diaryImages} ${images.length === 1 ? styles.diaryImagesSingle : styles.diaryImagesGrid}`}>
      {images.map((image) => (
        <DiaryImageView key={image.src} image={image} />
      ))}
    </div>
  );
}

function renderMixedImageBlock(block: string, index: number): React.ReactNode[] | null {
  const imagePattern = /!\[([^\]]*)\]\(([^)]+)\)|!([^\s!]+\.(?:png|jpe?g|webp|gif))/gi;
  const nodes: React.ReactNode[] = [];
  const pendingImages: DiaryImage[] = [];
  let lastIndex = 0;
  let matched = false;

  const flushImages = () => {
    if (!pendingImages.length) return;
    nodes.push(renderDiaryImages([...pendingImages], `${index}-images-${nodes.length}`));
    pendingImages.length = 0;
  };

  const flushText = (text: string) => {
    const content = text.trim();
    if (!content) return;
    flushImages();
    nodes.push(<p key={`${index}-text-${nodes.length}`}>{renderInlineMarkdown(content)}</p>);
  };

  for (const match of block.matchAll(imagePattern)) {
    matched = true;
    flushText(block.slice(lastIndex, match.index));
    const src = match[2] || match[3];
    if (!src) continue;
    pendingImages.push({
      src,
      alt: match[1] || match[3] || '日记图片',
    });
    lastIndex = (match.index || 0) + match[0].length;
  }

  if (!matched) return null;
  flushText(block.slice(lastIndex));
  flushImages();
  return nodes;
}

function markdownToBlocks(markdown: string): React.ReactNode[] {
  const blocks = markdown
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks
    .map((block, index) => {
      if (block.startsWith('# ')) return null;
      if (block.startsWith('## ')) {
        return <h4 key={index}>{renderInlineMarkdown(block.replace(/^##\s+/, ''))}</h4>;
      }
      const imageBlock = renderMixedImageBlock(block, index);
      if (imageBlock) return imageBlock;
      if (/^-\s+/m.test(block)) {
        return (
          <ul key={index}>
            {block.split('\n').filter(Boolean).map((line) => (
              <li key={line}>{renderInlineMarkdown(line.replace(/^-\s+/, ''))}</li>
            ))}
          </ul>
        );
      }
      return <p key={index}>{renderInlineMarkdown(block)}</p>;
    })
    .filter(Boolean);
}

function DailyDiary({
  diary,
}: {
  diary: string;
}): React.ReactNode {
  return (
    <div className={styles.dailyDiary}>
      <div className={styles.markdown}>
        {diary ? markdownToBlocks(diary) : <p className={styles.muted}>暂无公开日记。</p>}
      </div>
    </div>
  );
}

function DailyAnalysisReport({
  analysis,
  selectedDate,
  latestAnalysisDate,
  onDateSelect,
}: {
  analysis: DailyAnalysis | null;
  selectedDate: string;
  latestAnalysisDate?: string;
  onDateSelect: (date: string) => void;
}): React.ReactNode {
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    setShowDetails(false);
  }, [analysis, selectedDate]);

  if (!analysis) {
    const isToday = selectedDate === formatDateKey(new Date());
    return (
      <section className={styles.analysisReport}>
        <div className={styles.dailyDiaryHead}>
          <span>AI 分析报告</span>
        </div>
        <div className={styles.emptyReport}>
          <strong>{isToday ? '今天的数据仍在形成' : '这一天尚未生成分析'}</strong>
          <p>{isToday ? '每日复盘会在次日数据完成后生成。' : '可切换到最近已经完成的复盘。'}</p>
          {latestAnalysisDate && latestAnalysisDate !== selectedDate ? (
            <button type="button" onClick={() => onDateSelect(latestAnalysisDate)}>
              查看最新复盘 · {latestAnalysisDate.slice(5)}
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  const insightGroups = [
    {title: '健康', items: analysis.health_insights || []},
    {title: '阅读', items: analysis.reading_insights || []},
    {title: '财务', items: analysis.finance_insights || []},
    {title: 'AI 使用', items: analysis.ai_insights || []},
    {title: '生活记录', items: analysis.life_log_insights || []},
    {title: '环境与出行', items: analysis.environment_mobility_insights || []},
    {title: 'Git 推进', items: analysis.git_insights || []},
  ].filter((group) => group.items.length);

  return (
    <section className={styles.analysisReport}>
      <div className={styles.dailyDiaryHead}>
        <span>AI 分析报告</span>
        {analysis.generatedAt ? <small>生成于 {analysis.generatedAt.replace('T', ' ').slice(0, 16)}</small> : null}
      </div>

      {analysis.legacy_report_markdown ? (
        <div className={styles.markdown}>{markdownToBlocks(analysis.legacy_report_markdown)}</div>
      ) : (
        <>
          {analysis.top_signals?.length ? (
            <div className={styles.reportBlock}>
              <h2>今日判断</h2>
              <div className={styles.reportSignals}>
                {analysis.top_signals.map((signal, index) => (
                  <article key={index}>
                    <strong>{signal.area || '观察'}</strong>
                    <p>{signal.summary}</p>
                    {signal.evidence?.[0] ? <small>{signal.evidence[0]}</small> : null}
                    {signal.confidence ? <span>{signal.confidence}</span> : null}
                  </article>
                ))}
              </div>
            </div>
          ) : null}

          {analysis.follow_ups?.length ? (
            <div className={`${styles.reportBlock} ${styles.reportActions}`}>
              <h2>明日动作</h2>
              <ul>
                {analysis.follow_ups.map((item) => (
                  <li key={item}>{renderFollowUp(item)}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {analysis.data_status?.length ? (
            <div className={styles.reportStatusSummary} aria-label="异常数据状态">
              {analysis.data_status.map((item, index) => (
                <span key={`${item.area}-${index}`} title={item.detail}>
                  {item.area || '来源'} · {item.status || '未知'}
                </span>
              ))}
            </div>
          ) : null}

          {insightGroups.length || analysis.cross_domain_insights?.length ? (
            <div className={styles.reportDetailsRegion}>
              <button
                type="button"
                className={styles.reportDetailsToggle}
                aria-expanded={showDetails}
                aria-controls="daily-analysis-details"
                onClick={() => setShowDetails((value) => !value)}
              >
                {showDetails ? '收起完整分析' : '查看完整分析与证据'}
              </button>
              {showDetails ? (
                <div id="daily-analysis-details" className={styles.reportDetailsBody}>
                  {insightGroups.map((group) => (
                    <div key={group.title} className={styles.reportBlock}>
                      <h2>{group.title}</h2>
                      <InsightList items={group.items} />
                    </div>
                  ))}
                  {analysis.cross_domain_insights?.length ? (
                    <div className={styles.reportBlock}>
                      <h2>跨板块洞察</h2>
                      {analysis.cross_domain_insights.map((item, index) => (
                        <article key={index} className={styles.insight}>
                          <p>{item.summary}</p>
                          {item.evidence?.length ? <ul>{item.evidence.map((value) => <li key={value}>{value}</li>)}</ul> : null}
                          {item.uncertainty ? <p className={styles.muted}>{item.uncertainty}</p> : null}
                        </article>
                      ))}
                    </div>
                  ) : null}
                  {analysis.data_status?.length ? (
                    <div className={styles.reportBlock}>
                      <h2>数据状态明细</h2>
                      <ul className={styles.statusList}>
                        {analysis.data_status.map((item, index) => (
                          <li key={index}>
                            <strong>{item.area || '来源'}</strong>
                            <span>{item.status || '未知'}</span>
                            <p>{item.detail}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : <div id="daily-analysis-details" hidden />}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function handleTabKey<T extends string>(
  event: React.KeyboardEvent<HTMLButtonElement>,
  keys: T[],
  active: T,
  onChange: (value: T) => void,
) {
  const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown'
    ? 1
    : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
      ? -1
      : 0;
  let nextIndex = keys.indexOf(active);
  if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = keys.length - 1;
  else if (direction) nextIndex = (nextIndex + direction + keys.length) % keys.length;
  else return;

  event.preventDefault();
  onChange(keys[nextIndex]);
  const tablist = event.currentTarget.parentElement;
  requestAnimationFrame(() => tablist?.querySelectorAll<HTMLElement>('[role="tab"]')[nextIndex]?.focus());
}

function handleChartPointKey(
  event: React.KeyboardEvent<SVGGElement>,
  index: number,
  dates: string[],
  onDateSelect: (date: string) => void,
) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    onDateSelect(dates[index]);
    return;
  }
  let nextIndex = index;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = Math.min(dates.length - 1, index + 1);
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = Math.max(0, index - 1);
  else if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = dates.length - 1;
  else return;
  event.preventDefault();
  event.currentTarget.ownerSVGElement
    ?.querySelectorAll<SVGGElement>('[data-chart-point]')[nextIndex]
    ?.focus();
}

function DateNavigator({
  date,
  latestDate,
  onChange,
}: {
  date: string;
  latestDate?: string;
  onChange: (date: string) => void;
}): React.ReactNode {
  const today = formatDateKey(new Date());
  const previousDate = date ? formatDateKey(addDays(parseDateKey(date), -1)) : '';
  const nextDate = date ? formatDateKey(addDays(parseDateKey(date), 1)) : '';

  return (
    <div className={styles.dateNavigator} aria-label="复盘日期">
      <button
        type="button"
        className={styles.dateStepButton}
        aria-label="前一天"
        title="前一天"
        disabled={!previousDate}
        onClick={() => previousDate && onChange(previousDate)}
      >
        <span aria-hidden="true">←</span>
      </button>
      <input
        type="date"
        value={date}
        max={today}
        aria-label="选择复盘日期"
        onChange={(event) => event.target.value && onChange(event.target.value)}
      />
      <button
        type="button"
        className={styles.dateStepButton}
        aria-label="后一天"
        title="后一天"
        disabled={!nextDate || nextDate > today}
        onClick={() => nextDate && nextDate <= today && onChange(nextDate)}
      >
        <span aria-hidden="true">→</span>
      </button>
      <button
        type="button"
        disabled={!latestDate || date === latestDate}
        onClick={() => latestDate && onChange(latestDate)}
      >
        最新复盘
      </button>
      <button type="button" disabled={date === today} onClick={() => onChange(today)}>
        今天实时
      </button>
    </div>
  );
}

function DataDomainTabs({
  active,
  onChange,
}: {
  active: DataDomain;
  onChange: (domain: DataDomain) => void;
}): React.ReactNode {
  const domains: Array<{key: DataDomain; label: string}> = [
    {key: 'health', label: '健康'},
    {key: 'career', label: '事业'},
    {key: 'finance', label: '财务'},
    {key: 'life', label: '生活'},
    {key: 'compare', label: '对比'},
  ];
  const keys = domains.map((domain) => domain.key);

  return (
    <div className={`${styles.filterTier} ${styles.dataDomainTier}`}>
      <span className={styles.filterTierLabel}>领域</span>
      <div className={styles.dataDomainTabs} role="tablist" aria-label="客观数据分类">
        {domains.map((domain) => (
          <button
            key={domain.key}
            type="button"
            role="tab"
            id={`objective-domain-tab-${domain.key}`}
            aria-controls="objective-domain-panel"
            aria-selected={active === domain.key}
            tabIndex={active === domain.key ? 0 : -1}
            className={active === domain.key ? styles.dataDomainTabActive : ''}
            onClick={() => onChange(domain.key)}
            onKeyDown={(event) => handleTabKey(event, keys, active, onChange)}
          >
            {domain.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function DailyDetailTabs({
  active,
  onChange,
}: {
  active: DailyDetailTab;
  onChange: (tab: DailyDetailTab) => void;
}): React.ReactNode {
  const tabs: Array<{key: DailyDetailTab; label: string}> = [
    {key: 'diary', label: '日记'},
    {key: 'timeline', label: '24小时轨迹'},
    {key: 'analysis', label: 'AI分析'},
  ];
  const keys = tabs.map((tab) => tab.key);

  return (
    <div className={styles.dailyDetailTabs} role="tablist" aria-label="当日细节">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          id={`daily-detail-tab-${tab.key}`}
          aria-controls="daily-detail-panel"
          aria-selected={active === tab.key}
          tabIndex={active === tab.key ? 0 : -1}
          className={active === tab.key ? styles.dailyDetailTabActive : ''}
          onClick={() => onChange(tab.key)}
          onKeyDown={(event) => handleTabKey(event, keys, active, onChange)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function FinanceTabs({
  active,
  onChange,
}: {
  active: FinanceTab;
  onChange: (tab: FinanceTab) => void;
}): React.ReactNode {
  const tabs: Array<{key: FinanceTab; label: string}> = [
    {key: 'income', label: '收入'},
    {key: 'expense', label: '支出'},
    {key: 'investment', label: '投资'},
  ];
  const keys = tabs.map((tab) => tab.key);

  return (
    <div className={styles.financeTabs} role="tablist" aria-label="财务数据分类">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          id={`finance-tab-${tab.key}`}
          aria-controls="finance-tab-panel"
          aria-selected={active === tab.key}
          tabIndex={active === tab.key ? 0 : -1}
          className={active === tab.key ? styles.financeTabActive : ''}
          onClick={() => onChange(tab.key)}
          onKeyDown={(event) => handleTabKey(event, keys, active, onChange)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function scrollToChartPanel(id: string) {
  const target = document.getElementById(id);
  const scroller = target?.closest(`.${styles.healthChartsPanel}`);
  if (!target || !(scroller instanceof HTMLElement)) return;
  const targetRect = target.getBoundingClientRect();
  const scrollerRect = scroller.getBoundingClientRect();
  const canScrollPanel = scroller.scrollHeight > scroller.clientHeight + 1
    && getComputedStyle(scroller).overflowY !== 'visible';
  if (!canScrollPanel) {
    target.scrollIntoView({behavior: 'smooth', block: 'start'});
    return;
  }
  scroller.scrollTo({
    top: scroller.scrollTop + targetRect.top - scrollerRect.top - 112,
    behavior: 'smooth',
  });
}

type ChartNavItem = {id: string; label: string; metricKeys?: string[]};
const DEFAULT_HEALTH_CHART_ID = HEALTH_CHART_NAV[0]?.charts[0]?.id || '';

function SubtabPicker({
  items,
  label,
  onSelect,
  selectedIds,
  onToggle,
}: {
  items: ChartNavItem[];
  label: string;
  onSelect?: (item: ChartNavItem) => void;
  selectedIds?: ReadonlySet<string>;
  onToggle?: (item: ChartNavItem) => void;
}): React.ReactNode {
  const [expanded, setExpanded] = useState(false);
  const handleClick = (item: ChartNavItem) => {
    onToggle?.(item);
    onSelect?.(item);
    if (!onToggle) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        scrollToChartPanel(item.id);
      }));
    }
    if (!onToggle) setExpanded(false);
  };

  return (
    <div className={`${styles.subtabPicker} ${expanded ? styles.subtabPickerExpanded : ''}`}>
      <nav
        className={`${styles.healthChartSubtabs} ${expanded ? styles.healthChartSubtabsExpanded : ''}`}
        aria-label={label}
      >
        {items.map((item) => {
          const selected = selectedIds?.has(item.id) ?? false;
          return (
            <button
              key={item.id}
              type="button"
              className={selected ? styles.healthChartSubtabSelected : ''}
              aria-pressed={onToggle ? selected : undefined}
              onClick={() => handleClick(item)}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
      <button
        type="button"
        className={styles.subtabExpandButton}
        aria-label={expanded ? '收起全部图表标签' : '展开全部图表标签'}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span aria-hidden="true" />
      </button>
    </div>
  );
}

function HealthChartSubtabs({
  activeSection,
  onSectionChange,
}: {
  activeSection: string;
  onSectionChange: (section: string) => void;
}): React.ReactNode {
  return (
    <div className={styles.healthNavigation}>
      <div className={styles.healthSectionTabs} role="group" aria-label="健康图表分类">
        {HEALTH_CHART_NAV.map((item) => (
          <button
            key={item.title}
            type="button"
            aria-pressed={item.title === activeSection}
            className={item.title === activeSection ? styles.healthSectionTabActive : ''}
            onClick={() => onSectionChange(item.title)}
          >
            {item.title}
          </button>
        ))}
      </div>
    </div>
  );
}

function DomainSubtabs({items}: {items: Array<{id: string; label: string}>}): React.ReactNode {
  return <SubtabPicker items={items} label="图表跳转" />;
}

function ObjectiveStatGrid({items}: {items: Array<{value: React.ReactNode; label: string; tone?: 'accent' | 'green' | 'orange'}>}): React.ReactNode {
  return (
    <div className={styles.objectiveStatGrid}>
      {items.map((item) => (
        <div key={item.label} className={`${styles.objectiveStatCard} ${item.tone ? styles[`objectiveStatCard_${item.tone}`] : ''}`}>
          <strong>{item.value}</strong>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function ObjectiveTooltip({tooltip}: {tooltip: ObjectiveChartTooltip | null}): React.ReactNode {
  if (!tooltip) return null;
  const left = Math.max(8, Math.min(tooltip.x + 12, window.innerWidth - 304));
  const top = Math.max(90, tooltip.y - 12);
  return ReactDOM.createPortal(
    <div
      className={styles.objectiveTooltip}
      style={{left, top}}
      role="tooltip"
    >
      <div className={styles.tooltipDate}>{tooltip.title}</div>
      <div className={styles.tooltipMeta}>
        {tooltip.lines.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </div>
    </div>,
    document.body,
  );
}

function ObjectiveBarLineChart({
  points,
  valueLabel,
  secondaryLabel,
  tertiaryLabel,
  formatValue = (value) => formatCompactNumber(value, 0),
  formatSecondary,
  selectedDate,
  onDateSelect,
}: {
  points: ObjectivePoint[];
  valueLabel: string;
  secondaryLabel?: string;
  tertiaryLabel?: string;
  formatValue?: (value: number) => string;
  formatSecondary?: (value: number) => string;
  selectedDate?: string;
  onDateSelect: (date: string) => void;
}): React.ReactNode {
  const [tooltip, setTooltip] = useState<ObjectiveChartTooltip | null>(null);
  const chartHeight = 238;
  const labelHeight = 30;
  const plotHeight = chartHeight - labelHeight - 16;
  const sidePadding = 24;
  const minimumStep = points.length > 120 ? 8 : points.length > 60 ? 12 : points.length > 30 ? 18 : 24;
  const width = Math.max(520, points.length * minimumStep + sidePadding * 2);
  const step = (width - sidePadding * 2) / Math.max(1, points.length);
  const barWidth = Math.max(3, Math.min(18, step * 0.62));
  const groupedBarWidth = tertiaryLabel ? Math.max(2, (barWidth - 2) / 3) : barWidth;
  const xForIndex = (index: number) => sidePadding + index * step + (step - barWidth) / 2;
  const showSecondaryLine = Boolean(secondaryLabel && !tertiaryLabel);
  const maxValue = Math.max(1, ...points.flatMap((point) => [point.value, tertiaryLabel ? point.tertiary || 0 : 0, !showSecondaryLine ? point.secondary || 0 : 0]));
  const maxSecondary = Math.max(1, ...points.map((point) => point.secondary || 0));
  const yForValue = (value: number) => plotHeight - (Math.max(0, value) / maxValue) * plotHeight;
  const yForSecondary = (value: number) => plotHeight - (Math.max(0, value) / maxSecondary) * plotHeight;
  const linePoints = points
    .map((point, index) => {
      const x = xForIndex(index) + barWidth / 2;
      return `${x},${yForSecondary(point.secondary || 0)}`;
    })
    .join(' ');
  const selectedIndex = selectedDate ? points.findIndex((point) => point.date === selectedDate) : -1;
  const selectedX = selectedIndex >= 0 ? xForIndex(selectedIndex) : null;

  if (!points.length) {
    return <div className={styles.financeEmptyPanel}>当前时间范围暂无数据</div>;
  }

  return (
    <div className={styles.objectiveChartScroll}>
      <svg className={styles.objectiveChart} viewBox={`0 0 ${width} ${chartHeight}`} style={{width, height: chartHeight}} role="group" aria-label={`${valueLabel}趋势图`}>
        {selectedX !== null ? (
          <g className={styles.objectiveSelectedDate}>
            <rect x={Math.max(0, selectedX - (step - barWidth) / 2)} y={0} width={step} height={plotHeight} rx={5} />
            <line x1={selectedX + barWidth / 2} x2={selectedX + barWidth / 2} y1={0} y2={plotHeight + 18} />
            <text x={selectedX + barWidth / 2} y={plotHeight + 28} textAnchor="middle">
              {selectedDate?.slice(5)}
            </text>
          </g>
        ) : null}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
          <g key={ratio}>
            <line x1={0} x2={width} y1={ratio * plotHeight} y2={ratio * plotHeight} className={styles.objectiveGridLine} />
            <text x={0} y={Math.max(10, ratio * plotHeight - 3)} className={styles.objectiveAxisLabel}>
              {formatValue(maxValue * (1 - ratio))}
            </text>
          </g>
        ))}
        {points.map((point, index) => {
          const x = xForIndex(index);
          const barHeight = Math.max(point.value ? 1 : 0, (point.value / maxValue) * plotHeight);
          const secondaryHeight = Math.max(point.secondary ? 1 : 0, ((point.secondary || 0) / maxValue) * plotHeight);
          const tertiaryHeight = Math.max(point.tertiary ? 1 : 0, ((point.tertiary || 0) / maxValue) * plotHeight);
          const showLabel = points.length <= 35 || index % Math.ceil(points.length / 18) === 0;
          const tooltipLines = [
            `${valueLabel}: ${formatValue(point.value)}`,
            secondaryLabel ? `${secondaryLabel}: ${(formatSecondary || formatValue)(point.secondary || 0)}` : '',
            tertiaryLabel ? `${tertiaryLabel}: ${formatValue(point.tertiary || 0)}` : '',
          ].filter(Boolean);
          return (
            <g
              key={point.date}
              className={styles.objectiveChartPoint}
              role="button"
              data-chart-point
              tabIndex={point.date === selectedDate || (selectedIndex < 0 && index === points.length - 1) ? 0 : -1}
              aria-label={`${point.date}，${tooltipLines.join('，')}`}
              onClick={() => onDateSelect(point.date)}
              onKeyDown={(event) => handleChartPointKey(event, index, points.map((item) => item.date), onDateSelect)}
              onMouseMove={(event) => setTooltip({x: event.clientX, y: event.clientY, title: point.date, lines: tooltipLines})}
              onMouseLeave={() => setTooltip(null)}
            >
              <rect x={Math.max(0, x - (step - barWidth) / 2)} y={0} width={step} height={plotHeight + labelHeight} rx={5} className={styles.objectiveHoverBand} />
              {tertiaryLabel ? (
                <rect x={x + groupedBarWidth * 2 + 2} y={plotHeight - tertiaryHeight} width={groupedBarWidth} height={tertiaryHeight} rx={2} className={styles.objectiveBarTertiary} />
              ) : null}
              {secondaryLabel && !showSecondaryLine ? (
                <rect x={x + (tertiaryLabel ? groupedBarWidth + 1 : 0)} y={plotHeight - secondaryHeight} width={groupedBarWidth} height={secondaryHeight} rx={2} className={styles.objectiveBarSecondary} />
              ) : null}
              <rect x={x} y={plotHeight - barHeight} width={groupedBarWidth} height={barHeight} rx={2} className={styles.objectiveBarPrimary} />
              <text x={x + barWidth / 2} y={plotHeight + 14} textAnchor="middle" className={styles.objectiveXAxisLabel}>
                {showLabel ? point.date.slice(5) : ''}
              </text>
            </g>
          );
        })}
        {showSecondaryLine ? (
          <>
            <polyline points={linePoints} className={styles.objectiveLine} />
            {points.map((point, index) => {
              const x = xForIndex(index) + barWidth / 2;
              return <circle key={`${point.date}-line`} cx={x} cy={yForSecondary(point.secondary || 0)} r={2.4} className={styles.objectiveLineDot} />;
            })}
          </>
        ) : null}
      </svg>
      <ObjectiveTooltip tooltip={tooltip} />
    </div>
  );
}

function TokenStackedBarChart({
  points,
  selectedDate,
  onDateSelect,
}: {
  points: TokenStackPoint[];
  selectedDate?: string;
  onDateSelect: (date: string) => void;
}): React.ReactNode {
  const [tooltip, setTooltip] = useState<ObjectiveChartTooltip | null>(null);
  const chartHeight = 238;
  const labelHeight = 30;
  const plotHeight = chartHeight - labelHeight - 16;
  const sidePadding = 24;
  const minimumStep = points.length > 120 ? 8 : points.length > 60 ? 12 : points.length > 30 ? 18 : 24;
  const width = Math.max(520, points.length * minimumStep + sidePadding * 2);
  const step = (width - sidePadding * 2) / Math.max(1, points.length);
  const barWidth = Math.max(5, Math.min(18, step * 0.62));
  const xForIndex = (index: number) => sidePadding + index * step + (step - barWidth) / 2;
  const totals = points.map((point) => point.minimax + point.openai + point.anthropic);
  const maxValue = Math.max(1, ...totals);
  const selectedIndex = selectedDate ? points.findIndex((point) => point.date === selectedDate) : -1;
  const selectedX = selectedIndex >= 0 ? xForIndex(selectedIndex) : null;

  if (!points.length) {
    return <div className={styles.financeEmptyPanel}>当前时间范围暂无数据</div>;
  }

  return (
    <div className={styles.objectiveChartScroll}>
      <svg className={styles.objectiveChart} viewBox={`0 0 ${width} ${chartHeight}`} style={{width, height: chartHeight}} role="group" aria-label="AI 使用强度趋势图">
        {selectedX !== null ? (
          <g className={styles.objectiveSelectedDate}>
            <rect x={Math.max(0, selectedX - (step - barWidth) / 2)} y={0} width={step} height={plotHeight} rx={5} />
            <line x1={selectedX + barWidth / 2} x2={selectedX + barWidth / 2} y1={0} y2={plotHeight + 18} />
            <text x={selectedX + barWidth / 2} y={plotHeight + 28} textAnchor="middle">
              {selectedDate?.slice(5)}
            </text>
          </g>
        ) : null}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
          <g key={ratio}>
            <line x1={0} x2={width} y1={ratio * plotHeight} y2={ratio * plotHeight} className={styles.objectiveGridLine} />
            <text x={0} y={Math.max(10, ratio * plotHeight - 3)} className={styles.objectiveAxisLabel}>
              {formatCompactNumber(maxValue * (1 - ratio), 1)}
            </text>
          </g>
        ))}
        {points.map((point, index) => {
          const x = xForIndex(index);
          const total = point.minimax + point.openai + point.anthropic;
          let y = plotHeight;
          const showLabel = points.length <= 35 || index % Math.ceil(points.length / 18) === 0;
          const segments = [
            {key: 'minimax', label: 'MiniMax', value: point.minimax, className: styles.objectiveBarPrimary},
            {key: 'openai', label: 'OpenAI', value: point.openai, className: styles.objectiveBarSecondary},
            {key: 'anthropic', label: 'Anthropic', value: point.anthropic, className: styles.objectiveBarTertiary},
          ];
          const tooltipLines = [
            `总量: ${formatCompactNumber(total, 1)}`,
            `MiniMax: ${formatCompactNumber(point.minimax, 1)}`,
            `OpenAI: ${formatCompactNumber(point.openai, 1)}`,
            `Anthropic: ${formatCompactNumber(point.anthropic, 1)}`,
          ];
          return (
            <g
              key={point.date}
              className={styles.objectiveChartPoint}
              role="button"
              data-chart-point
              tabIndex={point.date === selectedDate || (selectedIndex < 0 && index === points.length - 1) ? 0 : -1}
              aria-label={`${point.date}，${tooltipLines.join('，')}`}
              onClick={() => onDateSelect(point.date)}
              onKeyDown={(event) => handleChartPointKey(event, index, points.map((item) => item.date), onDateSelect)}
              onMouseMove={(event) => setTooltip({x: event.clientX, y: event.clientY, title: point.date, lines: tooltipLines})}
              onMouseLeave={() => setTooltip(null)}
            >
              <rect x={Math.max(0, x - (step - barWidth) / 2)} y={0} width={step} height={plotHeight + labelHeight} rx={5} className={styles.objectiveHoverBand} />
              {segments.map((segment) => {
                if (segment.value <= 0) return null;
                const height = Math.max(1, (segment.value / maxValue) * plotHeight);
                y -= height;
                return (
                  <rect
                    key={segment.key}
                    x={x}
                    y={y}
                    width={barWidth}
                    height={height}
                    rx={2}
                    className={segment.className}
                  />
                );
              })}
              <text x={x + barWidth / 2} y={plotHeight + 14} textAnchor="middle" className={styles.objectiveXAxisLabel}>
                {showLabel ? point.date.slice(5) : ''}
              </text>
            </g>
          );
        })}
      </svg>
      <ObjectiveTooltip tooltip={tooltip} />
    </div>
  );
}

function ObjectiveChartCard({
  id,
  title,
  meta,
  children,
  legend,
}: {
  id: string;
  title: string;
  meta?: string;
  children: React.ReactNode;
  legend?: Array<{label: string; className: string}>;
}): React.ReactNode {
  return (
    <section id={id} className={styles.objectiveChartCard}>
      <div className={styles.objectiveChartHead}>
        <div>
          <h2>{title}</h2>
          {meta ? <span>{meta}</span> : null}
        </div>
        {legend?.length ? (
          <div className={styles.objectiveLegend}>
            {legend.map((item) => (
              <span key={item.label}>
                <i className={item.className} />
                {item.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function DriveTimeChart({points}: {points: Array<{date: string; trips: Array<{start: number; end: number}>}>}): React.ReactNode {
  if (!points.length) return <div className={styles.financeEmptyPanel}>当前时间范围暂无完整行程</div>;
  const values = points.flatMap((point) => point.trips.flatMap((trip) => [trip.start, trip.end]));
  const min = Math.max(0, Math.floor((Math.min(...values) - 30) / 30) * 30);
  const max = Math.min(1440, Math.ceil((Math.max(...values) + 30) / 30) * 30);
  const renderRange = (_params: unknown, api: {value: (index: number) => unknown; coord: (value: [number, number]) => number[]; style: () => object}) => {
    const day = Number(api.value(0));
    const start = Number(api.value(1));
    const end = Number(api.value(2));
    const tripIndex = Number(api.value(3));
    const tripCount = Number(api.value(4));
    const startPoint = api.coord([day, start]);
    const endPoint = api.coord([day, end]);
    const offset = (tripIndex - (tripCount - 1) / 2) * 7;
    return {
      type: 'rect',
      shape: {x: startPoint[0] + offset - 3, y: startPoint[1], width: 6, height: Math.max(3, endPoint[1] - startPoint[1]), r: 3},
      style: api.style(),
    };
  };
  const option = {
    backgroundColor: 'transparent',
    color: ['#0a84ff'],
    grid: {left: 52, right: 18, top: 42, bottom: 38, containLabel: true},
    tooltip: {
      trigger: 'item',
      formatter: (item: {marker: string; value: [number, number, number, number, number]}) => `${item.marker}行程 ${item.value[3] + 1}<br/>${minuteToLabel(item.value[1])}–${minuteToLabel(item.value[2])} · ${formatNumber(item.value[2] - item.value[1], 0)} 分钟`,
    },
    xAxis: {type: 'category', data: points.map((point) => point.date), axisTick: {show: false}, axisLabel: {formatter: (date: string) => date.slice(5), color: '#6b7280'}},
    yAxis: {type: 'value', inverse: true, min, max, interval: 60, name: '时间', nameTextStyle: {color: '#6b7280'}, axisLabel: {formatter: (value: number) => minuteToLabel(value), color: '#6b7280'}, splitLine: {lineStyle: {color: 'rgba(107,114,128,.14)'}}},
    series: [
      {name: '上下车区间', type: 'custom', renderItem: renderRange, encode: {x: 0, y: [1, 2]}, data: points.flatMap((point, dayIndex) => point.trips.map((trip, tripIndex) => [dayIndex, trip.start, trip.end, tripIndex, point.trips.length]))},
    ],
  };
  return <ReactECharts option={option} style={{height: 320, width: '100%'}} opts={{renderer: 'canvas'}} notMerge />;
}

function DailyBasicInfo({date, weather}: {date: string; weather: unknown}): React.ReactNode {
  if (!date) return null;
  const weatherSummary = getWeatherSummary(weather);
  const weatherKind = getWeatherKind(weatherSummary.description);
  const weekdayLabel = getWeekdayLabel(date).replace(/^星期/, '周');
  const holidayLabel = getHolidayLabel(date);
  const weatherMetrics = [
    ['体感', weatherSummary.feelsLike.replace(/^体感\s*/, '')],
    ['湿度', weatherSummary.humidity.replace(/^湿度\s*/, '')],
    ['风速', weatherSummary.wind.replace(/^最大风速\s*/, '')],
    ['降水', weatherSummary.precip.replace(/^降水\s*/, '')],
  ].filter(([, value]) => Boolean(value));

  return (
    <section className={styles.dailyBasicInfo}>
      <div className={styles.dailyDateBlock}>
        <strong>{formatChineseDate(date)}（{weekdayLabel}，{holidayLabel}）</strong>
      </div>
      <div className={`${styles.dailyWeather} ${styles[`dailyWeather_${weatherKind}`]}`}>
        <div className={styles.weatherIcon} aria-hidden="true">
          <span />
          <i />
        </div>
        <div className={styles.weatherMain}>
          <strong>{weatherSummary.area} · {weatherSummary.description}</strong>
          <span>{weatherSummary.temperature}</span>
        </div>
        <div className={styles.weatherMetrics}>
          {weatherMetrics.map(([label, value]) => (
            <small key={label}>
              <em>{label}</em>
              <b>{value}</b>
            </small>
          ))}
        </div>
      </div>
    </section>
  );
}

function DailyYearHeatmap({
  year,
  selectedDate,
  dailyDates,
  analysisDates,
  onDateSelect,
}: {
  year: number;
  selectedDate: string;
  dailyDates: Set<string>;
  analysisDates: Set<string>;
  onDateSelect: (date: string) => void;
}): React.ReactNode {
  const {colorMode} = useColorMode();
  const isDark = colorMode === 'dark';
  const today = formatDateKey(new Date());
  const yearProgress = getYearProgress(selectedDate);
  const diaryColor = isDark ? '#64d2ff' : '#0a84ff';
  const analysisColor = isDark ? '#fbbf24' : '#d97706';
  const completeColor = isDark ? '#4ade80' : '#16a34a';
  const pastEmptyColor = isDark ? 'rgba(148, 163, 184, 0.24)' : 'rgba(100, 116, 139, 0.18)';
  const futureColor = isDark ? 'rgba(148, 163, 184, 0.08)' : 'rgba(100, 116, 139, 0.08)';
  const mutedLabelColor = isDark ? 'rgba(226, 232, 240, 0.68)' : 'rgba(51, 65, 85, 0.62)';
  const {values, diaryOnlyDays, analysisOnlyDays, completeDays, emptyDays, futureDays} = useMemo(() => {
    const days = daysInYear(year);
    const today = formatDateKey(new Date());
    let diaryOnlyCount = 0;
    let analysisOnlyCount = 0;
    let completeCount = 0;
    let emptyCount = 0;
    let futureCount = 0;
    const data = days.map((date) => {
      const hasDaily = dailyDates.has(date);
      const hasAnalysis = analysisDates.has(date);
      const isElapsed = date <= today;
      let state = 0;
      if (!isElapsed) {
        futureCount += 1;
      } else if (hasDaily && hasAnalysis) {
        state = 4;
        completeCount += 1;
      } else if (hasDaily) {
        state = 3;
        diaryOnlyCount += 1;
      } else if (hasAnalysis) {
        state = 2;
        analysisOnlyCount += 1;
      } else {
        state = 1;
        emptyCount += 1;
      }
      const day = Number(date.slice(8, 10));
      const month = Number(date.slice(5, 7));
      const lastDayOfMonth = new Date(year, month, 0).getDate();
      const isSelected = date === selectedDate;
      const isToday = date === today;
      const shouldShowDayNumber = isElapsed && (isSelected || isToday || day === 1 || day === 15 || day === lastDayOfMonth);
      return {
        value: [date, state],
        itemStyle: !isElapsed ? {
          decal: {
            symbol: 'rect',
            dashArrayX: [1, 0],
            dashArrayY: [1, 7],
            rotation: Math.PI / 4,
            color: isDark ? 'rgba(148, 163, 184, 0.1)' : 'rgba(100, 116, 139, 0.08)',
          },
        } : undefined,
        label: shouldShowDayNumber ? {
          show: true,
          formatter: String(day),
          color: state >= 2 ? '#ffffff' : isSelected || isToday ? diaryColor : mutedLabelColor,
          fontSize: isSelected || isToday ? 7 : 6,
          fontWeight: isSelected || isToday ? 900 : 760,
          textBorderColor: state >= 2 ? (isDark ? 'rgba(2, 6, 23, 0.32)' : 'rgba(15, 23, 42, 0.24)') : 'transparent',
          textBorderWidth: state >= 2 ? 1.2 : 0,
        } : undefined,
        disabled: !isElapsed,
      };
    });

    return {
      values: data,
      diaryOnlyDays: diaryOnlyCount,
      analysisOnlyDays: analysisOnlyCount,
      completeDays: completeCount,
      emptyDays: emptyCount,
      futureDays: futureCount,
    };
  }, [analysisDates, dailyDates, diaryColor, isDark, mutedLabelColor, selectedDate, year]);
  const option = useMemo(() => ({
    backgroundColor: 'transparent',
    visualMap: {
      type: 'piecewise',
      show: false,
      dimension: 1,
      pieces: [
        {value: 4, label: '日记与分析', color: completeColor},
        {value: 3, label: '仅日记', color: diaryColor},
        {value: 2, label: '仅分析', color: analysisColor},
        {value: 1, label: '过去无记录', color: pastEmptyColor},
        {value: 0, label: '未来', color: futureColor},
      ],
    },
    tooltip: {
      trigger: 'item',
      formatter: (params: {value?: [string, number]}) => {
        const date = params.value?.[0] || '';
        const hasDaily = dailyDates.has(date);
        const hasAnalysis = analysisDates.has(date);
        const state = date > today
          ? '未来'
          : hasDaily && hasAnalysis
            ? '日记与 AI 分析完整'
            : hasDaily
              ? '仅有日记'
              : hasAnalysis
                ? '仅有 AI 分析'
                : '暂无记录';
        return `<b>${formatChineseDate(date)}</b><br/>${state}`;
      },
    },
    calendar: {
      top: 18,
      left: 28,
      right: 8,
      bottom: 2,
      range: `${year}`,
      cellSize: ['auto', 10],
      splitLine: {lineStyle: {color: isDark ? 'rgba(148, 163, 184, 0.12)' : 'rgba(100, 116, 139, 0.12)', width: 0.7}},
      itemStyle: {borderWidth: 0.5, borderColor: isDark ? 'rgba(148, 163, 184, 0.16)' : 'rgba(100, 116, 139, 0.16)'},
      yearLabel: {show: false},
      monthLabel: {color: isDark ? '#94a3b8' : '#64748b', fontSize: 8, margin: 4, nameMap: MONTH_LABELS.map((label) => label.replace('月', ''))},
      dayLabel: {color: isDark ? '#94a3b8' : '#64748b', fontSize: 8, firstDay: 1, nameMap: ['日', '一', '二', '三', '四', '五', '六']},
    },
    series: [{
      type: 'heatmap',
      coordinateSystem: 'calendar',
      data: values,
      label: {
        show: false,
      },
      emphasis: {
        itemStyle: {
          shadowBlur: 6,
          shadowColor: isDark ? 'rgba(100, 210, 255, 0.3)' : 'rgba(10, 132, 255, 0.25)',
        },
      },
      markPoint: selectedDate ? {
        symbol: 'roundRect',
        symbolSize: 10,
        itemStyle: {color: 'transparent', borderColor: isDark ? '#64d2ff' : '#0a84ff', borderWidth: 2},
        data: [{coord: [selectedDate]}],
        label: {show: false},
        silent: true,
      } : undefined,
    }],
  }), [analysisColor, analysisDates, completeColor, dailyDates, diaryColor, futureColor, isDark, pastEmptyColor, selectedDate, today, values, year]);
  const onEvents = {
    click: (params: {value?: [string, number]; data?: {disabled?: boolean}}) => {
      const date = params.value?.[0];
      if (date && !params.data?.disabled) onDateSelect(date);
    },
  };

  return (
    <section className={styles.dailyYearHeatmap} aria-label={`${year} 年复盘记录`}>
      <div className={styles.dailyYearHeatmapHead}>
        <strong>{year} 年记录</strong>
        <div className={styles.dailyYearHeatmapProgress}>
          <span>
            年度进度 {formatPercent(yearProgress)}
          </span>
          <i><b style={{width: `${yearProgress}%`}} /></i>
        </div>
      </div>
      <BrowserOnly fallback={<div className={styles.dailyYearHeatmapChart} />}>
        {() => (
          <ReactECharts
            option={option}
            style={{height: 104, width: '100%'}}
            opts={{renderer: 'canvas'}}
            notMerge
            lazyUpdate
            onEvents={onEvents}
          />
        )}
      </BrowserOnly>
      <div className={styles.dailyYearHeatmapLegend}>
        <span>{completeDays} 天完整 · {diaryOnlyDays} 天仅日记 · {analysisOnlyDays} 天仅分析 · {emptyDays} 天无记录 · {futureDays} 天未到来</span>
        <span><i className={styles.dailyYearHeatmapLegendComplete} />完整</span>
        <span><i className={styles.dailyYearHeatmapLegendDiary} />仅日记</span>
        <span><i className={styles.dailyYearHeatmapLegendAnalysis} />仅分析</span>
        <span><i className={styles.dailyYearHeatmapLegendPastEmpty} />无记录</span>
        <span><i className={styles.dailyYearHeatmapLegendFuture} />未来</span>
      </div>
    </section>
  );
}

function ReviewPeriodControls({
  period,
  onChange,
}: {
  period: ReviewPeriod;
  onChange: (kind: ReviewPeriodKind) => void;
}): React.ReactNode {
  const kinds = Object.keys(REVIEW_PERIOD_LABELS) as ReviewPeriodKind[];

  return (
    <div className={styles.objectiveTimeControls} role="tablist" aria-label="查看范围">
      <div className={styles.objectiveTimeOptions}>
        {kinds.map((kind) => (
          <button
            key={kind}
            type="button"
            role="tab"
            id={`review-period-tab-${kind}`}
            aria-controls="review-period-panel"
            aria-selected={period.kind === kind}
            tabIndex={period.kind === kind ? 0 : -1}
            className={period.kind === kind ? styles.objectiveTimeActive : ''}
            onClick={() => onChange(kind)}
            onKeyDown={(event) => handleTabKey(event, kinds, period.kind, onChange)}
          >
            {REVIEW_PERIOD_LABELS[kind]}
          </button>
        ))}
      </div>
    </div>
  );
}

function PeriodNavigator({
  period,
  latestDate,
  onChange,
}: {
  period: DatedReviewPeriod;
  latestDate?: string;
  onChange: (period: DatedReviewPeriod) => void;
}): React.ReactNode {
  const today = formatDateKey(new Date());
  if (period.kind === 'day') {
    return (
      <DateNavigator
        date={period.key}
        latestDate={latestDate}
        onChange={(date) => onChange({kind: 'day', key: date})}
      />
    );
  }

  const previous = shiftReviewPeriod(period, -1);
  const next = shiftReviewPeriod(period, 1);
  const current = periodFromAnchor(period.kind, today);
  const unit = REVIEW_PERIOD_LABELS[period.kind];
  const nextDisabled = isFutureReviewPeriod(next);
  const currentLabel = period.kind === 'week' ? '本周' : period.kind === 'month' ? '本月' : '今年';
  const years = Array.from(
    {length: Number(today.slice(0, 4)) - REVIEW_START_YEAR + 1},
    (_, index) => Number(today.slice(0, 4)) - index,
  );

  return (
    <div className={styles.dateNavigator} aria-label={`选择复盘${unit}`}>
      <button
        type="button"
        className={styles.dateStepButton}
        aria-label={`上一${unit}`}
        title={`上一${unit}`}
        onClick={() => onChange(previous)}
      >
        <span aria-hidden="true">←</span>
      </button>
      {period.kind === 'week' ? (
        <input
          type="week"
          value={period.key}
          max={getIsoWeekKey(today)}
          aria-label="选择复盘周"
          onChange={(event) => event.target.value && onChange({kind: 'week', key: event.target.value})}
        />
      ) : null}
      {period.kind === 'month' ? (
        <input
          type="month"
          value={period.key}
          max={today.slice(0, 7)}
          aria-label="选择复盘月"
          onChange={(event) => event.target.value && onChange({kind: 'month', key: event.target.value})}
        />
      ) : null}
      {period.kind === 'year' ? (
        <select
          value={period.key}
          aria-label="选择复盘年"
          onChange={(event) => onChange({kind: 'year', key: event.target.value})}
        >
          {years.map((year) => <option key={year} value={year}>{year} 年</option>)}
        </select>
      ) : null}
      <button
        type="button"
        className={styles.dateStepButton}
        aria-label={`下一${unit}`}
        title={`下一${unit}`}
        disabled={nextDisabled}
        onClick={() => !nextDisabled && onChange(next)}
      >
        <span aria-hidden="true">→</span>
      </button>
      <button type="button" disabled={period.key === current.key} onClick={() => onChange(current)}>
        {currentLabel}
      </button>
    </div>
  );
}

function HealthChartsPanel({
  selectedChartIds,
  onChartToggle,
}: {
  selectedChartIds: string[];
  onChartToggle: (item: ChartNavItem | ChartNavItem[]) => void;
}): React.ReactNode {
  const [activeSection, setActiveSection] = useState(HEALTH_CHART_NAV[0]?.title || '体重');
  const handleSectionChange = (sectionTitle: string) => {
    setActiveSection(sectionTitle);
    const charts = HEALTH_CHART_NAV.find((section) => section.title === sectionTitle)?.charts || [];
    if (charts.length) onChartToggle(charts);
  };

  return (
    <>
      <HealthChartSubtabs
        activeSection={activeSection}
        onSectionChange={handleSectionChange}
      />
      <div
        id="health-section-panel"
        className={styles.healthChartsGrid}
        aria-label="已选健康图表"
      >
        <section className={styles.healthChartSection}>
          <HealthChartSelection chartIds={selectedChartIds} />
        </section>
      </div>
    </>
  );
}

const CAREER_CHART_NAV = [
  {id: 'career-ai-tokens', label: 'AI 使用'},
  {id: 'career-git', label: 'Git 推进'},
];

const LIFE_CHART_NAV = [
  {id: 'life-reading-time', label: '阅读时长'},
  {id: 'life-rhythm', label: '生活节奏'},
  {id: 'life-drive-time', label: '上下车时间'},
];

function CareerDataPanel({
  selectedDate,
  onDateSelect,
  timeScope,
}: {
  selectedDate?: string;
  onDateSelect: (date: string) => void;
  timeScope: ObjectiveTimeScope;
}): React.ReactNode {
  const [llmPayloads, setLlmPayloads] = useState<Array<{id: string; label: string; payload: LLMSummaryPayload}>>([]);
  const [analyses, setAnalyses] = useState<Record<string, DailyAnalysis>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [llmLoaded, manifest] = await Promise.all([
        Promise.all(LLM_VENDOR_CONFIGS.map(async (vendor) => {
          const payload = await fetchJson<LLMSummaryPayload>(vendor.path);
          return payload ? {id: vendor.id, label: vendor.label, payload} : null;
        })),
        fetchJson<Manifest>('/data/daily-analysis/index.json'),
      ]);
      const dates = getScopedAvailableDates(timeScope, manifest?.dates || [], selectedDate);
      const analysisList = await mapWithConcurrency(dates, 4, async (date) => {
        const analysis = await fetchDailyAnalysis(date);
        return analysis ? [date, analysis] as const : null;
      });
      if (cancelled) return;
      setLlmPayloads(llmLoaded.filter((item): item is {id: string; label: string; payload: LLMSummaryPayload} => Boolean(item)));
      setAnalyses((previous) => ({
        ...previous,
        ...Object.fromEntries(analysisList.filter((item): item is readonly [string, DailyAnalysis] => Boolean(item))),
      }));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedDate, timeScope]);

  const allDates = useMemo(() => {
    const dates = new Set<string>(Object.keys(analyses));
    llmPayloads.forEach((vendor) => Object.keys(vendor.payload.daily_token_usage || {}).forEach((date) => dates.add(date)));
    return [...dates].sort();
  }, [analyses, llmPayloads]);
  const axisDates = useMemo(() => getScopeDates(timeScope, allDates, selectedDate), [allDates, selectedDate, timeScope]);
  const tokenPoints = useMemo<TokenStackPoint[]>(() => axisDates.map((date) => {
    const [minimax, openai, anthropic] = LLM_VENDOR_CONFIGS.map((vendor) =>
      Number(llmPayloads.find((item) => item.id === vendor.id)?.payload.daily_token_usage?.[date] || 0));
    return {
      date,
      minimax,
      openai,
      anthropic,
    };
  }), [axisDates, llmPayloads]);
  const gitPoints = useMemo<ObjectivePoint[]>(() => axisDates.map((date) => {
    const counts = parseGitCounts(analyses[date]);
    return {date, value: counts.auto, secondary: counts.manual, tertiary: counts.total};
  }), [analyses, axisDates]);
  const totalTokens = tokenPoints.reduce((sum, point) => sum + point.minimax + point.openai + point.anthropic, 0);
  const activeAiDays = tokenPoints.filter((point) => point.minimax + point.openai + point.anthropic > 0).length;
  const manualCommits = gitPoints.reduce((sum, point) => sum + Number(point.secondary || 0), 0);
  const totalCommits = gitPoints.reduce((sum, point) => sum + Number(point.tertiary || 0), 0);

  return (
    <>
      <DomainSubtabs items={CAREER_CHART_NAV} />
      <div className={styles.objectiveChartStack}>
        <ObjectiveStatGrid
          items={[
            {value: formatCompactNumber(totalTokens, 1), label: `${scopeLabel(timeScope)} AI token`, tone: 'accent'},
            {value: activeAiDays, label: 'AI 活跃天数', tone: 'green'},
            {value: manualCommits, label: '人工推进提交', tone: 'orange'},
            {value: totalCommits ? `${formatNumber((manualCommits / totalCommits) * 100, 0)}%` : '0%', label: '人工提交占比'},
          ]}
        />
        <ObjectiveChartCard
          id="career-ai-tokens"
          title="AI 使用强度"
          meta={loading ? '加载中' : `${scopeLabel(timeScope)} · 平台 token 堆叠`}
          legend={[
            {label: 'MiniMax', className: styles.legendPrimary},
            {label: 'OpenAI', className: styles.legendSecondary},
            {label: 'Anthropic', className: styles.legendTertiary},
          ]}
        >
          <TokenStackedBarChart
            points={tokenPoints}
            selectedDate={selectedDate}
            onDateSelect={onDateSelect}
          />
        </ObjectiveChartCard>
        <ObjectiveChartCard
          id="career-git"
          title="Git 推进结构"
          meta="从每日 AI 分析中抽取 commit 总量、自动同步与人工推进"
          legend={[
            {label: '自动同步', className: styles.legendPrimary},
            {label: '人工推进', className: styles.legendLine},
            {label: '总提交', className: styles.legendTertiary},
          ]}
        >
          <ObjectiveBarLineChart
            points={gitPoints}
            valueLabel="自动同步"
            secondaryLabel="人工推进"
            tertiaryLabel="总提交"
            selectedDate={selectedDate}
            onDateSelect={onDateSelect}
          />
        </ObjectiveChartCard>
      </div>
    </>
  );
}

function FinanceDataPanel({
  date,
  onDateSelect,
  timeScope,
}: {
  date?: string;
  onDateSelect: (date: string) => void;
  timeScope: ObjectiveTimeScope;
}): React.ReactNode {
  const [activeTab, setActiveTab] = useState<FinanceTab>('investment');
  const effectiveDate = date || formatDateKey(new Date());

  return (
    <>
      <FinanceTabs active={activeTab} onChange={setActiveTab} />
      <div
        id="finance-tab-panel"
        className={styles.financeTabPanel}
        role="tabpanel"
        aria-labelledby={`finance-tab-${activeTab}`}
      >
        {activeTab === 'income' ? (
          <div className={styles.financeEmptyPanel}>
            <strong>收入数据</strong>
            <p>暂未接入收入流水数据。</p>
          </div>
        ) : null}
        {activeTab === 'expense' ? (
          <div className={styles.financeEmptyPanel}>
            <strong>支出数据</strong>
            <p>暂未接入支出流水数据。</p>
          </div>
        ) : null}
        {activeTab === 'investment' ? (
          <div className={styles.embeddedDashboardStack}>
            <section className={styles.embeddedDashboardSection}>
              <h2>总资产趋势</h2>
              <FinanceAssetsTrend date={effectiveDate} onDateSelect={onDateSelect} timeScope={timeScope} />
            </section>
            <section className={styles.embeddedDashboardSection}>
              <h2>投资持仓</h2>
              <AlipayInvestDashboard date={effectiveDate} timeScope={timeScope} />
            </section>
            <section className={styles.embeddedDashboardSection}>
              <h2>指数账户</h2>
              <AccountAssetsDashboard date={effectiveDate} dataUrl="/data/account-assets/index.json" onDateSelect={onDateSelect} timeScope={timeScope} compact />
            </section>
            <section className={styles.embeddedDashboardSection}>
              <h2>个股账户</h2>
              <AccountAssetsDashboard date={effectiveDate} dataUrl="/data/account-assets/stock.json" onDateSelect={onDateSelect} timeScope={timeScope} compact />
            </section>
            <section className={styles.embeddedDashboardSection}>
              <h2>港股打新</h2>
              <HKIPOCharts date={effectiveDate} dataUrl="/data/hk-ipo/data.json" onDateSelect={onDateSelect} timeScope={timeScope} compact />
            </section>
          </div>
        ) : null}
      </div>
    </>
  );
}

function LifeDataPanel({
  selectedDate,
  onDateSelect,
  timeScope,
}: {
  selectedDate?: string;
  onDateSelect: (date: string) => void;
  timeScope: ObjectiveTimeScope;
}): React.ReactNode {
  const [readingDaily, setReadingDaily] = useState<Record<string, number>>({});
  const [dailyDates, setDailyDates] = useState<string[]>([]);
  const [analysisDates, setAnalysisDates] = useState<string[]>([]);
  const [analyses, setAnalyses] = useState<Record<string, DailyAnalysis>>({});
  const [driveSummaries, setDriveSummaries] = useState<Record<string, DriveDaySummary>>({});
  const [loading, setLoading] = useState(true);
  const anchorYear = (selectedDate || formatDateKey(new Date())).slice(0, 4);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [readingIndex, dailyManifest, analysisManifest, driveManifest] = await Promise.all([
        fetchJson<{activeYears?: string[]; exportedAt?: string}>('/data/reading/index.json'),
        fetchJson<Manifest>('/data/daily/index.json'),
        fetchJson<Manifest>('/data/daily-analysis/index.json'),
        fetchJson<Manifest>('/data/drive/index.json'),
      ]);
      const activeYears = readingIndex?.activeYears || [];
      const requestedYears = timeScope.mode === 'all'
        ? activeYears
        : timeScope.mode === 'year'
          ? activeYears.filter((year) => Number(year) === timeScope.year)
          : timeScope.mode === 'period'
            ? activeYears.filter((year) => year >= timeScope.start.slice(0, 4) && year <= timeScope.end.slice(0, 4))
          : activeYears.filter((year) => year === anchorYear);
      const readingYears = await Promise.all(requestedYears.map(async (year) =>
        fetchJson<ReadingYearPayload>(`/data/reading/${year}.json`)));
      const mergedReading: Record<string, number> = {};
      readingYears.forEach((yearData) => {
        Object.entries(yearData?.daily || {}).forEach(([date, value]) => {
          mergedReading[date] = (mergedReading[date] || 0) + Number(value.seconds || 0);
        });
      });
      const allAnalysisDates = analysisManifest?.dates || [];
      const dates = getScopedAvailableDates(timeScope, allAnalysisDates, selectedDate);
      const analysisList = await mapWithConcurrency(dates, 4, async (date) => {
        const analysis = await fetchDailyAnalysis(date);
        return analysis ? [date, analysis] as const : null;
      });
      const driveDates = getScopedAvailableDates(timeScope, driveManifest?.dates || [], selectedDate);
      const driveList = await mapWithConcurrency(driveDates, 4, async (date) => {
        const log = await fetchJson<DriveLog>(`/data/drive/${dateToPath(date, 'json')}`);
        return log ? [date, summarizeDriveLog(log)] as const : null;
      });
      if (cancelled) return;
      setReadingDaily((previous) => ({...previous, ...mergedReading}));
      setDailyDates(dailyManifest?.dates || []);
      setAnalysisDates(allAnalysisDates);
      setDriveSummaries((previous) => ({...previous, ...Object.fromEntries(driveList.filter((item): item is readonly [string, DriveDaySummary] => Boolean(item)))}));
      setAnalyses((previous) => ({
        ...previous,
        ...Object.fromEntries(analysisList.filter((item): item is readonly [string, DailyAnalysis] => Boolean(item))),
      }));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [anchorYear, selectedDate, timeScope]);

  const allDates = useMemo(() => [...new Set([...Object.keys(readingDaily), ...dailyDates, ...analysisDates, ...Object.keys(driveSummaries)])].sort(), [analysisDates, dailyDates, driveSummaries, readingDaily]);
  const axisDates = useMemo(() => getScopeDates(timeScope, allDates, selectedDate), [allDates, selectedDate, timeScope]);
  const dailyDateSet = useMemo(() => new Set(dailyDates), [dailyDates]);
  const analysisDateSet = useMemo(() => new Set(analysisDates), [analysisDates]);
  const readingPoints = useMemo<ObjectivePoint[]>(() => axisDates.map((date) => ({
    date,
    value: Number(readingDaily[date] || 0),
    secondary: dailyDateSet.has(date) ? 1 : 0,
  })), [axisDates, dailyDateSet, readingDaily]);
  const rhythmPoints = useMemo<ObjectivePoint[]>(() => axisDates.map((date) => ({
    date,
    value: dailyDateSet.has(date) ? 1 : 0,
    secondary: analysisDateSet.has(date) ? getAnalysisCompleteness(analyses[date]) : 0,
  })), [analyses, analysisDateSet, axisDates, dailyDateSet]);
  const driveTimePoints = useMemo(() => axisDates.flatMap((date) => {
    const summary = driveSummaries[date];
    return summary?.tripRanges.length ? [{date, trips: summary.tripRanges}] : [];
  }), [axisDates, driveSummaries]);
  const totalReadSeconds = readingPoints.reduce((sum, point) => sum + point.value, 0);
  const readingDays = readingPoints.filter((point) => point.value > 0).length;
  const diaryDays = rhythmPoints.filter((point) => point.value > 0).length;
  const analysisDays = rhythmPoints.filter((point) => Number(point.secondary || 0) > 0).length;

  return (
    <>
      <DomainSubtabs items={LIFE_CHART_NAV} />
      <div className={styles.objectiveChartStack}>
        <ObjectiveStatGrid
          items={[
            {value: formatHoursFromSeconds(totalReadSeconds), label: `${scopeLabel(timeScope)} 阅读时长`, tone: 'accent'},
            {value: readingDays, label: '阅读天数', tone: 'green'},
            {value: diaryDays, label: '公开日记天数', tone: 'orange'},
            {value: analysisDays, label: 'AI 分析天数'},
          ]}
        />
        <ObjectiveChartCard
          id="life-reading-time"
          title="阅读投入"
          meta={loading ? '加载中' : '柱为阅读时长，线为公开日记是否存在'}
          legend={[
            {label: '阅读时长', className: styles.legendPrimary},
            {label: '日记', className: styles.legendLine},
          ]}
        >
          <ObjectiveBarLineChart
            points={readingPoints}
            valueLabel="阅读"
            secondaryLabel="日记"
            formatValue={formatHoursFromSeconds}
            formatSecondary={(value) => value ? '有' : '无'}
            selectedDate={selectedDate}
            onDateSelect={onDateSelect}
          />
        </ObjectiveChartCard>
        <ObjectiveChartCard
          id="life-drive-time"
          title="上下车时间"
          meta="每段柱表示一次上车–下车区间；仅展示成功配对的完整行程"
        >
          <DriveTimeChart points={driveTimePoints} />
        </ObjectiveChartCard>
        <ObjectiveChartCard
          id="life-rhythm"
          title="生活记录节奏"
          meta="日记与 AI 分析完整度，用来观察输入、记录、复盘是否闭环"
          legend={[
            {label: '日记', className: styles.legendPrimary},
            {label: '分析完整度', className: styles.legendLine},
          ]}
        >
          <ObjectiveBarLineChart
            points={rhythmPoints}
            valueLabel="日记"
            secondaryLabel="分析完整度"
            selectedDate={selectedDate}
            onDateSelect={onDateSelect}
          />
        </ObjectiveChartCard>
      </div>
    </>
  );
}

type CompareMode = 'relative' | 'zscore' | 'raw';
type CompareMetric = {
  id: string;
  domain: '健康' | '事业' | '财务' | '生活';
  label: string;
  unit: string;
  aggregate: 'average' | 'sum';
  values: Map<string, number>;
};

const COMPARE_COLORS = ['#0a84ff', '#16a34a', '#f59e0b', '#db2777'];
const COMPARE_PRESETS = [
  {label: '恢复与工作', ids: ['health-sleep-score', 'health-hrv', 'health-rhr', 'career-ai']},
  {label: '活动与情绪', ids: ['health-steps', 'health-exercise', 'health-daylight', 'health-mood']},
  {label: '工作与生活', ids: ['career-ai', 'life-reading', 'life-diary', 'health-sleep']},
  {label: '资产结构', ids: ['finance-index', 'finance-stock', 'finance-alipay', 'finance-caitong']},
];

function seriesMap(points: Array<[string, number]> | undefined): Map<string, number> {
  return new Map((points || []).filter(([, value]) => Number.isFinite(value)));
}

function averageSeries(points: Array<[string, number]>): Map<string, number> {
  const grouped = new Map<string, number[]>();
  points.forEach(([date, value]) => grouped.set(date, [...(grouped.get(date) || []), value]));
  return new Map([...grouped].map(([date, values]) => [date, values.reduce((sum, value) => sum + value, 0) / values.length]));
}

function dateBucket(date: string, monthly: boolean): string {
  return monthly ? `${date.slice(0, 7)}-01` : date;
}

function aggregateMetric(metric: CompareMetric, monthly: boolean): Map<string, number> {
  const buckets = new Map<string, number[]>();
  metric.values.forEach((value, date) => {
    const key = dateBucket(date, monthly);
    buckets.set(key, [...(buckets.get(key) || []), value]);
  });
  return new Map([...buckets].map(([date, values]) => [
    date,
    metric.aggregate === 'sum'
      ? values.reduce((total, value) => total + value, 0)
      : values.reduce((total, value) => total + value, 0) / values.length,
  ]));
}

function pearsonCorrelation(left: number[], right: number[]): number | null {
  if (left.length !== right.length || left.length < 2) return null;
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let leftSquared = 0;
  let rightSquared = 0;
  left.forEach((value, index) => {
    const leftDelta = value - leftMean;
    const rightDelta = right[index] - rightMean;
    numerator += leftDelta * rightDelta;
    leftSquared += leftDelta ** 2;
    rightSquared += rightDelta ** 2;
  });
  const denominator = Math.sqrt(leftSquared * rightSquared);
  return denominator ? numerator / denominator : null;
}

function percentile(values: number[], ratio: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * ratio;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function CrossDomainComparison({timeScope, selectedDate}: {timeScope: ObjectiveTimeScope; selectedDate?: string}) {
  const {colorMode} = useColorMode();
  const [metrics, setMetrics] = useState<CompareMetric[]>([]);
  const [selectedIds, setSelectedIds] = useState(['health-steps', 'health-weight', 'career-ai', 'finance-assets']);
  const [mode, setMode] = useState<CompareMode>('zscore');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const [health, llmPayloads, readingIndex, investManifest, indexAccount, stockAccount, dailyManifest, analysisManifest, driveManifest] = await Promise.all([
        loadHealthChartHistory(),
        Promise.all(LLM_VENDOR_CONFIGS.map((vendor) => fetchJson<LLMSummaryPayload>(vendor.path))),
        fetchJson<{activeYears?: string[]}>('/data/reading/index.json'),
        fetchJson<InvestManifest>('/data/invest/index.json'),
        fetchJson<AccountHistoryPayload>('/data/account-assets/index.json'),
        fetchJson<AccountHistoryPayload>('/data/account-assets/stock.json'),
        fetchJson<Manifest>('/data/daily/index.json'),
        fetchJson<Manifest>('/data/daily-analysis/index.json'),
        fetchJson<Manifest>('/data/drive/index.json'),
      ]);
      const activeYears = readingIndex?.activeYears || [];
      const readingPayloads = await Promise.all(activeYears.map((year) => fetchJson<ReadingYearPayload>(`/data/reading/${year}.json`)));
      const investEntries = await Promise.all((investManifest?.dates || []).map(async (date) => {
        const [year, month, day] = date.split('-');
        const [alipay, caitong] = await Promise.all([
          fetchJson<InvestAssetPayload>(`/data/invest/${year}/${month}/${day}/alipay.json`),
          fetchJson<InvestAssetPayload>(`/data/invest/${year}/${month}/${day}/caitong.json`),
        ]);
        return {date, alipay: investTotalAssets(alipay), caitong: investTotalAssets(caitong)};
      }));
      const driveEntries = await mapWithConcurrency(driveManifest?.dates || [], 4, async (date) => {
        const log = await fetchJson<DriveLog>(`/data/drive/${dateToPath(date, 'json')}`);
        return log ? [date, summarizeDriveLog(log)] as const : null;
      });
      if (cancelled) return;

      const tokenValues = new Map<string, number>();
      llmPayloads.forEach((payload) => Object.entries(payload?.daily_token_usage || {}).forEach(([date, value]) => {
        tokenValues.set(date, (tokenValues.get(date) || 0) + Number(value || 0));
      }));
      const vendorTokenValues = LLM_VENDOR_CONFIGS.map((vendor, index) => ({
        id: vendor.id,
        label: vendor.label,
        values: new Map(Object.entries(llmPayloads[index]?.daily_token_usage || {}).map(([date, value]) => [date, Number(value || 0)])),
      }));
      const readingValues = new Map<string, number>();
      readingPayloads.forEach((payload) => Object.entries(payload?.daily || {}).forEach(([date, value]) => {
        readingValues.set(date, (readingValues.get(date) || 0) + Number(value.seconds || 0) / 3600);
      }));
      const accountMaps = [indexAccount, stockAccount].map((payload) => new Map(
        (payload?.portfolio?.history || []).flatMap((point) => {
          const date = accountPointDate(point);
          return date && typeof point.totalAssets === 'number' ? [[date, point.totalAssets] as const] : [];
        }),
      ));
      accountMaps.push(new Map(investEntries.flatMap(({date, alipay}) => typeof alipay === 'number' ? [[date, alipay] as const] : [])));
      accountMaps.push(new Map(investEntries.flatMap(({date, caitong}) => typeof caitong === 'number' ? [[date, caitong] as const] : [])));
      const financeDates = [...new Set(accountMaps.flatMap((map) => [...map.keys()]))].sort();
      const latestValues = accountMaps.map(() => 0);
      const assetValues = new Map<string, number>();
      financeDates.forEach((date) => {
        accountMaps.forEach((map, index) => {
          const value = map.get(date);
          if (typeof value === 'number') latestValues[index] = value;
        });
        if (latestValues.every((value) => value > 0)) assetValues.set(date, latestValues.reduce((sum, value) => sum + value, 0));
      });
      const healthData = health as HealthData | null;
      const moodValues = averageSeries((healthData?.state_of_mind || []).map(([date, value]) => [date, value]));
      const diaryValues = new Map((dailyManifest?.dates || []).map((date) => [date, 1]));
      const analysisValues = new Map((analysisManifest?.dates || []).map((date) => [date, 1]));
      const driveMinutes = new Map(driveEntries.flatMap((item) => item ? [[item[0], item[1].minutes] as const] : []));
      const driveTrips = new Map(driveEntries.flatMap((item) => item ? [[item[0], item[1].trips] as const] : []));
      setMetrics([
        {id: 'health-steps', domain: '健康', label: '每日步数', unit: '步', aggregate: 'average', values: seriesMap(healthData?.steps)},
        {id: 'health-weight', domain: '健康', label: '体重', unit: '斤', aggregate: 'average', values: new Map((healthData?.weight || []).map(([date, value]) => [date, value * 2]))},
        {id: 'health-fat', domain: '健康', label: '体脂率', unit: '%', aggregate: 'average', values: seriesMap(healthData?.fat)},
        {id: 'health-exercise', domain: '健康', label: '运动时长', unit: '分钟', aggregate: 'average', values: seriesMap(healthData?.exercise)},
        {id: 'health-sleep', domain: '健康', label: '睡眠时长', unit: '小时', aggregate: 'average', values: new Map((healthData?.sleep || []).map(([date, total]) => [date, total]))},
        {id: 'health-sleep-score', domain: '健康', label: '睡眠评分', unit: '分', aggregate: 'average', values: new Map((healthData?.sleep_score || []).map(([date, score]) => [date, score]))},
        {id: 'health-hrv', domain: '健康', label: 'HRV', unit: 'ms', aggregate: 'average', values: seriesMap(healthData?.hrv)},
        {id: 'health-rhr', domain: '健康', label: '静息心率', unit: 'bpm', aggregate: 'average', values: seriesMap(healthData?.rhr)},
        {id: 'health-daylight', domain: '健康', label: '日晒时间', unit: '分钟', aggregate: 'average', values: seriesMap(healthData?.daylight)},
        {id: 'health-mindful', domain: '健康', label: '正念时长', unit: '分钟', aggregate: 'average', values: seriesMap(healthData?.mindful)},
        {id: 'health-mood', domain: '健康', label: '愉悦度', unit: '', aggregate: 'average', values: moodValues},
        {id: 'career-ai', domain: '事业', label: 'AI 使用', unit: 'token', aggregate: 'sum', values: tokenValues},
        ...vendorTokenValues.map((vendor): CompareMetric => ({id: `career-${vendor.id}`, domain: '事业', label: vendor.label, unit: 'token', aggregate: 'sum', values: vendor.values})),
        {id: 'finance-assets', domain: '财务', label: '总资产', unit: '元', aggregate: 'average', values: assetValues},
        {id: 'finance-index', domain: '财务', label: '指数账户', unit: '元', aggregate: 'average', values: accountMaps[0]},
        {id: 'finance-stock', domain: '财务', label: '个股账户', unit: '元', aggregate: 'average', values: accountMaps[1]},
        {id: 'finance-alipay', domain: '财务', label: '支付宝', unit: '元', aggregate: 'average', values: accountMaps[2]},
        {id: 'finance-caitong', domain: '财务', label: '财通', unit: '元', aggregate: 'average', values: accountMaps[3]},
        {id: 'life-reading', domain: '生活', label: '阅读时长', unit: '小时', aggregate: 'sum', values: readingValues},
        {id: 'life-diary', domain: '生活', label: '日记记录', unit: '天', aggregate: 'sum', values: diaryValues},
        {id: 'life-analysis', domain: '生活', label: 'AI 分析', unit: '天', aggregate: 'sum', values: analysisValues},
        {id: 'life-drive-minutes', domain: '生活', label: '行车时长', unit: '分钟', aggregate: 'sum', values: driveMinutes},
        {id: 'life-drive-trips', domain: '生活', label: '完整行程', unit: '次', aggregate: 'sum', values: driveTrips},
      ]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const scopedMetrics = useMemo(() => metrics.map((metric) => {
    const dates = getScopeDates(timeScope, [...metric.values.keys()], selectedDate);
    const allowed = new Set(dates);
    return {...metric, values: new Map([...metric.values].filter(([date]) => allowed.has(date)))};
  }), [metrics, selectedDate, timeScope]);
  const monthly = timeScope.mode === 'all' || timeScope.mode === 'year' || (timeScope.mode === 'recent' && timeScope.range === '1y');
  const selected = selectedIds.flatMap((id) => {
    const metric = scopedMetrics.find((item) => item.id === id);
    return metric ? [{...metric, values: aggregateMetric(metric, monthly)}] : [];
  });
  const allDates = [...new Set(selected.flatMap((metric) => [...metric.values.keys()]))].sort();
  const transformed = selected.map((metric) => {
    const values = [...metric.values.values()];
    const baselineValues = values.filter((value) => value !== 0).slice(0, 7);
    const baseline = baselineValues.length ? baselineValues.reduce((sum, value) => sum + value, 0) / baselineValues.length : 0;
    const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    const deviation = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length));
    return allDates.map((date) => {
      const raw = metric.values.get(date);
      if (raw === undefined) return null;
      if (mode === 'relative') return baseline ? raw / baseline * 100 : null;
      if (mode === 'zscore') return deviation ? (raw - mean) / deviation : 0;
      return raw;
    });
  });
  const comparedValues = transformed.flatMap((values) => values.filter((value): value is number => value !== null && Number.isFinite(value)));
  const robustMin = percentile(comparedValues, 0.05);
  const robustMax = percentile(comparedValues, 0.95);
  const robustPadding = Math.max(0.1, (robustMax - robustMin) * 0.12);
  const focusRange = (() => {
    if (!selectedDate || timeScope.mode === 'all') return null;
    if (monthly) {
      const month = `${selectedDate.slice(0, 7)}-01`;
      return [month, month] as const;
    }
    if (timeScope.mode === 'period') return [timeScope.start, timeScope.end] as const;
    if (timeScope.mode === 'recent' && timeScope.range === '90d') {
      return [formatDateKey(addDays(parseDateKey(selectedDate), -6)), selectedDate] as const;
    }
    return [selectedDate, selectedDate] as const;
  })();
  const markAreas = [
    ...(focusRange ? [[{xAxis: focusRange[0], itemStyle: {color: 'rgba(10,132,255,.09)'}}, {xAxis: focusRange[1]}]] : []),
    ...(mode === 'zscore' ? [[{yAxis: -1, itemStyle: {color: 'rgba(22,163,74,.06)'}}, {yAxis: 1}]] : []),
  ];
  const chartOption = {
    backgroundColor: 'transparent',
    color: COMPARE_COLORS,
    animationDuration: 250,
    grid: {left: 44, right: 18, top: 38, bottom: 38, containLabel: true},
    legend: {top: 0, textStyle: {color: colorMode === 'dark' ? '#d1d5db' : '#374151'}},
    tooltip: {
      trigger: 'axis',
      formatter: (params: Array<{seriesIndex: number; axisValue: string; marker: string; value?: number}>) => {
        const date = params[0]?.axisValue || '';
        return [date, ...params.map((item) => {
          const metric = selected[item.seriesIndex];
          const raw = metric?.values.get(date);
          const rawLabel = raw === undefined ? '暂无' : `${formatCompactNumber(raw, 1)} ${metric.unit}`;
          const compared = item.value === undefined ? '' : mode === 'relative' ? ` · ${item.value.toFixed(1)}` : mode === 'zscore' ? ` · ${item.value.toFixed(2)}σ` : '';
          return `${item.marker}${metric.label}：${rawLabel}${compared}`;
        })].join('<br/>');
      },
    },
    xAxis: {type: 'category', data: allDates, axisLabel: {formatter: (date: string) => monthly ? date.slice(0, 7) : date.slice(5), color: '#6b7280'}, axisTick: {show: false}},
    yAxis: mode === 'raw'
      ? selected.map((_, index) => ({type: 'value', show: index === 0, scale: true, splitLine: {show: index === 0}, axisLabel: {color: '#6b7280'}}))
      : {type: 'value', min: robustMin - robustPadding, max: robustMax + robustPadding, scale: true, axisLabel: {formatter: mode === 'relative' ? '{value}' : '{value}σ', color: '#6b7280'}, splitLine: {lineStyle: {color: 'rgba(107,114,128,.14)'}}},
    series: selected.map((metric, index) => ({
      name: metric.label,
      type: 'line',
      yAxisIndex: mode === 'raw' ? index : 0,
      data: transformed[index],
      connectNulls: false,
      showSymbol: allDates.length <= 31,
      symbolSize: 5,
      lineStyle: {width: 2.4},
      markArea: index === 0 && markAreas.length ? {silent: true, label: {show: false}, data: markAreas} : undefined,
    })),
  };
  const results = selected.map((metric) => {
    const entries = [...metric.values].sort(([left], [right]) => left.localeCompare(right));
    const first = entries[0];
    const last = entries.at(-1);
    const delta = first && last ? last[1] - first[1] : null;
    return {metric, first, last, delta, coverage: allDates.length ? entries.length / allDates.length : 0};
  });
  const correlations = selected.flatMap((left, leftIndex) => selected.slice(leftIndex + 1).flatMap((right) => {
    const common = [...left.values.keys()].filter((date) => right.values.has(date));
    if (common.length < 14) return [];
    const value = pearsonCorrelation(common.map((date) => left.values.get(date)!), common.map((date) => right.values.get(date)!));
    return value === null ? [] : [{left: left.label, right: right.label, value, samples: common.length}];
  })).sort((left, right) => Math.abs(right.value) - Math.abs(left.value));
  const toggleMetric = (id: string) => setSelectedIds((current) => current.includes(id)
    ? current.filter((item) => item !== id)
    : current.length < 4 ? [...current, id] : current);

  return (
    <div className={styles.comparePanel}>
      <div className={styles.compareToolbar}>
        <div className={styles.comparePresets} aria-label="对比预设">
          {COMPARE_PRESETS.map((preset) => <button key={preset.label} type="button" onClick={() => setSelectedIds(preset.ids)}>{preset.label}</button>)}
        </div>
        <div className={styles.compareMetricPicker} aria-label="选择对比指标">
          {(['健康', '事业', '财务', '生活'] as const).map((domain) => (
            <div key={domain}><span>{domain}</span>{metrics.filter((metric) => metric.domain === domain).map((metric) => (
              <label key={metric.id}><input type="checkbox" checked={selectedIds.includes(metric.id)} disabled={!selectedIds.includes(metric.id) && selectedIds.length >= 4} onChange={() => toggleMetric(metric.id)} />{metric.label}</label>
            ))}</div>
          ))}
        </div>
        <div className={styles.compareModes} role="group" aria-label="对比口径">
          {([['relative', '相对变化'], ['zscore', '标准化偏离'], ['raw', '原始数值']] as Array<[CompareMode, string]>).map(([key, label]) => <button key={key} type="button" aria-pressed={mode === key} className={mode === key ? styles.compareModeActive : ''} onClick={() => setMode(key)}>{label}</button>)}
        </div>
      </div>
      <ObjectiveChartCard id="cross-domain-comparison" title="跨领域趋势对比" meta={`${monthly ? '按月' : '按日'} · 蓝色背景为当前复盘区间 · 绿色带为个人常态 ±1σ`}>
        {loading ? <div className={styles.financeEmptyPanel}>正在加载对比数据...</div> : selected.length ? <ReactECharts option={chartOption} style={{height: 340, width: '100%'}} opts={{renderer: 'canvas'}} notMerge /> : <div className={styles.financeEmptyPanel}>请选择至少一项指标</div>}
      </ObjectiveChartCard>
      <div className={styles.compareResults}>
        <h3>周期结果</h3>
        <div className={styles.compareTableWrap}><table><thead><tr><th>指标</th><th>起点</th><th>终点</th><th>变化</th><th>覆盖率</th></tr></thead><tbody>{results.map(({metric, first, last, delta, coverage}) => <tr key={metric.id}><th>{metric.domain} · {metric.label}</th><td>{first ? `${formatCompactNumber(first[1], 1)} ${metric.unit}` : '暂无'}</td><td>{last ? `${formatCompactNumber(last[1], 1)} ${metric.unit}` : '暂无'}</td><td>{delta === null ? '暂无' : `${delta >= 0 ? '+' : ''}${formatCompactNumber(delta, 1)} ${metric.unit}`}</td><td>{formatNumber(coverage * 100, 0)}%</td></tr>)}</tbody></table></div>
      </div>
      <div className={styles.compareCorrelations}>
        <h3>同期关联</h3>
        {correlations.length ? correlations.slice(0, 4).map((item) => <p key={`${item.left}-${item.right}`}>{item.left} / {item.right}<strong>r = {item.value.toFixed(2)}</strong><span>{item.samples} 个共同样本</span></p>) : <p>共同样本不足 14 个，暂不计算相关系数。</p>}
        <small>相关只描述同期变化，不代表因果关系。</small>
      </div>
    </div>
  );
}

function ObjectiveDataPanel({
  selectedDate,
  onDateSelect,
  timeScope,
  selectedHealthChartIds,
  onHealthChartToggle,
}: {
  selectedDate?: string;
  onDateSelect: (date: string) => void;
  timeScope: ObjectiveTimeScope;
  selectedHealthChartIds: string[];
  onHealthChartToggle: (item: ChartNavItem | ChartNavItem[]) => void;
}): React.ReactNode {
  const [activeDomain, setActiveDomain] = useState<DataDomain>('health');

  return (
    <section className={styles.healthChartsPanel}>
      <DataDomainTabs active={activeDomain} onChange={setActiveDomain} />
      <div
        id="objective-domain-panel"
        className={styles.objectiveDomainPanel}
        role="tabpanel"
        aria-labelledby={`objective-domain-tab-${activeDomain}`}
      >
        {activeDomain === 'health' ? <HealthChartsPanel selectedChartIds={selectedHealthChartIds} onChartToggle={onHealthChartToggle} /> : null}
        {activeDomain === 'career' ? <CareerDataPanel selectedDate={selectedDate} onDateSelect={onDateSelect} timeScope={timeScope} /> : null}
        {activeDomain === 'finance' ? <FinanceDataPanel date={selectedDate} onDateSelect={onDateSelect} timeScope={timeScope} /> : null}
        {activeDomain === 'life' ? <LifeDataPanel selectedDate={selectedDate} onDateSelect={onDateSelect} timeScope={timeScope} /> : null}
        {activeDomain === 'compare' ? <CrossDomainComparison selectedDate={selectedDate} timeScope={timeScope} /> : null}
      </div>
    </section>
  );
}

function AuthoredReviewContent({review}: {review: AuthoredPeriodReview}): React.ReactNode {
  const [Content, setContent] = useState<React.ComponentType<unknown> | null>(null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setExpanded(false);
  }, [review]);

  useEffect(() => {
    if (!expanded) {
      setContent(null);
      setFailed(false);
      return undefined;
    }
    let cancelled = false;
    setContent(null);
    setFailed(false);
    review.load()
      .then((module) => {
        if (!cancelled) setContent(() => module.default);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [expanded, review]);

  if (!expanded) {
    return (
      <div className={styles.periodReviewAuthoredIntro}>
        <p>{review.summary}</p>
        <button type="button" onClick={() => setExpanded(true)}>展开完整总结</button>
      </div>
    );
  }

  if (failed) {
    return (
      <div className={styles.periodReviewNotice} role="status">
        <strong>总结正文加载失败</strong>
        <a href={review.href}>单独阅读这篇总结</a>
      </div>
    );
  }
  if (!Content) return <div className={styles.periodReviewLoading} role="status">正在加载总结...</div>;
  return (
    <div className={`${styles.periodReviewDocument} theme-doc-markdown markdown`}>
      <button type="button" className={styles.periodReviewCollapse} onClick={() => setExpanded(false)}>收起完整总结</button>
      <Content />
    </div>
  );
}

type AccountHistoryPoint = {
  fullDate?: string;
  date?: string;
  totalAssets?: number;
};

type AccountHistoryPayload = {
  portfolio?: {history?: AccountHistoryPoint[]};
};

type InvestManifest = {dates?: string[]};
type InvestAssetPayload = {
  holdingAmountSum?: number;
  assetRecords?: Array<{field?: string; name?: string; amount?: number | null}>;
};

type PeriodObjectiveExternalSummary = {
  health: {primary: string; secondary: string; coverage: string};
  career: {primary: string; secondary: string; coverage: string};
  finance: {primary: string; secondary: string; coverage: string};
  life: {primary: string; secondary: string; coverage: string};
  signals: Array<{tone: 'warning' | 'positive' | 'data'; label: string}>;
};

function periodDate(date: string, bounds: PeriodBounds): boolean {
  return date >= bounds.start && date <= bounds.end;
}

function formatCompactMoney(value: number): string {
  const absolute = Math.abs(value);
  if (absolute >= 10000) return `${formatNumber(value / 10000, 1)}万`;
  return formatNumber(value, 0);
}

function periodComparison(current: number, previous: number, label = '较上一周期'): {text: string; ratio: number | null} {
  if (!Number.isFinite(previous) || previous === 0) return {text: `${label}暂无可比数据`, ratio: null};
  const ratio = (current - previous) / Math.abs(previous);
  return {text: `${label} ${ratio >= 0 ? '+' : ''}${formatNumber(ratio * 100, 0)}%`, ratio};
}

function accountPointDate(point: AccountHistoryPoint): string {
  return point.fullDate || point.date || '';
}

function investTotalAssets(payload: InvestAssetPayload | null): number | undefined {
  const totalAsset = payload?.assetRecords?.find((record) =>
    record.field === 'totalAsset' || record.name === '总资产' || record.name === '总资产(人民币)')?.amount;
  return typeof totalAsset === 'number' ? totalAsset : payload?.holdingAmountSum;
}

function investHistoryPayload(entries: Array<{date: string; value?: number}>): AccountHistoryPayload {
  return {
    portfolio: {
      history: entries
        .filter((entry): entry is {date: string; value: number} => typeof entry.value === 'number')
        .map((entry) => ({fullDate: entry.date, totalAssets: entry.value})),
    },
  };
}

function summarizeAccountPeriod(payloads: Array<AccountHistoryPayload | null>, bounds: PeriodBounds) {
  let startAssets = 0;
  let endAssets = 0;
  let accounts = 0;
  let latestDate = '';
  payloads.forEach((payload) => {
    const history = (payload?.portfolio?.history || [])
      .filter((point) => /^\d{4}-\d{2}-\d{2}$/.test(accountPointDate(point)) && Number.isFinite(point.totalAssets))
      .sort((left, right) => accountPointDate(left).localeCompare(accountPointDate(right)));
    const end = history.filter((point) => accountPointDate(point) <= bounds.end).at(-1);
    const start = history.filter((point) => accountPointDate(point) < bounds.start).at(-1)
      || history.find((point) => periodDate(accountPointDate(point), bounds));
    if (!start || !end || typeof start.totalAssets !== 'number' || typeof end.totalAssets !== 'number') return;
    startAssets += start.totalAssets;
    endAssets += end.totalAssets;
    accounts += 1;
    latestDate = [latestDate, accountPointDate(end)].sort().at(-1) || latestDate;
  });
  return {startAssets, endAssets, accounts, latestDate};
}

function PeriodObjectiveSummary({
  bounds,
  analyses,
  dailyCount,
  analysisCount,
}: {
  bounds: PeriodBounds;
  analyses: Array<{date: string; analysis: DailyAnalysis}>;
  dailyCount: number;
  analysisCount: number;
}): React.ReactNode {
  const [summary, setSummary] = useState<PeriodObjectiveExternalSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const periodDays = diffDays(bounds.start, bounds.end) + 1;
  const previousBounds = useMemo<PeriodBounds>(() => ({
    start: formatDateKey(addDays(parseDateKey(bounds.start), -periodDays)),
    naturalEnd: formatDateKey(addDays(parseDateKey(bounds.start), -1)),
    end: formatDateKey(addDays(parseDateKey(bounds.start), -1)),
    label: '上一周期',
  }), [bounds.start, periodDays]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const years = Array.from(
        {length: Number(bounds.end.slice(0, 4)) - Number(previousBounds.start.slice(0, 4)) + 1},
        (_, index) => String(Number(previousBounds.start.slice(0, 4)) + index),
      );
      const [health, llmPayloads, securitiesPayloads, investManifest, readingPayloads, driveManifest] = await Promise.all([
        loadHealthChartHistory(),
        Promise.all(LLM_VENDOR_CONFIGS.map((vendor) => fetchJson<LLMSummaryPayload>(vendor.path))),
        Promise.all([
          fetchJson<AccountHistoryPayload>('/data/account-assets/index.json'),
          fetchJson<AccountHistoryPayload>('/data/account-assets/stock.json'),
        ]),
        fetchJson<InvestManifest>('/data/invest/index.json'),
        Promise.all(years.map((year) => fetchJson<ReadingYearPayload>(`/data/reading/${year}.json`))),
        fetchJson<Manifest>('/data/drive/index.json'),
      ]);
      if (cancelled) return;

      const investDates = (investManifest?.dates || []).filter((date) => date <= bounds.end);
      const investEntries = await Promise.all(investDates.map(async (date) => {
        const [year, month, day] = date.split('-');
        const [alipay, caitong] = await Promise.all([
          fetchJson<InvestAssetPayload>(`/data/invest/${year}/${month}/${day}/alipay.json`),
          fetchJson<InvestAssetPayload>(`/data/invest/${year}/${month}/${day}/caitong.json`),
        ]);
        return {date, alipay: investTotalAssets(alipay), caitong: investTotalAssets(caitong)};
      }));
      if (cancelled) return;
      const accountPayloads = [
        ...securitiesPayloads,
        investHistoryPayload(investEntries.map(({date, alipay}) => ({date, value: alipay}))),
        investHistoryPayload(investEntries.map(({date, caitong}) => ({date, value: caitong}))),
      ];
      const driveDates = (driveManifest?.dates || []).filter((date) => periodDate(date, bounds) || periodDate(date, previousBounds));
      const driveEntries = await mapWithConcurrency(driveDates, 4, async (date) => {
        const log = await fetchJson<DriveLog>(`/data/drive/${dateToPath(date, 'json')}`);
        return log ? [date, summarizeDriveLog(log)] as const : null;
      });
      if (cancelled) return;
      const currentDrive = driveEntries.filter((item): item is readonly [string, DriveDaySummary] => Boolean(item) && periodDate(item![0], bounds));

      const stepMap = new Map((health?.steps || []).filter(([date]) => periodDate(date, bounds)));
      const previousStepMap = new Map((health?.steps || []).filter(([date]) => periodDate(date, previousBounds)));
      const exerciseMap = new Map((health?.exercise || []).filter(([date]) => periodDate(date, bounds)));
      const sleepScoreMap = new Map((health?.sleep_score || []).filter(([date]) => periodDate(date, bounds)).map(([date, score]) => [date, score]));
      const stepValues = [...stepMap.values()];
      const exerciseMinutes = [...exerciseMap.values()].reduce((total, value) => total + value, 0);
      const sleepScores = [...sleepScoreMap.values()];
      const averageSleepScore = sleepScores.length ? sleepScores.reduce((total, value) => total + value, 0) / sleepScores.length : null;
      const tokenByDate = new Map<string, number>();
      const previousTokenByDate = new Map<string, number>();
      llmPayloads.forEach((payload) => Object.entries(payload?.daily_token_usage || {}).forEach(([date, value]) => {
        if (periodDate(date, bounds)) tokenByDate.set(date, (tokenByDate.get(date) || 0) + Number(value || 0));
        if (periodDate(date, previousBounds)) previousTokenByDate.set(date, (previousTokenByDate.get(date) || 0) + Number(value || 0));
      }));
      const accountPeriod = summarizeAccountPeriod(accountPayloads, bounds);
      const previousAccountPeriod = summarizeAccountPeriod(accountPayloads, previousBounds);
      const readingByDate = new Map<string, number>();
      const previousReadingByDate = new Map<string, number>();
      readingPayloads.forEach((payload) => Object.entries(payload?.daily || {}).forEach(([date, value]) => {
        if (periodDate(date, bounds)) readingByDate.set(date, (readingByDate.get(date) || 0) + Number(value.seconds || 0));
        if (periodDate(date, previousBounds)) previousReadingByDate.set(date, (previousReadingByDate.get(date) || 0) + Number(value.seconds || 0));
      }));
      const readingSeconds = [...readingByDate.values()].reduce((total, value) => total + value, 0);
      const previousReadingSeconds = [...previousReadingByDate.values()].reduce((total, value) => total + value, 0);
      const averageSteps = stepValues.length ? stepValues.reduce((total, value) => total + value, 0) / stepValues.length : 0;
      const previousStepValues = [...previousStepMap.values()];
      const previousAverageSteps = previousStepValues.length ? previousStepValues.reduce((total, value) => total + value, 0) / previousStepValues.length : 0;
      const totalTokens = [...tokenByDate.values()].reduce((total, value) => total + value, 0);
      const previousTotalTokens = [...previousTokenByDate.values()].reduce((total, value) => total + value, 0);
      const healthChange = periodComparison(averageSteps, previousAverageSteps);
      const careerChange = periodComparison(totalTokens, previousTotalTokens);
      const financeChange = periodComparison(accountPeriod.endAssets, previousAccountPeriod.endAssets, '较上周期末');
      const lifeChange = periodComparison(readingSeconds, previousReadingSeconds);
      const signals: PeriodObjectiveExternalSummary['signals'] = [
        ...(healthChange.ratio !== null && healthChange.ratio <= -0.2 ? [{tone: 'warning' as const, label: `活动量明显下降：${healthChange.text}`} ] : []),
        ...(healthChange.ratio !== null && healthChange.ratio >= 0.2 ? [{tone: 'positive' as const, label: `活动量明显提高：${healthChange.text}`} ] : []),
        ...(averageSleepScore !== null && averageSleepScore < 80 ? [{tone: 'warning' as const, label: `睡眠评分偏低：周期平均 ${formatNumber(averageSleepScore, 0)} 分`} ] : []),
        ...(careerChange.ratio !== null && Math.abs(careerChange.ratio) >= 0.5 ? [{tone: 'data' as const, label: `AI 使用波动较大：${careerChange.text}`} ] : []),
        ...(financeChange.ratio !== null && Math.abs(financeChange.ratio) >= 0.03 ? [{tone: financeChange.ratio < 0 ? 'warning' as const : 'positive' as const, label: `总资产变化：${financeChange.text}`} ] : []),
        ...(lifeChange.ratio !== null && lifeChange.ratio <= -0.3 ? [{tone: 'warning' as const, label: `阅读投入下降：${lifeChange.text}`} ] : []),
      ].slice(0, 3);

      setSummary({
        health: {
          primary: stepValues.length ? `日均 ${formatNumber(stepValues.reduce((total, value) => total + value, 0) / stepValues.length, 0)} 步` : '暂无步数',
          secondary: averageSleepScore !== null ? `睡眠评分 ${formatNumber(averageSleepScore, 0)} · 运动 ${formatNumber(exerciseMinutes, 0)} 分钟` : exerciseMap.size ? `运动 ${formatNumber(exerciseMinutes, 0)} 分钟` : '暂无运动记录',
          coverage: `${healthChange.text} · 睡眠评分 ${sleepScoreMap.size}/${periodDays} 天 · 步数 ${stepMap.size}/${periodDays} 天`,
        },
        career: {
          primary: tokenByDate.size ? `${formatCompactNumber(totalTokens, 1)} token` : '暂无 AI 用量',
          secondary: `${tokenByDate.size} 天使用 AI`,
          coverage: `${careerChange.text} · Git 覆盖 ${analysisCount}/${periodDays} 天`,
        },
        finance: {
          primary: accountPeriod.accounts ? `${formatCompactMoney(accountPeriod.endAssets)} 证券资产` : '暂无证券资产',
          secondary: accountPeriod.accounts
            ? `周期 ${accountPeriod.endAssets - accountPeriod.startAssets >= 0 ? '+' : ''}${formatCompactMoney(accountPeriod.endAssets - accountPeriod.startAssets)}`
            : '暂无周期变化',
          coverage: accountPeriod.accounts ? `${financeChange.text} · ${accountPeriod.accounts} 个账户 · 截至 ${accountPeriod.latestDate.slice(5)}` : '账户数据未覆盖该周期',
        },
        life: {
          primary: readingByDate.size ? `${formatHoursFromSeconds(readingSeconds)} 阅读` : '暂无阅读记录',
          secondary: currentDrive.length
            ? `行车 ${formatNumber(currentDrive.reduce((sum, [, value]) => sum + value.minutes, 0), 0)} 分钟 · ${currentDrive.reduce((sum, [, value]) => sum + value.trips, 0)} 次`
            : `${readingByDate.size} 天阅读`,
          coverage: `${lifeChange.text} · 出行覆盖 ${currentDrive.length}/${periodDays} 天 · ${dailyCount} 天日记`,
        },
        signals,
      });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [analysisCount, bounds.end, bounds.naturalEnd, bounds.start, dailyCount, periodDays, previousBounds]);

  const gitCounts = useMemo(() => analyses.reduce((total, item) => {
    const counts = parseGitCounts(item.analysis);
    return {manual: total.manual + counts.manual, total: total.total + counts.total};
  }, {manual: 0, total: 0}), [analyses]);
  const rows = summary ? [
    {label: '健康', ...summary.health},
    {label: '事业', ...summary.career, secondary: gitCounts.total ? `人工 ${gitCounts.manual} / 总 ${gitCounts.total} 次提交` : summary.career.secondary},
    {label: '财务', ...summary.finance},
    {label: '生活', ...summary.life},
  ] : [];

  return (
    <section className={styles.periodObjectiveSummary} aria-label="周期客观数据摘要">
      <header>
        <h3>客观数据摘要</h3>
        <span>{formatChineseDate(bounds.start)} 至 {formatChineseDate(bounds.end)}</span>
      </header>
      {loading ? <div className={styles.periodObjectiveSummaryLoading} role="status">正在汇总客观数据...</div> : <>
        <div className={styles.periodObjectiveSummaryRows}>
          {rows.map((row) => (
            <article key={row.label}>
              <span>{row.label}</span>
              <strong>{row.primary}</strong>
              <b>{row.secondary}</b>
              <small>{row.coverage}</small>
            </article>
          ))}
        </div>
        {summary?.signals.length ? (
          <div className={styles.periodObjectiveSignals} aria-label="本周期最值得关注">
            <strong>本周期最值得关注</strong>
            {summary.signals.map((signal) => <p key={signal.label} data-tone={signal.tone}>{signal.label}</p>)}
          </div>
        ) : null}
      </>}
    </section>
  );
}

function PeriodReviewPanel({
  period,
  bounds,
  dailyDates,
  analysisDates,
  onDateSelect,
}: {
  period: Exclude<DatedReviewPeriod, {kind: 'day'}>;
  bounds: PeriodBounds;
  dailyDates: string[];
  analysisDates: string[];
  onDateSelect: (date: string) => void;
}): React.ReactNode {
  const [analyses, setAnalyses] = useState<Array<{date: string; analysis: DailyAnalysis}>>([]);
  const [loading, setLoading] = useState(true);
  const periodAnalysisDates = useMemo(
    () => analysisDates.filter((date) => date >= bounds.start && date <= bounds.end),
    [analysisDates, bounds.end, bounds.start],
  );
  const periodDailyDates = useMemo(
    () => dailyDates.filter((date) => date >= bounds.start && date <= bounds.end),
    [bounds.end, bounds.start, dailyDates],
  );
  const reviewKey = `${period.kind}:${period.key}`;
  const authoredReview = AUTHORED_PERIOD_REVIEWS[reviewKey];

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void mapWithConcurrency(periodAnalysisDates, 4, async (date) => {
      const analysis = await fetchDailyAnalysis(date);
      return analysis ? {date, analysis} : null;
    }).then((items) => {
      if (!cancelled) setAnalyses(items.filter((item): item is {date: string; analysis: DailyAnalysis} => Boolean(item)));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [periodAnalysisDates]);

  const signals = useMemo(() => {
    const seen = new Set<string>();
    return [...analyses]
      .sort((left, right) => right.date.localeCompare(left.date))
      .flatMap(({date, analysis}) => (analysis.top_signals || []).map((signal) => ({date, signal})))
      .filter(({signal}) => {
        const summary = signal.summary?.trim();
        if (!summary || seen.has(summary)) return false;
        seen.add(summary);
        return true;
      })
      .slice(0, 6);
  }, [analyses]);
  const followUps = useMemo(() => {
    const seen = new Set<string>();
    return [...analyses]
      .sort((left, right) => right.date.localeCompare(left.date))
      .flatMap(({date, analysis}) => (analysis.follow_ups || []).map((text) => ({date, text})))
      .filter(({text}) => {
        const normalized = text.replace(/^\*\*(?:明日动作|观察项)\*\*[：:]\s*/, '').trim();
        if (!normalized || seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
      })
      .slice(0, 4);
  }, [analyses]);
  const recordDates = useMemo(
    () => [...new Set([...periodDailyDates, ...periodAnalysisDates])].sort().reverse().slice(0, 12),
    [periodAnalysisDates, periodDailyDates],
  );
  const periodName = period.kind === 'week' ? '周' : period.kind === 'month' ? '月度' : '年度';

  return (
    <section className={`${styles.dailyDetailPanel} ${styles.periodReviewPanel}`}>
      <header className={styles.periodReviewHead}>
        <div>
          <span>{periodName}复盘</span>
          <h2>{authoredReview?.title || bounds.label}</h2>
        </div>
        {authoredReview ? <a href={authoredReview.href}>单独阅读</a> : null}
        <p>
          {formatChineseDate(bounds.start)} 至 {formatChineseDate(bounds.naturalEnd)}
          {bounds.end < bounds.naturalEnd ? ` · 数据截至 ${formatChineseDate(bounds.end)}` : ''}
          {' · '}{periodDailyDates.length} 天日记 · {periodAnalysisDates.length} 天 AI 分析
        </p>
      </header>

      <PeriodObjectiveSummary
        bounds={bounds}
        analyses={analyses}
        dailyCount={periodDailyDates.length}
        analysisCount={periodAnalysisDates.length}
      />

      {authoredReview ? <AuthoredReviewContent review={authoredReview} /> : (
        <div className={styles.periodReviewBody}>
          <div className={styles.periodReviewNotice}>
            <strong>尚无独立{periodName}总结</strong>
            <span>以下内容来自该周期内已有的每日记录与结构化分析。</span>
          </div>

          <div className={styles.periodReviewStats}>
            <div><strong>{diffDays(bounds.start, bounds.naturalEnd) + 1}</strong><span>周期天数</span></div>
            <div><strong>{periodDailyDates.length}</strong><span>日记天数</span></div>
            <div><strong>{periodAnalysisDates.length}</strong><span>AI 分析天数</span></div>
          </div>

          {loading ? <div className={styles.periodReviewLoading} role="status">正在汇总周期记录...</div> : null}
          {!loading && signals.length ? (
            <section className={styles.periodReviewSection}>
              <h3>关键判断</h3>
              <div className={styles.periodSignalList}>
                {signals.map(({date, signal}) => (
                  <button key={`${date}-${signal.summary}`} type="button" onClick={() => onDateSelect(date)}>
                    <span>{date.slice(5)} · {signal.area || '综合'}</span>
                    <strong>{signal.summary}</strong>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {!loading && followUps.length ? (
            <section className={styles.periodReviewSection}>
              <h3>持续关注</h3>
              <ul>
                {followUps.map(({date, text}) => (
                  <li key={`${date}-${text}`}><button type="button" onClick={() => onDateSelect(date)}>{renderFollowUp(text)}</button></li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className={styles.periodReviewSection}>
            <h3>每日记录</h3>
            {recordDates.length ? (
              <div className={styles.periodRecordList}>
                {recordDates.map((date) => (
                  <button key={date} type="button" onClick={() => onDateSelect(date)}>
                    <strong>{formatChineseDate(date)}</strong>
                    <span>{periodDailyDates.includes(date) ? '日记' : ''}{periodDailyDates.includes(date) && periodAnalysisDates.includes(date) ? ' · ' : ''}{periodAnalysisDates.includes(date) ? 'AI 分析' : ''}</span>
                  </button>
                ))}
              </div>
            ) : <p className={styles.muted}>该周期暂无日记或 AI 分析记录。</p>}
          </section>
        </div>
      )}
    </section>
  );
}

function DailyDetailPanel({
  date,
  year,
  dailyDates,
  analysisDates,
  latestAnalysisDate,
  weather,
  diary,
  analysis,
  timelineModel,
  loading,
  onDateSelect,
}: {
  date: string;
  year: number;
  dailyDates: Set<string>;
  analysisDates: Set<string>;
  latestAnalysisDate?: string;
  weather: unknown;
  diary: string;
  analysis: DailyAnalysis | null;
  timelineModel: TimelineModel;
  loading: boolean;
  onDateSelect: (date: string) => void;
}): React.ReactNode {
  const defaultTab = analysis ? 'analysis' : diary ? 'diary' : 'timeline';
  const [activeTab, setActiveTab] = useState<DailyDetailTab>(defaultTab);

  useEffect(() => {
    setActiveTab(analysis ? 'analysis' : diary ? 'diary' : 'timeline');
  }, [analysis, date, diary]);

  return (
    <section className={styles.dailyDetailPanel}>
      <DailyYearHeatmap
        year={year}
        selectedDate={date}
        dailyDates={dailyDates}
        analysisDates={analysisDates}
        onDateSelect={onDateSelect}
      />
      <DailyBasicInfo date={date} weather={weather} />
      <DailyDetailTabs active={activeTab} onChange={setActiveTab} />
      <div
        id="daily-detail-panel"
        className={styles.dailyDetailBody}
        role="tabpanel"
        aria-labelledby={`daily-detail-tab-${activeTab}`}
      >
        {loading ? (
          <section className={styles.dailyLoading} role="status" aria-live="polite">正在加载当日数据...</section>
        ) : (
          <>
            {activeTab === 'diary' ? <DailyDiary diary={diary} /> : null}
            {activeTab === 'timeline' ? <TimelinePanel model={timelineModel} /> : null}
            {activeTab === 'analysis' ? (
              <DailyAnalysisReport
                analysis={analysis}
                selectedDate={date}
                latestAnalysisDate={latestAnalysisDate}
                onDateSelect={onDateSelect}
              />
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function DailyContext({
  date,
  weather,
  diary,
  analysis,
  timelineModel,
  loading,
  onDateSelect,
  timeScope,
  selectedHealthChartIds,
  onHealthChartToggle,
  year,
  dailyDates,
  analysisDates,
  allDailyDates,
  allAnalysisDates,
  latestAnalysisDate,
  period,
  periodBounds,
}: {
  date: string;
  weather: unknown;
  diary: string;
  analysis: DailyAnalysis | null;
  timelineModel: TimelineModel;
  loading: boolean;
  onDateSelect: (date: string) => void;
  timeScope: ObjectiveTimeScope;
  selectedHealthChartIds: string[];
  onHealthChartToggle: (item: ChartNavItem | ChartNavItem[]) => void;
  year: number;
  dailyDates: Set<string>;
  analysisDates: Set<string>;
  allDailyDates: string[];
  allAnalysisDates: string[];
  latestAnalysisDate?: string;
  period: DatedReviewPeriod;
  periodBounds: PeriodBounds;
}): React.ReactNode {
  return (
    <section className={styles.dailyContext}>
      <div className={styles.dailyContextRight}>
        {period.kind === 'day' ? (
          <div className={styles.standaloneObjectiveSummary}>
            <PeriodObjectiveSummary
              bounds={periodBounds}
              analyses={analysis ? [{date, analysis}] : []}
              dailyCount={dailyDates.has(date) ? 1 : 0}
              analysisCount={analysisDates.has(date) ? 1 : 0}
            />
          </div>
        ) : null}
        {period.kind === 'day' ? (
          <DailyDetailPanel
            date={date}
            year={year}
            dailyDates={dailyDates}
            analysisDates={analysisDates}
            latestAnalysisDate={latestAnalysisDate}
            weather={weather}
            diary={diary}
            analysis={analysis}
            timelineModel={timelineModel}
            loading={loading}
            onDateSelect={onDateSelect}
          />
        ) : (
          <PeriodReviewPanel
            period={period}
            bounds={periodBounds}
            dailyDates={allDailyDates}
            analysisDates={allAnalysisDates}
            onDateSelect={onDateSelect}
          />
        )}
      </div>
      <div className={styles.dailyContextLeft}>
        <ObjectiveDataPanel
          selectedDate={date}
          onDateSelect={onDateSelect}
          timeScope={timeScope}
          selectedHealthChartIds={selectedHealthChartIds}
          onHealthChartToggle={onHealthChartToggle}
        />
      </div>
    </section>
  );
}

function DashboardSkeleton(): React.ReactNode {
  return (
    <section className={styles.dashboardSkeleton} aria-label="正在加载三省数据" aria-busy="true">
      <div>
        <span />
        <i />
        <i />
        <i />
      </div>
      <div>
        <span />
        <b />
        <i />
        <i />
      </div>
    </section>
  );
}

export default function DailyReflectionDashboard({initialYear, children}: DailyReflectionDashboardProps): React.JSX.Element {
  const [dailyDates, setDailyDates] = useState<string[]>([]);
  const [analysisDates, setAnalysisDates] = useState<string[]>([]);
  const [selectedYear, setSelectedYear] = useState(initialYear);
  const [reviewPeriod, setReviewPeriod] = useState<ReviewPeriod>({kind: 'day', key: ''});
  const [selectedHealthChartIds, setSelectedHealthChartIds] = useState<string[]>(DEFAULT_HEALTH_CHART_ID ? [DEFAULT_HEALTH_CHART_ID] : []);
  const [diary, setDiary] = useState('');
  const [analysis, setAnalysis] = useState<DailyAnalysis | null>(null);
  const [weather, setWeather] = useState<unknown>(null);
  const [drive, setDrive] = useState<DriveLog | null>(null);
  const [dailyHealth, setDailyHealth] = useState<DailyHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [initialDailyLoaded, setInitialDailyLoaded] = useState(false);
  const [loadedDailyDate, setLoadedDailyDate] = useState('');
  const urlReadyRef = useRef(false);
  const restoringHistoryRef = useRef(false);
  const lastDatedAnchorRef = useRef('');
  const latestAnalysisDate = analysisDates.at(-1);
  const latestDailyDate = dailyDates.at(-1);
  const fallbackAnchorDate = latestAnalysisDate || latestDailyDate || formatDateKey(new Date());
  const periodBounds = useMemo(
    () => reviewPeriod.kind === 'life' ? null : getReviewPeriodBounds(reviewPeriod),
    [reviewPeriod],
  );
  const selectedDate = reviewPeriod.kind !== 'life' && reviewPeriod.key && periodBounds
    ? periodBounds.end
    : '';
  const activeAnchorDate = selectedDate || lastDatedAnchorRef.current || fallbackAnchorDate;
  const timeScope = useMemo<ObjectiveTimeScope>(() => {
    if (reviewPeriod.kind === 'life') return {mode: 'all', label: '全部历史'};
    if (reviewPeriod.kind === 'year') return {mode: 'all', label: '多年'};
    if (reviewPeriod.kind === 'day') return {mode: 'recent', range: '7d'};
    if (reviewPeriod.kind === 'week') return {mode: 'recent', range: '30d'};
    return {mode: 'recent', range: '1y'};
  }, [reviewPeriod]);

  useEffect(() => {
    let mounted = true;
    const requestedPeriod = pickInitialReviewPeriod('');
    if (requestedPeriod.kind === 'life' || requestedPeriod.key) setReviewPeriod(requestedPeriod);
    Promise.all([
      fetchJson<Manifest>('/data/daily/index.json'),
      fetchJson<Manifest>('/data/daily-analysis/index.json'),
    ])
      .then(([dailyManifest, analysisManifest]) => {
        if (!mounted) return;
        const nextDailyDates = dailyManifest?.dates || [];
        const nextAnalysisDates = analysisManifest?.dates || [];
        const merged = [...new Set([...nextDailyDates, ...nextAnalysisDates])].sort();
        const initialDate = pickInitialDate(nextAnalysisDates.length ? nextAnalysisDates : merged);
        setDailyDates(nextDailyDates);
        setAnalysisDates(nextAnalysisDates);
        const initialPeriod = pickInitialReviewPeriod(initialDate);
        const initialAnchor = initialPeriod.kind === 'life'
          ? lastDatedAnchorRef.current || initialDate || formatDateKey(new Date())
          : getReviewPeriodBounds(initialPeriod).end;
        lastDatedAnchorRef.current = initialAnchor;
        setReviewPeriod(initialPeriod);
        setSelectedYear(initialYear || Number(initialAnchor.slice(0, 4)) || new Date().getFullYear());
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [initialYear]);

  useEffect(() => {
    if (reviewPeriod.kind !== 'life' && reviewPeriod.key && periodBounds) {
      lastDatedAnchorRef.current = periodBounds.end;
    }
  }, [periodBounds, reviewPeriod]);

  useEffect(() => {
    if (!selectedDate || reviewPeriod.kind !== 'day' || loadedDailyDate === selectedDate) return;
    let cancelled = false;
    const [selectedYearPart, selectedMonth, selectedDay] = selectedDate.split('-');
    setSelectedYear(Number(selectedYearPart));

    setDailyLoading(true);
    setDiary('');
    setAnalysis(null);
    setWeather(null);
    setDrive(null);
    setDailyHealth(null);
    Promise.all([
      fetchText(`/data/daily/${dateToPath(selectedDate, 'md')}`),
      fetchDailyAnalysis(selectedDate),
      fetchWeather(selectedDate),
      fetchJson<DriveLog>(`/data/drive/${selectedYearPart}/${selectedMonth}/${selectedDay}.json`),
      fetchJson<DailyHealthData>(`/data/health/${selectedYearPart}/${selectedMonth}/${selectedDay}.json`),
    ])
      .then(([
        diaryText,
        analysisJson,
        weatherJson,
        driveJson,
        dailyHealthJson,
      ]) => {
        if (cancelled) return;
        setDiary(diaryText);
        setAnalysis(analysisJson);
        setWeather(weatherJson);
        setDrive(driveJson);
        setDailyHealth(dailyHealthJson);
      })
      .finally(() => {
        if (!cancelled) {
          setDailyLoading(false);
          setInitialDailyLoaded(true);
          setLoadedDailyDate(selectedDate);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadedDailyDate, reviewPeriod.kind, selectedDate]);

  useEffect(() => {
    if (typeof window === 'undefined' || (reviewPeriod.kind !== 'life' && !reviewPeriod.key)) return;
    const url = new URL(window.location.href);
    ['view', 'period', 'date', 'week', 'month', 'year'].forEach((key) => url.searchParams.delete(key));
    url.searchParams.set('period', reviewPeriod.kind);
    if (reviewPeriod.kind !== 'life') {
      const key = reviewPeriod.kind === 'day' ? 'date' : reviewPeriod.kind;
      url.searchParams.set(key, reviewPeriod.key);
    }
    if (restoringHistoryRef.current) {
      restoringHistoryRef.current = false;
      urlReadyRef.current = true;
      return;
    }
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    if (urlReadyRef.current) window.history.pushState(window.history.state, '', nextUrl);
    else window.history.replaceState(window.history.state, '', nextUrl);
    urlReadyRef.current = true;
  }, [reviewPeriod]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handlePopState = () => {
      restoringHistoryRef.current = true;
      setReviewPeriod(pickInitialReviewPeriod(lastDatedAnchorRef.current || fallbackAnchorDate));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [fallbackAnchorDate]);

  useEffect(() => {
    if (selectedDate) setSelectedYear(Number(selectedDate.slice(0, 4)));
  }, [selectedDate]);

  const dailyDateSet = useMemo(
    () => new Set(dailyDates.filter((date) => String(selectedYear) === date.slice(0, 4))),
    [dailyDates, selectedYear],
  );
  const analysisDateSet = useMemo(
    () => new Set(analysisDates.filter((date) => String(selectedYear) === date.slice(0, 4))),
    [analysisDates, selectedYear],
  );
  const timelineModel = useMemo(
    () => buildTimelineModel({dailyHealth, drive, weather}),
    [dailyHealth, drive, weather],
  );
  const handleDateSelect = (date: string) => {
    if (!isValidDateKey(date)) return;
    if (date !== loadedDailyDate) {
      setDailyLoading(true);
      setDiary('');
      setAnalysis(null);
      setWeather(null);
      setDrive(null);
      setDailyHealth(null);
    }
    lastDatedAnchorRef.current = date;
    setReviewPeriod({kind: 'day', key: date});
  };
  const handlePeriodChange = (period: DatedReviewPeriod) => {
    if (isFutureReviewPeriod(period)) return;
    lastDatedAnchorRef.current = getReviewPeriodBounds(period).end;
    setReviewPeriod(period);
  };
  const handlePeriodKindChange = (kind: ReviewPeriodKind) => {
    if (kind === 'life') {
      setReviewPeriod({kind: 'life'});
      return;
    }
    if (kind === 'day') {
      handleDateSelect(activeAnchorDate);
      return;
    }
    handlePeriodChange(periodFromAnchor(kind, activeAnchorDate));
  };
  const handleTimeScopeChange = (scope: ObjectiveTimeScope) => {
    if (scope.mode === 'all') {
      setReviewPeriod({kind: 'life'});
      return;
    }
    if (scope.mode === 'year') handlePeriodChange({kind: 'year', key: String(scope.year)});
    if (scope.mode === 'period') {
      const days = diffDays(scope.start, scope.end) + 1;
      const kind: DatedReviewPeriodKind = days === 1 ? 'day' : days <= 7 ? 'week' : 'month';
      handlePeriodChange(periodFromAnchor(kind, scope.end));
    }
  };
  const handleHealthChartToggle = (item: ChartNavItem | ChartNavItem[]) => {
    setSelectedHealthChartIds((Array.isArray(item) ? item : [item]).map((chart) => chart.id));
  };

  return (
    <div className={styles.page}>
      <header className={styles.dashboardHeader}>
        <div className={styles.dashboardHeaderText}>
          <h1>三省吾身</h1>
        </div>
        <div className={styles.dashboardHeaderActions}>
          <div className={styles.headerTimeRow}>
            <span className={styles.headerTimeLabel}>查看范围</span>
            <ReviewPeriodControls period={reviewPeriod} onChange={handlePeriodKindChange} />
          </div>
          <div className={styles.headerTimeRow}>
            <span className={styles.headerTimeLabel}>定位时间<small className={styles.headerTimeLabelScope}>趋势 {scopeLabel(timeScope)}</small></span>
            <div className={styles.headerTimeLocation}>
              {reviewPeriod.kind !== 'life' ? (
                <PeriodNavigator period={reviewPeriod} latestDate={latestAnalysisDate} onChange={handlePeriodChange} />
              ) : <div className={styles.headerTimeValue}>全部历史</div>}
              <span className={styles.headerTrendScope}>趋势 {scopeLabel(timeScope)}</span>
            </div>
          </div>
        </div>
      </header>

      <div
        id="review-period-panel"
        className={styles.reviewPeriodPanel}
        role="tabpanel"
        aria-labelledby={`review-period-tab-${reviewPeriod.kind}`}
      >
        <HealthProvider
          onDateSelect={handleDateSelect}
          selectedDate={reviewPeriod.kind === 'life' ? undefined : selectedDate}
          scope={timeScope as HealthTimeScope}
          setScope={(nextScope) => handleTimeScopeChange(nextScope as ObjectiveTimeScope)}
        >
        {reviewPeriod.kind === 'life' ? (
          <section className={styles.lifeContext}>
            <aside className={`${styles.dailyContextLeft} ${styles.lifeDataColumn}`}>
              <ObjectiveDataPanel
                selectedDate={undefined}
                onDateSelect={handleDateSelect}
                timeScope={timeScope}
                selectedHealthChartIds={selectedHealthChartIds}
                onHealthChartToggle={handleHealthChartToggle}
              />
            </aside>
            <div className={styles.lifeRightColumn}>
              <div className={styles.lifeHealthSummary}>
                <PeriodObjectiveSummary
                  bounds={{
                    start: HEALTH_HISTORY_START_DATE,
                    naturalEnd: formatDateKey(new Date()),
                    end: formatDateKey(new Date()),
                    label: '全部历史',
                  }}
                  analyses={[]}
                  dailyCount={dailyDates.length}
                  analysisCount={analysisDates.length}
                />
              </div>
              <section className={`${styles.lifeOverviewColumn} ${styles.calendarShell}`}>
                <div className={styles.calendarTopline}>
                  <div>
                    <span>人生进度</span>
                    <h2>时间位置</h2>
                    <p className={styles.lifeRouteSummary}>1992 至今 · 以 100 岁为参照</p>
                  </div>
                </div>
                <LifeCalendar />
              </section>
              <section className={styles.lifeRouteColumn}>
                <div className={styles.calendarTopline}>
                  <div>
                    <span>目标与里程碑</span>
                    <h2>人生路线</h2>
                    <p className={styles.lifeRouteSummary}>2030 目标 · 2026-2029 当前阶段 · 2014-2025 年度里程碑</p>
                  </div>
                </div>
                <div className={styles.lifeContent}>{children}</div>
              </section>
            </div>
          </section>
        ) : (
          loading || (reviewPeriod.kind === 'day' && selectedDate ? !initialDailyLoaded : false) ? (
            <DashboardSkeleton />
          ) : selectedDate && periodBounds ? (
            <DailyContext
              date={selectedDate}
              weather={weather}
              diary={diary}
              analysis={analysis}
              timelineModel={timelineModel}
              loading={dailyLoading}
              onDateSelect={handleDateSelect}
              timeScope={timeScope}
              selectedHealthChartIds={selectedHealthChartIds}
              onHealthChartToggle={handleHealthChartToggle}
              year={selectedYear || new Date().getFullYear()}
              dailyDates={dailyDateSet}
              analysisDates={analysisDateSet}
              allDailyDates={dailyDates}
              allAnalysisDates={analysisDates}
              latestAnalysisDate={latestAnalysisDate}
              period={reviewPeriod}
              periodBounds={periodBounds}
            />
          ) : (
            <p className={styles.dailyLoading} role="status">暂无可用的复盘数据。</p>
          )
        )}
        </HealthProvider>
      </div>
    </div>
  );
}
