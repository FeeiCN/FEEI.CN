const path = require('node:path');

module.exports = function searchWorkerLoader(source) {
  const fetchLine = 'const json = (await (await fetch(url)).json());';
  const preloadLine = '        await this.lowLevelFetchIndexes(baseUrl, searchContext);';
  if (source.split(fetchLine).length !== 2 || source.split(preloadLine).length !== 2) {
    throw new Error('搜索插件 Worker 接口已变化，请更新压缩索引适配');
  }
  const reader = path.resolve(__dirname, '../src/utils/loadSearchIndex.mjs');
  return `import {loadSearchIndex, preloadSearchIndex} from ${JSON.stringify(reader)};\n` + source
    .replace(fetchLine, 'const json = await loadSearchIndex(url);')
    .replace(preloadLine, 'await preloadSearchIndex(`${baseUrl}${searchIndexUrl.replace("{dir}", searchContext ? `-${searchContext.replace(/\\//g, "-")}` : "")}`);');
};
