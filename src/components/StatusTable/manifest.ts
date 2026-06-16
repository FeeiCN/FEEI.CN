export type StatusOutput = {
  title: string;
  slug: string;
};

export type Frequency = '3h' | 'daily';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const FREQUENCIES = {
  '3h': {label: '每 3 小时 1 次', thresholds: {freshMs: 3 * HOUR, staleMs: 24 * HOUR}},
  daily: {label: '每日 1 次', thresholds: {freshMs: 24 * HOUR, staleMs: 72 * HOUR}},
} as const;

export type StatusEntry = {
  key: string;
  name: string;
  frequency: Frequency;
  timeField: 'fetchedAt' | 'exportedAt';
  outputs: StatusOutput[];
  sources: string[];
};

export const STATUS_MANIFEST: StatusEntry[] = [
  {
    key: 'llm-usage',
    name: 'AI 使用数据',
    frequency: 'daily',
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
    frequency: 'daily',
    timeField: 'exportedAt',
    outputs: [{title: '健康数据', slug: '/health-data'}],
    sources: ['static/health/2024/*.json', 'static/health/2025/*.json', 'static/health/2026/*.json'],
  },
  {
    key: 'weread-daily',
    name: '微信读书数据同步',
    frequency: 'daily',
    timeField: 'fetchedAt',
    outputs: [],
    sources: [
      'static/reading/notebooks.json',
      'static/reading/index.json',
      'static/reading/2018/*.json',
      'static/reading/2019/*.json',
      'static/reading/2020/*.json',
      'static/reading/2021/*.json',
      'static/reading/2022/*.json',
      'static/reading/2023/*.json',
      'static/reading/2024/*.json',
      'static/reading/2025/*.json',
      'static/reading/2026/*.json',
    ],
  },
  {
    key: 'weread-highlights',
    name: '微信读书划线入 issue',
    frequency: '3h',
    timeField: 'fetchedAt',
    outputs: [],
    sources: ['static/reading/highlights-meta.json'],
  },
  {
    key: 'hk-ipo',
    name: '港股打新数据',
    frequency: 'daily',
    timeField: 'fetchedAt',
    outputs: [{title: '港股打新数据', slug: '/hk-ipo-data'}],
    sources: ['static/hk-ipo/data.json'],
  },
  {
    key: 'financial-assets',
    name: '财务自由数据',
    frequency: 'daily',
    timeField: 'fetchedAt',
    outputs: [
      {title: '个股账号资产数据', slug: '/stock-data'},
      {title: '指数账号资产数据', slug: '/index-data'},
    ],
    sources: [
      'static/account-assets/stock.json',
      'static/account-assets/index.json',
    ],
  },
];
