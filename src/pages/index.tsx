import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import {useColorMode} from '@docusaurus/theme-common';
import Layout from '@theme/Layout';
import LetterGlitch from '@site/src/components/LetterGlitch';
import LightRays from '@site/src/components/LightRays';
import TextType from '@site/src/components/TextType';
import styles from './index.module.css';

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
        style={{ position: 'absolute', inset: 0, zIndex: 0, backgroundColor: '#000' }}
      />
      <LightRays
        raysOrigin="top-center"
        raysColor="#ffffff"
        raysSpeed={0.8}
        lightSpread={0.6}
        rayLength={1.5}
        followMouse
        mouseInfluence={0.08}
        style={{ position: 'absolute', inset: 0, zIndex: 1 }}
      />
      <div className={styles.heroContent}>
        <p className={styles.heroLabel}>FEEI · Personal Wiki</p>
        <h1 className={styles.heroTitle}>
          <TextType 
            text={["创造确定性人生", "健康幸福", "事业有成", "财务自由", "人生丰富"]}
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
        <Link to="/health/overview" className={styles.heroCta}>
          <span>开始阅读</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={styles.heroCtaArrow}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
          </svg>
        </Link>
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
      </main>
    </Layout>
  );
}
