import React, {useContext} from 'react';
import {ReadingCtx, type TimeScope} from './index-shared';
import styles from './styles.module.css';

const MODE_LABELS: Record<TimeScope['mode'], string> = {
  year: '年度',
  all: '历史',
};

export default function ReadingTimeBar() {
  const {scope, setScope, availableYears, loading} = useContext(ReadingCtx);

  const handleMode = (mode: TimeScope['mode']) => {
    if (mode === 'year') {
      setScope((prev) => {
        if (prev.mode === 'year') return prev;
        const currentYear = new Date().getFullYear();
        const fallback = availableYears.length
          ? availableYears[0]
          : currentYear;
        return {mode: 'year', year: fallback};
      });
      return;
    }
    setScope({mode: 'all'});
  };

  const handleYear = (year: number) => {
    setScope({mode: 'year', year});
  };

  return (
    <div className={styles.floatingStack}>
      <div className={styles.floatingBar} role="group" aria-label="时间维度">
        {(['year', 'all'] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={scope.mode === m}
            className={`${styles.floatingBtn} ${
              scope.mode === m ? styles.floatingBtnActive : ''
            }`}
            onClick={() => handleMode(m)}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>
      <div className={`${styles.floatingBar} ${styles.floatingOptionBar}`}>
        {scope.mode === 'year' &&
          availableYears.map((y) => (
            <button
              key={y}
              type="button"
              aria-pressed={scope.mode === 'year' && scope.year === y}
              className={`${styles.floatingBtn} ${
                scope.year === y ? styles.floatingBtnActive : ''
              }`}
              onClick={() => handleYear(y)}
            >
              {y}
            </button>
          ))}
        {scope.mode === 'all' && (
          <button
            type="button"
            className={`${styles.floatingBtn} ${styles.floatingBtnActive}`}
          >
            全部历史
          </button>
        )}
        {loading && <span className={styles.floatingLoading}>…</span>}
      </div>
    </div>
  );
}
