import React, {type ReactNode} from 'react';
import clsx from 'clsx';
import {ThemeClassNames} from '@docusaurus/theme-common';
import {useDoc} from '@docusaurus/plugin-content-docs/client';
import Heading from '@theme/Heading';
import MDXContent from '@theme/MDXContent';
import type {Props} from '@theme/DocItem/Content';
import DocTitleWithIcon from '@site/src/components/DocTitleWithIcon';
import DocActionsMenu from '@site/src/components/DocActionsMenu';

function useSyntheticTitle(): string | null {
  const {metadata, frontMatter, contentTitle} = useDoc();
  const shouldRender =
    !frontMatter.hide_title && typeof contentTitle === 'undefined';
  if (!shouldRender) {
    return null;
  }
  return metadata.title;
}

export default function DocItemContent({children}: Props): ReactNode {
  const syntheticTitle = useSyntheticTitle();
  const {frontMatter, contentTitle} = useDoc();
  const iconValue = (frontMatter as Record<string, unknown>).icon;
  const icon = typeof iconValue === 'string' ? iconValue : undefined;

  // contentTitle: h1 extracted from markdown content (e.g. # Title at top)
  const hasContentTitle = typeof contentTitle !== 'undefined' && !frontMatter.hide_title;

  return (
    <div className={clsx(ThemeClassNames.docs.docMarkdown, 'markdown')}>
      {syntheticTitle && (
        <header style={{display: 'flex', alignItems: 'baseline', gap: '0.6rem'}}>
          <Heading as="h1" style={{marginBottom: 0, flex: 1}}>
            <DocTitleWithIcon icon={icon}>{syntheticTitle}</DocTitleWithIcon>
          </Heading>
          <DocActionsMenu />
        </header>
      )}
      {hasContentTitle && (
        <div style={{float: 'right', marginTop: '0.45rem', marginLeft: '0.6rem', clear: 'right'}}>
          <DocActionsMenu />
        </div>
      )}
      <MDXContent>{children}</MDXContent>
    </div>
  );
}
