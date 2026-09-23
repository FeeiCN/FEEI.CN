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
