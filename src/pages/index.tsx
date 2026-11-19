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
          <nav className={styles.proofLinks} aria-label="公开成果入口">
            <a href="#public-work">工具实践</a><Link to="/speech">公开演讲</Link><Link to="/publications">出版与白皮书</Link>
          </nav>
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
        {[
          {id: 'professional', title: '安全与经历', description: '先认识我，再看建设方法与 AI 安全。'},
          {id: 'life', title: '人生与生活', description: '工作之外，那些在意的人和普通的日子。'},
        ].map((group) => (
          <div className={styles.readingGroup} key={group.id}>
            <div className={styles.groupHeading}><h3>{group.title}</h3><p>{group.description}</p></div>
            <div className={`${styles.featuredList} ${group.id === 'life' ? styles.lifeList : ''}`}>
              {featuredReading.filter((item) => item.group === group.id).map((item) => (
                <Link key={item.to} to={'entry' in item ? item.entry : item.to} className={styles.featuredItem}>
                  <div className={styles.readingMeta}><span>{String(featuredReading.indexOf(item) + 1).padStart(2, '0')}</span><span>{item.category}</span><span aria-hidden="true">↗</span></div>
                  <h4>{item.title}</h4>
                  <p>{item.description}</p>
                </Link>
              ))}
            </div>
          </div>
        ))}
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
          <Link to="/gsil"><span className={styles.workType}>监测工具</span><strong>GSIL · GitHub 敏感信息泄漏监控</strong><span>让企业持续发现代码托管平台上的信息泄漏。</span><span aria-hidden="true">↗</span></Link>
          <Link to="/cobra"><span className={styles.workType}>代码审计</span><strong>Cobra · 企业级代码安全实践</strong><span>把漏洞研究落到代码审计和持续检查。</span><span aria-hidden="true">↗</span></Link>
          <Link to="/ai-personal-to-org-efficiency"><span className={styles.workType}>演讲材料</span><strong>从个人 AI 提效到组织 AI 提效</strong><span>工具如何进入团队的协作与交付。</span><span aria-hidden="true">↗</span></Link>
          <Link to="/digital-bank-cybersecurity-system-construction"><span className={styles.workType}>团队材料</span><strong>数字银行安全体系构建</strong><span>阅读数字银行安全建设的实践材料。</span><span aria-hidden="true">↗</span></Link>
        </div>
        <div className={styles.workDetails}>
          <Link to="/speech">全部演讲 →</Link><Link to="/publications">出版物与白皮书 →</Link>
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
