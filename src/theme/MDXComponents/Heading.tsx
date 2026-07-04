import React, {type ReactNode} from 'react';
import clsx from 'clsx';
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

function textFromChildren(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') {
    return String(children);
  }

  if (Array.isArray(children)) {
    return children.map(textFromChildren).join('');
  }

  if (React.isValidElement<{children?: ReactNode}>(children)) {
    return textFromChildren(children.props.children);
  }

  return '';
}

function hasManualNumber(children: ReactNode): boolean {
  const text = textFromChildren(children).trim();
  return /^(?:(?:\d{1,2}(?:\.\d{1,2})*[.、．]?|[一二三四五六七八九十]{1,3}[、.．]|[（(][一二三四五六七八九十]{1,3}[）)])\s)/.test(text);
}

export default function MDXHeading(props: Props): ReactNode {
  const icon = useOptionalDocIcon();
  const shouldDecorate = props.as === 'h1' && !!icon;
  const manualNumber = (props.as === 'h2' || props.as === 'h3') && hasManualNumber(props.children);

  return (
    <Heading
      {...props}
      className={clsx(props.className, manualNumber && 'doc-heading--manual-number')}
    >
      {shouldDecorate ? (
        <DocTitleWithIcon icon={icon}>{props.children}</DocTitleWithIcon>
      ) : (
        props.children
      )}
    </Heading>
  );
}
