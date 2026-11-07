import React, {type ReactNode} from 'react';
import clsx from 'clsx';
import {useDoc} from '@docusaurus/plugin-content-docs/client';
import TOCItems from '@theme-original/TOCItems';
import type {Props} from '@theme/TOCItems';

export default function DocTOCItems({className, ...props}: Props): ReactNode {
  let isStandard = false;
  try {
    isStandard = (useDoc().frontMatter as Record<string, unknown>).standard_source === true;
  } catch {
    // TOCItems also renders outside documentation pages.
  }
  return (
    <TOCItems
      {...props}
      className={clsx(className ?? 'table-of-contents table-of-contents__left-border', isStandard && 'toc--original-numbering')}
    />
  );
}
