#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);

function loadInternal(relativePath) {
  const entry = require.resolve('@easyops-cn/docusaurus-search-local');
  // Package entry is dist/server/index.js. Resolve internal utilities from it
  // instead of relying on package subpath exports.
  return require(path.join(path.dirname(entry), 'utils', relativePath));
}

const {scanDocuments} = loadInternal('scanDocuments');
const {buildIndex} = loadInternal('buildIndex');

const outDir = path.resolve(process.argv[2] ?? 'build');
const baseUrl = '/';

// These are the effective options used by feei.cn. Only fields consumed by
// scanDocuments()/parse() and buildIndex() are required here.
const config = {
  language: ['zh'],
  ignoreCssSelectors: [],
  forceIgnoreNoIndex: false,
  removeDefaultStopWordFilter: [],
  removeDefaultStemmer: false,
  zhUserDict: undefined,
  zhUserDictPath: undefined,
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

const startedAt = Date.now();
const htmlFiles = (await collectHtmlFiles(outDir)).sort();
const paths = htmlFiles.map((filePath) => ({
  filePath,
  url: fileToUrl(filePath),
  type: 'docs',
}));

console.log(`[search-index] parsing ${paths.length} generated pages`);
const allDocuments = await scanDocuments(paths, config);
console.log(`[search-index] building index`);
const searchIndex = buildIndex(allDocuments, config);

const tempFile = path.join(outDir, '.search-index.json.tmp');
const targetFile = path.join(outDir, 'search-index.json');
await fs.writeFile(tempFile, JSON.stringify(searchIndex), 'utf8');
await fs.rename(tempFile, targetFile);

console.log(`[search-index] updated ${targetFile} in ${((Date.now() - startedAt) / 1000).toFixed(2)}s`);
