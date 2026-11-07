import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';

export function compactIndex(groups) {
  return groups.map(({documents, index}) => {
    const serialized = typeof index.toJSON === 'function' ? index.toJSON() : index;
    for (const [, posting] of serialized.invertedIndex) {
      for (const [field, references] of Object.entries(posting)) {
        if (field === '_index') continue;
        for (const metadata of Object.values(references)) {
          if (metadata.position) metadata.position = metadata.position.slice(0, 3);
        }
      }
    }
    return {documents, index: serialized};
  });
}

async function atomicWrite(file, content) {
  await fs.writeFile(`${file}.tmp`, content);
  await fs.rename(`${file}.tmp`, file);
}

export async function writeSearchIndex(outDir, groups) {
  const manifest = {version: 1, groups: [], uncompressedBytes: 0, compressedBytes: 0};
  const assets = path.join(outDir, 'search-index-assets');
  await fs.mkdir(assets, {recursive: true});
  for (const group of groups) {
    const json = Buffer.from(JSON.stringify(group));
    const hash = createHash('sha256').update(json).digest('hex');
    const file = `search-index-assets/${hash}.json.gz`;
    const compressed = gzipSync(json, {level: 9});
    await atomicWrite(path.join(outDir, file), compressed);
    manifest.groups.push({file, bytes: compressed.length, uncompressedBytes: json.length});
    manifest.uncompressedBytes += json.length;
    manifest.compressedBytes += compressed.length;
  }
  await atomicWrite(path.join(outDir, 'search-index.json'), JSON.stringify(groups));
  await atomicWrite(path.join(outDir, 'search-index-manifest.json'), JSON.stringify(manifest));
  return manifest;
}
