import React, {useEffect} from 'react';
import OriginalSearchBar from '@easyops-cn/docusaurus-search-local/dist/client/client/theme/SearchBar';
import styles from './styles.module.css';

const INPUT_SELECTOR = '.navbar__search-input';

export default function SearchBarWrapper(props) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'Enter' || !event.target?.matches?.(INPUT_SELECTOR)) return;
      const query = event.target.value.trim();
      if (!query) return;
      event.preventDefault();
      event.stopPropagation();
      window.location.assign(`/search/?q=${encodeURIComponent(query)}`);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, []);

  return (
    <div className={styles.wrapper}>
      <OriginalSearchBar {...props} />
    </div>
  );
}
