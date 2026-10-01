import React, {useEffect} from 'react';
import OriginalSearchPage from '@easyops-cn/docusaurus-search-local/dist/client/client/theme/SearchPage';

function installSearchSorting() {
  if (document.querySelector('[data-search-sort]')) return;
  const first = document.querySelector('main article');
  if (!first) return;
  const originalOrder = Array.from(document.querySelectorAll('main article'));
  const label = document.createElement('label');
  label.dataset.searchSort = 'true';
  label.style.cssText = 'display:flex;align-items:center;gap:.5rem;margin:0 0 1rem;';
  label.textContent = '排序';
  const select = document.createElement('select');
  select.setAttribute('aria-label', '搜索结果排序');
  select.innerHTML = '<option value="relevance">相关性</option><option value="newest">最新</option><option value="oldest">最早</option>';
  select.addEventListener('change', () => {
    const ordered = [...originalOrder];
    if (select.value !== 'relevance') {
      const date = (article) => {
        const href = article.querySelector('a[href]')?.getAttribute('href') ?? '';
        const match = href.match(/^\/(\d{4})-(\d{2})-(\d{2})\/?$/);
        return match ? Date.parse(`${match[1]}-${match[2]}-${match[3]}`) : null;
      };
      ordered.sort((a, b) => {
        const left = date(a);
        const right = date(b);
        if (left === null && right === null) return 0;
        if (left === null) return 1;
        if (right === null) return -1;
        return select.value === 'newest' ? right - left : left - right;
      });
    }
    const parent = originalOrder[0]?.parentElement;
    if (parent) ordered.forEach((article) => parent.appendChild(article));
  });
  first.parentElement?.prepend(label);
}

export default function SearchPageWrapper(props) {
  useEffect(() => {
    const observer = new MutationObserver(installSearchSorting);
    observer.observe(document.body, {childList: true, subtree: true});
    installSearchSorting();
    return () => observer.disconnect();
  }, []);
  return <OriginalSearchPage {...props} />;
}
