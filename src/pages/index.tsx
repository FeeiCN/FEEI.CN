import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Head from '@docusaurus/Head';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import {usePluginData} from '@docusaurus/useGlobalData';
import type {HomeAnnualReview, HomeRecord} from '../../plugins/homeRecordsPlugin';
import {authorPortrait, featuredReading, shareImageForPath} from '../data/featuredReading';
import styles from './index.module.css';

function formatHomeDate(date: string, referenceYear?: string): string {
  return referenceYear && date.startsWith(`${referenceYear}-`) ? date.slice(5).replace('-', '.') : date.replaceAll('-', '.');
}

function Arrow({diagonal = false}: {diagonal?: boolean}): ReactNode {
  return <span aria-hidden="true">{diagonal ? '↗' : '→'}</span>;
}

function HeroSection(): ReactNode {
  return (
    <section className={styles.hero} aria-labelledby="home-title">
      <div className={`${styles.container} ${styles.heroGrid}`}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>网络安全 · 人工智能安全 · 生活记录</p>
          <h1 id="home-title">吴飞飞<span>Feei</span></h1>
          <p className={styles.heroLead}>探索高等级的安全如何建设，<br />也认真记录工作之外的生活。</p>
          <p className={styles.heroDescription}>从漏洞研究走向企业安全建设。<br className={styles.desktopBreak} />把做过的事、走过的弯路和后来修正的判断写下来。</p>
          <div className={styles.heroActions}>
            <a href="#start-reading" className={styles.primaryAction}>从三篇文章开始 <span aria-hidden="true">↓</span></a>
            <Link to="/about" className={styles.secondaryAction}>认识我 <Arrow diagonal /></Link>
          </div>
          <nav className={styles.proofLinks} aria-label="公开成果入口">
            <a href="#public-work">工具与实践</a><Link to="/speech">公开演讲</Link><Link to="/publications">出版物</Link>
          </nav>
        </div>
        <figure className={styles.portrait}>
          <div className={styles.portraitFrame}><img src={authorPortrait} alt="吴飞飞" width="280" height="330" fetchPriority="high" /></div>
          <figcaption><span>生活在杭州</span><span>从 2012 年开始记录</span></figcaption>
        </figure>
      </div>
    </section>
  );
}

function ReadingSection(): ReactNode {
  return (
    <section className={`${styles.container} ${styles.readingSection}`} aria-labelledby="start-reading">
      <div className={styles.sectionIntro}>
        <p className={styles.eyebrow}>精选阅读</p>
        <Heading as="h2" id="start-reading">从这三篇开始</Heading>
        <p>一段经历，一次组织实践，<br className={styles.desktopBreak} />以及对生活的选择。</p>
      </div>
      <div className={styles.readingPanel}>
        {featuredReading.map((item, index) => (
          <Link key={item.to} to={item.to} className={styles.featuredItem}>
            <div className={styles.articleMeta}><span>{String(index + 1).padStart(2, '0')}</span><span>{item.category}</span></div>
            <div className={styles.articleCopy}><h3>{item.title}</h3><p>{item.description}</p></div>
            <span className={styles.articleArrow}><Arrow diagonal /></span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function AnnualReviewsSection({reviews}: {reviews: HomeAnnualReview[]}): ReactNode {
  if (!reviews.length) return null;
  return (
    <section className={`${styles.container} ${styles.annualSection}`} aria-labelledby="annual-reviews">
      <div className={styles.sectionHeader}>
        <div><p className={styles.eyebrow}>年度总结</p><Heading as="h2" id="annual-reviews">这些年的变化</Heading></div>
        <p>回看工作、家庭与生活里发生的变化。</p>
      </div>
      <div className={styles.annualList}>
        {reviews.map((item) => (
          <Link key={item.to} to={item.to} className={styles.reviewCard} aria-label={`${item.year} 年度总结：${item.title}`}>
            <span className={styles.reviewYear}>{item.year}</span>
            <div className={styles.reviewTitle}><h3>{item.title}</h3><Arrow diagonal /></div>
            <span className={styles.reviewLabel}>阅读这一年</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function ActivitySection({updates}: {updates: HomeRecord[]}): ReactNode {
  const referenceYear = updates[0]?.date.slice(0, 4);
  return (
    <section className={`${styles.container} ${styles.activitySection}`} aria-label="公开实践与近期修订">
      <div aria-labelledby="public-work">
        <div className={styles.smallHeading}><p className={styles.eyebrow}>实践与分享</p><Heading as="h2" id="public-work">做过的事</Heading></div>
        <div className={styles.workList}>
          <Link to="/gsil"><div><h3>GSIL</h3><p>GitHub 敏感信息泄漏监控</p></div><Arrow diagonal /></Link>
          <Link to="/cobra"><div><h3>Cobra</h3><p>企业级代码安全实践</p></div><Arrow diagonal /></Link>
          <Link to="/digital-bank-cybersecurity-system-construction"><div><h3>《数字银行安全体系构建》</h3><p>参与编写的安全建设专著</p></div><Arrow diagonal /></Link>
        </div>
        <div className={styles.workDetails}><Link to="/speech">公开演讲 <Arrow /></Link><Link to="/publications">出版物与白皮书 <Arrow /></Link></div>
      </div>
      {updates.length > 0 && <div aria-labelledby="recent-heading">
        <div className={styles.smallHeading}><p className={styles.eyebrow}>持续修订</p><Heading as="h2" id="recent-heading">最近，在写什么</Heading></div>
        <div className={styles.updateList}>
          {updates.map((item) => (
            <Link key={item.to} to={item.to} className={styles.recentItem}>
              <time dateTime={item.date}>{formatHomeDate(item.date, referenceYear)}</time><span>{item.title}</span><Arrow diagonal />
            </Link>
          ))}
        </div>
        <Link to="/security-engineering" className={styles.allResearch}>进入网络安全专题 <Arrow /></Link>
      </div>}
    </section>
  );
}

function StayInTouch(): ReactNode {
  return (
    <section className={`${styles.container} ${styles.contactSection}`} aria-labelledby="stay-in-touch">
      <div className={styles.contactInner}>
        <div><p className={styles.eyebrow}>保持联系</p><h2 id="stay-in-touch">有空，再来坐坐。</h2><p className={styles.subscription}>安全研究、人生实践与日常记录，不固定更新。<br />RSS 只推送新文章，正文修订不重复推送。</p></div>
        <div className={styles.contactActions}><a href="/rss.xml">订阅新文章 · RSS <Arrow diagonal /></a><Link to="/contact">联系我 <Arrow diagonal /></Link></div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  const {annualReviews = [], updates = []} = usePluginData('home-records-plugin') as {annualReviews: HomeAnnualReview[]; updates: HomeRecord[]};
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
        <AnnualReviewsSection reviews={annualReviews} />
        <ActivitySection updates={updates} />
        <StayInTouch />
      </main>
    </Layout>
  );
}
