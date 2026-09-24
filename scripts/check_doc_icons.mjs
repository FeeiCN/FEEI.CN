import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import yaml from 'js-yaml';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconRoot = path.join(root, 'src/components/ItsHoverIcon');
const icons = new Set(fs.readdirSync(path.join(iconRoot, 'icons'))
  .filter(name => name.endsWith('.tsx')).map(name => name.slice(0, -4)));
const registry = fs.readFileSync(path.join(iconRoot, 'index.tsx'), 'utf8');
const aliasBlock = registry.split('const ICON_ALIASES')[1].split('};')[0];
const aliases = new Map([...aliasBlock.matchAll(/(?:['"]([^'"]+)['"]|(\w+))\s*:\s*['"]([^'"]+)['"]/g)]
  .map(match => [match[1] ?? match[2], match[3]]));
const errors = [];
let pages = 0;
let partials = 0;

function inspect(directory) {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      inspect(file);
      continue;
    }
    if (!/\.mdx?$/.test(entry.name)) continue;
    const source = fs.readFileSync(file, 'utf8');
    const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const relative = path.relative(root, file);
    let metadata;
    try {
      metadata = match ? yaml.load(match[1]) ?? {} : {};
    } catch (error) {
      errors.push(`${relative}: ${error.message}`);
      continue;
    }
    if (entry.name.startsWith('_')) {
      partials++;
      if (metadata.icon != null) errors.push(`${relative}: 引用片段不应设置 icon`);
      continue;
    }
    pages++;
    if (typeof metadata.icon !== 'string' || !icons.has(aliases.get(metadata.icon) ?? metadata.icon)) {
      errors.push(`${relative}: icon 缺失或未注册 (${metadata.icon ?? '空'})`);
    }
  }
}

inspect(path.join(root, 'docs'));
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`图标检查通过：${pages} 个独立页面，${partials} 个无图标引用片段。`);
}
