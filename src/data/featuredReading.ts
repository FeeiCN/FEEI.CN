export const authorPortrait = 'https://feei.cn/media/01-关于/bedb1a4123b25fb9830873cf29e39bda-scaled.webp';

export const featuredReading = [
  {
    id: 'security-journey', to: '/my-journey-in-cybersecurity', category: '个人经历', title: '我的网络安全之路',
    description: '从写工具、报漏洞到带团队做安全，那些做过的事和后来才看清的局限。',
    shareLines: ['我的网络安全之路'], shareSubtitle: '从漏洞研究，走向企业安全建设',
    next: ['/ai-personal-to-org-efficiency', '/life-certainty'],
  },
  {
    id: 'org-ai-efficiency', to: '/ai-personal-to-org-efficiency', category: '组织实践', title: '从个人 AI 提效到组织 AI 提效',
    description: '代码写快了，需求交付为什么没变快？记录流程重塑、团队协作和走过的弯路。',
    shareLines: ['从个人 AI 提效', '到组织 AI 提效'], shareSubtitle: '从代码生成，走向端到端交付与组织协作',
    next: ['/my-journey-in-cybersecurity', '/life-certainty'],
  },
  {
    id: 'life-certainty', to: '/life-certainty', category: '人生实践', title: '创造确定性人生',
    description: '从一句“还行吧”开始，重新检查时间、精力和钱究竟流向了哪里。',
    shareLines: ['创造确定性人生'], shareSubtitle: '把有限的投入，留给真正重要的事',
    next: ['/my-journey-in-cybersecurity', '/ai-personal-to-org-efficiency'],
  },
] as const;

export const readingDestinations: Record<string, {title: string; description: string}> = {
  ...Object.fromEntries(featuredReading.map((item) => [item.to, {title: item.title, description: item.description}])),
};

export function featuredForPath(path: string) {
  return featuredReading.find((item) => item.to === path.replace(/\/$/, ''));
}

export function shareImageForPath(path: string): string {
  return `https://feei.cn/img/share/${featuredForPath(path)?.id ?? 'feei'}.png`;
}
