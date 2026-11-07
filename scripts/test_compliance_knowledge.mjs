import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import test from 'node:test';
import createJiti from 'jiti';
import cytoscape from 'cytoscape';

const jiti = createJiti(import.meta.url);
const model = jiti('../src/components/ComplianceKnowledge/model.ts');
const {neighborhood} = jiti('../src/components/ComplianceKnowledge/graphModel.ts');
const {buildCatalog, filterCatalog, panoramaNetwork, panoramaForceLayout, readableNeighborhood, fileKind} = jiti('../src/components/ComplianceKnowledge/panoramaModel.ts');
const {standardForPage, standardRelations, standardDisplayName, standardGraphPage} = jiti('../src/components/ComplianceKnowledge/standardRelationsModel.ts');
const {verifyComplianceOntology} = jiti('../plugins/complianceOntologyPlugin.ts');
const dataDir = new URL('../static/data/compliance/', import.meta.url);
const graph = JSON.parse(fs.readFileSync(new URL('graph.json', dataDir), 'utf8'));
const clauses = JSON.parse(fs.readFileSync(new URL('clauses.json', dataDir), 'utf8'));
const evidence = JSON.parse(fs.readFileSync(new URL('evidence.json', dataDir), 'utf8'));
const index = model.createIndex([graph, clauses]);
const select = (options) => model.selectNodes(index, {mode: 'browse', query: '', topic: '', kind: '', ...options});

test('real exports cover the source index, thirty clause standards, and every assertion has evidence', () => {
  const sourceIndex = JSON.parse(fs.readFileSync(new URL('../scripts/data/compliance-document-index.json', import.meta.url), 'utf8'));
  assert.equal(graph.scope.indexedDocuments, sourceIndex.documents.length);
  assert.equal(graph.scope.clauseStandards.length, 30);
  assert.equal(new Set(clauses.nodes.map(node => node.standard)).size, 30);
  const ev = new Set(evidence.evidence.map(item => item.id));
  for (const edge of [...graph.edges, ...clauses.edges]) {
    assert.ok(index.nodes.has(edge.subject) && index.nodes.has(edge.object), edge.id);
    assert.ok(edge.evidence.length && edge.evidence.every(id => ev.has(id)), edge.id);
  }
  assert.equal(clauses.sourceDigest, graph.sourceDigest);
  assert.equal(evidence.sourceDigest, graph.sourceDigest);
});

test('standard search accepts spacing, dash variants, and explicit years without merging versions', () => {
  for (const query of ['GB/T 35273—2020', 'gb-t-35273-2020', 'ＧＢ／Ｔ ３５２７３－２０２０']) {
    assert.ok(select({query}).some(node => node.id === 'standard:gb-t-35273-2020'), query);
  }
  assert.ok(!select({query: 'GB/T 35273-2017'}).some(node => node.id === 'standard:gb-t-35273-2020'));
});

test('incident example traces GB/Z 20986-2007 to the explicit GB/T 20986-2023 successor', () => {
  const edges = model.successorEdges(index, 'standard:gb-z-20986-2007');
  assert.ok(edges.some(edge => edge.subject === 'standard:gb-t-20986-2023'));
  assert.ok(select({mode: 'impact', query: '20986'}).some(node => node.id === 'standard:gb-z-20986-2007'));
});

test('graph keeps the direction and original evidence of the replacement, without inventing links', () => {
  const visible = neighborhood(index, 'standard:gb-z-20986-2007', {});
  const replacement = visible.edges.find(edge => edge.predicate === 'supersedes');
  assert.equal(replacement.subject, 'standard:gb-t-20986-2023');
  assert.equal(replacement.object, 'standard:gb-z-20986-2007');
  assert.ok(replacement.evidence.every(id => evidence.evidence.some(item => item.id === id && item.quote.includes('本文件代替'))));
  const originals = new Map([...graph.edges, ...clauses.edges].map(edge => [edge.id, edge]));
  for (const edge of visible.edges) {
    const original = originals.get(edge.id);
    assert.equal(edge.subject, original.subject);
    assert.equal(edge.object, original.object);
    assert.equal(edge.predicate, original.predicate);
  }
});

test('graph expansion stays connected, merges duplicate assertions, and retains all their evidence', () => {
  const tiny = model.createIndex([{nodes: ['a', 'b', 'c', 'x', 'y'].map(id => ({id, type: 'StandardVersion', label: id})), edges: [
    {id: 'ab1', subject: 'a', object: 'b', predicate: 'cites', evidence: ['e1']},
    {id: 'ab2', subject: 'a', object: 'b', predicate: 'cites', evidence: ['e2']},
    {id: 'bc', subject: 'b', object: 'c', predicate: 'cites', evidence: ['e3']},
    {id: 'xy', subject: 'x', object: 'y', predicate: 'cites', evidence: ['e4']},
  ]}]);
  const first = neighborhood(tiny, 'a', {});
  assert.deepEqual(first.nodes.map(node => node.id), ['a', 'b']);
  assert.deepEqual(first.edges[0].evidence, ['e1', 'e2']);
  assert.equal(first.remaining.get('b'), 1);
  const expanded = neighborhood(tiny, 'a', {b: 2, x: 6});
  assert.deepEqual(expanded.nodes.map(node => node.id), ['a', 'b', 'c']);
  assert.equal(expanded.edges.length, 2);
  assert.equal(expanded.remaining.get('b'), 0);
});

test('dense graph neighborhoods are bounded and always keep both endpoints of every displayed edge', () => {
  const root = 'standard:gb-t-25069-2022';
  const visible = neighborhood(index, root, {[root]: 10000}, 12);
  assert.equal(visible.nodes.length, 12);
  assert.equal(visible.capped, true);
  const ids = new Set(visible.nodes.map(node => node.id));
  assert.ok(visible.edges.every(edge => ids.has(edge.subject) && ids.has(edge.object)));
  assert.ok(visible.remaining.get(root) > 0);
  assert.deepEqual(neighborhood(index, 'missing-root', {}).nodes, []);
});

test('clause graph links the numbered chapter to its exact standard version', () => {
  const visible = neighborhood(index, 'clause:gb-t-20269-2006:3.3', {});
  assert.ok(visible.edges.some(edge => edge.predicate === 'isPartOf' && edge.subject === 'clause:gb-t-20269-2006:3.3' && edge.object === 'standard:gb-t-20269-2006'));
});

test('panorama covers every document, merges reader and original identities, and keeps dated and undated standards distinct', () => {
  const catalog = buildCatalog(index);
  const ids = new Set(catalog.entries.map(entry => entry.node.id));
  assert.equal(ids.size, catalog.entries.length);
  for (const document of graph.nodes.filter(node => node.type === 'Document')) {
    assert.ok(ids.has(catalog.aliases.get(document.id)), document.id);
  }
  assert.equal(catalog.aliases.get('document:gb-t-35273-2020'), 'standard:gb-t-35273-2020');
  assert.equal(catalog.aliases.get('source:gb-t-35273-2020'), 'standard:gb-t-35273-2020');
  assert.ok(ids.has('standard:gb-t-35273-2017'));
  assert.ok(ids.has('standard:gb-t-35273-2020'));
  assert.ok(ids.has('series:gb-t-22239'));
  assert.equal(catalog.entries.filter(entry => entry.collected).length, 383);
  assert.equal(catalog.entries.length, 1466);
});

test('panorama relationships project actual assertions through file aliases and preserve their source evidence', () => {
  const catalog = buildCatalog(index);
  const originals = new Map();
  for (const original of graph.edges) {
    const subject = catalog.aliases.get(original.subject);
    const object = catalog.aliases.get(original.object);
    const key = JSON.stringify([subject, original.predicate, object]);
    originals.set(key, new Set([...(originals.get(key) ?? []), ...original.evidence]));
  }
  for (const edge of catalog.edges) {
    assert.notEqual(edge.subject, edge.object);
    assert.ok(['cites', 'normativelyReferences', 'supersedes', 'hasVersion', ...model.legalRelationTypes].includes(edge.predicate));
    const originalEvidence = originals.get(JSON.stringify([edge.subject, edge.predicate, edge.object]));
    assert.ok(originalEvidence);
    assert.ok(edge.evidence.every(id => originalEvidence.has(id)));
  }
});

test('legal relationships are available in details, reverse lookup and panorama without changing their evidence or direction', () => {
  const law = 'document:cybersecurity-law';
  const regulation = 'document:cii-security-protection';
  const standard = 'standard:gb-t-39204-2022';
  const enacted = model.legalRelationsFor(index, regulation).find(edge => edge.object === law && edge.predicate === 'enactedUnder');
  const implementsEdge = model.legalRelationsFor(index, standard).find(edge => edge.object === regulation && edge.predicate === 'implements');
  assert.ok(enacted && implementsEdge);
  assert.ok(model.legalRelationsFor(index, law, true).some(edge => edge.id === enacted.id));
  assert.ok(model.legalRelationsFor(index, regulation, true).some(edge => edge.id === implementsEdge.id));
  const catalog = buildCatalog(index);
  for (const edge of [enacted, implementsEdge]) {
    assert.deepEqual(catalog.edges.find(item => item.id === edge.id), edge);
    assert.ok(edge.evidence.every(id => evidence.evidence.some(item => item.id === id && item.quote)));
  }
  assert.ok(neighborhood(index, regulation, {}).edges.some(edge => edge.id === enacted.id));
  assert.equal(catalog.edges.filter(edge => model.legalRelationTypes.includes(edge.predicate)).length, 73);
  assert.ok(!model.legalRelationsFor(index, 'standard:gb-t-35273-2020').some(edge => edge.object === 'document:personal-info-protection-law'));
});

test('panorama filters laws, foreign files, original topics and standard names without treating guide pages as laws', () => {
  const catalog = buildCatalog(index);
  const options = {query: '', kind: '', topic: '', extended: false};
  const laws = filterCatalog(catalog, {...options, kind: 'law'});
  assert.equal(laws.length, 7);
  assert.ok(laws.some(entry => entry.node.id === 'document:personal-info-protection-law'));
  assert.equal(fileKind(index.nodes.get('document:eu-gdpr')), 'foreign');
  assert.equal(fileKind(index.nodes.get('document:foundational-cybersecurity-laws')), 'guide');
  assert.ok(filterCatalog(catalog, {...options, query: 'ＧＢ／Ｔ３５２７３－２０２０'}).some(entry => entry.node.id === 'standard:gb-t-35273-2020'));
  assert.ok(filterCatalog(catalog, {...options, topic: '03-数据安全与个人信息'}).every(entry => entry.group === '03-数据安全与个人信息'));
  assert.equal(filterCatalog(catalog, {...options, query: 'feei-panorama-no-such-file'}).length, 0);
  assert.ok(filterCatalog(catalog, {...options, extended: true}).length > filterCatalog(catalog, options).length);
});

test('panorama layout depends on actual core relations and identities, independently of manual categories', () => {
  const catalog = buildCatalog(index);
  const entries = catalog.entries;
  const first = panoramaNetwork(entries, catalog.edges);
  assert.equal(first.positions.size, entries.length);
  assert.equal(new Set([...first.positions.values()].map(position => `${position.x}:${position.y}`)).size, entries.length);
  assert.ok([...first.positions.values()].every(position => Number.isFinite(position.x) && Number.isFinite(position.y)));
  assert.deepEqual(first, panoramaNetwork([...entries].reverse().map(entry => ({...entry, group: '任意目录', topics: ['新的手工分类']})), catalog.edges));
  assert.ok(first.coreEdges.every(edge => edge.predicate !== 'cites' && catalog.edges.includes(edge)));
  assert.equal(first.isolatedCount, [...first.degrees.values()].filter(degree => degree === 0).length);
  assert.ok(first.isolatedCount > 0);
  assert.equal(panoramaNetwork([], []).positions.size, 0);
});

test('Cytoscape force layout keeps every file, including disconnected files, in both collection scopes', () => {
  const catalog = buildCatalog(index);
  for (const extended of [false, true]) {
    const entries = filterCatalog(catalog, {query: '', kind: '', topic: '', extended});
    const network = panoramaNetwork(entries, catalog.edges);
    const cy = cytoscape({headless: true, elements: [
      ...entries.map(entry => ({data: {id: entry.node.id}, position: network.positions.get(entry.node.id)})),
      ...network.coreEdges.map(edge => ({data: {id: edge.id, source: edge.subject, target: edge.object}})),
    ], layout: {name: 'preset'}});
    try {
      cy.layout({...panoramaForceLayout, animate: false, fit: false, boundingBox: {x1: 0, y1: 0, w: 900, h: 650}}).run();
      assert.equal(cy.nodes().length, entries.length);
      assert.equal(cy.edges().length, network.coreEdges.length);
      assert.ok(cy.nodes().every(node => Number.isFinite(node.position('x')) && Number.isFinite(node.position('y'))));
      assert.equal(cy.nodes().filter(node => node.degree() === 0).length, network.isolatedCount);
    } finally {cy.destroy();}
  }
});

test('readable graph shows the real legal chain without parallel mention clutter and preserves evidence', () => {
  const catalog = buildCatalog(index);
  const scope = catalog.entries.filter(entry => entry.collected);
  const root = 'document:cii-security-protection';
  const visible = readableNeighborhood(scope, catalog.edges, root);
  assert.equal(visible.entries[0].node.id, root);
  assert.ok(visible.entries.length <= 7);
  assert.ok(visible.edges.some(edge => edge.subject === root && edge.object === 'document:cybersecurity-law' && edge.predicate === 'enactedUnder'));
  assert.ok(visible.edges.some(edge => edge.subject === 'standard:gb-t-39204-2022' && edge.object === root && edge.predicate === 'implements'));
  assert.ok(visible.edges.every(edge => edge.predicate !== 'cites' && catalog.edges.includes(edge) && edge.evidence.length));
  assert.equal(new Set(visible.entries.map(entry => entry.node.id)).size, visible.entries.length);
  const recategorized = scope.map(entry => ({...entry, group: '任意目录', topics: ['手动主题']}));
  assert.deepEqual(readableNeighborhood(recategorized, catalog.edges, root).edges, visible.edges);
});

test('readable graph pagination reaches every actual neighbor and keeps isolated files accessible', () => {
  const catalog = buildCatalog(index);
  const scope = catalog.entries.filter(entry => entry.collected);
  const root = 'document:cybersecurity-law';
  for (const mentions of [false, true]) {
    const all = new Set();
    const first = readableNeighborhood(scope, catalog.edges, root, 0, mentions);
    for (let page = 0; page < first.pages; page++) {
      const graph = readableNeighborhood(scope, catalog.edges, root, page, mentions);
      assert.ok(graph.entries.length <= 7);
      assert.ok(graph.edges.every(edge => edge.subject === root || edge.object === root));
      for (const entry of graph.entries.slice(1)) {assert.ok(!all.has(entry.node.id)); all.add(entry.node.id);}
    }
    const ids = new Set(scope.map(entry => entry.node.id));
    const expected = new Set(catalog.edges.filter(edge => ids.has(edge.subject) && ids.has(edge.object)
      && (mentions || edge.predicate !== 'cites') && (edge.subject === root || edge.object === root))
      .map(edge => edge.subject === root ? edge.object : edge.subject));
    assert.deepEqual(all, expected);
    assert.equal(first.total, expected.size);
    assert.equal(readableNeighborhood(scope, catalog.edges, root, 999, mentions).page, first.pages - 1);
  }
  const network = panoramaNetwork(scope, catalog.edges);
  const isolated = scope.find(entry => network.degrees.get(entry.node.id) === 0);
  const graph = readableNeighborhood(scope, catalog.edges, isolated.node.id);
  assert.equal(graph.entries.length, 1);
  assert.equal(graph.total, 0);
  assert.equal(readableNeighborhood(scope, catalog.edges, 'missing').entries.length, 0);
});

test('every indexed standard reading page resolves to its exact version without changing article content', () => {
  const catalog = buildCatalog(index);
  let pages = 0;
  for (const entry of catalog.entries.filter(entry => entry.node.type === 'StandardVersion')) {
    for (const id of entry.node.pages ?? []) {
      const page = index.nodes.get(id);
      if (!page?.url) continue;
      assert.equal(standardForPage(index, catalog, page.url).node.id, entry.node.id);
      assert.equal(standardForPage(index, catalog, '/site' + page.url + '/?q=x#section', '/site/').node.id, entry.node.id);
      pages++;
    }
  }
  assert.ok(pages >= 287);
  assert.equal(standardForPage(index, catalog, '/cybersecurity-law'), undefined);
  assert.equal(standardForPage(index, catalog, '/cybersecurity-laws'), undefined);
  assert.equal(standardForPage(index, catalog, '/somewhere/gb-t-35273-2020'), undefined);
  assert.equal(standardForPage(index, catalog, '/gb-t-35273-2019'), undefined);
});

test('article relationships separate forward and reverse references, retain versions and undated citations, and preserve evidence', () => {
  const catalog = buildCatalog(index);
  for (const current of catalog.entries.filter(entry => entry.node.type === 'StandardVersion')) {
    const groups = standardRelations(catalog, current);
    assert.ok(groups.outgoing.every(row => row.outgoing && row.edge.subject === current.node.id));
    assert.ok(groups.incoming.every(row => !row.outgoing && row.edge.object === current.node.id));
    assert.ok(groups.versions.every(row => row.edge.predicate === 'supersedes'));
    for (const row of [...groups.outgoing, ...groups.incoming, ...groups.versions]) {
      assert.equal(row.other.kind, 'standard');
      assert.ok(catalog.edges.includes(row.edge) && row.edge.evidence.length);
      if (row.edge.predicate === 'cites') assert.ok(!catalog.edges.some(edge => edge.subject === row.edge.subject
        && edge.object === row.edge.object && edge.predicate === 'normativelyReferences'));
    }
  }
  const newer = catalog.entries.find(entry => entry.node.id === 'standard:gb-t-20986-2023');
  const older = catalog.entries.find(entry => entry.node.id === 'standard:gb-z-20986-2007');
  assert.ok(standardRelations(catalog, newer).versions.some(row => row.outgoing && row.other === older));
  assert.ok(standardRelations(catalog, older).versions.some(row => !row.outgoing && row.other === newer));
  const cii = catalog.entries.find(entry => entry.node.id === 'standard:gb-t-39204-2022');
  assert.ok(standardRelations(catalog, cii).outgoing.some(row => row.other.node.type === 'StandardSeries'));
});

test('guides do not count as original sources and exact missing editions stay missing', () => {
  const old = index.nodes.get('standard:gb-t-22081-2016');
  assert.ok(old.pages.includes('document:gb-t-22081-2016'));
  assert.equal(old.sources.length, 0);
  assert.ok(select({mode: 'missing', query: '22081'}).some(node => node.id === old.id));
  assert.ok(!select({mode: 'missing'}).some(node => node.id === 'standard:gb-t-35273-2020'));
});

test('standard display names use exact source citations without assigning years or borrowing another edition title', () => {
  const series = index.nodes.get('series:gb-t-20984');
  assert.deepEqual(standardDisplayName(series, ['- GB/T 20984 信息安全技术 信息安全风险评估方法']),
    {identifier: 'GB/T 20984', title: '信息安全技术 信息安全风险评估方法'});
  assert.equal(standardDisplayName(series, ['- GB/T 20984—2022 信息安全技术 信息安全风险评估方法']).title, '');
  const old = index.nodes.get('standard:gb-z-20986-2007');
  assert.equal(standardDisplayName(old, ['本文件代替 GB/Z 20986—2007《信息安全技术 信息安全事件分类分级指南》，与旧版相比']).title,
    '信息安全技术 信息安全事件分类分级指南');
  const edition = index.nodes.get('standard:gb-t-1.1-2020');
  assert.equal(standardDisplayName(edition, ['本文件按照 GB/T 1.1—2020 给出的规则起草。']).title, '');
  assert.equal(standardDisplayName(edition, ['- GB/T 1.1—2009 标准化工作导则']).title, '');
  assert.equal(standardDisplayName(index.nodes.get('standard:gb-t-25069-2022')).title, '信息安全技术 术语');
});

test('article graph pages stay one hop, cap at four unique neighbors, and retain real direction and evidence', () => {
  const catalog = buildCatalog(index);
  for (const id of ['standard:gb-t-39204-2022', 'standard:gb-t-20986-2023', 'standard:gb-t-25069-2022']) {
    const groups = standardRelations(catalog, catalog.entries.find(entry => entry.node.id === id));
    const allRows = [...groups.versions, ...groups.outgoing, ...groups.incoming];
    const seen = new Set();
    const first = standardGraphPage(groups);
    for (let page = 0; page < first.pages; page++) {
      const graph = standardGraphPage(groups, page);
      assert.ok(graph.rows.length <= 4);
      for (const row of graph.rows) {
        assert.ok(!seen.has(row.other.node.id)); seen.add(row.other.node.id);
        assert.ok(allRows.includes(row));
        assert.ok(row.edge.subject === id || row.edge.object === id);
        assert.ok(row.edge.evidence.length);
      }
    }
    assert.equal(seen.size, new Set(allRows.map(row => row.other.node.id)).size);
    assert.equal(standardGraphPage(groups, 999).page, first.pages - 1);
    if (groups.versions.length) assert.equal(first.rows[0].edge.predicate, 'supersedes');
  }
  assert.equal(standardGraphPage({versions: [], outgoing: [], incoming: []}).total, 0);
});

test('undated references remain series and are not rewritten to latest editions', () => {
  const edge = graph.edges.find(item => item.predicate === 'normativelyReferences' && item.object === 'series:gb-t-22239');
  assert.ok(edge);
  assert.equal(index.nodes.get(edge.object).type, 'StandardSeries');
});

test('reader pages expose citations from their included originals with reverse relationships', () => {
  const references = model.referencesFor(index, 'document:gb-t-20986-2023');
  assert.ok(references.some(edge => edge.predicate === 'normativelyReferences' && edge.object === 'standard:gb-t-25069-2022'));
  assert.ok(model.citingEdges(index, 'standard:gb-t-25069-2022').some(edge => edge.subject === 'standard:gb-t-20986-2023'));
});

test('clause search spans standards, links to originals, and retains template context', () => {
  const found = select({mode: 'clauses', query: '访问控制'});
  assert.ok(new Set(found.map(node => node.standard)).size >= 3);
  assert.ok(found.every(node => node.type === 'Clause' && node.document && node.line > 0));
  const template = clauses.nodes.find(node => node.number === 'F/template/1');
  assert.equal(template.sectionKind, 'template');
  assert.equal(model.typeLabel(template), '附录模板章节');
  const clause = clauses.nodes.find(node => node.standard === 'standard:gb-t-35273-2020' && node.number === '5.2');
  assert.equal(model.pageFor(index, clause).url, '/gb-t-35273-2020');
});

test('topic filters apply to uncatalogued cited editions via their citing sources', () => {
  const node = index.nodes.get('standard:gb-z-20986-2007');
  assert.ok(model.nodeTopics(index, node).includes('08-监测应急与业务连续性'));
  assert.ok(select({mode: 'impact', query: '20986', topic: '08-监测应急与业务连续性'}).some(item => item.id === node.id));
});

test('empty searches and content type filters are predictable', () => {
  assert.equal(select({query: '不存在的标准feei-not-found'}).length, 0);
  assert.ok(select({kind: 'analysis'}).every(node => node.role === 'analysis'));
  assert.ok(select({mode: 'browse'}).every(node => node.role !== 'source-text' && node.type !== 'Clause'));
});

test('malformed cyclic successor input terminates, without duplicates', () => {
  const part = {nodes: [{id: 'a', type: 'StandardVersion'}, {id: 'b', type: 'StandardVersion'}], edges: [
    {subject: 'a', predicate: 'supersedes', object: 'b'}, {subject: 'b', predicate: 'supersedes', object: 'a'},
  ]};
  assert.equal(model.successorEdges(model.createIndex([part]), 'a').length, 1);
});

test('build gate accepts current exports and rejects changed, added, removed, or corrupted data', () => {
  verifyComplianceOntology(path.resolve('.'));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'feei-ontology-gate-'));
  const sha = value => createHash('sha256').update(value).digest('hex');
  const write = (file, value) => {const full = path.join(temp, file); fs.mkdirSync(path.dirname(full), {recursive: true}); fs.writeFileSync(full, value);};
  const root = 'docs/compliance';
  const indexFile = 'scripts/data/compliance-document-index.json';
  const output = 'static/data/compliance/';
  const doc = '# Example\n';
  const indexText = JSON.stringify({root});
  const exports = {};
  for (const file of ['graph.json', 'clauses.json', 'evidence.json', 'model.ttl', 'shapes.ttl', 'graph.ttl']) {
    const value = file.endsWith('.json') ? JSON.stringify({sourceDigest: '0'.repeat(64)}) : '@prefix c: <https://example.org/> .\n';
    write(output + file, value); exports[file] = sha(value);
  }
  write(indexFile, indexText); write(root + '/a.md', doc);
  write(output + 'validation.json', JSON.stringify({conforms: true, sourceDigest: '0'.repeat(64),
    inputs: {[indexFile]: sha(indexText), [root + '/a.md']: sha(doc)}, exports}));
  try {
    verifyComplianceOntology(temp);
    write(root + '/a.md', '# Changed');
    assert.throws(() => verifyComplianceOntology(temp), /已过期/);
    write(root + '/a.md', doc); write(root + '/new.md', '# New');
    assert.throws(() => verifyComplianceOntology(temp), /尚未收录文档/);
    fs.unlinkSync(path.join(temp, root, 'new.md')); fs.unlinkSync(path.join(temp, root, 'a.md'));
    assert.throws(() => verifyComplianceOntology(temp), /已过期/);
    write(root + '/a.md', doc); write(output + 'graph.json', JSON.stringify({sourceDigest: '0'.repeat(64), bad: true}));
    assert.throws(() => verifyComplianceOntology(temp), /导出内容不匹配/);
  } finally {fs.rmSync(temp, {recursive: true, force: true});}
});
