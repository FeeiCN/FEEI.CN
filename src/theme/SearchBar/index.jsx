import React, {useEffect} from 'react';
import OriginalSearchBar from '@easyops-cn/docusaurus-search-local/dist/client/client/theme/SearchBar';
import {usePluginData} from '@docusaurus/useGlobalData';
import styles from './styles.module.css';

const INPUT_SELECTOR = '.navbar__search-input';
const SEARCH_ROUTE_PREFIX = '/search';
const SORT_CONTROL_SELECTOR = '[data-search-sort]';

function getResultArticles(section) {
  return Array.from(section.children).filter((element) => element.tagName === 'ARTICLE');
}

function getArticleDate(article, updatedAtByPermalink) {
  const href = article.querySelector('a[href]')?.getAttribute('href') ?? '';
  try {
    const pathname = new URL(href, window.location.origin).pathname.replace(/\/$/, '') || '/';
    const timestamp = updatedAtByPermalink?.[pathname] ?? updatedAtByPermalink?.[`${pathname}/`];
    if (Number.isFinite(timestamp) && timestamp > 0) return timestamp;
  } catch {
    // Keep undated results at the end when a result link is malformed.
  }
  const timeValue = article.querySelector('time[datetime]')?.getAttribute('datetime');
  const timestamp = timeValue ? Date.parse(timeValue) : Number.NaN;
  return Number.isNaN(timestamp) ? null : timestamp;
}

function sortArticles(section, originalOrder, mode, updatedAtByPermalink) {
  const ordered =
    mode === 'relevance'
      ? originalOrder
      : originalOrder
          .map((article, index) => ({article, index, timestamp: getArticleDate(article, updatedAtByPermalink)}))
          .sort((left, right) => {
            if (left.timestamp === null && right.timestamp === null) {
              return left.index - right.index;
            }
            if (left.timestamp === null) return 1;
            if (right.timestamp === null) return -1;
            const difference =
              mode === 'newest'
                ? right.timestamp - left.timestamp
                : left.timestamp - right.timestamp;
            return difference || left.index - right.index;
          })
          .map(({article}) => article);

  const currentOrder = Array.from(section.children).filter(
    (element) => element.tagName === 'ARTICLE',
  );
  if (currentOrder.length === ordered.length && currentOrder.every((article, index) => article === ordered[index])) {
    return;
  }

  ordered.forEach((article) => section.appendChild(article));
}

function createSortControl(onChange) {
  const label = document.createElement('label');
  label.dataset.searchSort = 'true';
  label.className = styles.searchSortControl;
  label.textContent = '排序';

  const select = document.createElement('select');
  select.className = styles.searchSortSelect;
  select.setAttribute('aria-label', '搜索结果排序');
  select.innerHTML =
    '<option value="relevance">相关性</option><option value="newest">最新</option><option value="oldest">最早</option>';
  select.addEventListener('change', () => onChange(select.value));

  label.appendChild(select);
  return label;
}

function useSearchSorting() {
  const {updatedAtByPermalink = {}} = usePluginData('home-records-plugin') || {};

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    let sectionRef = null;
    let originalOrder = [];
    let mode = 'relevance';

    const install = () => {
      if (!window.location.pathname.startsWith(SEARCH_ROUTE_PREFIX)) {
        sectionRef = null;
        originalOrder = [];
        return;
      }

      const section = document.querySelector('.main-wrapper section');
      if (!section) return;

      const articles = getResultArticles(section);
      if (!articles.length) return;

      if (
        section !== sectionRef ||
        articles.length !== originalOrder.length ||
        originalOrder.some((article) => !articles.includes(article))
      ) {
        sectionRef = section;
        originalOrder = [...articles];
      }

      let control = section.parentElement?.querySelector(SORT_CONTROL_SELECTOR);
      if (!control) {
        control = createSortControl((nextMode) => {
          mode = nextMode;
          sortArticles(section, originalOrder, mode, updatedAtByPermalink);
        });
        section.parentElement?.insertBefore(control, section);
      }

      sortArticles(section, originalOrder, mode, updatedAtByPermalink);
    };

    const observer = new MutationObserver(install);
    observer.observe(document.body, {childList: true, subtree: true});
    install();

    return () => observer.disconnect();
  }, []);
}

export default function SearchBarWrapper(props) {
  useSearchSorting();

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
