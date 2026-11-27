import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Head from '@docusaurus/Head';
import Layout from '@theme/Layout';
import {Tabs} from '@chakra-ui/react';
import {useThemeConfig} from '@docusaurus/theme-common';
import {usePluginData} from '@docusaurus/useGlobalData';
import type {HomeAnnualReview} from '../../plugins/homeRecordsPlugin';
import {featuredReading, shareImageForPath} from '../data/featuredReading';
import {HomeMotionRoot} from '../components/HomeEffects';
import {ParticleScene} from '../components/HomeEffects/ParticleScene';
import styles from './index.module.css';

function Arrow(): ReactNode {
  return <span aria-hidden="true">↗</span>;
}

function HomeReading({reviews}: {reviews: HomeAnnualReview[]}): ReactNode {
  return (
    <Tabs.Root defaultValue="intro" className={styles.homeTabs} lazyMount={false} unmountOnExit={false}>
      <div className={styles.heroActions}>
        <Tabs.List className={styles.tabList} aria-label="首页内容">
          <Tabs.Trigger value="intro" className={styles.tabTrigger}>
            概览
          </Tabs.Trigger>
          <Tabs.Trigger value="reading" className={styles.tabTrigger}>
            精选阅读
          </Tabs.Trigger>
          <Tabs.Trigger value="annual" className={styles.tabTrigger}>
            年度总结
          </Tabs.Trigger>
        </Tabs.List>
      </div>
      <Tabs.Content value="intro" className={styles.introPanel}>
        <p className={styles.heroLead}>
          <span>从漏洞研究到企业安全建设，</span>
          <span>记录安全与 AI 的实践和判断。</span>
        </p>
        <p className={styles.heroDescription}>记住生活，改善选择，积累认识。</p>
      </Tabs.Content>
      <Tabs.Content value="reading" className={styles.readingPanel} aria-label="三篇精选阅读">
        {featuredReading.map((item, index) => (
          <Link key={item.to} to={item.to} className={styles.readingItem}>
            <span className={styles.itemIndex}>{String(index + 1).padStart(2, '0')}</span>
            <div>
              <span className={styles.itemTitle}>{item.title}</span>
              <p>{item.description}</p>
            </div>
            <Arrow />
          </Link>
        ))}
      </Tabs.Content>
      <Tabs.Content value="annual" className={styles.annualPanel} aria-label="近三年年度总结">
        <p className={styles.annualIntro}>回看工作、家庭与生活里的变化。</p>
        {reviews.map((item) => (
          <Link key={item.to} to={item.to} className={styles.annualItem} data-year={item.year}>
            <span>{item.year}</span>
            <span>{item.title}</span>
            <Arrow />
          </Link>
        ))}
      </Tabs.Content>
    </Tabs.Root>
  );
}

function HomeFooter(): ReactNode {
  const {footer} = useThemeConfig();
  return (
    <footer className={`${styles.container} ${styles.homeFooter}`}>
      <div className={styles.footerLinks}>
        <span className={styles.location}>
          <span>杭州</span>
          <span className={styles.editionSlash} aria-hidden="true">
            /
          </span>
          <span>从 2012 年开始记录</span>
        </span>
        <nav aria-label="联系与订阅">
          <Link to="/contact">
            联系 <Arrow />
          </Link>
          <a href="/rss.xml" title="不固定更新；RSS 只推送新文章，正文修订不重复推送">
            RSS <Arrow />
          </a>
        </nav>
      </div>
      {footer?.copyright && <div className={styles.legal} dangerouslySetInnerHTML={{__html: footer.copyright}} />}
    </footer>
  );
}

export default function Home(): ReactNode {
  const {annualReviews = []} = usePluginData('home-records-plugin') as {annualReviews: HomeAnnualReview[]};
  return (
    <Layout
      noFooter
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
        <section className={styles.hero} aria-labelledby="home-title">
          <div className={styles.particleStage}>
            <ParticleScene />
          </div>
          <div className={`${styles.container} ${styles.heroContent}`}>
            <div className={styles.identity} data-home-reveal>
              <h1 id="home-title">
                Feei<span>吴飞飞</span>
              </h1>
              <Link to="/about" className={styles.aboutLink}>
                认识我 <Arrow />
              </Link>
            </div>
            <HomeReading reviews={annualReviews} />
          </div>
          <HomeFooter />
        </section>
      </HomeMotionRoot>
    </Layout>
  );
}
