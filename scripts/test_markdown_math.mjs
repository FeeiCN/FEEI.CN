import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import remarkMath from 'remark-math';
import katex from 'katex';
import createJiti from 'jiti';

const siteDir = path.resolve(import.meta.dirname, '..');
const jiti = createJiti(import.meta.url);
const {expandMarkdownIncludes} = jiti(path.join(siteDir, 'plugins/markdownIncludes.ts'));

test('Markdown formulas render without KaTeX parse or strict-mode errors', (context) => {
  const files = execFileSync('git', ['ls-files', '-z', 'docs/**/*.md', 'docs/**/*.mdx'], {cwd: siteDir, encoding: 'utf8'})
    .split('\0').filter(Boolean);
  const processor = unified().use(remarkParse).use(remarkMath);
  const errors = [];
  let formulas = 0;

  for (const file of files) {
    const filePath = path.join(siteDir, file);
    const content = expandMarkdownIncludes(fs.readFileSync(filePath, 'utf8'), filePath);
    const tree = processor.parse(content);
    const visit = (node) => {
      if (node.type === 'inlineMath' || node.type === 'math') {
        formulas += 1;
        try {
          katex.renderToString(node.value, {
            displayMode: node.type === 'math',
            strict: 'error',
            throwOnError: true,
          });
        } catch (error) {
          errors.push(`${file}:${node.position.start.line}: ${error.message}`);
        }
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  }

  assert.ok(formulas > 0, 'Expected to validate existing formulas');
  assert.equal(errors.length, 0, errors.join('\n'));
  context.diagnostic(`${files.length} documents, ${formulas} formulas checked`);
});
