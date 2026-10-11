export const STATE_OF_MIND_CLASSIFICATION_LABELS: Record<string, string> = {
  very_pleasant: '非常愉快',
  pleasant: '愉快',
  slightly_pleasant: '稍微愉快',
  neutral: '中性',
  slightly_unpleasant: '稍微不愉快',
  unpleasant: '不愉快',
  very_unpleasant: '非常不愉快',
};

export const STATE_OF_MIND_FEELING_LABELS: Record<string, string> = {
  amazed: '惊奇', amused: '愉快', angry: '生气', annoyed: '烦恼', anxious: '焦虑',
  ashamed: '羞愧', brave: '勇敢', calm: '平静', confident: '自信', content: '满足',
  disappointed: '失望', discouraged: '气馁', disgusted: '厌恶', drained: '疲惫', embarrassed: '尴尬',
  excited: '兴奋', frustrated: '沮丧', grateful: '感激', guilty: '内疚', happy: '快乐',
  hopeful: '充满希望', hopeless: '绝望', indifferent: '无所谓', irritated: '易怒', jealous: '嫉妒',
  joyful: '喜悦', lonely: '孤独', overwhelmed: '不堪重负', passionate: '热情', peaceful: '安宁',
  proud: '自豪', relieved: '如释重负', sad: '伤心', satisfied: '满意', scared: '害怕',
  stressed: '有压力', surprised: '惊讶', worried: '忧虑',
};

export const STATE_OF_MIND_ASSOCIATION_LABELS: Record<string, string> = {
  community: '社区', current_events: '时事', currentEvents: '时事', dating: '约会', education: '教育',
  family: '家人', fitness: '健身', friends: '朋友', health: '健康', hobbies: '爱好',
  identity: '身份认同', money: '金钱', partner: '伴侣', self_care: '自我照护', selfCare: '自我照护',
  spirituality: '精神信仰', tasks: '任务', travel: '旅行', weather: '天气', work: '工作',
};

export const STATE_OF_MIND_KIND_LABELS: Record<string, string> = {
  daily: '每日心情',
  daily_mood: '每日心情',
  emotion: '瞬时情绪',
  momentary_emotion: '瞬时情绪',
};

export function stateOfMindTerm(value: string | undefined, labels: Record<string, string>): string {
  return value ? labels[value] ?? value : '未分类';
}
