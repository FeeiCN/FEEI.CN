import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Head from '@docusaurus/Head';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import {usePluginData} from '@docusaurus/useGlobalData';
import type {HomeRecord} from '../../plugins/homeRecordsPlugin';
import styles from './index.module.css';

const featured = [
  {category: '经历', title: '我的网络安全之路', description: '从漏洞研究到大型平台安全建设的职业记录。', to: '/my-journey-in-cybersecurity'},
  {category: '方法', title: '安全体系', description: '把风险、责任和技术能力组织成可运行的系统。', to: '/security-system'},
  {category: '人生', title: '创造确定性人生', description: '一个人如何在不确定中建立长期选择权。', to: '/life-certainty'},
];

function formatHomeDate(date: string, referenceYear?: string): string {
  return referenceYear && date.startsWith(`${referenceYear}-`) ? date.slice(5).replace('-', '.') : date.replaceAll('-', '.');
}

function HeroSection(): ReactNode {
  return (
    <section className={styles.hero}>
      <div className={styles.heroInner}>
        <h1>吴飞飞</h1>
        <p className={styles.heroIntro}>写网络安全、人工智能安全，也记录生活。</p>
        <p className={styles.heroGuide}>我把这些年的工作、思考和生活记录在这里。第一次来，可以先从下面三篇开始。</p>
        <div className={styles.compactActions}>
          <a href="#start-reading">从这里开始 ↓</a>
          <Link to="/about">关于我 →</Link>
          <a href="/rss.xml">RSS ↗</a>
        </div>
        <p className={styles.currentFocus}>最近在关注：AI 自动化攻击、漏洞挖掘，以及如何把经验写成系统。</p>
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
  const {records, updates} = usePluginData('home-records-plugin') as {records: HomeRecord[]; updates: HomeRecord[]};
  if (!records.length && !updates.length) return null;
  const recordsYear = records[0]?.date.slice(0, 4);
  const recordsMonth = records[0]?.date.slice(0, 7);
  const updatesYear = updates[0]?.date.slice(0, 4);
  return (
    <section className={styles.section} aria-labelledby="recent-heading">
      <div className={styles.inner}>
        <h2 id="recent-heading" className={styles.compactHeading}>最近记录</h2>
        <div className={styles.updateGrid}>
          {updates.length > 0 && <div>
            <h3><Link to="/security-engineering">网络安全 · 最近更新 →</Link></h3>
            <div className={styles.recentList}>{updates.map((item) => (
              <Link key={item.to} to={item.to} className={styles.recentItem}>
                <time dateTime={item.date}>{formatHomeDate(item.date, updatesYear)}</time><span>{item.title}</span>
              </Link>
            ))}</div>
          </div>}
          {records.length > 0 && <div>
            <h3><Link to={`/${recordsMonth}`}>日记 →</Link></h3>
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
    <Layout wrapperClassName={styles.homeLayout} description="吴飞飞的个人网站。写网络安全、人工智能安全与人生系统，也记录健康、阅读、旅行和日常生活。">
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
