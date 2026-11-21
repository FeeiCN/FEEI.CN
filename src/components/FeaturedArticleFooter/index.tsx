import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import {useDoc} from '@docusaurus/plugin-content-docs/client';
import {featuredForPath, readingDestinations} from '@site/src/data/featuredReading';
import styles from './styles.module.css';

export default function FeaturedArticleFooter(): ReactNode {
  const {metadata} = useDoc();
  const article = featuredForPath(metadata.permalink);
  if (!article) return null;

  return (
    <section className={styles.section} aria-label="延伸阅读与作者">
      <h2>接着读什么</h2>
      <nav className={styles.reading} aria-label="有理由的延伸阅读">
        {article.next.map((to) => (
          <Link key={to} to={to}>
            <span className={styles.title}>{readingDestinations[to].title}<span aria-hidden="true"> ↗</span></span>
            <span className={styles.reason}>{readingDestinations[to].description}</span>
          </Link>
        ))}
      </nav>
      <div className={styles.author}>
        <p><Link to="/about">吴飞飞 · Feei</Link><span>网络安全从业者，生活在杭州。记录安全建设的实践，也记录普通的日子。</span></p>
        <div><a href="/rss.xml">RSS 订阅</a><Link to="/contact">联系我</Link><Link to="/">回到首页</Link></div>
      </div>
      <p className={styles.subscription}>不固定更新；RSS 只推送新文章，正文修订不重复推送。</p>
    </section>
  );
}
