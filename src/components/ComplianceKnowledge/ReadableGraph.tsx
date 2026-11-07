import {useEffect, useMemo, useRef, useState} from 'react';
import {Button} from '@chakra-ui/react';
import {useColorMode} from '@docusaurus/theme-common';
import type {Core, StylesheetJson} from 'cytoscape';
import {fileKindLabels, readableNeighborhood, type Catalog, type CatalogEntry} from './panoramaModel';
import {relationLabels, type KnowledgeEdge} from './model';
import styles from './panorama.module.css';

type Props = {
  catalog: Catalog; matches: CatalogEntry[]; extended: boolean; selected: string;
  requestedCenter: string;
  onSelect: (id: string) => void; onCenter: (id: string) => void; onEdge: (edge: KnowledgeEdge) => void;
};

export default function ReadableGraph({catalog, matches, extended, selected, requestedCenter, onSelect, onCenter, onEdge}: Props) {
  const {colorMode} = useColorMode();
  const initial = matches.find(entry => entry.node.id === selected)?.node.id
    ?? matches.find(entry => entry.node.id === 'document:cii-security-protection')?.node.id
    ?? matches[0]?.node.id ?? '';
  const [center, setCenter] = useState(initial);
  const [page, setPage] = useState(0);
  const [mentions, setMentions] = useState(false);
  const [back, setBack] = useState<string[]>([]);
  const [error, setError] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const callbacks = useRef({onEdge});
  callbacks.current = {onEdge};
  const scope = useMemo(() => catalog.entries.filter(entry => extended || entry.collected), [catalog, extended]);
  const graph = useMemo(() => readableNeighborhood(scope, catalog.edges, center, page, mentions), [scope, catalog, center, page, mentions]);
  const root = graph.entries[0];
  const incoming = graph.edges.filter(edge => edge.object === center);
  const outgoing = graph.edges.filter(edge => edge.subject === center);
  const rows = Math.max(1, incoming.length, outgoing.length);
  const cardHeight = Math.max(124, ...graph.entries.map(entry => Math.ceil([...entry.node.label].reduce((width, char) => width + (char.charCodeAt(0) < 128 ? .55 : 1), 0) / 14) * 23 + 58));
  const gap = cardHeight + 34;
  const height = Math.max(400, rows * gap + 60);
  const positions = useMemo(() => {
    const result = new Map([[center, {x: 550, y: height / 2}]]);
    for (const [edges, x] of [[incoming, 150], [outgoing, 950]] as const) {
      edges.forEach((edge, i) => result.set(edge.subject === center ? edge.object : edge.subject, {x, y: height / 2 + (i - (edges.length - 1) / 2) * gap}));
    }
    return result;
  }, [graph, height, gap]);

  useEffect(() => {setCenter(initial); setPage(0); setBack([]);}, [matches]);
  useEffect(() => {if (requestedCenter) {setCenter(requestedCenter); setPage(0); setBack([]);}}, [requestedCenter]);

  useEffect(() => {
    const container = canvasRef.current;
    if (!container || !root) return;
    let disposed = false;
    let cy: Core | undefined;
    setError(false);
    import('cytoscape').then(({default: cytoscape}) => {
      if (disposed) return;
      const dark = colorMode === 'dark';
      const surface = dark ? '#171717' : '#ffffff';
      const line = dark ? '#cbd5e1' : '#475569';
      const style: StylesheetJson = [
        {selector: 'node', style: {shape: 'round-rectangle', width: 250, height: cardHeight, 'background-opacity': 0, 'border-width': 0}},
        {selector: 'edge', style: {
          width: 2, 'line-color': line, 'target-arrow-color': line, 'target-arrow-shape': 'triangle',
          'curve-style': 'bezier', label: 'data(label)', 'font-family': 'sans-serif', 'font-size': 14,
          color: line, 'text-background-color': surface, 'text-background-opacity': 1, 'text-background-padding': '6px',
          'text-border-width': 1, 'text-border-opacity': 1, 'text-border-color': dark ? '#525252' : '#d4d4d4',
          'text-border-style': 'solid', 'text-events': 'yes', 'arrow-scale': 1.2,
        }},
        {selector: 'edge[predicate = "enactedUnder"]', style: {'line-color': dark ? '#c084fc' : '#7e22ce', 'target-arrow-color': dark ? '#c084fc' : '#7e22ce'}},
        {selector: 'edge[predicate = "implements"]', style: {'line-color': dark ? '#34d399' : '#047857', 'target-arrow-color': dark ? '#34d399' : '#047857'}},
      ];
      cy = cytoscape({container, style, elements: [
        ...graph.entries.map(entry => ({data: {id: entry.node.id}, position: positions.get(entry.node.id)})),
        ...graph.edges.map(edge => ({data: {id: edge.id, source: edge.subject, target: edge.object, label: relationLabels[edge.predicate], predicate: edge.predicate}})),
      ], layout: {name: 'preset', fit: false}, zoom: 1, pan: {x: 0, y: 0},
      userZoomingEnabled: false, userPanningEnabled: false, autoungrabify: true, autounselectify: true, boxSelectionEnabled: false});
      cyRef.current = cy;
      cy.on('tap', 'edge', event => {
        const edge = graph.edges.find(edge => edge.id === event.target.id());
        if (edge) callbacks.current.onEdge(edge);
      });
    }).catch(() => {if (!disposed) setError(true);});
    return () => {disposed = true; cy?.destroy(); cyRef.current = null;};
  }, [graph, positions, colorMode, cardHeight]);

  const expand = (id: string) => {
    if (id === center) return;
    setBack(items => [...items, center]); setCenter(id); setPage(0);
    onCenter(id);
    boardRef.current?.scrollIntoView({block: 'start', behavior: 'instant'});
  };
  const title = (entry: CatalogEntry) => entry.node.label.replace(/^中华人民共和国/, '');
  if (!root) return null;
  return <div ref={boardRef} className={styles.readableBoard}>
    <div className={styles.readableHeader}>
      <div><span>当前中心文件</span><h3>{title(root)}</h3><p>点“展开关联”沿关系继续查；点文件名或连线查看依据。</p></div>
      <div className={styles.readableActions}>
        <Button variant="outline" disabled={!back.length} onClick={() => {setCenter(back[back.length - 1]); setBack(items => items.slice(0, -1)); setPage(0);}}>← 上一份文件</Button>
        <Button variant="outline" aria-pressed={mentions} onClick={() => {setMentions(value => !value); setPage(0);}}>{mentions ? '收起普通提及' : '包含普通提及'}</Button>
      </div>
    </div>
    <p className={styles.readableCount}>共 {graph.total} 个直接关联文件，本页显示 {graph.edges.length} 个。每个文件优先展示一条核心关系，全部关系可在详情中核对。筛选用于找中心文件，关联可跨目录和类别。</p>
    <div className={styles.readableDesktop}>
      <div className={styles.readableScroll} tabIndex={0} aria-label="文件关联图，可横向滚动">
        <div className={styles.readableDiagram} style={{height}}>
          <div ref={canvasRef} className={styles.readableCanvas} aria-hidden="true" />
          {graph.entries.map(entry => {
            const p = positions.get(entry.node.id)!;
            return <div key={entry.node.id} className={styles.fileCard} data-kind={entry.kind} data-center={entry.node.id === center} style={{left: p.x - 125, top: p.y - cardHeight / 2, height: cardHeight}}>
              <span>{fileKindLabels[entry.kind]}{entry.node.id === center ? ' · 当前中心' : ''}</span>
              <Button variant="ghost" onClick={() => onSelect(entry.node.id)}>{title(entry)}</Button>
              {entry.node.id !== center && <Button variant="ghost" onClick={() => expand(entry.node.id)}>展开关联 →</Button>}
            </div>;
          })}
        </div>
      </div>
      <p className={styles.mapNote}>箭头从“声明这条关系的文件”指向“依据或引用的文件”；具体含义以连线文字为准。</p>
    </div>
    <div className={styles.readableMobile}>
      <p className={styles.mapNote}>逐条阅读关系，文件名称完整展示。</p>
      {graph.edges.map(edge => {
        const entry = graph.entries.find(entry => entry.node.id === (edge.subject === center ? edge.object : edge.subject))!;
        const isSource = edge.subject === center;
        return <div key={edge.id} className={styles.mobileRelation}>
          <span>{isSource ? '当前文件' : '以下文件'} <strong>→ {relationLabels[edge.predicate]} →</strong> {isSource ? '以下文件' : '当前文件'}</span>
          <Button variant="ghost" onClick={() => onSelect(entry.node.id)}>{title(entry)}</Button>
          <div><Button variant="outline" onClick={() => expand(entry.node.id)}>展开关联 →</Button><Button variant="outline" onClick={() => onEdge(edge)}>查看这条关系的依据</Button></div>
        </div>;
      })}
    </div>
    {error && <p role="alert">连线暂未绘制成功，可使用下方关系列表核对。</p>}
    {!graph.total && <p className={styles.empty}>这份文件暂未收录核心关系。可以切换“包含普通提及”，或选择其他文件。</p>}
    <nav className={styles.readablePaging} aria-label="关联文件分页">
      <Button variant="outline" disabled={graph.page === 0} onClick={() => setPage(value => value - 1)}>上一组</Button>
      <span>{graph.page + 1} / {graph.pages}</span>
      <Button variant="outline" disabled={graph.page + 1 >= graph.pages} onClick={() => setPage(value => value + 1)}>下一组关联</Button>
    </nav>
    <details className={styles.relations}><summary>用文字核对本页关系（{graph.edges.length} 条）</summary>{graph.edges.map(edge => <Button variant="outline" key={edge.id} onClick={() => onEdge(edge)}>{catalog.entries.find(entry => entry.node.id === edge.subject)?.node.label} → {relationLabels[edge.predicate]} → {catalog.entries.find(entry => entry.node.id === edge.object)?.node.label}</Button>)}</details>
  </div>;
}
