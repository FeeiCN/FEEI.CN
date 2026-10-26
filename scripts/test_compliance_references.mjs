import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import createJiti from 'jiti';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const jiti = createJiti(import.meta.url);
const {default: references, complianceDirectory, resolveStandard, collectReferencePages} = jiti('../plugins/rehypeComplianceReferences.ts');
const root = path.resolve(complianceDirectory);
const pages = [
  {file: `${root}/a.md`, url: '/a', title: 'GB/T 12345-2020 测试标准', standard: 'GB/T12345-2020'},
  {file: `${root}/b.md`, url: '/b', title: 'GB/T 12345-2024 测试标准', standard: 'GB/T12345-2024'},
  {file: `${root}/c.md`, url: '/c', title: 'GB/T 20986-2023 测试标准', standard: 'GB/T20986-2023', aliases: ['GB/Z20986-2007']},
  {file: `${root}/law.md`, url: '/law', title: '中华人民共和国网络安全法'},
];
const paragraph = value => ({type: 'element', tagName: 'p', children: [{type: 'text', value}]});

test('references retain exact versions and label verified successors without linking to older editions', () => {
  assert.equal(resolveStandard('GB / T 12345—2020', pages).page.url, '/a');
  assert.deepEqual(resolveStandard('GB/Z 20986—2007', pages), {page: pages[2], revision: true});
  assert.equal(resolveStandard('GB/T 12345', pages).page.url, '/b');
  assert.equal(resolveStandard('GB/T 12345-2025', pages), undefined);
  assert.equal(resolveStandard('GB/T 99999-2020', pages), undefined);
  assert.equal(resolveStandard('GB/T 12345-2020', [...pages, {...pages[0], url: '/duplicate'}]), undefined);
});

test('prose links keep standard text, identify revisions and support literal law names', () => {
  const tree = {type: 'root', children: [paragraph('依据 GB/T 12345—2020、GB/Z 20986—2007 和《中华人民共和国网络安全法》。')]};
  references({pages})(tree, {path: `${root}/other.md`});
  const links = tree.children[0].children.filter(node => node.tagName === 'a');
  assert.deepEqual(links.map(node => node.properties.href), ['/a', '/c', '/law']);
  assert.equal(links[0].children[0].value, 'GB/T 12345—2020');
  assert.equal(links[1].children[0].value, 'GB/Z 20986—2007（站内 GB/T20986-2023 版）');
});

test('headings, code, math, existing links, self references and other directories remain intact', () => {
  const nodes = ['h2', 'code', 'pre', 'a', 'math'].map(tagName => ({type: 'element', tagName, children: [{type: 'text', value: 'GB/T 12345-2020'}]}));
  nodes.push({type: 'element', tagName: 'span', properties: {className: ['katex']}, children: [{type: 'text', value: 'GB/T 12345-2020'}]});
  const tree = {type: 'root', children: nodes};
  const before = JSON.stringify(tree);
  references({pages})(tree, {path: `${root}/other.md`});
  assert.equal(JSON.stringify(tree), before);
  const own = {type: 'root', children: [paragraph('GB/T 12345-2020')]};
  references({pages})(own, {path: pages[0].file});
  assert.equal(own.children[0].children[0].type, 'text');
  references({pages})(own, {path: path.resolve('docs/other.md')});
  assert.equal(own.children[0].children[0].type, 'text');
});

test('HTML tables and lists receive links after actual Markdown parsing without nested anchors', async () => {
  const {compile} = await import(require.resolve('@mdx-js/mdx'));
  const raw = (await import(require.resolve('rehype-raw'))).default;
  const {VFile} = await import(require.resolve('vfile'));
  const source = '<table><tr><td><strong>GB/T 12345-2020</strong></td></tr></table>\n\n- GB/Z 20986—2007\n\n[GB/T 12345-2020](/existing)\n\n`GB/T 12345-2020`';
  const result = String(await compile(new VFile({value: source, path: `${root}/other.md`}), {format: 'md', rehypePlugins: [raw, [references, {pages}]]}));
  assert.match(result, /href: "\/a"/);
  assert.match(result, /href: "\/c"/);
  assert.match(result, /href: "\/existing"/);
  assert.equal((result.match(/href:/g) ?? []).length, 3);
});

test('every discovered destination is an existing published page with a unique slug', () => {
  const found = collectReferencePages();
  assert.ok(found.length > 300);
  assert.equal(new Set(found.map(page => page.url)).size, found.length);
  assert.equal(found.find(page => page.standard === 'GB/T32924-2016')?.url, '/gb-t-32924-2016');
  assert.equal(resolveStandard('GB/Z 20986-2007', found)?.page.url, '/gb-t-20986-2023');
});
