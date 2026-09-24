import assert from 'node:assert/strict';
import test from 'node:test';
import {ROOT, field, planChanges, repairLinks, semanticType, validate} from './maintain_compliance_docs.mjs';

const doc = (slug, type = 'reference', body = '') => `---\nslug: ${slug}\ntitle: 测试\nicon: shield-check\ndescription: 测试资料。\ncontent_type: ${type}\n---\n\n# 测试\n\n${body}\n`;

test('semantic types keep source partials and other site content outside migration', () => {
  assert.equal(semanticType(`${ROOT}/01-网络与基础设施安全/index.md`), 'hub');
  assert.equal(semanticType(`${ROOT}/数据安全法.md`), 'regulation');
  assert.equal(semanticType(`${ROOT}/GB-T-39204-2022-要求.md`), 'standard');
  assert.equal(semanticType(`${ROOT}/09-认证测评与资质/01-企业与组织.md`), 'qualification');
  assert.equal(semanticType(`${ROOT}/_原文.md`), null);
  assert.equal(semanticType('docs/其他.md'), null);
});

test('migration is idempotent and preserves URL, text, and partial front matter', () => {
  const file = `${ROOT}/数据安全法.md`;
  const original = new Map([[file, doc('/data-law', 'reference', '**正文不改。**')], [`${ROOT}/_原文.md`, '原文，不修改。']]);
  const once = planChanges(original).files;
  assert.equal(field(once.get(file), 'slug'), '/data-law');
  assert.equal(field(once.get(file), 'content_type'), 'regulation');
  assert.equal(field(once.get(file), 'icon'), '');
  assert.match(once.get(file), /\*\*正文不改。\*\*/);
  assert.equal(once.get(`${ROOT}/_原文.md`), '原文，不修改。');
  assert.deepEqual(planChanges(once).files, once);
});

test('link repairs preserve hashes, reference definitions and encoded Chinese paths', () => {
  const target = `${ROOT}/02-数据与隐私安全/数据安全法.md`;
  const paths = new Set([target]);
  const source = `[法](./${encodeURIComponent('数据安全法.md')}#要求)\n[src]: ./数据安全法.md \"标题\"\n`;
  const repaired = repairLinks(`${ROOT}/index.md`, source, paths);
  assert.match(repaired.source, /02-数据与隐私安全\/数据安全法.md#要求/);
  assert.match(repaired.source, /\[src\]: .\/02-数据与隐私安全\/数据安全法.md "标题"/);
  assert.equal(repaired.changes.length, 2);
});

test('missing parent traversal in a moved index link is resolved by unique path suffix', () => {
  const target = `${ROOT}/01-网络与基础设施安全/01-等级保护/index.md`;
  const result = repairLinks(`${ROOT}/09-认证测评与资质/02-系统与环境.md`,
    '[等保](./01-网络与基础设施安全/01-等级保护/index.md)', new Set([target, `${ROOT}/02-数据与隐私安全/index.md`]));
  assert.equal(result.source, '[等保](../01-网络与基础设施安全/01-等级保护/index.md)');
});

test('code examples and external links are not rewritten', () => {
  const source = '```md\n[例](./数据安全法.md)\n```\n`[例](./数据安全法.md)`\n[外链](https://example.invalid/数据安全法.md)';
  assert.equal(repairLinks(`${ROOT}/index.md`, source, new Set([`${ROOT}/02-数据与隐私安全/数据安全法.md`])).source, source);
});

test('ambiguous destinations are not guessed and missing links fail validation', () => {
  const file = `${ROOT}/index.md`;
  const paths = new Set([`${ROOT}/a/同名.md`, `${ROOT}/b/同名.md`]);
  assert.equal(repairLinks(file, '[链接](./同名.md)', paths).changes.length, 0);
  const result = validate(new Map([[file, doc('/hub', 'hub', '[链接](./同名.md)')]]));
  assert.ok(result.errors.some((e) => e.includes('broken Markdown link')));
});

test('include errors, collisions and non-hub icons remain errors', () => {
  const files = new Map([
    [`${ROOT}/index.md`, doc('/same', 'hub', '<!-- @include _missing.md -->')],
    [`${ROOT}/数据安全法.md`, doc('/same', 'regulation')],
  ]);
  const errors = validate(files).errors.join('\n');
  assert.match(errors, /include/);
  assert.match(errors, /Duplicate slug/);
  assert.match(errors, /detail page has icon/);
});

test('whole-site inbound links to moved compliance documents are included', () => {
  const target = `${ROOT}/02-数据与隐私安全/数据安全法.md`;
  const outside = 'docs/01-网络安全/01-网络空间安全/README.md';
  const source = '[法](./03-安全体系/01-安全合法合规/数据安全法.md)';
  const next = repairLinks(outside, source, new Set([target]));
  assert.match(next.source, /02-数据与隐私安全\/数据安全法.md/);
});
