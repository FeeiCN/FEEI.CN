import fs from 'node:fs';
import path from 'node:path';
import type {LoadContext, Plugin} from '@docusaurus/types';
import {expandMarkdownIncludes, isMarkdownPartial} from './markdownIncludes';

type MarkdownMap = Record<string, string>;

function collectMarkdownFiles(dirPath: string): string[] {
  const entries = fs.readdirSync(dirPath, {withFileTypes: true});
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(fullPath));
    } else if (entry.isFile() && /\.md$/.test(entry.name) && !isMarkdownPartial(fullPath)) {
      files.push(fullPath);
    }
  }

  return files;
}

function rewriteAbsoluteUrls(markdown: string, siteUrl: string): string {
  let result = markdown.replace(
    /(!?\[[^\]]*\])\((\/(?![/])[^)]*)\)/g,
    (_, bracket, absPath) => `${bracket}(${siteUrl}${absPath})`,
  );
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
  if (/^url:/m.test(fmContent)) return markdown;

  const slugMatch = fmContent.match(/^slug:\s*(.+)$/m);
  if (!slugMatch) return markdown;

  const slug = slugMatch[1].trim();
  const fullUrl = `${siteUrl}${slug.startsWith('/') ? slug : '/' + slug}`;
  const newFmContent = fmContent.replace(/^(slug:\s*.+)$/m, `$1\nurl: ${fullUrl}`);
  return markdown.replace(fmMatch[0], `---\n${newFmContent}\n---`);
}

function renderedMarkdown(file: string, siteUrl?: string): string {
  const raw = fs.readFileSync(file, 'utf8');
  const expanded = expandMarkdownIncludes(raw, file);
  if (!siteUrl) return expanded;
  return rewriteAbsoluteUrls(injectUrlIntoFrontMatter(expanded, siteUrl), siteUrl);
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
        const key = '/' + path.relative(docsDir, file).split(path.sep).join('/');
        content[key] = renderedMarkdown(file, siteUrl);
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
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, {recursive: true});
        fs.writeFileSync(destPath, renderedMarkdown(file), 'utf8');
      }
    },
  };
}
