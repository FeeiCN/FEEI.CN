export type EntityType = 'Document' | 'StandardSeries' | 'StandardVersion' | 'Clause';
export type RelationType = 'cites' | 'normativelyReferences' | 'supersedes' | 'hasVersion'
  | 'presents' | 'transcribes' | 'discusses' | 'includes' | 'isPartOf' | 'enactedUnder' | 'implements';
export type KnowledgeNode = {
  id: string;
  type: EntityType;
  label: string;
  identifier?: string;
  role?: 'source-text' | 'source-reader' | 'analysis' | 'topic-guide';
  sourceForm?: 'transcription' | 'outline' | 'excerpt';
  path?: string;
  sha256?: string;
  topic?: string;
  url?: string | null;
  sourceUrl?: string | null;
  series?: string;
  sources?: string[];
  pages?: string[];
  standard?: string;
  document?: string;
  number?: string;
  line?: number;
  preview?: string;
  sectionKind?: 'body' | 'appendix' | 'template';
};
export type KnowledgeEdge = {
  id: string;
  subject: string;
  predicate: RelationType;
  object: string;
  evidence: string[];
};
export type Evidence = {id: string; document: string; line: number; quote: string};
export type GraphPart = {sourceDigest: string; nodes: KnowledgeNode[]; edges: KnowledgeEdge[]};
export type KnowledgeGraph = GraphPart & {
  schemaVersion: number;
  scope: {indexedDocuments: number; clauseStandards: string[]};
  stats: {nodes: Record<EntityType, number>; relationships: Record<RelationType, number>; evidence: number};
};
export type KnowledgeIndex = {
  nodes: Map<string, KnowledgeNode>;
  outgoing: Map<string, KnowledgeEdge[]>;
  incoming: Map<string, KnowledgeEdge[]>;
};
export type QueryMode = 'browse' | 'impact' | 'missing' | 'clauses';

export const relationLabels: Record<RelationType, string> = {
  cites: '提及', normativelyReferences: '规范性引用', supersedes: '明确代替',
  hasVersion: '包含版本', presents: '提供阅读页', transcribes: '转写原文',
  discusses: '解读主题', includes: '包含原文', isPartOf: '属于版本',
  enactedUnder: '依据制定', implements: '落实要求',
};
export const legalRelationTypes: RelationType[] = ['enactedUnder', 'implements'];

export function legalRelationsFor(index: KnowledgeIndex, id: string, reverse = false): KnowledgeEdge[] {
  return (reverse ? index.incoming : index.outgoing).get(id)?.filter(edge => legalRelationTypes.includes(edge.predicate)) ?? [];
}

export function typeLabel(node: KnowledgeNode): string {
  if (node.type === 'StandardSeries') return '标准系列';
  if (node.type === 'StandardVersion') return '标准版本';
  if (node.type === 'Clause') return node.sectionKind === 'template' ? '附录模板章节' : '编号章节';
  return {analysis: '解读文章', 'topic-guide': '主题导读', 'source-reader': '标准阅读页', 'source-text': '原文材料'}[node.role ?? 'analysis'];
}

export function createIndex(parts: GraphPart[]): KnowledgeIndex {
  const index: KnowledgeIndex = {nodes: new Map(), outgoing: new Map(), incoming: new Map()};
  for (const part of parts) {
    for (const node of part.nodes) index.nodes.set(node.id, node);
    for (const edge of part.edges) {
      index.outgoing.set(edge.subject, [...(index.outgoing.get(edge.subject) ?? []), edge]);
      index.incoming.set(edge.object, [...(index.incoming.get(edge.object) ?? []), edge]);
    }
  }
  return index;
}

export function normalizeSearch(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\s/—–－_:-]+/g, '');
}

export function topicLabel(topic?: string): string {
  if (!topic || topic === '.') return '合规总览';
  return topic.split('/').map(part => part.replace(/^\d+-/, '')).join(' / ');
}

export function associatedIds(index: KnowledgeIndex, id: string): Set<string> {
  const found = new Set([id]);
  const queue = [id];
  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of index.outgoing.get(current) ?? []) {
      if (['includes', 'presents', 'transcribes', 'discusses'].includes(edge.predicate) && !found.has(edge.object)) {
        found.add(edge.object);
        queue.push(edge.object);
      }
    }
  }
  return found;
}

export function referencesFor(index: KnowledgeIndex, id: string): KnowledgeEdge[] {
  return [...associatedIds(index, id)].flatMap(current => index.outgoing.get(current) ?? [])
    .filter(edge => edge.predicate === 'cites' || edge.predicate === 'normativelyReferences');
}

export function citingEdges(index: KnowledgeIndex, id: string): KnowledgeEdge[] {
  const targets = new Set([id]);
  const node = index.nodes.get(id);
  if (node?.type === 'StandardVersion') {
    for (const page of node.pages ?? []) targets.add(page);
  }
  return [...targets].flatMap(target => index.incoming.get(target) ?? [])
    .filter(edge => edge.predicate === 'cites' || edge.predicate === 'normativelyReferences');
}

export function successorEdges(index: KnowledgeIndex, id: string): KnowledgeEdge[] {
  const edges: KnowledgeEdge[] = [];
  const seen = new Set([id]);
  const queue = [id];
  while (queue.length) {
    const current = queue.shift()!;
    for (const edge of index.incoming.get(current) ?? []) {
      if (edge.predicate === 'supersedes' && !seen.has(edge.subject)) {
        edges.push(edge);
        seen.add(edge.subject);
        queue.push(edge.subject);
      }
    }
  }
  return edges;
}

export function nodeTopics(index: KnowledgeIndex, node: KnowledgeNode): string[] {
  if (node.topic) return [node.topic];
  const direct = [...(node.sources ?? []), ...(node.pages ?? [])]
    .map(id => index.nodes.get(id)?.topic).filter((topic): topic is string => Boolean(topic));
  if (direct.length) return [...new Set(direct)];
  const topics = (index.incoming.get(node.id) ?? []).filter(edge => ['cites', 'normativelyReferences'].includes(edge.predicate))
    .flatMap(edge => {
      const source = index.nodes.get(edge.subject);
      if (!source) return [];
      return [source.topic, ...(source.sources ?? []).map(id => index.nodes.get(id)?.topic)];
    }).filter((topic): topic is string => Boolean(topic));
  return [...new Set(topics)];
}

export function selectNodes(index: KnowledgeIndex, options: {
  mode: QueryMode; query: string; topic: string; kind: string;
}): KnowledgeNode[] {
  const query = normalizeSearch(options.query);
  return [...index.nodes.values()].filter(node => {
    if (options.mode === 'clauses' && node.type !== 'Clause') return false;
    if (options.mode === 'impact' && (node.type !== 'StandardVersion' || !successorEdges(index, node.id).length)) return false;
    if (options.mode === 'missing' && (node.type !== 'StandardVersion' || node.sources?.length || !citingEdges(index, node.id).length)) return false;
    if (options.mode === 'browse' && (node.type === 'Clause' || node.role === 'source-text')) return false;
    if (options.kind && node.type !== options.kind && node.role !== options.kind) return false;
    if (options.topic && !nodeTopics(index, node).some(topic => topic === options.topic || topic.startsWith(options.topic + '/'))) return false;
    const parent = node.standard ? index.nodes.get(node.standard) : undefined;
    const text = [node.label, node.identifier, node.preview, parent?.label, ...nodeTopics(index, node).map(topicLabel)].filter(Boolean).join(' ');
    return !query || normalizeSearch(text).includes(query);
  }).sort((a, b) => {
    const rank = (node: KnowledgeNode) => {
      if (options.mode === 'impact' || options.mode === 'missing') return -citingEdges(index, node.id).length;
      return node.type === 'Document' ? 0 : node.sources?.length ? 1 : 2;
    };
    return rank(a) - rank(b) || a.label.localeCompare(b.label, 'zh-Hans-CN', {numeric: true});
  });
}

export function sourceLink(node: KnowledgeNode, line?: number): string | undefined {
  if (!node.path) return undefined;
  return 'https://github.com/FeeiCN/FEEI.CN/blob/main/'
    + node.path.split('/').map(encodeURIComponent).join('/') + (line ? `#L${line}` : '');
}

export function pageFor(index: KnowledgeIndex, node: KnowledgeNode): KnowledgeNode | undefined {
  if (node.url && node.role !== 'source-text') return node;
  const version = node.type === 'Clause' ? index.nodes.get(node.standard ?? '') : node;
  return (version?.pages ?? []).map(id => index.nodes.get(id)).find(page => page?.url);
}
