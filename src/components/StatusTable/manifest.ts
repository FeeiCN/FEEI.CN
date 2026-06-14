export type StatusOutput = {
  title: string;
  slug: string;
};

export type StatusEntry = {
  key: string;
  name: string;
  timeField: 'fetchedAt' | 'exportedAt';
  outputs: StatusOutput[];
  sources: string[];
};

export const STATUS_MANIFEST: StatusEntry[] = [
  {
    key: 'llm-usage',
    name: 'AI 使用数据',
    timeField: 'fetchedAt',
    outputs: [{title: 'AI 使用数据', slug: '/ai-usage-data'}],
    sources: [
      'static/llm-usage/anthropic/usage_summary.json',
      'static/llm-usage/minimax/usage_summary.json',
      'static/llm-usage/openai/usage_summary.json',
    ],
  },
  {
    key: 'health-data',
    name: '健康数据',
    timeField: 'exportedAt',
    outputs: [{title: '健康数据', slug: '/health-data'}],
    sources: ['static/health/2024/*.json', 'static/health/2025/*.json', 'static/health/2026/*.json'],
  },
  {
    key: 'weread-daily',
    name: '微信读书数据同步',
    timeField: 'fetchedAt',
    outputs: [],
    sources: [
      'static/reading/notebooks.json',
      'static/reading/index.json',
      'static/reading/2024.json',
      'static/reading/2025.json',
      'static/reading/2026.json',
    ],
  },
  {
    key: 'weread-highlights',
    name: '微信读书划线入 issue',
    timeField: 'fetchedAt',
    outputs: [],
    sources: ['static/reading/highlights-meta.json'],
  },
  {
    key: 'hk-ipo',
    name: '港股打新数据',
    timeField: 'fetchedAt',
    outputs: [{title: '港股打新数据', slug: '/hk-ipo-data'}],
    sources: [
      'docs/03-财务自由/03-投资/03-港股打新/04-港股打新数据.mdx',
    ],
  },
  {
    key: 'financial-assets',
    name: '财务自由数据',
    timeField: 'fetchedAt',
    outputs: [
      {title: '个股账号资产数据', slug: '/stock-data'},
      {title: '指数账号资产数据', slug: '/index-data'},
    ],
    sources: [
      'docs/03-财务自由/03-投资/02-个股/01-个股数据.mdx',
      'docs/03-财务自由/03-投资/01-指数基金/01-指数数据.mdx',
    ],
  },
];
