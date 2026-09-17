#!/usr/bin/env node

import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

function withRepository(run) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'docs-quality-'));
  try {
    mkdirSync(path.join(root, 'scripts'));
    mkdirSync(path.join(root, 'docs'));
    for (const name of ['check_docs_quality.mjs', 'check_docs_quality_gate.mjs']) {
      copyFileSync(path.join(scriptDir, name), path.join(root, 'scripts', name));
    }
    const git = (...args) => execFileSync('git', args, {cwd: root, stdio: 'pipe'});
    git('init', '-q');
    git('config', 'user.name', 'Docs Test');
    git('config', 'user.email', 'docs-test@example.invalid');
    git('commit', '--allow-empty', '-qm', 'baseline');
    const writeDoc = (file, source) => {
      const target = path.join(root, file);
      mkdirSync(path.dirname(target), {recursive: true});
      writeFileSync(target, source);
    };
    const check = (gate = false) => spawnSync(process.execPath, [
      `scripts/${gate ? 'check_docs_quality_gate' : 'check_docs_quality'}.mjs`, '--changed',
    ], {cwd: root, encoding: 'utf8'});
    run({git, writeDoc, check});
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
}

function document(type, extra = '', body = '我在工作中记录了一次实践。') {
  return `---\nslug: /test\nicon: target-icon\ndescription: 测试文档。\ncontent_type: ${type}\npublished_at: '2026-01-01'\n${extra}---\n\n# 测试\n\n${body}\n`;
}

for (const type of ['hub', 'article', 'tutorial', 'reference', 'review']) {
  test(`${type} does not require a review date in a security directory`, () => {
    withRepository(({writeDoc, check}) => {
      writeDoc('docs/01-网络安全/01-网络空间安全/测试.md', document(type));
      for (const gate of [false, true]) {
        const result = check(gate);
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.doesNotMatch(result.stdout, /复核日期|LAST_REVIEWED/);
      }
    });
  });
}

test('obsolete review metadata is ignored rather than validated', () => {
  withRepository(({writeDoc, check}) => {
    writeDoc('docs/02-人生系统/01-健康幸福/测试.md', document('reference', "last_reviewed: 'not-a-date'\n"));
    const result = check();
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
});

test('modifying a historical article does not require invented dates', () => {
  withRepository(({git, writeDoc, check}) => {
    const file = 'docs/01-网络安全/01-网络空间安全/我的网络安全之路.md';
    const source = document('article').replace("published_at: '2026-01-01'\n", '');
    writeDoc(file, source);
    git('add', 'docs');
    git('commit', '-qm', 'historical article');
    writeDoc(file, `${source}\n后来补充一段经历。\n`);
    const result = check(true);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
});

test('publication date validation is retained', () => {
  withRepository(({writeDoc, check}) => {
    writeDoc('docs/测试.md', document('article').replace('2026-01-01', '2026-02-30'));
    const result = check();
    assert.equal(result.status, 1);
    assert.match(result.stdout, /首次发布日期/);
  });
});

test('invalid content types still block the gate', () => {
  withRepository(({writeDoc, check}) => {
    writeDoc('docs/测试.md', document('invalid-type'));
    const result = check(true);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /content_type 非法/);
  });
});

test('invalid front matter still blocks the gate', () => {
  withRepository(({writeDoc, check}) => {
    writeDoc('docs/测试.md', document('article', 'slug: /duplicate\n'));
    const result = check(true);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /front matter 语法/);
  });
});

test('missing Markdown includes still block the gate', () => {
  withRepository(({git, writeDoc, check}) => {
    writeDoc('docs/测试.md', document('article', '', '<!-- @include missing.md -->'));
    git('add', 'docs');
    const result = check(true);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Markdown include 缺失/);
  });
});
