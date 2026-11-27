import {getDocIcon} from '../src/utils/docIcons';

type SidebarItemWithProps = {
  type: string;
  id?: string;
  items?: SidebarItemWithProps[];
  customProps?: Record<string, unknown>;
  collapsible?: boolean;
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

const CATEGORY_ICONS: Record<string, string> = {
  职业选择: 'target-icon',
  行业专项: 'gear-icon',
  通用人工智能: 'bulb-svg',
  AI基础认知: 'bulb-svg',
  年度总结: 'history-circle-icon',
};

const DEFENSE_GROUPS = [
  {label: '身份与权限', slugs: ['/password-security', '/gugu', '/ai-agent-tool-security', '/agent-authorization-revocation']},
  {label: '应用与接口', slugs: ['/api-security', '/encrypted-resource-id', '/aop-security', '/llm-application-security', '/ai-model-alignment-output-security']},
  {label: '数据与凭据', slugs: ['/ai-data-knowledge-security', '/ai-privacy-confidentiality', '/ai-crown-jewels-infrastructure-security', '/ai-model-supply-chain-security']},
  {label: '终端与办公', slugs: ['/office-security', '/email-security', '/redefining-payment-security-in-the-ai-era']},
  {label: '监测与响应', slugs: ['/ai-security-monitoring-response']},
];

const SOFTWARE_TOOLS = new Set([
  '/autossh', '/ios-device-automation-control', '/install-windows-on-macos',
  '/remotely-control-the-home-computer', '/work-efficiency', '/how-modern-browsers-work',
]);

function getDailyRecordSidebarLabel(doc?: LoadedDocWithFrontMatter): string | undefined {
  const slug = doc?.frontMatter?.slug;
  if (typeof slug !== 'string' || !/^\/\d{4}-\d{2}-\d{2}\/?$/.test(slug)) return undefined;

  const date = slug.replace(/^\//, '').replace(/\/$/, '');
  const title = typeof doc?.title === 'string' ? doc.title.trim() : '';
  return title ? `${date.slice(5)} · ${title}` : undefined;
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
  const hiddenSlugs = new Set([
    '/links', '/health-data', '/index-data', '/stock-data', '/hk-ipo-data',
    '/ai-security', '/ai-system-security', '/ai-for-security',
    '/security-incidents', '/security-incident-analysis-examples', '/data-breach-list',
  ]);

  const docSlug = (item: SidebarItemWithProps): string | undefined => {
    const id = item.type === 'doc' ? item.id : item.link?.type === 'doc' ? item.link.id : undefined;
    const slug = id ? docsById.get(id)?.frontMatter?.slug : undefined;
    return typeof slug === 'string' ? slug : undefined;
  };

  function groupDefenseArticles(children: SidebarItemWithProps[]): SidebarItemWithProps[] {
    const articles: SidebarItemWithProps[] = [];
    const seen = new Set<string>();
    function collect(item: SidebarItemWithProps) {
      if (item.type === 'category') {
        if (item.link?.type === 'doc' && item.link.id) {
          const doc = docsById.get(item.link.id);
          collect({type: 'doc', id: item.link.id, label: String(doc?.frontMatter?.sidebar_label ?? doc?.title ?? item.label)});
        }
        item.items?.forEach(collect);
      } else if (includeInSidebar(item) && (!item.id || !seen.has(item.id))) {
        articles.push(item);
        if (item.id) seen.add(item.id);
      }
    }
    children.forEach(collect);
    const bySlug = new Map(articles.map((item) => [docSlug(item), item]));
    const assigned = new Set<SidebarItemWithProps>();
    const groups = DEFENSE_GROUPS.flatMap(({label, slugs}) => {
      const items = slugs.flatMap((slug) => {
        const article = bySlug.get(slug);
        if (!article) return [];
        assigned.add(article);
        return [article];
      });
      return items.length ? [{
        type: 'category', label, collapsible: true, collapsed: true,
        customProps: {overviewHref: `/security-defense#${label}`}, items,
      }] : [];
    });
    return [
      ...groups,
      ...articles.filter((article) => !assigned.has(article)),
    ];
  }

  function groupSoftwareTools(children: SidebarItemWithProps[]): SidebarItemWithProps[] {
    const tools = children.filter((child) => SOFTWARE_TOOLS.has(docSlug(child) ?? ''));
    if (!tools.length) return children;
    return [
      ...children.filter((child) => !tools.includes(child)),
      {
        type: 'category', label: '开发与实用工具', collapsible: true, collapsed: true,
        customProps: {overviewHref: '/software#开发与实用工具'}, items: tools,
      },
    ];
  }

  function includeInSidebar(item: SidebarItemWithProps): boolean {
    return item.type !== 'doc' || !item.id || !hiddenSlugs.has(String(docsById.get(item.id)?.frontMatter?.slug));
  }

  function applyDocFields(
    item: SidebarItemWithProps,
    docId: string,
  ): Record<string, unknown> {
    const doc = docsById.get(docId);
    const icon = getDocIcon(doc?.frontMatter);
    const sidebarBadge = getDocSidebarBadge(doc);
    const fields: Record<string, unknown> = {...item.customProps};
    if (icon) fields.icon = icon;
    if (sidebarBadge) fields.sidebar_badge = sidebarBadge;
    return fields;
  }

  function getCategoryIcon(item: SidebarItemWithProps): string {
    const configuredIcon = item.customProps?.icon;
    if (typeof configuredIcon === 'string' && configuredIcon.trim()) return configuredIcon.trim();

    const normalizeLabel = (label: string) => label.replace(/^\d+[-_]/, '').replace(/\s+/g, '').toLowerCase();
    const label = normalizeLabel(item.label ?? '');
    const indexItem = item.items?.find((child) => {
      if (child.type !== 'doc' || !child.id) return false;
      const doc = docsById.get(child.id);
      return [doc?.title, doc?.frontMatter?.sidebar_label, child.label, child.id.split('/').at(-1)]
        .some((title) => typeof title === 'string' && normalizeLabel(title) === label);
    });
    const docId = item.link?.type === 'doc' ? item.link.id : indexItem?.id;
    const icon = docId ? getDocIcon(docsById.get(docId)?.frontMatter) : undefined;
    if (icon) return icon;
    if (/^(?:\d{4}|[一二三四五六七八九十]+月)$/.test(label)) return 'history-circle-icon';
    return CATEGORY_ICONS[item.label ?? ''] ?? 'layers-icon';
  }

  const MONTH_ORDER: Record<string, number> = {
    一月: 1,
    二月: 2,
    三月: 3,
    四月: 4,
    五月: 5,
    六月: 6,
    七月: 7,
    八月: 8,
    九月: 9,
    十月: 10,
    十一月: 11,
    十二月: 12,
  };

  function sortMonthCategories(items: SidebarItemWithProps[]): SidebarItemWithProps[] {
    const monthPositions = items
      .filter((item) => item.type === 'category' && typeof item.label === 'string' && MONTH_ORDER[item.label.trim()]);

    if (monthPositions.length < 2) return items;

    const sortedMonths = monthPositions
      .sort((left, right) => MONTH_ORDER[String(left.label).trim()] - MONTH_ORDER[String(right.label).trim()]);

    let monthIndex = 0;
    return items.map((item) => {
      const isMonth = item.type === 'category'
        && typeof item.label === 'string'
        && MONTH_ORDER[item.label.trim()];
      return isMonth ? sortedMonths[monthIndex++] : item;
    });
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

      const originalChildren = (item.items ?? []).filter(includeInSidebar);

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

      let children = docSlug(item) === '/security-defense'
        ? groupDefenseArticles(originalChildren)
        : docSlug(item) === '/software' ? groupSoftwareTools(originalChildren) : originalChildren;

      if (item.link?.type === 'doc' && item.link.id) {
        nextItem.customProps = applyDocFields(item, item.link.id);
        children = children.filter((child) => child.type !== 'doc' || child.id !== item.link?.id);
      }

      nextItem.customProps = {...nextItem.customProps, icon: getCategoryIcon(item)};

      // Keep explicitly configured category index documents as navigation targets.
      if (item.link?.type !== 'doc') delete nextItem.link;

      const visitedChildren = sortMonthCategories(children.map((child) => visit(child, depth + 1)));
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

  const visibleItems = items.filter(includeInSidebar);
  const overview = visibleItems.find((item) => docSlug(item) === '/security-engineering');
  const journey = visibleItems.find((item) => docSlug(item) === '/my-journey-in-cybersecurity');
  const orderedItems = overview && journey
    ? [overview, ...visibleItems.filter((item) => item !== overview && item !== journey), journey]
    : visibleItems;
  return orderedItems.map((item) => visit(item, 0) as Item);
}
