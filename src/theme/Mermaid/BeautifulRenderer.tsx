import React, {useId, useLayoutEffect, useMemo, useRef, type ReactNode} from 'react';
import {parseMermaid, renderMermaidSVG} from 'beautiful-mermaid';
import OriginalMermaid from '@theme-original/Mermaid';
import type {Props} from '@theme/Mermaid';
import type {BeautifulDiagram} from './source';
import styles from './styles.module.css';

export default function BeautifulRenderer({value, diagram}: Props & {diagram: BeautifulDiagram}): ReactNode {
  const namespace = `beautiful-${useId().replace(/[^\w-]/g, '')}`;
  const viewportRef = useRef<HTMLDivElement>(null);
  const {source, kind, title, description} = diagram;
  const svg = useMemo(() => {
    try {
      const rendered = renderMermaidSVG(source, {
        bg: 'var(--diagram-bg)',
        fg: 'var(--diagram-fg)',
        line: 'var(--diagram-line)',
        accent: 'var(--diagram-accent)',
        muted: 'var(--diagram-muted)',
        surface: 'var(--diagram-surface)',
        border: 'var(--diagram-border)',
        font: 'system-ui',
        padding: 20,
        nodeSpacing: 24,
        layerSpacing: 26,
        transparent: true,
      })
        .replace(/@import url\('[^']*'\);/g, '')
        .replace(/text \{ font-family:[^\n]*\}/g, '');
      const document = new DOMParser().parseFromString(rendered, 'image/svg+xml');
      if (document.querySelector('parsererror')) return null;
      const root = document.documentElement;
      const ids = new Map<string, string>();
      document.querySelectorAll('[id]').forEach(element => {
        const id = element.getAttribute('id')!;
        ids.set(id, `${namespace}-${id}`);
        element.setAttribute('id', ids.get(id)!);
      });
      document.querySelectorAll('*').forEach(element => {
        for (const attribute of [...element.attributes]) {
          const updated = attribute.value.replace(/url\(#([^)]*)\)/g, (match, id: string) =>
            ids.has(id) ? `url(#${ids.get(id)})` : match);
          if (updated !== attribute.value) element.setAttribute(attribute.name, updated);
        }
      });
      root.setAttribute('id', namespace);
      root.setAttribute('role', 'img');
      for (const [tag, text] of [['title', title], ['desc', description]] as const) {
        if (!text) continue;
        const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
        element.setAttribute('id', `${namespace}-${tag}`);
        element.textContent = text;
        root.prepend(element);
        root.setAttribute(tag === 'title' ? 'aria-labelledby' : 'aria-describedby', `${namespace}-${tag}`);
      }
      document.querySelectorAll('style').forEach(style => {
        style.textContent = style.textContent!.replace(/(^|\n)([ \t]*)([^@\n{}]+)\{/g, (_, newline, space, selectors: string) =>
          `${newline}${space}${selectors.split(',').map(selector =>
            selector.trim() === 'svg' ? `#${namespace}` : `#${namespace} ${selector.trim()}`).join(', ')} {`);
      });
      if (kind === 'flowchart' || kind === 'state') {
        const classes = parseMermaid(source).classAssignments;
        document.querySelectorAll('[data-id].node').forEach(node => {
          const className = classes.get(node.getAttribute('data-id')!);
          if (className) node.setAttribute('data-class', className);
        });
      }
      return new XMLSerializer().serializeToString(root);
    } catch {
      return null;
    }
  }, [source, kind, title, description, namespace]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!svg || !viewport || kind !== 'flowchart' || !/^(?:flowchart|graph)\s+(?:TB|TD|BT)\b/i.test(source)) return;
    const region = viewport.closest<HTMLElement>('.incident-diagram') ?? viewport;
    const graph = parseMermaid(source);
    const startId = [...graph.nodes.keys()].find(id => graph.classAssignments.get(id) !== 'note');
    const start = [...viewport.querySelectorAll<SVGGElement>('.node')].find(node => node.getAttribute('data-id') === startId);
    if (!start) return;
    const showStart = () => {
      const nodeBounds = start.getBoundingClientRect();
      const regionBounds = region.getBoundingClientRect();
      region.scrollLeft = Math.max(0, region.scrollLeft + nodeBounds.left - regionBounds.left - region.clientLeft + nodeBounds.width / 2 - region.clientWidth / 2);
    };
    showStart();
    const observer = new ResizeObserver(showStart);
    observer.observe(region);
    return () => observer.disconnect();
  }, [svg, source, kind]);

  if (!svg) return <OriginalMermaid value={value} />;

  return (
    <div ref={viewportRef} className={styles.viewport} role="region" tabIndex={0} aria-label={`${title ?? '图表'}，可横向滚动`}>
      <div
        className={`docusaurus-mermaid-container ${styles.diagram}`}
        data-renderer="beautiful-mermaid"
        dangerouslySetInnerHTML={{__html: svg}}
      />
    </div>
  );
}
