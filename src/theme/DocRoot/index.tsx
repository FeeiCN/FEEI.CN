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
  metadata?: {
    frontMatter?: Record<string, unknown>;
  };
};

type DocRootProps = {
  route: {
    routes?: DocRoute[];
  };
};

function useCurrentRouteFrontMatter({route}: DocRootProps) {
  const location = useLocation();
  const currentRoute = route.routes?.find((docRoute) =>
    matchPath(location.pathname, docRoute),
  );

  return currentRoute?.metadata?.frontMatter ?? {};
}

export default function DocRoot(props: DocRootProps) {
  const currentDocRouteMetadata = useDocRootMetadata(props);
  const frontMatter = useCurrentRouteFrontMatter(props);

  if (!currentDocRouteMetadata) {
    return <NotFoundContent />;
  }

  const {docElement, sidebarName, sidebarItems} = currentDocRouteMetadata;
  const hideSidebar = frontMatter.hide_sidebar === true;

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
