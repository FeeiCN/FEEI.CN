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
import DailyRecordSidebar from '@site/src/components/DailyRecordSidebar';
import type {Props} from '@theme/DocItem/Layout';
import styles from './styles.module.css';

export default function DocItemLayout({children}: Props): ReactNode {
  const {metadata, frontMatter, toc} = useDoc();
  const hasTOC = !frontMatter.hide_table_of_contents && toc.length > 0;
  const diaryDate = typeof frontMatter.slug === 'string' ? frontMatter.slug.match(/^\/(\d{4}-\d{2}-\d{2})\/?$/)?.[1] : undefined;
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
      <aside className={clsx(styles.desktopTOC, diaryDate && styles.diaryRail)} aria-label={diaryDate ? '日记回顾' : hasTOC ? '文章目录' : '阅读侧栏'}>
        <div className={styles.tocContent} data-doc-toc-scroll>
          {diaryDate && <DailyRecordSidebar key={diaryDate} date={diaryDate} />}
          {hasTOC && <DocItemTOCDesktop />}
        </div>
        <button
          type="button"
          className={`docRailToggle ${styles.tocCollapseButton}`}
          aria-expanded={!tocCollapsed}
          aria-label={tocCollapsed ? diaryDate ? '展开回顾' : '展开目录' : diaryDate ? '收起回顾' : '收起目录'}
          title={tocCollapsed ? diaryDate ? '展开回顾' : '展开目录' : diaryDate ? '收起回顾' : '收起目录'}
          onClick={() => setTocCollapsed((collapsed) => !collapsed)}>
          <SidebarIcon icon="arrow-big-left-dash-icon" disableHover />
        </button>
      </aside>
    </div>
  );
}
