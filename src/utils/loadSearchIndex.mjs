const manifests = new Map();

function manifestUrl(url) {
  return new URL('search-index-manifest.json', url);
}

function manifestFor(url) {
  const key = url.toString();
  if (!manifests.has(key)) {
    const promise = fetch(manifestUrl(url)).then(async (response) => {
      if (response.status === 404) return null;
      if (!response.ok) throw new Error('搜索索引清单暂不可用');
      const manifest = await response.json();
      if (manifest.version !== 1 || !Array.isArray(manifest.groups) || manifest.groups.length !== 5 ||
          manifest.groups.some((group) => !/^search-index-assets\/[a-f0-9]{64}\.json\.gz$/.test(group.file))) {
        throw new Error('搜索索引清单格式无效');
      }
      return manifest;
    }).catch((error) => {
      manifests.delete(key);
      throw error;
    });
    manifests.set(key, promise);
  }
  return manifests.get(key);
}

export async function preloadSearchIndex(url) {
  await manifestFor(new URL(url, globalThis.location?.origin));
}

export async function loadSearchIndex(url) {
  const target = new URL(url, globalThis.location?.origin);
  const manifest = await manifestFor(target);
  if (!manifest || typeof DecompressionStream === 'undefined') {
    const response = await fetch(target);
    if (!response.ok) throw new Error('搜索索引暂不可用');
    return response.json();
  }
  return Promise.all(manifest.groups.map(async (group) => {
    const response = await fetch(new URL(group.file, target));
    if (!response.ok) throw new Error('搜索索引分片暂不可用');
    const bytes = new Uint8Array(await response.arrayBuffer());
    const payload = bytes[0] === 0x1f && bytes[1] === 0x8b
      ? new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
      : new Blob([bytes]).stream();
    return new Response(payload).json();
  }));
}
