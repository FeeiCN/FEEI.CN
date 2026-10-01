import React, {useEffect, useState} from 'react';
import Layout from '@theme/Layout';

type Deployment = {sha: string; deployedAt: string; summary: string; actionUrl?: string};
type Change = {date: string; summary: string; changeType: 'added' | 'updated' | 'deleted' | 'renamed'; additions: number; deletions: number; previousPath?: string; commitUrl: string};
type ArticleHistory = {title: string; path: string; current: boolean; changes: Change[]};

function formatDate(value: string, withTime = false): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {year: 'numeric', month: '2-digit', day: '2-digit', ...(withTime ? {hour: '2-digit', minute: '2-digit'} : {})}).format(date);
}
function changeLabel(type: Change['changeType']): string {
  return {added: '新增', updated: '更新', deleted: '删除', renamed: '改名'}[type];
}

export default function VersionsPage(): React.ReactElement {
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [deploymentLimit, setDeploymentLimit] = useState(10);
  const [articlePath, setArticlePath] = useState<string | null>(null);
  const [article, setArticle] = useState<ArticleHistory | null>(null);
  const [articleLoading, setArticleLoading] = useState(false);
  const [articleError, setArticleError] = useState(false);

  useEffect(() => {
    const path = new URLSearchParams(window.location.search).get('path');
    setArticlePath(path);
    if (!path) return;
    setArticleLoading(true);
    fetch('/version-history.json', {cache: 'force-cache'})
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('history unavailable')))
      .then((data) => setArticle(Array.isArray(data.articles) ? data.articles.find((item: ArticleHistory) => item.path === path) || null : null))
      .catch(() => setArticleError(true))
      .finally(() => setArticleLoading(false));
  }, []);

  useEffect(() => {
    fetch('/deployments.json', {cache: 'no-cache'})
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('deployments unavailable')))
      .then((data) => setDeployments(Array.isArray(data) ? data : []))
      .catch(() => { setDeployments([]); setError(true); })
      .finally(() => setLoading(false));
  }, []);

  return (
    <Layout title={articlePath ? `${article?.title || '文章'} · 变更记录` : '版本记录'} description="FEEI.CN 版本记录">
      <main className="container margin-vert--lg">
        <h1>{articlePath ? `${article?.title || '文章'} · 变更记录` : '版本记录'}</h1>
        {articlePath ? (
          <section className="version-records-section" aria-labelledby="article-history-title">
            <p><a href="/versions/">← 返回版本记录</a></p>
            <h2 id="article-history-title">文章内容变更</h2>
            {articleLoading ? <p aria-live="polite">正在加载变更记录…</p> : articleError ? <p role="alert">变更记录暂时加载失败，请刷新重试。</p> : !article ? <p>没有找到这篇文章的变更记录。</p> : (
              <>
                <p><code>{article.path}</code>{article.current ? '' : ' · 当前文件已不存在'}</p>
                <ul className="version-records-list">
                  {article.changes.map((change, index) => (
                    <li key={`${change.date}-${change.summary}-${index}`}>
                      <strong>{formatDate(change.date)}</strong> · {changeLabel(change.changeType)} · {change.summary}<br />
                      <span className="version-records-filter-note">+{change.additions}/−{change.deletions} · <a href={change.commitUrl} target="_blank" rel="noopener noreferrer">查看提交</a></span>
                      {change.previousPath && <><br /><small>原路径：<code>{change.previousPath}</code></small></>}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        ) : (
          <p>这里记录网站成功部署到线上环境的版本。每篇文章的具体变更，可从文章右上角操作菜单进入。</p>
        )}
        {!articlePath && <section className="version-records-section" aria-labelledby="deployment-history-title">
          <h2 id="deployment-history-title">成功部署（最近 10 条）</h2>
          {loading ? <p aria-live="polite">正在加载部署记录…</p> : error ? <p role="alert">部署记录暂时加载失败，请刷新重试。</p> : deployments.length === 0 ? <p>暂无部署记录。</p> : (
            <ul className="version-deployment-list">
              {deployments.slice(0, deploymentLimit).map((deployment) => <li key={deployment.sha} className="version-deployment-card"><div className="version-deployment-meta"><time dateTime={deployment.deployedAt}>{formatDate(deployment.deployedAt, true)}</time><code>{deployment.sha.slice(0, 8)}</code></div><p className="version-deployment-summary">{deployment.summary}</p>{deployment.actionUrl && <a className="version-deployment-action" href={deployment.actionUrl} target="_blank" rel="noopener noreferrer">查看部署详情</a>}</li>)}
            </ul>
          )}
          {!articlePath && !loading && !error && deploymentLimit < deployments.length && (
            <button type="button" className="button button--secondary margin-top--md" onClick={() => setDeploymentLimit((limit) => Math.min(limit + 10, deployments.length))}>
              加载更早版本
            </button>
          )}
        </section>}
      </main>
    </Layout>
  );
}
