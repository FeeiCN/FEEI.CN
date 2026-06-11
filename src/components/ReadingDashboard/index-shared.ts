import {createContext} from 'react';
import type {Stats, LibraryBook, Totals} from './types';

export type ScopeMode = 'year' | 'all';
export type TimeScope =
  | {mode: 'year'; year: number}
  | {mode: 'all'};

export function defaultScope(): TimeScope {
  return {mode: 'year', year: new Date().getFullYear()};
}

export type ReadingCtxType = {
  scope: TimeScope;
  setScope: (updater: TimeScope | ((prev: TimeScope) => TimeScope)) => void;
  stats: Stats | null;
  filteredStats: Stats | null;
  dailyByDate: Record<string, number>;
  filteredDaily: Record<string, number>;
  filteredLibrary: LibraryBook[];
  availableYears: number[];
  loading: boolean;
};

export const ReadingCtx = createContext<ReadingCtxType>({
  scope: defaultScope(),
  setScope: () => {},
  stats: null,
  filteredStats: null,
  dailyByDate: {},
  filteredDaily: {},
  filteredLibrary: [],
  availableYears: [],
  loading: true,
});

export function yearCutoff(year: number): string {
  return `${year}-01-01`;
}

export function yearEndCutoff(year: number): string {
  return `${year}-12-31`;
}

export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function filterDailyByYear(
  daily: Record<string, number>,
  year: number,
): Record<string, number> {
  const start = yearCutoff(year);
  const end = yearEndCutoff(year);
  const out: Record<string, number> = {};
  for (const [date, sec] of Object.entries(daily)) {
    if (date >= start && date <= end) out[date] = sec;
  }
  return out;
}

export function filterLibraryByYear(
  library: LibraryBook[],
  year: number,
): LibraryBook[] {
  return library.filter((b) => b.year === year);
}

export function computeFilteredTotals(
  rawStats: Stats,
  filteredDaily: Record<string, number>,
  filteredLibrary: LibraryBook[],
): Totals {
  if (filteredLibrary.length === 0 && Object.keys(filteredDaily).length === 0) {
    return {
      activeDays: 0,
      totalReadSeconds: 0,
      booksInLibrary: 0,
      booksFinished: 0,
      notesTotal: 0,
      bookmarksTotal: 0,
      traceableCount: 0,
    };
  }
  const activeDays = Object.values(filteredDaily).filter((v) => v > 0).length;
  const totalReadSeconds = Object.values(filteredDaily).reduce((s, v) => s + v, 0);
  return {
    activeDays,
    totalReadSeconds,
    booksInLibrary: filteredLibrary.length,
    booksFinished: filteredLibrary.filter(
      (b) => (b.progress ?? 0) >= 99 || b.finishReading === true,
    ).length,
    notesTotal: filteredLibrary.reduce((s, b) => s + (b.noteCount || 0), 0),
    bookmarksTotal: filteredLibrary.reduce((s, b) => s + (b.bookmarkCount || 0), 0),
    traceableCount: filteredLibrary.length,
  };
}

export function computeFilteredStats(
  rawStats: Stats,
  filteredDaily: Record<string, number>,
  filteredLibrary: LibraryBook[],
): Stats {
  const totals = computeFilteredTotals(rawStats, filteredDaily, filteredLibrary);
  const usedYears = new Set<number>();
  for (const [date] of Object.entries(filteredDaily)) {
    const y = Number(date.slice(0, 4));
    if (Number.isFinite(y)) usedYears.add(y);
  }
  const yearly = rawStats.yearly.filter((y) => usedYears.has(Number(y.year)));
  const dates = Object.keys(filteredDaily);
  const filteredDateRange = dates.length
    ? (() => {
        const sorted = [...dates].sort();
        return {start: sorted[0], end: sorted[sorted.length - 1]};
      })()
    : null;
  return {
    ...rawStats,
    totals,
    yearly,
    library: filteredLibrary,
    dateRange: filteredDateRange,
  };
}
