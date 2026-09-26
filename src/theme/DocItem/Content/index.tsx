import React, {type ReactNode} from 'react';
import clsx from 'clsx';
import {ThemeClassNames} from '@docusaurus/theme-common';
import {useDoc} from '@docusaurus/plugin-content-docs/client';
import Heading from '@theme/Heading';
import MDXContent from '@theme/MDXContent';
import type {Props} from '@theme/DocItem/Content';
import DocTitleWithIcon from '@site/src/components/DocTitleWithIcon';
import DocArticleHeader from '@site/src/components/DocArticleHeader';
import DailyRecordMeta from '@site/src/components/DailyRecordMeta';
import styles from './styles.module.css';

function useSyntheticTitle(): string | null {
  const {metadata, frontMatter, contentTitle} = useDoc();
  const shouldRender = !frontMatter.hide_title && typeof contentTitle === 'undefined';
  if (!shouldRender) return null;
  return metadata.title;
}

function ReadingMode(): ReactNode {
  const {metadata} = useDoc();
  const permalink = metadata.permalink;

  let label: string | null = null;
  let text: string | null = null;

  if (permalink === '/thinking' || permalink.endsWith('/thinking')) {
    label = '持续积累';
    text = '这是一组持续更新的思维卡片，不是一篇需要从头读到尾的文章。更适合按主题查阅，在遇到具体问题时回来调用。';
  } else if (permalink === '/commercial-ai' || permalink.endsWith('/commercial-ai')) {
    label = '参考资料';
    text = '先看开头的判断和选型顺序即可；后面的评测、模型、价格与产品信息是带日期的参考快照，需要做具体选择时再查。';
  }

  if (!label || !text) return null;

  return (
    <aside className={styles.readingMode} aria-label="阅读方式">
      <span className={styles.label}>{label}</span>
      <span>{text}</span>
    </aside>
  );
}

export default function DocItemContent({children}: Props): ReactNode {
  const syntheticTitle = useSyntheticTitle();
  const {frontMatter} = useDoc();
  const iconValue = (frontMatter as Record<string, unknown>).icon;
  const icon = typeof iconValue === 'string' ? iconValue : undefined;

  return (
    <div className={clsx(ThemeClassNames.docs.docMarkdown, 'markdown', styles.themeDocMarkdown)}>
      {syntheticTitle && (
        <DocArticleHeader>
          <Heading as="h1">
            <DocTitleWithIcon icon={icon}>{syntheticTitle}</DocTitleWithIcon>
          </Heading>
        </DocArticleHeader>
      )}
      <DailyRecordMeta />
      <ReadingMode />
      <MDXContent>{children}</MDXContent>
    </div>
  );
}
