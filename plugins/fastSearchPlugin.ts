import type {LoadContext, Plugin} from '@docusaurus/types';

// Keep EasyOps' client theme, generated constants and /search route in the main
// Docusaurus build, but move its expensive full-site index generation out of
// the critical publish path. scripts/build_search_index.mjs rebuilds the same
// search-index.json after the release has been published.
export default function fastSearchPlugin(context: LoadContext, options: Record<string, unknown> = {}): Plugin {
  // EasyOps' processPluginOptions() normalizes several options by wrapping them
  // in arrays and then immediately mapping over them. When this plugin is used
  // as a wrapper (instead of through the package's normal Docusaurus theme
  // declaration), omitted options remain undefined and can fail during that
  // normalization. Supply the package defaults explicitly before delegating.
  const normalizedOptions = {
    docsRouteBasePath: '/',
    blogRouteBasePath: 'blog',
    docsDir: 'docs',
    blogDir: 'blog',
    language: ['en'],
    ignoreFiles: [],
    ignoreCssSelectors: [],
    ...options,
  };

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const module = require('@easyops-cn/docusaurus-search-local');
  const factory = module.default ?? module;
  const plugin = factory(context, normalizedOptions);

  return {
    ...plugin,
    name: 'fast-local-search',
    postBuild: undefined,
  } as Plugin;
}
