import {type KnowledgeEdge, type KnowledgeIndex, type KnowledgeNode, type RelationType} from './model';

export const NEIGHBOR_BATCH = 6;
export const GRAPH_NODE_LIMIT = 40;

const priority: Record<RelationType, number> = {
  enactedUnder: 0, implements: 1, supersedes: 0, normativelyReferences: 2, cites: 3, isPartOf: 4,
  transcribes: 4, presents: 5, discusses: 6, hasVersion: 7, includes: 8,
};

export function adjacentEdges(index: KnowledgeIndex, id: string): KnowledgeEdge[] {
  const unique = new Map([...(index.outgoing.get(id) ?? []), ...(index.incoming.get(id) ?? [])].map(edge => [edge.id, edge]));
  return [...unique.values()].filter(edge => index.nodes.has(edge.subject) && index.nodes.has(edge.object))
    .sort((a, b) => priority[a.predicate] - priority[b.predicate] || a.id.localeCompare(b.id));
}

export function neighborhood(index: KnowledgeIndex, root: string, budgets: Record<string, number>, limit = GRAPH_NODE_LIMIT): {
  nodes: KnowledgeNode[]; edges: KnowledgeEdge[]; remaining: Map<string, number>; capped: boolean;
} {
  if (!index.nodes.has(root)) return {nodes: [], edges: [], remaining: new Map(), capped: false};
  const visible = new Set([root]);
  const revealed = new Map<string, KnowledgeEdge>();
  for (const [id, budget] of [[root, budgets[root] ?? NEIGHBOR_BATCH], ...Object.entries(budgets).filter(([id]) => id !== root)] as [string, number][]) {
    if (!visible.has(id)) continue;
    const neighbors = new Set<string>();
    for (const edge of adjacentEdges(index, id)) {
      const neighbor = edge.subject === id ? edge.object : edge.subject;
      if (!neighbors.has(neighbor) && neighbors.size >= budget) continue;
      if (!visible.has(neighbor) && visible.size >= limit) continue;
      visible.add(neighbor);
      neighbors.add(neighbor);
      revealed.set(edge.id, edge);
    }
  }
  const groups = new Map<string, KnowledgeEdge>();
  for (const edge of revealed.values()) {
    const key = JSON.stringify([edge.subject, edge.predicate, edge.object]);
    const previous = groups.get(key);
    groups.set(key, previous ? {...previous, evidence: [...new Set([...previous.evidence, ...edge.evidence])]} : {...edge});
  }
  const remaining = new Map([...visible].map(id => [id, new Set(adjacentEdges(index, id)
    .flatMap(edge => [edge.subject, edge.object]).filter(other => !visible.has(other))).size]));
  return {nodes: [...visible].map(id => index.nodes.get(id)!), edges: [...groups.values()], remaining, capped: visible.size >= limit};
}

export function graphLabel(node: KnowledgeNode): string {
  if (node.identifier) {
    const title = node.label.replace(node.identifier, '').replace(/^\s*信息安全技术\s*/, '').trim();
    return node.identifier + (title ? '\n' + (title.length > 18 ? title.slice(0, 17) + '…' : title) : '');
  }
  return node.label.length > 28 ? node.label.slice(0, 27) + '…' : node.label;
}
