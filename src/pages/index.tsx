import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import styles from './index.module.css';

const proofPoints = [
  {value: '10+ 年', label: '网络空间安全实践'},
  {value: '2012 至今', label: '持续公开写作'},
  {value: '4 个目标', label: '长期人生管理'},
];

const systems = [
  {
    type: '专业体系',
    title: '网络空间安全',
    description: '从攻击研究到企业安全体系建设，持续理解复杂系统中的威胁、边界、工程与治理。',
    links: [
      {title: '安全工程', description: '威胁、组织、体系与软件工程', to: '/security-engineering'},
      {title: '人工智能安全', description: '数据、模型、应用、Agent 与治理', to: '/ai-security'},
    ],
  },
  {
    type: '个人体系',
    title: '人生操作系统',
    description: '用目标、数据、记录、复盘、工具和 Agent，让真正重要的事情能够长期运转。',
    links: [
      {title: '健康幸福', description: '身体、心理、关系与生命质量', to: '/health'},
      {title: '事业有成', description: '能力、结果、协作与长期事业', to: '/capability'},
      {title: '财务自由', description: '收入、支出、投资与风险保障', to: '/wealth'},
      {title: '人生丰富', description: '阅读、影视、旅行与生活体验', to: '/experience'},
    ],
  },
];

const featured = [
  {
    category: '核心方法',
    title: '人生操作系统',
    description: '我如何把目标、数据、日记、复盘、工具和 AI Agent 连成一套持续变化的个人系统。',
    to: '/life-os',
  },
  {
    category: '职业经历',
    title: '我的网络安全之路',
    description: '从旧电脑、外挂、WooYun 到企业安全体系建设，我如何从攻击视角走向风险治理。',
    to: '/my-journey-in-cybersecurity',
  },
  {
    category: '长期主义',
    title: '创造确定性人生',
    description: '把时间、精力和金钱投入长期目标，在复杂时代持续积累确定性。',
    to: '/life-certainty',
  },
  {
    category: '人生体验',
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
        <div className={styles.heroCopy}>
          <p className={styles.heroKicker}>吴飞飞 · FEEI.CN</p>
          <h1>
            在复杂系统里，
            <span>创造长期确定性。</span>
          </h1>
          <p className={styles.heroIntro}>
            我是吴飞飞，十余年从攻击研究走向企业安全体系建设，参与内容电商、数字银行与支付平台的安全实践；也持续用一套人生操作系统管理健康、事业、财富与体验。这里分享专业方法、真实实践与长期记录。
          </p>
          <div className={styles.heroActions}>
            <Link to="/security-engineering" className={styles.primaryAction}>进入网络空间安全</Link>
            <Link to="/life-os" className={styles.secondaryAction}>
              查看人生操作系统 <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
        <div className={styles.proofGrid} aria-label="经历概览">
          {proofPoints.map((item) => (
            <div className={styles.proofItem} key={item.value}>
              <strong>{item.value}</strong>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SystemsSection(): ReactNode {
  return (
    <section className={styles.section}>
      <div className={styles.inner}>
        <div className={styles.sectionLead}>
          <div className={styles.sectionHeader}>
            <span className={styles.eyebrow}>TWO SYSTEMS</span>
            <h2>两套长期系统</h2>
          </div>
          <p>一套面向复杂技术系统，一套面向自己的长期人生。它们共同关注边界、反馈、演化与确定性。</p>
        </div>
        <div className={styles.systemGrid}>
          {systems.map((system) => (
            <article key={system.title} className={styles.systemItem}>
              <span className={styles.systemType}>{system.type}</span>
              <h3>{system.title}</h3>
              <p>{system.description}</p>
              <div className={styles.systemLinks}>
                {system.links.map((item) => (
                  <Link key={item.to} to={item.to} className={styles.systemLink}>
                    <strong>{item.title}</strong>
                    <span>{item.description}</span>
                    <span className={styles.systemArrow} aria-hidden="true">→</span>
                  </Link>
                ))}
              </div>
            </article>
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
        <div className={styles.sectionLead}>
          <div className={styles.sectionHeader}>
            <span className={styles.eyebrow}>START HERE</span>
            <h2>值得先读</h2>
          </div>
          <p>四篇文章，分别对应我的方法、经历、长期判断与生活现场。</p>
        </div>
        <div className={styles.featuredList}>
          {featured.map((item) => (
            <Link key={item.to} to={item.to} className={styles.featuredItem}>
              <span className={styles.featuredCategory}>{item.category}</span>
              <div className={styles.featuredCopy}>
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
        <div className={styles.sectionLead}>
          <div className={styles.sectionHeader}>
            <span className={styles.eyebrow}>RECENT</span>
            <h2>最近记录</h2>
          </div>
          <p>长期思考之外，也保留当下具体而微小的生活。</p>
        </div>
        <div className={styles.recentList}>
          {recent.map((item) => (
            <Link key={item.to} to={item.to} className={styles.recentItem}>
              <time dateTime={`2026-${item.date.replace('.', '-')}`}>{item.date}</time>
              <span>{item.title}</span>
              <span className={styles.recentArrow} aria-hidden="true">→</span>
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
      description="吴飞飞关于网络空间安全、人生操作系统与真实生活的长期公开记录，以及在复杂系统里创造长期确定性的实践。">
      <main className={styles.page}>
        <HeroSection />
        <SystemsSection />
        <ReadingSection />
        <RecentSection />
      </main>
    </Layout>
  );
}
