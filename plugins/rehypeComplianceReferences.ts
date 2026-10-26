import fs from 'node:fs';
import path from 'node:path';

export const complianceDirectory = 'docs/01-网络安全/01-网络空间安全/03-安全体系/01-安全合法合规';

type Node = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: Node[];
};

export type ReferencePage = {file: string; url: string; title: string; standard?: string; aliases?: string[]};
type Resolution = {page: ReferencePage; revision: boolean};
type AuditEntry = {file: string; reference: string; url?: string; revision?: boolean};
type Options = {pages?: ReferencePage[]; root?: string; audit?: (entry: AuditEntry) => void};

const standardPattern = /(?<![\w/])(?:GB\s*(?:\/\s*[TZ])?|GM\s*\/\s*T|GA\s*\/\s*T)\s*\d+(?:\.\d+)*(?:\s*[—–－-]\s*\d{4})?(?![\w.])/g;
const protectedTags = /^(?:a|h[1-6]|pre|code|script|style|svg|math|textarea)$/;

export function normalizeStandard(value: string): string {
  return value.replace(/\s+/g, '').replace(/[—–－]/g, '-');
}

function frontMatterField(source: string, name: string): string {
  const frontMatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return frontMatter?.[1].match(new RegExp(`^${name}:[ \\t]*(.+)$`, 'm'))?.[1].trim().replace(/^(['"])(.*)\1$/, '$2') ?? '';
}

export function collectReferencePages(root = path.resolve(complianceDirectory)): ReferencePage[] {
  const pages: ReferencePage[] = [];
  const read = (directory: string) => {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) read(file);
      else if (/\.mdx?$/.test(entry.name) && !entry.name.startsWith('_')) {
        const source = fs.readFileSync(file, 'utf8');
        const url = frontMatterField(source, 'slug');
        if (!url || frontMatterField(source, 'draft') === 'true') continue;
        const title = frontMatterField(source, 'title') || source.match(/^# (.+)$/m)?.[1] || '';
        const match = [...title.matchAll(standardPattern)][0];
        const standard = match?.index === 0 ? match[0] : undefined;
        const aliases: string[] = [];
        const include = source.match(/<!--\s*@include\s+(\S+)\s*-->/)?.[1];
        const body = include ? fs.readFileSync(path.resolve(directory, include), 'utf8') : source;
        for (const line of body.slice(0, 12000).split('\n')) {
          if (!/^(?:本文件|本标准).{0,12}(?:代替|替代)/.test(line)) continue;
          const replacement = line.split(/[，。]/)[0];
          for (const match of replacement.matchAll(standardPattern)) aliases.push(normalizeStandard(match[0]));
        }
        pages.push({file, url, title, standard: standard ? normalizeStandard(standard) : undefined, aliases});
      }
    }
  };
  read(root);
  return pages;
}

export function resolveStandard(reference: string, pages: ReferencePage[]): Resolution | undefined {
  const key = normalizeStandard(reference);
  const exact = pages.filter(page => page.standard === key);
  if (exact.length === 1) return {page: exact[0], revision: false};
  if (exact.length > 1) return undefined;
  const family = key.replace(/-\d{4}$/, '');
  const year = Number(key.match(/-(\d{4})$/)?.[1] ?? 0);
  const candidates = pages.filter(page => page.aliases?.includes(key)
    || (page.standard?.replace(/-\d{4}$/, '') === family && Number(page.standard?.match(/-(\d{4})$/)?.[1] ?? 0) > year));
  const years = candidates.map(page => Number(page.standard?.match(/-(\d{4})$/)?.[1] ?? 0));
  const latest = candidates.filter((_, index) => years[index] === Math.max(...years));
  return latest.length === 1 ? {page: latest[0], revision: /-\d{4}$/.test(key)} : undefined;
}

export default function rehypeComplianceReferences(options: Options = {}) {
  const root = path.resolve(options.root ?? complianceDirectory);
  const pages = options.pages ?? collectReferencePages(root);
  const lawPages = pages.filter(page => !page.standard && !page.file.endsWith('/index.md')
    && /(?:法|条例|办法|规定|指引|预案|决定)$/.test(page.title) && page.title.length >= 6);
  const lawNames = [...new Set(lawPages.map(page => page.title))].sort((a, b) => b.length - a.length);
  const lawPattern = lawNames.length ? new RegExp(lawNames.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g') : undefined;
  return (tree: Node, file: {path?: string; history?: string[]}) => {
    const source = path.resolve(file.path ?? file.history?.[0] ?? '');
    const relative = path.relative(root, source);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return;
    const ownUrl = pages.find(page => page.file === source)?.url;
    const link = (value: string, resolved: Resolution): Node => ({
      type: 'element', tagName: 'a', properties: {href: resolved.page.url},
      children: [{type: 'text', value: value + (resolved.revision ? `（站内 ${resolved.page.standard} 版）` : '')}],
    });
    const split = (value: string): Node[] => {
      const matches = [...value.matchAll(standardPattern)].map(match => ({index: match.index!, text: match[0], resolved: resolveStandard(match[0], pages)}));
      if (lawPattern) for (const match of value.matchAll(lawPattern)) {
        const targets = lawPages.filter(page => page.title === match[0]);
        if (targets.length === 1) matches.push({index: match.index!, text: match[0], resolved: {page: targets[0], revision: false}});
      }
      matches.sort((a, b) => a.index - b.index || b.text.length - a.text.length);
      const nodes: Node[] = [];
      let offset = 0;
      for (const match of matches) {
        if (match.index < offset) continue;
        options.audit?.({file: source, reference: match.text, url: match.resolved?.page.url, revision: match.resolved?.revision});
        if (!match.resolved || match.resolved.page.url === ownUrl) continue;
        if (match.index > offset) nodes.push({type: 'text', value: value.slice(offset, match.index)});
        nodes.push(link(match.text, match.resolved));
        offset = match.index + match.text.length;
      }
      if (offset < value.length) nodes.push({type: 'text', value: value.slice(offset)});
      return nodes.length ? nodes : [{type: 'text', value}];
    };
    const visit = (node: Node) => {
      if (protectedTags.test(node.tagName ?? '') || String(node.properties?.className ?? '').includes('katex')) return;
      if (node.children) node.children = node.children.flatMap(child => {
        if (child.type === 'text') return split(child.value ?? '');
        visit(child);
        return [child];
      });
    };
    visit(tree);
  };
}
