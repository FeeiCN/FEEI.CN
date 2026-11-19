import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Head from '@docusaurus/Head';
import Layout from '@theme/Layout';
import {Menu, Portal} from '@chakra-ui/react';
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

function ReadingMenu(): ReactNode {
  return (
    <Menu.Root
      positioning={{placement: 'top-start', strategy: 'fixed', gutter: 10, slide: true, overflowPadding: 12}}
      lazyMount={false}
      unmountOnExit={false}
    >
      <Menu.Trigger className={styles.primaryAction}>
        精选阅读 <span aria-hidden="true">↓</span>
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content className={styles.menuContent} aria-label="三篇精选阅读">
            {featuredReading.map((item) => (
              <Menu.Item key={item.to} value={item.id} asChild>
                <Link to={item.to} className={styles.readingItem}>
                  <span className={styles.menuTitle}>
                    {item.title}
                    <Arrow />
                  </span>
                  <span className={styles.menuDescription}>{item.description}</span>
                </Link>
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
}

function AnnualMenu({reviews}: {reviews: HomeAnnualReview[]}): ReactNode {
  if (!reviews.length) return null;
  return (
    <Menu.Root
      positioning={{placement: 'top', strategy: 'fixed', gutter: 10, slide: true, overflowPadding: 12}}
      lazyMount={false}
      unmountOnExit={false}
    >
      <Menu.Trigger className={styles.secondaryAction}>
        年度总结 <span aria-hidden="true">↓</span>
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content className={`${styles.menuContent} ${styles.annualMenu}`} aria-label="近三年年度总结">
            {reviews.map((item) => (
              <Menu.Item key={item.to} value={item.year} asChild>
                <Link to={item.to} className={styles.annualItem} data-year={item.year}>
                  <span>{item.year}</span>
                  <span>{item.title}</span>
                  <Arrow />
                </Link>
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
}

function HomeFooter(): ReactNode {
  const {footer} = useThemeConfig();
  return (
    <footer className={`${styles.container} ${styles.homeFooter}`}>
      <div className={styles.footerLinks}>
        <span className={styles.location}>
          杭州 <span className={styles.editionSlash}>/</span> 从 2012 年开始记录
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
            <h1 id="home-title" data-home-reveal>
              Feei<span>吴飞飞</span>
            </h1>
            <p className={styles.heroLead} data-home-reveal data-reveal-delay="100">
              探索安全与 AI，
              <br />
              在实践中持续进化。
            </p>
            <p className={styles.heroDescription} data-home-reveal data-reveal-delay="160">
              探索 → 实践 → 记录 → 再探索
            </p>
            <nav className={styles.heroActions} aria-label="首页阅读入口" data-home-reveal data-reveal-delay="220">
              <ReadingMenu />
              <AnnualMenu reviews={annualReviews} />
              <Link to="/about" className={styles.aboutLink}>
                认识我 <Arrow />
              </Link>
            </nav>
          </div>
          <HomeFooter />
        </section>
      </HomeMotionRoot>
    </Layout>
  );
}
