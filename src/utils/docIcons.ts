export function getDocIcon(frontMatter: Record<string, unknown> = {}): string | undefined {
  const icon = typeof frontMatter.icon === 'string' ? frontMatter.icon.trim() : undefined;
  if (icon && /^[a-z0-9][a-z0-9-]*$/.test(icon)) return icon;

  const slug = typeof frontMatter.slug === 'string' ? frontMatter.slug : '';
  if (/^\/(?:\d{4}-\d{2}-\d{2}\/?|annual-review\/\d{4}(?:\/\d{2})?\/?)$/.test(slug)) {
    return 'history-circle-icon';
  }

  return icon || undefined;
}

type SidebarIconItem = {
  type: string;
  customProps?: Record<string, unknown>;
};

export function hideRepeatedSidebarIcons<Item extends SidebarIconItem>(items: Item[]): Item[] {
  const isArticle = (item: Item) => item.type === 'doc' || item.type === 'link';
  const articles = items.filter(isArticle);
  const icon = articles[0]?.customProps?.icon;
  if (articles.length < 2 || typeof icon !== 'string' || !icon.trim()) return items;
  if (!articles.every((item) => item.customProps?.icon === icon)) return items;

  return items.map((item) => isArticle(item)
    ? {...item, customProps: {...item.customProps, hideSidebarIcon: true}}
    : item);
}
