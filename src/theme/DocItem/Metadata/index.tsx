import type {ReactNode} from 'react';
import Head from '@docusaurus/Head';
import {PageMetadata} from '@docusaurus/theme-common';
import {useDoc} from '@docusaurus/plugin-content-docs/client';
import {shareImageForPath} from '@site/src/data/featuredReading';

export default function DocItemMetadata(): ReactNode {
  const {metadata, frontMatter, assets} = useDoc();
  const image = assets.image ?? frontMatter.image ?? shareImageForPath(metadata.permalink);
  return (
    <>
      <PageMetadata title={metadata.title} description={metadata.description} keywords={frontMatter.keywords} image={image} />
      <Head>
        <meta name="twitter:card" content="summary_large_image" />
        <meta property="og:image:alt" content={`${metadata.title} · 吴飞飞 Feei`} />
      </Head>
    </>
  );
}
