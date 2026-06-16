import React, {useContext, useEffect, useMemo, useState, useCallback} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import type {Stats, LibraryBook} from './types';
import CurrentlyReading from './CurrentlyReading';
import ShelfCollections from './ShelfCollections';
import BookList from './BookList';
import BookDetailDrawer from './BookDetailDrawer';
import ReadingHeatmap from '../ReadingHeatmap';
import ReadingTimeBar from './ReadingTimeBar';
import {formatDuration, humanizeDays, isStale} from './utils';
import {
  ReadingCtx,
  defaultScope,
  type TimeScope,
  filterDailyByYear,
  filterLibraryByYear,
  computeFilteredStats,
} from './index-shared';
import styles from './styles.module.css';

function useReadingState() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [dailyByDate, setDailyByDate] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<TimeScope>(defaultScope());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [statsRes, idxRes] = await Promise.all([
          fetch('/reading/stats.json', {cache: 'no-store'}),
          fetch('/reading/index.json', {cache: 'no-store'}),
        ]);
        if (!statsRes.ok) throw new Error(`stats 加载失败 (${statsRes.status})`);
        if (!idxRes.ok) throw new Error(`index 加载失败 (${idxRes.status})`);
        const statsData = (await statsRes.json()) as Stats;
        const idxData = (await idxRes.json()) as {activeYears?: string[]; exportedAt?: string};
        const yearCacheBust = idxData.exportedAt ? `?v=${encodeURIComponent(idxData.exportedAt)}` : '';
        const yearFiles = await Promise.all(
          (idxData.activeYears || []).map(async (y) => {
            const r = await fetch(`/reading/${y}.json${yearCacheBust}`, {cache: 'default'});
            if (!r.ok) return {year: y, daily: {}} as {year: string; daily: Record<string, {seconds: number}>};
            return (await r.json()) as {year: string; daily: Record<string, {seconds: number}>};
          }),
        );
        const merged: Record<string, number> = {};
        for (const yf of yearFiles) {
          for (const [date, b] of Object.entries(yf.daily || {})) {
            merged[date] = (merged[date] || 0) + (Number(b.seconds) || 0);
          }
        }
        if (cancelled) return;
        setStats(statsData);
        setDailyByDate(merged);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message || '加载失败');
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const availableYears = useMemo<number[]>(() => {
    if (!stats) return [];
    return stats.yearly.map((y) => Number(y.year)).sort((a, b) => b - a);
  }, [stats]);

  const {filteredDaily, filteredLibrary} = useMemo(() => {
    if (!stats) {
      return {filteredDaily: {} as Record<string, number>, filteredLibrary: [] as LibraryBook[]};
    }
    if (scope.mode === 'all') {
      return {filteredDaily: dailyByDate, filteredLibrary: stats.library};
    }
    return {
      filteredDaily: filterDailyByYear(dailyByDate, scope.year),
      filteredLibrary: filterLibraryByYear(stats.library, scope.year),
    };
  }, [stats, dailyByDate, scope]);

  const filteredStats = useMemo<Stats | null>(() => {
    if (!stats) return null;
    return computeFilteredStats(stats, filteredDaily, filteredLibrary);
  }, [stats, filteredDaily, filteredLibrary]);

  return {
    scope,
    setScope,
    stats,
    filteredStats,
    dailyByDate,
    filteredDaily,
    filteredLibrary,
    availableYears,
    loading,
    error,
  };
}

function ReadingProviderInner({children}: {children: React.ReactNode}) {
  const state = useReadingState();
  const value = useMemo(
    () => ({
      scope: state.scope,
      setScope: state.setScope,
      stats: state.stats,
      filteredStats: state.filteredStats,
      dailyByDate: state.dailyByDate,
      filteredDaily: state.filteredDaily,
      filteredLibrary: state.filteredLibrary,
      availableYears: state.availableYears,
      loading: state.loading,
    }),
    [state],
  );
  return <ReadingCtx.Provider value={value}>{children}</ReadingCtx.Provider>;
}

export function ReadingProvider({children}: {children?: React.ReactNode}) {
  return (
    <BrowserOnly fallback={<>{children}</>}>
      {() => <ReadingProviderInner>{children}</ReadingProviderInner>}
    </BrowserOnly>
  );
}

function DashboardInner() {
  const {filteredStats, filteredLibrary, filteredDaily, scope, setScope, stats, error, loading} =
    useContext(ReadingCtx);
  const [search, setSearch] = useState<string>('');
  const [category, setCategory] = useState<string>('all');
  const [readStatus, setReadStatus] = useState<'all' | 'read' | 'unread'>('all');
  const [sortBy, setSortBy] = useState<'recent' | 'progress' | 'notes' | 'bookmarks'>('recent');
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [activeCollection, setActiveCollection] = useState<string | null>(null);

  useEffect(() => {
    setSearch('');
    setCategory('all');
    setReadStatus('all');
    setSortBy('recent');
    setActiveCollection(null);
  }, [scope]);

  const collectionBookIds = useMemo(() => {
    if (!activeCollection || !stats) return null;
    const col = stats.collections.find((c) => c.name === activeCollection);
    if (!col) return null;
    return new Set(col.bookIds || []);
  }, [activeCollection, stats]);

  const handleSelectBook = useCallback((bookId: string) => {
    setSelectedBookId(bookId);
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setSelectedBookId(null);
  }, []);

  const handleJumpToBookList = useCallback(() => {
    const el = document.getElementById('rd-book-list');
    if (el) el.scrollIntoView({behavior: 'smooth', block: 'start'});
  }, []);

  const handleSelectCollection = useCallback((name: string | null) => {
    setActiveCollection(name);
    if (name) {
      handleJumpToBookList();
    }
  }, [handleJumpToBookList]);

  const heatmapYears = useMemo<number[]>(() => {
    if (!filteredStats) return [];
    if (scope.mode === 'year') return [scope.year];
    return filteredStats.yearly
      .map((y) => Number(y.year))
      .filter((y) => Number.isFinite(y))
      .sort((a, b) => b - a);
  }, [scope, filteredStats]);

  const heatmapDaily = useMemo(() => {
    const out: Record<string, {seconds: number; books: string[]}> = {};
    for (const [date, sec] of Object.entries(filteredDaily)) {
      out[date] = {seconds: sec, books: []};
    }
    return out;
  }, [filteredDaily]);

  const bookListTitle = useMemo(() => {
    if (scope.mode === 'year') return `${scope.year}书单`;
    return '全部书单';
  }, [scope]);

  if (error) {
    return <div className={styles.error}>数据加载失败：{error}</div>;
  }
  if (!filteredStats) {
    return <div className={styles.loading}>加载阅读数据…</div>;
  }

  const selectedBook: LibraryBook | undefined = selectedBookId && stats
    ? stats.library.find((b) => b.bookId === selectedBookId)
    : undefined;

  return (
    <div className={styles.dashboard}>
      <ReadingTimeBar />
      <ScopeMeta scope={scope} loading={loading} stats={filteredStats} exportedAt={stats?.exportedAt} />
      <StatsSummary totals={filteredStats.totals} />
      <ReadingHeatmap
        daily={heatmapDaily}
        years={heatmapYears}
        totals={filteredStats.totals}
        exportedAt={stats?.exportedAt}
        dateRange={filteredStats.dateRange ?? undefined}
        emptyHint="当前范围暂无阅读日历数据"
      />
      <CurrentlyReading
        library={filteredStats.library}
        onSelect={handleSelectBook}
      />
      <ShelfCollections
        collections={stats?.collections ?? []}
        library={filteredStats.library}
        activeCollection={activeCollection}
        onSelectCollection={handleSelectCollection}
      />
      <BookList
        id="rd-book-list"
        title={bookListTitle}
        library={filteredLibrary}
        totalCount={stats?.library.length ?? 0}
        category={category}
        readStatus={readStatus}
        sortBy={sortBy}
        collectionBookIds={collectionBookIds}
        onCategoryChange={setCategory}
        onReadStatusChange={setReadStatus}
        onSortByChange={setSortBy}
        search={search}
        onSearchChange={setSearch}
        onSelectBook={handleSelectBook}
      />
      {selectedBookId && (
        <BookDetailDrawer
          bookId={selectedBookId}
          book={selectedBook}
          onClose={handleCloseDrawer}
        />
      )}
    </div>
  );
}

function ScopeMeta({
  scope,
  loading,
  stats,
  exportedAt,
}: {
  scope: TimeScope;
  loading: boolean;
  stats: Stats;
  exportedAt?: string;
}) {
  let label = '';
  if (scope.mode === 'year') {
    label = `${scope.year} 年`;
  } else {
    label = '全部历史';
  }
  const lastDate = stats.dateRange?.end;
  const ageLabel = humanizeDays(exportedAt);
  const stale = isStale(exportedAt);
  return (
    <div className={styles.scopeMeta}>
      <span>
        当前范围：<span className={styles.scopeRange}>{label}</span>
        {stats.totals.activeDays > 0 && lastDate && (
          <> · 数据截至 {lastDate}</>
        )}
        {ageLabel && (
          <>
            {' · '}
            <span className={stale ? styles.stale : ''}>
              更新于 {ageLabel}
            </span>
          </>
        )}
      </span>
      {loading && <span>加载中…</span>}
    </div>
  );
}

function StatsSummary({totals}: {totals: Stats['totals']}) {
  const totalHours = totals.totalReadSeconds / 3600;
  const honglouMeng = totalHours / 9.5;
  return (
    <section className={styles.section}>
      <div className={styles.statsSummary}>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{totals.booksInLibrary}</span>
          <span className={styles.statLabel}>在库书目</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{totals.booksFinished}</span>
          <span className={styles.statLabel}>已读完</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{totals.activeDays}</span>
          <span className={styles.statLabel}>阅读天数</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>
            {formatDuration(totals.totalReadSeconds)}
          </span>
          <span className={styles.statLabel}>累计时长</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{totals.notesTotal}</span>
          <span className={styles.statLabel}>笔记</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statValue}>{totals.bookmarksTotal}</span>
          <span className={styles.statLabel}>划线</span>
        </div>
      </div>
      {totalHours > 0 && (
        <p className={styles.punchline}>
          {`≈ ${honglouMeng.toFixed(1)} 本《红楼梦》（按 20 万字/本、平均 350 字/分计）`}
        </p>
      )}
    </section>
  );
}

export default function ReadingDashboard() {
  return (
    <BrowserOnly fallback={<div style={{minHeight: 240}} />}>
      {() => (
        <ReadingProvider>
          <DashboardInner />
        </ReadingProvider>
      )}
    </BrowserOnly>
  );
}
