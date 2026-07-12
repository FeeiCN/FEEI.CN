#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const docsRoot = path.join(repoRoot, 'docs');

const CONTENT_TYPES = new Set([
  'hub',
  'article',
  'tutorial',
  'reference',
  'review',
  'archive',
  'essay',
  'gallery',
  'dashboard',
]);

const MAX_H2 = {
  hub: 5,
  article: 8,
};

const RULE_NAMES = {
  FRONTMATTER_MISSING: 'front matter 缺失',
  FRONTMATTER_UNCLOSED: 'front matter 未闭合',
  FRONTMATTER_SYNTAX: 'front matter 语法',
  CONTENT_TYPE_INVALID: 'content_type 非法',
  METADATA_REQUIRED: '元数据缺失',
  DESCRIPTION_LENGTH: 'description 过长',
  LAST_REVIEWED: '复核日期',
  TOO_MANY_H2: 'H2 过多',
  HEADING_DEPTH: '标题层级过深',
  NUMBERED_HEADING: '手写标题编号',
  STRONG_ASSERTION: '强断言',
  WIDE_TABLE: '宽表格',
  SUMMARY_SECTION: '总结节',
  ARTICLE_EVIDENCE: '观点文证据',
};

function usage() {
  return `用法：
  node scripts/check_docs_quality.mjs --all
  node scripts/check_docs_quality.mjs --changed [--base=<git-ref>]

参数：
  --all          审计 docs 下的 Markdown/MDX；历史质量问题仅提示
  --changed      检查 Git 工作区新增或修改的 Markdown/MDX
  --base=<ref>   从 ref 与 HEAD 的共同祖先开始比较，适用于 CI
  --help         显示帮助`;
}

function parseArgs(argv) {
  let mode = null;
  let base = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      return {help: true};
    }
    if (arg === '--all' || arg === '--changed') {
      if (mode) throw new Error('只能选择 --all 或 --changed 其中一种模式。');
      mode = arg.slice(2);
      continue;
    }
    if (arg.startsWith('--base=')) {
      base = arg.slice('--base='.length);
      if (!base) throw new Error('--base 不能为空。');
      continue;
    }
    if (arg === '--base') {
      base = argv[index + 1];
      index += 1;
      if (!base || base.startsWith('--')) throw new Error('--base 需要 Git ref。');
      continue;
    }
    throw new Error(`未知参数：${arg}`);
  }

  if (!mode) throw new Error('必须指定 --all 或 --changed。');
  if (base && mode !== 'changed') throw new Error('--base 只能与 --changed 一起使用。');
  return {help: false, mode, base};
}

function toPosix(filePath) {
  return filePath.split(path.sep).join(path.posix.sep);
}

function isMarkdownDoc(file) {
  const lower = file.toLowerCase();
  const basename = path.posix.basename(file);
  return file.startsWith('docs/')
    && !basename.startsWith('_')
    && (lower.endsWith('.md') || lower.endsWith('.mdx'));
}

function walkMarkdown(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkMarkdown(absolute));
    } else if (entry.isFile() && isMarkdownDoc(toPosix(path.relative(repoRoot, absolute)))) {
      files.push(toPosix(path.relative(repoRoot, absolute)));
    }
  }
  return files;
}

function runGit(args, {allowFailure = false} = {}) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    const detail = result.stderr.trim() || `退出码 ${result.status}`;
    throw new Error(`git ${args.join(' ')} 执行失败：${detail}`);
  }
  return result;
}

function nulList(value) {
  return value.split('\0').filter(Boolean);
}

function resolveHead() {
  const result = runGit(['rev-parse', '--verify', 'HEAD^{commit}'], {allowFailure: true});
  return result.status === 0 ? result.stdout.trim() : null;
}

function resolveComparisonBase(base, head) {
  if (!base) return head;
  if (!head) throw new Error('仓库尚无 HEAD，不能使用 --base。');

  const resolved = runGit(['rev-parse', '--verify', `${base}^{commit}`], {allowFailure: true});
  if (resolved.status !== 0) {
    throw new Error(`无法解析 --base=${base}，请确认该 ref 已 fetch。`);
  }

  const mergeBase = runGit(['merge-base', resolved.stdout.trim(), head], {allowFailure: true});
  if (mergeBase.status !== 0) {
    throw new Error(
      `无法计算 --base=${base} 与 HEAD 的共同祖先；请确认二者属于同一历史，CI checkout 使用 fetch-depth: 0。`,
    );
  }
  return mergeBase.stdout.trim();
}

function treeFiles(ref) {
  if (!ref) return new Set();
  const result = runGit(['ls-tree', '-r', '-z', '--name-only', ref, '--', 'docs']);
  return new Set(nulList(result.stdout).filter(isMarkdownDoc));
}

function nameStatusEntries(value) {
  const tokens = nulList(value);
  const entries = [];
  let index = 0;

  while (index < tokens.length) {
    const status = tokens[index];
    index += 1;
    const kind = status[0];
    if (kind === 'R' || kind === 'C') {
      const source = tokens[index];
      const file = tokens[index + 1];
      if (!source || !file) throw new Error('Git 返回了不完整的重命名记录。');
      entries.push({kind, source, file});
      index += 2;
    } else {
      const file = tokens[index];
      if (!file) throw new Error('Git 返回了不完整的文件状态记录。');
      entries.push({kind, file});
      index += 1;
    }
  }
  return entries;
}

function applyDiffEntries(states, entries, baselineFiles) {
  const changed = [];
  for (const entry of entries) {
    if (entry.kind === 'R') {
      const sourceState = states.get(entry.source)
        ?? (baselineFiles.has(entry.source) ? 'modified' : 'added');
      states.delete(entry.source);
      states.set(entry.file, sourceState);
      changed.push({file: entry.file, state: sourceState});
      continue;
    }
    if (entry.kind === 'C') {
      states.set(entry.file, 'added');
      changed.push({file: entry.file, state: 'added'});
      continue;
    }
    if (!states.has(entry.file)) {
      states.set(entry.file, baselineFiles.has(entry.file) ? 'modified' : 'added');
    }
    changed.push({file: entry.file, state: states.get(entry.file)});
  }
  return changed;
}

function gitDocumentSource(spec) {
  return runGit(['show', spec]).stdout;
}

function recordDocuments(documents, changed, origin, sourceFor) {
  for (const document of changed) {
    if (!isMarkdownDoc(document.file)) continue;
    const source = sourceFor(document.file);
    if (source === null) continue;
    documents.set(`${origin}\0${document.file}`, {...document, origin, source});
  }
}

function changedMarkdown(base) {
  const head = resolveHead();
  const comparisonBase = resolveComparisonBase(base, head);
  const baselineFiles = treeFiles(comparisonBase);
  const states = new Map();
  const documents = new Map();

  if (comparisonBase && head && comparisonBase !== head) {
    const committed = runGit([
      'diff',
      '--name-status',
      '-z',
      '--find-renames',
      '--diff-filter=ACMR',
      comparisonBase,
      head,
      '--',
      'docs',
    ]);
    const changed = applyDiffEntries(states, nameStatusEntries(committed.stdout), baselineFiles);
    recordDocuments(
      documents,
      changed,
      'HEAD',
      (file) => gitDocumentSource(`${head}:${file}`),
    );
  }

  if (head) {
    const staged = runGit([
      'diff',
      '--cached',
      '--name-status',
      '-z',
      '--find-renames',
      '--diff-filter=ACMR',
      head,
      '--',
      'docs',
    ]);
    const changed = applyDiffEntries(states, nameStatusEntries(staged.stdout), baselineFiles);
    recordDocuments(
      documents,
      changed,
      '暂存区',
      (file) => gitDocumentSource(`:${file}`),
    );
  } else {
    const staged = runGit(['ls-files', '-z', '--cached', '--', 'docs']);
    const changed = nulList(staged.stdout).map((file) => {
      states.set(file, 'added');
      return {file, state: 'added'};
    });
    recordDocuments(
      documents,
      changed,
      '暂存区',
      (file) => gitDocumentSource(`:${file}`),
    );
  }

  const working = runGit([
    'diff',
    '--name-status',
    '-z',
    '--find-renames',
    '--diff-filter=ACMR',
    '--',
    'docs',
  ]);
  const changedWorking = applyDiffEntries(
    states,
    nameStatusEntries(working.stdout),
    baselineFiles,
  );
  recordDocuments(documents, changedWorking, '工作树', (file) => {
    const absolute = path.join(repoRoot, file);
    return fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : null;
  });

  const untracked = runGit([
    'ls-files',
    '-z',
    '--others',
    '--exclude-standard',
    '--',
    'docs',
  ]);
  const changedUntracked = nulList(untracked.stdout).map((file) => {
    states.set(file, 'added');
    return {file, state: 'added'};
  });
  recordDocuments(documents, changedUntracked, '工作树', (file) => {
    const absolute = path.join(repoRoot, file);
    return fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : null;
  });

  return [...documents.values()].sort((left, right) => (
    left.file.localeCompare(right.file, 'zh-CN') || left.origin.localeCompare(right.origin, 'zh-CN')
  ));
}

function unicodeLength(value) {
  return [...value].length;
}

function descriptionLength(value) {
  if (/\p{Script=Han}/u.test(value)) {
    return {count: unicodeLength(value), unit: '个字符'};
  }
  const words = value.trim().match(/\S+/g) ?? [];
  return {count: words.length, unit: '个单词'};
}

function stripYamlComment(value) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        if (quote === "'" && value[index + 1] === "'") {
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '#' && (index === 0 || /\s/.test(value[index - 1]))) {
      return value.slice(0, index).trimEnd();
    }
  }
  return value.trimEnd();
}

function parseQuotedScalar(value) {
  const quote = value[0];
  let escaped = false;
  let result = '';

  for (let index = 1; index < value.length; index += 1) {
    const char = value[index];
    if (quote === '"' && escaped) {
      const escapes = {n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\'};
      result += escapes[char] ?? char;
      escaped = false;
      continue;
    }
    if (quote === '"' && char === '\\') {
      escaped = true;
      continue;
    }
    if (char === quote) {
      if (quote === "'" && value[index + 1] === "'") {
        result += "'";
        index += 1;
        continue;
      }
      const trailing = value.slice(index + 1).trim();
      if (trailing && !trailing.startsWith('#')) {
        return {error: '引号结束后存在无法解析的内容'};
      }
      return {value: result, kind: 'scalar'};
    }
    result += char;
  }
  return {error: '字符串引号未闭合'};
}

function validateFlowScalar(value) {
  const pairs = {'[': ']', '{': '}'};
  const stack = [];
  let quote = null;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        if (quote === "'" && value[index + 1] === "'") index += 1;
        else quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
    } else if (pairs[char]) {
      stack.push(pairs[char]);
    } else if (char === ']' || char === '}') {
      if (stack.pop() !== char) return '行内集合的括号不匹配';
    }
  }

  if (quote) return '行内集合中的字符串引号未闭合';
  if (stack.length > 0) return '行内集合的括号未闭合';
  return null;
}

function parseScalar(rawValue) {
  const value = stripYamlComment(rawValue.trim());
  if (!value || value === 'null' || value === 'Null' || value === 'NULL' || value === '~') {
    return {value: '', kind: 'null'};
  }
  if (value.startsWith('"') || value.startsWith("'")) return parseQuotedScalar(value);
  if (value.startsWith('[') || value.startsWith('{')) {
    const error = validateFlowScalar(value);
    return error ? {error} : {value, kind: 'collection'};
  }
  return {value, kind: 'scalar'};
}

function frontmatterIssue(code, line, message) {
  return {severity: 'error', code, line, message};
}

function parseFrontmatter(source) {
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const issues = [];
  const fields = new Map();

  if (!/^---\s*$/.test(lines[0] ?? '')) {
    issues.push(frontmatterIssue(
      'FRONTMATTER_MISSING',
      1,
      '文件必须以 --- 开始 front matter。',
    ));
    return {fields, issues, lines, bodyStart: 0};
  }

  let closingIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (/^---\s*$/.test(lines[index])) {
      closingIndex = index;
      break;
    }
  }

  if (closingIndex === -1) {
    issues.push(frontmatterIssue(
      'FRONTMATTER_UNCLOSED',
      1,
      '找不到结束 front matter 的 ---。',
    ));
    return {fields, issues, lines, bodyStart: lines.length};
  }

  let index = 1;
  while (index < closingIndex) {
    const rawLine = lines[index];
    const trimmed = rawLine.trim();
    const lineNumber = index + 1;

    if (!trimmed || trimmed.startsWith('#')) {
      index += 1;
      continue;
    }
    if (/^\s*\t/.test(rawLine) || /^ +\t/.test(rawLine)) {
      issues.push(frontmatterIssue(
        'FRONTMATTER_SYNTAX',
        lineNumber,
        'front matter 缩进不能使用 Tab。',
      ));
      index += 1;
      continue;
    }
    if (/^\s/.test(rawLine)) {
      issues.push(frontmatterIssue(
        'FRONTMATTER_SYNTAX',
        lineNumber,
        '顶层字段出现了意外缩进。',
      ));
      index += 1;
      continue;
    }

    const match = rawLine.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (!match) {
      issues.push(frontmatterIssue(
        'FRONTMATTER_SYNTAX',
        lineNumber,
        '顶层字段应使用 key: value 格式。',
      ));
      index += 1;
      continue;
    }

    const [, key, rawValue] = match;
    if (fields.has(key)) {
      issues.push(frontmatterIssue(
        'FRONTMATTER_SYNTAX',
        lineNumber,
        `字段 ${key} 重复定义。`,
      ));
    }

    if (/^[>|][+-]?\d*$/.test(rawValue.trim())) {
      const style = rawValue.trim()[0];
      const content = [];
      let child = index + 1;
      while (child < closingIndex) {
        const childLine = lines[child];
        if (childLine.trim() && !/^\s/.test(childLine)) break;
        if (childLine.includes('\t')) {
          issues.push(frontmatterIssue(
            'FRONTMATTER_SYNTAX',
            child + 1,
            'front matter 缩进不能使用 Tab。',
          ));
        }
        content.push(childLine.replace(/^ +/, ''));
        child += 1;
      }
      const value = style === '>' ? content.join(' ').trim() : content.join('\n').trim();
      fields.set(key, {value, kind: 'scalar', line: lineNumber});
      index = child;
      continue;
    }

    if (!rawValue.trim()) {
      let child = index + 1;
      let hasChildren = false;
      while (child < closingIndex) {
        const childLine = lines[child];
        if (!childLine.trim()) {
          child += 1;
          continue;
        }
        if (!/^\s/.test(childLine)) break;
        hasChildren = true;
        if (childLine.includes('\t')) {
          issues.push(frontmatterIssue(
            'FRONTMATTER_SYNTAX',
            child + 1,
            'front matter 缩进不能使用 Tab。',
          ));
        }
        child += 1;
      }
      fields.set(key, {
        value: '',
        kind: hasChildren ? 'collection' : 'null',
        line: lineNumber,
      });
      index = child;
      continue;
    }

    const parsed = parseScalar(rawValue);
    if (parsed.error) {
      issues.push(frontmatterIssue(
        'FRONTMATTER_SYNTAX',
        lineNumber,
        `${key}: ${parsed.error}。`,
      ));
      fields.set(key, {value: '', kind: 'invalid', line: lineNumber});
    } else {
      fields.set(key, {...parsed, line: lineNumber});
    }
    index += 1;
  }

  return {fields, issues, lines, bodyStart: closingIndex + 1};
}

function addIssue(issues, severity, code, file, line, message) {
  issues.push({severity, code, file, line, message});
}

function fieldValue(fields, key) {
  const field = fields.get(key);
  return field?.kind === 'scalar' ? field.value.trim() : '';
}

function validDate(value) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function needsLastReviewed(file, contentType) {
  if (contentType === 'tutorial' || contentType === 'reference') return true;
  if (!['hub', 'article', 'review'].includes(contentType)) return false;

  return file.startsWith('docs/01-健康幸福/')
    || file.startsWith('docs/03-财务自由/')
    || file.startsWith('docs/02-事业有成/01-安全工程/')
    || file.startsWith('docs/02-事业有成/03-人工智能/')
    || /(?:法律|法规|政策|竞业|合规)/.test(file);
}

function metadataChecks(document, parsed, mode, issues) {
  const {file, state} = document;
  const {fields} = parsed;
  const contentType = fieldValue(fields, 'content_type');
  const description = fieldValue(fields, 'description');
  const isAll = mode === 'all';
  const isAdded = state === 'added';

  if (contentType && !CONTENT_TYPES.has(contentType)) {
    addIssue(
      issues,
      'error',
      'CONTENT_TYPE_INVALID',
      file,
      fields.get('content_type').line,
      `content_type 必须是 ${[...CONTENT_TYPES].join('/')}，当前为 ${contentType}。`,
    );
  }

  if (isAdded) {
    for (const key of ['slug', 'icon', 'description', 'content_type']) {
      if (!fieldValue(fields, key)) {
        addIssue(
          issues,
          'error',
          'METADATA_REQUIRED',
          file,
          fields.get(key)?.line ?? 1,
          `新增文档必须提供非空 ${key}。`,
        );
      }
    }
  } else {
    for (const key of ['description', 'content_type']) {
      if (!fieldValue(fields, key)) {
        addIssue(
          issues,
          'warning',
          'METADATA_REQUIRED',
          file,
          fields.get(key)?.line ?? 1,
          `${isAll ? '历史文档' : '修改文档'}缺少 ${key}，建议迁移时补齐。`,
        );
      }
    }
  }

  const descriptionSize = descriptionLength(description);
  if (description && descriptionSize.count > 160) {
    addIssue(
      issues,
      isAdded ? 'error' : 'warning',
      'DESCRIPTION_LENGTH',
      file,
      fields.get('description').line,
      `description 共 ${descriptionSize.count} ${descriptionSize.unit}，应不超过 160 ${descriptionSize.unit}。`,
    );
  }

  if (needsLastReviewed(file, contentType)) {
    const reviewed = fieldValue(fields, 'last_reviewed');
    if (!reviewed || !validDate(reviewed)) {
      const severity = isAll ? 'warning' : 'error';
      addIssue(
        issues,
        severity,
        'LAST_REVIEWED',
        file,
        fields.get('last_reviewed')?.line ?? fields.get('content_type')?.line ?? 1,
        `${contentType} 属于教程、资料或高时效主题，必须提供 YYYY-MM-DD 格式且真实有效的 last_reviewed。`,
      );
    }
  }

  return CONTENT_TYPES.has(contentType) ? contentType : null;
}

function markdownBodyLines(parsed) {
  const result = [];
  let fence = null;

  for (let index = parsed.bodyStart; index < parsed.lines.length; index += 1) {
    const text = parsed.lines[index];
    const fenceMatch = text.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) {
        fence = {char: marker[0], length: marker.length};
      } else if (marker[0] === fence.char && marker.length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (!fence) result.push({text, line: index + 1});
  }
  return result;
}

function headingsFrom(lines) {
  const headings = [];
  for (const line of lines) {
    const match = line.text.match(/^ {0,3}(#{1,6})[ \t]+(.+?)\s*#*\s*$/);
    if (match) headings.push({level: match[1].length, title: match[2].trim(), line: line.line});
  }
  return headings;
}

function cleanHeading(title) {
  return title
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .trim();
}

function hasManualNumber(title) {
  const cleaned = cleanHeading(title);
  return /^(?:[1-9]\d?(?:\.\d+)*(?:[.、．)）]\s*|\s+)|[一二三四五六七八九十百]+[、.．)）]\s*)/.test(cleaned);
}

function structureChecks(document, contentType, lines, mode, issues) {
  if (!contentType) return;
  const headings = headingsFrom(lines);
  const severity = mode === 'all' ? 'warning' : 'error';
  const proseTypes = new Set(['hub', 'article', 'review', 'essay']);

  if (contentType === 'hub' || contentType === 'article') {
    const h2 = headings.filter((heading) => heading.level === 2);
    if (h2.length > MAX_H2[contentType]) {
      addIssue(
        issues,
        severity,
        'TOO_MANY_H2',
        document.file,
        h2[MAX_H2[contentType]].line,
        `${contentType} 有 ${h2.length} 个 H2，最多允许 ${MAX_H2[contentType]} 个。`,
      );
    }
  }

  if (proseTypes.has(contentType)) {
    const deep = headings.filter((heading) => heading.level >= 4);
    if (deep.length > 0) {
      addIssue(
        issues,
        severity,
        'HEADING_DEPTH',
        document.file,
        deep[0].line,
        `${contentType} 不使用 H4 及更深标题，共发现 ${deep.length} 处。`,
      );
    }

    const numbered = headings.filter(
      (heading) => heading.level >= 2 && hasManualNumber(heading.title),
    );
    if (numbered.length > 0) {
      addIssue(
        issues,
        severity,
        'NUMBERED_HEADING',
        document.file,
        numbered[0].line,
        `章节标题由主题自动编号，共发现 ${numbered.length} 处手写编号。`,
      );
    }
  }

  if (contentType === 'tutorial' || contentType === 'reference') {
    const deep = headings.filter((heading) => heading.level >= 5);
    if (deep.length > 0) {
      addIssue(
        issues,
        severity,
        'HEADING_DEPTH',
        document.file,
        deep[0].line,
        `${contentType} 可使用到 H4，共发现 ${deep.length} 处 H5 或更深标题。`,
      );
    }
  }
}

function splitTableCells(text) {
  let value = text.trim();
  if (!value.includes('|')) return [];
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|') && !value.endsWith('\\|')) value = value.slice(0, -1);

  const cells = [];
  let cell = '';
  let escaped = false;
  let codeTicks = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      cell += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      cell += char;
      escaped = true;
      continue;
    }
    if (char === '`') {
      let run = 1;
      while (value[index + run] === '`') run += 1;
      codeTicks = codeTicks === run ? 0 : (codeTicks === 0 ? run : codeTicks);
      cell += '`'.repeat(run);
      index += run - 1;
      continue;
    }
    if (char === '|' && codeTicks === 0) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function isTableDelimiter(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function semanticChecks(document, contentType, lines, issues) {
  const strongPattern = /(?:唯一(?:的|是)?|永远(?:不会|都是|是)?|绝对(?:不会|不能|是)?|必然(?:会|是|导致)?|毫无疑问|无一例外|所有人都|任何人都|一定(?:会|能|是)|本质(?:上)?(?:就是|是))/;
  const strongMatches = lines.filter((line) => strongPattern.test(line.text));
  const proseTypes = new Set(['hub', 'article', 'review', 'essay']);
  if (proseTypes.has(contentType) && strongMatches.length > 0) {
    addIssue(
      issues,
      'warning',
      'STRONG_ASSERTION',
      document.file,
      strongMatches[0].line,
      `发现 ${strongMatches.length} 行包含强断言；请核对证据强度，并补充适用边界。`,
    );
  }

  if (proseTypes.has(contentType)) {
    for (let index = 0; index < lines.length - 1; index += 1) {
      const header = splitTableCells(lines[index].text);
      const delimiter = splitTableCells(lines[index + 1].text);
      if (header.length > 4 && header.length === delimiter.length && isTableDelimiter(delimiter)) {
        addIssue(
          issues,
          'warning',
          'WIDE_TABLE',
          document.file,
          lines[index].line,
          `表格有 ${header.length} 列，移动端阅读可能困难；建议控制在 4 列以内或拆表。`,
        );
      }
    }
  }

  if (contentType === 'hub' || contentType === 'article') {
    const summaryHeadings = headingsFrom(lines).filter((heading) => {
      if (heading.level < 2) return false;
      const title = cleanHeading(heading.title);
      return /^(?:总结|小结|结语|收尾|结论|写在最后|最后的话)(?:$|[：:]|与|和|\s)/.test(title);
    });
    if (summaryHeadings.length > 0) {
      addIssue(
        issues,
        'warning',
        'SUMMARY_SECTION',
        document.file,
        summaryHeadings[0].line,
        `发现 ${summaryHeadings.length} 个总结式章节；正文应自行完成收束。`,
      );
    }
  }

  if (contentType !== 'article') return;
  let body = lines.map((line) => line.text).join('\n');
  body = body
    .replace(/!\[[^\]]*]\(https?:\/\/[^)]+\)/g, '')
    .replace(/<img\b[^>]*>/gi, '');
  const hasExternalLink = /(?<!!)\[[^\]]+]\(https?:\/\/[^)]+\)/.test(body)
    || /<a\b[^>]*href=["']https?:\/\//i.test(body)
    || /<https?:\/\/[^>]+>/.test(body)
    || /^\s*\[[^\]]+]:\s*<?https?:\/\//m.test(body)
    || /(?:^|[\s（(])https?:\/\/\S+/.test(body);
  const hasFirstPerson = /我(?:们)?/.test(body);
  const hasSceneMarker = /(?:我在|我曾|我亲自|我记得|我的经历|当时|那次|有一次|后来|工作中|生活中|实践中|经历过|遇到过)/.test(body);
  if (!hasExternalLink && !(hasFirstPerson && hasSceneMarker)) {
    addIssue(
      issues,
      'warning',
      'ARTICLE_EVIDENCE',
      document.file,
      parsedBodyFirstLine(lines),
      '观点文没有可识别的外部来源或个人场景；重要判断至少需要其中一种证据。',
    );
  }
}

function parsedBodyFirstLine(lines) {
  return lines.find((line) => line.text.trim())?.line ?? 1;
}

function inspectDocument(document, mode) {
  const absolute = path.join(repoRoot, document.file);
  const source = document.source ?? fs.readFileSync(absolute, 'utf8');
  const parsed = parseFrontmatter(source);
  const issues = parsed.issues.map((issue) => ({...issue, file: document.file}));
  const annotate = (issue) => ({
    ...issue,
    state: document.state,
    origin: document.origin,
  });

  if (parsed.issues.some((issue) => (
    issue.code === 'FRONTMATTER_MISSING' || issue.code === 'FRONTMATTER_UNCLOSED'
  ))) {
    return issues.map(annotate);
  }

  const contentType = metadataChecks(document, parsed, mode, issues);
  const lines = markdownBodyLines(parsed);
  structureChecks(document, contentType, lines, mode, issues);
  semanticChecks(document, contentType, lines, issues);
  return issues.map(annotate);
}

function printReport(mode, base, documents, issues) {
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  const result = errors.length > 0 ? '失败' : '通过';
  const modeLabel = mode === 'all'
    ? '全库审计（历史软问题不阻断）'
    : `变更检查${base ? `（基线：${base}）` : ''}`;

  console.log(`文档质量检查：${result}`);
  console.log(`模式：${modeLabel}`);
  const pageCount = new Set(documents.map((document) => document.file)).size;
  const versionLabel = documents.length > pageCount ? `；版本：${documents.length} 个` : '';
  console.log(`扫描：${pageCount} 篇${versionLabel}；错误：${errors.length}；警告：${warnings.length}`);

  if (mode === 'changed' && documents.length > 0) {
    const states = new Map(documents.map((document) => [document.file, document.state]));
    const added = [...states.values()].filter((state) => state === 'added').length;
    console.log(`变更：新增 ${added} 篇；修改 ${states.size - added} 篇`);
  }

  if (issues.length === 0) {
    console.log('未发现问题。');
    return;
  }

  const counts = new Map();
  for (const issue of issues) {
    const key = `${issue.severity}:${issue.code}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  console.log('\n规则统计：');
  for (const [key, count] of [...counts].sort()) {
    const [severity, code] = key.split(':');
    console.log(`- ${severity === 'error' ? '错误' : '警告'} ${RULE_NAMES[code] ?? code}：${count}`);
  }

  const sorted = [...issues].sort((left, right) => (
    left.file.localeCompare(right.file, 'zh-CN')
      || left.line - right.line
      || left.severity.localeCompare(right.severity)
  ));
  console.log('\n问题明细：');
  for (const issue of sorted) {
    const label = issue.severity === 'error' ? 'ERROR' : 'WARN';
    const origin = issue.origin ? `/${issue.origin}` : '';
    const state = mode === 'changed'
      ? ` ${issue.state === 'added' ? '新增' : '修改'}${origin}`
      : '';
    console.log(`[${label}${state}] ${issue.file}:${issue.line} [${RULE_NAMES[issue.code] ?? issue.code}] ${issue.message}`);
  }
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`参数错误：${error.message}\n`);
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  if (args.help) {
    console.log(usage());
    return;
  }

  if (!fs.existsSync(docsRoot)) {
    console.error(`检查失败：找不到文档目录 ${docsRoot}`);
    process.exitCode = 1;
    return;
  }

  try {
    const documents = args.mode === 'all'
      ? walkMarkdown(docsRoot)
        .sort((left, right) => left.localeCompare(right, 'zh-CN'))
        .map((file) => ({file, state: 'historical'}))
      : changedMarkdown(args.base);
    const issues = documents.flatMap((document) => inspectDocument(document, args.mode));
    printReport(args.mode, args.base, documents, issues);
    if (issues.some((issue) => issue.severity === 'error')) process.exitCode = 1;
  } catch (error) {
    console.error(`检查失败：${error.message}`);
    process.exitCode = 1;
  }
}

main();
