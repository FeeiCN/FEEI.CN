import {lazy, Suspense, useEffect, useMemo, useRef, useState} from 'react';
import {Button, Input, NativeSelect, Tabs} from '@chakra-ui/react';
import Link from '@docusaurus/Link';
import {useHistory, useLocation} from '@docusaurus/router';
import useBaseUrl from '@docusaurus/useBaseUrl';
import {
  citingEdges, legalRelationsFor, legalRelationTypes, nodeTopics, pageFor, referencesFor, relationLabels, selectNodes,
  sourceLink, successorEdges, topicLabel, typeLabel,
  type Evidence, type KnowledgeEdge, type KnowledgeIndex,
  type KnowledgeNode, type QueryMode,
} from './model';
import {useKnowledge} from './useKnowledge';
import styles from './styles.module.css';

const KnowledgeGraphView = lazy(() => import('./KnowledgeGraph'));
const PanoramaGraphView = lazy(() => import('./PanoramaGraph'));
const PAGE_SIZE = 30;
const EXAMPLE_VERSION = 'standard:gb-z-20986-2007';
const summarizeTopics = (topics: string[]) => topics.slice(0, 2).map(topicLabel).join(' · ')
  + (topics.length > 2 ? ` 等 ${topics.length} 个主题` : '');
const modes: {value: QueryMode; title: string; hint: string}[] = [
  {value: 'browse', title: '找相关资料', hint: '输入一个主题或标准号，选择结果后，可以查看它提到了哪些标准，以及原文在哪里。'},
  {value: 'impact', title: '查标准换版', hint: '这里列出有明确替代声明的旧版标准。选择一个，查看新版和引用旧版的资料；是否需要修改，仍要核对引用时的语境。'},
  {value: 'missing', title: '找缺失原文', hint: '这里列出资料中提到了、但本站尚未收录对应原文的标准版本。已有解读文章，也可能缺少原文。'},
  {value: 'clauses', title: '搜具体条款', hint: '在 30 份试点标准中搜索章节内容，例如“访问控制”。点击结果即可阅读摘录、定位原文。'},
];

const questions = [
  {mode: 'browse', title: '这个主题有哪些资料？', description: '例如：个人信息保护', query: '个人信息', action: '找相关资料'},
  {mode: 'impact', title: '标准换版了，要复核哪里？', description: '例如：网络安全事件分类', query: '20986', action: '查标准换版'},
  {mode: 'missing', title: '哪些标准还缺原文？', description: '区分解读文章与标准原文', query: '', action: '找缺失原文'},
  {mode: 'clauses', title: '某项要求具体写在哪？', description: '例如：访问控制', query: '访问控制', action: '搜具体条款'},
];

function Example({index, evidence, loading, onEvidence, onSelect, onExplore}: {
  index: KnowledgeIndex; evidence: Map<string, Evidence>; loading: boolean;
  onEvidence: () => void; onSelect: (id: string) => void; onExplore: () => void;
}) {
  const replacement = (index.incoming.get(EXAMPLE_VERSION) ?? []).find(edge => edge.predicate === 'supersedes');
  const citation = (index.incoming.get(EXAMPLE_VERSION) ?? []).find(edge => edge.predicate === 'cites');
  const old = index.nodes.get(EXAMPLE_VERSION);
  const newer = replacement && index.nodes.get(replacement.subject);
  const citing = citation && index.nodes.get(citation.subject);
  const quote = replacement && replacement.evidence.map(id => evidence.get(id)).find(Boolean);
  const source = quote && index.nodes.get(quote.document);
  const [showEvidence, setShowEvidence] = useState(false);
  if (!old || !newer || !citing) return null;
  return <section className={styles.exampleStory} aria-labelledby="compliance-example-title">
    <span className={styles.eyebrow}>用一个真实例子看懂</span>
    <h2 id="compliance-example-title">旧标准有新版了，哪些资料要复核？</h2>
    <ol className={styles.storySteps}>
      <li><span>一份引用旧版的资料</span><EntityButton node={citing} onSelect={onSelect} /></li>
      <li><span>它提到的旧版</span><EntityButton node={old} onSelect={onSelect} /></li>
      <li><span>明确代替旧版的新版</span><EntityButton node={newer} onSelect={onSelect} /></li>
    </ol>
    <p className={styles.storyExplanation}>这条线把三件事连起来：谁提到了旧版、旧版被谁代替、依据写在哪里。它帮你找到要复核的资料；旧版引用是否需要修改，还要看具体语境。</p>
    <div className={styles.storyActions}>
      <Button variant="solid" onClick={onExplore}>查看引用旧版的资料 →</Button>
      <Button variant="outline" aria-expanded={showEvidence} aria-controls="compliance-example-evidence" onClick={() => {setShowEvidence(value => !value); onEvidence();}}>{showEvidence ? '收起原文依据' : '为什么说新版代替了旧版？'}</Button>
    </div>
    <div id="compliance-example-evidence" hidden={!showEvidence} className={styles.storyEvidence}>
      {loading ? <p role="status">正在读取原文…</p> : quote && source ? <>
        <blockquote>{quote.quote}</blockquote>
        <a href={sourceLink(source, quote.line)} target="_blank" rel="noopener noreferrer">查看声明所在的原文 · 第 {quote.line} 行 ↗</a>
      </> : <p>原文依据暂未读取成功，请使用下方的“重新加载”重试。</p>}
    </div>
  </section>;
}


function EntityButton({node, onSelect}: {node: KnowledgeNode; onSelect: (id: string) => void}) {
  return <button type="button" className={styles.entityLink} onClick={() => onSelect(node.id)}>{node.label}</button>;
}

function EvidenceList({edges, index, evidence, loading}: {
  edges: KnowledgeEdge[]; index: KnowledgeIndex; evidence: Map<string, Evidence>; loading: boolean;
}) {
  const ids = [...new Set(edges.flatMap(edge => edge.evidence))];
  return <details className={styles.evidence}>
    <summary>查看证据（{ids.length} 处）</summary>
    {loading && <p role="status">正在读取原文证据…</p>}
    {!loading && ids.slice(0, 8).map(id => {
      const item = evidence.get(id);
      const document = item && index.nodes.get(item.document);
      if (!item || !document) return <p key={id}>这条证据尚未读取，请重试。</p>;
      return <div className={styles.evidenceItem} key={id}>
        <blockquote>{item.quote}</blockquote>
        <a href={sourceLink(document, item.line)} target="_blank" rel="noopener noreferrer">
          {document.label} · 第 {item.line} 行 ↗
        </a>
        {document.sourceUrl && <> · <a href={document.sourceUrl} target="_blank" rel="noopener noreferrer">官方来源 ↗</a></>}
      </div>;
    })}
    {ids.length > 8 && <p className={styles.muted}>展示前 8 处。全部证据可在页面下方的数据文件中获取。</p>}
  </details>;
}

function Relations({title, edges, reverse, index, evidence, loading, onSelect}: {
  title: string; edges: KnowledgeEdge[]; reverse?: boolean; index: KnowledgeIndex;
  evidence: Map<string, Evidence>; loading: boolean; onSelect: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const groups = new Map<string, KnowledgeEdge[]>();
  for (const edge of edges) {
    const key = (reverse ? edge.subject : edge.object) + ':' + edge.predicate;
    groups.set(key, [...(groups.get(key) ?? []), edge]);
  }
  const rows = [...groups.values()];
  if (!rows.length) return null;
  return <section className={styles.relations}>
    <h3>{title} <span>{rows.length}</span></h3>
    {!rows.length && <p className={styles.muted}>当前收录范围内没有这类关系。</p>}
    {(expanded ? rows : rows.slice(0, 10)).map(group => {
      const edge = group[0];
      const node = index.nodes.get(reverse ? edge.subject : edge.object);
      return node && <div key={edge.id} className={styles.relationRow}>
        <span className={styles.relationLabel}>{relationLabels[edge.predicate]}</span>
        <EntityButton node={node} onSelect={onSelect} />
        <EvidenceList edges={group} index={index} evidence={evidence} loading={loading} />
      </div>;
    })}
    {rows.length > 10 && <Button size="sm" variant="outline" onClick={() => setExpanded(value => !value)}>
      {expanded ? '收起' : `显示全部 ${rows.length} 条关系`}
    </Button>}
  </section>;
}

function Detail({node, index, evidence, evidenceLoading, onSelect, onClauses, onClose, onGraph}: {
  node: KnowledgeNode; index: KnowledgeIndex; evidence: Map<string, Evidence>; evidenceLoading: boolean;
  onSelect: (id: string) => void; onClauses: (query: string) => void; onClose: () => void;
  onGraph?: () => void;
}) {
  const outgoing = index.outgoing.get(node.id) ?? [];
  const incoming = citingEdges(index, node.id);
  const successors = successorEdges(index, node.id);
  const predecessors = outgoing.filter(edge => edge.predicate === 'supersedes');
  const page = pageFor(index, node);
  const sources = (node.sources ?? []).map(id => index.nodes.get(id)).filter((item): item is KnowledgeNode => Boolean(item));
  const references = referencesFor(index, node.id);
  const relationProps = {index, evidence, loading: evidenceLoading, onSelect};
  return <article className={styles.detail} aria-label="知识详情" key={node.id}>
    <Button size="sm" variant="outline" className={styles.returnResults} onClick={onClose}>← 返回查询结果</Button>
    <div className={styles.detailHeader}>
      <span className={styles.eyebrow}>{typeLabel(node)}</span>
      <h2>{node.label}</h2>
      <p className={styles.muted}>{summarizeTopics(nodeTopics(index, node))}</p>
      <div className={styles.actions}>
        {onGraph && <Button size="sm" variant="outline" onClick={onGraph}>在关系图中查看 →</Button>}
        {page?.url && <Link className={styles.actionLink} to={page.url}>阅读站内正文 →</Link>}
        {(node.sourceUrl || sources[0]?.sourceUrl) && <a href={node.sourceUrl || sources[0]?.sourceUrl || undefined} target="_blank" rel="noopener noreferrer">官方来源 ↗</a>}
        {node.type === 'StandardVersion' && sources.length > 0 && <Button size="xs" variant="outline" onClick={() => onClauses(node.identifier ?? '')}>检索本版章节</Button>}
      </div>
    </div>
    {node.type === 'StandardVersion' && <p className={styles.notice}>
      {sources.length ? '已收录本版原文转写。' : '尚未收录本版标准原文转写。'}
      {' '}收录与替代关系不代表当前效力或项目适用性；注日期引用保留具体版本。
    </p>}
    {node.role === 'source-text' && node.sourceForm !== 'transcription' && <p className={styles.notice}>
      这份材料为{node.sourceForm === 'outline' ? '条款速查' : '原文材料或摘录'}，完整性需核对官方全文。
    </p>}
    {node.type === 'Clause' && <section className={styles.clausePreview}>
      <p>{node.preview || '该章节包含下级条目，请打开原文继续阅读。'}</p>
      {node.sectionKind === 'template' && <p className={styles.notice}>这是附录中的模板章节，编号不与标准正文混用。</p>}
      {node.document && index.nodes.get(node.document) && <a href={sourceLink(index.nodes.get(node.document)!, node.line)} target="_blank" rel="noopener noreferrer">定位原文第 {node.line} 行 ↗</a>}
      <Relations title="所属标准版本" edges={outgoing} {...relationProps} />
    </section>}
    {(successors.length > 0 || predecessors.length > 0) && <section className={styles.versionPanel}>
      <h3>版本关系</h3>
      <p className={styles.muted}>箭头含义为“新版明确代替旧版”。跨编号的合并替代也保留原始关系。</p>
      {successors.map(edge => <div className={styles.versionRow} key={edge.id}>
        <EntityButton node={index.nodes.get(edge.subject)!} onSelect={onSelect} />
        <span className={styles.versionArrow}>↓ 明确代替</span>
        <EntityButton node={index.nodes.get(edge.object)!} onSelect={onSelect} />
        <EvidenceList edges={[edge]} index={index} evidence={evidence} loading={evidenceLoading} />
      </div>)}
      {predecessors.map(edge => <div className={styles.versionRow} key={edge.id}>
        <span className={styles.muted}>本版明确代替</span><EntityButton node={index.nodes.get(edge.object)!} onSelect={onSelect} />
        <EvidenceList edges={[edge]} index={index} evidence={evidence} loading={evidenceLoading} />
      </div>)}
    </section>}
    {node.type !== 'Clause' && <>
      <Relations title="制定与落实依据" edges={legalRelationsFor(index, node.id)} {...relationProps} />
      <Relations title="据此制定的规定与标准" edges={legalRelationsFor(index, node.id, true)} reverse {...relationProps} />
      <Relations title="这份资料提到了哪些依据？" edges={references} {...relationProps} />
      <Relations title="哪些资料引用或提到了它？" edges={incoming} reverse {...relationProps} />
      <Relations title="相关原文与其他版本" edges={outgoing.filter(edge => !['cites', 'normativelyReferences', 'supersedes', ...legalRelationTypes].includes(edge.predicate))} {...relationProps} />
    </>}
    <details className={styles.identity}>
    <summary>查看文件与技术信息</summary>
      <dl><dt>稳定 ID</dt><dd>{node.id}</dd>
        {nodeTopics(index, node).length > 0 && <><dt>相关主题</dt><dd>{nodeTopics(index, node).map(topicLabel).join(' · ')}</dd></>}
        {node.path && <><dt>源文件</dt><dd><a href={sourceLink(node)} target="_blank" rel="noopener noreferrer">{node.path}</a></dd></>}
        {node.sha256 && <><dt>内容 SHA-256</dt><dd>{node.sha256}</dd></>}
      </dl>
    </details>
  </article>;
}

export default function ComplianceKnowledge() {
  const base = useBaseUrl('/data/compliance/');
  const history = useHistory();
  const location = useLocation();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const mode = modes.find(item => item.value === params.get('mode'))?.value ?? 'browse';
  const query = params.get('q') ?? '';
  const topic = params.get('topic') ?? '';
  const kind = params.get('kind') ?? '';
  const selected = params.get('id') ?? '';
  const graphView = params.get('view') === 'graph';
  const panoramaView = params.get('view') === 'panorama';
  const root = params.get('root') || selected || EXAMPLE_VERSION;
  const isStart = !graphView && !panoramaView && !query && !selected && !topic && !kind && !params.has('mode') && !params.has('p');
  const [exampleEvidence, setExampleEvidence] = useState(false);
  const dataSelection = graphView && root.startsWith('clause:') ? root : selected || (graphView ? root : isStart && exampleEvidence ? EXAMPLE_VERSION : '');
  const data = useKnowledge(base, dataSelection, mode);
  const {graph, index} = data;
  const detailRef = useRef<HTMLDivElement>(null);
  const nodes = useMemo(() => selectNodes(index, {mode, query, topic, kind}), [index, mode, query, topic, kind]);
  const topics = useMemo(() => [...new Set([...index.nodes.values()].filter(node => node.type === 'Document').map(node => node.topic).filter((value): value is string => Boolean(value)))].sort(), [index]);
  const pages = Math.max(1, Math.ceil(nodes.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Math.floor(Number(params.get('p')) || 1)));
  const current = index.nodes.get(selected);
  useEffect(() => {
    if (!graphView && !panoramaView && current && window.innerWidth <= 800) detailRef.current?.scrollIntoView({block: 'start', behavior: 'instant'});
  }, [current?.id, graphView, panoramaView]);
  const update = (values: Record<string, string>) => {
    const next = new URLSearchParams(params);
    if (Object.keys(values).some(key => ['q', 'mode', 'topic', 'kind'].includes(key))) next.delete('p');
    for (const [key, value] of Object.entries(values)) value ? next.set(key, value) : next.delete(key);
    const search = next.size ? `?${next}` : '';
    if (search !== location.search) history.replace({pathname: location.pathname, search});
  };
  const startQuery = (values: Record<string, string>) => {
    update(values);
    window.scrollTo({top: 0, behavior: 'instant'});
  };
  const choose = (id: string) => graphView ? update({id, root}) : isStart ? startQuery({id}) : update({id});
  const openGraph = (id: string) => startQuery({view: 'graph', root: id, id});
  const openPanorama = () => startQuery({view: 'panorama', root: '', id: '', q: '', mode: '', topic: '', kind: ''});
  const reset = () => history.replace({pathname: location.pathname, search: ''});
  return <div className={styles.explorer}>
    {data.error && <div role="alert" className={styles.error}>{data.error}<Button size="sm" variant="outline" onClick={data.retry}>重新加载</Button></div>}
    {data.loading && !data.error && <p role="status" className={styles.loading}>正在读取{mode === 'clauses' ? '试点章节' : '合规知识'}…</p>}
    {isStart ? <>
      <div className={styles.graphEntry}>
        <div><strong>用一张图，看全貌与关联</strong><p>沿真实关系看法律、规定和标准如何相连，再围绕一份文件查依据。</p></div>
        <div className={styles.graphEntryActions}><Button variant="outline" onClick={openPanorama}>看全景 →</Button><Button variant="outline" onClick={() => openGraph(EXAMPLE_VERSION)}>查关联 →</Button></div>
      </div>
      <section aria-labelledby="compliance-question-title">
        <h2 className={styles.sectionTitle} id="compliance-question-title">你想查什么？</h2>
        <div className={styles.questionGrid}>{questions.map(question => <Button key={question.mode} variant="outline" className={styles.questionCard} onClick={() => startQuery({mode: question.mode, q: question.query, id: '', topic: '', kind: ''})}>
          <strong>{question.title}</strong><span>{question.description}</span><span className={styles.questionAction}>{question.action} →</span>
        </Button>)}</div>
      </section>
      <Example index={index} evidence={data.evidenceIndex} loading={!exampleEvidence || data.evidenceLoading} onEvidence={() => setExampleEvidence(true)} onSelect={choose} onExplore={() => startQuery({mode: 'impact', q: '20986', id: EXAMPLE_VERSION})} />
      <Button className={styles.backStart} variant="outline" onClick={() => startQuery({mode: 'browse'})}>按其他主题或标准搜索 →</Button>
    </> : !graphView && !panoramaView && <Button className={styles.backStart} variant="outline" size="sm" onClick={reset}>← 回到开始</Button>}
    {panoramaView && <>
      <div className={styles.graphNavigation}><Button variant="outline" size="sm" onClick={reset}>← 回到开始</Button><Button variant="outline" size="sm" onClick={() => openGraph(current?.id || EXAMPLE_VERSION)}>查关联</Button></div>
      {!data.loading && graph && <Suspense fallback={<p role="status">正在加载合规全景图…</p>}>
        <PanoramaGraphView index={index} selected={selected} evidence={data.evidenceIndex} evidenceLoading={data.evidenceLoading}
          query={params.get('oq') ?? ''} kind={params.get('okind') ?? ''} topic={params.get('otopic') ?? ''} extended={params.get('oscope') === 'extended'}
          onSelect={id => update({id})} onFilter={values => update({...values, id: ''})} onExplore={openGraph}>
          {current && <Detail key={current.id} node={current} index={index} evidence={data.evidenceIndex} evidenceLoading={data.evidenceLoading} onSelect={id => update({id})} onClose={() => update({id: ''})} onGraph={() => openGraph(current.id)} onClauses={value => startQuery({view: '', root: '', mode: 'clauses', q: value, id: '', kind: '', topic: ''})} />}
        </PanoramaGraphView>
      </Suspense>}
    </>}
    {graphView && <>
      <div className={styles.graphNavigation}><Button variant="outline" size="sm" onClick={reset}>← 回到开始</Button><Button variant="outline" size="sm" onClick={openPanorama}>看全景</Button><Button variant="outline" size="sm" onClick={() => update({view: '', root: ''})}>返回资料查询</Button></div>
      {!data.loading && graph && <Suspense fallback={<p role="status">正在加载交互图谱…</p>}>
        <KnowledgeGraphView key={root} root={root} selected={selected || root} index={index} evidence={data.evidenceIndex} evidenceLoading={data.evidenceLoading} onSelect={choose} onCenter={id => update({root: id, id})}>
          {(current || index.nodes.get(root)) && <Detail node={(current || index.nodes.get(root))!} index={index} evidence={data.evidenceIndex} evidenceLoading={data.evidenceLoading} onSelect={id => update({root: id, id})} onClose={() => update({view: '', root: ''})} onClauses={value => startQuery({view: '', root: '', mode: 'clauses', q: value, id: '', kind: '', topic: ''})} />}
        </KnowledgeGraphView>
      </Suspense>}
    </>}
    <div hidden={isStart || graphView || panoramaView}>
    <Tabs.Root value={mode} onValueChange={event => update({mode: event.value, kind: '', id: ''})} variant="line" colorPalette="blue">
      <Tabs.List className={styles.tabs} aria-label="查询方式">
        {modes.map(item => <Tabs.Trigger key={item.value} value={item.value}>{item.title}</Tabs.Trigger>)}
      </Tabs.List>
    <Tabs.Content value={mode} p="0">
    <p className={styles.modeHint}>{modes.find(item => item.value === mode)?.hint}</p>
    <div className={styles.filters}>
      <div className={styles.searchField}>
        <label htmlFor="compliance-query">{mode === 'clauses' ? '你要找哪项要求？' : '你要查什么主题或标准？'}</label>
        <Input id="compliance-query" placeholder={mode === 'clauses' ? '例如：访问控制、最小必要、GB/T 20986-2023' : '例如：个人信息、GB/T 35273-2020'} value={query} onChange={event => update({q: event.target.value})} />
      </div>
      <details className={styles.moreFilters}>
        <summary>缩小查找范围{topic || kind ? '（已筛选）' : ''}</summary>
      <div className={styles.filterFields}><div>
        <label htmlFor="compliance-topic">主题范围</label>
        <NativeSelect.Root><NativeSelect.Field id="compliance-topic" value={topic} onChange={event => update({topic: event.target.value})}>
          <option value="">全部主题</option>{topics.map(value => <option key={value} value={value}>{topicLabel(value)}</option>)}
        </NativeSelect.Field><NativeSelect.Indicator /></NativeSelect.Root>
      </div>
      {mode === 'browse' && <div>
        <label htmlFor="compliance-kind">内容类型</label>
        <NativeSelect.Root><NativeSelect.Field id="compliance-kind" value={kind} onChange={event => update({kind: event.target.value})}>
          <option value="">全部类型</option><option value="StandardVersion">标准版本</option><option value="StandardSeries">标准系列</option>
          <option value="analysis">解读文章</option><option value="topic-guide">主题导读</option><option value="source-reader">标准阅读页</option>
        </NativeSelect.Field><NativeSelect.Indicator /></NativeSelect.Root>
      </div>}
      </div></details>
      <Button variant="outline" onClick={() => update({q: '', topic: '', kind: '', id: ''})}>清除条件</Button>
    </div>
    {!isStart && <div className={styles.examples} aria-label="查询示例"><span>换个问题</span>
      <Button size="xs" variant="ghost" onClick={() => update({mode: 'browse', q: '个人信息', kind: '', topic: '', id: ''})}>个人信息保护依据</Button>
      <Button size="xs" variant="ghost" onClick={() => update({mode: 'impact', q: '20986', kind: '', topic: '', id: 'standard:gb-z-20986-2007'})}>事件分类版本变化</Button>
      <Button size="xs" variant="ghost" onClick={() => update({mode: 'missing', q: '22081', kind: '', topic: '', id: 'standard:gb-t-22081-2016'})}>有导读但缺原文</Button>
      <Button size="xs" variant="ghost" onClick={() => update({mode: 'clauses', q: '访问控制', kind: '', topic: '', id: ''})}>跨标准查访问控制</Button>
    </div>}
    {!isStart && !data.loading && graph && <div className={styles.workspace}>
      <section className={styles.results} aria-label="查询结果">
        <div className={styles.resultSummary} aria-live="polite">找到 <strong>{nodes.length.toLocaleString('zh-CN')}</strong> 项 <span>第 {page} / {pages} 页</span></div>
        {!nodes.length && <div className={styles.empty}><h2>没有匹配结果</h2><p>可以缩短关键词、去掉年份，或展开“缩小查找范围”调整筛选。不带年份的标准请在“找相关资料”中查询。</p><Button variant="outline" onClick={() => update({q: '', topic: '', kind: ''})}>清除筛选</Button></div>}
        {nodes.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(node => <button type="button" key={node.id} className={`${styles.result} ${node.id === selected ? styles.selected : ''}`} aria-pressed={node.id === selected} onClick={() => choose(node.id)}>
          <span className={styles.resultType}>{typeLabel(node)}{node.type === 'StandardVersion' && !node.sources?.length && ' · 未收录原文'}</span>
          <strong>{node.label}</strong>
          <span className={styles.muted}>{node.type === 'Clause' ? index.nodes.get(node.standard ?? '')?.label : summarizeTopics(nodeTopics(index, node)) || '被引标准'}</span>
          {mode === 'impact' && <span className={styles.resultNote}>有明确代替证据 · {citingEdges(index, node.id).length} 条引用或提及关系</span>}
          {mode === 'missing' && <span className={styles.resultNote}>{citingEdges(index, node.id).length} 条引用或提及关系</span>}
        </button>)}
        {pages > 1 && <nav className={styles.pagination} aria-label="结果分页"><Button size="sm" variant="outline" disabled={page === 1} onClick={() => update({p: String(page - 1)})}>上一页</Button><span>{page} / {pages}</span><Button size="sm" variant="outline" disabled={page === pages} onClick={() => update({p: String(page + 1)})}>下一页</Button></nav>}
      </section>
      <div ref={detailRef} className={`${styles.detailColumn} ${current ? styles.selectedDetail : ''}`}>
        {current ? <Detail key={current.id} node={current} index={index} evidence={data.evidenceIndex} evidenceLoading={data.evidenceLoading} onSelect={choose} onClose={() => update({id: ''})} onGraph={() => openGraph(current.id)} onClauses={value => update({mode: 'clauses', q: value, topic: '', kind: '', id: ''})} /> : <div className={styles.welcome}>
          <span className={styles.eyebrow}>下一步</span><h2>{selected ? '当前数据中找不到这个对象' : '选择一条结果，继续查看'}</h2>
          <p>{selected ? '链接可能来自另一版试点数据。可以重新选择查询结果。' : '选择左侧文档或标准，查看它引用了什么、谁在引用它，以及每条关系的原文位置。'}</p>
          <ol><li><strong>找依据</strong>：保留版本与原文语境。</li><li><strong>看影响</strong>：沿明确替代关系复核引用。</li><li><strong>补缺项</strong>：区分导读、摘录与标准原文。</li></ol>
          <p className={styles.muted}>全部文档建立索引，30 份标准深入到编号章节。未建立的关系表示尚未收录，不表示不存在。</p>
        </div>}
      </div>
    </div>}
    </Tabs.Content>
    </Tabs.Root></div>
    <footer className={styles.dataFooter}>
      <p>这里帮助你找资料、核对原文。某项要求是否适用于你的业务，仍需结合具体情况判断。</p>
      <details><summary>收录范围与数据下载</summary>
      <p>已索引 {graph?.scope.indexedDocuments ?? '—'} 份文档，其中 {graph?.stats.relationships.transcribes ?? '—'} 份为标准原文转写；深入检索覆盖 {graph?.scope.clauseStandards.length ?? '—'} 份标准的 {graph?.stats.nodes.Clause.toLocaleString('zh-CN') ?? '—'} 个编号章节。章节也包含定义和附录，不都属于必须履行的要求。</p>
      <div><a href={`${base}graph.ttl`} download>知识图谱 RDF</a><a href={`${base}model.ttl`} download>本体模型</a><a href={`${base}shapes.ttl`} download>校验规则</a><a href={`${base}validation.json`}>覆盖与校验报告</a><a href={`${base}evidence.json`}>全部证据</a></div>
      {graph && <p className={styles.fingerprint}>数据指纹 {graph.sourceDigest.slice(0, 16)} · {graph.stats.evidence.toLocaleString('zh-CN')} 处证据</p>}
      </details>
    </footer>
  </div>;
}
