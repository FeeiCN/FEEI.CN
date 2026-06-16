#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const docsDir = path.join(root, 'docs');
const mediaDir = path.join(root, 'static', 'media');
const isDryRun = process.argv.includes('--dry-run');

const mediaExtensions = new Set([
  '.avif',
  '.docx',
  '.flac',
  '.gif',
  '.heic',
  '.heif',
  '.jpeg',
  '.jpg',
  '.m4a',
  '.mov',
  '.mp3',
  '.mp4',
  '.pdf',
  '.png',
  '.svg',
  '.wav',
  '.webm',
  '.webp',
]);

const textExtensions = new Set(['.md', '.mdx']);

function toPosix(filePath) {
  return filePath.split(path.sep).join(path.posix.sep);
}

function walk(dir) {
  const entries = fs.readdirSync(dir, {withFileTypes: true});
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replacementCandidates(relativeFromDoc) {
  const normalized = toPosix(relativeFromDoc);
  const candidates = new Set([normalized]);
  if (!normalized.startsWith('../') && normalized !== '..') {
    candidates.add(`./${normalized}`);
  }
  return [...candidates].sort((a, b) => b.length - a.length);
}

function replaceReferences(text, oldTarget, newTarget) {
  const escaped = escapeRegExp(oldTarget);
  return text
    .replace(new RegExp(`(\\]\\()${escaped}([)#])`, 'g'), `$1${newTarget}$2`)
    .replace(new RegExp(`(\\]\\(<)${escaped}(>)`, 'g'), `$1${newTarget}$2`)
    .replace(new RegExp(`((?:src|href)=["'])${escaped}(["'])`, 'g'), `$1${newTarget}$2`);
}

function hasArticleEntry(relativeDir) {
  const absoluteDir = path.join(docsDir, relativeDir);
  const basename = path.basename(relativeDir);
  return (
    fs.existsSync(path.join(absoluteDir, 'index.md')) ||
    fs.existsSync(path.join(absoluteDir, 'index.mdx')) ||
    fs.existsSync(path.join(absoluteDir, 'README.md')) ||
    fs.existsSync(path.join(absoluteDir, `${basename}.md`)) ||
    fs.existsSync(path.join(absoluteDir, `${basename}.mdx`))
  );
}

function mediaTargetRelativePath(relativeToDocs) {
  const parts = toPosix(relativeToDocs).split('/');
  const filename = parts.pop();
  let articleDirLength = 0;

  for (let length = parts.length; length >= 1; length -= 1) {
    const relativeDir = parts.slice(0, length).join('/');
    if (hasArticleEntry(relativeDir)) {
      articleDirLength = length;
      break;
    }
  }

  if (articleDirLength === 0) {
    articleDirLength = Math.max(1, parts.length);
  }

  const mediaDirName = parts[articleDirLength - 1];
  return [mediaDirName, ...parts.slice(articleDirLength), filename].join('/');
}

if (!fs.existsSync(docsDir)) {
  throw new Error(`docs directory not found: ${docsDir}`);
}

const allDocsFiles = walk(docsDir);
const mediaFiles = allDocsFiles.filter((file) =>
  mediaExtensions.has(path.extname(file).toLowerCase()),
);
const textFiles = allDocsFiles.filter((file) =>
  textExtensions.has(path.extname(file).toLowerCase()),
);

let changedTextFiles = 0;
let rewrittenReferences = 0;

for (const textFile of textFiles) {
  const textFileDir = path.dirname(textFile);
  let content = fs.readFileSync(textFile, 'utf8');
  let nextContent = content;

  for (const mediaFile of mediaFiles) {
    const mediaRelativeToDocs = toPosix(path.relative(docsDir, mediaFile));
    const mediaRelativeToStaticMedia = mediaTargetRelativePath(mediaRelativeToDocs);
    const publicTarget = `/${toPosix(path.posix.join('media', mediaRelativeToStaticMedia))}`;
    const relativeFromTextFile = path.relative(textFileDir, mediaFile);

    for (const candidate of replacementCandidates(relativeFromTextFile)) {
      const before = nextContent;
      nextContent = replaceReferences(nextContent, candidate, publicTarget);
      if (nextContent !== before) {
        rewrittenReferences += before.split(candidate).length - nextContent.split(candidate).length;
      }
    }
  }

  if (nextContent !== content) {
    changedTextFiles += 1;
    if (!isDryRun) {
      fs.writeFileSync(textFile, nextContent);
    }
  }
}

let movedFiles = 0;

for (const mediaFile of mediaFiles) {
  const relativeToDocs = toPosix(path.relative(docsDir, mediaFile));
  const destination = path.join(mediaDir, ...mediaTargetRelativePath(relativeToDocs).split('/'));
  movedFiles += 1;

  if (isDryRun) continue;

  fs.mkdirSync(path.dirname(destination), {recursive: true});
  if (fs.existsSync(destination)) {
    const sourceStat = fs.statSync(mediaFile);
    const destinationStat = fs.statSync(destination);
    if (sourceStat.size !== destinationStat.size) {
      throw new Error(`destination already exists with different size: ${destination}`);
    }
    fs.unlinkSync(mediaFile);
  } else {
    fs.renameSync(mediaFile, destination);
  }
}

console.log(
  `${isDryRun ? '[dry-run] ' : ''}media files: ${movedFiles}, changed docs: ${changedTextFiles}, rewritten references: ${rewrittenReferences}`,
);
