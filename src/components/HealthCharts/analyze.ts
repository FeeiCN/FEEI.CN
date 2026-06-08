// Pure analysis utilities over HealthData — pairwise correlation, lag
// correlation, k-means day clustering, and rule-based auto-insights.
// Browser-side only; all inputs already aligned to a single timezone.

import type {HealthData} from './transform';

type Series = [string, number][];

export type MetricSpec = {
  key: string;
  label: string;
  unit?: string;
  direction: 'high-better' | 'low-better' | 'neutral';
  extract: (D: HealthData) => Series;
};

function mean(arr: number[]): number {
  if (!arr.length) return 0;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  let s = 0;
  for (const v of arr) s += (v - m) * (v - m);
  return Math.sqrt(s / arr.length);
}

function moodSeries(D: HealthData): Series {
  if (!D.state_of_mind.length) return [];
  const buckets = new Map<string, {sum: number; n: number}>();
  for (const row of D.state_of_mind) {
    const d = row[0];
    const v = row[1];
    if (typeof d !== 'string' || d.length < 10 || !Number.isFinite(v)) continue;
    const cur = buckets.get(d) ?? {sum: 0, n: 0};
    cur.sum += v;
    cur.n += 1;
    buckets.set(d, cur);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([d, {sum, n}]) => [d, sum / Math.max(1, n)] as [string, number]);
}

function simpleSeries(arr: Array<readonly [string, number, ...unknown[]]> | undefined): Series {
  if (!arr?.length) return [];
  const out: Series = [];
  for (const row of arr) {
    const d = row[0];
    const v = row[1];
    if (typeof d === 'string' && d.length >= 10 && Number.isFinite(v)) out.push([d, v]);
  }
  return out;
}

export const METRICS: MetricSpec[] = [
  {key: 'sleep_total', label: '睡眠', unit: 'h', direction: 'high-better',
    extract: (D) => simpleSeries(D.sleep)},
  {key: 'sleep_deep', label: '深睡', unit: 'h', direction: 'high-better',
    extract: (D) => simpleSeries(D.sleep.map((r) => [r[0], r[2]] as [string, number]))},
  {key: 'sleep_rem', label: 'REM', unit: 'h', direction: 'high-better',
    extract: (D) => simpleSeries(D.sleep.map((r) => [r[0], r[3]] as [string, number]))},
  {key: 'rhr', label: '静息心率', unit: 'bpm', direction: 'low-better',
    extract: (D) => simpleSeries(D.rhr)},
  {key: 'hrv', label: 'HRV', unit: 'ms', direction: 'high-better',
    extract: (D) => simpleSeries(D.hrv)},
  {key: 'steps', label: '步数', unit: '步', direction: 'high-better',
    extract: (D) => simpleSeries(D.steps)},
  {key: 'exercise', label: '运动时长', unit: 'min', direction: 'high-better',
    extract: (D) => simpleSeries(D.exercise)},
  {key: 'active_energy', label: '活跃热量', unit: 'kcal', direction: 'high-better',
    extract: (D) => simpleSeries(D.energy_active)},
  {key: 'stand_time', label: '站立时间', unit: 'h', direction: 'high-better',
    extract: (D) => simpleSeries(D.stand_time).map(([d, v]) => [d, v / 60] as [string, number])},
  {key: 'weight', label: '体重', unit: '斤', direction: 'low-better',
    extract: (D) => simpleSeries(D.weight).map(([d, v]) => [d, v * 2] as [string, number])},
  {key: 'spo2', label: '血氧', unit: '%', direction: 'high-better',
    extract: (D) => simpleSeries(D.spo2)},
  {key: 'resp_rate', label: '呼吸频率', unit: '次/分', direction: 'low-better',
    extract: (D) => simpleSeries(D.resp_rate)},
  {key: 'mood', label: '愉悦度', direction: 'neutral',
    extract: (D) => moodSeries(D)},
  {key: 'mindful', label: '正念', unit: 'min', direction: 'high-better',
    extract: (D) => simpleSeries(D.mindful)},
];

export const ANALYSIS_METRIC_KEYS = new Set(METRICS.map((m) => m.key));

export type PairResult = {
  i: number;
  j: number;
  r: number;
  rho: number;
  n: number;
};

export type CorrelationResult = {
  metrics: {key: string; label: string; unit?: string; direction: MetricSpec['direction']}[];
  values: number[][];
  spearman: number[][];
  counts: number[][];
  pairs: PairResult[];
};

function indexByDate(arr: Series): Map<string, number> {
  const m = new Map<string, number>();
  for (const [d, v] of arr) m.set(d, v);
  return m;
}

function alignPair(a: Series, b: Series): {xs: number[]; ys: number[]} {
  const mb = indexByDate(b);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [d, v] of a) {
    const y = mb.get(d);
    if (y !== undefined) {
      xs.push(v);
      ys.push(y);
    }
  }
  return {xs, ys};
}

function alignPairWithLag(a: Series, b: Series, lag: number): {xs: number[]; ys: number[]} {
  // corr(a(t), b(t + lag))
  const ma = indexByDate(a);
  const mb = indexByDate(b);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [d, va] of a) {
    const target = new Date(`${d}T00:00:00`);
    target.setDate(target.getDate() + lag);
    const ds = target.toISOString().slice(0, 10);
    const yb = mb.get(ds);
    const xa = ma.get(d);
    if (xa !== undefined && yb !== undefined) {
      xs.push(xa);
      ys.push(yb);
    }
  }
  return {xs, ys};
}

export function pearson(xs: number[], ys: number[]): {r: number; n: number} {
  const n = xs.length;
  if (n < 3) return {r: 0, n};
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  if (denom === 0) return {r: 0, n};
  return {r: num / denom, n};
}

function rank(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const ranks = new Array<number>(xs.length);
  for (let i = 0; i < idx.length; i++) {
    ranks[idx[i][1]] = i + 1;
  }
  return ranks;
}

export function spearman(xs: number[], ys: number[]): {rho: number; n: number} {
  const rx = rank(xs);
  const ry = rank(ys);
  const {r, n} = pearson(rx, ry);
  return {rho: r, n};
}

export function computeCorrelations(D: HealthData, minOverlap = 10): CorrelationResult {
  const series = METRICS.map((m) => m.extract(D));
  const k = series.length;
  const values: number[][] = Array.from({length: k}, () => new Array<number>(k).fill(0));
  const sp: number[][] = Array.from({length: k}, () => new Array<number>(k).fill(0));
  const counts: number[][] = Array.from({length: k}, () => new Array<number>(k).fill(0));
  const pairs: PairResult[] = [];

  for (let i = 0; i < k; i++) {
    for (let j = i; j < k; j++) {
      const {xs, ys} = alignPair(series[i], series[j]);
      const {r, n} = pearson(xs, ys);
      const {rho} = spearman(xs, ys);
      values[i][j] = r;
      values[j][i] = r;
      sp[i][j] = rho;
      sp[j][i] = rho;
      counts[i][j] = n;
      counts[j][i] = n;
      if (i !== j && n >= minOverlap) {
        pairs.push({i, j, r, rho, n});
      }
    }
  }

  return {
    metrics: METRICS.map((m) => ({key: m.key, label: m.label, unit: m.unit, direction: m.direction})),
    values, spearman: sp, counts, pairs,
  };
}

// ── Lag correlation ──────────────────────────────────────────────────────────

export type LagPairSpec = {cause: string; effect: string; maxLag?: number; minN?: number};

export const DEFAULT_LAG_PAIRS: LagPairSpec[] = [
  {cause: 'sleep_total', effect: 'rhr'},
  {cause: 'sleep_total', effect: 'hrv'},
  {cause: 'steps', effect: 'rhr'},
  {cause: 'steps', effect: 'hrv'},
  {cause: 'steps', effect: 'sleep_total'},
  {cause: 'exercise', effect: 'rhr'},
  {cause: 'exercise', effect: 'hrv'},
  {cause: 'exercise', effect: 'sleep_total'},
  {cause: 'active_energy', effect: 'rhr'},
  {cause: 'stand_time', effect: 'rhr'},
  {cause: 'mindful', effect: 'mood'},
];

export type LagPoint = {lag: number; r: number; n: number};
export type LagResult = {
  cause: string;
  causeLabel: string;
  effect: string;
  effectLabel: string;
  series: LagPoint[];
  bestLag: number;
  bestR: number;
  bestN: number;
};

export function computeLagCorrelations(
  D: HealthData,
  pairs: LagPairSpec[] = DEFAULT_LAG_PAIRS,
): LagResult[] {
  const lookup = new Map(METRICS.map((m) => [m.key, m]));
  const results: LagResult[] = [];
  for (const p of pairs) {
    const cause = lookup.get(p.cause);
    const effect = lookup.get(p.effect);
    if (!cause || !effect) continue;
    const cs = cause.extract(D);
    const es = effect.extract(D);
    if (!cs.length || !es.length) continue;
    const maxLag = p.maxLag ?? 7;
    const minN = p.minN ?? 8;
    const series: LagPoint[] = [];
    let bestLag = 0;
    let bestR = 0;
    let bestN = 0;
    for (let lag = 0; lag <= maxLag; lag++) {
      const {xs, ys} = alignPairWithLag(cs, es, lag);
      const {r, n} = pearson(xs, ys);
      series.push({lag, r, n});
      if (n >= minN && Math.abs(r) > Math.abs(bestR)) {
        bestR = r;
        bestLag = lag;
        bestN = n;
      }
    }
    if (bestN >= minN) {
      results.push({
        cause: cause.key, causeLabel: cause.label,
        effect: effect.key, effectLabel: effect.label,
        series, bestLag, bestR, bestN,
      });
    }
  }
  return results.sort((a, b) => Math.abs(b.bestR) - Math.abs(a.bestR));
}

// ── KMeans clustering ────────────────────────────────────────────────────────

export type Cluster = {
  index: number;
  count: number;
  centroid: number[];
  meanProfile: {key: string; label: string; mean: number; std: number; delta: number}[];
  distinctive: string[];
  label: string;
};

export type ClusterResult = {
  k: number;
  clusters: Cluster[];
  assignment: Map<string, number>;
};

const CLUSTER_KEYS = ['sleep_total', 'rhr', 'hrv', 'steps', 'exercise', 'mood'];

function buildDayVectors(D: HealthData): {dates: string[]; matrix: number[][]; means: number[]; stds: number[]} {
  const series = CLUSTER_KEYS.map((k) => {
    const m = METRICS.find((x) => x.key === k);
    if (!m) return new Map<string, number>();
    return indexByDate(m.extract(D));
  });
  const dateSet = new Set<string>();
  for (const s of series) for (const d of s.keys()) dateSet.add(d);
  const dates = [...dateSet].sort();
  const matrix: number[][] = [];
  for (const d of dates) {
    const row: number[] = [];
    for (const s of series) row.push(s.get(d) ?? NaN);
    matrix.push(row);
  }
  const means: number[] = [];
  const stds: number[] = [];
  for (let j = 0; j < CLUSTER_KEYS.length; j++) {
    const col: number[] = [];
    for (const row of matrix) if (Number.isFinite(row[j])) col.push(row[j]);
    means.push(mean(col));
    stds.push(stddev(col) || 1);
  }
  const standardized = matrix.map((row) => row.map((v, j) => Number.isFinite(v) ? (v - means[j]) / stds[j] : 0));
  return {dates, matrix: standardized, means, stds};
}

function kmeans(matrix: number[][], k: number, maxIter = 25, seed = 42): {centroids: number[][]; assign: number[]} {
  const n = matrix.length;
  if (n < k) return {centroids: [], assign: []};
  const dim = matrix[0].length;
  let rng = seed >>> 0;
  const next = () => { rng = (rng * 1664525 + 1013904223) >>> 0; return rng / 0xffffffff; };
  const centroids: number[][] = [];
  centroids.push(matrix[Math.floor(next() * n)].slice());
  while (centroids.length < k) {
    const dists = matrix.map((p) => {
      let best = Infinity;
      for (const c of centroids) {
        let s = 0;
        for (let j = 0; j < dim; j++) s += (p[j] - c[j]) ** 2;
        if (s < best) best = s;
      }
      return best;
    });
    const total = dists.reduce((a, b) => a + b, 0);
    if (total === 0) {
      centroids.push(matrix[Math.floor(next() * n)].slice());
      continue;
    }
    let pick = next() * total;
    let idx = 0;
    for (; idx < dists.length; idx++) {
      pick -= dists[idx];
      if (pick <= 0) break;
    }
    centroids.push(matrix[Math.min(n - 1, idx)].slice());
  }
  const assign = new Array<number>(n).fill(0);
  for (let it = 0; it < maxIter; it++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let best = Infinity;
      let bestK = 0;
      for (let ck = 0; ck < k; ck++) {
        let s = 0;
        for (let j = 0; j < dim; j++) s += (matrix[i][j] - centroids[ck][j]) ** 2;
        if (s < best) { best = s; bestK = ck; }
      }
      if (assign[i] !== bestK) { assign[i] = bestK; changed = true; }
    }
    const sums = Array.from({length: k}, () => new Array<number>(dim).fill(0));
    const counts = new Array<number>(k).fill(0);
    for (let i = 0; i < n; i++) {
      const c = assign[i];
      counts[c]++;
      for (let j = 0; j < dim; j++) sums[c][j] += matrix[i][j];
    }
    for (let ck = 0; ck < k; ck++) {
      if (counts[ck] === 0) {
        centroids[ck] = matrix[Math.floor(next() * n)].slice();
        continue;
      }
      for (let j = 0; j < dim; j++) centroids[ck][j] = sums[ck][j] / counts[ck];
    }
    if (!changed) break;
  }
  return {centroids, assign};
}

function labelCluster(profile: {key: string; label: string; delta: number}[]): string {
  const sorted = [...profile].sort((a, b) => b.delta - a.delta);
  const high = sorted[0];
  const low = sorted[sorted.length - 1];
  if (high && low && Math.abs(high.delta) > 0.5 && Math.abs(low.delta) > 0.5) {
    return `${low.label}低 / ${high.label}高`;
  }
  if (high && Math.abs(high.delta) > 0.5) return `${high.label}突出`;
  if (low && Math.abs(low.delta) > 0.5) return `${low.label}偏低`;
  return '常规日';
}

export function computeClusters(D: HealthData, k = 3): ClusterResult | null {
  const {dates, matrix, means, stds} = buildDayVectors(D);
  if (matrix.length < k * 3) return null;
  const {centroids, assign} = kmeans(matrix, k);
  if (!centroids.length) return null;
  const clusters: Cluster[] = [];
  for (let ck = 0; ck < k; ck++) {
    const indices: number[] = [];
    for (let i = 0; i < assign.length; i++) if (assign[i] === ck) indices.push(i);
    const meanProfile = CLUSTER_KEYS.map((key, j) => {
      const spec = METRICS.find((m) => m.key === key);
      if (!spec) {
        return {key, label: key, mean: 0, std: 0, delta: 0};
      }
      const dimVals: number[] = [];
      for (const i of indices) {
        const raw = matrix[i][j] * stds[j] + means[j];
        dimVals.push(raw);
      }
      const m = mean(dimVals);
      const s = stddev(dimVals);
      const delta = stds[j] === 0 ? 0 : (m - means[j]) / stds[j];
      return {key, label: spec.label, mean: m, std: s, delta};
    });
    const distinctive = meanProfile
      .filter((p) => Math.abs(p.delta) > 0.6)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .map((p) => `${p.label}${p.delta > 0 ? '↑' : '↓'}`);
    clusters.push({
      index: ck,
      count: indices.length,
      centroid: centroids[ck],
      meanProfile,
      distinctive,
      label: labelCluster(meanProfile.map((p) => ({key: p.key, label: p.label, delta: p.delta}))),
    });
  }
  clusters.sort((a, b) => b.count - a.count);
  const assignment = new Map<string, number>();
  for (let i = 0; i < assign.length; i++) {
    const c = clusters.findIndex((cc) => cc.index === assign[i]);
    if (c >= 0) assignment.set(dates[i], c);
  }
  return {k, clusters, assignment};
}

// ── Auto insights ────────────────────────────────────────────────────────────

export type InsightCategory = 'correlation' | 'lag' | 'cluster' | 'trend' | 'coverage';
export type Insight = {
  category: InsightCategory;
  priority: number;
  text: string;
};

function fmtDelta(value: number, unit?: string, decimals = 2): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const formatted = abs >= 100 ? value.toFixed(0) : abs >= 10 ? value.toFixed(1) : value.toFixed(decimals);
  return unit ? `${formatted}${unit}` : formatted;
}

function trend(series: Series, days: number): {change: number; recent: number; baseline: number} | null {
  if (series.length < days * 2) return null;
  const recent = series.slice(-days);
  const baseline = series.slice(-days * 2, -days);
  if (!recent.length || !baseline.length) return null;
  const rm = mean(recent.map(([, v]) => v));
  const bm = mean(baseline.map(([, v]) => v));
  return {change: rm - bm, recent: rm, baseline: bm};
}

function datesTotal(c: ClusterResult): number {
  let s = 0;
  for (const cl of c.clusters) s += cl.count;
  return s;
}

export function generateInsights(
  D: HealthData,
  corr: CorrelationResult,
  lag: LagResult[],
  clusters: ClusterResult | null,
  rangeDays: number,
): Insight[] {
  const out: Insight[] = [];
  const lookup = new Map(corr.metrics.map((m, idx) => [m.key, {idx, ...m}]));

  for (const p of corr.pairs) {
    if (Math.abs(p.r) < 0.4 || p.n < Math.max(10, rangeDays * 0.4)) continue;
    const a = corr.metrics[p.i];
    const b = corr.metrics[p.j];
    const dir = p.r > 0 ? '正相关' : '负相关';
    const strength = Math.abs(p.r) >= 0.7 ? '强' : Math.abs(p.r) >= 0.5 ? '明显' : '中等';
    out.push({
      category: 'correlation',
      priority: Math.abs(p.r) * 100,
      text: `${a.label} 与 ${b.label} 呈${strength}${dir}（r=${p.r.toFixed(2)}，n=${p.n}）`,
    });
  }

  for (const l of lag) {
    if (l.bestLag === 0 || Math.abs(l.bestR) < 0.3) continue;
    const dir = l.bestR > 0 ? '正向' : '反向';
    out.push({
      category: 'lag',
      priority: Math.abs(l.bestR) * 90 + (l.bestLag > 0 ? 10 : 0),
      text: `${l.causeLabel} 在 ${l.bestLag} 天后对 ${l.effectLabel} 仍有 ${dir}影响（r=${l.bestR.toFixed(2)}，n=${l.bestN}）`,
    });
  }

  if (clusters) {
    const total = datesTotal(clusters);
    for (const c of clusters.clusters) {
      if (c.count < 3 || !c.distinctive.length) continue;
      const pct = Math.round((c.count / Math.max(1, total)) * 100);
      out.push({
        category: 'cluster',
        priority: 60 + c.count,
        text: `约 ${pct}% 的日子属于「${c.label}」，${c.distinctive.slice(0, 3).join('、')} 偏离均值最明显`,
      });
    }
  }

  const trendTargets = ['rhr', 'hrv', 'weight', 'steps', 'sleep_total', 'mood'];
  for (const key of trendTargets) {
    const spec = lookup.get(key);
    if (!spec) continue;
    const series = METRICS[spec.idx].extract(D);
    const tr = trend(series, Math.max(7, Math.floor(rangeDays / 3)));
    if (!tr) continue;
    if (Math.abs(tr.change) < Math.abs(tr.baseline) * 0.05) continue;
    const dir = tr.change > 0 ? '上升' : '下降';
    const unit = METRICS[spec.idx].unit ?? '';
    out.push({
      category: 'trend',
      priority: 40,
      text: `近期 ${spec.label} 较前半段 ${dir} ${fmtDelta(tr.change, unit)}（近期均值 ${fmtDelta(tr.recent, unit)}）`,
    });
  }

  const coveredDays = corr.pairs.length ? Math.max(...corr.pairs.map((p) => p.n)) : 0;
  if (coveredDays && rangeDays && coveredDays / rangeDays < 0.5) {
    out.push({
      category: 'coverage',
      priority: 10,
      text: `本时段内多指标重合样本较少（最多 ${coveredDays}/${rangeDays} 天），结论置信度有限`,
    });
  }

  return out.sort((a, b) => b.priority - a.priority).slice(0, 12);
}
