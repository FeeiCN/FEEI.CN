import {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {Button, Input, NativeSelect} from '@chakra-ui/react';
import {useColorMode} from '@docusaurus/theme-common';
import type {Core, Layouts, StylesheetJson} from 'cytoscape';
import {EdgeDetail} from './KnowledgeGraph';
import ReadableGraph from './ReadableGraph';
import {graphLabel} from './graphModel';
import {buildCatalog, coreRelationTypes, fileKindLabels, filterCatalog, panoramaForceLayout, panoramaNetwork, type FileKind} from './panoramaModel';
import {legalRelationTypes, relationLabels, topicLabel, type Evidence, type KnowledgeIndex} from './model';
import styles from './panorama.module.css';

type Props = {
  index: KnowledgeIndex; selected: string; evidence: Map<string, Evidence>; evidenceLoading: boolean;
  query: string; kind: string; topic: string; extended: boolean;
  onSelect: (id: string) => void; onFilter: (values: Record<string, string>) => void;
  onExplore: (id: string) => void; children: ReactNode;
};

export default function PanoramaGraph({index, selected, evidence, evidenceLoading, query, kind, topic, extended, onSelect, onFilter, onExplore, children}: Props) {
  const {colorMode} = useColorMode();
  const catalog = useMemo(() => buildCatalog(index), [index]);
  const [overview, setOverview] = useState(false);
  const [centerRequest, setCenterRequest] = useState('');
  const entries = useMemo(() => filterCatalog(catalog, {query, kind, topic, extended}), [catalog, query, kind, topic, extended]);
  const visibleIds = useMemo(() => new Set(entries.map(entry => entry.node.id)), [entries]);
  const edges = useMemo(() => catalog.edges.filter(edge => visibleIds.has(edge.subject) && visibleIds.has(edge.object)), [catalog, visibleIds]);
  const network = useMemo(() => panoramaNetwork(entries, edges), [entries, edges]);
  const selectedId = catalog.aliases.get(selected) ?? selected;
  const [edgeId, setEdgeId] = useState<string | null>(null);
  const edge = catalog.edges.find(item => item.id === edgeId);
  const [showLines, setShowLines] = useState(false);
  const [showCoreLines, setShowCoreLines] = useState(true);
  const legalEdges = useMemo(() => edges.filter(edge => legalRelationTypes.includes(edge.predicate)), [edges]);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  const canvasRef = useRef<HTMLDivElement>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const refreshLabels = useRef<() => void>(() => {});
  const topics = useMemo(() => [...new Set(catalog.entries.filter(entry => extended || entry.collected).map(entry => entry.group))].sort(), [catalog, extended]);
  const counts = useMemo(() => Object.fromEntries(Object.keys(fileKindLabels).map(key => [key, entries.filter(entry => entry.kind === key).length])), [entries]);
  const showInspector = () => {if (!overview || window.innerWidth <= 1000) requestAnimationFrame(() => inspectorRef.current?.scrollIntoView({block: 'start', behavior: 'instant'}));};
  const showMap = () => document.getElementById('compliance-map')?.scrollIntoView({block: 'start', behavior: 'instant'});
  const selectNode = (id: string) => {setEdgeId(null); onSelect(id); showInspector();};
  const selectEdge = (id: string) => {
    const item = catalog.edges.find(edge => edge.id === id);
    if (!item) return;
    setEdgeId(id);
    onSelect(item.subject);
    showInspector();
  };
  const callbacks = useRef({selectNode, selectEdge});
  callbacks.current = {selectNode, selectEdge};

  useEffect(() => {setPage(1); setEdgeId(null); setCenterRequest('');}, [query, kind, topic, extended]);

  useEffect(() => {
    const container = canvasRef.current;
    if (!overview || !container || !entries.length) return;
    let disposed = false;
    let cy: Core | undefined;
    let observer: ResizeObserver | undefined;
    let force: Layouts | undefined;
    let graphContainer: HTMLDivElement | undefined;
    let settled = false;
    setStatus('loading');
    import('cytoscape').then(({default: cytoscape}) => {
      if (disposed) return;
      graphContainer = document.createElement('div');
      Object.assign(graphContainer.style, {width: '100%', height: '100%'});
      container.appendChild(graphContainer);
      const dark = colorMode === 'dark';
      const text = dark ? '#e5e7eb' : '#1f2937';
      const colors: Record<FileKind, string> = dark
        ? {law: '#f87171', regulation: '#fb923c', standard: '#60a5fa', foreign: '#c084fc', guide: '#94a3b8'}
        : {law: '#b91c1c', regulation: '#c2410c', standard: '#2563eb', foreign: '#7e22ce', guide: '#64748b'};
      const style: StylesheetJson = [
        {selector: 'node.file', style: {
          'label': 'data(label)', 'shape': 'ellipse', 'width': 'data(size)', 'height': 'data(size)',
          'background-color': 'data(color)', 'border-width': 1, 'border-color': dark ? '#cbd5e1' : '#ffffff',
          'font-size': 13, 'font-family': 'sans-serif', 'color': text, 'text-valign': 'bottom', 'text-margin-y': 8,
          'text-wrap': 'wrap', 'text-max-width': '105px', 'text-overflow-wrap': 'anywhere', 'min-zoomed-font-size': 10,
        }},
        {selector: 'node.file[kind = "law"]', style: {'shape': 'round-rectangle'}},
        {selector: 'node.file[kind = "regulation"]', style: {'shape': 'diamond'}},
        {selector: 'node.file[kind = "foreign"]', style: {'shape': 'hexagon'}},
        {selector: 'node.file[kind = "guide"]', style: {'shape': 'round-rectangle'}},
        {selector: 'node.file[uncollected = 1]', style: {'background-opacity': .6, 'border-style': 'dashed'}},
        {selector: 'node.hub', style: {'label': 'data(shortLabel)', 'font-weight': 600, 'min-zoomed-font-size': 0, 'text-background-color': dark ? '#111827' : '#ffffff', 'text-background-opacity': .9, 'text-background-padding': '2px'}},
        {selector: '.dimmed', style: {'opacity': .15}},
        {selector: 'node.chosen', style: {'border-width': 4, 'border-color': dark ? '#ffffff' : '#111827', 'min-zoomed-font-size': 0, 'z-index': 5}},
        {selector: 'edge', style: {
          'display': 'none', 'width': 1.5, 'curve-style': 'bezier', 'control-point-step-size': 65,
          'line-color': dark ? '#94a3b8' : '#64748b', 'target-arrow-color': dark ? '#94a3b8' : '#64748b', 'target-arrow-shape': 'triangle',
          'label': 'data(label)', 'font-size': 11, 'color': text, 'min-zoomed-font-size': 10,
          'text-background-color': dark ? '#111827' : '#ffffff', 'text-background-opacity': .95, 'text-background-padding': '3px',
        }},
        {selector: 'edge.visible', style: {'display': 'element'}},
        {selector: 'edge[predicate = "supersedes"]', style: {'line-color': '#d97706', 'target-arrow-color': '#d97706', 'width': 2.5}},
        {selector: 'edge[predicate = "enactedUnder"]', style: {'line-color': dark ? '#c084fc' : '#7e22ce', 'target-arrow-color': dark ? '#c084fc' : '#7e22ce', 'width': 2.5}},
        {selector: 'edge[predicate = "implements"]', style: {'line-color': dark ? '#34d399' : '#047857', 'target-arrow-color': dark ? '#34d399' : '#047857', 'width': 2.5}},
        {selector: 'edge.chosen', style: {'line-color': '#2563eb', 'target-arrow-color': '#2563eb', 'width': 4}},
      ];
      cy = cytoscape({container: graphContainer, style, elements: [
        ...entries.map(entry => ({data: {id: entry.node.id, label: graphLabel(entry.node), shortLabel: entry.node.identifier || entry.node.label.replace(/^中华人民共和国/, ''), size: 18 + Math.min(28, Math.log2((network.degrees.get(entry.node.id) ?? 0) + 1) * 5), color: colors[entry.kind], kind: entry.kind, uncollected: entry.collected ? 0 : 1}, position: network.positions.get(entry.node.id), classes: 'file'})),
        ...edges.map(item => ({data: {id: item.id, source: item.subject, target: item.object, label: relationLabels[item.predicate], predicate: item.predicate}, classes: coreRelationTypes.includes(item.predicate) ? 'core' : ''})),
      ], layout: {name: 'preset', fit: false}, minZoom: .025, maxZoom: 3, wheelSensitivity: .2, autounselectify: true});
      cyRef.current = cy;
      const candidates = cy.nodes().sort((a, b) => (network.degrees.get(b.id()) ?? 0) - (network.degrees.get(a.id()) ?? 0) || a.id().localeCompare(b.id()));
      const labelScale = () => {
        if (!cy || disposed) return;
        const shown: {x: number; y: number}[] = [];
        const zoom = cy.zoom();
        cy.batch(() => {
          cy!.nodes('.hub').removeClass('hub').removeStyle('font-size text-max-width');
          for (const node of [...cy!.nodes('.chosen'), ...candidates]) {
            if (shown.length >= (cy!.width() < 480 ? 4 : 8)) break;
            if (!node.hasClass('chosen') && ((network.degrees.get(node.id()) ?? 0) < 3 || node.hasClass('dimmed'))) continue;
            const p = node.renderedPosition();
            if (p.x < 15 || p.y < 15 || p.x > cy!.width() - 15 || p.y > cy!.height() - 55 || shown.some(other => Math.abs(other.x - p.x) < 145 && Math.abs(other.y - p.y) < 70)) continue;
            shown.push(p);
            node.addClass('hub').style({'font-size': Math.max(13, 11 / zoom), 'text-max-width': 125 / zoom});
          }
        });
      };
      refreshLabels.current = labelScale;
      cy.on('zoom', labelScale);
      cy.on('pan', labelScale);
      cy.on('tap', 'node.file', event => callbacks.current.selectNode(event.target.id()));
      cy.on('tap', 'edge', event => callbacks.current.selectEdge(event.target.id()));
      observer = new ResizeObserver(() => {cy?.resize(); if (settled) cy?.fit(undefined, 45); labelScale();});
      observer.observe(container);
      force = cy.nodes().union(cy.edges('.core')).layout({...panoramaForceLayout, stop: () => {
        if (disposed) return;
        settled = true;
        labelScale();
        setStatus('ready');
      }});
      force.run();
    }).catch(() => {if (!disposed) setStatus('error');});
    return () => {
      disposed = true;
      observer?.disconnect();
      force?.stop();
      graphContainer?.remove();
      // CoSE 在 stop 后仍有一帧收尾；独立容器避免旧实例影响新图。
      if (cy && !settled) requestAnimationFrame(() => cy?.destroy());
      else cy?.destroy();
      cyRef.current = null;
      refreshLabels.current = () => {};
    };
  }, [entries, edges, network, colorMode, retry, overview]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || status !== 'ready') return;
    cy.batch(() => {
      cy.elements().removeClass('dimmed chosen linked visible');
      if (showLines) cy.edges().addClass('visible');
      else if (showCoreLines) cy.edges('.core').addClass('visible');
      const node = cy.getElementById(selectedId);
      if (node.length) {
        const adjacent = node.connectedEdges();
        const neighbors = adjacent.connectedNodes();
        cy.nodes('.file').not(neighbors).not(node).addClass('dimmed');
        node.addClass('chosen');
        neighbors.addClass('linked');
        adjacent.addClass('visible');
        cy.edges('.visible').not(adjacent).addClass('dimmed');
      }
      if (edgeId) cy.getElementById(edgeId).addClass('chosen visible');
    });
    refreshLabels.current();
  }, [selectedId, edgeId, showLines, showCoreLines, status, entries]);

  const focusNode = (id: string) => {
    const cy = cyRef.current;
    const node = cy?.getElementById(id);
    if (cy && node?.length) {cy.fit(node.closedNeighborhood(), 65); if (cy.zoom() > 1.15) {cy.zoom(1.15); cy.center(node);}}
  };
  const zoom = (factor: number) => {
    const cy = cyRef.current;
    if (cy) cy.zoom({level: Math.max(cy.minZoom(), Math.min(cy.maxZoom(), cy.zoom() * factor)), renderedPosition: {x: cy.width() / 2, y: cy.height() / 2}});
  };
  const total = catalog.entries.filter(entry => extended || entry.collected).length;
  const pages = Math.max(1, Math.ceil(entries.length / 15));
  const actualPage = Math.min(page, pages);
  const selectedEntry = (overview ? entries : catalog.entries).find(entry => entry.node.id === selectedId);
  const detailEdges = overview ? edges : catalog.edges;
  const example = ['standard:gb-t-39204-2022', 'document:cii-security-protection', 'document:cybersecurity-law'];
  const showExample = example.every(id => visibleIds.has(id))
    && legalEdges.some(edge => edge.subject === example[0] && edge.object === example[1] && edge.predicate === 'implements')
    && legalEdges.some(edge => edge.subject === example[1] && edge.object === example[2] && edge.predicate === 'enactedUnder');

  return <section className={styles.explorer} aria-label="合规全景图">
    <h2>看懂法律、规定与标准怎样关联</h2>
    <p className={styles.hint}>从一份文件出发，读清名称和关系，再沿连线继续查。所有关系都有原文依据；目录仅用于检索。</p>
    <div className={styles.filters}>
      <div><label htmlFor="panorama-query">搜索文件</label><Input id="panorama-query" value={query} placeholder="个人信息保护法、数据出境、GB/T 35273" onChange={event => onFilter({oq: event.target.value})} /></div>
      <div><label htmlFor="panorama-kind">文件类别</label><NativeSelect.Root><NativeSelect.Field id="panorama-kind" value={kind} onChange={event => onFilter({okind: event.target.value})}><option value="">全部类别</option>{Object.entries(fileKindLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</NativeSelect.Field><NativeSelect.Indicator /></NativeSelect.Root></div>
      <div><label htmlFor="panorama-topic">按目录筛选</label><NativeSelect.Root><NativeSelect.Field id="panorama-topic" value={topic} onChange={event => onFilter({otopic: event.target.value})}><option value="">全部目录</option>{topics.map(value => <option key={value} value={value}>{topicLabel(value)}</option>)}</NativeSelect.Field><NativeSelect.Indicator /></NativeSelect.Root></div>
      <div><label htmlFor="panorama-scope">收录范围</label><NativeSelect.Root><NativeSelect.Field id="panorama-scope" value={extended ? 'extended' : ''} onChange={event => onFilter({oscope: event.target.value})}><option value="">全部站内资料</option><option value="extended">含仅被引用的标准</option></NativeSelect.Field><NativeSelect.Indicator /></NativeSelect.Root></div>
      <Button variant="outline" onClick={() => {onFilter({oq: '', okind: '', otopic: '', oscope: ''}); setShowLines(false); setShowCoreLines(true);}}>重置筛选</Button>
    </div>
    <p className={styles.count} aria-live="polite">检索到 {entries.length} / {total} 份文件。{overview && <>当前范围有 {network.coreEdges.length} 条核心关系，{network.isolatedCount} 份文件暂未连接核心关系。</>}</p>
    <div className={styles.viewSwitch} aria-label="关系图阅读方式"><Button variant="outline" aria-pressed={!overview} onClick={() => setOverview(false)}>逐份读关系</Button><Button variant="outline" aria-pressed={overview} onClick={() => setOverview(true)}>全站总览 · {total} 份</Button><span>{overview ? '总览用于看分布；切回“逐份读关系”可读清文件名称与依据。' : '每次最多展开 6 个直接关联文件，支持翻页与继续展开。'}</span></div>
    {overview && <div className={styles.legend} aria-label="全景图图例">{Object.entries(fileKindLabels).map(([key, label]) => <span key={key} data-kind={key}>{label} <strong>{counts[key]}</strong></span>)}</div>}
    {overview && <div className={styles.legalOverview}>
      <p>当前范围内有 <strong>{legalEdges.length}</strong> 条已核对的制定与落实关系。<span data-relation="enactedUnder">紫色线：依据制定</span>；<span data-relation="implements">绿色线：落实要求</span>。</p>
      {showExample && <div className={styles.example} aria-label="法律规定与标准的真实关系示例"><span>看一个例子：</span><Button variant="ghost" onClick={() => {selectNode(example[0]); focusNode(example[0]);}}>GB/T 39204—2022</Button><span>→ 落实要求 →</span><Button variant="ghost" onClick={() => {selectNode(example[1]); focusNode(example[1]);}}>关键信息基础设施安全保护条例</Button><span>→ 依据制定 →</span><Button variant="ghost" onClick={() => {selectNode(example[2]); focusNode(example[2]);}}>网络安全法</Button></div>}
    </div>}
    {!entries.length ? <div className={styles.empty}><h3>没有匹配的文件</h3><p>可以缩短关键词，或清除类别和目录筛选。</p><Button variant="outline" onClick={() => onFilter({oq: '', okind: '', otopic: ''})}>清除筛选</Button></div> : <div className={overview ? styles.workspace : styles.readableWorkspace}>
      <div id="compliance-map" className={styles.mapAnchor}>
        {!overview && <ReadableGraph catalog={catalog} matches={entries} extended={extended} selected={selectedId} requestedCenter={centerRequest} onSelect={selectNode} onCenter={id => {setEdgeId(null); onSelect(id);}} onEdge={item => selectEdge(item.id)} />}
        {overview && <>
        <div className={styles.board}>
          <div className={styles.toolbar} aria-label="全景图操作"><Button size="sm" variant="outline" aria-label="放大全景图" onClick={() => zoom(1.5)}>＋</Button><Button size="sm" variant="outline" aria-label="缩小全景图" onClick={() => zoom(1 / 1.5)}>−</Button><Button size="sm" variant="outline" onClick={() => cyRef.current?.fit(undefined, 45)}>看全图</Button><Button size="sm" variant="outline" disabled={!selectedEntry || status !== 'ready'} onClick={() => focusNode(selectedId)}>查看选中关联</Button><Button size="sm" variant="outline" aria-pressed={showCoreLines} onClick={() => {setShowCoreLines(value => !value); setShowLines(false);}}>核心关系</Button><Button size="sm" variant="outline" aria-pressed={showLines} onClick={() => setShowLines(value => !value)}>{showLines ? '收起全部连线' : '显示全部连线'}</Button></div>
          <div ref={canvasRef} className={styles.canvas} role="group" tabIndex={0} aria-label="按真实关系自动布局的全部文件；也可使用下方文件列表" onKeyDown={event => {
            if (['+', '=', '-', '0'].includes(event.key)) {event.preventDefault(); if (event.key === '0') cyRef.current?.fit(undefined, 55); else zoom(event.key === '-' ? 1 / 1.5 : 1.5);}
          }} />
          {status === 'loading' && <p role="status">正在按真实关系排列文件…</p>}
          {status === 'error' && <p role="alert">图谱暂时无法绘制，可使用下方文件列表。<Button variant="outline" onClick={() => setRetry(value => value + 1)}>重试绘制</Button></p>}
          <p className={styles.mapNote}>核心关系包括依据制定、落实要求、规范性引用和版本关系。距离远近仅用于排版，不表示法律效力或适用性。</p>
        </div>
        </>}
        <details className={styles.list}><summary>按名称查找图中的全部文件（{entries.length} 项）</summary>
          <ul>{entries.slice((actualPage - 1) * 15, actualPage * 15).map(entry => <li key={entry.node.id}><Button variant="ghost" aria-pressed={selectedId === entry.node.id && !edge} onClick={() => {if (overview) {selectNode(entry.node.id); requestAnimationFrame(() => focusNode(entry.node.id));} else {setCenterRequest(entry.node.id); setEdgeId(null); onSelect(entry.node.id); showMap();}}}><span>{fileKindLabels[entry.kind]}{entry.node.type === 'StandardSeries' ? ' · 未注年份' : ''}{!entry.collected ? ' · 仅被引用' : ''}</span><strong>{entry.node.label}</strong></Button></li>)}</ul>
          <nav aria-label="全景文件列表分页"><Button variant="outline" disabled={actualPage === 1} onClick={() => setPage(value => value - 1)}>上一页</Button><span>{actualPage} / {pages}</span><Button variant="outline" disabled={actualPage === pages} onClick={() => setPage(value => value + 1)}>下一页</Button></nav>
        </details>
      </div>
      <div ref={inspectorRef} className={styles.inspector} aria-label="全景图详情">
        <Button className={overview ? styles.returnMap : styles.returnReadable} variant="outline" size="sm" onClick={showMap}>↑ 返回关系图</Button>
        {edge ? <EdgeDetail edge={edge} index={index} evidence={evidence} loading={evidenceLoading} onSelect={selectNode} onClose={() => setEdgeId(null)} /> : selectedEntry ? <>
          <div className={styles.selection}><span>{fileKindLabels[selectedEntry.kind]}{selectedEntry.node.type === 'StandardSeries' ? ' · 未注年份' : ''}{!selectedEntry.collected ? ' · 仅被引用' : ''}</span><h3>{selectedEntry.node.label}</h3><p>所在目录：{selectedEntry.topics.map(topicLabel).join('、') || '暂无目录信息'}</p><Button variant="outline" onClick={() => onExplore(selectedId)}>围绕这份文件查关联 →</Button></div>
          {children}
        </> : overview && <div className={styles.welcome}><h3>总览看分布，逐份读关系</h3><p>选择图中的文件，再切到“逐份读关系”查看完整名称和带文字的连线。</p><p>目录只用于筛选；未画出的关系不代表不存在。</p></div>}
        {selectedEntry && <details className={styles.relations}><summary>用列表核对选中文件的关系（{detailEdges.filter(item => item.subject === selectedId || item.object === selectedId).length} 条）</summary>{detailEdges.filter(item => item.subject === selectedId || item.object === selectedId).map(item => <Button key={item.id} variant="outline" aria-pressed={edge?.id === item.id} onClick={() => selectEdge(item.id)}>{index.nodes.get(item.subject)?.label} → {relationLabels[item.predicate]} → {index.nodes.get(item.object)?.label}</Button>)}<p>列出已收录的原文关系，可进入“查关联”继续核对。</p></details>}
      </div>
    </div>}
  </section>;
}
