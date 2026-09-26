import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import docMtimePlugin from './plugins/docMtimePlugin';
import copyMarkdownPlugin from './plugins/copyMarkdownPlugin';
import fastSearchPlugin from './plugins/fastSearchPlugin';
import homeRecordsPlugin from './plugins/homeRecordsPlugin';
import {expandMarkdownIncludes} from './plugins/markdownIncludes';
import {attachDocFrontMatterToSidebar} from './config/docusaurusSidebar';
import {searchOptions} from './config/search';

const isStrictBuild = process.env.CI_STRICT === 'true';

const config: Config = {
  title: '吴飞飞', tagline: '把所有的时间、精力和金钱都投入到长期目标中',
  future: {v4: {removeLegacyPostBuildHeadAttribute: true, useCssCascadeLayers: true, siteStorageNamespacing: true, mdx1CompatDisabledByDefault: true, fasterByDefault: true}, faster: {gitEagerVcs: false}},
  markdown: {format: 'detect', hooks: {onBrokenMarkdownLinks: isStrictBuild ? 'throw' : 'warn', onBrokenMarkdownImages: 'ignore'}, preprocessor: ({filePath, fileContent}) => expandMarkdownIncludes(fileContent, filePath).replace(/https?:\/\/\S+/g, (url) => url.replace(/\*/g, '\\*'))},
  url: 'https://feei.cn', baseUrl: '/', organizationName: 'feeicn', projectName: 'FEEI.CN', onBrokenLinks: isStrictBuild ? 'throw' : 'warn', i18n: {defaultLocale: 'zh-Hans', locales: ['zh-Hans']},
  headTags: [
    {tagName: 'link', attributes: {rel: 'icon', href: '/img/feei-icon.svg', type: 'image/svg+xml'}},
  ],
  presets: [['classic', {docs: {routeBasePath: '/', sidebarPath: './sidebars.ts', remarkPlugins: [remarkMath], rehypePlugins: [rehypeKatex], async sidebarItemsGenerator(args) { const items = await args.defaultSidebarItemsGenerator(args); return attachDocFrontMatterToSidebar(items, args.docs); }, editUrl: 'https://github.com/FeeiCN/FEEI.CN/tree/main/'}, blog: false, theme: {customCss: ['./src/css/custom.css', './src/css/neutral.css', './src/css/sliding-indicator.css', './src/css/friend-links.css', './src/css/year-records.css', './src/css/contact.css']}} satisfies Preset.Options]],
  plugins: [docMtimePlugin, copyMarkdownPlugin, homeRecordsPlugin, [fastSearchPlugin, searchOptions]], clientModules: ['./src/clientModules/slidingIndicator.ts'],
  themeConfig: {
    docs: {sidebar: {hideable: true, autoCollapseCategories: true}}, image: 'music/feei-site-theme-cover.webp', colorMode: {defaultMode: 'light', disableSwitch: false, respectPrefersColorScheme: true},
    navbar: {hideOnScroll: false, logo: {alt: 'FEEI', src: 'img/feei-icon.svg'}, items: [
      {type: 'dropdown', position: 'left', label: '网络安全', icon: 'shield', to: '/security-engineering', items: [
        {type: 'docSidebar', sidebarId: 'securityEngineeringSidebar', label: '网络空间安全', icon: 'shield'},
        {type: 'docSidebar', sidebarId: 'aiSecuritySidebar', label: '人工智能安全', icon: 'brand-openai-icon'},
      ]},
      {type: 'dropdown', position: 'left', label: '人生系统', icon: 'biceps-flexed', to: '/life-certainty', items: [
        {type: 'docSidebar', sidebarId: 'healthHappinessSidebar', label: '健康幸福', icon: 'heart'},
        {type: 'docSidebar', sidebarId: 'careerSuccessSidebar', label: '事业有成', icon: 'rocket'},
        {type: 'docSidebar', sidebarId: 'financeFreedomSidebar', label: '财务自由', icon: 'brand-bags-fm-icon'},
        {type: 'doc', docId: '人生系统/人生丰富/人生厚度', label: '人生丰富', icon: 'compass'},
      ]},
      {type: 'dropdown', position: 'left', label: '关于', icon: 'at-sign-icon', to: '/about', items: [
        {type: 'docSidebar', sidebarId: 'aboutMeSidebar', label: '关于', icon: 'user'},
        {type: 'docSidebar', sidebarId: 'annualReviewSidebar', label: '年度总结', icon: 'history-circle-icon'},
      ]},
      {type: 'search', position: 'right'},
    ]},
    footer: {copyright: `<span class="footer-copyright">Copyright © 2012–${new Date().getFullYear()} FEEI&nbsp;&nbsp;All Rights Reserved</span><span class="footer-beian"><a class="footer-beian-link" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">浙ICP备2021009229号</a><span class="footer-beian-dot">·</span><a class="footer-beian-link" href="http://www.beian.gov.cn/portal/registerSystemInfo?recordcode=33011002015586" target="_blank" rel="noopener noreferrer">浙公网安备33011002015586号</a><span class="footer-beian-dot">·</span><a class="footer-beian-link" href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Weather: Open-Meteo</a></span>`},
    prism: {theme: prismThemes.github, darkTheme: prismThemes.dracula},
  } satisfies Preset.ThemeConfig,
};
export default config;
