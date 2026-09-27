import {useState, type ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import {usePluginData} from '@docusaurus/useGlobalData';
import type {ArticleRecord} from '../../plugins/homeRecordsPlugin';
import styles from './articles.module.css';

export default function Articles(): ReactNode {
  const {articles} = usePluginData('home-records-plugin') as {articles: ArticleRecord[]};
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState('全部');
  const topics = ['全部', ...new Set(articles.map((article) => article.topic))];
  const visible = articles.filter((article) => (topic === '全部' || article.topic === topic)
    && article.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return (
    <Layout title="全部文章" description="浏览网络安全、人工智能安全、人生系统、日记与年度总结，按主题筛选或搜索标题。">
      <main className={styles.archive}>
        <Link to="/#start-reading">← 首页精选</Link>
        <h1>全部文章</h1>
        <p>工作、思考与生活的记录，也包括持续整理的专题。按首次发布日期排列，未注明日期的内容列在后面。</p>
        <label className={styles.search}>搜索标题
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入标题关键词" />
        </label>
        <div className={styles.filters} role="group" aria-label="按主题筛选">
          {topics.map((item) => <button key={item} type="button" aria-pressed={topic === item} onClick={() => setTopic(item)}>{item}</button>)}
        </div>
        <p role="status">共 {visible.length} 篇</p>
        {visible.length ? <ul className={styles.list}>
          {visible.map((article) => <li key={article.to}>
            <Link to={article.to}>{article.title}</Link>
            <span className={styles.meta}>{article.topic}{article.date && <> · <time dateTime={article.date}>{article.date}</time></>}</span>
          </li>)}
        </ul> : <p>没有匹配的文章，试试其他关键词或主题。</p>}
      </main>
    </Layout>
  );
}
