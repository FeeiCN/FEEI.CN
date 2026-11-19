import type {CSSProperties, ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Head from '@docusaurus/Head';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import {usePluginData} from '@docusaurus/useGlobalData';
import type {HomeAnnualReview, HomeRecord} from '../../plugins/homeRecordsPlugin';
import {authorPortrait, featuredReading, shareImageForPath} from '../data/featuredReading';
import {HomeMotionRoot, MotionToggle, ScrollChapter} from '../components/HomeEffects';
import {ChapterArtwork} from '../components/HomeEffects/Artwork';
import {ParticleScene} from '../components/HomeEffects/ParticleScene';
import styles from './index.module.css';

function formatHomeDate(date: string, referenceYear?: string): string {
  return referenceYear && date.startsWith(`${referenceYear}-`)
    ? date.slice(5).replace('-', '.')
    : date.replaceAll('-', '.');
}

function Arrow({diagonal = false}: {diagonal?: boolean}): ReactNode {
  return <span aria-hidden="true">{diagonal ? '↗' : '→'}</span>;
}

function HeroSection(): ReactNode {
  return (
    <section className={styles.hero} aria-labelledby="home-title">
      <div className={`${styles.container} ${styles.editionLine}`}>
        <span>
          FEEI.CN <span className={styles.editionSlash}>/</span> 个人记录
        </span>
        <span>网络安全 · 人工智能 · 生活</span>
      </div>
      <div className={styles.particleStage}>
        <ParticleScene />
      </div>
      <div className={`${styles.container} ${styles.heroGrid}`}>
        <div className={styles.heroCopy}>
          <div className={styles.authorLine} data-home-reveal>
            <img src={authorPortrait} alt="" width="48" height="48" fetchPriority="high" />
            <p className={styles.eyebrow}>你好，我是</p>
          </div>
          <h1 id="home-title" data-home-reveal>
            吴飞飞<span>Feei</span>
          </h1>
        </div>
        <div className={styles.heroNarrative} data-home-reveal data-reveal-delay="180">
          <p className={styles.heroLead}>
            从安全出发，
            <br />
            记录一路的变化。
          </p>
          <p className={styles.heroDescription}>
            从漏洞研究走向企业安全建设。
            <br />
            把做过的事、走过的弯路，和后来修正的判断写下来。
          </p>
        </div>
        <div className={styles.heroActions} data-home-reveal data-reveal-delay="240">
          <a href="#start-reading" className={styles.primaryAction}>
            翻开三篇精选 <span aria-hidden="true">↓</span>
          </a>
          <Link to="/about" className={styles.secondaryAction}>
            认识我 <Arrow diagonal />
          </Link>
        </div>
      </div>
      <div className={`${styles.container} ${styles.heroFoot}`}>
        <span>
          生活在杭州 <span className={styles.editionSlash}>/</span> 从 2012 年开始记录
        </span>
        <MotionToggle />
        <a href="#start-reading" className={styles.scrollHint}>
          继续翻阅 <span aria-hidden="true">↓</span>
        </a>
      </div>
    </section>
  );
}

const chapterKinds = ['security', 'organization', 'life'] as const;
const chapterNotes = [
  '从发现问题，到建设系统。',
  '一个人更快之后，一群人如何走得更远。',
  '把有限的投入，留给真正重要的事。',
];

function ReadingSection(): ReactNode {
  return (
    <section className={`${styles.container} ${styles.readingSection}`} aria-labelledby="start-reading">
      <div className={styles.sectionHeader} data-home-reveal>
        <div>
          <p className={styles.eyebrow}>SELECTED WRITING / 精选阅读</p>
          <Heading as="h2" id="start-reading">
            三篇，认识我。
          </Heading>
        </div>
        <p>
          一段经历，一次组织实践，
          <br />
          以及对生活的选择。
        </p>
      </div>
      <div className={styles.chapters}>
        {featuredReading.map((item, index) => (
          <ScrollChapter key={item.to} className={`${styles.chapter} ${styles[`${chapterKinds[index]}Chapter`]}`}>
            <Link to={item.to} className={styles.chapterLink} aria-label={`阅读：${item.title}`}>
              <div className={styles.chapterArt}>
                <div className={styles.artFrame}>
                  <ChapterArtwork kind={chapterKinds[index]} />
                </div>
                <div className={styles.artCaption}>
                  <span>{item.category}</span>
                  <span>FEEI / {String(index + 1).padStart(2, '0')}</span>
                </div>
              </div>
              <div className={styles.chapterCopy}>
                <div className={styles.chapterIndex}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <span>/ 03</span>
                </div>
                <p className={styles.chapterCategory}>{item.category}</p>
                <h3>{item.title}</h3>
                <p className={styles.chapterDescription}>{item.description}</p>
                <span className={styles.readArticle}>
                  阅读全文{' '}
                  <span className={styles.roundArrow}>
                    <Arrow diagonal />
                  </span>
                </span>
                <span className={styles.chapterNote}>{chapterNotes[index]}</span>
              </div>
            </Link>
          </ScrollChapter>
        ))}
      </div>
    </section>
  );
}

function AnnualReviewsSection({reviews}: {reviews: HomeAnnualReview[]}): ReactNode {
  if (!reviews.length) return null;
  return (
    <section className={`${styles.container} ${styles.annualSection}`} aria-labelledby="annual-reviews">
      <div className={styles.annualIntro}>
        <p className={styles.eyebrow}>THE ANNUALS / 年度总结</p>
        <Heading as="h2" id="annual-reviews">
          一年，
          <br />
          再一年。
        </Heading>
        <p>
          回看工作、家庭与生活里
          <br className={styles.desktopBreak} />
          发生的变化。
        </p>
        <nav className={styles.annualIndex} aria-label="近三年年度总结">
          {reviews.map((item) => (
            <Link key={item.to} to={item.to}>
              {item.year}
              <span>{item.title}</span>
              <Arrow diagonal />
            </Link>
          ))}
        </nav>
      </div>
      <div className={styles.annualStack}>
        {reviews.map((item, index) => (
          <Link
            key={item.to}
            to={item.to}
            className={styles.annualCover}
            data-year={item.year}
            style={{'--sheet-index': index} as CSSProperties}
            aria-label={`${item.year} 年度总结：${item.title}`}
          >
            <div className={styles.annualMasthead}>
              <span>FEEI / ANNUAL REVIEW</span>
              <span>{item.year} EDITION</span>
            </div>
            <span className={styles.reviewYear}>{item.year}</span>
            <div className={styles.annualMotif} aria-hidden="true">
              {Array.from({length: 8}, (_, line) => (
                <span key={line} style={{'--line': line} as CSSProperties} />
              ))}
            </div>
            <div className={styles.reviewTitle}>
              <div>
                <span>年度总结</span>
                <h3>{item.title}</h3>
              </div>
              <span className={styles.annualArrow}>
                <Arrow diagonal />
              </span>
            </div>
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
      <div aria-labelledby="public-work" data-home-reveal>
        <div className={styles.smallHeading}>
          <p className={styles.eyebrow}>WORK / 实践与分享</p>
          <Heading as="h2" id="public-work">
            做过的事
          </Heading>
        </div>
        <div className={styles.workList}>
          <Link to="/gsil">
            <div>
              <h3>GSIL</h3>
              <p>GitHub 敏感信息泄漏监控</p>
            </div>
            <Arrow diagonal />
          </Link>
          <Link to="/cobra">
            <div>
              <h3>Cobra</h3>
              <p>企业级代码安全实践</p>
            </div>
            <Arrow diagonal />
          </Link>
          <Link to="/digital-bank-cybersecurity-system-construction">
            <div>
              <h3>《数字银行安全体系构建》</h3>
              <p>参与编写的安全建设专著</p>
            </div>
            <Arrow diagonal />
          </Link>
        </div>
        <div className={styles.workDetails}>
          <Link to="/speech">
            公开演讲 <Arrow />
          </Link>
          <Link to="/publications">
            出版物与白皮书 <Arrow />
          </Link>
        </div>
      </div>
      {updates.length > 0 && (
        <div aria-labelledby="recent-heading" data-home-reveal data-reveal-delay="100">
          <div className={styles.smallHeading}>
            <p className={styles.eyebrow}>NOTES / 持续修订</p>
            <Heading as="h2" id="recent-heading">
              最近，在写什么
            </Heading>
          </div>
          <div className={styles.updateList}>
            {updates.map((item) => (
              <Link key={item.to} to={item.to} className={styles.recentItem}>
                <time dateTime={item.date}>{formatHomeDate(item.date, referenceYear)}</time>
                <span>{item.title}</span>
                <Arrow diagonal />
              </Link>
            ))}
          </div>
          <Link to="/security-engineering" className={styles.allResearch}>
            进入网络安全专题 <Arrow />
          </Link>
        </div>
      )}
    </section>
  );
}

function StayInTouch(): ReactNode {
  return (
    <section className={`${styles.container} ${styles.contactSection}`} aria-labelledby="stay-in-touch">
      <div className={styles.contactInner} data-home-reveal>
        <div>
          <p className={styles.eyebrow}>TO BE CONTINUED / 未完待续</p>
          <h2 id="stay-in-touch">有空，再来坐坐。</h2>
          <p className={styles.subscription}>
            安全研究、人生实践与日常记录，不固定更新。
            <br />
            RSS 只推送新文章，正文修订不重复推送。
          </p>
        </div>
        <div className={styles.contactActions}>
          <a href="/rss.xml">
            订阅新文章 · RSS <Arrow diagonal />
          </a>
          <Link to="/contact">
            联系我 <Arrow diagonal />
          </Link>
        </div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  const {annualReviews = [], updates = []} = usePluginData('home-records-plugin') as {
    annualReviews: HomeAnnualReview[];
    updates: HomeRecord[];
  };
  return (
    <Layout
      wrapperClassName={styles.homeLayout}
      description="吴飞飞（Feei）的个人网站。从漏洞研究走向企业安全建设，记录网络安全、人工智能安全的实践与判断，也留下杭州的日常生活。"
    >
      <Head>
        <title>吴飞飞 · 安全界</title>
        <meta property="og:title" content="吴飞飞 · 安全界" />
        <meta property="og:image" content={shareImageForPath('/')} />
        <meta property="og:image:alt" content="吴飞飞 · Feei：网络安全、人工智能安全与生活记录" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta name="twitter:image" content={shareImageForPath('/')} />
        <meta name="twitter:card" content="summary_large_image" />
      </Head>
      <HomeMotionRoot className={styles.page}>
        <HeroSection />
        <ReadingSection />
        <AnnualReviewsSection reviews={annualReviews} />
        <ActivitySection updates={updates} />
        <StayInTouch />
      </HomeMotionRoot>
    </Layout>
  );
}
