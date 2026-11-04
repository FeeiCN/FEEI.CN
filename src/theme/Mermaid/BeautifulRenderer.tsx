import React, {useId, useMemo, type ReactNode} from 'react';
import {parseMermaid, renderMermaidSVG} from 'beautiful-mermaid';
import OriginalMermaid from '@theme-original/Mermaid';
import type {Props} from '@theme/Mermaid';
import type {BeautifulDiagram} from './source';
import styles from './styles.module.css';

export default function BeautifulRenderer({value, diagram}: Props & {diagram: BeautifulDiagram}): ReactNode {
  const namespace = `beautiful-${useId().replace(/[^\w-]/g, '')}`;
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

  if (!svg) return <OriginalMermaid value={value} />;

  return (
    <div className={styles.viewport} role="region" tabIndex={0} aria-label={`${title ?? '图表'}，可横向滚动`}>
      <div
        className={`docusaurus-mermaid-container ${styles.diagram}`}
        data-renderer="beautiful-mermaid"
        dangerouslySetInnerHTML={{__html: svg}}
      />
    </div>
  );
}
