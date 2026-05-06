import React, {type ReactNode} from 'react';
import clsx from 'clsx';
import {ThemeClassNames} from '@docusaurus/theme-common';
import {useDoc} from '@docusaurus/plugin-content-docs/client';
import {usePluginData} from '@docusaurus/useGlobalData';
import TagsListInline from '@theme/TagsListInline';
import EditThisPage from '@theme/EditThisPage';
import styles from './styles.module.css';

type DocTimestampMap = Record<string, number>;

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

export default function DocItemFooter(): ReactNode {
  const {metadata} = useDoc();
  const {editUrl, source, tags} = metadata;
  const pluginData = usePluginData('doc-mtime-plugin') as
    | DocTimestampMap
    | undefined;

  const lastUpdatedAt = source ? pluginData?.[source] : undefined;
  const canDisplayTagsRow = tags.length > 0;
  const canDisplayMetaRow = !!(editUrl || lastUpdatedAt);

  if (!canDisplayTagsRow && !canDisplayMetaRow) {
    return null;
  }

  return (
    <footer
      className={clsx(ThemeClassNames.docs.docFooter, 'docusaurus-mt-lg')}>
      {canDisplayTagsRow && (
        <div
          className={clsx(
            'row margin-top--sm',
            ThemeClassNames.docs.docFooterTagsRow,
          )}>
          <div className="col">
            <TagsListInline tags={tags} />
          </div>
        </div>
      )}
      {canDisplayMetaRow && (
        <div
          className={clsx(
            'row margin-top--sm',
            ThemeClassNames.docs.docFooterEditMetaRow,
          )}>
          <div className={clsx('col', styles.noPrint)}>
            {editUrl && <EditThisPage editUrl={editUrl} />}
          </div>
          <div className={clsx('col', styles.lastUpdated)}>
            {lastUpdatedAt && (
              <span>{`最后更新于 ${dateFormatter.format(new Date(lastUpdatedAt))}`}</span>
            )}
          </div>
        </div>
      )}
    </footer>
  );
}
