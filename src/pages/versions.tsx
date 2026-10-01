import React, {useEffect, useMemo, useState} from 'react';
import Layout from '@theme/Layout';

type Deployment = {sha: string; deployedAt: string; summary: string; actionUrl?: string};
type HistoricalChange = {
  sha: string;
  date: string;
  summary: string;
  source: 'git';
  changeType: 'added' | 'updated' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  previousPath?: string;
  commitUrl: string;
};
type ArticleHistory = {
  path: string;
  title: string;
  current: boolean;
  changes: HistoricalChange[];
};
type VersionHistory = {
  generatedAt: string;
  source: {type: string; repository: string; head: string; scope: string};
  filters: {included: string; excludedCommits: Record<string, number>};
  summary: {commitsSeen: number; commitsIncluded: number; fileRecordsSeen: number; changesIncluded: number; articlesIncluded: number};
  articles: ArticleHistory[];
};

const PAGE_SIZE = 40;

function formatDate(value: string, includeTime = false): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(includeTime ? {hour: '2-digit', minute: '2-digit'} : {}),
  }).format(date);
}

function changeLabel(changeType: HistoricalChange['changeType']): string {
  return {added: '新增', updated: '更新', deleted: '删除', renamed: '改名'}[changeType];
}

export default function VersionsPage(): React.ReactElement {
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [deploymentsLoading, setDeploymentsLoading] = useState(true);
  const [history, setHistory] = useState<VersionHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    fetch('/deployments.json')
      .then((response) => response.ok ? response.json() : [])
      .then((data) => setDeployments(Array.isArray(data) ? data : []))
      .catch(() => setDeployments([]))
      .finally(() => setDeploymentsLoading(false));
    fetch('/version-history.json')
      .then((response) => response.ok ? response.json() : null)
      .then((data) => setHistory(data && Array.isArray(data.articles) ? data as VersionHistory : null))
      .catch(() => setHistory(null))
      .finally(() => setHistoryLoading(false));
  }, []);

  const filteredArticles = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!history || !normalizedQuery) return history?.articles || [];
    return history.articles.filter((article) => {
      const searchableText = `${article.title} ${article.path} ${article.changes.map((change) => change.summary).join(' ')}`;
      return searchableText.toLocaleLowerCase().includes(normalizedQuery);
    });
  }, [history, query]);
  const pageCount = Math.max(1, Math.ceil(filteredArticles.length / PAGE_SIZE));
  const visibleArticles = filteredArticles.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [query]);

  return (
    <Layout title="版本记录" description="FEEI.CN 成功部署记录">
      <main className="container margin-vert--lg">
        <h1>版本记录</h1>
        <p>这里分开记录成功部署到线上环境的版本，以及从 Git 历史整理出的文章内容变更。Git 提交不等同于线上部署。</p>
        <section className="version-records-section" aria-labelledby="deployment-history-title">
          <h2 id="deployment-history-title">成功部署</h2>
          {deploymentsLoading ? <p aria-live="polite">正在加载部署记录…</p> : deployments.length === 0 ? <p>暂无部署记录。</p> : (
            <ul className="version-deployment-list">
              {deployments.map((deployment) => (
                <li key={deployment.sha} className="version-deployment-card">
                  <div className="version-deployment-meta">
                    <time dateTime={deployment.deployedAt}>{formatDate(deployment.deployedAt, true)}</time>
                    <code>{deployment.sha.slice(0, 8)}</code>
                  </div>
                  <p className="version-deployment-summary">{deployment.summary}</p>
                  {deployment.actionUrl && <a className="version-deployment-action" href={deployment.actionUrl} target="_blank" rel="noopener noreferrer">查看部署详情</a>}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="version-records-section" aria-labelledby="content-history-title">
          <h2 id="content-history-title">文章内容变更</h2>
          {historyLoading ? <p aria-live="polite">正在加载文章历史…</p> : !history ? <p>暂无内容变更历史。</p> : (
            <>
              <p>
                已整理 {history.summary.articlesIncluded} 篇文章、{history.summary.changesIncluded} 次内容变更，按文章聚合显示。历史范围：{formatDate(history.generatedAt)} 生成，来源为 <code>{history.source.head.slice(0, 8)}</code>。
              </p>
              <p className="version-records-filter-note">{history.filters.included}</p>
              <label className="version-records-search">
                <span>筛选文章</span>
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入标题、路径或变更内容" type="search" />
              </label>
              <p className="version-records-result-count" aria-live="polite">
                {query.trim() ? `匹配 ${filteredArticles.length} 篇文章` : `共 ${filteredArticles.length} 篇文章`}
              </p>
              {visibleArticles.length === 0 ? <p>没有匹配的文章。</p> : (
                <div className="version-records-articles">
                  {visibleArticles.map((article) => (
                    <details key={article.path} className="version-records-article">
                      <summary>
                        <strong>{article.title}</strong>
                        <span>{article.changes.length} 次变更{article.current ? '' : ' · 当前文件已不存在'}</span>
                      </summary>
                      <p><code>{article.path}</code></p>
                      <ul className="version-records-list">
                        {article.changes.map((change) => (
                          <li key={`${change.sha}-${article.path}`}>
                            <strong>{formatDate(change.date)}</strong> · {changeLabel(change.changeType)} · {change.summary} · +{change.additions}/−{change.deletions} · <a href={change.commitUrl} target="_blank" rel="noopener noreferrer">查看提交</a>
                            {change.previousPath && <><br /><small>原路径：<code>{change.previousPath}</code></small></>}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ))}
                </div>
              )}
              {pageCount > 1 && (
                <nav className="version-records-pagination" aria-label="文章历史分页">
                  <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>上一页</button>
                  <span>第 {page} / {pageCount} 页</span>
                  <button type="button" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page === pageCount}>下一页</button>
                </nav>
              )}
            </>
          )}
        </section>
      </main>
    </Layout>
  );
}
