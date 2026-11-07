import {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {Button} from '@chakra-ui/react';
import {useColorMode} from '@docusaurus/theme-common';
import type {Core, LayoutOptions, StylesheetJson} from 'cytoscape';
import {adjacentEdges, graphLabel, neighborhood, NEIGHBOR_BATCH} from './graphModel';
import {relationLabels, sourceLink, typeLabel, type Evidence, type KnowledgeEdge, type KnowledgeIndex} from './model';
import styles from './graph.module.css';

type Props = {
  index: KnowledgeIndex; root: string; selected: string; evidence: Map<string, Evidence>; evidenceLoading: boolean;
  onSelect: (id: string) => void; onCenter: (id: string) => void; children: ReactNode;
};

export default function KnowledgeGraph({index, root, selected, evidence, evidenceLoading, onSelect, onCenter, children}: Props) {
  const {colorMode} = useColorMode();
  const initialBudgets = (): Record<string, number> => typeof window !== 'undefined' && window.innerWidth <= 600 ? {[root]: 3} : {};
  const [budgets, setBudgets] = useState<Record<string, number>>(initialBudgets);
  const [edgeId, setEdgeId] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  const canvasRef = useRef<HTMLDivElement>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const events = useRef({onSelect, selected, edgeId});
  events.current = {onSelect, selected, edgeId};
  const graph = useMemo(() => neighborhood(index, root, budgets), [index, root, budgets]);
  const edge = graph.edges.find(item => item.id === edgeId);
  const current = index.nodes.get(selected) ?? index.nodes.get(root);
  const remaining = graph.remaining.get(current?.id ?? '') ?? 0;
  const showGraph = () => canvasRef.current?.parentElement?.scrollIntoView({block: 'start', behavior: 'instant'});
  const showInspector = () => {
    if (window.innerWidth <= 1000) requestAnimationFrame(() => inspectorRef.current?.scrollIntoView({block: 'start', behavior: 'instant'}));
  };

  useEffect(() => {
    const container = canvasRef.current;
    if (!container || !graph.nodes.length) return;
    let disposed = false;
    let observer: ResizeObserver | undefined;
    let cy: Core | undefined;
    setStatus('loading');
    import('cytoscape').then(({default: cytoscape}) => {
      if (disposed) return;
      const dark = colorMode === 'dark';
      const foreground = dark ? '#e5e7eb' : '#1f2937';
      const surface = dark ? '#171c25' : '#ffffff';
      const line = dark ? '#94a3b8' : '#64748b';
      const colors: Record<string, string> = dark
        ? {Document: '#103d32', StandardVersion: '#17375b', StandardSeries: '#313744', Clause: '#422e5d'}
        : {Document: '#dff4e9', StandardVersion: '#e1edff', StandardSeries: '#edf0f5', Clause: '#f0e5ff'};
      const stylesheet: StylesheetJson = [
        {selector: 'node', style: {
          'shape': 'round-rectangle', 'width': 150, 'height': 64, 'background-color': 'data(color)',
          'border-width': 1.5, 'border-color': line, 'label': 'data(label)', 'color': foreground,
          'font-family': 'sans-serif', 'font-size': 13, 'text-wrap': 'wrap', 'text-max-width': '140px', 'text-overflow-wrap': 'anywhere', 'line-height': 1.2,
          'text-valign': 'center', 'text-halign': 'center', 'padding': '7px',
        }},
        {selector: 'node.root', style: {'border-width': 3, 'border-color': foreground}},
        {selector: 'node.chosen', style: {'border-width': 4, 'border-color': dark ? '#60a5fa' : '#2563eb'}},
        {selector: 'edge', style: {
          'width': 1.8, 'line-color': line, 'target-arrow-color': line, 'target-arrow-shape': 'triangle',
          'curve-style': 'bezier', 'control-point-step-size': 90, 'label': 'data(label)', 'font-size': 11, 'color': foreground,
          'text-background-color': surface, 'text-background-opacity': .95, 'text-background-padding': '4px',
          'text-rotation': 'autorotate', 'arrow-scale': 1.2,
        }},
        {selector: 'edge[predicate = "supersedes"]', style: {'line-color': dark ? '#fbbf24' : '#b45309', 'target-arrow-color': dark ? '#fbbf24' : '#b45309', 'width': 3}},
        {selector: 'edge[predicate = "enactedUnder"]', style: {'line-color': dark ? '#c084fc' : '#7e22ce', 'target-arrow-color': dark ? '#c084fc' : '#7e22ce', 'width': 3}},
        {selector: 'edge[predicate = "implements"]', style: {'line-color': dark ? '#34d399' : '#047857', 'target-arrow-color': dark ? '#34d399' : '#047857', 'width': 3}},
        {selector: 'edge.chosen', style: {'line-color': '#3b82f6', 'target-arrow-color': '#3b82f6', 'width': 4}},
      ];
      const layout = (): LayoutOptions => container.clientWidth < 500
        ? {name: 'grid', cols: 2, avoidOverlap: true, padding: 25, animate: false}
        : {name: 'concentric', concentric: node => node.id() === root ? 2 : 1, levelWidth: () => 1, minNodeSpacing: 55, avoidOverlap: true, padding: 35, animate: false};
      cy = cytoscape({container, style: stylesheet, elements: [
        ...graph.nodes.map(node => ({data: {id: node.id, label: graphLabel(node), color: colors[node.type]}, classes: node.id === root ? 'root' : ''})),
        ...graph.edges.map(item => ({data: {id: item.id, source: item.subject, target: item.object, label: relationLabels[item.predicate], predicate: item.predicate}})),
      ], layout: layout(),
      minZoom: .2, maxZoom: 2.5, wheelSensitivity: .15, autounselectify: true});
      cyRef.current = cy;
      cy.getElementById(events.current.edgeId ?? events.current.selected).addClass('chosen');
      cy.on('tap', 'node', event => {setEdgeId(null); events.current.onSelect(event.target.id()); showInspector();});
      cy.on('tap', 'edge', event => {setEdgeId(event.target.id()); showInspector();});
      observer = new ResizeObserver(() => {cy?.resize(); cy?.layout(layout()).run();});
      observer.observe(container);
      setStatus('ready');
    }).catch(() => {if (!disposed) setStatus('error');});
    return () => {disposed = true; observer?.disconnect(); cy?.destroy(); cyRef.current = null;};
  }, [graph, root, colorMode, retry]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().removeClass('chosen');
    cy.getElementById(edgeId ?? selected).addClass('chosen');
  }, [selected, edgeId]);

  const selectNode = (id: string) => {setEdgeId(null); onSelect(id); showInspector();};
  const expand = () => {
    if (!current) return;
    setBudgets(previous => ({...previous, [current.id]: (previous[current.id] ?? (current.id === root ? NEIGHBOR_BATCH : 0)) + NEIGHBOR_BATCH}));
    if (window.innerWidth <= 1000) showGraph();
  };
  const zoom = (factor: number) => {
    const cy = cyRef.current;
    if (cy) cy.zoom({level: Math.min(cy.maxZoom(), Math.max(cy.minZoom(), cy.zoom() * factor)), renderedPosition: {x: cy.width() / 2, y: cy.height() / 2}});
  };
  if (!graph.nodes.length) return <p>当前数据中找不到这个对象，请返回查询重新选择。</p>;
  return <section className={styles.explorer} aria-label="合规知识图谱">
    <div className={styles.heading}><h2>顺着关系，找到依据</h2><p>点击方框看资料，点击箭头看原文依据。箭头按文字方向阅读，例如“新版 → 明确代替 → 旧版”。</p></div>
    <div className={styles.workspace}>
      <div className={styles.board}>
        <div className={styles.toolbar} aria-label="图谱操作">
          <Button size="sm" variant="outline" aria-label="放大图谱" onClick={() => zoom(1.25)}>＋</Button>
          <Button size="sm" variant="outline" aria-label="缩小图谱" onClick={() => zoom(.8)}>−</Button>
          <Button size="sm" variant="outline" onClick={() => cyRef.current?.fit(undefined, 35)}>完整显示</Button>
          <Button size="sm" variant="outline" onClick={() => {setBudgets(initialBudgets()); setEdgeId(null); onSelect(root);}}>重置展开</Button>
        </div>
        <div ref={canvasRef} className={styles.canvas} role="group" aria-label="可拖动的关系图；也可展开下方文字列表操作" tabIndex={0} onKeyDown={event => {
          if (['+', '=', '-', '0'].includes(event.key)) {
            event.preventDefault();
            if (event.key === '0') cyRef.current?.fit(undefined, 35); else zoom(event.key === '-' ? .8 : 1.25);
          }
        }} />
        {status === 'loading' && <p className={styles.renderStatus} role="status">正在绘制关系图…</p>}
        {status === 'error' && <div role="alert" className={styles.renderStatus}>关系图暂时无法绘制。可以使用下方文字列表，或 <Button size="sm" variant="outline" onClick={() => setRetry(value => value + 1)}>重试绘制</Button></div>}
        <div className={styles.legend} aria-label="节点类型"><span data-kind="document">资料 / 原文</span><span data-kind="version">标准版本</span><span data-kind="series">标准系列</span><span data-kind="clause">章节</span></div>
        <p className={styles.scope} aria-live="polite">已显示 {graph.nodes.length} 个对象、{graph.edges.length} 条关系。{graph.capped ? '已达到本图上限，可选择一个对象“以它为中心”继续查看。' : '这是当前对象周围的部分关联，可选择对象继续展开。'}</p>
        <details className={styles.textView}><summary>用文字列表操作图中对象和关系</summary>
          <h3>图中对象</h3><div className={styles.nodeList}>{graph.nodes.map(node => <Button size="sm" variant="outline" key={node.id} aria-pressed={!edge && selected === node.id} onClick={() => selectNode(node.id)}>{typeLabel(node)} · {node.label}</Button>)}</div>
          <h3>图中关系</h3><div className={styles.nodeList}>{graph.edges.map(item => <Button size="sm" variant="outline" key={item.id} aria-pressed={edge?.id === item.id} onClick={() => {setEdgeId(item.id); showInspector();}}>{graphLabel(index.nodes.get(item.subject)!)} → {relationLabels[item.predicate]} → {graphLabel(index.nodes.get(item.object)!)}</Button>)}</div>
        </details>
      </div>
      <div ref={inspectorRef} className={styles.inspector} aria-label="图谱详情" aria-live="polite">
        <Button className={styles.returnGraph} size="sm" variant="outline" onClick={showGraph}>↑ 返回关系图</Button>
        {edge ? <EdgeDetail edge={edge} index={index} evidence={evidence} loading={evidenceLoading} onSelect={selectNode} onClose={() => setEdgeId(null)} /> : <>
          {current && <div className={styles.selection}>
            <span>当前选择</span><strong>{current.label}</strong>
            <div><Button size="sm" variant="outline" disabled={!remaining || graph.capped} onClick={expand}>展开关联{remaining ? `（还有 ${remaining} 个对象）` : ''}</Button>
              <Button size="sm" variant="outline" disabled={current.id === root} onClick={() => onCenter(current.id)}>以它为中心</Button></div>
            {!adjacentEdges(index, current.id).length && <p>当前收录范围内尚未建立它的关系。</p>}
          </div>}
          {children}
        </>}
      </div>
    </div>
  </section>;
}

export function EdgeDetail({edge, index, evidence, loading, onSelect, onClose}: {
  edge: KnowledgeEdge; index: KnowledgeIndex; evidence: Map<string, Evidence>; loading: boolean;
  onSelect: (id: string) => void; onClose: () => void;
}) {
  return <article className={styles.edgeDetail} aria-label="关系的原文依据">
    <Button size="sm" variant="outline" onClick={onClose}>← 返回资料详情</Button>
    <h3>这条关系的依据</h3>
    <Button variant="ghost" onClick={() => onSelect(edge.subject)}>{index.nodes.get(edge.subject)?.label}</Button>
    <p className={styles.predicate}>↓ {relationLabels[edge.predicate]}</p>
    <Button variant="ghost" onClick={() => onSelect(edge.object)}>{index.nodes.get(edge.object)?.label}</Button>
    {edge.predicate === 'cites' && <p>“提及”只表示原文提到了对方，不代表其中的要求必然适用。</p>}
    {edge.predicate === 'enactedUnder' && <p>方向为“本文件 → 依据制定 → 依据文件”，来自原文的制定声明。具体条款和现行效力仍需核对。</p>}
    {edge.predicate === 'implements' && <p>标准原文明示用于配合实施或落实所列法律、规定的要求；不表示该法律强制采用这项标准。</p>}
    {edge.predicate === 'normativelyReferences' && <p>这条引用来自标准的“规范性引用文件”部分，具体使用范围仍需阅读正文。</p>}
    {edge.predicate === 'supersedes' && <p>这条替代关系来自原文的明确声明；不据此自动判断某个业务应采用哪个版本。</p>}
    {loading ? <p role="status">正在读取原文证据…</p> : edge.evidence.slice(0, 8).map(id => {
      const quote = evidence.get(id);
      const document = quote && index.nodes.get(quote.document);
      return quote && document ? <div className={styles.quote} key={id}><blockquote>{quote.quote}</blockquote><a href={sourceLink(document, quote.line)} target="_blank" rel="noopener noreferrer">{document.label} · 第 {quote.line} 行 ↗</a>{document.sourceUrl && <p><a href={document.sourceUrl} target="_blank" rel="noopener noreferrer">官方来源 ↗</a></p>}</div> : <p key={id}>证据暂未读取成功，请使用页面上的“重新加载”重试。</p>;
    })}
    {edge.evidence.length > 8 && <p>显示前 8 处依据，全部证据可在页面底部下载。</p>}
  </article>;
}
