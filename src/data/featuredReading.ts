export const authorPortrait = 'https://feei.cn/media/01-关于/bedb1a4123b25fb9830873cf29e39bda-scaled.webp';

export const featuredReading = [
  {
    id: 'security-journey', group: 'professional', to: '/my-journey-in-cybersecurity', category: '个人经历', title: '我的网络安全之路',
    description: '从写工具、报漏洞到带团队做安全，那些做过的事和后来才看清的局限。',
    shareLines: ['我的网络安全之路'], shareSubtitle: '从漏洞研究，走向企业安全建设',
    next: ['/security-system', '/gsil'],
  },
  {
    id: 'security-system', group: 'professional', entry: '/security-system#建设讨论五问', to: '/security-system', category: '安全建设', title: '安全体系',
    description: '先读建设讨论五问，沿一条攻击路径核对资产、责任、防护、响应和验证。',
    shareLines: ['安全体系'], shareSubtitle: '从资产、风险、防护、响应到验证',
    next: ['/my-journey-in-cybersecurity', '/ai-security'],
  },
  {
    id: 'ai-security', group: 'professional', to: '/ai-security', category: '人工智能安全', title: '当 AI 开始调用工具',
    description: '一篇外部文章，为什么可能影响一笔付款？沿模型、工具与授权寻找安全边界。',
    shareLines: ['人工智能安全'], shareSubtitle: '模型、工具与真实授权之间的边界',
    next: ['/security-system', '/ai-agent-tool-security'],
  },
  {
    id: 'life-certainty', group: 'life', to: '/life-certainty', category: '人生实践', title: '创造确定性人生',
    description: '从一句“还行吧”开始，重新检查时间、精力和钱究竟流向了哪里。',
    shareLines: ['创造确定性人生'], shareSubtitle: '把有限的投入，留给真正重要的事',
    next: ['/life-os', '/2026-11-15'],
  },
  {
    id: 'a-day-with-family', group: 'life', to: '/2026-11-15', category: '生活片段', title: '珠珠最喜欢小船',
    description: '和家人去保寿山，玩小船，吃一顿冒菜。记录一个普通却值得留下的周末。',
    shareLines: ['珠珠最喜欢小船'], shareSubtitle: '一个和家人出门的普通周末',
    next: ['/life-certainty', '/annual-review/2026'],
  },
] as const;

export const readingDestinations: Record<string, {title: string; description: string}> = {
  ...Object.fromEntries(featuredReading.map((item) => [item.to, {title: item.title, description: item.description}])),
  '/gsil': {title: 'GitHub 敏感信息泄漏监控', description: '沿着经历里的具体问题，看看监测工具怎样落地。'},
  '/ai-agent-tool-security': {title: 'Agent 与工具调用安全', description: '继续核对工具权限、执行范围和模型外的控制。'},
  '/life-os': {title: '人生系统', description: '从个人的取舍，继续看目标、记录和回顾怎样连接。'},
  '/annual-review/2026': {title: '2026 年度目标与记录', description: '沿着时间，继续读工作与生活中的日常记录。'},
};

export function featuredForPath(path: string) {
  return featuredReading.find((item) => item.to === path.replace(/\/$/, ''));
}

export function shareImageForPath(path: string): string {
  return `https://feei.cn/img/share/${featuredForPath(path)?.id ?? 'feei'}.png`;
}
