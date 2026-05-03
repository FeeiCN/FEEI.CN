import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

type SidebarItemWithProps = {
  type: string;
  id?: string;
  items?: SidebarItemWithProps[];
  customProps?: Record<string, unknown>;
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

  function visit(item: SidebarItemWithProps): SidebarItemWithProps {
    const nextItem = {...item};

    if (item.type === 'doc' && item.id) {
      const icon = getDocIcon(docsById.get(item.id));
      if (icon) {
        nextItem.customProps = {...item.customProps, icon};
      }
    }

    if (item.type === 'category') {
      if (item.link?.type === 'doc' && item.link.id) {
        const icon = getDocIcon(docsById.get(item.link.id));
        if (icon) {
          nextItem.customProps = {...item.customProps, icon};
        }
      }

      if (item.items) {
        nextItem.items = item.items.map(visit);
      }
    }

    return nextItem;
  }

  return items.map((item) => visit(item) as T);
}

const config: Config = {
  title: '创造确定性人生',
  tagline: '把所有的时间、精力和金钱都投入到长期目标中',
  favicon: 'img/favicon.ico',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  // Set the production url of your site here
  url: 'https://wufeifei.com',
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: '/',

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: 'feeicn', // Usually your GitHub org/user name.
  projectName: 'certainty-in-life', // Usually your repo name.

  onBrokenLinks: 'throw',

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'zh-Hans',
    locales: ['zh-Hans'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          async sidebarItemsGenerator(args) {
            const items = await args.defaultSidebarItemsGenerator(args);
            return attachSidebarIcons(items, args.docs);
          },
          // Please change this to your repo.
          // Remove this to remove the "edit this page" links.
          editUrl:
            'https://github.com/FeeiCN/certainty-in-life/tree/main/',
        },
        blog: {
          showReadingTime: true,
          feedOptions: {
            type: ['rss', 'atom'],
            xslt: true,
          },
          // Please change this to your repo.
          // Remove this to remove the "edit this page" links.
          editUrl:
            'https://github.com/FeeiCN/certainty-in-life/tree/main/',
          // Useful options to enforce blogging best practices
          onInlineTags: 'warn',
          onInlineAuthors: 'warn',
          onUntruncatedBlogPosts: 'warn',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    // Replace with your project's social card
    image: 'img/docusaurus-social-card.jpg',
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      logo: {
        alt: 'My Site Logo',
        src: 'img/logo.png',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'healthHappinessSidebar',
          position: 'left',
          label: '健康',
          icon: 'heart',
        },
        {
          type: 'docSidebar',
          sidebarId: 'careerSuccessSidebar',
          position: 'left',
          label: '能力',
          icon: 'rocket',
        },
        {
          type: 'docSidebar',
          sidebarId: 'financeFreedomSidebar',
          position: 'left',
          label: '财富',
          icon: 'chart-line',
        },
        {
          type: 'docSidebar',
          sidebarId: 'exploreWorldSidebar',
          position: 'left',
          label: '体验',
          icon: 'compass',
        },
        {to: '/blog', label: 'Blog', position: 'left', icon: 'book-open'},
        {
          href: 'https://github.com/FeeiCN/certainty-in-life',
          label: 'GitHub',
          position: 'right',
          icon: 'code-branch',
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
