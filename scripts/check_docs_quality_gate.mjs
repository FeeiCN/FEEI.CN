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

// Includes are deterministic build dependencies. Use NUL-delimited git output
// so Chinese, spaces and other special characters are returned as literal paths
// instead of Git's quoted/core.quotePath representation.
const list = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'docs'], {encoding: 'utf8'});
if (list.error) throw list.error;
if (list.status !== 0) {
  process.stderr.write(list.stderr ?? '');
  process.exit(list.status ?? 1);
}

const includePattern = /<!--\s*@include\s+([^\s]+)\s*-->/g;
const includeErrors = [];
const markdownFiles = [...new Set(list.stdout.split('\0'))]
  .filter((file) => file.endsWith('.md') && existsSync(file));
for (const file of markdownFiles) {
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

// Validate the whole compliance subtree, including inbound links after moves.
if (existsSync('docs/01-网络安全/01-网络空间安全/03-安全体系/01-安全合法合规')) {
  const compliance = spawnSync(process.execPath, ['scripts/maintain_compliance_docs.mjs', '--check'], {stdio: 'inherit'});
  if (compliance.error) throw compliance.error;
  if (compliance.status !== 0) process.exit(compliance.status ?? 1);
}

if (result.status === 0) process.exit(0);

const blockingRuleNames = new Set([
  'front matter 缺失',
  'front matter 未闭合',
  'front matter 语法',
  '元数据缺失',
  'description 过长',
  'Markdown include 缺失',
]);

const errorLines = stdout
  .split(/\r?\n/)
  .filter((line) => /^\[ERROR(?:\s|\])/.test(line));

// `icon` is presentation metadata, not a content/build contract. Historical
// reference documents can become "added" after a large path migration and
// would otherwise block deploy even though Docusaurus can render them safely.
// Keep reporting the issue, but do not make a missing icon a release blocker.
const nonBlockingMetadataError = (line) => (
  line.includes('[元数据缺失]') && line.includes('新增文档必须提供非空 icon')
);

const blockingErrors = errorLines.filter((line) => {
  if (nonBlockingMetadataError(line)) return false;
  const match = line.match(/\[([^\]]+)]\s+[^[]*$/);
  if (match && blockingRuleNames.has(match[1])) return true;
  return [...blockingRuleNames].some((name) => line.includes(`[${name}]`));
});

if (blockingErrors.length > 0) {
  console.error(`\n质量门禁：发现 ${blockingErrors.length} 个确定性错误，阻断部署。`);
  process.exit(result.status ?? 1);
}

if (errorLines.length > 0) {
  console.warn(`\n质量门禁：${errorLines.length} 个写作/展示类问题降级为警告，不阻断部署。`);
  console.warn('原则：确定性错误负责阻断，内容、风格与展示元数据问题负责提示。');
  process.exit(0);
}

process.exit(result.status ?? 1);
