#!/usr/bin/env node

import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync, statSync} from 'node:fs';
import {dirname, resolve} from 'node:path';

const args = process.argv.slice(2);
const result = spawnSync(
  process.execPath,
  ['scripts/check_docs_quality.mjs', ...args],
  {encoding: 'utf8'},
);

const stdout = result.stdout ?? '';
const stderr = result.stderr ?? '';
process.stdout.write(stdout);
process.stderr.write(stderr);

if (result.error) throw result.error;

// Includes are a deterministic build dependency. Validate them independently
// of the heuristic writing-quality rules so a missing partial fails before the
// Docusaurus build. Scan all docs because an unchanged document can reference
// a partial removed by another commit.
const list = spawnSync('git', ['ls-files', 'docs/**/*.md', 'docs/*.md'], {encoding: 'utf8'});
if (list.error) throw list.error;
if (list.status !== 0) {
  process.stderr.write(list.stderr ?? '');
  process.exit(list.status ?? 1);
}

const includePattern = /<!--\s*@include\s+([^\s]+)\s*-->/g;
const includeErrors = [];
for (const file of list.stdout.split(/\r?\n/).filter(Boolean)) {
  let markdown;
  try {
    markdown = readFileSync(file, 'utf8');
  } catch (error) {
    includeErrors.push(`${file}: 无法读取文档：${error.message}`);
    continue;
  }
  for (const match of markdown.matchAll(includePattern)) {
    const target = resolve(dirname(file), match[1]);
    if (!existsSync(target) || !statSync(target).isFile()) {
      includeErrors.push(`${file}: Markdown include 不存在：${match[1]}`);
    }
  }
}

if (includeErrors.length > 0) {
  console.error(`\n质量门禁：发现 ${includeErrors.length} 个 Markdown include 确定性错误，阻断部署。`);
  for (const error of includeErrors) console.error(`[ERROR] [Markdown include 缺失] ${error}`);
  process.exit(1);
}

if (result.status === 0) process.exit(0);

// Only deterministic structural/data-contract problems should block deploy.
// Writing-style rules are useful review signals, but are too heuristic to be
// release gates (e.g. `9 月目标` was previously mistaken for manual numbering).
const blockingRuleNames = new Set([
  'front matter 缺失',
  'front matter 未闭合',
  'front matter 语法',
  'content_type 非法',
  '元数据缺失',
  'description 过长',
  '复核日期',
  'Markdown include 缺失',
]);

const errorLines = stdout
  .split(/\r?\n/)
  .filter((line) => /^\[ERROR(?:\s|\])/.test(line));

const blockingErrors = errorLines.filter((line) => {
  const match = line.match(/\[([^\]]+)]\s+[^[]*$/);
  if (match && blockingRuleNames.has(match[1])) return true;
  return [...blockingRuleNames].some((name) => line.includes(`[${name}]`));
});

if (blockingErrors.length > 0) {
  console.error(`\n质量门禁：发现 ${blockingErrors.length} 个确定性错误，阻断部署。`);
  process.exit(result.status ?? 1);
}

if (errorLines.length > 0) {
  console.warn(`\n质量门禁：${errorLines.length} 个写作/结构启发式问题降级为警告，不阻断部署。`);
  console.warn('原则：确定性错误负责阻断，内容与风格问题负责提示。');
  process.exit(0);
}

// Unknown failure: fail closed so script/runtime failures are never hidden.
process.exit(result.status ?? 1);
