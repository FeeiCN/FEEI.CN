import React, {type ReactNode} from 'react';
import clsx from 'clsx';
import {useDoc} from '@docusaurus/plugin-content-docs/client';
import Heading from '@theme/Heading';
import type {Props} from '@theme/MDXComponents/Heading';
import DocTitleWithIcon from '@site/src/components/DocTitleWithIcon';
import DocArticleHeader from '@site/src/components/DocArticleHeader';

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
  let iconValue: unknown;
  let hasExplicitTitle = false;
  try {
    const {frontMatter, contentTitle} = useDoc();
    iconValue = (frontMatter as Record<string, unknown>).icon;
    hasExplicitTitle = typeof contentTitle !== 'undefined';
  } catch {
    iconValue = undefined;
  }
  const icon = typeof iconValue === 'string' ? iconValue : undefined;
  const shouldDecorate = props.as === 'h1' && !!icon;
  const manualNumber = (props.as === 'h2' || props.as === 'h3') && hasManualNumber(props.children);

  const heading = (
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

  return props.as === 'h1' && hasExplicitTitle ? (
    <DocArticleHeader as="div">{heading}</DocArticleHeader>
  ) : (
    heading
  );
}
