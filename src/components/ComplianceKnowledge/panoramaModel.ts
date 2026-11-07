import type {CoseLayoutOptions} from 'cytoscape';
import {legalRelationTypes, nodeTopics, normalizeSearch, topicLabel, type KnowledgeEdge, type KnowledgeIndex, type KnowledgeNode, type RelationType} from './model';

export type FileKind = 'law' | 'regulation' | 'standard' | 'foreign' | 'guide';
export const fileKindLabels: Record<FileKind, string> = {
  law: '中国法律', regulation: '法规与监管文件', standard: '标准', foreign: '境外文件', guide: '主题与解读资料',
};
export type CatalogEntry = {node: KnowledgeNode; kind: FileKind; topics: string[]; group: string; collected: boolean};
export type Catalog = {entries: CatalogEntry[]; edges: KnowledgeEdge[]; aliases: Map<string, string>};

export function fileKind(node: KnowledgeNode): FileKind {
  if (node.type === 'StandardVersion' || node.type === 'StandardSeries') return 'standard';
  if (node.topic?.startsWith('10-境外安全合规') && node.role !== 'topic-guide' && !['美国', '境外安全合规'].includes(node.label)) return 'foreign';
  if (/^中华人民共和国.+法$/.test(node.label)) return 'law';
  if (node.role !== 'topic-guide' && /(?:条例|办法|规定|细则|指引|通知|规则)(?:[（(].*?[）)])?$/.test(node.label)) return 'regulation';
  return 'guide';
}

export function buildCatalog(index: KnowledgeIndex): Catalog {
  const aliases = new Map<string, string>();
  const included = new Set<string>();
  for (const node of index.nodes.values()) {
    if (node.type === 'StandardVersion') {
      included.add(node.id);
      for (const id of [node.id, ...(node.pages ?? []), ...(node.sources ?? [])]) aliases.set(id, node.id);
    } else if (node.type === 'StandardSeries' && (index.incoming.get(node.id) ?? []).some(edge => ['cites', 'normativelyReferences'].includes(edge.predicate))) {
      included.add(node.id);
      aliases.set(node.id, node.id);
    }
  }
  for (const node of index.nodes.values()) {
    if (node.type === 'Document' && node.role !== 'source-text' && !aliases.has(node.id)) {
      included.add(node.id);
      aliases.set(node.id, node.id);
    }
  }
  for (const edges of index.outgoing.values()) for (const edge of edges) {
    if (edge.predicate === 'includes' && aliases.has(edge.subject) && !aliases.has(edge.object)) aliases.set(edge.object, aliases.get(edge.subject)!);
  }
  const entries = [...included].map(id => {
    const node = index.nodes.get(id)!;
    const topics = nodeTopics(index, node).sort();
    const collected = node.type === 'Document' || Boolean(node.sources?.length || node.pages?.length);
    return {node, kind: fileKind(node), topics, group: topics[0]?.split('/')[0] || '未归入主题的被引标准', collected};
  }).sort((a, b) => a.node.label.localeCompare(b.node.label, 'zh-CN', {numeric: true}));
  const grouped = new Map<string, KnowledgeEdge>();
  for (const edges of index.outgoing.values()) for (const edge of edges) {
    const subject = aliases.get(edge.subject);
    const object = aliases.get(edge.object);
    if (!subject || !object || subject === object || !['cites', 'normativelyReferences', 'supersedes', 'hasVersion', ...legalRelationTypes].includes(edge.predicate)) continue;
    const key = JSON.stringify([subject, edge.predicate, object]);
    const previous = grouped.get(key);
    grouped.set(key, previous ? {...previous, evidence: [...new Set([...previous.evidence, ...edge.evidence])]} : {...edge, subject, object});
  }
  return {entries, edges: [...grouped.values()].sort((a, b) => Number(legalRelationTypes.includes(b.predicate)) - Number(legalRelationTypes.includes(a.predicate))), aliases};
}

export function filterCatalog(catalog: Catalog, options: {query: string; kind: string; topic: string; extended: boolean}) {
  const query = normalizeSearch(options.query);
  return catalog.entries.filter(entry => (options.extended || entry.collected)
    && (!options.kind || options.kind === entry.kind)
    && (!options.topic || entry.group === options.topic)
    && (!query || normalizeSearch([entry.node.label, entry.node.identifier, ...entry.topics.map(topicLabel)].join(' ')).includes(query)));
}

export const coreRelationTypes: RelationType[] = [...legalRelationTypes, 'normativelyReferences', 'supersedes', 'hasVersion'];

const relationPriority = ['enactedUnder', 'implements', 'supersedes', 'normativelyReferences', 'hasVersion', 'cites'];

export function readableNeighborhood(entries: CatalogEntry[], edges: KnowledgeEdge[], root: string, page = 0, includeMentions = false) {
  const byId = new Map(entries.map(entry => [entry.node.id, entry]));
  const adjacent = new Map<string, KnowledgeEdge>();
  for (const edge of [...edges].sort((a, b) => relationPriority.indexOf(a.predicate) - relationPriority.indexOf(b.predicate) || a.id.localeCompare(b.id))) {
    if (!relationPriority.includes(edge.predicate) || edge.subject === edge.object || (edge.subject !== root && edge.object !== root)
      || !byId.has(edge.subject) || !byId.has(edge.object) || (!includeMentions && !coreRelationTypes.includes(edge.predicate))) continue;
    const neighbor = edge.subject === root ? edge.object : edge.subject;
    if (!adjacent.has(neighbor)) adjacent.set(neighbor, edge);
  }
  const all = [...adjacent.values()];
  const pages = Math.max(1, Math.ceil(all.length / 6));
  const actualPage = Math.min(Math.max(0, page), pages - 1);
  const shown = byId.has(root) ? all.slice(actualPage * 6, (actualPage + 1) * 6) : [];
  const nodes = byId.has(root) ? [byId.get(root)!, ...shown.map(edge => byId.get(edge.subject === root ? edge.object : edge.subject)!)] : [];
  return {entries: nodes, edges: shown, total: all.length, pages, page: actualPage};
}

export function panoramaNetwork(entries: CatalogEntry[], edges: KnowledgeEdge[]) {
  const neighbors = new Map(entries.map(entry => [entry.node.id, new Set<string>()]));
  const coreEdges = edges.filter(edge => coreRelationTypes.includes(edge.predicate)
    && edge.subject !== edge.object && neighbors.has(edge.subject) && neighbors.has(edge.object));
  for (const edge of coreEdges) {neighbors.get(edge.subject)!.add(edge.object); neighbors.get(edge.object)!.add(edge.subject);}
  const degrees = new Map([...neighbors].map(([id, adjacent]) => [id, adjacent.size]));
  const positions = new Map<string, {x: number; y: number}>();
  [...degrees.keys()].sort().forEach((id, i) => {
    const radius = Math.sqrt(i + 1) * 70;
    positions.set(id, {x: Math.cos(i * 2.399963) * radius, y: Math.sin(i * 2.399963) * radius});
  });
  return {positions, degrees, coreEdges, isolatedCount: [...degrees.values()].filter(degree => degree === 0).length};
}

export const panoramaForceLayout: CoseLayoutOptions = {
  name: 'cose', animate: true, refresh: 8, animationThreshold: 100, randomize: false,
  fit: true, padding: 45, componentSpacing: 75, nodeRepulsion: () => 12000,
  idealEdgeLength: () => 90, nodeOverlap: 20, gravity: .3,
  numIter: 500, initialTemp: 120, coolingFactor: .95, minTemp: 1,
};
