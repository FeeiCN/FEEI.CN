import React, {lazy, Suspense, type ReactNode} from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import ErrorBoundary from '@docusaurus/ErrorBoundary';
import OriginalMermaid from '@theme-original/Mermaid';
import type {Props} from '@theme/Mermaid';
import {getBeautifulDiagram} from './source';

const BeautifulRenderer = lazy(() => import('./BeautifulRenderer'));

export default function Mermaid({value}: Props): ReactNode {
  const diagram = getBeautifulDiagram(value);
  if (!diagram) return <OriginalMermaid value={value} />;
  const fallback = <OriginalMermaid value={value} />;

  return (
    <BrowserOnly fallback={fallback}>
      {() => (
        <ErrorBoundary key={value} fallback={() => fallback}>
          <Suspense fallback={fallback}>
            <BeautifulRenderer value={value} diagram={diagram} />
          </Suspense>
        </ErrorBoundary>
      )}
    </BrowserOnly>
  );
}
