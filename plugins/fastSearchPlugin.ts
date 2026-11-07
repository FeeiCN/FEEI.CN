import type {LoadContext, OptionValidationContext, Plugin} from '@docusaurus/types';
import path from 'node:path';

// Docusaurus validates the wrapper, not the delegated plugin. Forward its
// schema so generated client constants retain all upstream defaults.
export function validateOptions<T, U>(data: OptionValidationContext<T, U>): U {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@easyops-cn/docusaurus-search-local').validateOptions(data);
}

// Keep EasyOps' client theme, generated constants and /search route in the main
// Docusaurus build, but move its expensive full-site index generation out of
// the critical publish path. scripts/build_search_index.mjs rebuilds the same
// search-index.json after the release has been published.
export default function fastSearchPlugin(context: LoadContext, options: unknown): Plugin {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const module = require('@easyops-cn/docusaurus-search-local');
  const factory = module.default ?? module;
  const normalizedOptions = options && typeof options === 'object' ? options : {};
  const plugin = factory(context, normalizedOptions);

  return {
    ...plugin,
    name: 'fast-local-search',
    postBuild: undefined,
    configureWebpack(config, isServer, utils, content) {
      const upstream = plugin.configureWebpack?.(config, isServer, utils, content) ?? {};
      return {
        ...upstream,
        module: {
          ...upstream.module,
          rules: [...(upstream.module?.rules ?? []), {
            test: /[\\/]docusaurus-search-local[\\/]dist[\\/]client[\\/]client[\\/]theme[\\/]worker\.js$/,
            use: [path.join(context.siteDir, 'scripts/search_worker_loader.cjs')],
          }],
        },
      };
    },
  } as Plugin;
}
