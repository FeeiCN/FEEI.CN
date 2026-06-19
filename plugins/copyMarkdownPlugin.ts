import fs from 'node:fs';
import path from 'node:path';
import type {LoadContext, Plugin} from '@docusaurus/types';

type MarkdownMap = Record<string, string>;

function collectMarkdownFiles(dirPath: string): string[] {
  const entries = fs.readdirSync(dirPath, {withFileTypes: true});
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(fullPath));
    } else if (entry.isFile() && /\.mdx?$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function rewriteAbsoluteUrls(markdown: string, siteUrl: string): string {
  // [text](/path) and ![alt](/path) → full URL variants
  let result = markdown.replace(
    /(!?\[[^\]]*\])\((\/(?![/])[^)]*)\)/g,
    (_, bracket, absPath) => `${bracket}(${siteUrl}${absPath})`,
  );
  // src="/path" and href="/path" in HTML/JSX → full URL variants
  result = result.replace(
    /((?:src|href)=")(\/(?![/])[^"]*)/g,
    (_, attr, absPath) => `${attr}${siteUrl}${absPath}`,
  );
  return result;
}

function injectUrlIntoFrontMatter(markdown: string, siteUrl: string): string {
  const fmMatch = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return markdown;

  const fmContent = fmMatch[1];
  if (/^url:/m.test(fmContent)) return markdown; // already present

  const slugMatch = fmContent.match(/^slug:\s*(.+)$/m);
  if (!slugMatch) return markdown;

  const slug = slugMatch[1].trim();
  const fullUrl = `${siteUrl}${slug.startsWith('/') ? slug : '/' + slug}`;

  // Insert url: right after slug:
  const newFmContent = fmContent.replace(
    /^(slug:\s*.+)$/m,
    `$1\nurl: ${fullUrl}`,
  );

  return markdown.replace(fmMatch[0], `---\n${newFmContent}\n---`);
}

export default function copyMarkdownPlugin(context: LoadContext): Plugin<MarkdownMap> {
  const {siteDir, siteConfig} = context;
  const docsDir = path.join(siteDir, 'docs');
  const siteUrl = siteConfig.url.replace(/\/$/, '');

  return {
    name: 'copy-markdown-plugin',

    async loadContent(): Promise<MarkdownMap> {
      if (!fs.existsSync(docsDir)) return {};

      const files = collectMarkdownFiles(docsDir);
      const content: MarkdownMap = {};

      for (const file of files) {
        // key matches metadata.source.replace('@site/docs', '')
        // e.g. /01-健康幸福/01-健康幸福.md
        const key = '/' + path.relative(docsDir, file).split(path.sep).join('/');
        const raw = fs.readFileSync(file, 'utf8');
        content[key] = rewriteAbsoluteUrls(injectUrlIntoFrontMatter(raw, siteUrl), siteUrl);
      }

      return content;
    },

    contentLoaded({content, actions}) {
      actions.setGlobalData(content);
    },

    async postBuild({outDir}) {
      if (!fs.existsSync(docsDir)) return;

      const files = collectMarkdownFiles(docsDir);

      for (const file of files) {
        const relative = path.relative(docsDir, file);
        const destPath = path.join(outDir, relative);
        const destDir = path.dirname(destPath);

        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, {recursive: true});
        }

        fs.copyFileSync(file, destPath);
      }
    },
  };
}
