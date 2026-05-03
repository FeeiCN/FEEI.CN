import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import HomepageFeatures from '@site/src/components/HomepageFeatures';
import styles from './index.module.css';

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout title={siteConfig.title} description={siteConfig.tagline}>
      <main>
        <section className={styles.hero}>
          <div className={styles.heroContent}>
            <p className={styles.heroLabel}>FEEI · Personal Wiki</p>
            <h1 className={styles.heroTitle}>{siteConfig.title}</h1>
            <p className={styles.heroTagline}>{siteConfig.tagline}</p>
            <Link to="/docs/intro" className={styles.heroCta}>
              <span>开始阅读</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={styles.heroCtaArrow}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </Link>
          </div>
        </section>
        <HomepageFeatures />
      </main>
    </Layout>
  );
}
