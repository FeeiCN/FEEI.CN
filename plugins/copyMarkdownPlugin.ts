import fs from 'node:fs';
import path from 'node:path';
import type {IncomingMessage, ServerResponse} from 'node:http';
import type {LoadContext, Plugin} from '@docusaurus/types';
import type {Configuration} from 'webpack-dev-server';
import {expandMarkdownIncludes, isMarkdownPartial} from './markdownIncludes';

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

export default function copyMarkdownPlugin(context: LoadContext, _options: unknown): Plugin {
  const {siteDir, siteConfig} = context;
  const docsDir = path.join(siteDir, 'docs');
  const siteUrl = siteConfig.url.replace(/\/$/, '');

  const plugin: Plugin = {
    name: 'copy-markdown-plugin',

    configureWebpack() {
      return {
        devServer: {
          setupMiddlewares(middlewares) {
            middlewares.unshift({
              name: 'copy-markdown',
              path: `${siteConfig.baseUrl}markdown/`,
              middleware(req: IncomingMessage, res: ServerResponse) {
                let file: string;
                try {
                  const relative = decodeURIComponent((req.url ?? '').split('?')[0]);
                  file = path.resolve(docsDir, `.${relative}`);
                } catch {
                  res.statusCode = 400;
                  res.end('Invalid Markdown path');
                  return;
                }
                const relative = path.relative(docsDir, file);
                if (relative.startsWith('..') || path.isAbsolute(relative)
                  || !file.endsWith('.md') || isMarkdownPartial(file)
                  || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
                  res.statusCode = 404;
                  res.end('Markdown not found');
                  return;
                }
                res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
                res.setHeader('Cache-Control', 'no-store');
                res.end(renderedMarkdown(file, siteUrl));
              },
            });
            return middlewares;
          },
        } satisfies Configuration,
      };
    },

    async postBuild({outDir}) {
      if (!fs.existsSync(docsDir)) return;

      const files = collectMarkdownFiles(docsDir);
      for (const file of files) {
        const relative = path.relative(docsDir, file);
        const destPath = path.join(outDir, 'markdown', relative);
        const destDir = path.dirname(destPath);
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, {recursive: true});
        fs.writeFileSync(destPath, renderedMarkdown(file, siteUrl), 'utf8');
      }
    },
  };

  return plugin;
}
