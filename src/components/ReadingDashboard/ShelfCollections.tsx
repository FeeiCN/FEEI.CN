import React from 'react';
import type {Collection, LibraryBook} from './types';
import styles from './styles.module.css';

type Props = {
  collections: Collection[];
  library: LibraryBook[];
  activeCollection: string | null;
  onSelectCollection: (name: string | null) => void;
};

export default function ShelfCollections({
  collections,
  library,
  activeCollection,
  onSelectCollection,
}: Props) {
  const titlesById = new Map(library.map((b) => [b.bookId, b.title]));
  const enriched = collections.map((c) => {
    const titles = (c.bookIds || [])
      .map((id) => titlesById.get(id))
      .filter((t): t is string => Boolean(t));
    return {...c, matched: titles.length, titles};
  });

  const totalMatched = enriched.reduce((sum, c) => sum + c.matched, 0);
  const allEmpty = enriched.every((c) => c.bookIds.length === 0);
  const hasUsableCollections = enriched.length > 0;

  if (!hasUsableCollections) return null;
  if (allEmpty && totalMatched === 0) {
    return (
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>专题书架</h3>
        </div>
        <div className={styles.shelfEmpty}>暂无专题书架，可在微信读书侧建立</div>
      </section>
    );
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>专题书架</h3>
        {totalMatched > 0 && (
          <span className={styles.sectionHint}>
            点击筛选该专题内的书
          </span>
        )}
      </div>
      <div className={styles.collections}>
        <button
          type="button"
          className={`${styles.collectionChip} ${
            activeCollection === null ? styles.collectionChipActive : ''
          }`}
          onClick={() => onSelectCollection(null)}
        >
          全部
        </button>
        {enriched.map((c) => {
          const isActive = activeCollection === c.name;
          const count = c.matched > 0 ? c.matched : c.bookIds.length;
          return (
            <button
              key={c.name}
              type="button"
              className={`${styles.collectionChip} ${
                isActive ? styles.collectionChipActive : ''
              }`}
              onClick={() => onSelectCollection(isActive ? null : c.name)}
              title={c.titles.length ? c.titles.join('、') : c.name}
            >
              {c.name}
              <span className={styles.collectionCount}>{count}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
