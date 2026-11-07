import {lazy, Suspense, useEffect, useMemo, useRef, useState} from 'react';
import {Button, Collapsible, Tabs} from '@chakra-ui/react';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import {pageFor, relationLabels, sourceLink} from './model';
import {buildCatalog, type CatalogEntry} from './panoramaModel';
import {standardForPage, standardRelations, type StandardRelation} from './standardRelationsModel';
import StandardName from './StandardName';
import {useKnowledge} from './useKnowledge';
import styles from './standardRelations.module.css';

const Graph = lazy(() => import('./StandardRelationsGraph'));

function Chevron({open = false}: {open?: boolean}) {
  return <svg className={styles.chevron} data-open={open} width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m5 6.5 3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export default function StandardRelationsPanel({permalink}: {permalink: string}) {
  const base = useBaseUrl('/data/compliance/');
  const {siteConfig} = useDocusaurusContext();
  const [open, setOpen] = useState(false);
  const [edgeId, setEdgeId] = useState('');
  const [tab, setTab] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const pendingFocus = useRef(false);
  const data = useKnowledge(base, open ? permalink : '', 'browse');
  const catalog = useMemo(() => buildCatalog(data.index), [data.index]);
  const current = useMemo(() => standardForPage(data.index, catalog, permalink, siteConfig.baseUrl), [data.index, catalog, permalink, siteConfig.baseUrl]);
  const groups = useMemo(() => current ? standardRelations(catalog, current) : null, [catalog, current]);
  useEffect(() => {
    if (!pendingFocus.current || !open || tab === 'graph') return;
    const frame = requestAnimationFrame(() => {
      const evidence = [...(panelRef.current?.querySelectorAll<HTMLElement>('[data-evidence-id]') ?? [])]
        .find(element => element.dataset.evidenceId === edgeId);
      if (evidence) {evidence.focus({preventScroll: true}); evidence.scrollIntoView({block: 'nearest'}); pendingFocus.current = false;}
    });
    return () => cancelAnimationFrame(frame);
  }, [open, tab, edgeId]);
  if (!data.loading && !current && !data.error) return null;

  const toolsUrl = (entry: CatalogEntry) => `/compliance-knowledge?view=panorama&id=${encodeURIComponent(entry.node.id)}&oscope=extended`;
  const linkFor = (entry: CatalogEntry) => pageFor(data.index, entry.node)?.url || toolsUrl(entry);
  const quotesFor = (row: StandardRelation) => row.edge.evidence.flatMap(id => data.evidenceIndex.get(id)?.quote ?? []);
  const active = tab ?? (groups?.outgoing.length ? 'outgoing' : groups?.incoming.length ? 'incoming' : groups?.versions.length ? 'versions' : 'outgoing');
  const categories = [
    {key: 'outgoing', title: '引用', rows: groups?.outgoing ?? [], empty: '暂未收录本版引用其他标准的关系。'},
    {key: 'incoming', title: '被引用', rows: groups?.incoming ?? [], empty: '暂未收录其他标准引用本版的关系。'},
    {key: 'versions', title: '替代', rows: groups?.versions ?? [], empty: '暂未收录明确替代关系，不能据此判断本版是否现行。'},
  ];
  const version = groups?.versions.find(row => !row.outgoing) ?? groups?.versions[0];
  const showEvidence = (row: StandardRelation) => {
    pendingFocus.current = true;
    setOpen(true); setTab(row.edge.predicate === 'supersedes' ? 'versions' : row.outgoing ? 'outgoing' : 'incoming');
    setEdgeId(row.edge.id); setExpanded(true);
  };

  return <aside ref={panelRef} className={styles.panel} aria-label="本标准与其他标准的关系" data-standard={current?.node.id} data-expanded={open}>
    {data.loading && <p className={styles.loading} role="status">正在读取标准关系…</p>}
    {data.error && <p className={styles.error} role="alert">{data.error} <Button size="xs" variant="ghost" onClick={data.retry}>重试</Button></p>}
    {current && groups && <Collapsible.Root open={open} onOpenChange={({open}) => setOpen(open)} lazyMount unmountOnExit>
      <div className={styles.summary}>
        <svg className={styles.relationIcon} width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M5 8h5M8 8V3h2M8 8v5h2" stroke="currentColor" strokeWidth="1.1" /><rect x="1.5" y="6" width="4" height="4" rx="1" stroke="currentColor" /><rect x="10" y="1.5" width="4" height="3" rx=".8" stroke="currentColor" /><rect x="10" y="11.5" width="4" height="3" rx=".8" stroke="currentColor" /></svg>
        <span className={styles.summaryLabel}>标准关联</span>
        <span className={styles.counts}>引用 <b>{groups.outgoing.length}</b><span className={styles.separator}>/</span>被引用 <b>{groups.incoming.length}</b></span>
        <Collapsible.Trigger asChild><Button size="xs" variant="ghost" className={styles.summaryToggle} aria-label={open ? '收起标准关系' : '展开标准关系'}>{open ? '收起' : '展开'}<Chevron open={open} /></Button></Collapsible.Trigger>
      </div>
      {version && <div className={styles.versionNote}><span className={styles.versionDot} />{version.outgoing ? '代替' : '由'} <Link to={linkFor(version.other)}>{version.other.node.identifier}</Link>{!version.outgoing && '代替'}<Button size="xs" variant="ghost" onClick={() => showEvidence(version)}>依据<Chevron /></Button></div>}
      <Collapsible.Content className={styles.details}>
        <Tabs.Root value={active} onValueChange={({value}) => {setTab(value); setExpanded(false); setEdgeId('');}} variant="line" lazyMount unmountOnExit>
          <div className={styles.toolbar}>
            <Tabs.List className={styles.tabs} aria-label="标准关系类型">
              {categories.map(category => <Tabs.Trigger key={category.key} value={category.key}>{category.title}<span className={styles.countBadge}>{category.rows.length}</span></Tabs.Trigger>)}
              <Tabs.Trigger value="graph">图谱</Tabs.Trigger>
            </Tabs.List>
            <Link className={styles.fullGraph} to={toolsUrl(current)} aria-label="打开完整关系图谱">完整图谱 <span aria-hidden="true">↗</span></Link>
          </div>
          {categories.map(category => <Tabs.Content key={category.key} value={category.key} className={styles.content}>
            {!category.rows.length && <p className={styles.empty}>{category.empty}</p>}
            <div className={styles.relationList} tabIndex={expanded ? 0 : undefined} aria-label={category.title + '标准列表'}>
              {category.rows.slice(0, expanded ? undefined : 4).map(row => {
                const {edge, other, outgoing} = row;
                const isOpen = edgeId === edge.id;
                const relation = edge.predicate === 'supersedes' ? outgoing ? '本版代替' : '代替本版' : relationLabels[edge.predicate];
                return <Collapsible.Root key={edge.id} className={styles.row} open={isOpen} onOpenChange={({open}) => setEdgeId(open ? edge.id : '')} lazyMount unmountOnExit>
                  <div className={styles.relationship}>
                    <Link className={styles.nameBlock} to={linkFor(other)}><StandardName node={other.node} quotes={quotesFor(row)} /></Link>
                    <div className={styles.rowMeta}>
                      <span className={styles.relation} data-relation={edge.predicate}>{relation}</span>
                      {!pageFor(data.index, other.node)?.url && <span className={styles.missing}>{other.node.type === 'StandardSeries' ? '未注年份' : '无阅读页'}</span>}
                    </div>
                    <Collapsible.Trigger asChild><Button size="xs" variant="ghost" className={styles.evidenceToggle} aria-label={`${isOpen ? '收起' : '查看'} ${other.node.identifier} 的${relation}依据`}>{isOpen ? '收起' : '依据'}<Chevron open={isOpen} /></Button></Collapsible.Trigger>
                  </div>
                  <Collapsible.Content className={styles.evidence} data-evidence-id={edge.id} tabIndex={-1}>
                    <p className={styles.direction}>{data.index.nodes.get(edge.subject)?.identifier} <span>→ {relationLabels[edge.predicate]} →</span> {data.index.nodes.get(edge.object)?.identifier}</p>
                    {data.evidenceLoading ? <p role="status">正在读取原文证据…</p> : edge.evidence.map(id => {
                      const quote = data.evidenceIndex.get(id);
                      const document = quote && data.index.nodes.get(quote.document);
                      return quote && document ? <div key={id}><blockquote>{quote.quote}</blockquote><a className={styles.source} href={sourceLink(document, quote.line)} target="_blank" rel="noopener noreferrer" aria-label={`${document.label} 原文第 ${quote.line} 行`}>原文 · 第 {quote.line} 行<span aria-hidden="true">↗</span></a></div> : <p key={id}>证据未读取成功，请使用上方的“重试”。</p>;
                    })}
                  </Collapsible.Content>
                </Collapsible.Root>;
              })}
            </div>
            {category.rows.length > 4 && <Button size="xs" variant="ghost" className={styles.more} onClick={() => setExpanded(value => !value)}>{expanded ? '收起列表' : `其余 ${category.rows.length - 4} 项`}<Chevron open={expanded} /></Button>}
          </Tabs.Content>)}
          <Tabs.Content value="graph" className={styles.content}>
            <Suspense fallback={<p className={styles.loading} role="status">正在绘制关系图…</p>}><Graph current={current} groups={groups} linkFor={linkFor} quotesFor={quotesFor} onEvidence={showEvidence} /></Suspense>
          </Tabs.Content>
        </Tabs.Root>
        <Collapsible.Root className={styles.explanation} lazyMount unmountOnExit>
          <Collapsible.Trigger asChild><Button size="xs" variant="ghost">关系说明<span className={styles.infoMark} aria-hidden="true">i</span></Button></Collapsible.Trigger>
          <Collapsible.Content><p>关系来自已收录原文。“规范性引用”属于正式引用，“提及”仅表示正文出现过该标准。名称优先采用已收录标题，缺失时仅从该条关系的原文中提取；未注年份的引用不指向某一具体年份。无阅读页的条目进入图谱查询。缺项不代表不存在，现行状态与适用范围仍需核对正式文本。</p></Collapsible.Content>
        </Collapsible.Root>
      </Collapsible.Content>
    </Collapsible.Root>}
  </aside>;
}
