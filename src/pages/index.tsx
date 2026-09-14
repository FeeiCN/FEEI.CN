import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import {useColorMode} from '@docusaurus/theme-common';
import Layout from '@theme/Layout';
import LetterGlitch from '@site/src/components/LetterGlitch';
import LightRays from '@site/src/components/LightRays';
import TextType from '@site/src/components/TextType';
import styles from './index.module.css';

const featured = [
  {
    title: '创造确定性人生',
    description: '把时间、精力和金钱投入长期目标，在复杂时代持续积累确定性。',
    to: '/life-certainty',
  },
  {
    title: '我原本是来看黄土高原的',
    description: '壶口黄河、六万多棵树，以及延安真正留在记忆里的颜色。',
    to: '/2026-09-13',
  },
  {
    title: '当时怎么看都不像能赢',
    description: '站在杨家岭和那些窑洞前，重新看延安最困难的那些年。',
    to: '/2026-09-12',
  },
];

const recent = [
  {date: '09.14', title: '三箱苹果', to: '/2026-09-14'},
  {date: '09.13', title: '我原本是来看黄土高原的', to: '/2026-09-13'},
  {date: '09.12', title: '当时怎么看都不像能赢', to: '/2026-09-12'},
  {date: '09.11', title: '如果人生只剩一年', to: '/2026-09-11'},
  {date: '09.10', title: '大家一起 Overload', to: '/2026-09-10'},
];

function HeroSection(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  const {colorMode} = useColorMode();
  const isDark = colorMode === 'dark';

  const glitchColors = isDark
    ? ['#1a0800', '#ff5b1f', '#7a2e0a']
    : ['#2b4539', '#61dca3', '#61b3dc'];

  return (
    <section className={styles.hero}>
      <LetterGlitch
        glitchColors={glitchColors}
        centerVignette
        style={{position: 'absolute', inset: 0, zIndex: 0, backgroundColor: '#000'}}
      />
      <LightRays
        raysOrigin="top-center"
        raysColor="#ffffff"
        raysSpeed={0.8}
        lightSpread={0.6}
        rayLength={1.5}
        followMouse
        mouseInfluence={0.08}
        style={{position: 'absolute', inset: 0, zIndex: 1}}
      />
      <div className={styles.heroContent}>
        <p className={styles.heroLabel}>FEEI · Personal Wiki</p>
        <h1 className={styles.heroTitle}>
          <TextType
            text={['创造确定性人生', '健康幸福', '事业有成', '财务自由', '人生丰富']}
            typingSpeed={75}
            pauseDuration={1500}
            showCursor
            cursorCharacter="_"
            deletingSpeed={50}
            variableSpeedEnabled={false}
            variableSpeedMin={60}
            variableSpeedMax={120}
            cursorBlinkDuration={0.5}
          />
        </h1>
        <p className={styles.heroTagline}>{siteConfig.tagline}</p>
        <Link to="/life-certainty" className={styles.heroCta}>
          <span>开启确定性人生</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={styles.heroCtaArrow}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
        </Link>
      </div>
    </section>
  );
}

function ContentSection(): ReactNode {
  return (
    <section className={styles.content}>
      <div className={styles.contentInner}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionEyebrow}>SELECTED</span>
          <h2>精选</h2>
        </div>
        <div className={styles.featuredList}>
          {featured.map((item) => (
            <Link key={item.to} to={item.to} className={styles.featuredItem}>
              <div>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
              </div>
              <span className={styles.itemArrow} aria-hidden="true">↗</span>
            </Link>
          ))}
        </div>

        <div className={`${styles.sectionHeader} ${styles.recentHeader}`}>
          <span className={styles.sectionEyebrow}>RECENT</span>
          <h2>最近更新</h2>
        </div>
        <div className={styles.recentList}>
          {recent.map((item) => (
            <Link key={item.to} to={item.to} className={styles.recentItem}>
              <time>{item.date}</time>
              <span>{item.title}</span>
            </Link>
          ))}
        </div>
        <Link to="/2026" className={styles.allRecords}>查看 2026 年度记录 →</Link>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout title={siteConfig.title} description={siteConfig.tagline}>
      <main>
        <HeroSection />
        <ContentSection />
      </main>
    </Layout>
  );
}
