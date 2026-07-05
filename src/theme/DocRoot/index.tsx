import React from 'react';
import clsx from 'clsx';
import {matchPath} from '@docusaurus/router';
import {HtmlClassNameProvider, ThemeClassNames} from '@docusaurus/theme-common';
import {DocsSidebarProvider, useDocRootMetadata} from '@docusaurus/plugin-content-docs/client';
import {useLocation} from '@docusaurus/router';
import DocRootLayout from '@theme/DocRoot/Layout';
import NotFoundContent from '@theme/NotFound/Content';

type DocRoute = {
  path: string;
  exact?: boolean;
  strict?: boolean;
  routes?: DocRoute[];
  metadata?: {
    frontMatter?: Record<string, unknown>;
  };
};

type DocRootProps = {
  route: {
    routes?: DocRoute[];
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

function useCurrentRouteFrontMatter({route}: DocRootProps) {
  const location = useLocation();
  const currentRoute = findCurrentRoute(route.routes, location.pathname);

  return currentRoute?.metadata?.frontMatter ?? {};
}

export default function DocRoot(props: DocRootProps) {
  const currentDocRouteMetadata = useDocRootMetadata(props);
  const frontMatter = useCurrentRouteFrontMatter(props);
  const location = useLocation();

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
        <DocRootLayout>{docElement}</DocRootLayout>
      </DocsSidebarProvider>
    </HtmlClassNameProvider>
  );
}
