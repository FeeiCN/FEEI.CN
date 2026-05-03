import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import SidebarIcon from '@site/src/components/SidebarIcon';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  icon: string;
  description: string;
  to: string;
  num: string;
};

const FeatureList: FeatureItem[] = [
  {
    title: '健康',
    icon: 'heart',
    description: '习惯、疾病、饮食、保险、塑形、自我、关系、死亡',
    to: '/docs/健康/习惯',
    num: '01',
  },
  {
    title: '能力',
    icon: 'rocket',
    description: '网络空间安全、人工智能、软性能力',
    to: '/docs/能力/网络空间安全/',
    num: '02',
  },
  {
    title: '财富',
    icon: 'chart-line',
    description: '工作储蓄、控制支出、投资理财',
    to: '/docs/财富/让自己有更多的时间和选择权',
    num: '03',
  },
  {
    title: '体验',
    icon: 'compass',
    description: '探索世界，感受生活的多样性',
    to: '/docs/体验/introduction',
    num: '04',
  },
];

function Feature({title, icon, description, to, num}: FeatureItem) {
  return (
    <Link to={to} className={styles.featureCard}>
      <span className={styles.featureNum}>{num}</span>
      <div className={styles.featureIconWrap}>
        <SidebarIcon icon={icon} className={styles.featureIconSvg} />
      </div>
      <h3 className={styles.featureTitle}>{title}</h3>
      <p className={styles.featureDesc}>{description}</p>
      <span className={styles.featureArrow}>阅读 →</span>
    </Link>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className={styles.featureGrid}>
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
