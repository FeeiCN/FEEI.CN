import React, {type ReactNode} from 'react';
import clsx from 'clsx';
import {ThemeClassNames} from '@docusaurus/theme-common';
import {useDoc} from '@docusaurus/plugin-content-docs/client';
import TagsListInline from '@theme/TagsListInline';
import FeaturedArticleFooter from '@site/src/components/FeaturedArticleFooter';

export default function DocItemFooter(): ReactNode {
  const {metadata} = useDoc();
  const {tags} = metadata;

  return (
    <>
      <FeaturedArticleFooter />
      {tags.length > 0 && (
        <footer className={clsx(ThemeClassNames.docs.docFooter, 'docusaurus-mt-lg')}>
          <div className={clsx('row margin-top--sm', ThemeClassNames.docs.docFooterTagsRow)}>
            <div className="col"><TagsListInline tags={tags} /></div>
          </div>
        </footer>
      )}
    </>
  );
}
