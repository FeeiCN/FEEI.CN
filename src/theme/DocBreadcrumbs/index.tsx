import React, {type ReactNode} from 'react';
import {ThemeClassNames} from '@docusaurus/theme-common';
import {useDoc, useSidebarBreadcrumbs} from '@docusaurus/plugin-content-docs/client';
import {useHomePageRoute} from '@docusaurus/theme-common/internal';
import Link from '@docusaurus/Link';
import HomeBreadcrumbItem from '@theme/DocBreadcrumbs/Items/Home';
import DocBreadcrumbsStructuredData from '@theme/DocBreadcrumbs/StructuredData';
import DocActionsMenu from '@site/src/components/DocActionsMenu';
import styles from './styles.module.css';

export default function DocBreadcrumbs(): ReactNode {
  const breadcrumbs = useSidebarBreadcrumbs();
  const homePageRoute = useHomePageRoute();
  const {frontMatter, metadata} = useDoc();
  if (!breadcrumbs) return null;

  // Keep the complete path in structured data; the H1 identifies the current page.
  const parents = breadcrumbs.slice(0, -1);
  const isAiSecurityDoc = metadata.source.includes('/01-网络安全/02-人工智能安全/');
  const visibleParents = isAiSecurityDoc
    ? [
        {type: 'category' as const, label: '网络安全', href: '/security-engineering', linkUnlisted: false},
        {type: 'category' as const, label: '人工智能安全', href: '/ai-security', linkUnlisted: false},
        ...parents,
      ]
    : parents;
  return (
    <>
      <DocBreadcrumbsStructuredData breadcrumbs={breadcrumbs} />
      <div className={styles.breadcrumbsRow}>
        {(parents.length > 0 || homePageRoute) && (
          <nav className={`${ThemeClassNames.docs.docBreadcrumbs} ${styles.breadcrumbsContainer}`} aria-label="当前位置">
            <ul className="breadcrumbs">
              {homePageRoute && <HomeBreadcrumbItem />}
              {visibleParents.map((item, index) => {
                const href = item.type === 'category' && item.linkUnlisted ? undefined : item.href;
                return (
                  <li className="breadcrumbs__item" key={`${item.label}-${index}`}>
                    {href ? <Link className="breadcrumbs__link" to={href}>{item.label}</Link> : <span className="breadcrumbs__link">{item.label}</span>}
                  </li>
                );
              })}
            </ul>
          </nav>
        )}
        {!frontMatter.hide_title && (
          <div className={styles.actions} aria-label="文章操作">
            <DocActionsMenu />
          </div>
        )}
      </div>
    </>
  );
}
