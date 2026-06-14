import fs from 'node:fs';
import path from 'node:path';
import type {LoadContext, Plugin} from '@docusaurus/types';
import {STATUS_MANIFEST, type StatusEntry} from '../../src/components/StatusTable/manifest';

type ResolvedEntry = StatusEntry & {runTime: string | undefined};

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function readMdxFetchedAt(filePath: string): string | undefined {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
  const match = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return undefined;
  for (const line of match[1].split('\n')) {
    const field = line.match(/^fetchedAt:\s*(.+?)\s*$/);
    if (field) return field[1].replace(/^['"]|['"]$/g, '');
  }
  return undefined;
}

function readJsonTimeField(filePath: string, field: string): string | undefined {
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    const value = data[field];
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

function expandGlob(rootDir: string, pattern: string): string[] {
  const segments = pattern.split('/');
  const startIndex = segments.findIndex((segment) => segment.includes('*'));
  if (startIndex === -1) {
    const full = path.join(rootDir, ...segments);
    return fs.existsSync(full) ? [full] : [];
  }

  const fixedDir = path.join(rootDir, ...segments.slice(0, startIndex));
  if (!fs.existsSync(fixedDir)) return [];
  const suffix = segments[segments.length - 1];
  const middle = segments.slice(startIndex, -1);
  const results: string[] = [];

  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, {withFileTypes: true});
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(suffix.replace('*', ''))) continue;
      const rel = toPosixPath(path.relative(rootDir, full));
      results.push(rel);
    }
  };

  walk(fixedDir);
  return results;
}

function resolveRunTime(
  siteDir: string,
  source: string,
  timeField: StatusEntry['timeField'],
): string | undefined {
  const isMdx = source.endsWith('.mdx') || source.endsWith('.md');
  const fullPath = path.isAbsolute(source) ? source : path.join(siteDir, source);

  if (isMdx) {
    return readMdxFetchedAt(fullPath);
  }

  if (source.includes('*')) {
    const matches = expandGlob(siteDir, source)
      .map((rel) => path.join(siteDir, rel))
      .map((abs) => readJsonTimeField(abs, timeField))
      .filter((value): value is string => Boolean(value));
    return pickLatest(matches);
  }

  return readJsonTimeField(fullPath, timeField);
}

function pickLatest(values: string[]): string | undefined {
  let latest: string | undefined;
  let latestTs = -Infinity;
  for (const value of values) {
    const ts = Date.parse(value);
    if (!Number.isNaN(ts) && ts > latestTs) {
      latestTs = ts;
      latest = value;
    }
  }
  return latest;
}

export default function statusDataPlugin(context: LoadContext): Plugin {
  const {siteDir} = context;

  return {
    name: 'status-data-plugin',

    async loadContent() {
      const entries: ResolvedEntry[] = STATUS_MANIFEST.map((entry) => ({
        ...entry,
        runTime: resolveRunTime(siteDir, entry.sources[0] ?? '', entry.timeField)
          ?? entry.sources
            .map((source) => resolveRunTime(siteDir, source, entry.timeField))
            .find((value): value is string => Boolean(value)),
      }));

      return {entries, generatedAt: Date.now()};
    },

    contentLoaded({content, actions}) {
      actions.setGlobalData(content);
    },
  };
}
