import type {LoadContext, Plugin} from '@docusaurus/types';
import type {LoadedContent} from '@docusaurus/plugin-content-docs';
import type {Compiler} from 'webpack';
import type {DocMetadataMap} from './docMtimePlugin';

export type HomeRecord = {date: string; title: string; to: string; location?: string};

function validPublicationDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00+08:00`);
  return Number.isFinite(timestamp)
    && new Date(timestamp + 8 * 60 * 60 * 1000).toISOString().slice(0, 10) === value
    && timestamp <= Date.now();
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (character) => ({'<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;'}[character]!));
}

export default function homeRecordsPlugin(context: LoadContext): Plugin {
  let feedXml = '';
  return {
    name: 'home-records-plugin',
    allContentLoaded({allContent, actions}) {
      const content = allContent['docusaurus-plugin-content-docs']?.default as LoadedContent | undefined;
      const docMetadata = allContent['doc-mtime-plugin']?.default as DocMetadataMap | undefined;
      const docs = (content?.loadedVersions.find((version) => version.isLast)?.docs ?? [])
        .filter((doc) => !doc.unlisted && !doc.draft);
      const dailyRecords: HomeRecord[] = docs
        .filter((doc) => /^\/\d{4}-\d{2}-\d{2}\/?$/.test(doc.slug)
          && doc.source.startsWith('@site/docs/05-吴飞飞/02-年度总结/'))
        .map((doc) => ({
          date: doc.slug.replace(/^\//, '').replace(/\/$/, ''),
          title: doc.title,
          to: doc.permalink,
          location: typeof doc.frontMatter.location === 'string' ? doc.frontMatter.location : undefined,
        }))
        .sort((first, second) => second.date.localeCompare(first.date));
      const records = dailyRecords.slice(0, 3);
      const updates: HomeRecord[] = docs
        .filter((doc) => doc.source.startsWith('@site/docs/01-网络安全/') && !doc.frontMatter.sidebar_badge
          && ['article', 'tutorial'].includes(String(doc.frontMatter.content_type))
          && doc.slug.replace(/\/$/, '') !== '/ai-agent-tool-security')
        .map((doc) => ({updatedAt: docMetadata?.[doc.source]?.updatedAt ?? 0, title: doc.title, to: doc.permalink}))
        .filter((doc) => Number.isFinite(doc.updatedAt) && doc.updatedAt > 0 && doc.updatedAt <= Date.now())
        .sort((first, second) => second.updatedAt - first.updatedAt || first.to.localeCompare(second.to))
        .slice(0, 3)
        .map((doc) => ({date: new Date(doc.updatedAt + 8 * 60 * 60 * 1000).toISOString().slice(0, 10), title: doc.title, to: doc.to}));
      actions.setGlobalData({records, dailyRecords, updates});

      const siteUrl = context.siteConfig.url;
      const feedUrl = new URL(`${context.siteConfig.baseUrl}rss.xml`, siteUrl).href;
      const entries = docs
        .filter((doc) => {
          const badge = doc.frontMatter.sidebar_badge;
          return !(badge && typeof badge === 'object' && 'text' in badge && badge.text === 'SKILL')
            && ['article', 'tutorial', 'review', 'essay'].includes(String(doc.frontMatter.content_type));
        })
        .map((doc) => ({
          date: String(doc.frontMatter.published_at ?? ''),
          title: doc.title,
          description: doc.description,
          url: new URL(doc.permalink, siteUrl).href,
        }))
        .filter((doc) => validPublicationDate(doc.date))
        .sort((first, second) => second.date.localeCompare(first.date) || first.url.localeCompare(second.url))
        .slice(0, 100);
      const items = entries.map((entry) => `<item><title>${escapeXml(entry.title)}</title><link>${escapeXml(entry.url)}</link><guid isPermaLink="true">${escapeXml(entry.url)}</guid><description>${escapeXml(entry.description)}</description><pubDate>${new Date(`${entry.date}T00:00:00+08:00`).toUTCString()}</pubDate></item>`).join('\n');
      feedXml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>吴飞飞 · 网络安全与人生系统</title><link>${escapeXml(siteUrl)}</link><description>安全研究、人生实践与日常记录的新文章。按首次发布日期排序，不固定更新频率。</description><language>zh-CN</language><atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>${items}</channel></rss>`;
    },
    configureWebpack(_config, isServer) {
      if (isServer) return;
      return {
        plugins: [{
          apply(compiler: Compiler) {
            compiler.hooks.thisCompilation.tap('home-records-feed', (compilation) => {
              compilation.hooks.processAssets.tap({name: 'home-records-feed', stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL}, () => {
                compilation.emitAsset('rss.xml', new compiler.webpack.sources.RawSource(feedXml));
              });
            });
          },
        }],
      };
    },
    injectHtmlTags() {
      return {headTags: [{tagName: 'link', attributes: {rel: 'alternate', type: 'application/rss+xml', title: '吴飞飞 · 网络安全与人生系统', href: `${context.siteConfig.baseUrl}rss.xml`}}]};
    },
  };
}
