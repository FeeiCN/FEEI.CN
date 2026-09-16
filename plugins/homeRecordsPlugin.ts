import type {LoadContext, Plugin} from '@docusaurus/types';
import type {LoadedContent} from '@docusaurus/plugin-content-docs';
import type {Compiler} from 'webpack';

export type HomeRecord = {date: string; title: string; to: string};

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
      const docs = (content?.loadedVersions.find((version) => version.isLast)?.docs ?? [])
        .filter((doc) => !doc.unlisted && !doc.draft);
      const records: HomeRecord[] = docs
        .filter((doc) => /^\/\d{4}-\d{2}-\d{2}\/?$/.test(doc.slug)
          && doc.source.startsWith('@site/docs/05-吴飞飞/02-年度总结/'))
        .map((doc) => ({date: doc.slug.replace(/^\//, '').replace(/\/$/, ''), title: doc.title, to: doc.permalink}))
        .sort((first, second) => second.date.localeCompare(first.date))
        .slice(0, 3);
      const updates = docs
        .filter((doc) => doc.source.startsWith('@site/docs/01-网络安全/') && !doc.frontMatter.sidebar_badge
          && ['article', 'tutorial'].includes(String(doc.frontMatter.content_type))
          && doc.slug.replace(/\/$/, '') !== '/ai-agent-tool-security')
        .map((doc) => ({date: String(doc.frontMatter.last_reviewed ?? ''), title: doc.title, to: doc.permalink}))
        .filter((doc) => /^\d{4}-\d{2}-\d{2}$/.test(doc.date))
        .sort((first, second) => second.date.localeCompare(first.date) || first.to.localeCompare(second.to))
        .slice(0, 3);
      actions.setGlobalData({records, updates});

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
