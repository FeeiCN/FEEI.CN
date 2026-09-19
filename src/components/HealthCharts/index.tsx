import React, {useContext, useEffect, useMemo, useRef, useState} from 'react';
import ReactDOM from 'react-dom';
import BrowserOnly from '@docusaurus/BrowserOnly';
import {useColorMode} from '@docusaurus/theme-common';
import ReactECharts from 'echarts-for-react';
import {transform, computeDashboard, getDateRange, type HealthData, type DashCard} from './transform';
import {
  RANGE_DAYS, RANGE_LABELS, EMPTY, getAvailableMonthMap,
  YearCtx, type RecentRange, type TimeScope,
} from './index-shared';
import styles from './styles.module.css';
import {
  ECHARTS_RENDERER_OPTIONS,
  healthHistoryCache,
  sleepScoreCache,
  loadSleepScoreHistory,
  loadHealthChartHistory,
  dateKey,
  parseDate,
  isValidDateKey,
  selectedDateOrToday,
  cappedYearEnd,
  hasHealthData,
  getScopeAxisDates,
  addWeekends,
  addSelectedDateHighlight,
  addTodayLatestHighlight,
  optionHasData,
  applyHealthChartStyle,
  alignDateCategoryAxes,
  alignCalendarRange,
  chartHeight,
  OptionFn,
  SECTIONS,
  healthChartAnchorId,
  HEALTH_CHART_REGISTRY,
  mergeData,
  getVisibleHealthYears,
  getTargetMonthKeys,
  filterDataByDateRange,
  fetchHealthMonths,
  retainTargetMonths,
  extractDateFromChartEvent,
  extractDateFromChartOption,
  ChartLike,
  zrenderClickHandlers,
  extractDateFromZrenderClick,
} from './charts';
export {HEALTH_CHART_NAV, HealthChartDeviationMark, healthChartAnchorId, loadHealthChartHistory} from './charts';

export {YearCtx} from './index-shared';
export type {TimeScope, YearCtxType} from './index-shared';

function HealthProviderInner({
  children,
  onDateSelect,
  selectedDate,
  scope: controlledScope,
  setScope: setControlledScope,
}: {
  children: React.ReactNode;
  onDateSelect?: (date: string) => void;
  selectedDate?: string;
  scope?: TimeScope;
  setScope?: (scope: TimeScope) => void;
}) {
  const [internalScope, setInternalScope] = useState<TimeScope>({mode: 'recent', range: '7d'});
  const [allData, setAllData] = useState<Record<string, HealthData>>({});
  const [historyData, setHistoryData] = useState<HealthData | null>(healthHistoryCache);
  const [sleepScoreData, setSleepScoreData] = useState<HealthData['sleep_score']>(sleepScoreCache || []);
  const [loading, setLoading] = useState(true);
  const [settledTarget, setSettledTarget] = useState('');
  const scope = controlledScope ?? internalScope;
  const setScope = setControlledScope ?? setInternalScope;
  const availableMonths = useMemo(() => getAvailableMonthMap(), []);
  const targetMonthKeys = useMemo(
    () => getTargetMonthKeys(scope, availableMonths, selectedDate),
    [availableMonths, scope, selectedDate],
  );
  const targetSignature = scope.mode === 'all' ? 'all-history' : targetMonthKeys.join(',');

  useEffect(() => {
    let cancelled = false;
    void loadSleepScoreHistory().then((scores) => {
      if (!cancelled) setSleepScoreData(scores);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    if (scope.mode === 'all') {
      setLoading(true);
      void loadHealthChartHistory()
        .then((loaded) => {
          if (!cancelled) setHistoryData(loaded);
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
            setSettledTarget(targetSignature);
          }
        });
      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    const missingKeys = targetMonthKeys.filter((key) => !allData[key]);
    if (missingKeys.length === 0) {
      setAllData((previous) => retainTargetMonths(previous, targetMonthKeys));
      setLoading(false);
      setSettledTarget(targetSignature);
      return () => controller.abort();
    }

    setLoading(true);
    void fetchHealthMonths(missingKeys, controller.signal)
      .then((loaded) => {
        if (!cancelled) setAllData((previous) => retainTargetMonths(previous, targetMonthKeys, loaded));
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setSettledTarget(targetSignature);
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [scope.mode, targetMonthKeys, targetSignature]);

  const data = useMemo(() => {
    if (scope.mode === 'all') return historyData ?? EMPTY;
    const merged = {...mergeData(allData, targetMonthKeys), sleep_score: sleepScoreData};
    if (scope.mode === 'period') {
      if (!isValidDateKey(scope.start) || !isValidDateKey(scope.end) || scope.start > scope.end) return EMPTY;
      return filterDataByDateRange(merged, scope.start, scope.end);
    }
    if (scope.mode === 'year') {
      return filterDataByDateRange(merged, `${scope.year}-01-01`, cappedYearEnd(scope.year, selectedDate));
    }
    const end = selectedDateOrToday(selectedDate);
    const start = parseDate(end);
    start.setDate(start.getDate() - RANGE_DAYS[scope.range] + 1);
    return filterDataByDateRange(merged, dateKey(start), end);
  }, [allData, historyData, scope, selectedDate, sleepScoreData, targetMonthKeys]);
  const axisDates = useMemo(() => getScopeAxisDates(scope, data, selectedDate), [scope, data, selectedDate]);

  const scopeLoading = loading || settledTarget !== targetSignature;

  return <YearCtx.Provider value={{scope, setScope, data, axisDates, loading: scopeLoading, availableMonths, onDateSelect, selectedDate}}>{children}</YearCtx.Provider>;
}

// ── inner components ──────────────────────────────────────────────────────────

function Sparkline({values, dates, color, uid, unit, rangeMin, rangeMax}: {
  values: number[]; dates: string[]; color: string; uid: string; unit: string;
  rangeMin: number; rangeMax: number;
}) {
  const [hovIdx, setHovIdx] = useState<number | null>(null);

  if (values.length < 2) return <div style={{height: 24}} />;
  const W = 100, H = 44, pad = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [
    pad + (i / (values.length - 1)) * (W - 2 * pad),
    H - pad - ((v - min) / span) * (H - 2 * pad),
  ]);
  const polyline = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = [
    `M${pts[0][0].toFixed(1)},${H}`,
    ...pts.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`),
    `L${pts[pts.length - 1][0].toFixed(1)},${H}`,
    'Z',
  ].join(' ');
  const gid = `sg-${uid.replace(/[^a-z0-9]/gi, '')}`;

  // Ideal range band: map goodMin/goodMax to SVG y-coords and clamp to chart area
  const toY = (v: number) => H - pad - ((v - min) / span) * (H - 2 * pad);
  const bandTop = Math.min(H - pad, Math.max(pad, toY(rangeMax)));
  const bandBot = Math.min(H - pad, Math.max(pad, toY(rangeMin)));
  const showBand = bandBot > bandTop + 0.5;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    setHovIdx(Math.min(values.length - 1, Math.max(0, Math.round(relX * (values.length - 1)))));
  };

  const hovPt = hovIdx !== null ? pts[hovIdx] : null;
  const tooltipPct = hovIdx !== null ? `${(hovIdx / (values.length - 1)) * 100}%` : '50%';
  const fmtV = (v: number) => Number.isInteger(v) ? String(v) : v.toFixed(1);

  return (
    <div style={{position: 'relative'}}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{width: '100%', height: H, display: 'block', cursor: 'crosshair'}}
        preserveAspectRatio="none"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHovIdx(null)}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.2} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {showBand && (
          <rect
            x={pad} y={bandTop.toFixed(1)}
            width={W - 2 * pad} height={(bandBot - bandTop).toFixed(1)}
            fill="#22c55e" fillOpacity={0.12}
          />
        )}
        <path d={area} fill={`url(#${gid})`} />
        <polyline points={polyline} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        {hovPt && (
          <line
            x1={hovPt[0].toFixed(1)} y1={pad.toString()}
            x2={hovPt[0].toFixed(1)} y2={(H - pad).toString()}
            stroke={color} strokeWidth="0.6" opacity="0.7"
          />
        )}
      </svg>
      {hovIdx !== null && (
        <div style={{
          position: 'absolute',
          bottom: 'calc(100% + 4px)',
          left: tooltipPct,
          transform: 'translateX(-50%)',
          background: 'var(--ifm-background-color)',
          border: `1px solid ${color}`,
          borderRadius: 4,
          padding: '2px 6px',
          fontSize: '0.65rem',
          color: 'var(--ifm-color-content)',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          zIndex: 100,
          lineHeight: 1.5,
          boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        }}>
          {dates[hovIdx]?.slice(5)} {fmtV(values[hovIdx])}{unit}
        </div>
      )}
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = {
  good: '#15803d', warn: '#a16207', bad: '#b91c1c', neutral: '#64748b',
};

const STATUS_LABEL: Record<string, string> = {
  good: '理想', warn: '关注', bad: '偏离', neutral: '观察',
};

const STATUS_CLASS: Record<string, string> = {
  good: styles.dashCardGood, warn: styles.dashCardWarn, bad: styles.dashCardBad, neutral: styles.dashCardNeutral,
};

function DashCardComp({card}: {card: DashCard}) {
  const color = STATUS_COLOR[card.rangeStatus];
  const changeColor = card.changeGood === true ? '#15803d' : card.changeGood === false ? '#b91c1c' : '#64748b';
  const arrow = card.changeDir === 'up' ? '↑' : card.changeDir === 'down' ? '↓' : null;
  return (
    <div className={`${styles.dashCard} ${STATUS_CLASS[card.rangeStatus]}`}>
      <div className={styles.dashCardTop}>
        <span className={styles.dashCardLabel}>{card.label}</span>
        <div className={styles.dashCardMeta}>
          <span className={styles.dashCardStatus} style={{color}}>{STATUS_LABEL[card.rangeStatus]}</span>
          {card.change7d !== '—' && arrow && (
            <span className={styles.dashCardChange} style={{color: changeColor}}>
              {arrow}{card.change7d}
              <span className={styles.dashCardChangePeriod}>7d</span>
            </span>
          )}
        </div>
      </div>
      <div className={styles.dashCardMain}>
        <span className={styles.dashCardValue} style={{color}}>{card.value}</span>
        <span className={styles.dashCardUnit}>{card.unit}</span>
      </div>
      <div className={styles.dashCardRange}>{card.rangeLabel}</div>
      <div className={styles.dashCardSpark}>
        <Sparkline values={card.sparkline} dates={card.sparklineDates} color={color} uid={card.label} unit={card.unit} rangeMin={card.rangeMin} rangeMax={card.rangeMax} />
      </div>
    </div>
  );
}

function FloatingBar() {
  const {scope, setScope, availableMonths, loading, selectedDate} = useContext(YearCtx);
  const years = getVisibleHealthYears(availableMonths, selectedDate).reverse();

  return ReactDOM.createPortal(
    <div className={styles.floatingStack}>
      <div className={styles.floatingBar} role="group" aria-label="健康数据范围模式">
        {(['recent', 'year', 'all'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={`${styles.floatingBtn} ${scope.mode === mode ? styles.floatingBtnActive : ''}`}
            aria-pressed={scope.mode === mode}
            onClick={() => {
              if (mode === 'recent') setScope({mode, range: scope.mode === 'recent' ? scope.range : '30d'});
              if (mode === 'year') setScope({mode, year: scope.mode === 'year' ? scope.year : (years[0] ?? new Date().getFullYear())});
              if (mode === 'all') setScope({mode});
            }}
          >{mode === 'recent' ? '最近' : mode === 'year' ? '按年' : '全部记录'}</button>
        ))}
      </div>
      <div className={`${styles.floatingBar} ${styles.floatingOptionBar}`} role="group" aria-label="健康数据范围选项">
        {scope.mode === 'recent' && (Object.keys(RANGE_DAYS) as RecentRange[]).map((r) => (
          <button
            key={r}
            type="button"
            className={`${styles.floatingBtn} ${scope.range === r ? styles.floatingBtnActive : ''}`}
            aria-pressed={scope.range === r}
            onClick={() => setScope({mode: 'recent', range: r})}
          >{RANGE_LABELS[r]}</button>
        ))}
        {scope.mode === 'year' && years.map((y) => (
          <button
            key={y}
            type="button"
            className={`${styles.floatingBtn} ${scope.year === y ? styles.floatingBtnActive : ''}`}
            aria-pressed={scope.year === y}
            onClick={() => setScope({mode: 'year', year: y})}
          >{y}</button>
        ))}
        {scope.mode === 'all' && (
          <button type="button" className={`${styles.floatingBtn} ${styles.floatingBtnActive}`} aria-pressed="true" onClick={() => setScope({mode: 'all'})}>
            全部历史
          </button>
        )}
        {loading && <span className={styles.floatingLoading} role="status" aria-live="polite">加载中…</span>}
      </div>
    </div>,
    document.body,
  );
}

function ScopeControlsInner() {
  const {scope, setScope, availableMonths, loading, selectedDate} = useContext(YearCtx);
  const years = getVisibleHealthYears(availableMonths, selectedDate).reverse();

  return (
    <div className={styles.scopeControls} aria-label="健康数据时间范围">
      <div className={styles.scopeBar} role="group" aria-label="健康数据范围模式">
        {(['recent', 'year', 'all'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={`${styles.scopeBtn} ${scope.mode === mode ? styles.scopeBtnActive : ''}`}
            aria-pressed={scope.mode === mode}
            onClick={() => {
              if (mode === 'recent') setScope({mode, range: scope.mode === 'recent' ? scope.range : '30d'});
              if (mode === 'year') setScope({mode, year: scope.mode === 'year' ? scope.year : (years[0] ?? new Date().getFullYear())});
              if (mode === 'all') setScope({mode});
            }}
          >
            {mode === 'recent' ? '最近' : mode === 'year' ? '按年' : '全部记录'}
          </button>
        ))}
      </div>
      <div className={`${styles.scopeBar} ${styles.scopeOptionBar}`} role="group" aria-label="健康数据范围选项">
        {scope.mode === 'recent' && (Object.keys(RANGE_DAYS) as RecentRange[]).map((range) => (
          <button
            key={range}
            type="button"
            className={`${styles.scopeBtn} ${scope.range === range ? styles.scopeBtnActive : ''}`}
            aria-pressed={scope.range === range}
            onClick={() => setScope({mode: 'recent', range})}
          >
            {RANGE_LABELS[range]}
          </button>
        ))}
        {scope.mode === 'year' && years.map((year) => (
          <button
            key={year}
            type="button"
            className={`${styles.scopeBtn} ${scope.mode === 'year' && scope.year === year ? styles.scopeBtnActive : ''}`}
            aria-pressed={scope.mode === 'year' && scope.year === year}
            onClick={() => setScope({mode: 'year', year})}
          >
            {year}
          </button>
        ))}
        {scope.mode === 'all' && (
          <button type="button" className={`${styles.scopeBtn} ${styles.scopeBtnActive}`} aria-pressed="true" onClick={() => setScope({mode: 'all'})}>
            全部历史
          </button>
        )}
        {loading && <span className={styles.scopeLoading} role="status" aria-live="polite">加载中…</span>}
      </div>
    </div>
  );
}

function StatsInner() {
  const {scope, data, availableMonths, loading} = useContext(YearCtx);
  if (loading) {
    return (
      <>
        <FloatingBar />
        <div className={styles.statsLoading} role="status" aria-live="polite">健康摘要加载中…</div>
      </>
    );
  }
  const dashboard = computeDashboard(data);
  const dateRange = getDateRange(data);
  const noData = !loading && scope.mode === 'year' && !(scope.year in availableMonths);

  const lastUpdated = data.lastUpdated
    ? (() => {
        const d = new Date(data.lastUpdated!);
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      })()
    : null;

  return (
    <>
      <FloatingBar />
      {!noData && dateRange && (
        <div className={styles.dateRange}>
          {dateRange}
          {lastUpdated && <span className={styles.lastUpdated}>（{lastUpdated} 更新）</span>}
        </div>
      )}
      {!noData && dashboard.length > 0 && (
        <div className={styles.dashGrid}>
          {dashboard.map((card) =><DashCardComp key={card.label} card={card} />)}
        </div>
      )}
    </>
  );
}

function LazyHealthChart({
  label,
  optionBuilder,
  data,
  axisDates,
  isDark,
  isMobile,
  selectedDate,
  onDateSelect,
}: {
  label: string;
  optionBuilder: OptionFn;
  data: HealthData;
  axisDates: string[];
  isDark: boolean;
  isMobile: boolean;
  selectedDate?: string;
  onDateSelect?: (date: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldRender, setShouldRender] = useState(false);
  const height = chartHeight(label, isMobile);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setShouldRender(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry], activeObserver) => {
        if (!entry.isIntersecting) return;
        setShouldRender(true);
        activeObserver.disconnect();
      },
      {rootMargin: '480px 0px', threshold: 0.01},
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const chartState = useMemo<{status: 'ready'; option: Record<string, unknown>} | {status: 'empty'} | null>(() => {
    if (!shouldRender) return null;
    const sourceOption = optionBuilder(isDark, data, isMobile);
    if (!optionHasData(sourceOption)) return {status: 'empty'};
    const rawOption = alignCalendarRange(
      alignDateCategoryAxes(sourceOption, axisDates),
      axisDates,
    );
    const styledOption = applyHealthChartStyle(
      addSelectedDateHighlight(
        addWeekends(addTodayLatestHighlight(rawOption, isDark), isDark),
        selectedDate,
        isDark,
      ),
      isDark,
    ) as Record<string, unknown>;
    return {status: 'ready', option: {...styledOption, animation: axisDates.length <= 90}};
  }, [axisDates, data, isDark, isMobile, optionBuilder, selectedDate, shouldRender]);

  const chartEvents = useMemo(() => {
    if (!onDateSelect || chartState?.status !== 'ready') return undefined;
    const {option} = chartState;
    return {
      click: (params: unknown) => {
        const date = extractDateFromChartEvent(params) || extractDateFromChartOption(option, params);
        if (date) onDateSelect(date);
      },
    };
  }, [chartState, onDateSelect]);

  function bindChartClick(chart: ChartLike) {
    const previous = zrenderClickHandlers.get(chart);
    if (previous) chart.getZr().off('click', previous);
    if (!onDateSelect) return;

    const handler = (params: unknown) => {
      const date = extractDateFromZrenderClick(chart, params);
      if (date) onDateSelect(date);
    };
    zrenderClickHandlers.set(chart, handler);
    chart.getZr().on('click', handler);
  }

  return (
    <div
      ref={containerRef}
      id={healthChartAnchorId(label)}
      className={styles.section}
      role="img"
      aria-label={`${label}图表${chartState?.status === 'empty' ? '，当前时间范围暂无数据' : ''}`}
    >
      <div className={styles.sectionTitle}>{label}</div>
      {chartState?.status === 'ready' ? (
        <ReactECharts
          option={chartState.option}
          theme={isDark ? 'dark' : undefined}
          style={{height}}
          opts={ECHARTS_RENDERER_OPTIONS}
          notMerge
          lazyUpdate
          onEvents={chartEvents}
          onChartReady={bindChartClick}
        />
      ) : chartState?.status === 'empty' ? (
        <div className={styles.chartEmpty} style={{height}}>当前时间范围暂无数据</div>
      ) : (
        <div className={styles.chartPlaceholder} style={{height}} aria-hidden="true" />
      )}
    </div>
  );
}

function ChartCollectionInner({charts}: {charts: Array<{label: string; opt: OptionFn}>}) {
  const {data, axisDates, loading, scope, availableMonths, onDateSelect, selectedDate} = useContext(YearCtx);
  const {colorMode} = useColorMode();
  const isDark = colorMode === 'dark';
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const handle = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    setIsMobile(media.matches);
    media.addEventListener('change', handle);
    return () => media.removeEventListener('change', handle);
  }, []);

  if (loading) {
    const reservedHeight = charts.length * (chartHeight('', isMobile) + 42) + Math.max(0, charts.length - 1) * 12;
    return <div className={styles.loading} style={{minHeight: reservedHeight}} role="status" aria-live="polite">健康图表加载中…</div>;
  }
  const noData = !hasHealthData(data);
  if (noData) {
    const label = scope.mode === 'year' && !(scope.year in availableMonths) ? `${scope.year} 年` : '当前时间范围';
    return <div className={styles.noData}>暂无 {label}健康数据</div>;
  }

  return (
    <div className={styles.wrap} aria-busy={loading}>
      {charts.map(({label, opt}: {label: string; opt: OptionFn}) => (
        <LazyHealthChart
          key={label}
          label={label}
          optionBuilder={opt}
          data={data}
          axisDates={axisDates}
          isDark={isDark}
          isMobile={isMobile}
          selectedDate={selectedDate}
          onDateSelect={onDateSelect}
        />
      ))}
    </div>
  );
}

function SectionInner({name}: {name: string}) {
  const section = SECTIONS.find((item) => item.title === name);
  return section ? <ChartCollectionInner charts={section.charts} /> : null;
}

function ChartSelectionInner({chartIds}: {chartIds: string[]}) {
  const charts = chartIds
    .map((id) => HEALTH_CHART_REGISTRY.get(id))
    .filter((chart): chart is {label: string; opt: OptionFn} => Boolean(chart));
  return charts.length ? <ChartCollectionInner charts={charts} /> : null;
}

// ── exports ───────────────────────────────────────────────────────────────────

export function HealthProvider({
  children,
  onDateSelect,
  selectedDate,
  scope,
  setScope,
}: {
  children: React.ReactNode;
  onDateSelect?: (date: string) => void;
  selectedDate?: string;
  scope?: TimeScope;
  setScope?: (scope: TimeScope) => void;
}) {
  return (
    <BrowserOnly fallback={<>{children}</>}>
      {() => (
        <HealthProviderInner onDateSelect={onDateSelect} selectedDate={selectedDate} scope={scope} setScope={setScope}>
          {children}
        </HealthProviderInner>
      )}
    </BrowserOnly>
  );
}

export function HealthStats() {
  return (
    <BrowserOnly fallback={<div style={{minHeight: 80}} />}>
      {() => <StatsInner />}
    </BrowserOnly>
  );
}

export function HealthScopeControls() {
  return (
    <BrowserOnly fallback={<div style={{minHeight: 36}} />}>
      {() => <ScopeControlsInner />}
    </BrowserOnly>
  );
}

export function HealthSection({name}: {name: string}) {
  return (
    <BrowserOnly fallback={<div style={{minHeight: 240}} />}>
      {() => <SectionInner name={name} />}
    </BrowserOnly>
  );
}

export function HealthChartSelection({chartIds}: {chartIds: string[]}) {
  return (
    <BrowserOnly fallback={<div style={{minHeight: 240}} />}>
      {() => <ChartSelectionInner chartIds={chartIds} />}
    </BrowserOnly>
  );
}

export {HealthAnalysis} from './HealthAnalysis';

export default HealthSection;
