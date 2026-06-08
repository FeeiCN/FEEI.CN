import React, {useContext, useEffect, useMemo, useState} from 'react';
import {useColorMode} from '@docusaurus/theme-common';
import ReactECharts from 'echarts-for-react';
import {
  computeCorrelations,
  computeLagCorrelations,
  computeClusters,
  generateInsights,
  type CorrelationResult,
  type LagResult,
  type ClusterResult,
  type Insight,
} from './analyze';
import {YearCtx} from './index-shared';
import styles from './styles.module.css';

const INSIGHT_TAG_LABEL: Record<Insight['category'], string> = {
  correlation: '关联',
  lag: '滞后',
  cluster: '聚类',
  trend: '趋势',
  coverage: '数据',
};

const INSIGHT_CARD_CLASS: Record<Insight['category'], string> = {
  correlation: styles.insightCorrelation ?? '',
  lag: styles.insightLag ?? '',
  cluster: styles.insightCluster ?? '',
  trend: styles.insightTrend ?? '',
  coverage: styles.insightCoverage ?? '',
};

const INSIGHT_TAG_CLASS: Record<Insight['category'], string> = {
  correlation: styles.insightTagCorrelation ?? '',
  lag: styles.insightTagLag ?? '',
  cluster: styles.insightTagCluster ?? '',
  trend: styles.insightTagTrend ?? '',
  coverage: styles.insightTagCoverage ?? '',
};

const MAX_METRICS_HEATMAP = 12;
const RANGE_DAYS: Record<string, number> = {'7d': 7, '30d': 30, '90d': 90, '1y': 365};

function analysisEnabled(scope: {mode: string; range?: string; year?: number}): {enabled: boolean; days: number} {
  if (scope.mode === 'recent' && scope.range) {
    return {enabled: true, days: RANGE_DAYS[scope.range] ?? 30};
  }
  if (scope.mode === 'year') {
    return {enabled: true, days: 366};
  }
  return {enabled: false, days: 0};
}

function correlationHeatmapOption(isDark: boolean, corr: CorrelationResult): object {
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const labels = corr.metrics.map((m) => m.label);
  const data: [number, number, number][] = [];
  for (let i = 0; i < corr.metrics.length; i++) {
    for (let j = 0; j < corr.metrics.length; j++) {
      data.push([j, i, Number(corr.values[i][j].toFixed(2))]);
    }
  }
  return {
    backgroundColor: 'transparent',
    tooltip: {
      position: 'top',
      backgroundColor: isDark ? 'rgba(15,23,42,0.96)' : 'rgba(255,255,255,0.96)',
      borderColor: isDark ? 'rgba(148,163,184,0.22)' : 'rgba(100,116,139,0.18)',
      borderWidth: 1,
      textStyle: {color: isDark ? '#e2e8f0' : '#334155', fontSize: 12},
      formatter: (p: {value: [number, number, number]}) => {
        const [x, y, r] = p.value;
        return `${labels[y]} ↔ ${labels[x]}<br/>r = ${r.toFixed(2)}<br/>n = ${corr.counts[y][x]}`;
      },
    },
    grid: {top: 6, left: 6, right: 60, bottom: 6, containLabel: true},
    xAxis: {
      type: 'category',
      data: labels,
      splitArea: {show: true},
      axisLabel: {
        color: isDark ? '#94a3b8' : '#64748b',
        fontSize: isMobile ? 9 : 10,
        rotate: isMobile ? 60 : 45,
        interval: 0,
      },
      axisLine: {show: false},
      axisTick: {show: false},
    },
    yAxis: {
      type: 'category',
      data: labels,
      splitArea: {show: true},
      axisLabel: {color: isDark ? '#94a3b8' : '#64748b', fontSize: isMobile ? 9 : 10},
      axisLine: {show: false},
      axisTick: {show: false},
    },
    visualMap: {
      min: -1, max: 1,
      calculable: true,
      orient: 'vertical', right: 0, top: 'center',
      itemWidth: 10, itemHeight: 80,
      textStyle: {color: isDark ? '#94a3b8' : '#64748b', fontSize: 10},
      inRange: {color: isDark ? ['#1e3a8a', '#0f172a', '#7f1d1d'] : ['#3b82f6', '#f8fafc', '#ef4444']},
    },
    series: [{
      name: '相关',
      type: 'heatmap',
      data,
      label: {
        show: !isMobile,
        fontSize: 9,
        color: isDark ? '#e2e8f0' : '#1e293b',
        formatter: (p: {value: [number, number, number]}) => {
          const v = p.value[2];
          return Math.abs(v) >= 0.4 ? v.toFixed(2) : '';
        },
      },
      itemStyle: {borderColor: isDark ? '#0f172a' : '#ffffff', borderWidth: 1},
    }],
  };
}

function lagChartOption(isDark: boolean, lags: LagResult[]): object {
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const palette = ['#16a34a', '#0d9488', '#f97316', '#0891b2', '#db2777', '#eab308', '#64748b', '#22c55e', '#0ea5e9', '#f59e0b'];
  const top = lags.slice(0, isMobile ? 4 : 6);
  return {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      backgroundColor: isDark ? 'rgba(15,23,42,0.96)' : 'rgba(255,255,255,0.96)',
      borderColor: isDark ? 'rgba(148,163,184,0.22)' : 'rgba(100,116,139,0.18)',
      borderWidth: 1,
      textStyle: {color: isDark ? '#e2e8f0' : '#334155', fontSize: 12},
      formatter: (p: {seriesName: string; value: [string, number]; axisValue: string; marker: string}[]) =>
        `${p[0]?.axisValue ?? ''}<br/>${p.map((x) => `${x.marker}${x.seriesName}：r=${x.value[1].toFixed(2)}`).join('<br/>')}`,
    },
    legend: {
      type: 'scroll',
      top: 4, left: 'center', right: 16,
      textStyle: {color: isDark ? '#94a3b8' : '#64748b', fontSize: 11},
      itemWidth: 14, itemHeight: 8,
      data: top.map((l) => `${l.causeLabel} → ${l.effectLabel}`),
    },
    grid: {top: 40, right: 16, bottom: 28, left: 36, containLabel: true},
    xAxis: {
      type: 'category',
      name: '滞后天数',
      nameLocation: 'middle',
      nameGap: 18,
      nameTextStyle: {color: isDark ? '#94a3b8' : '#64748b', fontSize: 10},
      data: Array.from({length: 8}, (_, i) => String(i)),
      axisLabel: {color: isDark ? '#94a3b8' : '#64748b', fontSize: 10},
      axisLine: {lineStyle: {color: isDark ? 'rgba(148,163,184,0.22)' : 'rgba(100,116,139,0.20)'}},
    },
    yAxis: {
      type: 'value',
      min: -1, max: 1,
      axisLabel: {color: isDark ? '#94a3b8' : '#64748b', fontSize: 10, formatter: (v: number) => v.toFixed(1)},
      splitLine: {lineStyle: {color: isDark ? 'rgba(148,163,184,0.10)' : 'rgba(100,116,139,0.14)'}},
    },
    series: top.map((l, i) => ({
      name: `${l.causeLabel} → ${l.effectLabel}`,
      type: 'line',
      data: l.series.map((p) => [String(p.lag), Number(p.r.toFixed(2))]),
      smooth: true, symbol: 'circle', symbolSize: 6,
      lineStyle: {color: palette[i % palette.length], width: 1.8},
      itemStyle: {color: palette[i % palette.length]},
      markPoint: {
        symbol: 'pin', symbolSize: 24,
        data: [{name: '最佳滞后', coord: [String(l.bestLag), Number(l.bestR.toFixed(2))],
          itemStyle: {color: palette[i % palette.length]},
          label: {show: false},
        }],
      },
    })),
  };
}

function clusterCard(c: {label: string; count: number; distinctive: string[]; meanProfile: {label: string; mean: number; unit?: string}[]}, metrics: Map<string, {unit?: string}>) {
  return (
    <div key={c.label + c.count} className={styles.clusterCard}>
      <div className={styles.clusterLabel}>{c.label}</div>
      <div className={styles.clusterCount}>共 {c.count} 天</div>
      <div className={styles.clusterProfile}>
        {c.meanProfile.slice(0, 5).map((p) => {
          const spec = metrics.get(p.label);
          const unit = spec?.unit ?? p.unit ?? '';
          return (
            <div key={p.label} className={styles.clusterRow}>
              <span className={styles.clusterRowLabel}>{p.label}</span>
              <span className={styles.clusterRowValue}>
                {p.mean.toFixed(unit === '步' ? 0 : 1)}{unit}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function HealthAnalysis() {
  const {scope, data, loading} = useContext(YearCtx);
  const {colorMode} = useColorMode();
  const isDark = colorMode === 'dark';
  const theme = isDark ? 'dark' : undefined;
  const {enabled, days} = analysisEnabled(scope);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const handle = () => setIsMobile(window.innerWidth < 768);
    handle();
    window.addEventListener('resize', handle);
    return () => window.removeEventListener('resize', handle);
  }, []);

  const corr: CorrelationResult | null = useMemo(
    () => enabled && !loading ? computeCorrelations(data, Math.max(7, Math.floor(days * 0.25))) : null,
    [data, enabled, loading, days],
  );
  const lag: LagResult[] = useMemo(
    () => enabled && !loading ? computeLagCorrelations(data) : [],
    [data, enabled, loading],
  );
  const clusters: ClusterResult | null = useMemo(
    () => enabled && !loading ? computeClusters(data) : null,
    [data, enabled, loading],
  );
  const insights: Insight[] = useMemo(() => {
    if (!corr) return [];
    return generateInsights(data, corr, lag, clusters, days);
  }, [data, corr, lag, clusters, days]);

  if (!enabled) {
    return (
      <div className={styles.analysis}>
        <div className={styles.analysisGate}>
          <div className={styles.analysisGateTitle}>关联分析在更短时段内更有意义</div>
          <div>请切换到「近况 / 年度」粒度后查看。</div>
        </div>
      </div>
    );
  }

  if (loading && data.steps.length === 0) {
    return <div className={styles.loading}>分析加载中…</div>;
  }

  if (!corr || corr.metrics.length === 0) {
    return (
      <div className={styles.analysis}>
        <div className={styles.analysisGate}>
          <div className={styles.analysisGateTitle}>当前时段数据不足以分析</div>
          <div>需要至少 7 天带有多指标重合的记录。</div>
        </div>
      </div>
    );
  }

  const heatmapCorr: CorrelationResult = {
    ...corr,
    metrics: corr.metrics.slice(0, MAX_METRICS_HEATMAP),
    values: corr.values.slice(0, MAX_METRICS_HEATMAP).map((row) => row.slice(0, MAX_METRICS_HEATMAP)),
    spearman: corr.spearman.slice(0, MAX_METRICS_HEATMAP).map((row) => row.slice(0, MAX_METRICS_HEATMAP)),
    counts: corr.counts.slice(0, MAX_METRICS_HEATMAP).map((row) => row.slice(0, MAX_METRICS_HEATMAP)),
    pairs: corr.pairs.filter((p) => p.i < MAX_METRICS_HEATMAP && p.j < MAX_METRICS_HEATMAP),
  };
  const metricsMap = new Map(corr.metrics.map((m) => [m.label, m]));

  return (
    <div className={styles.analysis}>
      <div className={styles.analysisSection}>
        <div className={styles.analysisSectionTitle}>
          <span className={styles.analysisSectionLabel}>自动洞察</span>
          <span className={styles.analysisSectionHint}>基于当前 {days} 天数据</span>
        </div>
        {insights.length === 0 ? (
          <div className={styles.analysisGate}>
            <div>未发现显著模式，试试拉长时间窗。</div>
          </div>
        ) : (
          <ul className={styles.insightList}>
            {insights.map((it, idx) => (
              <li key={idx} className={`${styles.insightItem} ${INSIGHT_CARD_CLASS[it.category]}`}>
                <span className={`${styles.insightTag} ${INSIGHT_TAG_CLASS[it.category]}`}>
                  {INSIGHT_TAG_LABEL[it.category]}
                </span>
                <span>{it.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={styles.analysisSection}>
        <div className={styles.analysisSectionTitle}>
          <span className={styles.analysisSectionLabel}>指标相关矩阵</span>
          <span className={styles.analysisSectionHint}>Pearson 系数，颜色越深越相关</span>
        </div>
        <ReactECharts
          option={correlationHeatmapOption(isDark, heatmapCorr)}
          theme={theme}
          style={{height: isMobile ? 320 : 440}}
          opts={{renderer: 'svg'}}
        />
      </div>

      {lag.length > 0 && (
        <div className={styles.analysisSection}>
          <div className={styles.analysisSectionTitle}>
            <span className={styles.analysisSectionLabel}>滞后相关</span>
            <span className={styles.analysisSectionHint}>横轴为天数，pin 标出最佳滞后点</span>
          </div>
          <ReactECharts
            option={lagChartOption(isDark, lag)}
            theme={theme}
            style={{height: isMobile ? 240 : 300}}
            opts={{renderer: 'svg'}}
          />
        </div>
      )}

      {clusters && clusters.clusters.length > 0 && (
        <div className={styles.analysisSection}>
          <div className={styles.analysisSectionTitle}>
            <span className={styles.analysisSectionLabel}>日的典型状态</span>
            <span className={styles.analysisSectionHint}>KMeans 自动聚类，按占比排序</span>
          </div>
          <div className={styles.clusterGrid}>
            {clusters.clusters.map((c) => clusterCard(c, metricsMap))}
          </div>
        </div>
      )}
    </div>
  );
}

export default HealthAnalysis;
