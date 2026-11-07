import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import ComplianceKnowledge from '../components/ComplianceKnowledge';

export default function ComplianceKnowledgePage() {
  return <Layout title="合规知识查询" description="沿原文证据查询安全合规文档、标准版本、引用关系与试点条款，检查明确替代关系和原文缺项。">
    <main className="container margin-vert--lg">
      <p style={{fontSize: '.8rem'}}><Link to="/cybersecurity-laws">安全合法合规</Link> / 合规知识查询</p>
      <h1 style={{fontSize: '2rem', letterSpacing: '-.03em'}}>合规知识查询</h1>
      <p style={{color: 'var(--ifm-color-emphasis-700)', maxWidth: '48rem'}}>想找一项要求的出处，或检查标准换版的影响？从下面的问题开始，每一步都能回到原文核对。</p>
      <ComplianceKnowledge />
    </main>
  </Layout>;
}
