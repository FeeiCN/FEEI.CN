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
import SidebarIcon from '@site/src/components/SidebarIcon';
import type {Props} from '@theme/DocItem/Layout';
import styles from './styles.module.css';

export default function DocItemLayout({children}: Props): ReactNode {
  const {metadata, frontMatter, toc} = useDoc();
  const hasTOC = !frontMatter.hide_table_of_contents && toc.length > 0;
  const [tocCollapsed, setTocCollapsed] = useState(false);

  return (
    <div className={clsx(styles.layout, tocCollapsed && styles.tocCollapsed)}>
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
      <aside className={styles.desktopTOC} aria-label={hasTOC ? '文章目录' : '阅读侧栏'}>
        <div className={styles.tocContent} data-doc-toc-scroll>{hasTOC && <DocItemTOCDesktop />}</div>
        <button
          type="button"
          className={`docRailToggle ${styles.tocCollapseButton}`}
          aria-expanded={!tocCollapsed}
          aria-label={tocCollapsed ? '展开目录' : '收起目录'}
          title={tocCollapsed ? '展开目录' : '收起目录'}
          onClick={() => setTocCollapsed((collapsed) => !collapsed)}>
          <SidebarIcon icon="arrow-big-left-dash-icon" disableHover />
        </button>
      </aside>
    </div>
  );
}
