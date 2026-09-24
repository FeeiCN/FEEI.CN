import React, {type ReactNode} from 'react';
import styles from './styles.module.css';

export default function DocArticleHeader({
  children,
  as: Element = 'header',
}: {
  children: ReactNode;
  as?: 'header' | 'div';
}): ReactNode {
  return (
    <Element className={styles.header}>
      {children}
    </Element>
  );
}
