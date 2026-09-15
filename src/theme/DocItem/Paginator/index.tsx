import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import {useDoc} from '@docusaurus/plugin-content-docs/client';
import styles from './styles.module.css';

type PaginatorItem = {
  title: string;
  permalink: string;
};

function getDate(permalink: string): string | null {
  const match = permalink.match(/\/(\d{4})-(\d{2})-(\d{2})\/?$/);
  return match ? `${match[2]}-${match[3]}` : null;
}

function Item({item, direction}: {item: PaginatorItem; direction: 'previous' | 'next'}): ReactNode {
  const date = getDate(item.permalink);
  const label = date ? `${date} · ${item.title}` : item.title;

  return (
    <Link className={`${styles.item} ${direction === 'next' ? styles.next : ''}`} to={item.permalink}>
      <span className={styles.direction}>{direction === 'previous' ? '上一篇' : '下一篇'}</span>
      <span className={styles.title}>{label}</span>
    </Link>
  );
}

export default function DocItemPaginator(): ReactNode {
  const {metadata} = useDoc();
  const previous = metadata.previous as PaginatorItem | undefined;
  const next = metadata.next as PaginatorItem | undefined;

  if (!previous && !next) return null;

  return (
    <nav className={styles.paginator} aria-label="文章翻页导航">
      {previous ? <Item item={previous} direction="previous" /> : <span />}
      {next ? <Item item={next} direction="next" /> : <span />}
    </nav>
  );
}
