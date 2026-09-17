import {useEffect} from 'react';
import {useHistory} from '@docusaurus/router';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Head from '@docusaurus/Head';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';

export default function LegacyPlaylist() {
  const history = useHistory();
  const target = `${useBaseUrl('/')}?music=open`;
  useEffect(() => { history.replace(target); }, [history, target]);
  return (
    <Layout title="音乐">
      <Head><meta name="robots" content="noindex" /></Head>
      <main className="container margin-vert--lg">
        <p>音乐已合并到全站悬浮播放器。<Link to={target}>打开播放器</Link></p>
      </main>
    </Layout>
  );
}
