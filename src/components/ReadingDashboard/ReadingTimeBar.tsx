import React, {useContext} from 'react';
import ReactDOM from 'react-dom';
import {ReadingCtx, type TimeScope} from './index-shared';
import styles from './styles.module.css';

const MODE_LABELS: Record<TimeScope['mode'], string> = {
  year: '年度',
  all: '历史',
};

export default function ReadingTimeBar() {
  const {scope, setScope, availableYears, loading} = useContext(ReadingCtx);

  if (typeof document === 'undefined') return null;

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

  return ReactDOM.createPortal(
    <div className={styles.floatingStack}>
      <div className={styles.floatingBar} role="tablist" aria-label="时间维度">
        {(['year', 'all'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={scope.mode === m}
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
    </div>,
    document.body,
  );
}
