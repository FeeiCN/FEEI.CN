import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import createJiti from 'jiti';
import {ROOT, field, planChanges, repairLinks, validate} from './maintain_compliance_docs.mjs';

const doc = (slug, body = '') => `---\nslug: ${slug}\ntitle: 测试\nicon: shield-check\ndescription: 测试资料。\n---\n\n# 测试\n\n${body}\n`;

test('migration is idempotent and preserves URL, text, and partial front matter', () => {
  const file = `${ROOT}/数据安全法.md`;
  const original = new Map([[file, doc('/data-law', '**正文不改。**')], [`${ROOT}/_原文.md`, '原文，不修改。']]);
  const once = planChanges(original).files;
  assert.equal(field(once.get(file), 'slug'), '/data-law');
  assert.equal(field(once.get(file), 'content_type'), '');
  assert.equal(field(once.get(file), 'icon'), 'shield-check');
  assert.match(once.get(file), /\*\*正文不改。\*\*/);
  assert.equal(once.get(`${ROOT}/_原文.md`), '原文，不修改。');
  assert.deepEqual(planChanges(once).files, once);
});

test('link repairs preserve hashes, reference definitions and encoded Chinese paths', () => {
  const target = `${ROOT}/03-数据安全与个人信息/数据安全法.md`;
  const paths = new Set([target]);
  const source = `[法](./${encodeURIComponent('数据安全法.md')}#要求)\n[src]: ./数据安全法.md \"标题\"\n`;
  const repaired = repairLinks(`${ROOT}/index.md`, source, paths);
  assert.match(repaired.source, /03-数据安全与个人信息\/数据安全法.md#要求/);
  assert.match(repaired.source, /\[src\]: .\/03-数据安全与个人信息\/数据安全法.md "标题"/);
  assert.equal(repaired.changes.length, 2);
});

test('missing parent traversal in a moved index link is resolved by unique path suffix', () => {
  const target = `${ROOT}/02-网络系统与基础设施/01-等级保护/index.md`;
  const result = repairLinks(`${ROOT}/11-认证测评与资质/02-系统与环境.md`,
    '[等保](./02-网络系统与基础设施/01-等级保护/index.md)', new Set([target, `${ROOT}/03-数据安全与个人信息/index.md`]));
  assert.equal(result.source, '[等保](../02-网络系统与基础设施/01-等级保护/index.md)');
});

test('code examples and external links are not rewritten', () => {
  const source = '```md\n[例](./数据安全法.md)\n```\n`[例](./数据安全法.md)`\n[外链](https://example.invalid/数据安全法.md)';
  assert.equal(repairLinks(`${ROOT}/index.md`, source, new Set([`${ROOT}/03-数据安全与个人信息/数据安全法.md`])).source, source);
});

test('ambiguous destinations are not guessed and missing links fail validation', () => {
  const file = `${ROOT}/index.md`;
  const paths = new Set([`${ROOT}/a/同名.md`, `${ROOT}/b/同名.md`]);
  assert.equal(repairLinks(file, '[链接](./同名.md)', paths).changes.length, 0);
  const result = validate(new Map([[file, doc('/hub', '[链接](./同名.md)')]]));
  assert.ok(result.errors.some((e) => e.includes('broken Markdown link')));
});

test('include errors, collisions and missing page icons remain errors', () => {
  const files = new Map([
    [`${ROOT}/index.md`, doc('/same', '<!-- @include _missing.md -->')],
    [`${ROOT}/数据安全法.md`, doc('/same').replace('icon: shield-check\n', '')],
  ]);
  const errors = validate(files).errors.join('\n');
  assert.match(errors, /include/);
  assert.match(errors, /Duplicate slug/);
  assert.match(errors, /page icon missing/);
});

test('whole-site inbound links to moved compliance documents are included', () => {
  const target = `${ROOT}/03-数据安全与个人信息/数据安全法.md`;
  const outside = 'docs/01-网络安全/01-网络空间安全/README.md';
  const source = '[法](./03-安全体系/01-安全合法合规/数据安全法.md)';
  const next = repairLinks(outside, source, new Set([target]));
  assert.match(next.source, /03-数据安全与个人信息\/数据安全法.md/);
});

const index = JSON.parse(fs.readFileSync('scripts/data/compliance-document-index.json', 'utf8'));
const originals = index.documents.filter((entry) => entry.role === 'source-text');
const jiti = createJiti(import.meta.url);
const {expandMarkdownIncludes} = jiti(path.resolve('plugins/markdownIncludes.ts'));

test('topic index covers every available GB standard exactly once', () => {
  const catalog = JSON.parse(fs.readFileSync('scripts/data/information-security-technology-standards.json', 'utf8'));
  const expected = catalog.filter((entry) => !entry.adopted).map((entry) => entry.number).sort();
  const actual = originals.filter((entry) => entry.standard?.startsWith('GB/T ')).map((entry) => entry.standard).sort();
  assert.deepEqual(actual, expected);
  for (const entry of originals.filter((item) => item.standard?.startsWith('GB/T '))) {
    const hub = fs.readFileSync(path.join(ROOT, entry.topic, 'index.md'), 'utf8');
    assert.ok(hub.includes(`[${entry.standard}](`), `${entry.standard} is missing from its topic guide`);
  }
});

test('specialized standards stay with their objects and general standards with their subjects', () => {
  const topic = (number) => originals.find((entry) => entry.standard === number)?.topic;
  assert.equal(topic('GM/T 0133-2024'), '02-网络系统与基础设施/02-关键信息基础设施');
  assert.equal(topic('GB/T 39786-2021'), '05-密码与身份认证/01-密码应用与密评');
  assert.equal(topic('GB/T 32907-2016'), '05-密码与身份认证/02-密码算法与协议');
  assert.equal(topic('GB/T 37033.1-2018'), '02-网络系统与基础设施/05-终端与物联网');
  assert.equal(topic('GB/T 31502-2015'), '09-行业专项/01-支付与金融');
  assert.equal(topic('GB/T 41871-2022'), '09-行业专项/02-汽车');
  assert.equal(topic('GB/T 38249-2019'), '09-行业专项/03-政务与办公');
  assert.equal(topic('GB/T 36959-2018'), '02-网络系统与基础设施/01-等级保护');
});

test('source texts and their images remain together and every source image exists', () => {
  for (const entry of originals) {
    const file = path.join(ROOT, entry.path);
    assert.equal(path.dirname(entry.path), path.join(entry.topic, '原文'));
    const content = fs.readFileSync(file, 'utf8');
    for (const [, target] of content.matchAll(/!\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      if (/^(?:[a-z][\w+.-]*:|\/|#)/i.test(target)) continue;
      assert.ok(fs.existsSync(path.resolve(path.dirname(file), decodeURIComponent(target))), `${entry.path}: missing ${target}`);
    }
  }
});

test('topic standards open published internal texts and keep official sources separate', () => {
  const sources = originals.filter((entry) => entry.standard);
  const linked = new Set();
  const guides = [...new Set(sources.map((entry) => path.join(ROOT, entry.topic, 'index.md')))];
  for (const file of guides) {
    const table = fs.readFileSync(file, 'utf8').split('## 本主题标准')[1];
    for (const [, number, href, official] of table.matchAll(/\| \[((?:GB|GM|GA)\/T [\d.]+-\d{4})\]\(([^)]+)\) \| [^\n]+? \| \[官方来源\]\(([^)]+)\) \|/g)) {
      assert.ok(href.startsWith('./'), `${number}: expected an internal page`);
      const [relative, hash] = href.split('#');
      const target = path.resolve(path.dirname(file), decodeURIComponent(relative));
      assert.ok(!path.basename(target).startsWith('_'), `${number}: partial files are not published`);
      const content = fs.readFileSync(target, 'utf8');
      assert.ok(field(content, 'slug'), `${number}: page URL missing`);
      assert.equal(hash, undefined, `${number}: topic link should open the page directly`);
      assert.equal(field(content, 'standard_source'), 'true', `${number}: original text page required`);
      assert.doesNotMatch(content, /<\/?(?:details|summary)\b/, `${number}: source text should be expanded`);
      const original = sources.find((entry) => entry.standard === number);
      assert.ok(content.includes(`@include ./原文/${path.basename(original.path)} `), `${number}: source text is not included`);
      assert.match(official, /^https:\/\//);
      assert.ok(!linked.has(number), `${number}: duplicate topic entry`);
      linked.add(number);
    }
  }
  assert.deepEqual([...linked].sort(), sources.map((entry) => entry.standard).sort());
});

test('published standard text preserves body and resolves every included image from its page', () => {
  for (const original of originals.filter((entry) => entry.standard)) {
    const page = index.documents.find((entry) => entry.role !== 'source-text' && entry.standard === original.standard);
    assert.ok(page, `${original.standard}: no published page`);
    assert.equal(page.role, 'source-reader', `${original.standard}: original text page required`);
    const file = path.resolve(ROOT, page.path);
    const expanded = expandMarkdownIncludes(fs.readFileSync(file, 'utf8'), file);
    assert.ok(!expanded.includes('@include'), `${page.path}: unexpanded include`);
    for (const [, target] of expanded.matchAll(/!\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      if (/^(?:[a-z][\w+.-]*:|\/|#)/i.test(target)) continue;
      assert.ok(fs.existsSync(path.resolve(path.dirname(file), decodeURIComponent(target))), `${page.path}: missing included image ${target}`);
    }
    const originalBody = fs.readFileSync(path.join(ROOT, original.path), 'utf8').replace(/^# [^\n]+\n*/, '').trim();
    if (!originalBody.includes('](')) assert.ok(expanded.includes(originalBody), `${page.path}: source text changed`);
  }
  const law = index.documents.find((entry) => entry.path.endsWith('/数据安全法.md'));
  const file = path.resolve(ROOT, law.path);
  assert.match(expandMarkdownIncludes(fs.readFileSync(file, 'utf8'), file), /<summary>查看法规原文<\/summary>/);
});

test('standard presentation separates publisher URLs and keeps shell dollars literal', () => {
  const expanded = (number) => {
    const page = index.documents.find((entry) => entry.role !== 'source-text' && entry.standard === number);
    const file = path.resolve(ROOT, page.path);
    return expandMarkdownIncludes(fs.readFileSync(file, 'utf8'), file);
  };
  assert.match(expanded('GB/T 28453-2012'), /\[www\.gb168\.cn\]\(http:\/\/www\.gb168\.cn\)服务热线/);
  assert.match(expanded('GB/T 39412-2020'), /\\\$PATH/);
  assert.match(expanded('GB/T 32905-2016'), /\$CF\$/);
});
