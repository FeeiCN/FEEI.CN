import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import Heading from '@theme/Heading';
import SidebarIcon from '@site/src/components/SidebarIcon';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  icon: string;
  description: string;
  to: string;
};

const FeatureList: FeatureItem[] = [
  {
    title: '健康',
    icon: 'heart',
    description: '习惯、疾病、饮食、保险、塑形、自我、关系、死亡',
    to: '/docs/健康/习惯',
  },
  {
    title: '能力',
    icon: 'rocket',
    description: '网络空间安全、人工智能、软性能力',
    to: '/docs/能力/网络空间安全/',
  },
  {
    title: '财富',
    icon: 'chart-line',
    description: '工作储蓄、控制支出、投资理财',
    to: '/docs/财富/让自己有更多的时间和选择权',
  },
  {
    title: '体验',
    icon: 'compass',
    description: '探索世界，感受生活的多样性',
    to: '/docs/体验/introduction',
  },
];

function Feature({title, icon, description, to}: FeatureItem) {
  return (
    <Link to={to} className={clsx('col col--3', styles.featureCard)}>
      <div className={styles.featureIcon}>
        <SidebarIcon icon={icon} className={styles.featureIconSvg} />
      </div>
      <Heading as="h3" className={styles.featureTitle}>{title}</Heading>
      <p className={styles.featureDesc}>{description}</p>
    </Link>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
