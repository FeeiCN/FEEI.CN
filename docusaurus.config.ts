import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import docMtimePlugin from './plugins/docMtimePlugin';
import copyMarkdownPlugin from './plugins/copyMarkdownPlugin';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

type SidebarItemWithProps = {
  type: string;
  id?: string;
  items?: SidebarItemWithProps[];
  customProps?: Record<string, unknown>;
  collapsed?: boolean;
  link?: {
    type?: string;
    id?: string;
  };
};

type LoadedDocWithFrontMatter = {
  id: string;
  frontMatter?: Record<string, unknown>;
};

function getDocIcon(doc?: LoadedDocWithFrontMatter): string | undefined {
  const icon = doc?.frontMatter?.icon;
  return typeof icon === 'string' && icon.trim() ? icon.trim() : undefined;
}

function getDocSidebarBadge(
  doc?: LoadedDocWithFrontMatter,
): {text: string; color: string} | undefined {
  const badge = doc?.frontMatter?.sidebar_badge;
  if (!badge || typeof badge !== 'object') return undefined;
  const text = (badge as Record<string, unknown>).text;
  const color = (badge as Record<string, unknown>).color;
  if (typeof text !== 'string' || !text.trim()) return undefined;
  return {
    text: text.trim(),
    color: typeof color === 'string' && color.trim() ? color.trim() : 'info',
  };
}

function attachDocFrontMatterToSidebar<
  T extends SidebarItemWithProps,
  D extends LoadedDocWithFrontMatter,
>(items: T[], docs: D[]): T[] {
  const docsById = new Map(docs.map((doc) => [doc.id, doc]));

  function applyDocFields(
    item: SidebarItemWithProps,
    docId: string,
  ): Record<string, unknown> {
    const doc = docsById.get(docId);
    const icon = getDocIcon(doc);
    const sidebarBadge = getDocSidebarBadge(doc);
    const fields: Record<string, unknown> = {...item.customProps};
    if (icon) fields.icon = icon;
    if (sidebarBadge) fields.sidebar_badge = sidebarBadge;
    return fields;
  }

  function visit(item: SidebarItemWithProps, depth: number): SidebarItemWithProps {
    const nextItem = {...item};

    if (item.type === 'doc' && item.id) {
      nextItem.customProps = applyDocFields(item, item.id);
    }

    if (item.type === 'category') {
      if (typeof item.collapsed === 'undefined') {
        nextItem.collapsed = depth > 0;
      }

      if (item.link?.type === 'doc' && item.link.id) {
        nextItem.customProps = applyDocFields(item, item.link.id);
      }

      if (item.items) {
        nextItem.items = item.items.map((child) => visit(child, depth + 1));
      }
    }

    return nextItem;
  }

  return items.map((item) => visit(item, 0) as T);
}

const isStrictBuild = process.env.CI_STRICT === 'true';

const config: Config = {
  title: '吴飞飞-安全界',
  tagline: '把所有的时间、精力和金钱都投入到长期目标中',
  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: {
      removeLegacyPostBuildHeadAttribute: true,
      useCssCascadeLayers: true,
      siteStorageNamespacing: true,
      mdx1CompatDisabledByDefault: true,
      fasterByDefault: true,
    }, // Improve compatibility with the upcoming Docusaurus v4
  },

  markdown: {
    // .md files use CommonMark (no JSX parsing), .mdx files use MDX
    format: 'detect',
    hooks: {
      onBrokenMarkdownLinks: isStrictBuild ? 'throw' : 'warn',
      onBrokenMarkdownImages: 'ignore',
    },
    preprocessor: ({fileContent}) => {
      // Escape * inside URLs — security write-ups use *** to mask IPs/domains,
      // but Markdown parses *** as bold+italic and breaks link resolution.
      return fileContent.replace(/https?:\/\/\S+/g, (url) => url.replace(/\*/g, '\\*'));
    },
  },

  // Set the production url of your site here
  url: 'https://feei.cn',
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: '/',

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: 'feeicn', // Usually your GitHub org/user name.
  projectName: 'FEEI.CN', // Usually your repo name.

  onBrokenLinks: isStrictBuild ? 'throw' : 'warn',

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'zh-Hans',
    locales: ['zh-Hans'],
  },

  headTags: [
    {
      tagName: 'link',
      attributes: {
        rel: 'icon',
        href: '/media/img/icons/feei-icon-32.webp',
        sizes: '32x32',
      },
    },
    {
      tagName: 'link',
      attributes: {
        rel: 'icon',
        href: '/media/img/icons/feei-icon-192.webp',
        sizes: '192x192',
      },
    },
    {
      tagName: 'link',
      attributes: {
        rel: 'apple-touch-icon',
        href: '/media/img/icons/feei-icon-180.webp',
      },
    },
    {
      tagName: 'meta',
      attributes: {
        name: 'msapplication-TileImage',
        content: '/media/img/icons/feei-icon-270.webp',
      },
    },
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          remarkPlugins: [remarkMath],
          rehypePlugins: [rehypeKatex],
          async sidebarItemsGenerator(args) {
            const items = await args.defaultSidebarItemsGenerator(args);
            return attachDocFrontMatterToSidebar(items, args.docs);
          },
          // Please change this to your repo.
          // Remove this to remove the "edit this page" links.
          editUrl:
            'https://github.com/FeeiCN/FEEI.CN/tree/main/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  plugins: [docMtimePlugin, copyMarkdownPlugin],

  themes: [
    [
      require.resolve('@easyops-cn/docusaurus-search-local'),
      {
        docsRouteBasePath: '/',
        indexBlog: false,
        language: ['en', 'zh'],
      },
    ],
  ],

  clientModules: ['./src/clientModules/slidingIndicator.ts'],

  themeConfig: {
    docs: {
      sidebar: {
        hideable: true,
        autoCollapseCategories: true,
      },
    },
    // Replace with your project's social card
    image: 'media/img/icons/feei-icon-270.webp',
    colorMode: {
      defaultMode: 'light',
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },
    navbar: {
      hideOnScroll: false,
      logo: {
        alt: 'My Site Logo',
        src: 'media/img/logo.webp',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'healthHappinessSidebar',
          position: 'left',
          label: '健康幸福',
          icon: 'heart',
        },
        {
          type: 'dropdown',
          position: 'left',
          label: '事业有成',
          icon: 'rocket',
          items: [
            {type: 'docSidebar', sidebarId: 'securityEngineeringSidebar', label: '安全工程', icon: 'shield'},
            {type: 'docSidebar', sidebarId: 'softwareEngineeringSidebar', label: '软件工程', icon: 'terminal-icon'},
            {type: 'docSidebar', sidebarId: 'aiSidebar', label: '人工智能', icon: 'brand-openai-icon'},
            {type: 'docSidebar', sidebarId: 'careerJobSidebar', label: '职业与事业', icon: 'rocket'},
          ],
        },
        {
          type: 'dropdown',
          position: 'left',
          label: '财务自由',
          icon: 'brand-bags-fm-icon',
          items: [
            {type: 'docSidebar', sidebarId: 'workSavingsSidebar', label: '工作储蓄', icon: 'piggy-bank'},
            {type: 'docSidebar', sidebarId: 'expenseControlSidebar', label: '控制支出', icon: 'receipt'},
            {type: 'docSidebar', sidebarId: 'investmentSidebar', label: '投资理财', icon: 'chart-line-icon'},
            {type: 'docSidebar', sidebarId: 'insuranceSidebar', label: '基础保障', icon: 'shield-check'},
          ],
        },
        {
          type: 'dropdown',
          position: 'left',
          label: '人生丰富',
          icon: 'compass',
          items: [
            {type: 'docSidebar', sidebarId: 'readingSidebar', label: '阅读', icon: 'book-open-text'},
            {type: 'docSidebar', sidebarId: 'filmSidebar', label: '影视', icon: 'film'},
            {type: 'docSidebar', sidebarId: 'travelSidebar', label: '旅行', icon: 'globe-icon'},
            {type: 'docSidebar', sidebarId: 'musicSidebar', label: '音乐', icon: 'vinyl-icon'},
            {type: 'docSidebar', sidebarId: 'miscHobbiesSidebar', label: '杂项爱好', icon: 'star-icon'},
          ],
        },
        {
          type: 'dropdown',
          position: 'left',
          label: '吴飞飞',
          icon: 'at-sign-icon',
          items: [
            {type: 'docSidebar', sidebarId: 'aboutMeSidebar', label: '关于', icon: 'user'},
            {type: 'docSidebar', sidebarId: 'lifeProgressSidebar', label: '三省吾身', icon: 'gauge-icon'},
            {type: 'docSidebar', sidebarId: 'annualReviewSidebar', label: '年度总结', icon: 'history-circle-icon'},
          ],
        },
        {
          type: 'search',
          position: 'right',
        },
      ],
    },
    footer: {
      copyright: `<span class="footer-copyright">Copyright © 2012–${new Date().getFullYear()} FEEI&nbsp;&nbsp;All Rights Reserved</span><span class="footer-divider"></span><span class="footer-beian"><a class="footer-beian-link" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">浙ICP备2021009229号</a><span class="footer-beian-dot">·</span><a class="footer-beian-link" href="http://www.beian.gov.cn/portal/registerSystemInfo?recordcode=33011002015586" target="_blank" rel="noopener noreferrer">浙公网安备33011002015586号</a></span>`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
