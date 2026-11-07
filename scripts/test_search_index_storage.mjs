import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import test from 'node:test';
import {gunzipSync} from 'node:zlib';
import lunr from 'lunr';
import {compactIndex, writeSearchIndex} from './search_index_storage.mjs';
import {loadSearchIndex, preloadSearchIndex} from '../src/utils/loadSearchIndex.mjs';

const require = createRequire(import.meta.url);
const index = lunr(function () {
  this.ref('i');
  this.field('t');
  this.metadataWhitelist = ['position'];
  this.add({i: 1, t: 'ssrf ssrf ssrf ssrf ssrf attack'});
  this.add({i: 2, t: 'attack prevention'});
});
const groups = Array.from({length: 5}, () => ({documents: [{i: 1, t: 'ssrf ssrf ssrf ssrf ssrf attack'}, {i: 2, t: 'attack prevention'}], index: index.toJSON()}));

test('position compaction preserves corpus, query rank and score', () => {
  const compacted = compactIndex(structuredClone(groups));
  assert.deepEqual(compacted[0].documents, groups[0].documents);
  for (const query of ['ssrf', 'attack', 'att*', 'atack~1', '+ssrf +attack']) {
    const ranked = (item) => lunr.Index.load(item.index).search(query).map(({ref, score}) => ({ref, score}));
    assert.deepEqual(ranked(compacted[0]), ranked(groups[0]), query);
  }
  const positions = lunr.Index.load(compacted[0].index).search('ssrf')[0].matchData.metadata.ssrf.t.position;
  assert.equal(positions.length, 3);
  assert.deepEqual(positions, [[0, 4], [5, 4], [10, 4]]);
});

test('compressed shards round-trip and loader handles HTTP decoding and legacy fallback', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'feei-search-storage-'));
  const originalFetch = globalThis.fetch;
  try {
    const compacted = compactIndex(structuredClone(groups));
    const manifest = await writeSearchIndex(directory, compacted);
    assert.ok(manifest.compressedBytes < manifest.uncompressedBytes);
    const requests = [];
    let autoDecoded = false;
    let legacy = false;
    let badManifest = false;
    let missingShard = false;
    globalThis.fetch = async (target) => {
      const url = new URL(target);
      requests.push(url.pathname);
      if (url.pathname.endsWith('search-index-manifest.json') && legacy) return new Response('', {status: 404});
      if (url.pathname.endsWith('search-index-manifest.json') && badManifest) return Response.json({...manifest, groups: [{file: '../private.json'}, ...manifest.groups.slice(1)]});
      if (missingShard && url.pathname.endsWith('.gz')) return new Response('', {status: 404});
      let bytes = await fs.readFile(path.join(directory, url.pathname.split('/').slice(2).join('/')));
      if (autoDecoded && url.pathname.endsWith('.gz')) bytes = gunzipSync(bytes);
      return new Response(bytes);
    };
    await preloadSearchIndex('https://example.com/first/search-index.json');
    assert.equal(requests.length, 1, 'preload must fetch only manifest');
    assert.deepEqual(await loadSearchIndex('https://example.com/first/search-index.json'), compacted);
    assert.equal(requests.filter((url) => url.endsWith('/search-index.json')).length, 0);
    autoDecoded = true;
    assert.deepEqual(await loadSearchIndex('https://example.com/decoded/search-index.json'), compacted);
    legacy = true;
    assert.deepEqual(await loadSearchIndex('https://example.com/legacy/search-index.json'), compacted);
    legacy = false;
    badManifest = true;
    await assert.rejects(loadSearchIndex('https://example.com/unsafe/search-index.json'), /清单格式无效/);
    badManifest = false;
    missingShard = true;
    await assert.rejects(loadSearchIndex('https://example.com/missing/search-index.json'), /分片暂不可用/);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(directory, {recursive: true, force: true});
  }
});

test('worker adapter matches installed plugin and preserves contextual URL', async () => {
  const adapter = require('./search_worker_loader.cjs');
  const entry = require.resolve('@easyops-cn/docusaurus-search-local');
  const worker = path.resolve(path.dirname(entry), '../../client/client/theme/worker.js');
  const adapted = adapter(await fs.readFile(worker, 'utf8'));
  assert.match(adapted, /const json = await loadSearchIndex\(url\)/);
  assert.match(adapted, /await preloadSearchIndex/);
  assert.match(adapted, /searchContext\.replace/);
  assert.throws(() => adapter('upstream changed'), /接口已变化/);
});
