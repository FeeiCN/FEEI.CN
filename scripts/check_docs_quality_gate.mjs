#!/usr/bin/env node

import {spawnSync} from 'node:child_process';

// Run the full quality checker, but keep stylistic/heuristic rules advisory.
// The underlying checker still prints every finding for visibility.
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
