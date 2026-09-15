import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import styles from './index.module.css';

const goals = [
  {title: '健康幸福', description: '保持身体和家庭处于长期可持续的状态。'},
  {title: '事业有成', description: '安全、AI，以及如何把复杂系统做得更可靠。'},
  {title: '财务自由', description: '储蓄、投资，以及获得选择的自由。'},
  {title: '人生丰富', description: '阅读、旅行、记录，认真体验这个世界。'},
];

const featured = [
  {
    title: '我的 Life OS',
    description: '我如何把目标、数据、日记、复盘、工具和 AI Agent 连成一套持续变化的个人系统。',
    to: '/life-os',
  },
  {
    title: '创造确定性人生',
    description: '把时间、精力和金钱投入长期目标，在复杂时代持续积累确定性。',
    to: '/life-certainty',
  },
  {
    title: '2025 年度总结：量变到质变',
    description: '关于健康、事业、财务和人生体验的一年，也是长期积累开始显现复利的一年。',
    to: '/annual-review-for-2025',
  },
  {
    title: '我原本是来看黄土高原的',
    description: '壶口黄河、六万多棵树，以及延安真正留在记忆里的颜色。',
    to: '/2026-09-13',
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
  return (
    <section className={styles.hero}>
      <div className={styles.heroInner}>
        <p className={styles.heroKicker}>吴飞飞 · FEEI</p>
        <h1>吴飞飞</h1>
        <p className={styles.heroIntro}>
          网络安全从业者，长期关注安全、AI 与个人成长。<br />
          十余年参与内容电商、互联网银行与支付平台的安全体系建设。
        </p>
        <p className={styles.heroStatement}>在复杂时代创造确定性。</p>
        <div className={styles.heroActions}>
          <Link to="/about" className={styles.primaryAction}>关于我</Link>
          <Link to="/life-os" className={styles.secondaryAction}>开始阅读 <span aria-hidden="true">→</span></Link>
        </div>
      </div>
    </section>
  );
}

function GoalsSection(): ReactNode {
  return (
    <section className={styles.section}>
      <div className={styles.inner}>
        <div className={styles.sectionHeader}>
          <span className={styles.eyebrow}>LONG TERM</span>
          <h2>长期目标</h2>
        </div>
        <div className={styles.goalGrid}>
          {goals.map((goal) => (
            <div className={styles.goalItem} key={goal.title}>
              <h3>{goal.title}</h3>
              <p>{goal.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ReadingSection(): ReactNode {
  return (
    <section className={styles.section}>
      <div className={styles.inner}>
        <div className={styles.sectionHeader}>
          <span className={styles.eyebrow}>START HERE</span>
          <h2>从这里开始</h2>
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
      </div>
    </section>
  );
}

function RecentSection(): ReactNode {
  return (
    <section className={`${styles.section} ${styles.recentSection}`}>
      <div className={styles.inner}>
        <div className={styles.sectionHeader}>
          <span className={styles.eyebrow}>RECENT</span>
          <h2>最近</h2>
        </div>
        <div className={styles.recentList}>
          {recent.map((item) => (
            <Link key={item.to} to={item.to} className={styles.recentItem}>
              <time>{item.date}</time>
              <span>{item.title}</span>
            </Link>
          ))}
        </div>
        <Link to="/2026" className={styles.allRecords}>查看全部记录 →</Link>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  return (
    <Layout
      title="吴飞飞"
      description="吴飞飞的长期公开记录：网络安全、AI、个人成长，以及在复杂时代创造确定性的实践。">
      <main className={styles.page}>
        <HeroSection />
        <GoalsSection />
        <ReadingSection />
        <RecentSection />
      </main>
    </Layout>
  );
}
