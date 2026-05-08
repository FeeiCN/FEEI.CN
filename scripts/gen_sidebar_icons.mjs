#!/usr/bin/env node
/**
 * Scans docs/ and docusaurus.config.ts for icon: values,
 * then regenerates src/components/SidebarIcon/index.tsx.
 *
 * Usage: node scripts/gen_sidebar_icons.mjs
 *
 * When adding an icon whose kebab-case name doesn't convert cleanly to a
 * Lucide PascalCase component name, add it to ALIASES below.
 */

import {readFileSync, writeFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Icons whose kebab→PascalCase doesn't match the Lucide component name.
// Key: icon name used in frontmatter/config. Value: Lucide export name.
const ALIASES = {
  'apple-whole':   'Apple',
  'clock':         'Clock3',
  'code-branch':   'GitBranch',
  'hourglass-end': 'Hourglass',
  'industry':      'Factory',
  'language':      'Languages',
  'messages-square': 'MessageSquare',
  'sport-shoe':    'Footprints',
  'user-graduate': 'GraduationCap',
};

function toPascalCase(str) {
  return str.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

function collectIcons(dir, icons = new Set()) {
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectIcons(full, icons);
    } else if (entry.name.endsWith('.md') || entry.name.endsWith('.mdx') || entry.name.endsWith('.json')) {
      const text = readFileSync(full, 'utf8');
      for (const m of text.matchAll(/["']?icon["']?\s*:\s*["']?([a-z0-9-]+)["']?/g)) {
        icons.add(m[1]);
      }
    }
  }
  return icons;
}

// Collect from docs/ and docusaurus.config.ts
const icons = collectIcons(join(ROOT, 'docs'));
const configText = readFileSync(join(ROOT, 'docusaurus.config.ts'), 'utf8');
for (const m of configText.matchAll(/icon:\s*['"]([a-z0-9-]+)['"]/g)) {
  icons.add(m[1]);
}

// Build sorted list of (iconName, lucideName)
const entries = [...icons].sort().map(name => [name, ALIASES[name] ?? toPascalCase(name)]);
const lucideNames = [...new Set(entries.map(([, l]) => l))].sort();

const IMPORT_LINE = lucideNames.map((n, i) => {
  const prefix = i === 0 ? '  ' : '  ';
  return prefix + n;
}).join(',\n');

const ICONS_MAP = entries.map(([k, v]) => `  '${k}': ${v},`).join('\n');

const output = `import React from 'react';
import clsx from 'clsx';
import type {LucideIcon} from 'lucide-react';
import {
${IMPORT_LINE},
} from 'lucide-react';

type Props = {
  icon?: string;
  className?: string;
};

const ICONS: Record<string, LucideIcon> = {
${ICONS_MAP}
};

export default function SidebarIcon({icon, className}: Props) {
  if (!icon) return null;
  const Icon = ICONS[icon];
  if (!Icon) return null;
  return <Icon aria-hidden="true" className={clsx('sidebarIcon', className)} />;
}
`;

const outPath = join(ROOT, 'src/components/SidebarIcon/index.tsx');
writeFileSync(outPath, output, 'utf8');
console.log(`Generated SidebarIcon with ${entries.length} icons → ${relative(ROOT, outPath)}`);
