import React, {type ReactNode, useState} from 'react';
import clsx from 'clsx';
import {useDoc} from '@docusaurus/plugin-content-docs/client';
import DocItemPaginator from '@theme/DocItem/Paginator';
import DocVersionBanner from '@theme/DocVersionBanner';
import DocVersionBadge from '@theme/DocVersionBadge';
import DocItemFooter from '@theme/DocItem/Footer';
import DocItemTOCMobile from '@theme/DocItem/TOC/Mobile';
import DocItemTOCDesktop from '@theme/DocItem/TOC/Desktop';
import DocItemContent from '@theme/DocItem/Content';
import DocBreadcrumbs from '@theme/DocBreadcrumbs';
import ContentVisibility from '@theme/ContentVisibility';
import ArrowBigLeftDashIcon from '@site/src/components/ItsHoverIcon/icons/arrow-big-left-dash-icon';
import type {Props} from '@theme/DocItem/Layout';
import styles from './styles.module.css';

export default function DocItemLayout({children}: Props): ReactNode {
  const {metadata, frontMatter, toc} = useDoc();
  const hasTOC = !frontMatter.hide_table_of_contents && toc.length > 0;
  const [tocCollapsed, setTocCollapsed] = useState(false);

  return (
    <div className={clsx(styles.layout, hasTOC && styles.withTOC, tocCollapsed && styles.tocCollapsed)}>
      <div className={styles.content}>
        <ContentVisibility metadata={metadata} />
        <DocVersionBanner />
        <article>
          <DocBreadcrumbs />
          <DocVersionBadge />
          {hasTOC && <div className={styles.mobileTOC}><DocItemTOCMobile /></div>}
          <DocItemContent>{children}</DocItemContent>
          <DocItemFooter />
        </article>
        <DocItemPaginator />
      </div>
      {hasTOC && (
        <aside className={styles.desktopTOC} aria-label="文章目录">
          <div className={styles.tocContent}><DocItemTOCDesktop /></div>
          <button
            type="button"
            className={styles.tocCollapseButton}
            aria-label={tocCollapsed ? '展开目录' : '收起目录'}
            title={tocCollapsed ? '展开目录' : '收起目录'}
            onClick={() => setTocCollapsed((collapsed) => !collapsed)}>
            <ArrowBigLeftDashIcon size={16} strokeWidth={1.8} />
          </button>
        </aside>
      )}
    </div>
  );
}
