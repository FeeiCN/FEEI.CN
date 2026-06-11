import React from 'react';
import type {LibraryBook} from './types';
import {formatDuration, formatRelativeTime} from './utils';
import styles from './styles.module.css';

type Props = {
  library: LibraryBook[];
  onSelect: (bookId: string) => void;
  maxItems?: number;
};

export default function CurrentlyReading({library, onSelect, maxItems = 6}: Props) {
  const inProgress = library
    .filter((b) => {
      const p = b.progress ?? 0;
      return p > 0 && p < 100 && b.lastReadTime;
    })
    .sort((a, b) => (b.lastReadTime ?? 0) - (a.lastReadTime ?? 0))
    .slice(0, maxItems);

  if (inProgress.length === 0) {
    return (
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>在读</h3>
        </div>
        <div className={styles.shelfEmpty}>当前没有正在读的书</div>
      </section>
    );
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>在读</h3>
        <span className={styles.sectionHint}>最近仍在读的书</span>
      </div>
      <div className={styles.currentList}>
        {inProgress.map((b) => {
          const pct = Math.max(0, Math.min(100, b.progress ?? 0));
          return (
            <button
              key={b.bookId}
              type="button"
              className={styles.currentCard}
              onClick={() => onSelect(b.bookId)}
            >
              {b.cover ? (
                <img
                  className={styles.currentCover}
                  src={`/reading/books/${b.bookId}/cover.jpg`}
                  alt={b.title}
                  loading="lazy"
                  onError={(e) => {
                    const img = e.currentTarget;
                    if (img.src !== b.cover) img.src = b.cover;
                  }}
                />
              ) : (
                <div className={`${styles.currentCover} ${styles.currentCoverPlaceholder}`}>
                  封面
                </div>
              )}
              <div className={styles.currentMeta}>
                <span className={styles.currentTitle}>{b.title || '未命名'}</span>
                <span className={styles.currentAuthor}>{b.author || '—'}</span>
                <div className={styles.progressBar} aria-label={`进度 ${pct}%`}>
                  <div className={styles.progressFill} style={{width: `${pct}%`}} />
                </div>
                <div className={styles.currentFooter}>
                  <span>{pct}%</span>
                  <span>{formatRelativeTime(b.lastReadTime)}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
