import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import type {LoadContext, Plugin} from '@docusaurus/types';

type DocMetadata = {
  updatedAt: number;
  revisionCount?: number;
};

export type DocMetadataMap = Record<string, DocMetadata>;

type GitMetadata = {
  updatedAt: number;
  revisionCount: number;
};

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function collectDocFiles(dirPath: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, {withFileTypes: true});
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectDocFiles(fullPath));
    } else if (entry.isFile() && (fullPath.endsWith('.md') || fullPath.endsWith('.mdx'))) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

/**
 * Read all docs history with a single git process instead of spawning two
 * synchronous `git log` processes per document. NUL-delimited paths preserve
 * Chinese characters, whitespace and quotes independently of core.quotePath.
 *
 * This intentionally counts commits touching the current path. It does not
 * follow historical renames; preserving `--follow` semantics would require
 * per-file history walks and was the source of the multi-minute build cost.
 */
function getGitMetadata(siteDir: string): Map<string, GitMetadata> {
  const metadata = new Map<string, GitMetadata>();

  try {
    const output = execFileSync(
      'git',
      ['log', '--format=@@COMMIT@@%ct', '--name-only', '-z', '--', 'docs'],
      {
        cwd: siteDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 64 * 1024 * 1024,
      },
    );

    let commitTimestamp: number | undefined;
    const touchedInCommit = new Set<string>();

    const flushCommit = () => {
      if (!commitTimestamp) return;
      for (const relativePath of touchedInCommit) {
        const current = metadata.get(relativePath);
        if (current) {
          current.updatedAt = Math.max(current.updatedAt, commitTimestamp * 1000);
          current.revisionCount += 1;
        } else {
          metadata.set(relativePath, {
            updatedAt: commitTimestamp * 1000,
            revisionCount: 1,
          });
        }
      }
      touchedInCommit.clear();
    };

    for (const token of output.split('\0')) {
      const value = token.replace(/^\n/, '');
      if (!value) continue;

      if (value.startsWith('@@COMMIT@@')) {
        flushCommit();
        const parsedTimestamp = Number(value.slice('@@COMMIT@@'.length));
        commitTimestamp = Number.isFinite(parsedTimestamp) && parsedTimestamp > 0
          ? parsedTimestamp
          : undefined;
        continue;
      }

      if (commitTimestamp && (value.endsWith('.md') || value.endsWith('.mdx'))) {
        touchedInCommit.add(toPosixPath(value));
      }
    }
    flushCommit();
  } catch {
    // Missing git history means an unknown update time, not the checkout time.
  }

  return metadata;
}

export default function docMtimePlugin(context: LoadContext): Plugin {
  const {siteDir} = context;
  const docsDir = path.join(siteDir, 'docs');

  return {
    name: 'doc-mtime-plugin',

    async loadContent() {
      if (!fs.existsSync(docsDir)) return {};

      const metadata: DocMetadataMap = {};
      const docFiles = collectDocFiles(docsDir);
      const gitMetadata = getGitMetadata(siteDir);

      for (const docFile of docFiles) {
        const relativePath = toPosixPath(path.relative(siteDir, docFile));
        const sourceKey = `@site/${relativePath}`;
        const git = gitMetadata.get(relativePath);
        if (!git) continue;

        metadata[sourceKey] = {
          updatedAt: git.updatedAt,
          revisionCount: git.revisionCount,
        };
      }

      return metadata;
    },

    contentLoaded({content, actions}) {
      actions.setGlobalData(content as DocMetadataMap);
    },
  };
}
