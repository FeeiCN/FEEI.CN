import type {ReactNode} from 'react';
import {useDoc} from '@docusaurus/plugin-content-docs/client';
import DocPaginator from '@theme/DocPaginator';
import styles from './styles.module.css';

export default function DocItemPaginator(): ReactNode {
  const {metadata} = useDoc();

  return (
    <div className={styles.paginator}>
      <DocPaginator previous={metadata.previous} next={metadata.next} />
    </div>
  );
}
