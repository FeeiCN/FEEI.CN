import {lazy, Suspense} from 'react';
import {useDoc} from '@docusaurus/plugin-content-docs/client';

const Panel = lazy(() => import('./StandardRelationsPanel'));

export default function StandardRelations() {
  const {metadata, frontMatter} = useDoc();
  const sourceReader = (frontMatter as Record<string, unknown>).standard_source === true;
  if (!sourceReader && !/^(?:GB(?:\/[TZ])?|G[MA]\/T)\s*\d[\d.]*\s*[-—–]\s*\d{4}/i.test(metadata.title)) return null;
  return <Suspense fallback={null}><Panel key={metadata.permalink} permalink={metadata.permalink} /></Suspense>;
}
