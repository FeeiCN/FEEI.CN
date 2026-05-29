import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import docMtimePlugin from './plugins/docMtimePlugin';

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

function attachSidebarIcons<
  T extends SidebarItemWithProps,
  D extends LoadedDocWithFrontMatter,
>(items: T[], docs: D[]): T[] {
  const docsById = new Map(docs.map((doc) => [doc.id, doc]));

  function visit(item: SidebarItemWithProps, depth: number): SidebarItemWithProps {
    const nextItem = {...item};

    if (item.type === 'doc' && item.id) {
      const icon = getDocIcon(docsById.get(item.id));
      if (icon) {
        nextItem.customProps = {...item.customProps, icon};
      }
    }

    if (item.type === 'category') {
      if (typeof item.collapsed === 'undefined') {
        nextItem.collapsed = depth > 0;
      }

      if (item.link?.type === 'doc' && item.link.id) {
        const icon = getDocIcon(docsById.get(item.link.id));
        if (icon) {
          nextItem.customProps = {...item.customProps, icon};
        }
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
  title: '创造确定性人生-安全界',
  tagline: '把所有的时间、精力和金钱都投入到长期目标中',
  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  markdown: {
    // .md files use CommonMark (no JSX parsing), .mdx files use MDX
    format: 'detect',
    hooks: {
      onBrokenMarkdownLinks: isStrictBuild ? 'throw' : 'warn',
    },
    preprocessor: ({fileContent}) => {
      // Escape * inside URLs — security write-ups use *** to mask IPs/domains,
      // but Markdown parses *** as bold+italic and breaks link resolution.
      return fileContent.replace(/https?:\/\/\S+/g, (url) => url.replace(/\*/g, '\\*'));
    },
  },

  // Set the production url of your site here
  url: 'https://wufeifei.com',
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: '/',

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: 'feeicn', // Usually your GitHub org/user name.
  projectName: 'wufeifei.com', // Usually your repo name.

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
        href: '/img/icons/feei-icon-32.webp',
        sizes: '32x32',
      },
    },
    {
      tagName: 'link',
      attributes: {
        rel: 'icon',
        href: '/img/icons/feei-icon-192.webp',
        sizes: '192x192',
      },
    },
    {
      tagName: 'link',
      attributes: {
        rel: 'apple-touch-icon',
        href: '/img/icons/feei-icon-180.webp',
      },
    },
    {
      tagName: 'meta',
      attributes: {
        name: 'msapplication-TileImage',
        content: '/img/icons/feei-icon-270.webp',
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
          async sidebarItemsGenerator(args) {
            const items = await args.defaultSidebarItemsGenerator(args);
            return attachSidebarIcons(items, args.docs);
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

  plugins: [docMtimePlugin],

  clientModules: ['./src/clientModules/slidingIndicator.ts'],

  themeConfig: {
    // Replace with your project's social card
    image: 'img/docusaurus-social-card.webp',
    colorMode: {
      defaultMode: 'light',
      disableSwitch: false,
      respectPrefersColorScheme: false,
    },
    navbar: {
      logo: {
        alt: 'My Site Logo',
        src: 'img/logo.webp',
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
          type: 'docSidebar',
          sidebarId: 'careerSuccessSidebar',
          position: 'left',
          label: '事业有成',
          icon: 'rocket',
        },
        {
          type: 'docSidebar',
          sidebarId: 'financeFreedomSidebar',
          position: 'left',
          label: '财务自由',
          icon: 'brand-bags-fm-icon',
        },
        {
          type: 'docSidebar',
          sidebarId: 'exploreWorldSidebar',
          position: 'left',
          label: '人生丰富',
          icon: 'compass',
        },
        {
          type: 'docSidebar',
          sidebarId: 'aboutSidebar',
          position: 'left',
          label: '吴飞飞',
          icon: 'at-sign-icon',
        },
        {
          type: 'custom-music-player',
          position: 'right',
        },
      ],
    },
    footer: {
      copyright: `<span class="footer-copyright">Copyright © 2012–${new Date().getFullYear()} FEEI&nbsp;&nbsp;All Rights Reserved</span><span class="footer-divider"></span><span class="footer-beian"><a class="footer-beian-link" href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">浙ICP备2021009229号</a><span class="footer-beian-dot">·</span><a class="footer-beian-link" href="http://www.beian.gov.cn/portal/registerSystemInfo?recordcode=33011002015586" target="_blank" rel="noopener noreferrer">浙公网安备33011002015586号</a></span><span class="footer-divider"></span><span class="footer-github"><a class="footer-beian-link" href="https://github.com/FeeiCN/FEEI.CN" target="_blank" rel="noopener noreferrer">GitHub</a></span>`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
