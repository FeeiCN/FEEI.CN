import React, {type ReactNode} from 'react';
import {useDoc} from '@docusaurus/plugin-content-docs/client';
import Heading from '@theme/Heading';
import type {Props} from '@theme/MDXComponents/Heading';
import DocTitleWithIcon from '@site/src/components/DocTitleWithIcon';

function useOptionalDocIcon(): string | undefined {
  try {
    const {frontMatter} = useDoc();
    const icon = (frontMatter as Record<string, unknown>).icon;
    return typeof icon === 'string' ? icon : undefined;
  } catch {
    return undefined;
  }
}

export default function MDXHeading(props: Props): ReactNode {
  const icon = useOptionalDocIcon();
  const shouldDecorate = props.as === 'h1' && !!icon;

  return (
    <Heading {...props}>
      {shouldDecorate ? (
        <DocTitleWithIcon icon={icon}>{props.children}</DocTitleWithIcon>
      ) : (
        props.children
      )}
    </Heading>
  );
}
