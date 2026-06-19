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
  // 在浏览器调用时计算，每次返回运行时解析后的源 URL 列表；
  // 使用函数而非静态数组是为了避免 Docusaurus SSG 把日期 bake 进静态 HTML。
  getSources: () => string[];
};

// 浏览器上下文：返回当前年/月字符串，用于动态解析「当前月份」类源路径。
function currentYearMonth(): {YYYY: string; MM: string} {
  const d = new Date();
  return {
    YYYY: String(d.getFullYear()),
    MM: String(d.getMonth() + 1).padStart(2, '0'),
  };
}

export const STATUS_MANIFEST: StatusEntry[] = [
  {
    key: 'llm-usage',
    name: 'AI 使用数据',
    frequency: 'daily',
    timeField: 'fetchedAt',
    outputs: [{title: 'AI 使用数据', slug: '/ai-usage-data'}],
    getSources: () => [
      'static/data/llm-usage/anthropic/usage_summary.json',
      'static/data/llm-usage/minimax/usage_summary.json',
      'static/data/llm-usage/openai/usage_summary.json',
    ],
  },
  {
    key: 'health-data',
    name: '健康数据',
    frequency: 'daily',
    timeField: 'exportedAt',
    outputs: [{title: '健康数据', slug: '/health-data'}],
    // 历史月份每月只写一次不再更新；运行时只需取当前月即可反映新鲜度。
    getSources: () => {
      const {YYYY, MM} = currentYearMonth();
      return [`static/data/health/${YYYY}/${MM}.json`];
    },
  },
  {
    key: 'weread-daily',
    name: '微信读书数据同步',
    frequency: 'daily',
    // index.json 是聚合摘要，时间字段是 exportedAt；notebooks.json 没有此字段会被忽略，
    // 但由于 index.json 每天都被刷新，它的时间戳即代表「今天的同步是否完成」。
    timeField: 'exportedAt',
    outputs: [],
    getSources: () => [
      'static/data/reading/index.json',
      'static/data/reading/notebooks.json',
    ],
  },
  {
    key: 'weread-highlights',
    name: '微信读书划线入 issue',
    frequency: '3h',
    timeField: 'fetchedAt',
    outputs: [],
    getSources: () => ['static/data/reading/highlights-meta.json'],
  },
  {
    key: 'hk-ipo',
    name: '港股打新数据',
    frequency: 'daily',
    timeField: 'fetchedAt',
    outputs: [{title: '港股打新数据', slug: '/hk-ipo-data'}],
    getSources: () => ['static/data/hk-ipo/data.json'],
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
    getSources: () => [
      'static/data/account-assets/stock.json',
      'static/data/account-assets/index.json',
    ],
  },
];