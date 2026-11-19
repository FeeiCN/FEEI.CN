import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Head from '@docusaurus/Head';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import {usePluginData} from '@docusaurus/useGlobalData';
import type {HomeRecord} from '../../plugins/homeRecordsPlugin';
import {authorPortrait, featuredReading, shareImageForPath} from '../data/featuredReading';
import styles from './index.module.css';

function formatHomeDate(date: string, referenceYear?: string): string {
  return referenceYear && date.startsWith(`${referenceYear}-`) ? date.slice(5).replace('-', '.') : date.replaceAll('-', '.');
}

function HeroSection(): ReactNode {
  return (
    <section className={styles.hero} aria-labelledby="home-title">
      <div className={styles.heroInner}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>网络安全 · 人工智能安全 · 生活记录</p>
          <h1 id="home-title">吴飞飞<span>Feei</span></h1>
          <p className={styles.heroIntro}>探索高等级的安全如何建设，<br />也认真记录工作之外的生活。</p>
          <p className={styles.heroGuide}>一名生活在杭州的网络安全从业者。<br className={styles.desktopBreak} />从漏洞研究走向企业安全建设，把实践、取舍和后来修正的判断写下来。</p>
          <div className={styles.compactActions}>
            <a href="#start-reading" className={styles.primaryAction}>读几篇精选 <span aria-hidden="true">↓</span></a>
            <Link to="/about">认识我 <span aria-hidden="true">↗</span></Link>
          </div>
        </div>
        <figure className={styles.portrait}>
          <div className={styles.portraitFrame}><img src={authorPortrait} alt="吴飞飞" width="240" height="288" fetchPriority="high" /></div>
          <figcaption>杭州 · 从 2012 年开始记录</figcaption>
        </figure>
      </div>
    </section>
  );
}

function ReadingSection(): ReactNode {
  return (
    <section className={styles.section} aria-labelledby="start-reading">
      <div className={styles.inner}>
        <div className={styles.sectionHeading}>
          <Heading as="h2" id="start-reading">第一次来，读这几篇</Heading>
          <p>从一个问题、一段经历，认识这里。</p>
        </div>
        <div className={styles.featuredList}>
          {featuredReading.map((item, index) => (
            <Link key={item.to} to={item.to} className={styles.featuredItem}>
              <div className={styles.readingMeta}><span>{String(index + 1).padStart(2, '0')}</span><span>{item.category}</span><span aria-hidden="true">↗</span></div>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function PublicWorkSection(): ReactNode {
  return (
    <section className={styles.section} aria-labelledby="public-work">
      <div className={`${styles.inner} ${styles.publicWork}`}>
        <div className={styles.sectionHeading}>
          <Heading as="h2" id="public-work">从实践到分享</Heading>
          <p>做过的工具，公开讲过的问题，以及团队沉淀的材料。</p>
        </div>
        <div className={styles.workList}>
          <Link to="/gsil"><span className={styles.workType}>工具实践</span><strong>GSIL 与 Cobra</strong><span>从敏感信息泄漏监测，到企业级代码审计。</span><span aria-hidden="true">↗</span></Link>
          <Link to="/speech"><span className={styles.workType}>公开分享</span><strong>演讲与交流</strong><span>安全架构、支付安全，以及 AI 进入真实业务。</span><span aria-hidden="true">↗</span></Link>
          <Link to="/publications"><span className={styles.workType}>出版与白皮书</span><strong>团队经验的沉淀</strong><span>数字银行安全体系、可信纵深防御与原生安全。</span><span aria-hidden="true">↗</span></Link>
        </div>
        <div className={styles.workDetails}>
          <Link to="/cobra">阅读 Cobra 实践 →</Link>
          <Link to="/ai-personal-to-org-efficiency">从个人 AI 提效到组织 AI 提效 →</Link>
          <Link to="/digital-bank-cybersecurity-system-construction">数字银行安全体系构建 →</Link>
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
        <div className={styles.sectionHeading}><h2 id="recent-heading">最近，在写什么</h2><p>专题随着认识修订，日记留下当时的生活。</p></div>
        <div className={styles.updateGrid}>
          {updates.length > 0 && <div>
            <h3><Link to="/security-engineering">安全研究 · 近期修订 <span aria-hidden="true">→</span></Link></h3>
            <div>{updates.map((item) => (
              <Link key={item.to} to={item.to} className={styles.recentItem}>
                <time dateTime={item.date}>{formatHomeDate(item.date, updatesYear)}</time><span>{item.title}</span>
              </Link>
            ))}</div>
          </div>}
          {records.length > 0 && recordsHref && <div>
            <h3><Link to={recordsHref}>日记 · 最近的日子 <span aria-hidden="true">→</span></Link></h3>
            <div>{records.map((item) => (
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

function StayInTouch(): ReactNode {
  return (
    <section className={styles.section} aria-labelledby="stay-in-touch">
      <div className={`${styles.inner} ${styles.stayInTouch}`}>
        <div><h2 id="stay-in-touch">有空，再来坐坐。</h2><p>安全研究、人生实践与日常记录，不固定更新。RSS 只推送新文章，正文修订不重复推送。</p></div>
        <div className={styles.compactActions}><a href="/rss.xml">订阅新文章 · RSS ↗</a><Link to="/contact">联系我 ↗</Link></div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  return (
    <Layout wrapperClassName={styles.homeLayout} description="吴飞飞（Feei）的个人网站。从漏洞研究走向企业安全建设，记录网络安全、人工智能安全的实践与判断，也留下杭州的日常生活。">
      <Head>
        <title>吴飞飞 · 安全界</title>
        <meta property="og:title" content="吴飞飞 · 安全界" />
        <meta property="og:image" content={shareImageForPath('/')} />
        <meta property="og:image:alt" content="吴飞飞 · Feei：网络安全、人工智能安全与生活记录" />
        <meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" />
        <meta name="twitter:image" content={shareImageForPath('/')} />
        <meta name="twitter:card" content="summary_large_image" />
      </Head>
      <main className={styles.page}>
        <HeroSection />
        <ReadingSection />
        <PublicWorkSection />
        <RecentSection />
        <StayInTouch />
      </main>
    </Layout>
  );
}
