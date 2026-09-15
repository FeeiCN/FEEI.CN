import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import type {LoadContext, Plugin} from '@docusaurus/types';

type DocMetadata = {
  updatedAt: number;
  revisionCount?: number;
};

type DocMetadataMap = Record<string, DocMetadata>;

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
 * synchronous `git log` processes per document. `--name-only` lets us map
 * each commit timestamp to every docs path touched by that commit.
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
      ['log', '--format=@@COMMIT@@%ct', '--name-only', '--', 'docs'],
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

    for (const rawLine of output.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;

      if (line.startsWith('@@COMMIT@@')) {
        flushCommit();
        const parsedTimestamp = Number(line.slice('@@COMMIT@@'.length));
        commitTimestamp = Number.isFinite(parsedTimestamp) && parsedTimestamp > 0
          ? parsedTimestamp
          : undefined;
        continue;
      }

      if (commitTimestamp && (line.endsWith('.md') || line.endsWith('.mdx'))) {
        touchedInCommit.add(toPosixPath(line));
      }
    }
    flushCommit();
  } catch {
    // Missing/unavailable git history is fine; callers fall back to file mtime.
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
        let fileMtime: number;
        try {
          fileMtime = fs.statSync(docFile).mtimeMs;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw error;
        }

        const relativePath = toPosixPath(path.relative(siteDir, docFile));
        const sourceKey = `@site/${relativePath}`;
        const git = gitMetadata.get(relativePath);

        metadata[sourceKey] = {
          updatedAt: git?.updatedAt ?? fileMtime,
          revisionCount: git?.revisionCount,
        };
      }

      return metadata;
    },

    contentLoaded({content, actions}) {
      actions.setGlobalData(content as DocMetadataMap);
    },
  };
}
