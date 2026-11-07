import {normalizeSearch, type KnowledgeIndex, type KnowledgeNode} from './model';
import type {Catalog, CatalogEntry} from './panoramaModel';

export function standardForPage(index: KnowledgeIndex, catalog: Catalog, permalink: string, baseUrl = '/') {
  let pathname = permalink.split(/[?#]/)[0].replace(/\/$/, '') || '/';
  if (baseUrl !== '/' && pathname.startsWith(baseUrl)) pathname = '/' + pathname.slice(baseUrl.length);
  const document = [...index.nodes.values()].find(node => node.url?.replace(/\/$/, '') === pathname);
  const id = document && catalog.aliases.get(document.id);
  return catalog.entries.find(entry => entry.node.id === id && entry.node.type === 'StandardVersion');
}

export function standardRelations(catalog: Catalog, current: CatalogEntry) {
  const standards = new Map(catalog.entries.filter(entry => entry.kind === 'standard').map(entry => [entry.node.id, entry]));
  const id = current.node.id;
  const priority = ['supersedes', 'normativelyReferences', 'cites'];
  const pairs = new Set<string>();
  const rows = [];
  for (const edge of [...catalog.edges].sort((a, b) => priority.indexOf(a.predicate) - priority.indexOf(b.predicate))) {
    if (!priority.includes(edge.predicate) || (edge.subject !== id && edge.object !== id)) continue;
    const other = standards.get(edge.subject === id ? edge.object : edge.subject);
    if (!other || other.node.id === id) continue;
    const key = JSON.stringify([edge.subject, edge.object, edge.predicate === 'supersedes' ? 'version' : 'reference']);
    if (pairs.has(key)) continue;
    pairs.add(key);
    rows.push({edge, other, outgoing: edge.subject === id});
  }
  rows.sort((a, b) => Number(b.edge.predicate === 'normativelyReferences') - Number(a.edge.predicate === 'normativelyReferences')
    || a.other.node.label.localeCompare(b.other.node.label, 'zh-CN', {numeric: true}));
  return {
    outgoing: rows.filter(row => row.outgoing && row.edge.predicate !== 'supersedes'),
    incoming: rows.filter(row => !row.outgoing && row.edge.predicate !== 'supersedes'),
    versions: rows.filter(row => row.edge.predicate === 'supersedes'),
  };
}

export type StandardRelation = ReturnType<typeof standardRelations>['outgoing'][number];
export type StandardRelationGroups = ReturnType<typeof standardRelations>;

const standardNumber = /(?:GB(?:\/[TZ])?|G[MA]\/T)\s*\d[\d.]*(?:\s*[-—–－]\s*\d{4})?/gi;

export function standardDisplayName(node: KnowledgeNode, quotes: string[] = []) {
  const identifier = node.identifier ?? node.label.match(standardNumber)?.[0] ?? node.label;
  const ownNumber = [...node.label.matchAll(standardNumber)][0];
  const ownTitle = ownNumber?.index === 0 ? node.label.slice(ownNumber[0].length).trim() : '';
  if (ownTitle) return {identifier, title: ownTitle};
  for (const quote of quotes) for (const line of quote.split('\n')) {
    const matches = [...line.matchAll(standardNumber)];
    for (const match of matches) {
      if (normalizeSearch(match[0]) !== normalizeSearch(identifier)) continue;
      const tail = line.slice(match.index! + match[0].length);
      const book = tail.match(/^\s*《([^》]+)》/);
      if (book) return {identifier, title: book[1]};
      if (matches.length === 1 && /^\s*(?:[-*•]\s*)?$/.test(line.slice(0, match.index))
        && /^\s+[\u3400-\u9fff]/.test(tail) && !/[，。；：]/.test(tail) && tail.trim().length <= 160) {
        return {identifier, title: tail.trim()};
      }
    }
  }
  return {identifier, title: ''};
}

export function standardGraphPage(groups: StandardRelationGroups, page = 0) {
  const neighbors = new Map<string, StandardRelation>();
  const rows = [...groups.versions, ...groups.outgoing, ...groups.incoming]
    .sort((a, b) => ['supersedes', 'normativelyReferences', 'cites'].indexOf(a.edge.predicate)
      - ['supersedes', 'normativelyReferences', 'cites'].indexOf(b.edge.predicate));
  for (const row of rows) if (!neighbors.has(row.other.node.id)) neighbors.set(row.other.node.id, row);
  const all = [...neighbors.values()];
  const pages = Math.max(1, Math.ceil(all.length / 4));
  const actualPage = Math.min(Math.max(0, page), pages - 1);
  return {rows: all.slice(actualPage * 4, actualPage * 4 + 4), total: all.length, pages, page: actualPage};
}
