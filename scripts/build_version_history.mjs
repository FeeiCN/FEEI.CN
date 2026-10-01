import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const siteDir = process.cwd();
const DEFAULT_OUTPUT = path.join(siteDir, 'static/version-history.json');
const REPOSITORY_URL = 'https://github.com/FeeiCN/FEEI.CN';

const noiseSubjectPattern = /(格式|格式化|统一|迁移|批量|目录|front.?matter|元数据|slug|图标|icon|description|描述|日期格式|时间格式|更新时间|改名|重命名|移动|整理目录|清理|转换|换成|同步|修正链接|链接修复|编号|分类|sidebar|侧边栏|面包屑|导航|命名|规范)/iu;

function parseArguments(argv) {
  const options = {output: DEFAULT_OUTPUT, head: 'HEAD'};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--output' && argv[index + 1]) options.output = path.resolve(siteDir, argv[++index]);
    else if (argument === '--head' && argv[index + 1]) options.head = argv[++index];
    else if (argument === '--since' && argv[index + 1]) options.since = argv[++index];
  }
  return options;
}

function git(args) {
  return execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd: siteDir,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

function isArticleFile(filePath) {
  return filePath.startsWith('docs/') && /\.(?:md|mdx)$/u.test(filePath);
}

function expandRenamePath(filePath) {
  const braceMatch = filePath.match(/^(.*)\{([^{}]+?) => ([^{}]+?)\}(.*)$/u);
  if (braceMatch) {
    return {oldPath: `${braceMatch[1]}${braceMatch[2]}${braceMatch[4]}`, newPath: `${braceMatch[1]}${braceMatch[3]}${braceMatch[4]}`};
  }
  const renameMatch = filePath.match(/^(.*?) => (.*)$/u);
  if (renameMatch) return {oldPath: renameMatch[1], newPath: renameMatch[2]};
  return {newPath: filePath};
}

function parseCommitMarker(line) {
  if (!line.startsWith('@@COMMIT@@')) return null;
  const values = line.slice('@@COMMIT@@'.length).split('\x1f');
  if (values.length < 4 || !/^[0-9a-f]{40}$/u.test(values[0])) return null;
  return {sha: values[0], date: values[1], subject: values[2], parents: values[3].trim().split(/\s+/u).filter(Boolean)};
}

function parseNumstat(output) {
  const commits = [];
  let current = null;
  for (const line of output.split('\n')) {
    const marker = parseCommitMarker(line);
    if (marker) {
      if (current) commits.push(current);
      current = {...marker, files: []};
      continue;
    }
    if (!current || !line.trim()) continue;
    const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/u);
    if (!match) continue;
    const rename = expandRenamePath(match[3]);
    if (!isArticleFile(rename.newPath)) continue;
    current.files.push({
      path: rename.newPath,
      previousPath: rename.oldPath,
      additions: match[1] === '-' ? 0 : Number(match[1]),
      deletions: match[2] === '-' ? 0 : Number(match[2]),
    });
  }
  if (current) commits.push(current);
  return commits.filter((commit) => commit.files.length > 0);
}

function parseStatuses(output) {
  const statuses = new Map();
  let currentSha = null;
  for (const line of output.split('\n')) {
    const marker = parseCommitMarker(line);
    if (marker) {
      currentSha = marker.sha;
      continue;
    }
    if (!currentSha || !line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 2 || !/^[A-Z][0-9]*$/u.test(parts[0])) continue;
    const status = parts[0];
    const newPath = status.startsWith('R') && parts.length > 2 ? parts[2] : parts[1];
    const oldPath = status.startsWith('R') && parts.length > 2 ? parts[1] : undefined;
    if (!isArticleFile(newPath) && (!oldPath || !isArticleFile(oldPath))) continue;
    const key = `${currentSha}\x1f${newPath}`;
    statuses.set(key, {status: status[0], oldPath});
  }
  return statuses;
}

function readTitle(filePath) {
  try {
    const content = fs.readFileSync(path.join(siteDir, filePath), 'utf8');
    const title = content.match(/^title:\s*["']?(.+?)["']?\s*$/mu)?.[1]?.trim();
    if (title) return title;
  } catch {
    // A deleted historical file has no current title. Use its filename below.
  }
  return path.basename(filePath).replace(/\.(?:md|mdx)$/u, '');
}

function shouldExclude(commit) {
  const fileCount = commit.files.length;
  const churn = commit.files.reduce((total, file) => total + file.additions + file.deletions, 0);
  const perFileChurn = commit.files.map((file) => file.additions + file.deletions).sort((a, b) => a - b);
  const median = perFileChurn.length === 0
    ? 0
    : perFileChurn[Math.floor(perFileChurn.length / 2)];
  const subjectNoise = noiseSubjectPattern.test(commit.subject);
  if (fileCount >= 20 && (subjectNoise || median <= 6)) return {reason: 'bulk'};
  if (subjectNoise) return {reason: 'subject'};
  if (churn === 0) return {reason: 'empty'};
  return null;
}

function resolveAlias(renameMap, filePath) {
  let current = filePath;
  const seen = new Set();
  while (renameMap.has(current) && !seen.has(current)) {
    seen.add(current);
    current = renameMap.get(current);
  }
  return current;
}

function buildHistory(options) {
  const resolvedHead = git(['rev-parse', options.head]).trim();
  const logArguments = [
    'log', '--date=iso-strict', '--format=@@COMMIT@@%H%x1f%aI%x1f%s%x1f%P',
    '--numstat', '--find-renames=50%', options.head,
  ];
  if (options.since) logArguments.push(`--since=${options.since}`);
  logArguments.push('--', 'docs');
  const commits = parseNumstat(git(logArguments));

  const statusArguments = [
    'log', '--date=iso-strict', '--format=@@COMMIT@@%H%x1f%aI%x1f%s%x1f%P',
    '--name-status', '--find-renames=50%', options.head,
  ];
  if (options.since) statusArguments.push(`--since=${options.since}`);
  statusArguments.push('--', 'docs');
  const statuses = parseStatuses(git(statusArguments));
  const renameMap = new Map();
  const articles = new Map();
  const includedCommits = new Set();
  const excluded = {bulk: 0, subject: 0, empty: 0};
  let fileRecordsSeen = 0;

  for (const commit of commits) {
    fileRecordsSeen += commit.files.length;
    // Keep rename aliases even when the rename commit itself is filtered as
    // directory/metadata noise. This lets older revisions remain grouped
    // under the article's current path.
    for (const file of commit.files) {
      const status = statuses.get(`${commit.sha}\x1f${file.path}`);
      const oldPath = status?.oldPath || file.previousPath;
      if ((status?.status === 'R' || file.previousPath) && oldPath) renameMap.set(oldPath, file.path);
    }
    const exclusion = shouldExclude(commit);
    if (exclusion) {
      excluded[exclusion.reason] += 1;
      continue;
    }
    includedCommits.add(commit.sha);
    for (const file of commit.files) {
      const status = statuses.get(`${commit.sha}\x1f${file.path}`) || {
        status: file.previousPath ? 'R' : 'M',
        oldPath: file.previousPath,
      };
      const currentPath = resolveAlias(renameMap, file.path);
      const key = resolveAlias(renameMap, currentPath);
      if (!articles.has(key)) {
        articles.set(key, {path: key, title: readTitle(key), current: fs.existsSync(path.join(siteDir, key)), changes: []});
      }
      const article = articles.get(key);
      article.changes.push({
        sha: commit.sha,
        date: commit.date,
        summary: commit.subject,
        source: 'git',
        changeType: status.status === 'A' ? 'added' : status.status === 'D' ? 'deleted' : status.status === 'R' ? 'renamed' : 'updated',
        additions: file.additions,
        deletions: file.deletions,
        previousPath: status.oldPath || file.previousPath,
        commitUrl: `${REPOSITORY_URL}/commit/${commit.sha}`,
      });
    }
  }

  const articleList = [...articles.values()]
    .map((article) => ({...article, changes: article.changes.sort((a, b) => b.date.localeCompare(a.date))}))
    .sort((a, b) => (b.changes[0]?.date || '').localeCompare(a.changes[0]?.date || '') || a.title.localeCompare(b.title, 'zh-CN'));
  const changesIncluded = articleList.reduce((total, article) => total + article.changes.length, 0);
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: {type: 'git', repository: REPOSITORY_URL, head: resolvedHead, scope: 'docs/**/*.md, docs/**/*.mdx'},
    filters: {
      included: '按文章文件聚合 Git 内容变更；排除提交主题明显属于格式/元数据/目录迁移，或一次性批量改动且单文件改动很小的提交',
      excludedCommits: excluded,
    },
    summary: {
      commitsSeen: commits.length,
      commitsIncluded: includedCommits.size,
      fileRecordsSeen,
      changesIncluded,
      articlesIncluded: articleList.length,
    },
    articles: articleList,
  };
}

const options = parseArguments(process.argv.slice(2));
const history = buildHistory(options);
fs.mkdirSync(path.dirname(options.output), {recursive: true});
fs.writeFileSync(options.output, `${JSON.stringify(history, null, 2)}\n`);
console.log(JSON.stringify(history.summary));
