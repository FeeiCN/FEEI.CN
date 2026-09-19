type SidebarItemWithProps = {
  type: string;
  id?: string;
  items?: SidebarItemWithProps[];
  customProps?: Record<string, unknown>;
  collapsed?: boolean;
  link?: {type?: string; id?: string};
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

export function attachDocFrontMatterToSidebar<
  Item extends SidebarItemWithProps,
  Doc extends LoadedDocWithFrontMatter,
>(items: Item[], docs: Doc[]): Item[] {
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
      if (typeof item.collapsed === 'undefined') nextItem.collapsed = depth > 0;
      if (item.link?.type === 'doc' && item.link.id) {
        nextItem.customProps = applyDocFields(item, item.link.id);
      }
      if (item.items) {
        nextItem.items = item.items.map((child) => visit(child, depth + 1));
      }
    }
    return nextItem;
  }

  return items.map((item) => visit(item, 0) as Item);
}
