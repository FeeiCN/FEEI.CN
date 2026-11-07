#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export function deploymentScope(files) {
  let pages = false;
  let search = false;
  let data = false;
  for (const file of files) {
    if (file.startsWith('static/data/') || file === 'scripts/build_weather_cache.mjs') {
      data = true;
    } else if (file === 'scripts/build_search_index.mjs' || file.startsWith('scripts/search_index_') || file === 'config/search-zh-dict.txt') {
      search = true;
    } else if (/^(docs|blog|src|plugins|config|static)\//.test(file) ||
        /^(docusaurus\.config\.ts|sidebars\.ts|package(-lock)?\.json|tsconfig\.json|babel\.config\.[cm]?js|postcss\.config\.[cm]?js)$/.test(file) ||
        file === 'scripts/prepare_build_dependencies.mjs' || file === 'scripts/search_worker_loader.cjs') {
      pages = true;
    }
  }
  return {pages, search: search || pages, data};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [base, head = 'HEAD'] = process.argv.slice(2);
  let scope;
  try {
    if (!base) throw new Error('No published base');
    const files = execFileSync('git', ['diff', '--name-only', '-z', base, head, '--'], {encoding: 'utf8'}).split('\0').filter(Boolean);
    scope = deploymentScope(files);
  } catch {
    scope = {pages: true, search: true, data: true};
  }
  process.stdout.write(JSON.stringify(scope) + '\n');
}
