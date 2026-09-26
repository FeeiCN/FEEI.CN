import React, {useEffect, useRef, useState, type ReactNode} from 'react';
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
  docId?: string;
  id?: string;
  label?: string;
  to?: string;
  href?: string;
  sidebarId?: string;
  items?: NavbarEntry[];
};

const contextBreadcrumb = (label: string, href: string): BreadcrumbItem => ({
  type: 'category',
  label,
  href,
  linkUnlisted: false,
});

function getNavigationBreadcrumbs(
  sidebar: ReturnType<typeof useDocsSidebar>,
  navbarItems: NavbarEntry[],
  docId: string,
  permalink: string,
): BreadcrumbItem[] {
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

  // A navbar entry may link directly to the first document of a sidebar instead
  // of exposing that sidebar as a dropdown. In that case Docusaurus has no
  // sidebar parent to use for breadcrumbs, so retain the direct entry as the
  // navigation context (for example, “人生丰富” → “人生厚度”).
  if (!section) {
    const navbarEntry = navbarItems
      .flatMap((item) => item.items ?? [])
      .find((item) => (
        (item.type === 'doc' || item.type === 'link') &&
        ((item.docId ?? item.id) === docId || (item.to ?? item.href) === permalink) &&
        item.label &&
        (item.to ?? item.href)
      ));
    const sidebarRoot = firstSidebarItem as {type?: string; docId?: string; href?: string; label?: string};
    const directEntry = navbarEntry ?? (
      sidebarRoot.type === 'link' && sidebarRoot.docId === docId ? {
        label: sidebarRoot.label,
        href: sidebarRoot.href,
      } : undefined
    );
    const directHref = directEntry?.to ?? directEntry?.href;
    if (directEntry?.label && directHref) context.push(contextBreadcrumb(directEntry.label, directHref));
  }
  return context;
}

export default function DocBreadcrumbs(): ReactNode {
  const breadcrumbs = useSidebarBreadcrumbs();
  const sidebar = useDocsSidebar();
  const themeConfig = useThemeConfig();
  const homePageRoute = useHomePageRoute();
  const {frontMatter, metadata} = useDoc();
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const [mobileTailCount, setMobileTailCount] = useState(1);
  const mobileNavRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLUListElement>(null);

  // Keep the complete path in structured data; the H1 identifies the current page.
  const parents = breadcrumbs?.slice(0, -1) ?? [];
  const contextParents = getNavigationBreadcrumbs(
    sidebar,
    themeConfig.navbar.items as NavbarEntry[],
    metadata.id,
    metadata.permalink,
  );
  const visibleParents = [...contextParents, ...parents].filter((item, index, all) => (
    index === 0 || item.label !== all[index - 1].label
  ));
  const maxTailCount = Math.max(0, visibleParents.length - 1);
  const compactMobileParents = mobileTailCount >= maxTailCount
    ? visibleParents
    : [visibleParents[0], ...visibleParents.slice(-mobileTailCount)];
  const shouldCollapseMobile = compactMobileParents.length < visibleParents.length;

  const renderItems = (items: typeof visibleParents, measure = false) => items.map((item, index) => {
    const href = item.type === 'category' && item.linkUnlisted ? undefined : item.href;
    return (
      <li
        className="breadcrumbs__item"
        data-breadcrumb-measure={measure ? 'parent' : undefined}
        key={`${item.label}-${index}`}>
        {href ? <Link className="breadcrumbs__link" to={href}>{item.label}</Link> : <span className="breadcrumbs__link">{item.label}</span>}
      </li>
    );
  });

  useEffect(() => {
    const nav = mobileNavRef.current;
    const measure = measureRef.current;
    if (!nav || !measure || visibleParents.length <= 1 || typeof ResizeObserver === 'undefined') return;

    const updateVisibleParents = () => {
      const available = nav.clientWidth;
      const children = Array.from(measure.children) as HTMLElement[];
      const ellipsis = children.find((item) => item.dataset.breadcrumbMeasure === 'ellipsis');
      const parents = children.filter((item) => item.dataset.breadcrumbMeasure === 'parent');
      const home = children.find((item) => (
        item.dataset.breadcrumbMeasure !== 'ellipsis' &&
        item.dataset.breadcrumbMeasure !== 'parent'
      ));
      if (parents.length !== visibleParents.length) return;

      const homeWidth = home?.getBoundingClientRect().width ?? 0;
      const ellipsisWidth = ellipsis?.getBoundingClientRect().width ?? 0;
      const parentWidths = parents.map((item) => item.getBoundingClientRect().width);
      const fullWidth = homeWidth + parentWidths.reduce((sum, width) => sum + width, 0);

      if (fullWidth <= available) {
        setMobileTailCount(maxTailCount);
        return;
      }

      const firstWidth = parentWidths[0] ?? 0;
      let bestTailCount = 1;
      for (let tailCount = 1; tailCount <= maxTailCount; tailCount += 1) {
        const tailWidth = parentWidths.slice(-tailCount).reduce((sum, width) => sum + width, 0);
        if (homeWidth + firstWidth + ellipsisWidth + tailWidth <= available) {
          bestTailCount = tailCount;
        } else {
          break;
        }
      }
      setMobileTailCount(bestTailCount);
    };

    const observer = new ResizeObserver(() => requestAnimationFrame(updateVisibleParents));
    observer.observe(nav);
    requestAnimationFrame(updateVisibleParents);
    return () => observer.disconnect();
  }, [maxTailCount, visibleParents.map((item) => item.label).join('|')]);

  if (!breadcrumbs) return null;

  const structuredBreadcrumbs = [...contextParents, ...breadcrumbs].filter((item, index, all) => (
    index === 0 || item.label !== all[index - 1].label
  ));

  return (
    <>
      <DocBreadcrumbsStructuredData breadcrumbs={structuredBreadcrumbs as any} />
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
          <nav
            ref={mobileNavRef}
            className={`${ThemeClassNames.docs.docBreadcrumbs} ${styles.breadcrumbsContainer} ${styles.mobileBreadcrumbs}`}
            aria-label="当前位置">
            <ul ref={measureRef} className={`breadcrumbs ${styles.measureBreadcrumbs}`} aria-hidden="true">
              {homePageRoute && <HomeBreadcrumbItem />}
              {renderItems(visibleParents, true)}
              <li className="breadcrumbs__item" data-breadcrumb-measure="ellipsis">
                <span className={styles.ellipsisButton}>…</span>
              </li>
            </ul>
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
