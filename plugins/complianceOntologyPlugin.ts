import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {LoadContext, Plugin} from '@docusaurus/types';

type ValidationReport = {conforms: boolean; sourceDigest: string; inputs: Record<string, string>; exports: Record<string, string>};

export function verifyComplianceOntology(siteDir: string): void {
  const data = path.join(siteDir, 'static/data/compliance');
  const fail = (message: string): never => {
    throw new Error(`${message}。请安装 scripts/requirements-ontology.txt 中的依赖，并运行 npm run ontology:build。`);
  };
  const reportPath = path.join(data, 'validation.json');
  if (!fs.existsSync(reportPath)) fail('合规知识校验报告缺失');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as ValidationReport;
  if (!report.conforms || !report.inputs || !report.exports || !/^[a-f0-9]{64}$/.test(report.sourceDigest)) fail('合规知识校验未通过');
  for (const [file, expected] of Object.entries(report.inputs)) {
    const full = path.resolve(siteDir, file);
    if (!fs.existsSync(full) || createHash('sha256').update(fs.readFileSync(full)).digest('hex') !== expected) {
      fail(`合规知识数据已过期：${file}`);
    }
  }
  const indexFile = path.join(siteDir, 'scripts/data/compliance-document-index.json');
  const index = JSON.parse(fs.readFileSync(indexFile, 'utf8')) as {root: string};
  const walk = (directory: string) => {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) {
        const relative = path.relative(siteDir, full).split(path.sep).join('/');
        if (!report.inputs[relative]) fail(`合规知识尚未收录文档：${relative}`);
      }
    }
  };
  walk(path.join(siteDir, index.root));
  for (const file of ['graph.json', 'clauses.json', 'evidence.json']) {
    const full = path.join(data, file);
    if (!fs.existsSync(full) || JSON.parse(fs.readFileSync(full, 'utf8')).sourceDigest !== report.sourceDigest) {
      fail(`合规知识导出缺失或版本不一致：${file}`);
    }
  }
  for (const file of ['model.ttl', 'shapes.ttl', 'graph.ttl']) {
    if (!fs.existsSync(path.join(data, file))) fail(`合规知识导出缺失：${file}`);
  }
  for (const [file, expected] of Object.entries(report.exports)) {
    const full = path.join(data, file);
    if (!fs.existsSync(full) || createHash('sha256').update(fs.readFileSync(full)).digest('hex') !== expected) {
      fail(`合规知识导出内容不匹配：${file}`);
    }
  }
}

export default function complianceOntologyPlugin(context: LoadContext): Plugin {
  return {
    name: 'compliance-ontology',
    loadContent() {verifyComplianceOntology(context.siteDir);},
    getPathsToWatch() {
      return ['config/compliance-ontology/*', 'static/data/compliance/*.json',
        'scripts/build_compliance_ontology.py', 'scripts/index_compliance_documents.py',
        'scripts/data/compliance-document-index.json',
        'docs/01-网络安全/01-网络空间安全/03-安全体系/01-安全合法合规/**/*.md'];
    },
  };
}
