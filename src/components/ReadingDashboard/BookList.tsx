import React, {useEffect, useMemo} from 'react';
import type {LibraryBook} from './types';
import {formatDuration, formatRelativeTime, shortAuthor} from './utils';
import styles from './styles.module.css';

type ReadStatus = 'all' | 'read' | 'unread';
type SortBy = 'recent' | 'progress' | 'notes' | 'bookmarks';

const READ_STATUSES: {value: ReadStatus; label: string}[] = [
  {value: 'all', label: '全部'},
  {value: 'read', label: '已读'},
  {value: 'unread', label: '未读'},
];

const SORT_OPTIONS: {value: SortBy; label: string}[] = [
  {value: 'recent', label: '最近阅读'},
  {value: 'progress', label: '阅读进度'},
  {value: 'notes', label: '笔记数'},
  {value: 'bookmarks', label: '划线数'},
];

type Props = {
  id?: string;
  title?: string;
  library: LibraryBook[];
  totalCount: number;
  category: string;
  readStatus: ReadStatus;
  sortBy: SortBy;
  collectionBookIds?: Set<string> | null;
  onCategoryChange: (cat: string) => void;
  onReadStatusChange: (s: ReadStatus) => void;
  onSortByChange: (s: SortBy) => void;
  search: string;
  onSearchChange: (q: string) => void;
  onSelectBook: (bookId: string) => void;
};

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function parentOf(category: string): string {
  return category.includes('-') ? category.split('-')[0] : category;
}

function sortBooks(arr: LibraryBook[], sortBy: SortBy): LibraryBook[] {
  const next = [...arr];
  switch (sortBy) {
    case 'recent':
      next.sort((a, b) => (b.lastReadTime ?? 0) - (a.lastReadTime ?? 0));
      break;
    case 'progress':
      next.sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0));
      break;
    case 'notes':
      next.sort((a, b) => (b.noteCount ?? 0) - (a.noteCount ?? 0));
      break;
    case 'bookmarks':
      next.sort((a, b) => (b.bookmarkCount ?? 0) - (a.bookmarkCount ?? 0));
      break;
  }
  return next;
}

export default function BookList({
  id,
  title = '全部书单',
  library,
  totalCount,
  category,
  readStatus,
  sortBy,
  collectionBookIds,
  onCategoryChange,
  onReadStatusChange,
  onSortByChange,
  search,
  onSearchChange,
  onSelectBook,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const root = id ? document.getElementById(id) : null;
        const input = root?.querySelector<HTMLInputElement>('input[type="search"]');
        input?.focus();
        input?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id]);
  const filtered = useMemo(() => {
    if (!collectionBookIds) return library;
    return library.filter((b) => collectionBookIds.has(b.bookId));
  }, [library, collectionBookIds]);

  const parentMap = useMemo(() => {
    const map = new Map<string, {count: number; children: Map<string, number>}>();
    for (const b of filtered) {
      if (!b.category) continue;
      const sep = b.category.indexOf('-');
      const parent = sep >= 0 ? b.category.slice(0, sep) : b.category;
      const child = sep >= 0 ? b.category.slice(sep + 1) : null;
      const bucket = map.get(parent) || {count: 0, children: new Map<string, number>()};
      bucket.count += 1;
      if (child) {
        bucket.children.set(child, (bucket.children.get(child) || 0) + 1);
      }
      map.set(parent, bucket);
    }
    return map;
  }, [filtered]);

  const parents = useMemo(
    () =>
      Array.from(parentMap.entries())
        .map(([name, v]) => ({name, count: v.count}))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    [parentMap],
  );

  const expandedParent = category === 'all' ? null : parentOf(category);
  const childChips = useMemo(() => {
    if (!expandedParent) return [];
    const bucket = parentMap.get(expandedParent);
    if (!bucket) return [];
    return Array.from(bucket.children.entries())
      .map(([name, count]) => ({name, count}))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [expandedParent, parentMap]);

  const scoped = useMemo(() => {
    const term = search.trim().toLowerCase();
    let arr = filtered;
    if (term) {
      arr = arr.filter(
        (b) =>
          b.title.toLowerCase().includes(term) ||
          (b.author || '').toLowerCase().includes(term),
      );
    }
    if (category !== 'all') {
      arr = arr.filter(
        (b) => b.category === category || b.category.startsWith(category + '-'),
      );
    }
    if (readStatus !== 'all') {
      arr = arr.filter((b) => {
        const pct = b.progress ?? 0;
        return readStatus === 'read' ? pct >= 99 : pct < 99;
      });
    }
    return sortBooks(arr, sortBy);
  }, [filtered, search, category, readStatus, sortBy]);

  return (
    <section id={id} className={`${styles.section} ${styles.bookList}`}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>{title}</h3>
        <span className={styles.sectionHint}>
          共 {totalCount} 本 · 当前显示 {scoped.length} 本
        </span>
      </div>
      <div className={styles.bookListControls}>
        <input
          type="search"
          className={styles.searchInput}
          placeholder="搜索书名或作者"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="搜索书名或作者"
        />
        <kbd className={styles.kbdHint} aria-hidden="true">
          {isMac ? '⌘' : 'Ctrl'}K
        </kbd>
      </div>
      <div className={styles.bookListToolbar}>
        <div className={styles.bookListToolbarRow}>
          <span className={styles.bookListToolbarLabel}>筛选</span>
          <div className={styles.bookListToolbarChips} role="group" aria-label="按状态筛选">
            {READ_STATUSES.map((s) => (
              <FilterButton
                key={s.value}
                label={s.label}
                active={readStatus === s.value}
                onClick={() => onReadStatusChange(s.value)}
              />
            ))}
          </div>
          <span className={styles.toolbarDivider} aria-hidden="true">|</span>
          <span className={styles.bookListToolbarLabel}>排序</span>
          <div className={styles.bookListToolbarChips} role="group" aria-label="排序方式">
            {SORT_OPTIONS.map((s) => (
              <FilterButton
                key={s.value}
                label={s.label}
                active={sortBy === s.value}
                onClick={() => onSortByChange(s.value)}
              />
            ))}
          </div>
        </div>
      </div>
      {parents.length > 0 && (
        <div className={styles.categoryFilter} role="group" aria-label="按父分类筛选">
          <ParentChip
            label="全部分类"
            count={filtered.length}
            active={category === 'all'}
            onClick={() => onCategoryChange('all')}
          />
          {parents.map((p) => (
            <ParentChip
              key={p.name}
              label={p.name}
              count={p.count}
              active={category === p.name}
              onClick={() => onCategoryChange(category === p.name ? 'all' : p.name)}
            />
          ))}
        </div>
      )}
      {expandedParent && childChips.length > 0 && (
        <div className={styles.categoryFilter} role="group" aria-label="按子分类筛选">
          <ChildChip
            label={`全部 ${expandedParent}`}
            active={category === expandedParent}
            onClick={() => onCategoryChange(expandedParent)}
          />
          {childChips.map((c) => {
            const fullCat = `${expandedParent}-${c.name}`;
            return (
              <ChildChip
                key={c.name}
                label={c.name}
                count={c.count}
                active={category === fullCat}
                onClick={() => onCategoryChange(fullCat)}
              />
            );
          })}
        </div>
      )}
      {scoped.length === 0 ? (
        <div className={styles.empty}>没有匹配的书</div>
      ) : (
        <div className={styles.bookGrid}>
          {scoped.map((b) => (
            <BookCard key={b.bookId} book={b} onSelect={onSelectBook} />
          ))}
        </div>
      )}
    </section>
  );
}

function ParentChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.categoryFilterButton} ${
        active ? styles.categoryFilterButtonActive : ''
      }`}
      onClick={onClick}
    >
      <span>{label}</span>
      <span className={styles.categoryCount}>{count}</span>
    </button>
  );
}

function ChildChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.childChip} ${active ? styles.childChipActive : ''}`}
      onClick={onClick}
    >
      <span>{label}</span>
      {typeof count === 'number' && <span className={styles.categoryCount}>{count}</span>}
    </button>
  );
}

function FilterButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.filterButton} ${active ? styles.filterButtonActive : ''}`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function BookCard({
  book,
  onSelect,
}: {
  book: LibraryBook;
  onSelect: (bookId: string) => void;
}) {
  const pct = Math.max(0, Math.min(100, book.progress ?? 0));
  const isFinished = pct >= 99;
  const totalTime = formatDuration(book.totalReadTime ?? 0);
  const localCover = `/data/reading/books/${book.bookId}/cover.jpg`;
  return (
    <button
      type="button"
      className={styles.bookCard}
      onClick={() => onSelect(book.bookId)}
    >
      <div className={styles.bookCardCoverWrap}>
        {book.cover ? (
          <img
            className={styles.bookCardCover}
            src={localCover}
            alt={book.title}
            loading="lazy"
            onError={(e) => {
              const img = e.currentTarget;
              if (img.src !== book.cover) img.src = book.cover;
            }}
          />
        ) : (
          <div className={styles.bookCardCoverPlaceholder}>封面</div>
        )}
        {isFinished && <span className={styles.bookCardBadge}>已读</span>}
      </div>
      <div className={styles.bookCardBody}>
        <h4 className={styles.bookCardTitle}>{book.title || '未命名'}</h4>
        <p className={styles.bookCardAuthor}>{shortAuthor(book.author) || '—'}</p>
        <div className={styles.bookCardTimeStat}>
          <span className={styles.bookCardTimeLabel}>阅读</span>
          <span className={styles.bookCardTimeValue}>{totalTime}</span>
          {pct > 0 && <span className={styles.bookCardTimeProgress}>· {pct}%</span>}
        </div>
        <div className={styles.bookCardMeta}>
          {book.category && <span className={styles.tag}>{book.category}</span>}
        </div>
        <div className={styles.bookCardFooter}>
          <span className={styles.bookCardMetaRow}>
            {book.noteCount > 0 && <span>{book.noteCount} 笔记</span>}
            {book.bookmarkCount > 0 && <span>{book.bookmarkCount} 划线</span>}
            {book.noteCount === 0 && book.bookmarkCount === 0 && <span>无标注</span>}
          </span>
          <span className={styles.bookCardTime}>
            {formatRelativeTime(book.lastReadTime)}
          </span>
        </div>
      </div>
    </button>
  );
}
