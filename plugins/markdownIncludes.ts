import fs from 'node:fs';
import path from 'node:path';

const includePattern = /<!--\s*@include\s+([^\n>]+?)\s*-->/g;

function stripFrontMatter(markdown: string): string {
  if (!markdown.startsWith('---')) return markdown;
  const match = markdown.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? markdown.slice(match[0].length) : markdown;
}

function assertInsideDocs(includePath: string): void {
  const docsRoot = path.resolve(process.cwd(), 'docs');
  const relative = path.relative(docsRoot, includePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Markdown include must stay inside docs/: ${includePath}`);
  }
}

function rebaseStandardLinks(markdown: string, includePath: string, sourcePath: string): string {
  let fence: string | undefined;
  const rebase = (url: string): string => {
    if (/^(?:[a-z][\w+.-]*:|\/|#)/i.test(url)) return url;
    const split = url.search(/[?#]/);
    const pathname = split === -1 ? url : url.slice(0, split);
    const suffix = split === -1 ? '' : url.slice(split);
    const target = path.resolve(path.dirname(includePath), decodeURIComponent(pathname));
    const relative = path.relative(path.dirname(sourcePath), target).split(path.sep).join('/');
    return `${relative.startsWith('.') ? '' : './'}${relative}${suffix}`;
  };
  return markdown.split(/(?<=\n)/).map((line) => {
    const mark = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (mark) {
      if (!fence) fence = mark[1];
      else if (mark[1][0] === fence[0] && mark[1].length >= fence.length) fence = undefined;
      return line;
    }
    if (fence) return line;
    return line.split(/(`+[^`]*`+)/g).map((part, index) => index % 2 ? part : part
      .replace(/(\]\()([^\s)]+)(?=[\s)])/g, (_match, prefix: string, url: string) => prefix + rebase(url))
      .replace(/(^ {0,3}\[[^\]]+\]:[ \t]*)(\S+)/g, (_match, prefix: string, url: string) => prefix + rebase(url))
      .replace(/(?<![\w/])(?:https?:\/\/)?www\.[a-z\d.-]+(?=[\u3400-\u9fff])/gi,
        (url) => `[${url}](${url.startsWith('http') ? url : `http://${url}`})`)
      .replace(/(?<!\\)\$(?=PATH\b|\s+Root[lL])/g, '\\$')
    ).join('');
  }).join('');
}

export function expandMarkdownIncludes(markdown: string, sourcePath?: string): string {
  if (!sourcePath || !markdown.includes('@include')) return markdown;

  return markdown.replace(includePattern, (_match, rawReference: string) => {
    const reference = rawReference.trim().replace(/^['"]|['"]$/g, '');
    const includePath = path.resolve(path.dirname(sourcePath), reference);
    assertInsideDocs(includePath);
    if (!fs.existsSync(includePath)) {
      throw new Error(`Markdown include not found: ${reference} (from ${sourcePath})`);
    }

    const included = stripFrontMatter(fs.readFileSync(includePath, 'utf8')).trim();
    const filename = path.basename(reference);

    if (/^_(?:GB|GM|GA)-T-[\d.]+-\d{4}(?:-|\.)/.test(filename)) {
      return rebaseStandardLinks(included.replace(/^# [^\n]+\n*/, ''), includePath, sourcePath);
    }

    // Reference material is useful for verification but should not dominate the
    // default reading path. Keep it in the page for anchors/search while making
    // the implementation guidance the primary visible content.
    if (filename.includes('原文')) {
      return `<details>\n<summary>查看法规原文</summary>\n\n${included}\n\n</details>`;
    }

    return included;
  });
}

export function isMarkdownPartial(filePath: string): boolean {
  return path.basename(filePath).startsWith('_');
}
