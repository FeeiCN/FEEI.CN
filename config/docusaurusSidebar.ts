type SidebarItemWithProps = {
  type: string;
  id?: string;
  items?: SidebarItemWithProps[];
  customProps?: Record<string, unknown>;
  collapsed?: boolean;
  label?: string;
  link?: {type?: string; id?: string};
};

type LoadedDocWithFrontMatter = {
  id: string;
  source?: string;
  title?: string;
  frontMatter?: Record<string, unknown>;
};

function getDailyRecordSidebarLabel(doc?: LoadedDocWithFrontMatter): string | undefined {
  const slug = doc?.frontMatter?.slug;
  if (typeof slug !== 'string' || !/^\/\d{4}-\d{2}-\d{2}\/?$/.test(slug)) return undefined;

  const date = slug.replace(/^\//, '').replace(/\/$/, '');
  const title = typeof doc?.title === 'string' ? doc.title.trim() : '';
  return title ? `${date.slice(5)} · ${title}` : undefined;
}

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

function overviewLabel(categoryLabel: string | undefined): string {
  return categoryLabel === '人工智能安全' ? '人工智能安全体系' : '总览';
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
      const dailyRecordLabel = getDailyRecordSidebarLabel(docsById.get(item.id));
      if (dailyRecordLabel) nextItem.label = dailyRecordLabel;
    }

    if (item.type === 'category') {
      if (typeof item.collapsed === 'undefined') nextItem.collapsed = depth > 0;

      const originalChildren = [...(item.items ?? [])];

      // A folder that only wraps a single index document is file organization,
      // not information architecture. Render it as a normal article instead of
      // "category → overview".
      if (item.link?.type === 'doc' && item.link.id && originalChildren.length === 0) {
        const linkedDoc = docsById.get(item.link.id);
        return visit({
          type: 'doc',
          id: item.link.id,
          label: linkedDoc?.title ?? item.label,
          customProps: item.customProps,
        }, depth);
      }

      let children = originalChildren;

      // Real categories are navigation nodes only. If a legacy category linked directly
      // to a document, keep that document as the first child before removing the link.
      if (item.link?.type === 'doc' && item.link.id) {
        nextItem.customProps = applyDocFields(item, item.link.id);
        if (!children.some((child) => child.type === 'doc' && child.id === item.link?.id)) {
          const linkedDoc = docsById.get(item.link.id);
          children.unshift({
            type: 'doc',
            id: item.link.id,
            label: linkedDoc?.title,
          });
        }
      }

      // generated-index and doc links both disappear from the category itself:
      // clicking a directory always expands/collapses it.
      delete nextItem.link;

      const visitedChildren = children.map((child) => visit(child, depth + 1));
      nextItem.items = visitedChildren.map((child) => {
        if (
          child.type === 'doc'
          && typeof item.label === 'string'
          && typeof child.label === 'string'
          && child.label.trim() === item.label.trim()
        ) {
          return {...child, label: overviewLabel(item.label)};
        }
        return child;
      });
    }

    return nextItem;
  }

  return items.map((item) => visit(item, 0) as Item);
}
