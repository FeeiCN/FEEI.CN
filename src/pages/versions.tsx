import React, {useEffect, useState} from 'react';
import Layout from '@theme/Layout';

type Deployment = {sha: string; deployedAt: string; summary: string; actionUrl?: string};

export default function VersionsPage(): React.ReactElement {
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  useEffect(() => {
    fetch('/deployments.json')
      .then((response) => response.ok ? response.json() : [])
      .then((data) => setDeployments(Array.isArray(data) ? data : []))
      .catch(() => setDeployments([]));
  }, []);
  return (
    <Layout title="版本记录" description="FEEI.CN 成功部署记录">
      <main className="container margin-vert--lg">
        <h1>版本记录</h1>
        <p>这里记录网站成功部署到线上环境的版本。</p>
        {deployments.length === 0 ? <p>暂无部署记录。</p> : (
          <ul>
            {deployments.map((deployment) => (
              <li key={deployment.sha}>
                <strong>{deployment.deployedAt}</strong> · <code>{deployment.sha.slice(0, 8)}</code> · {deployment.summary}
                {deployment.actionUrl && <> · <a href={deployment.actionUrl}>查看 GitHub Action</a></>}
              </li>
            ))}
          </ul>
        )}
      </main>
    </Layout>
  );
}
