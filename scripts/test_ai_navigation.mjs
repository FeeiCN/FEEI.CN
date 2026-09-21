#!/usr/bin/env node

import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const aiRoot = 'docs/01-网络安全/02-人工智能安全';
const oldEngineering = `${aiRoot}/02-智能工程`;
const engineeringRoot = 'docs/03-智能工程';
const groups = {
  '01-AI系统安全': ['AI数据与知识安全.md', '模型资产与AI供应链安全.md', '模型安全对齐与输出安全.md', '大模型应用安全.md', 'Agent与工具调用安全.md', 'AI隐私与机密保护.md', 'AI风险治理.md', 'AI安全评测与红队.md', 'AI运行监控与事件响应.md'],
  '02-AI赋能安全': ['AI漏洞挖掘.md', 'AI驱动的全链路自动化网络攻击.md', '基于AI驱动的实战网络攻击.md', '安全大模型评测体系.md'],
  '03-AI滥用防御': ['AI滥用与攻防升级.md', '合成内容与信任安全.md'],
};
const flatPaths = new Map([
  ['02-人工智能.md', '03-智能工程.md'],
  ['02-AI使用实践/05-使用AI/05-使用AI.md', '02-AI使用实践/模型接入与部署.md'],
  ['02-AI使用实践/05-使用AI/使用商业AI.md', '02-AI使用实践/使用商业AI.md'],
  ['02-AI使用实践/05-使用AI/本地部署AI/本地部署AI.md', '02-AI使用实践/本地部署AI.md'],
]);
const migration = new Map([[`${aiRoot}/人工智能安全.md`, `${aiRoot}/人工智能安全.md`]]);
const read = (file) => readFileSync(path.join(repoRoot, file), 'utf8');
const exists = (file) => existsSync(path.join(repoRoot, file));
const git = (args) => execFileSync('git', args, {cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024});
const isMarkdown = (file) => /\.mdx?$/i.test(file);
const frontMatter = (text) => text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] ?? '';
const scalar = (text, key) => {
  const value = frontMatter(text).match(new RegExp(`^${key}:\\s*(.*?)\\s*$`, 'm'))?.[1];
  return value?.replace(/^(['"])(.*)\1$/, '$2');
};

assert.ok(!exists(oldEngineering), '通用智能工程不能继续嵌套在人工智能安全内');
assert.ok(!exists(`${engineeringRoot}/02-AI使用实践/05-使用AI`), '重复的使用 AI 层级未压平');
for (const [group, names] of Object.entries(groups)) {
  const hub = `${aiRoot}/${group}/${group}.md`;
  assert.ok(exists(hub), `缺少分组入口：${hub}`);
  assert.equal(scalar(read(hub), 'content_type'), 'hub');
  const category = JSON.parse(read(`${aiRoot}/${group}/_category_.json`));
  assert.ok(category.label && Number.isInteger(category.position), `分组配置无效：${group}`);
  for (const name of names) {
    const before = `${aiRoot}/${name}`;
    const after = `${aiRoot}/${group}/${name}`;
    assert.ok(exists(after), `文章未归位：${after}`);
    assert.ok(!exists(before), `旧位置仍有重复文章：${before}`);
    migration.set(before, after);
  }
}
for (const name of ['03-智能工程.md', ...[...flatPaths.values()].filter((name) => name !== '03-智能工程.md')]) {
  assert.ok(exists(`${engineeringRoot}/${name}`), `智能工程入口或接入文章缺失：${name}`);
}
assert.equal(scalar(read(`${aiRoot}/人工智能安全.md`), 'slug'), '/ai-security');
assert.equal(scalar(read(`${engineeringRoot}/03-智能工程.md`), 'slug'), '/ai');
assert.ok(read('sidebars.ts').includes("dirName: '03-智能工程'"), '缺少独立智能工程侧边栏');
assert.ok(read('docusaurus.config.ts').includes("sidebarId: 'aiEngineeringSidebar'"), '缺少智能工程导航入口');

// On migration PRs, compare every original document, not just a hand-picked subset.
const base = process.env.AI_MIGRATION_BASE;
let preserved = 0;
if (base) {
  assert.match(base, /^[0-9a-f]{40}$/i, 'AI_MIGRATION_BASE 必须为完整提交 SHA');
  const originals = git(['ls-tree', '-r', '--name-only', '-z', base, '--', oldEngineering]).split('\0').filter(isMarkdown);
  for (const before of originals) {
    const suffix = before.slice(oldEngineering.length + 1);
    migration.set(before, `${engineeringRoot}/${flatPaths.get(suffix) ?? suffix}`);
  }
  const baseFiles = new Set(git(['ls-tree', '-r', '--name-only', '-z', base, '--', aiRoot]).split('\0'));
  for (const [before, after] of migration) {
    // Future PR bases already have the new layout; only compare paths present in that base.
    if (!baseFiles.has(before)) continue;
    assert.ok(exists(after), `迁移丢失文档：${before} -> ${after}`);
    const oldText = git(['show', `${base}:${before}`]);
    const newText = read(after);
    const slug = scalar(oldText, 'slug');
    assert.ok(slug, `旧文档缺少稳定 slug，必须明确保留其旧路由：${before}`);
    assert.equal(scalar(newText, 'slug'), slug, `已发布 URL 被改变：${before}`);
    assert.equal(scalar(newText, 'published_at'), scalar(oldText, 'published_at'), `首次发布日期被改变：${before}`);
    if (/text:\s*['"]?演讲/.test(frontMatter(oldText))) {
      assert.equal(newText, oldText, `演讲快照必须原样保存：${before}`);
    }
    preserved += 1;
  }
}

// Check Markdown file links into the moved area from anywhere in docs, and all
// relative Markdown links written inside that area. Ignore fenced examples.
const files = git(['ls-files', '-z', '--', 'docs']).split('\0').filter(isMarkdown);
let checked = 0;
const errors = [];
for (const file of files) {
  const scoped = file.startsWith(`${aiRoot}/`) || file.startsWith(`${engineeringRoot}/`);
  const source = read(file);
  const lines = [];
  let fence = null;
  for (const line of source.split(/\r?\n/)) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker && !fence) { fence = marker[1]; continue; }
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      continue;
    }
    lines.push(line);
  }
  const markdown = lines.join('\n');
  const targets = [...markdown.matchAll(/\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^\n]*?["'])?\s*\)/g)].map((m) => m[1] ?? m[2]);
  targets.push(...[...markdown.matchAll(/^\s*\[[^\]]+\]:\s*<?([^\s>]+)/gm)].map((m) => m[1]));
  targets.push(...[...markdown.matchAll(/<!--\s*@include\s+([^\s]+)\s*-->/g)].map((m) => m[1]));
  for (const target of targets) {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(target)) continue;
    let pathname;
    try { pathname = decodeURIComponent(target.split(/[?#]/, 1)[0]); }
    catch { errors.push(`${file}: 非法链接编码 ${target}`); continue; }
    if (!isMarkdown(pathname)) continue;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), pathname));
    if (!scoped && !resolved.startsWith(`${aiRoot}/`) && !resolved.startsWith(`${engineeringRoot}/`)) continue;
    checked += 1;
    if (!exists(resolved)) errors.push(`${file}: ${target} -> ${resolved}`);
  }
}
assert.deepEqual(errors, [], `迁移相关 Markdown 链接失效：\n${errors.join('\n')}`);
console.log(`[SUCCESS] AI navigation: ${preserved} original documents preserve URLs/dates; ${checked} relative links checked.`);
