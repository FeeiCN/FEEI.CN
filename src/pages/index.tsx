import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Head from '@docusaurus/Head';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import {usePluginData} from '@docusaurus/useGlobalData';
import type {HomeRecord} from '../../plugins/homeRecordsPlugin';
import styles from './index.module.css';

const featured = [
  {category: '经历', title: '我的网络安全之路', description: '从漏洞研究到企业安全建设，我为什么不再只盯着单个漏洞？', to: '/my-journey-in-cybersecurity'},
  {category: '方法', title: '安全体系', description: '安全工具都有了，如何建设经得起持续对抗的安全体系？', to: '/security-system'},
  {category: '人生', title: '创造确定性人生', description: '每天都很忙，如何让时间和精力真正流向重要的事？', to: '/life-certainty'},
];

function formatHomeDate(date: string, referenceYear?: string): string {
  return referenceYear && date.startsWith(`${referenceYear}-`) ? date.slice(5).replace('-', '.') : date.replaceAll('-', '.');
}

function HeroSection(): ReactNode {
  return (
    <section className={styles.hero}>
      <div className={styles.heroInner}>
        <h1>吴飞飞</h1>
        <p className={styles.heroIntro}>探索高等级的安全如何建设，也记录生活。</p>
        <p className={styles.heroGuide}>从网络安全到人工智能安全，积累攻防、架构与组织建设的方法。第一次来，可以从下面的问题开始。</p>
        <div className={styles.compactActions}>
          <a href="#start-reading">从这里开始 ↓</a>
          <Link to="/about">关于我 →</Link>
          <a href="/rss.xml">订阅新文章 · RSS ↗</a>
        </div>
        <p className={styles.currentFocus}>订阅安全研究、人生实践与日常记录的新文章；不固定更新频率，正文修订不会重复推送。</p>
      </div>
    </section>
  );
}

function ReadingSection(): ReactNode {
  return (
    <section className={styles.section} aria-labelledby="start-reading">
      <div className={styles.inner}>
        <Heading as="h2" id="start-reading" className={styles.compactHeading}>从这里开始</Heading>
        <div className={styles.featuredList}>
          {featured.map((item, index) => (
            <Link key={item.to} to={item.to} className={styles.featuredItem}>
              <span className={styles.readingNumber} aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <div className={styles.featuredCopy}><h3>{item.title}</h3><p>{item.description}</p></div>
              <span className={styles.featuredCategory}>{item.category}</span>
              <span className={styles.itemArrow} aria-hidden="true">↗</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function RecentSection(): ReactNode {
  const {records, recordsHref, updates} = usePluginData('home-records-plugin') as {records: HomeRecord[]; recordsHref?: string; updates: HomeRecord[]};
  if (!records.length && !updates.length) return null;
  const recordsYear = records[0]?.date.slice(0, 4);
  const updatesYear = updates[0]?.date.slice(0, 4);
  return (
    <section className={styles.section} aria-labelledby="recent-heading">
      <div className={styles.inner}>
        <h2 id="recent-heading" className={styles.compactHeading}>最近记录</h2>
        <div className={styles.updateGrid}>
          {updates.length > 0 && <div>
            <h3><Link to="/security-engineering">网络安全 · 近期修订 →</Link></h3>
            <div className={styles.recentList}>{updates.map((item) => (
              <Link key={item.to} to={item.to} className={styles.recentItem}>
                <time dateTime={item.date}>{formatHomeDate(item.date, updatesYear)}</time><span>{item.title}</span>
              </Link>
            ))}</div>
          </div>}
          {records.length > 0 && recordsHref && <div>
            <h3><Link to={recordsHref}>日记 →</Link></h3>
            <div className={styles.recentList}>{records.map((item) => (
              <Link key={item.to} to={item.to} className={styles.recentItem}>
                <time dateTime={item.date}>{formatHomeDate(item.date, recordsYear)}</time><span>{item.title}</span>
              </Link>
            ))}</div>
          </div>}
        </div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  return (
    <Layout wrapperClassName={styles.homeLayout} description="吴飞飞的个人网站。探索高等级的安全如何建设，积累网络安全与人工智能安全的攻防、架构和组织建设方法，也记录人生实践与日常生活。">
      <Head>
        <title>吴飞飞 · 安全界</title>
        <meta property="og:title" content="吴飞飞 · 安全界" />
      </Head>
      <main className={styles.page}>
        <HeroSection />
        <ReadingSection />
        <RecentSection />
      </main>
    </Layout>
  );
}
