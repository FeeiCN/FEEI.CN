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
  {key: 'fat', label: '体脂率', unit: '%', direction: 'low-better',
    extract: (D) => simpleSeries(D.fat)},
  {key: 'daylight', label: '日晒时间', unit: 'min', direction: 'high-better',
    extract: (D) => simpleSeries(D.daylight)},
  {key: 'flights', label: '爬楼层数', unit: '层', direction: 'high-better',
    extract: (D) => simpleSeries(D.flights)},
  {key: 'walking_hr', label: '步行心率', unit: 'bpm', direction: 'low-better',
    extract: (D) => simpleSeries(D.walking_hr)},
  {key: 'cardio_recovery', label: '心肺恢复', unit: 'bpm', direction: 'high-better',
    extract: (D) => simpleSeries(D.cardio_recovery)},
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
  const series = METRICS.map((m) => prepForCorrelation(m.extract(D), m.key));
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
  {cause: 'daylight', effect: 'mood'},
  {cause: 'daylight', effect: 'sleep_total'},
  {cause: 'daylight', effect: 'rhr'},
  {cause: 'flights', effect: 'rhr'},
  {cause: 'walking_hr', effect: 'rhr'},
  {cause: 'cardio_recovery', effect: 'hrv'},
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
    const cs = prepForCorrelation(cause.extract(D), cause.key);
    const es = prepForCorrelation(effect.extract(D), effect.key);
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

// ── Detrending ───────────────────────────────────────────────────────────────
// Subtract a trailing moving average to remove slow drift (weight, HRV, mood
// etc.). Without this, two slowly-declining series produce a strong spurious
// correlation across long windows.
const DETREND_KEYS = new Set(['weight', 'fat', 'hrv', 'sleep_total', 'sleep_deep', 'sleep_rem', 'mood']);
const DETREND_WINDOW = 14;

export function detrend(series: Series, window = DETREND_WINDOW): Series {
  if (series.length < window * 2) return series;
  const out: Series = [];
  for (let i = 0; i < series.length; i++) {
    const start = Math.max(0, i - window + 1);
    const slice = series.slice(start, i + 1).map(([, v]) => v);
    const m = mean(slice);
    out.push([series[i][0], Number((series[i][1] - m).toFixed(4))]);
  }
  return out;
}

function prepForCorrelation(series: Series, key: string): Series {
  return DETREND_KEYS.has(key) ? detrend(series) : series;
}

// ── Mutual information (non-linear dependency) ──────────────────────────────

function binSeries(xs: number[], ys: number[], bins: number): {bx: number[]; by: number[]} {
  const xmin = Math.min(...xs);
  const xmax = Math.max(...xs);
  const ymin = Math.min(...ys);
  const ymax = Math.max(...ys);
  const xw = (xmax - xmin) / bins || 1;
  const yw = (ymax - ymin) / bins || 1;
  const bx = xs.map((v) => Math.min(bins - 1, Math.floor((v - xmin) / xw)));
  const by = ys.map((v) => Math.min(bins - 1, Math.floor((v - ymin) / yw)));
  return {bx, by};
}

export function mutualInformation(xs: number[], ys: number[], bins = 10): {mi: number; normalized: number; n: number} {
  const n = xs.length;
  if (n < 10) return {mi: 0, normalized: 0, n};
  const {bx, by} = binSeries(xs, ys, bins);
  const joint = new Map<number, number>();
  const margX = new Map<number, number>();
  const margY = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const k = bx[i] * 1000 + by[i];
    joint.set(k, (joint.get(k) ?? 0) + 1);
    margX.set(bx[i], (margX.get(bx[i]) ?? 0) + 1);
    margY.set(by[i], (margY.get(by[i]) ?? 0) + 1);
  }
  let mi = 0;
  for (const [k, c] of joint) {
    const px = (margX.get(Math.floor(k / 1000)) ?? 0) / n;
    const py = (margY.get(k % 1000) ?? 0) / n;
    const pxy = c / n;
    if (px > 0 && py > 0 && pxy > 0) mi += pxy * Math.log(pxy / (px * py));
  }
  const maxMI = Math.log(bins);
  return {mi, normalized: maxMI > 0 ? mi / maxMI : 0, n};
}

export type MIRank = {i: number; j: number; mi: number; normalized: number; r: number; n: number};

export function computeMutualInformation(
  D: HealthData,
  corr: CorrelationResult,
  minN = 10,
): MIRank[] {
  const series = METRICS.map((m) => prepForCorrelation(m.extract(D), m.key));
  const out: MIRank[] = [];
  for (let i = 0; i < series.length; i++) {
    for (let j = i + 1; j < series.length; j++) {
      const n = corr.counts[i][j];
      if (n < minN) continue;
      const {xs, ys} = alignPair(series[i], series[j]);
      if (xs.length < 10) continue;
      const {mi, normalized} = mutualInformation(xs, ys);
      out.push({i, j, mi, normalized, r: corr.values[i][j], n: xs.length});
    }
  }
  return out.sort((a, b) => b.normalized - a.normalized);
}

// ── Partial correlation ─────────────────────────────────────────────────────

function matrixInverse(m: number[][]): number[][] | null {
  const n = m.length;
  if (!n) return null;
  const aug: number[][] = m.map((row, i) => {
    const id = new Array(n).fill(0);
    id[i] = 1;
    return [...row, ...id];
  });
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(aug[k][i]) > Math.abs(aug[pivot][i])) pivot = k;
    }
    if (Math.abs(aug[pivot][i]) < 1e-10) return null;
    [aug[i], aug[pivot]] = [aug[pivot], aug[i]];
    const div = aug[i][i];
    for (let j = 0; j < 2 * n; j++) aug[i][j] /= div;
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const factor = aug[k][i];
      for (let j = 0; j < 2 * n; j++) aug[k][j] -= factor * aug[i][j];
    }
  }
  return aug.map((row) => row.slice(n));
}

export type PartialCorr = {i: number; j: number; r: number; rPartial: number; confounders: number[]; n: number};

export function computePartialCorrelations(
  D: HealthData,
  corr: CorrelationResult,
  topN = 6,
  controls = 3,
  minN = 12,
): PartialCorr[] {
  const series = METRICS.map((m) => prepForCorrelation(m.extract(D), m.key));
  const candidates = corr.pairs
    .filter((p) => p.n >= minN)
    .sort((a, b) => Math.abs(b.r) - Math.abs(a.r))
    .slice(0, topN);
  const out: PartialCorr[] = [];
  for (const c of candidates) {
    const {i, j} = c;
    // Pick the controls as the variables most correlated with i or j
    const cands = corr.metrics
      .map((_, k) => k)
      .filter((k) => k !== i && k !== j)
      .map((k) => ({k, score: Math.abs(corr.values[i][k]) + Math.abs(corr.values[j][k])}))
      .sort((a, b) => b.score - a.score)
      .slice(0, controls)
      .map((x) => x.k);
    const idxs = [i, j, ...cands];
    // Build correlation submatrix
    const m: number[][] = idxs.map((a) => idxs.map((b) => corr.values[a][b]));
    const inv = matrixInverse(m);
    if (!inv) continue;
    const denom = Math.sqrt(inv[0][0] * inv[1][1]);
    if (denom === 0) continue;
    const rPartial = -inv[0][1] / denom;
    out.push({i, j, r: c.r, rPartial, confounders: cands, n: c.n});
  }
  return out;
}

// ── Recovery score (0–100 daily composite) ──────────────────────────────────

const RECOVERY_KEYS = ['hrv', 'rhr', 'sleep_deep', 'sleep_total'];

export type RecoveryPoint = {date: string; score: number};
export type RecoveryResult = {
  daily: RecoveryPoint[];
  moving7: RecoveryPoint[];
  mean: number;
  rangeMin: number;
  rangeMax: number;
};

export function computeRecoveryScore(D: HealthData, baselineDays = 30): RecoveryResult | null {
  const seriesList = RECOVERY_KEYS.map((k) => {
    const m = METRICS.find((x) => x.key === k);
    if (!m) return {key: k, map: new Map<string, number>()};
    return {key: k, map: indexByDate(m.extract(D))};
  });
  if (seriesList.some((s) => s.map.size < baselineDays)) return null;
  // Build set of dates that have at least HRV (the strictest)
  const allDates = new Set<string>();
  for (const s of seriesList) for (const d of s.map.keys()) allDates.add(d);
  const dates = [...allDates].sort();
  if (dates.length < baselineDays) return null;
  // For each day, compute z-score using trailing baseline window
  const daily: RecoveryPoint[] = [];
  for (let di = 0; di < dates.length; di++) {
    const d = dates[di];
    const start = Math.max(0, di - baselineDays);
    const window = dates.slice(start, di + 1);
    const zParts: number[] = [];
    const weights: number[] = [];
    for (let k = 0; k < seriesList.length; k++) {
      const s = seriesList[k];
      const vals: number[] = [];
      for (const w of window) {
        const v = s.map.get(w);
        if (v !== undefined) vals.push(v);
      }
      if (vals.length < 5) continue;
      const m = mean(vals);
      const sd = stddev(vals);
      if (sd === 0) continue;
      const v = s.map.get(d);
      if (v === undefined) continue;
      // RHR is low-better → invert sign
      const z = s.key === 'rhr' ? -(v - m) / sd : (v - m) / sd;
      zParts.push(z);
      weights.push(1);
    }
    if (zParts.length < 2) continue;
    const wsum = weights.reduce((a, b) => a + b, 0);
    const z = zParts.reduce((a, b) => a + b, 0) / wsum;
    const score = Math.max(0, Math.min(100, Math.round(50 + 12.5 * z)));
    daily.push({date: d, score});
  }
  if (daily.length < 7) return null;
  // 7-day moving average
  const moving7: RecoveryPoint[] = daily.map((_, i) => {
    const slice = daily.slice(Math.max(0, i - 6), i + 1);
    const avg = mean(slice.map((s) => s.score));
    return {date: daily[i].date, score: Math.round(avg)};
  });
  const allScores = daily.map((d) => d.score);
  return {
    daily,
    moving7,
    mean: Number(mean(allScores).toFixed(1)),
    rangeMin: Math.min(...allScores),
    rangeMax: Math.max(...allScores),
  };
}

// ── Anomaly detection (Mahalanobis on standardized day features) ─────────────

export type Anomaly = {
  date: string;
  score: number; // Mahalanobis distance
  topMetrics: {key: string; label: string; z: number}[];
};

export function computeAnomalies(
  D: HealthData,
  clusters: ClusterResult | null,
  topK = 5,
): Anomaly[] {
  const {matrix, dates, means, stds} = buildDayVectors(D);
  if (matrix.length < topK * 2) return [];
  // Use the global mean vector (centroid of all days) as the reference.
  // Anomaly score = Euclidean distance in standardized space (cheap proxy for
  // Mahalanobis that doesn't require inverting a possibly-singular covariance).
  const dim = matrix[0].length;
  const dists: number[] = matrix.map((row) => {
    let s = 0;
    for (let j = 0; j < dim; j++) {
      const d = row[j]; // already standardized to global mean
      s += d * d;
    }
    return Math.sqrt(s / dim);
  });
  // Avoid double-counting clustered days: blend cluster-distance as secondary.
  const idx = dists.map((d, i) => ({d, i}));
  idx.sort((a, b) => b.d - a.d);
  const picked: Anomaly[] = [];
  const used = new Set<string>();
  for (const {i} of idx) {
    if (picked.length >= topK) break;
    const d = dates[i];
    if (used.has(d)) continue;
    used.add(d);
    const topMetrics: {key: string; label: string; z: number}[] = [];
    for (let j = 0; j < dim; j++) {
      const z = matrix[i][j];
      const m = METRICS.find((x) => x.key === CLUSTER_KEYS[j]);
      if (!m) continue;
      topMetrics.push({key: m.key, label: m.label, z: Number(z.toFixed(2))});
    }
    topMetrics.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
    picked.push({
      date: d,
      score: Number(dists[i].toFixed(2)),
      topMetrics: topMetrics.slice(0, 4),
    });
  }
  return picked;
}

// ── Counterfactual: split on median, compare other metrics ──────────────────

export type Counterfactual = {
  cause: string;
  causeLabel: string;
  unit: string;
  threshold: number;
  effect: string;
  effectLabel: string;
  highMedian: number;
  lowMedian: number;
  delta: number;
  pValue: number;
  n: number;
};

function mannWhitneyU(a: number[], b: number[]): {u: number; pApprox: number} {
  const m = a.length;
  const n = b.length;
  if (m < 3 || n < 3) return {u: 0, pApprox: 1};
  const combined = [...a.map((v) => [v, 0] as [number, number]), ...b.map((v) => [v, 1] as [number, number])];
  combined.sort((x, y) => x[0] - y[0]);
  const ranks = new Array<number>(combined.length);
  let i = 0;
  while (i < combined.length) {
    let j = i;
    while (j + 1 < combined.length && combined[j + 1][0] === combined[i][0]) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[k] = avgRank;
    i = j + 1;
  }
  let r1 = 0;
  for (let k = 0; k < combined.length; k++) if (combined[k][1] === 0) r1 += ranks[k];
  const u1 = r1 - (m * (m + 1)) / 2;
  const u2 = m * n - u1;
  const u = Math.min(u1, u2);
  const mu = (m * n) / 2;
  const sigma = Math.sqrt((m * n * (m + n + 1)) / 12);
  const z = sigma > 0 ? (u - mu) / sigma : 0;
  // Two-tailed normal approximation
  const p = 2 * (1 - normalCdf(Math.abs(z)));
  return {u, pApprox: Math.max(0, Math.min(1, p))};
}

function normalCdf(x: number): number {
  // Abramowitz & Stegun 7.1.26 approximation
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

export function computeCounterfactuals(
  D: HealthData,
  minN = 14,
  maxResults = 6,
): Counterfactual[] {
  const series = METRICS.map((m) => prepForCorrelation(m.extract(D), m.key));
  const out: Counterfactual[] = [];
  for (let i = 0; i < series.length; i++) {
    if (series[i].length < minN) continue;
    const causeSpec = METRICS[i];
    if (causeSpec.direction === 'neutral') continue;
    // Split at median
    const vals = series[i].map(([, v]) => v).sort((a, b) => a - b);
    const median = vals[Math.floor(vals.length / 2)];
    const high: [string, number][] = [];
    const low: [string, number][] = [];
    for (const row of series[i]) {
      if (row[1] >= median) high.push(row);
      else low.push(row);
    }
    if (high.length < minN || low.length < minN) continue;
    const highDateSet = new Set(high.map(([d]) => d));
    for (let j = 0; j < series.length; j++) {
      if (i === j) continue;
      const effectSpec = METRICS[j];
      const highEffect: number[] = [];
      const lowEffect: number[] = [];
      const mj = indexByDate(series[j]);
      for (const [d] of high) {
        const v = mj.get(d);
        if (v !== undefined) highEffect.push(v);
      }
      for (const [d] of low) {
        const v = mj.get(d);
        if (v !== undefined) lowEffect.push(v);
      }
      if (highEffect.length < minN || lowEffect.length < minN) continue;
      const {pApprox} = mannWhitneyU(highEffect, lowEffect);
      if (pApprox > 0.1) continue;
      const highMedian = medianOf(highEffect);
      const lowMedian = medianOf(lowEffect);
      const delta = highMedian - lowMedian;
      out.push({
        cause: causeSpec.key,
        causeLabel: causeSpec.label,
        unit: causeSpec.unit ?? '',
        threshold: median,
        effect: effectSpec.key,
        effectLabel: effectSpec.label,
        highMedian, lowMedian, delta,
        pValue: pApprox,
        n: highEffect.length + lowEffect.length,
      });
    }
  }
  // De-duplicate (X high vs X low) pairs and rank by effect size
  out.sort((a, b) => Math.abs(b.delta / (Math.abs(b.highMedian) + 1e-9)) - Math.abs(a.delta / (Math.abs(a.highMedian) + 1e-9)));
  // Keep top result per (cause, effect) pair
  const seen = new Set<string>();
  const dedup: Counterfactual[] = [];
  for (const r of out) {
    const key = `${r.cause}>${r.effect}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(r);
    if (dedup.length >= maxResults) break;
  }
  return dedup;
}

function medianOf(arr: number[]): number {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
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

const CLUSTER_KEYS = ['sleep_total', 'rhr', 'hrv', 'steps', 'exercise', 'fat', 'daylight', 'mood'];

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

  const trendTargets = ['rhr', 'hrv', 'weight', 'steps', 'sleep_total', 'fat', 'daylight', 'mood'];
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
