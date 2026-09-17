import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root = process.cwd();
function typecheck(cwd) {
  const result = spawnSync('npm', ['run', 'typecheck'], {cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
  if (result.error) throw result.error;
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const diagnostics = output.split(/\r?\n/).filter((line) => /^.+\(\d+,\d+\): error TS\d+:/.test(line));
  return {status: result.status, output, diagnostics};
}
function git(args) {
  const result = spawnSync('git', args, {cwd: root, encoding: 'utf8'});
  if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr);
  return result.stdout;
}

const head = typecheck(root);
process.stdout.write(head.output);
if (head.status === 0) {
  console.log('全仓类型检查通过。');
} else {
  if (!head.diagnostics.length) throw new Error('类型检查未生成可比较诊断，不能忽略失败。');
  const base = git(['merge-base', 'origin/main', 'HEAD']).trim();
  if (git(['diff', '--name-only', base, 'HEAD', '--', 'package.json', 'package-lock.json', 'tsconfig.json']).trim()) {
    throw new Error('依赖或类型配置发生变化，必须完整通过类型检查，不能复用基线依赖。');
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'music-types-'));
  const baseline = path.join(temporary, 'baseline');
  try {
    git(['worktree', 'add', '--detach', baseline, base]);
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(baseline, 'node_modules'), 'dir');
    const previous = typecheck(baseline);
    if (previous.status !== 0 && !previous.diagnostics.length) throw new Error('基线检查异常，不能确认存量错误。');
    const existing = new Set(previous.diagnostics);
    const introduced = head.diagnostics.filter((line) => !existing.has(line));
    console.log(`基线 ${base}：${previous.diagnostics.length} 项类型错误；本次新增：${introduced.length} 项。`);
    if (introduced.length) throw new Error(`新增类型错误：\n${introduced.join('\n')}`);
    console.log('仅存在基线中相同的类型诊断；音乐改动未引入新增类型错误。完整构建和浏览器回归仍须通过。');
  } finally {
    try { git(['worktree', 'remove', '--force', baseline]); } finally { fs.rmSync(temporary, {recursive: true, force: true}); }
  }
}
