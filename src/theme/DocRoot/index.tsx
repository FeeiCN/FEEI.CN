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
    window.addEventListener('scroll', scheduleUpdate, {passive: true});
    window.addEventListener('resize', scheduleUpdate);
    updateHeight();

    return () => {
      resizeObserver.disconnect();
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
