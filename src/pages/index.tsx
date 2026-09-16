import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import {usePluginData} from '@docusaurus/useGlobalData';
import type {HomeRecord} from '../../plugins/homeRecordsPlugin';
import styles from './index.module.css';

const featured = [
  {title: '我的网络安全之路', description: '从一台旧电脑、漏洞研究，到电商、银行与支付平台的安全建设。', to: '/my-journey-in-cybersecurity'},
  {title: '安全体系', description: '怎样把风险、组织责任与技术能力，连成持续运行的防御体系。', to: '/security-system'},
  {title: '创造确定性人生', description: '无法让未来完全确定，但可以让自己更能承受不确定性。', to: '/life-certainty'},
];

function HeroSection(): ReactNode {
  return (
    <section className={styles.hero}>
      <div className={styles.heroInner}>
        <h1>吴飞飞</h1>
        <p className={styles.heroIntro}>写网络安全、人工智能安全，也记录生活。</p>
        <div className={styles.compactActions}>
          <Link to="/my-journey-in-cybersecurity">关于我 →</Link>
          <a href="/rss.xml">RSS ↗</a>
        </div>
      </div>
    </section>
  );
}

function ReadingSection(): ReactNode {
  return (
    <section className={styles.section} aria-labelledby="start-reading">
      <div className={styles.inner}>
        <Heading as="h2" id="start-reading" className={styles.compactHeading}>精选阅读</Heading>
        <div className={styles.featuredList}>
          {featured.map((item, index) => (
            <Link key={item.to} to={item.to} className={styles.featuredItem}>
              <span className={styles.readingNumber} aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <div className={styles.featuredCopy}><h3>{item.title}</h3><p>{item.description}</p></div>
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
  return (
    <section className={styles.section} aria-labelledby="recent-heading">
      <div className={styles.inner}>
        <h2 id="recent-heading" className={styles.compactHeading}>最近记录</h2>
        <div className={styles.updateGrid}>
          {updates.length > 0 && <div>
            <h3><Link to="/security-engineering">网络安全 · 最近复核 →</Link></h3>
            <div className={styles.recentList}>{updates.map((item) => (
              <Link key={item.to} to={item.to} className={styles.recentItem}>
                <time dateTime={item.date}>{item.date.replaceAll('-', '.')}</time><span>{item.title}</span>
              </Link>
            ))}</div>
          </div>}
          {records.length > 0 && <div>
            <h3><Link to={`/${recordsYear}`}>日记 →</Link></h3>
            <div className={styles.recentList}>{records.map((item) => (
              <Link key={item.to} to={item.to} className={styles.recentItem}>
                <time dateTime={item.date}>{item.date.replaceAll('-', '.')}</time><span>{item.title}</span>
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
    <Layout wrapperClassName={styles.homeLayout} title="吴飞飞" description="吴飞飞的个人网站。写网络安全、人工智能安全与人生系统，也记录健康、阅读、旅行和日常生活。">
      <main className={styles.page}>
        <HeroSection />
        <ReadingSection />
        <RecentSection />
      </main>
    </Layout>
  );
}
