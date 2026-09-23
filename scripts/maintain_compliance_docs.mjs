#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const ROOT = 'docs/01-网络安全/01-网络空间安全/03-安全体系/03-安全合法合规';
const BASE = `${ROOT}/01-网络与基础设施安全`;
const QUAL = `${ROOT}/09-认证测评与资质`;
const GUIDE = 'docs/05-吴飞飞/01-关于/关于FEEI.CN/网站开发规范.md';
const aliases = new Map([
  ['网络安全等级保护制度.md', `${BASE}/01-等级保护/index.md`],
  ['关键信息基础设施安全保护体系.md', `${BASE}/02-关键信息基础设施/index.md`],
  ['密码应用与密评体系.md', `${BASE}/03-密码与密评/index.md`],
]);
const concrete = ['regulation', 'standard', 'qualification'];
const markdown = (file) => /\.mdx?$/i.test(file);
const partial = (file) => path.posix.basename(file).startsWith('_');
const inScope = (file) => file.startsWith(`${ROOT}/`);

export function frontMatter(source) {
  const match = source.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error('Missing or unclosed front matter');
  return match[0];
}

export function field(source, name) {
  const value = frontMatter(source).match(new RegExp(`^${name}:[ \\t]*(.*)$`, 'm'))?.[1] ?? '';
  return value.trim().replace(/^(['"])(.*)\1$/, '$2');
}

function setField(source, name, value) {
  const fm = frontMatter(source);
  const re = new RegExp(`^${name}:[^\\r\\n]*(?:\\r?\\n|$)`, 'm');
  const line = value === null ? '' : `${name}: ${value}\n`;
  const next = re.test(fm) ? fm.replace(re, line) : fm.replace(/^---\r?\n/, `---\n${line}`);
  return next + source.slice(fm.length);
}

function page(slug, title, type, body, position = 1) {
  return `---\nslug: ${slug}\ntitle: ${title}\n${type === 'hub' ? 'icon: shield-check\n' : ''}sidebar_position: ${position}\ndescription: ${title}的适用范围、阅读路径与证据要求。\ncontent_type: ${type}\n---\n\n# ${title}\n\n${body.trim()}\n`;
}

export function semanticType(file) {
  if (!inScope(file) || !markdown(file) || partial(file)) return null;
  const name = path.posix.basename(file);
  if (name === 'index.md' || name === '03-安全合法合规.md'
      || name === '金融网络与数据安全标准体系.md') return 'hub';
  if (file.startsWith(`${QUAL}/`)) return 'qualification';
  if (/^(?:GB|GA|GM|JR)-T-\d/.test(name)) return 'standard';
  return 'regulation';
}

// Do not edit Markdown examples in fenced or inline code.
export function proseOnly(source, transform) {
  let fence = null;
  return source.split(/(?<=\n)/).map((line) => {
    const mark = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (mark) {
      if (!fence) fence = mark[1];
      else if (mark[1][0] === fence[0] && mark[1].length >= fence.length) fence = null;
      return line;
    }
    if (fence) return line;
    return line.split(/(`+[^`]*`+)/g).map((part, index) => index % 2 ? part : transform(part)).join('');
  }).join('');
}

function localTarget(file, url) {
  if (!url || /^(?:[a-z][\w+.-]*:|\/|#)/i.test(url)) return null;
  const split = url.search(/[?#]/);
  const raw = split === -1 ? url : url.slice(0, split);
  const suffix = split === -1 ? '' : url.slice(split);
  let decoded;
  try { decoded = decodeURIComponent(raw); } catch { return null; }
  if (!markdown(decoded)) return null;
  return {target: path.posix.normalize(path.posix.join(path.posix.dirname(file), decoded)), suffix};
}

function linkTransform(line, change) {
  return line
    .replace(/(\]\([ \t]*)(<[^>]+>|[^\s)]+)(?=[\s)])/g, (all, start, raw) => {
      const angle = raw.startsWith('<');
      const url = angle ? raw.slice(1, -1) : raw;
      const next = change(url);
      return start + (angle ? `<${next}>` : next);
    })
    .replace(/(^ {0,3}\[[^\]]+\]:[ \t]*)(<[^>]+>|\S+)/g, (all, start, raw) => {
      const angle = raw.startsWith('<');
      const next = change(angle ? raw.slice(1, -1) : raw);
      return start + (angle ? `<${next}>` : next);
    });
}

export function repairLinks(file, source, paths) {
  const byName = new Map();
  for (const target of paths) {
    if (!inScope(target) || !markdown(target)) continue;
    const name = path.posix.basename(target);
    byName.set(name, [...(byName.get(name) ?? []), target]);
  }
  const changes = [];
  const result = proseOnly(source, (line) => linkTransform(line, (url) => {
    const parsed = localTarget(file, url);
    if (!parsed || paths.has(parsed.target) || (!inScope(file) && !inScope(parsed.target))) return url;
    const name = path.posix.basename(parsed.target);
    let options = aliases.has(name) ? [aliases.get(name)] : (byName.get(name) ?? []);
    if (options.length !== 1) {
      const suffix = decodeURIComponent(url.split(/[?#]/)[0]).replace(/^(?:\.\.?\/)+/, '');
      if (suffix.includes('/')) options = [...paths].filter((target) => inScope(target) && target.endsWith(`/${suffix}`));
    }
    // Only a unique, existing destination may replace a broken legacy path.
    if (options.length !== 1 || !paths.has(options[0])) return url;
    let next = path.posix.relative(path.posix.dirname(file), options[0]);
    if (!next.startsWith('.')) next = `./${next}`;
    next += parsed.suffix;
    changes.push({from: url, to: next});
    return next;
  }));
  return {source: result, changes};
}

function once(source, old, replacement, label) {
  if (source.includes(replacement)) return source;
  if (source.split(old).length !== 2) throw new Error(`Cannot safely patch ${label}`);
  return source.replace(old, replacement);
}

export function planChanges(input) {
  const files = new Map(input);
  const main = `${ROOT}/03-安全合法合规.md`;
  if (files.has(main)) {
    const source = files.get(main);
    const marker = '## 法规关系与适用顺序 {#legal-map}';
    const offset = source.indexOf(marker);
    if (offset !== -1) {
      const destination = `${ROOT}/00-法规参考/index.md`;
      if (files.has(destination)) throw new Error('Legal reference destination already exists; reconcile manually');
      const legacy = source.slice(offset);
      files.set(destination, page('/cybersecurity-legal-reference', '法规关系、时间与责任索引', 'hub',
        `本页保存原总览中的法规关系、时间索引、责任条件和治理映射。目录整理不代表重新核验全部法规状态；具体适用以对应官方文本为准。\n\n${legacy}`, 1));
      let intro = source.slice(0, offset).trimEnd();
      intro = intro.replace(/^(###) [1-5]\. /gm, '$1 ');
      const map = '\n\n## 安全合规全景\n\n```text\n主体 × 业务活动 × 系统属性 × 数据类型 × 地域\n                     ↓\n适用义务 → 建设标准 → 共用安全控制 → 测评、认证与报告\n                     ↑                         ↓\n                     └────── 整改、复测与变更 ──┘\n```\n\n每项义务保留自己的适用条件和证据范围，重复控制统一建设；证书、测评结果与报告义务不互相替代。';
      const anchor = '## 五步判断：从业务到合规 {#applicability}';
      if (intro.includes(anchor)) intro = intro.replace(anchor, `${map}\n\n${anchor}`);
      const refs = [
        ['legal-map', '法规关系与适用顺序'], ['legal-dates', '公布与施行时间'],
        ['legal-liability', '处罚条件与其他法律后果'], ['implementation', '企业治理详细映射'],
      ].map(([id, label]) => `<a id="${id}"></a>\n\n[${label}](./00-法规参考/index.md#${id})。`).join('\n\n');
      files.set(main, `${intro}\n\n## 法规依据与详细资料\n\n${refs}\n`);
    }
  }

  const qIndex = `${QUAL}/index.md`;
  if (files.has(qIndex)) {
    const source = files.get(qIndex);
    const sections = [
      ['## 企业与组织', '## 系统与运行环境', '01-企业与组织.md', '企业与组织认证与鉴证'],
      ['## 系统与运行环境', '## 产品与解决方案', '02-系统与环境.md', '系统与环境测评'],
      ['## 产品与解决方案', '## 人员与专业机构', '03-产品与方案.md', '产品与方案认证检测'],
      ['## 人员与专业机构', '## 如何判断', '04-人员与机构.md', '人员与专业机构资质'],
    ];
    if (source.includes(sections[0][0])) {
      for (const [start, end, filename, title] of sections) {
        const from = source.indexOf(start);
        const to = source.indexOf(end, from + start.length);
        if (from === -1 || to === -1) throw new Error(`Missing assurance section: ${title}`);
        const target = `${QUAL}/${filename}`;
        if (!files.has(target)) throw new Error(`Missing approved assurance page: ${target}`);
        const original = files.get(target);
        files.set(target, `${frontMatter(original)}\n# ${title}\n\n${source.slice(from + start.length, to).trim()}\n\n[返回认证、测评与资质总览](./index.md)。\n`);
      }
      const from = source.indexOf(sections[0][0]);
      const to = source.indexOf('## 如何判断', from);
      const navigation = '## 按对象阅读\n\n| 对象 | 独立页面 | 先核对什么 |\n| --- | --- | --- |\n'
        + sections.map(([, , name, title]) => `| ${title} | [详细要求](./${name}) | 适用条件、范围、证据和有效状态 |`).join('\n');
      files.set(qIndex, source.slice(0, from) + navigation + '\n\n' + source.slice(to));
    }
  }

  for (const [file, source] of files) {
    if (!inScope(file) || !markdown(file)) continue;
    if (partial(file)) continue;
    const type = semanticType(file);
    let next = setField(source, 'content_type', type);
    if (concrete.includes(type)) next = setField(next, 'icon', null);
    if (type === 'hub' && !field(next, 'icon')) next = setField(next, 'icon', 'shield-check');
    // Chat citation tokens are not portable references; retain official links.
    next = next.replace(/\uE200cite\uE202[^\uE201]*\uE201/g, '');
    files.set(file, next);
  }

  const quality = 'scripts/check_docs_quality.mjs';
  if (files.has(quality)) {
    let source = files.get(quality);
    source = once(source, "  'reference',\n", "  'reference',\n  'regulation',\n  'standard',\n  'qualification',\n", 'content type enum');
    source = once(source, "contentType === 'tutorial' || contentType === 'reference'",
      "['tutorial', 'reference', 'regulation', 'standard', 'qualification'].includes(contentType)", 'reference structure rules');
    source = once(source, "for (const key of ['slug', 'icon', 'description', 'content_type']) {",
      "for (const key of (['regulation', 'standard', 'qualification'].includes(contentType)\n      ? ['slug', 'description', 'content_type']\n      : ['slug', 'icon', 'description', 'content_type'])) {", 'icon policy');
    files.set(quality, source);
  }
  const tests = 'scripts/test_docs_quality.mjs';
  if (files.has(tests)) files.set(tests, once(files.get(tests),
    "['hub', 'article', 'tutorial', 'reference', 'review']",
    "['hub', 'article', 'tutorial', 'reference', 'review', 'regulation', 'standard', 'qualification']", 'type tests'));
  if (files.has(GUIDE)) {
    let source = files.get(GUIDE);
    const marker = '- `reference`：数据、法律原文、清单、术语或长期查询资料。';
    const addition = `${marker}\n- \`regulation\`：单项法律法规、规章或监管文件的义务解读。\n- \`standard\`：单项国家、行业或技术标准的建设与测评要求。\n- \`qualification\`：认证、测评、鉴证及人员或机构资质的适用范围与证明方式。`;
    source = once(source, marker, addition, 'writing guide');
    const note = '\n安全合法合规目录使用 hub / regulation / standard / qualification：入口负责关系与导航，明细页负责具体要求。该目录只在 hub 页面配置 icon；具体法规、标准及资质页不配置 icon。其他栏目既有 reference 等类型继续有效；原文 partial 不单独参与导航。\n';
    if (!source.includes('安全合法合规目录使用 hub / regulation / standard / qualification')) {
      source = source.replace('### `published_at`', note + '\n### `published_at`');
    }
    files.set(GUIDE, source);
  }
  const gate = 'scripts/check_docs_quality_gate.mjs';
  if (files.has(gate)) files.set(gate, once(files.get(gate),
    'if (result.status === 0) process.exit(0);',
    `// Validate the whole compliance subtree, including inbound links after moves.\nif (existsSync('${ROOT}')) {\n  const compliance = spawnSync(process.execPath, ['scripts/maintain_compliance_docs.mjs', '--check'], {stdio: 'inherit'});\n  if (compliance.error) throw compliance.error;\n  if (compliance.status !== 0) process.exit(compliance.status ?? 1);\n}\n\nif (result.status === 0) process.exit(0);`, 'compliance gate'));
  const pkgFile = 'package.json';
  if (files.has(pkgFile)) {
    const pkg = JSON.parse(files.get(pkgFile));
    pkg.scripts['check:compliance'] = 'node scripts/maintain_compliance_docs.mjs --check';
    if (!pkg.scripts['test:unit'].includes('test_compliance_docs.mjs')) {
      pkg.scripts['test:unit'] += ' && node --test scripts/test_compliance_docs.mjs';
    }
    files.set(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
  }

  const paths = new Set(files.keys());
  const repaired = [];
  for (const [file, source] of files) {
    if (!markdown(file)) continue;
    const result = repairLinks(file, source, paths);
    if (result.changes.length) {
      files.set(file, result.source);
      repaired.push({file, links: result.changes});
    }
  }
  return {files, repaired};
}

export function validate(files) {
  const errors = [];
  const slugs = new Map();
  const counts = {};
  const paths = new Set(files.keys());
  for (const [file, source] of files) {
    if (!markdown(file)) continue;
    if (!partial(file)) {
      try {
        const slug = field(source, 'slug');
        if (slug) slugs.set(slug, [...(slugs.get(slug) ?? []), file]);
        if (inScope(file)) {
          const type = field(source, 'content_type');
          if (type !== semanticType(file)) errors.push(`${file}: incorrect content_type ${type}`);
          if (!slug.startsWith('/')) errors.push(`${file}: missing stable absolute slug`);
          if (!field(source, 'description')) errors.push(`${file}: missing description`);
          if (concrete.includes(type) && field(source, 'icon')) errors.push(`${file}: detail page has icon`);
          if (type === 'hub' && !field(source, 'icon')) errors.push(`${file}: hub icon missing`);
          counts[type] = (counts[type] ?? 0) + 1;
        }
      } catch (error) { if (inScope(file)) errors.push(`${file}: ${error.message}`); }
    }
    proseOnly(source, (line) => {
      linkTransform(line, (url) => {
        const parsed = localTarget(file, url);
        if (parsed && (inScope(file) || inScope(parsed.target)) && !paths.has(parsed.target)) {
          errors.push(`${file}: broken Markdown link ${url}`);
        }
        return url;
      });
      for (const match of line.matchAll(/<!--\s*@include\s+([^\n>]+?)\s*-->/g)) {
        const ref = match[1].trim().replace(/^['"]|['"]$/g, '');
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), ref));
        if (inScope(file) && (!target.startsWith('docs/') || !paths.has(target))) {
          errors.push(`${file}: missing or invalid include ${ref}`);
        }
      }
      return line;
    });
  }
  for (const [slug, targets] of slugs) {
    if (targets.length > 1 && targets.some(inScope)) errors.push(`Duplicate slug ${slug}: ${targets.join(', ')}`);
  }
  return {errors: [...new Set(errors)], counts};
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !['--write', '--check'].includes(args[0])) throw new Error('Use --check (read-only) or --write');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const listed = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {cwd: root, maxBuffer: 64 * 1024 * 1024}).toString().split('\0').filter(Boolean);
  const input = new Map();
  const code = new Set(['scripts/check_docs_quality.mjs', 'scripts/check_docs_quality_gate.mjs', 'scripts/test_docs_quality.mjs', 'package.json']);
  for (const file of new Set(listed)) {
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
    input.set(file, markdown(file) || code.has(file) ? fs.readFileSync(absolute, 'utf8') : '');
  }
  const planned = args[0] === '--write' ? planChanges(input) : {files: input, repaired: []};
  const changes = [...planned.files].filter(([file, source]) => input.get(file) !== source);
  const check = validate(planned.files);
  for (const [file, old] of input) {
    if (inScope(file) && markdown(file) && !partial(file)) {
      if (!planned.files.has(file) || field(old, 'slug') !== field(planned.files.get(file), 'slug')) {
        check.errors.push(`${file}: existing slug was changed`);
      }
    }
  }
  if (check.errors.length) throw new Error(check.errors.join('\n'));
  if (args[0] === '--check') {
    if (changes.length) throw new Error(`Unapplied compliance migration/repairs:\n${changes.map(([f]) => f).join('\n')}`);
  } else {
    for (const [file, source] of changes) {
      const target = path.join(root, file);
      fs.mkdirSync(path.dirname(target), {recursive: true});
      fs.writeFileSync(target, source);
    }
  }
  console.log(JSON.stringify({mode: args[0], changedFiles: changes.map(([f]) => f), repairedLinks: planned.repaired, types: check.counts, errors: 0}, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
