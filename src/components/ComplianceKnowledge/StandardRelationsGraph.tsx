import {useEffect, useMemo, useRef, useState} from 'react';
import {Button} from '@chakra-ui/react';
import Link from '@docusaurus/Link';
import {useColorMode} from '@docusaurus/theme-common';
import type {Core} from 'cytoscape';
import {relationLabels} from './model';
import type {CatalogEntry} from './panoramaModel';
import {standardGraphPage, type StandardRelation, type StandardRelationGroups} from './standardRelationsModel';
import StandardName from './StandardName';
import styles from './standardRelations.module.css';

type Props = {
  current: CatalogEntry; groups: StandardRelationGroups;
  linkFor: (entry: CatalogEntry) => string;
  quotesFor: (row: StandardRelation) => string[];
  onEvidence: (row: StandardRelation) => void;
};

export default function StandardRelationsGraph({current, groups, linkFor, quotesFor, onEvidence}: Props) {
  const {colorMode} = useColorMode();
  const [page, setPage] = useState(0);
  const [error, setError] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const graph = useMemo(() => standardGraphPage(groups, page), [groups, page]);

  useEffect(() => {
    const board = boardRef.current;
    const container = canvasRef.current;
    if (!board || !container || !graph.rows.length) return;
    let disposed = false;
    let cy: Core | undefined;
    let observer: ResizeObserver | undefined;
    setError(false);
    import('cytoscape').then(({default: cytoscape}) => {
      if (disposed) return;
      const line = colorMode === 'dark' ? '#62666e' : '#c3c8ce';
      cy = cytoscape({container, elements: [], layout: {name: 'preset'}, zoom: 1,
        pan: {x: 0, y: 0}, userZoomingEnabled: false, userPanningEnabled: false,
        autoungrabify: true, autounselectify: true, boxSelectionEnabled: false,
        style: [
          {selector: 'node', style: {width: 1, height: 1, opacity: 0}},
          {selector: 'edge', style: {width: 1, 'line-color': line, 'target-arrow-color': line,
            'target-arrow-shape': 'triangle', 'curve-style': 'taxi', 'taxi-direction': 'horizontal',
            'taxi-turn': '20px', 'taxi-turn-min-distance': 4, 'taxi-radius': 3, 'arrow-scale': .7}},
          {selector: 'edge[incoming]', style: {'taxi-turn': '-20px'}},
        ]});
      const draw = () => {
        if (!cy || disposed) return;
        const bounds = board.getBoundingClientRect();
        const root = board.querySelector<HTMLElement>('[data-graph-root]')!.getBoundingClientRect();
        const mobile = bounds.width < 520;
        const nodes = [{data: {id: current.node.id}, position: mobile
          ? {x: 8, y: root.bottom - bounds.top + 3}
          : {x: root.right - bounds.left + 3, y: root.top - bounds.top + root.height / 2}}];
        board.querySelectorAll<HTMLElement>('[data-graph-neighbor]').forEach(card => {
          const box = card.getBoundingClientRect();
          nodes.push({data: {id: card.dataset.graphNeighbor!}, position: {x: box.left - bounds.left - 5, y: box.top - bounds.top + box.height / 2}});
        });
        cy.elements().remove();
        cy.add([...nodes, ...graph.rows.map(({edge, outgoing}) => ({data: {id: edge.id, source: edge.subject, target: edge.object, ...(!outgoing ? {incoming: true} : {})}}))]);
        cy.edges().style('curve-style', mobile ? 'straight' : 'taxi');
        cy.resize();
      };
      observer = new ResizeObserver(draw);
      observer.observe(board);
      board.querySelectorAll<HTMLElement>('[data-graph-root], [data-graph-neighbor]').forEach(card => observer!.observe(card));
      draw();
    }).catch(() => {if (!disposed) setError(true);});
    return () => {disposed = true; observer?.disconnect(); cy?.destroy();};
  }, [current.node.id, graph, colorMode]);

  return <div className={styles.localGraph}>
    <div ref={boardRef} className={styles.graphBoard} aria-label="本标准的一层关系图" style={{gridTemplateRows: `repeat(${Math.max(1, graph.rows.length)}, auto)`}}>
      <div ref={canvasRef} className={styles.graphCanvas} aria-hidden="true" />
      <div className={styles.graphRoot} data-graph-root style={{gridRow: `1 / span ${Math.max(1, graph.rows.length)}`}}><span className={styles.graphCurrent}>本标准</span><StandardName node={current.node} /></div>
      {graph.rows.map((row, i) => <div key={row.edge.id} className={styles.graphBranch} style={{gridRow: i + 1}}>
        <div className={styles.graphEdgeLabel} aria-label={`${row.outgoing ? current.node.identifier : row.other.node.identifier} ${relationLabels[row.edge.predicate]} ${row.outgoing ? row.other.node.identifier : current.node.identifier}`}>
          <span><span aria-hidden="true">{row.outgoing ? '→' : '←'}</span> {relationLabels[row.edge.predicate]}</span>
          {row.other.node.type === 'StandardSeries' && <small>未注年份</small>}
        </div>
        <div className={styles.graphCard} data-graph-neighbor={row.other.node.id}>
          <Link to={linkFor(row.other)}><StandardName node={row.other.node} quotes={quotesFor(row)} /></Link>
          <Button size="xs" variant="ghost" onClick={() => onEvidence(row)} aria-label={`查看 ${row.other.node.identifier} 的关系依据`}>依据</Button>
        </div>
      </div>)}
    </div>
    {!graph.total && <p className={styles.empty}>暂未收录本标准与其他标准的直接关系。</p>}
    {error && <p className={styles.error} role="alert">连线暂未绘制成功，可通过文字和依据核对。</p>}
    <div className={styles.graphFooter}>
      <span>一层关联<span className={styles.separator}>·</span>{graph.total} 份<span className={styles.graphFootnote}> · 每份展示一条主要关系</span></span>
      {graph.pages > 1 && <nav className={styles.graphPaging} aria-label="本标准关联图分页">
        <Button size="xs" variant="ghost" disabled={graph.page === 0} onClick={() => setPage(graph.page - 1)} aria-label="上一组关联"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m9.5 4-4 4 4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg></Button>
        <span>{graph.page + 1}<span className={styles.separator}>/</span>{graph.pages}</span>
        <Button size="xs" variant="ghost" disabled={graph.page + 1 >= graph.pages} onClick={() => setPage(graph.page + 1)} aria-label="下一组关联"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6.5 4 4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg></Button>
      </nav>}
    </div>
  </div>;
}
