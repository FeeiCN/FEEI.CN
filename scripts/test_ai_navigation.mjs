#!/usr/bin/env node

import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const securityRoot = 'docs/01-网络安全/01-网络空间安全';
const legacyRoot = 'docs/01-网络安全/02-人工智能安全';
const generalIntelligenceRoot = `${securityRoot}/04-软件工程/01-人工智能`;
const aiPages = new Set([
  `${securityRoot}/01-安全威胁/02-攻击技术/15-业务安全与自动化滥用/AI滥用与攻防升级.md`,
  `${securityRoot}/01-安全威胁/02-攻击技术/15-业务安全与自动化滥用/AI滥用防御.md`,
  `${securityRoot}/01-安全威胁/02-攻击技术/15-业务安全与自动化滥用/合成内容与信任安全.md`,
  `${securityRoot}/01-安全威胁/02-攻击技术/18-AI与Agent/Agent安全案例初探.md`,
  `${securityRoot}/01-安全威胁/02-攻击技术/18-AI与Agent/SurrealDB的MCP会话身份绑定缺陷.md`,
  `${securityRoot}/02-安全组织/AI风险治理.md`,
  `${securityRoot}/03-安全体系/02-风险发现治理/AI Agent安全研究方法.md`,
  `${securityRoot}/03-安全体系/02-风险发现治理/AI漏洞挖掘.md`,
  `${securityRoot}/03-安全体系/02-风险发现治理/AI赋能安全.md`,
  `${securityRoot}/03-安全体系/03-风险防御对抗/AI系统安全/AI数据与知识安全.md`,
  `${securityRoot}/03-安全体系/03-风险防御对抗/AI系统安全/AI核心资产与基础设施安全.md`,
  `${securityRoot}/03-安全体系/03-风险防御对抗/AI系统安全/AI系统安全.md`,
  `${securityRoot}/03-安全体系/03-风险防御对抗/AI系统安全/AI隐私与机密保护.md`,
  `${securityRoot}/03-安全体系/03-风险防御对抗/AI系统安全/Agent与工具调用安全.md`,
  `${securityRoot}/03-安全体系/03-风险防御对抗/AI系统安全/Agent权限撤销与异步执行一致性.md`,
  `${securityRoot}/03-安全体系/03-风险防御对抗/AI系统安全/大模型应用安全.md`,
  `${securityRoot}/03-安全体系/03-风险防御对抗/AI系统安全/模型安全对齐与输出安全.md`,
  `${securityRoot}/03-安全体系/03-风险防御对抗/AI系统安全/模型资产与AI供应链安全.md`,
  `${securityRoot}/03-安全体系/03-风险防御对抗/AI运行监控与事件响应.md`,
  `${securityRoot}/03-安全体系/04-安全实战检验/AI安全评测与红队.md`,
  `${securityRoot}/03-安全体系/04-安全实战检验/AI驱动的全链路自动化网络攻击.md`,
  `${securityRoot}/03-安全体系/04-安全实战检验/基于AI驱动的实战网络攻击.md`,
  `${securityRoot}/03-安全体系/04-安全实战检验/安全大模型评测体系.md`,
  `${securityRoot}/人工智能安全.md`,
]);
const read = (file) => readFileSync(path.join(repoRoot, file), 'utf8');
const exists = (file) => existsSync(path.join(repoRoot, file));
const git = (args) => execFileSync('git', args, {cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024});
const isMarkdown = (file) => /\.mdx?$/i.test(file);
const inScope = (file) => file.startsWith(`${generalIntelligenceRoot}/`) || aiPages.has(file) || file.startsWith(`${legacyRoot}/`);
const frontMatter = (text) => text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] ?? '';
const scalar = (text, key) => {
  const value = frontMatter(text).match(new RegExp(`^${key}:\\s*(.*?)\\s*$`, 'm'))?.[1];
  return value?.replace(/^(['"])(.*)\1$/, '$2');
};

assert.ok(!exists(legacyRoot), 'AI 内容应融入统一安全目录，不保留独立目录');
for (const file of aiPages) assert.ok(exists(file), `文章未归位：${file}`);
for (const name of ['01-人工智能.md', '01-AI基础认知/01-AI基础认知.md', '02-Agent与工具工程/02-Agent与工具工程.md', '03-AI应用实践/03-AI应用实践.md', '04-AI应用与组织/04-AI应用与组织.md']) {
  assert.ok(exists(`${generalIntelligenceRoot}/${name}`), `缺少通用 AI 分组入口：${name}`);
}
assert.equal(scalar(read(`${securityRoot}/人工智能安全.md`), 'slug'), '/ai-security');
assert.equal(scalar(read(`${generalIntelligenceRoot}/01-人工智能.md`), 'slug'), '/ai');
assert.equal(scalar(read(`${generalIntelligenceRoot}/01-AI基础认知/从零构建大语言模型/index.md`), 'pagination_next'), '网络安全/网络空间安全/软件工程/人工智能/AI基础认知/从零构建大语言模型/从零认识大语言模型');
for (const file of ['sidebars.ts', 'docusaurus.config.ts']) {
  assert.ok(!/ai(?:Security|Engineering)Sidebar/.test(read(file)), 'AI 页面应使用统一网络空间安全导航');
}
assert.ok(read('sidebars.ts').includes("dirName: '01-网络安全/01-网络空间安全'"));
assert.ok(read('docusaurus.config.ts').includes("docId: '网络安全/网络空间安全/README', label: '网络空间安全'"));
assert.ok(read('scripts/workflow_delivery.py').includes(`${generalIntelligenceRoot}/03-AI应用实践/AI使用数据.mdx`), '数据交付页路径未更新');
assert.ok(!read('.github/workflows/sync-security-engineering.yml').includes(legacyRoot), '同步不能继续读取旧目录');

// Validate the current worktree, including files added during a reorganization.
// Tracked files deleted from the worktree must not be read as if they still existed.
const trackedFiles = git(['ls-files', '-z', '--', 'docs']).split('\0');
const untrackedFiles = git(['ls-files', '--others', '--exclude-standard', '-z', '--', 'docs']).split('\0');
const files = [...new Set([...trackedFiles, ...untrackedFiles])].filter((file) => isMarkdown(file) && exists(file));
const bySlug = new Map();
for (const file of files.filter(inScope)) {
  const slug = scalar(read(file), 'slug');
  assert.ok(slug, `文档缺少稳定 slug：${file}`);
  assert.ok(!bySlug.has(slug), `重复的 AI 文档 URL：${slug}，${bySlug.get(slug)} 与 ${file}`);
  bySlug.set(slug, file);
}

for (const file of files.filter((file) => !inScope(file))) {
  const slug = scalar(read(file), 'slug');
  assert.ok(!bySlug.has(slug), `AI 文档 URL 与其他文档重复：${slug}，${file}`);
}

// Compare by published URL, not a single historical directory layout. The base
// may already contain a concurrent reorganization; those documents must not be skipped.
const base = process.env.AI_MIGRATION_BASE;
let preserved = 0;
if (base) {
  assert.match(base, /^[0-9a-f]{40}$/i, 'AI_MIGRATION_BASE 必须为完整提交 SHA');
  const originals = git(['ls-tree', '-r', '--name-only', '-z', base, '--', legacyRoot, securityRoot]).split('\0').filter((file) => isMarkdown(file) && inScope(file));
  assert.ok(originals.length >= 68, '迁移基线至少应覆盖原有 68 篇 AI 文档');
  const originalSlugs = new Set();
  for (const before of originals) {
    const oldText = git(['show', `${base}:${before}`]);
    const slug = scalar(oldText, 'slug');
    assert.ok(slug, `旧文档缺少稳定 slug，必须明确保留其旧路由：${before}`);
    assert.ok(!originalSlugs.has(slug), `基线存在重复 URL，需先确认主归属：${slug}`);
    originalSlugs.add(slug);
    const after = bySlug.get(slug);
    assert.ok(after, `迁移丢失文档或改变 URL：${before} (${slug})`);
    const newText = read(after);
    assert.equal(scalar(newText, 'published_at'), scalar(oldText, 'published_at'), `首次发布日期被改变：${before}`);
    if (/text:\s*['"]?演讲/.test(frontMatter(oldText))) {
      assert.equal(newText, oldText, `历史快照正文必须原样保存：${before}`);
    }
    preserved += 1;
  }
}

// Check Markdown file links into the moved area from anywhere in docs, and all
// relative Markdown links written inside that area. Ignore fenced examples.
let checked = 0;
const errors = [];
for (const file of files) {
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
    if (!pathname) continue;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), pathname));
    if (!inScope(file) && !inScope(resolved)) continue;
    checked += 1;
    if (!exists(resolved)) errors.push(`${file}: ${target} -> ${resolved}`);
  }
}
assert.deepEqual(errors, [], `迁移相关 Markdown 链接失效：\n${errors.join('\n')}`);
console.log(`[SUCCESS] AI navigation: ${preserved} original documents preserve URLs/dates; ${checked} relative links checked.`);
