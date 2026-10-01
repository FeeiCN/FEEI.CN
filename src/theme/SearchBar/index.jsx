import React, {useEffect, useState} from 'react';
import OriginalSearchBar from '@easyops-cn/docusaurus-search-local/dist/client/client/theme/SearchBar';
import styles from './styles.module.css';

// 热门搜索建议关键词 — 与网站内容主题对应
const SUGGESTIONS = [
  '安全',
  '投资',
  'AI',
  '职业',
  '软件工程',
  '旅行',
  '阅读',
  '财务自由',
];

const INPUT_SELECTOR = '.navbar__search-input';
const PANEL_HIDE_DELAY = 150;

const SearchIcon = () => (
  <svg
    className={styles.suggestionIcon}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export default function SearchBarWrapper(props) {
  const [active, setActive] = useState(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const onFocusIn = (event) => {
      if (event.target?.matches?.(INPUT_SELECTOR)) {
        setActive(true);
        setEmpty(event.target.value === '');
      }
    };
    const onFocusOut = (event) => {
      if (event.target?.matches?.(INPUT_SELECTOR)) {
        // 延迟关闭，让点击建议词的事件先触发
        setTimeout(() => setActive(false), PANEL_HIDE_DELAY);
      }
    };
    const onInput = (event) => {
      if (event.target?.matches?.(INPUT_SELECTOR)) {
        setEmpty(event.target.value === '');
      }
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('input', onInput);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('input', onInput);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.location.pathname.startsWith('/search')) return undefined;

    let originalOrder = [];
    let select;
    const sortResults = (mode) => {
      const articles = Array.from(document.querySelectorAll('main article'));
      if (!articles.length) return;
      if (!originalOrder.length) originalOrder = [...articles];
      const ordered = mode === 'relevance' ? originalOrder : [...originalOrder].sort((a, b) => {
        const date = (article) => {
          const href = article.querySelector('a[href]')?.getAttribute('href') ?? '';
          const match = href.match(/^\/(\d{4})-(\d{2})-(\d{2})\/?$/);
          return match ? Date.parse(`${match[1]}-${match[2]}-${match[3]}`) : null;
        };
        const left = date(a);
        const right = date(b);
        if (left === null && right === null) return 0;
        if (left === null) return 1;
        if (right === null) return -1;
        return mode === 'newest' ? right - left : left - right;
      });
      const parent = articles[0].parentElement;
      if (parent) ordered.forEach((article) => parent.appendChild(article));
    };
    const install = () => {
      const first = document.querySelector('main article');
      if (!first || document.querySelector('[data-search-sort]')) return;
      const label = document.createElement('label');
      label.dataset.searchSort = 'true';
      label.style.cssText = 'display:flex;align-items:center;gap:.5rem;margin:0 0 1rem;';
      label.textContent = '排序';
      select = document.createElement('select');
      select.setAttribute('aria-label', '搜索结果排序');
      select.innerHTML = '<option value="relevance">相关性</option><option value="newest">最新</option><option value="oldest">最早</option>';
      select.addEventListener('change', () => sortResults(select.value));
      label.appendChild(select);
      first.parentElement?.prepend(label);
    };
    const observer = new MutationObserver(install);
    observer.observe(document.body, {childList: true, subtree: true});
    install();
    return () => observer.disconnect();
  }, []);

  const handleSuggestionClick = (suggestion) => {
    const input = document.querySelector(INPUT_SELECTOR);
    if (!input) return;
    // 直接设置 value 并触发 React 的 input 事件，让原 SearchBar 接管搜索
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;
    if (nativeSetter) {
      nativeSetter.call(input, suggestion);
    } else {
      input.value = suggestion;
    }
    input.dispatchEvent(new Event('input', {bubbles: true}));
    input.focus();
    setEmpty(false);
  };

  return (
    <div className={styles.wrapper}>
      <OriginalSearchBar {...props} />
      {active && empty && (
        <div className={styles.suggestionsPanel} role="listbox" aria-label="热门搜索">
          <div className={styles.suggestionsLabel}>热门搜索</div>
          <div className={styles.suggestionsList}>
            {SUGGESTIONS.map((keyword) => (
              <button
                key={keyword}
                type="button"
                className={styles.suggestionItem}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => handleSuggestionClick(keyword)}>
                <SearchIcon />
                <span className={styles.suggestionText}>{keyword}</span>
                <span className={styles.suggestionHint}>搜索</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
