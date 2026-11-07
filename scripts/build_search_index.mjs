#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {compactIndex, writeSearchIndex} from './search_index_storage.mjs';

const require = createRequire(import.meta.url);

function loadInternal(relativePath) {
  const entry = require.resolve('@easyops-cn/docusaurus-search-local');
  return require(path.join(path.dirname(entry), 'utils', relativePath));
}

const {parse} = loadInternal('parse');
const {buildIndex} = loadInternal('buildIndex');

const outDir = path.resolve(process.argv[2] ?? 'build');
const baseUrl = '/';
const statusFile = path.join(outDir, 'search-index-status.json');
const startedAt = Date.now();

async function writeStatus(status, extra = {}) {
  const payload = {
    status,
    startedAt: new Date(startedAt).toISOString(),
    updatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    ...extra,
  };
  const temp = `${statusFile}.tmp`;
  await fs.writeFile(temp, JSON.stringify(payload, null, 2), 'utf8');
  await fs.rename(temp, statusFile);
}

const config = {
  language: ['zh'],
  ignoreCssSelectors: [],
  forceIgnoreNoIndex: false,
  removeDefaultStopWordFilter: [],
  removeDefaultStemmer: false,
  zhUserDictPath: path.resolve('config/search-zh-dict.txt'),
};

async function collectHtmlFiles(dir) {
  const result = [];
  const entries = await fs.readdir(dir, {withFileTypes: true});
  await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...await collectHtmlFiles(fullPath));
    } else if (entry.isFile() && entry.name === 'index.html') {
      result.push(fullPath);
    }
  }));
  return result;
}

function fileToUrl(filePath) {
  const relative = path.relative(outDir, path.dirname(filePath)).split(path.sep).join('/');
  return relative ? `${baseUrl}${relative}` : baseUrl;
}

try {
  await writeStatus('running');

  const htmlFiles = (await collectHtmlFiles(outDir)).sort();
  const paths = htmlFiles.map((filePath) => ({
    filePath,
    url: fileToUrl(filePath),
    type: 'docs',
  }));

  console.log(`[search-index] parsing ${paths.length} generated pages`);
  const parsed = new Array(paths.length);
  let cursor = 0;
  await Promise.all(Array.from({length: Math.min(8, paths.length)}, async () => {
    while (cursor < paths.length) {
      const position = cursor++;
      const item = paths[position];
      const html = await fs.readFile(item.filePath, 'utf8');
      parsed[position] = parse(html.replace(/(\d+月)工资/g, '$1 工资'), item.type, item.url, config);
    }
  }));
  const allDocuments = [[], [], [], [], []];
  let nextId = 0;
  parsed.forEach((document, position) => {
    if (!document) return;
    const {pageTitle, description, keywords, sections, breadcrumb} = document;
    const url = paths[position].url;
    const titleId = ++nextId;
    allDocuments[0].push({i: titleId, t: pageTitle, u: url, b: breadcrumb});
    if (description) allDocuments[2].push({i: titleId, t: description, s: pageTitle, u: url, p: titleId});
    if (keywords) allDocuments[3].push({i: titleId, t: keywords, s: pageTitle, u: url, p: titleId});
    for (const section of sections) {
      let hash = section.hash;
      if (hash && !hash.startsWith('#') && hash.includes('#')) {
        if (!hash.startsWith(url + '#')) continue;
        hash = hash.slice(url.length);
      }
      if (section.title !== pageTitle) allDocuments[1].push({i: ++nextId, t: section.title, u: url, h: hash, p: titleId});
      if (section.content) allDocuments[4].push({i: ++nextId, t: section.content, s: section.title || pageTitle, u: url, h: hash, p: titleId});
    }
  });
  console.log('[search-index] building index');
  const searchIndex = compactIndex(buildIndex(allDocuments, config));
  const manifest = await writeSearchIndex(outDir, searchIndex);
  await writeStatus('success', {pages: paths.length, indexFile: 'search-index-manifest.json',
    documents: allDocuments.map((documents) => documents.length),
    uncompressedBytes: manifest.uncompressedBytes, compressedBytes: manifest.compressedBytes});
  const targetFile = path.join(outDir, 'search-index-manifest.json');
  console.log(`[search-index] updated ${targetFile} in ${((Date.now() - startedAt) / 1000).toFixed(2)}s`);
} catch (error) {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  try {
    await writeStatus('failure', {error: message});
  } catch {
    // Preserve the original indexing failure.
  }
  console.error('[search-index] failed:', message);
  process.exitCode = 1;
}
