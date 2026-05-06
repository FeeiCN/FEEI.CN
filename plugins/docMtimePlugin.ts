import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import type {LoadContext, Plugin} from '@docusaurus/types';

type DocTimestampMap = Record<string, number>;

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function collectDocFiles(dirPath: string): string[] {
  const entries = fs.readdirSync(dirPath, {withFileTypes: true});
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectDocFiles(fullPath));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (fullPath.endsWith('.md') || fullPath.endsWith('.mdx')) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

function getGitLastUpdatedAt(siteDir: string, relativePath: string): number | undefined {
  try {
    const output = execFileSync(
      'git',
      ['log', '-1', '--format=%ct', '--', relativePath],
      {
        cwd: siteDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim();

    const timestampSeconds = Number(output);

    if (Number.isFinite(timestampSeconds) && timestampSeconds > 0) {
      return timestampSeconds * 1000;
    }
  } catch {
    // Fall through to file mtime below.
  }

  return undefined;
}

export default function docMtimePlugin(context: LoadContext): Plugin {
  const {siteDir} = context;
  const docsDir = path.join(siteDir, 'docs');

  return {
    name: 'doc-mtime-plugin',

    async loadContent() {
      if (!fs.existsSync(docsDir)) {
        return {};
      }

      const timestamps: DocTimestampMap = {};
      const docFiles = collectDocFiles(docsDir);

      for (const docFile of docFiles) {
        const relativePath = toPosixPath(path.relative(siteDir, docFile));
        const sourceKey = `@site/${relativePath}`;
        const gitLastUpdatedAt = getGitLastUpdatedAt(siteDir, relativePath);
        const fileMtime = fs.statSync(docFile).mtimeMs;

        timestamps[sourceKey] = gitLastUpdatedAt ?? fileMtime;
      }

      return timestamps;
    },

    contentLoaded({content, actions}) {
      actions.setGlobalData(content as DocTimestampMap);
    },
  };
}
