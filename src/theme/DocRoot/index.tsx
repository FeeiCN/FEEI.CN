import React, {useEffect, useRef} from 'react';
import clsx from 'clsx';
import {matchPath} from '@docusaurus/router';
import {HtmlClassNameProvider, ThemeClassNames} from '@docusaurus/theme-common';
import {DocsSidebarProvider, useDocRootMetadata} from '@docusaurus/plugin-content-docs/client';
import {useLocation} from '@docusaurus/router';
import DocRootLayout from '@theme/DocRoot/Layout';
import NotFoundContent from '@theme/NotFound/Content';
import type {Props} from '@theme/DocRoot';
import styles from './styles.module.css';

type DocRoute = {
  path: string;
  exact?: boolean;
  strict?: boolean;
  routes?: DocRoute[];
  metadata?: {
    frontMatter?: Record<string, unknown>;
  };
};

function findCurrentRoute(routes: DocRoute[] | undefined, pathname: string): DocRoute | undefined {
  for (const docRoute of routes ?? []) {
    const nestedRoute = findCurrentRoute(docRoute.routes, pathname);

    if (nestedRoute) {
      return nestedRoute;
    }

    if (matchPath(pathname, docRoute)) {
      return docRoute;
    }
  }

  return undefined;
}

function useCurrentRouteFrontMatter({route}: Props) {
  const location = useLocation();
  const currentRoute = findCurrentRoute(route.routes as DocRoute[] | undefined, location.pathname);

  return currentRoute?.metadata?.frontMatter ?? {};
}

export default function DocRoot(props: Props) {
  const currentDocRouteMetadata = useDocRootMetadata(props);
  const frontMatter = useCurrentRouteFrontMatter(props);
  const location = useLocation();
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sidebar = frameRef.current?.querySelector<HTMLElement>('.theme-doc-sidebar-container nav');
    const menu = sidebar?.querySelector<HTMLElement>('.theme-doc-sidebar-menu');
    if (!sidebar || !menu) return;

    let animationFrame: number | undefined;
    const revealCurrentItem = () => {
      animationFrame = undefined;
      if (window.innerWidth < 997 || sidebar.clientHeight === 0) return;
      const current = menu.querySelector<HTMLElement>('[aria-current="page"]');
      if (!current || current.getClientRects().length === 0) return;
      const bounds = sidebar.getBoundingClientRect();
      const itemBounds = current.getBoundingClientRect();
      if (itemBounds.top < bounds.top + 12 || itemBounds.bottom > bounds.bottom - 12) {
        sidebar.scrollTop += itemBounds.top - bounds.top - (sidebar.clientHeight - itemBounds.height) / 2;
      }
    };
    const scheduleReveal = () => {
      if (animationFrame === undefined) animationFrame = window.requestAnimationFrame(revealCurrentItem);
    };
    const resizeObserver = new ResizeObserver(scheduleReveal);
    const mutationObserver = new MutationObserver(scheduleReveal);
    resizeObserver.observe(sidebar);
    resizeObserver.observe(menu);
    mutationObserver.observe(menu, {childList: true, subtree: true, attributes: true, attributeFilter: ['aria-current']});
    const stopFollowing = () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame);
      animationFrame = undefined;
    };
    sidebar.addEventListener('wheel', stopFollowing, {passive: true});
    sidebar.addEventListener('pointerdown', stopFollowing);
    sidebar.addEventListener('keydown', stopFollowing);
    scheduleReveal();

    return () => {
      stopFollowing();
      sidebar.removeEventListener('wheel', stopFollowing);
      sidebar.removeEventListener('pointerdown', stopFollowing);
      sidebar.removeEventListener('keydown', stopFollowing);
    };
  }, [location.pathname]);

  useEffect(() => {
    const frame = frameRef.current;
    const footer = document.querySelector('footer');
    if (!frame || !footer) return;

    let animationFrame: number | undefined;
    let previousHeight = -1;
    const updateHeight = () => {
      animationFrame = undefined;
      const footerBounds = footer.getBoundingClientRect();
      const visibleHeight = Math.max(0, Math.min(footerBounds.height, window.innerHeight - footerBounds.top));
      if (visibleHeight !== previousHeight) {
        frame.style.setProperty('--docs-visible-footer-height', `${visibleHeight}px`);
        previousHeight = visibleHeight;
      }
    };
    const scheduleUpdate = () => {
      if (animationFrame === undefined) {
        animationFrame = window.requestAnimationFrame(updateHeight);
      }
    };
    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(footer);
    const handleRailWheel = (event: WheelEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.shiftKey || window.innerWidth < 997
        || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      const target = event.target;
      const pane = target instanceof Element
        ? target.closest<HTMLElement>('.theme-doc-sidebar-container nav, [data-doc-toc-scroll]')
        : null;
      if (!pane) return;

      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? parseFloat(getComputedStyle(pane).lineHeight) || 16
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? pane.clientHeight : 1;
      const delta = event.deltaY * unit;
      const direction = Math.sign(delta);
      const remaining = Math.max(0, direction > 0
        ? pane.scrollHeight - pane.clientHeight - pane.scrollTop
        : pane.scrollTop);
      if (Math.abs(delta) <= remaining) return;

      event.preventDefault();
      pane.scrollTop += direction * remaining;
      window.scrollBy({top: delta - direction * remaining, behavior: 'instant'});
    };
    frame.addEventListener('wheel', handleRailWheel, {passive: false});
    window.addEventListener('scroll', scheduleUpdate, {passive: true});
    window.addEventListener('resize', scheduleUpdate);
    updateHeight();

    return () => {
      resizeObserver.disconnect();
      frame.removeEventListener('wheel', handleRailWheel);
      window.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame);
    };
  }, [location.pathname]);

  if (!currentDocRouteMetadata) {
    return <NotFoundContent />;
  }

  const {docElement, sidebarName, sidebarItems} = currentDocRouteMetadata;
  const hideSidebar =
    frontMatter.hide_sidebar === true ||
    location.pathname === '/review' ||
    location.pathname === '/review/';

  return (
    <HtmlClassNameProvider className={clsx(ThemeClassNames.page.docsDocPage)}>
      <DocsSidebarProvider
        name={hideSidebar ? undefined : sidebarName}
        items={hideSidebar ? undefined : sidebarItems}
      >
        <div ref={frameRef} className={clsx(styles.frame, !hideSidebar && sidebarName && styles.withSidebar)}>
          <DocRootLayout>{docElement}</DocRootLayout>
        </div>
      </DocsSidebarProvider>
    </HtmlClassNameProvider>
  );
}
