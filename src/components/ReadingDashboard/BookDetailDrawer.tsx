import React, {useEffect, useRef, useState} from 'react';
import type {
  BookInfo,
  BookBestBookmarks,
  BookReviews,
  BookChapters,
  BookProgress,
  LibraryBook,
} from './types';
import {formatDateOnly, formatRelativeTime, formatDuration, ratingDisplay, shortAuthor, safeRepeat} from './utils';
import styles from './styles.module.css';

type Props = {
  bookId: string;
  book: LibraryBook | undefined;
  onClose: () => void;
};

type TabKey = 'highlights' | 'reviews' | 'chapters';

const TAB_LABELS: Record<TabKey, string> = {
  highlights: '划线',
  reviews: '书评',
  chapters: '章节',
};

export default function BookDetailDrawer({bookId, book, onClose}: Props) {
  const [tab, setTab] = useState<TabKey>('highlights');
  const [info, setInfo] = useState<BookInfo | null>(null);
  const [best, setBest] = useState<BookBestBookmarks | null>(null);
  const [reviews, setReviews] = useState<BookReviews | null>(null);
  const [chapters, setChapters] = useState<BookChapters | null>(null);
  const [progress, setProgress] = useState<BookProgress | null>(null);
  const [loadingTab, setLoadingTab] = useState<TabKey | null>(null);
  const [tabError, setTabError] = useState<string | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [introExpanded, setIntroExpanded] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);

  const baseUrl = `/reading/books/${bookId}`;

  useEffect(() => {
    if (typeof document !== 'undefined') {
      const active = document.activeElement;
      if (active instanceof HTMLElement) {
        triggerRef.current = active;
      }
    }
  }, [bookId]);

  useEffect(() => {
    let cancelled = false;
    setInfo(null);
    setBest(null);
    setReviews(null);
    setChapters(null);
    setProgress(null);
    setInfoError(null);
    setTabError(null);
    setTab('highlights');
    setIntroExpanded(false);

    fetch(`${baseUrl}/info.json`, {cache: 'force-cache'})
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (!cancelled) setInfo(data as BookInfo);
      })
      .catch(() => {
        if (!cancelled) setInfoError('书籍信息暂时无法加载');
      });

    fetch(`${baseUrl}/progress.json`, {cache: 'force-cache'})
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setProgress(data as BookProgress);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [bookId, baseUrl]);

  useEffect(() => {
    if (tab === 'highlights' && !best) {
      setLoadingTab('highlights');
      setTabError(null);
      fetch(`${baseUrl}/bestbookmarks.json`, {cache: 'force-cache'})
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((data) => setBest(data as BookBestBookmarks))
        .catch(() => setTabError('划线加载失败'))
        .finally(() => setLoadingTab(null));
    } else if (tab === 'reviews' && !reviews) {
      setLoadingTab('reviews');
      setTabError(null);
      fetch(`${baseUrl}/reviews.json`, {cache: 'force-cache'})
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((data) => setReviews(data as BookReviews))
        .catch(() => setTabError('书评加载失败'))
        .finally(() => setLoadingTab(null));
    } else if (tab === 'chapters' && !chapters) {
      setLoadingTab('chapters');
      setTabError(null);
      fetch(`${baseUrl}/chapters.json`, {cache: 'force-cache'})
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((data) => setChapters(data as BookChapters))
        .catch(() => setTabError('章节加载失败'))
        .finally(() => setLoadingTab(null));
    }
  }, [tab, best, reviews, chapters, baseUrl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
      const t = triggerRef.current;
      if (t && typeof t.focus === 'function' && document.contains(t)) {
        t.focus();
      }
    };
  }, []);

  const cover = info?.cover || book?.cover || '';
  const localCover = book?.bookId ? `/reading/books/${book.bookId}/cover.jpg` : '';
  const title = info?.title || book?.title || '未命名';
  const author = info?.author || book?.author || '';
  const category = info?.category || book?.category || '';
  const publisher = info?.publisher || book?.publisher || '';
  const isbn = info?.isbn || book?.isbn || '';
  const publishTime = info?.publishTime || '';
  const intro = info?.intro || book?.intro || '';
  const rating = ratingDisplay(info?.newRating, info?.newRatingCount);
  const progressPct = book?.progress ?? progress?.book?.progress ?? null;
  const totalSec = book?.totalReadTime ?? progress?.book?.readingTime ?? null;
  const lastRead = book?.lastReadTime ?? progress?.book?.updateTime ?? null;

  const chapterTitleById = new Map<number, string>();
  for (const ch of chapters?.chapters || []) {
    if (typeof ch.chapterUid === 'number' && ch.title) {
      chapterTitleById.set(ch.chapterUid, ch.title);
    }
  }

  return (
    <>
      <div
        className={`${styles.drawerBackdrop} ${styles.drawerBackdropOpen}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`${styles.drawer} ${styles.drawerOpen}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className={styles.drawerHeader}>
          <span className={styles.drawerHeaderLabel}>书籍详情</span>
          <button
            type="button"
            className={styles.drawerClose}
            onClick={onClose}
            aria-label="关闭"
          >
            ×
          </button>
        </div>
        <div className={styles.drawerBody}>
          <div className={styles.bookHead}>
            {cover ? (
              <img
                className={styles.bookHeadCover}
                src={localCover}
                alt={title}
                onError={(e) => {
                  const img = e.currentTarget;
                  if (img.src !== cover) img.src = cover;
                }}
              />
            ) : (
              <div className={`${styles.bookHeadCover} ${styles.currentCoverPlaceholder}`}>
                封面
              </div>
            )}
            <div className={styles.bookHeadInfo}>
              <h2 className={styles.bookHeadTitle}>{title}</h2>
              <span className={styles.bookHeadAuthor}>{shortAuthor(author)}</span>
              <div className={styles.bookHeadMeta}>
                {category && <span className={styles.tag}>{category}</span>}
                {publisher && <span className={styles.tag}>{publisher}</span>}
                {isbn && <span className={styles.tag}>ISBN {isbn}</span>}
                {publishTime && <span className={styles.tag}>{publishTime.slice(0, 10)}</span>}
              </div>
              {rating && (
                <div className={styles.rating}>
                  <span className={styles.stars}>
                    {safeRepeat('★', Math.round(rating.outOf5))}
                    {safeRepeat('☆', 5 - Math.round(rating.outOf5))}
                  </span>
                  <span>{rating.score}</span>
                  <span className={styles.ratingMeta}>{rating.count} 人评价</span>
                </div>
              )}
            </div>
          </div>

          {(progressPct !== null || totalSec !== null || lastRead) && (
            <div>
              <div className={styles.progressRow}>
                <span>阅读进度</span>
                <span>
                  {progressPct !== null ? `${progressPct}%` : '—'}
                  {totalSec !== null && totalSec > 0 && ` · ${formatDuration(totalSec)}`}
                  {lastRead && ` · ${formatRelativeTime(lastRead)}`}
                </span>
              </div>
              {progressPct !== null && (
                <div className={styles.progressBar}>
                  <div className={styles.progressFill} style={{width: `${Math.max(0, Math.min(100, progressPct))}%`}} />
                </div>
              )}
            </div>
          )}

          {infoError && (
            <div className={styles.error}>书籍信息加载失败：{infoError}</div>
          )}

          {intro && (
            <div
              className={`${styles.intro} ${introExpanded ? '' : styles.introCollapsed} ${styles.introClickable}`}
              onClick={() => setIntroExpanded((v) => !v)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setIntroExpanded((v) => !v);
                }
              }}
            >
              {intro}
            </div>
          )}

          <div className={styles.tabs} role="tablist">
            {(Object.keys(TAB_LABELS) as TabKey[]).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                className={`${styles.tabButton} ${tab === k ? styles.tabButtonActive : ''}`}
                onClick={() => setTab(k)}
              >
                {TAB_LABELS[k]}
                <span className={styles.tabCount}>
                  {k === 'highlights' && best?.totalCount != null ? best.totalCount : ''}
                  {k === 'reviews' && reviews?.totalCount != null ? reviews.totalCount : ''}
                  {k === 'chapters' && chapters?.chapters ? chapters.chapters.length : ''}
                </span>
              </button>
            ))}
          </div>

          <div className={styles.tabPanel} role="tabpanel">
            {loadingTab === tab && <div className={styles.loading}>加载中…</div>}
            {tabError && <div className={styles.error}>加载失败：{tabError}</div>}
            {tab === 'highlights' && best && !loadingTab && (
              <HighlightsPanel
                items={best.items || []}
                chapterTitleById={chapterTitleById}
              />
            )}
            {tab === 'reviews' && reviews && !loadingTab && <ReviewsPanel reviews={reviews} />}
            {tab === 'chapters' && chapters && !loadingTab && (
              <ChaptersPanel chapters={chapters.chapters || []} />
            )}
            {tab === 'highlights' && best && (best.items?.length ?? 0) === 0 && !loadingTab && (
              <div className={styles.empty}>暂无划线</div>
            )}
            {tab === 'reviews' && reviews && (reviews.reviews?.length ?? 0) === 0 && !loadingTab && (
              <div className={styles.empty}>暂无书评</div>
            )}
            {tab === 'chapters' && chapters && (chapters.chapters?.length ?? 0) === 0 && !loadingTab && (
              <div className={styles.empty}>暂无章节</div>
            )}
          </div>
        </div>
        <div className={styles.drawerFooter}>
          数据来自微信读书 · 加载 {formatRelativeTime(book?.lastReadTime ?? null)} 最近一次进度
        </div>
      </aside>
    </>
  );
}

function HighlightsPanel({
  items,
  chapterTitleById,
}: {
  items: NonNullable<BookBestBookmarks['items']>;
  chapterTitleById: Map<number, string>;
}) {
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) => (b.totalCount ?? 0) - (a.totalCount ?? 0));
  return (
    <>
      {sorted.map((it, idx) => {
        const chapterTitle =
          (it.chapterUid != null && chapterTitleById.get(it.chapterUid)) || '';
        return (
          <div key={it.bookmarkId || idx} className={styles.highlight}>
            <div className={styles.highlightMeta}>
              <span className={styles.highlightChapter}>
                {chapterTitle || `章节 ${it.chapterUid ?? '?'}`}
                {it.range ? ` · ${it.range}` : ''}
              </span>
              {typeof it.totalCount === 'number' && (
                <span className={styles.highlightLikes}>❤ {it.totalCount}</span>
              )}
            </div>
            <div>{it.markText}</div>
          </div>
        );
      })}
    </>
  );
}

function ReviewsPanel({reviews}: {reviews: BookReviews}) {
  const items = reviews.reviews || [];
  if (!items.length) return null;
  return (
    <>
      {items.map((r, idx) => (
        <div key={r.reviewId || idx} className={styles.review}>
          <div className={styles.reviewMeta}>
            <span>
              {typeof r.star === 'number' && r.star > 0
                ? safeRepeat('★', Math.min(5, r.star)) +
                  safeRepeat('☆', 5 - Math.min(5, r.star))
                : '未评分'}
            </span>
            <span>{formatDateOnly(r.createTime)}</span>
          </div>
          {r.title && <div className={styles.reviewTitle}>{r.title}</div>}
          {r.content && <div className={styles.reviewContent}>{r.content}</div>}
        </div>
      ))}
    </>
  );
}

function ChaptersPanel({chapters}: {chapters: NonNullable<BookChapters['chapters']>}) {
  if (!chapters.length) return null;
  return (
    <>
      {chapters.map((c) => (
        <div key={c.chapterUid} className={styles.chapter}>
          <span>{c.title || `章节 ${c.chapterUid}`}</span>
          <span className={styles.chapterMeta}>
            {c.wordCount != null ? `${c.wordCount} 字` : ''}
          </span>
        </div>
      ))}
    </>
  );
}
