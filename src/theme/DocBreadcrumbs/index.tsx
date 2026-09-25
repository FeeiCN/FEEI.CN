import React, {useState, type ReactNode} from 'react';
import {ThemeClassNames} from '@docusaurus/theme-common';
import {findFirstSidebarItemLink, useDoc, useDocsSidebar, useSidebarBreadcrumbs} from '@docusaurus/plugin-content-docs/client';
import {useThemeConfig} from '@docusaurus/theme-common';
import {useHomePageRoute} from '@docusaurus/theme-common/internal';
import Link from '@docusaurus/Link';
import HomeBreadcrumbItem from '@theme/DocBreadcrumbs/Items/Home';
import DocBreadcrumbsStructuredData from '@theme/DocBreadcrumbs/StructuredData';
import DocActionsMenu from '@site/src/components/DocActionsMenu';
import styles from './styles.module.css';

type BreadcrumbItem = {
  type: 'category';
  label: string;
  href: string;
  linkUnlisted: false;
};

type NavbarEntry = {
  type?: string;
  label?: string;
  to?: string;
  sidebarId?: string;
  items?: NavbarEntry[];
};

const contextBreadcrumb = (label: string, href: string): BreadcrumbItem => ({
  type: 'category',
  label,
  href,
  linkUnlisted: false,
});

function getNavigationBreadcrumbs(sidebar: ReturnType<typeof useDocsSidebar>, navbarItems: NavbarEntry[]): BreadcrumbItem[] {
  if (!sidebar) return [];

  const group = navbarItems.find((item) => (
    item.type === 'dropdown' && item.items?.some((child) => child.type === 'docSidebar' && child.sidebarId === sidebar.name)
  ));
  const section = group?.items?.find((item) => item.type === 'docSidebar' && item.sidebarId === sidebar.name);
  const firstSidebarItem = sidebar.items[0];
  const sectionHref = section?.to ?? (firstSidebarItem ? findFirstSidebarItemLink(firstSidebarItem) : undefined);
  const context: BreadcrumbItem[] = [];

  if (group?.label && group.to) context.push(contextBreadcrumb(group.label, group.to));
  if (section?.label && sectionHref) context.push(contextBreadcrumb(section.label, sectionHref));
  return context;
}

export default function DocBreadcrumbs(): ReactNode {
  const breadcrumbs = useSidebarBreadcrumbs();
  const sidebar = useDocsSidebar();
  const themeConfig = useThemeConfig();
  const homePageRoute = useHomePageRoute();
  const {frontMatter} = useDoc();
  const [mobileExpanded, setMobileExpanded] = useState(false);
  if (!breadcrumbs) return null;

  // Keep the complete path in structured data; the H1 identifies the current page.
  const parents = breadcrumbs.slice(0, -1);
  const contextParents = getNavigationBreadcrumbs(sidebar, themeConfig.navbar.items as NavbarEntry[]);
  const visibleParents = [...contextParents, ...parents].filter((item, index, all) => (
    index === 0 || item.label !== all[index - 1].label
  ));
  const shouldCollapseMobile = visibleParents.length > 3;
  const compactMobileParents = shouldCollapseMobile
    ? [visibleParents[0], visibleParents[visibleParents.length - 1]]
    : visibleParents;
  const renderItems = (items: typeof visibleParents) => items.map((item, index) => {
    const href = item.type === 'category' && item.linkUnlisted ? undefined : item.href;
    return (
      <li className="breadcrumbs__item" key={`${item.label}-${index}`}>
        {href ? <Link className="breadcrumbs__link" to={href}>{item.label}</Link> : <span className="breadcrumbs__link">{item.label}</span>}
      </li>
    );
  });

  return (
    <>
      <DocBreadcrumbsStructuredData breadcrumbs={breadcrumbs} />
      <div className={styles.breadcrumbsRow}>
        {(parents.length > 0 || homePageRoute) && (
          <nav className={`${ThemeClassNames.docs.docBreadcrumbs} ${styles.breadcrumbsContainer} ${styles.desktopBreadcrumbs}`} aria-label="当前位置">
            <ul className="breadcrumbs">
              {homePageRoute && <HomeBreadcrumbItem />}
              {renderItems(visibleParents)}
            </ul>
          </nav>
        )}
        {(parents.length > 0 || homePageRoute) && (
          <nav className={`${ThemeClassNames.docs.docBreadcrumbs} ${styles.breadcrumbsContainer} ${styles.mobileBreadcrumbs}`} aria-label="当前位置">
            <ul className="breadcrumbs">
              {homePageRoute && <HomeBreadcrumbItem />}
              {mobileExpanded || !shouldCollapseMobile ? renderItems(mobileExpanded ? visibleParents : compactMobileParents) : (
                <>
                  {renderItems([compactMobileParents[0]])}
                  <li className="breadcrumbs__item">
                    <button
                      type="button"
                      className={styles.ellipsisButton}
                      aria-expanded={false}
                      aria-label="展开完整路径"
                      onClick={() => setMobileExpanded(true)}>
                      …
                    </button>
                  </li>
                  {renderItems([compactMobileParents[1]])}
                </>
              )}
              {shouldCollapseMobile && mobileExpanded && (
                <li className="breadcrumbs__item">
                  <button
                    type="button"
                    className={styles.ellipsisButton}
                    aria-expanded
                    aria-label="收起完整路径"
                    onClick={() => setMobileExpanded(false)}>
                    收起
                  </button>
                </li>
              )}
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
