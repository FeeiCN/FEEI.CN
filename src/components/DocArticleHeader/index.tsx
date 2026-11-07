import React, {type ReactNode} from 'react';
import StandardRelations from '@site/src/components/ComplianceKnowledge/StandardRelations';
import styles from './styles.module.css';

export default function DocArticleHeader({
  children,
  as: Element = 'header',
}: {
  children: ReactNode;
  as?: 'header' | 'div';
}): ReactNode {
  return (
    <>
      <Element className={styles.header}>{children}</Element>
      <StandardRelations />
    </>
  );
}
