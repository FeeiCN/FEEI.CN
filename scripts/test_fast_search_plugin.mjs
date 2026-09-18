import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import createJiti from 'jiti';

const siteDir = path.resolve(import.meta.dirname, '..');
const jiti = createJiti(import.meta.url);
const pluginModule = jiti(path.join(siteDir, 'plugins/fastSearchPlugin.ts'));

function validate(schema, options) {
  const result = schema.validate(options);
  assert.ifError(result.error);
  return result.value;
}

test('search wrapper restores upstream defaults and generates usable client limits', () => {
  const options = pluginModule.validateOptions({
    options: {docsRouteBasePath: '/', indexBlog: false, indexPages: false, hashed: true, language: ['zh']},
    validate,
  });
  assert.equal(options.searchResultLimits, 8);
  assert.equal(options.searchResultContextMaxLength, 50);
  assert.equal(options.fuzzyMatchingDistance, 1);
  assert.equal(options.indexDocs, true);
  assert.equal(options.indexBlog, false);
  assert.deepEqual(options.language, ['zh']);

  const generatedFilesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feei-search-test-'));
  try {
    const plugin = pluginModule.default({
      siteDir,
      generatedFilesDir,
      siteConfig: {themeConfig: {navbar: {items: [{type: 'search', position: 'right'}]}}},
    }, options);
    assert.equal(plugin.name, 'fast-local-search');
    assert.equal(plugin.postBuild, undefined);
    const constants = fs.readFileSync(path.join(generatedFilesDir,
      '@easyops-cn/docusaurus-search-local/default/generated-constants.js'), 'utf8');
    assert.match(constants, /export const searchResultLimits = 8;/);
    assert.match(constants, /export const fuzzyMatchingDistance = 1;/);
    const matches = Array.from({length: 12}, (_, index) => index);
    const results = matches.slice(0, options.searchResultLimits)
      .slice(0, options.searchResultLimits - 0);
    assert.equal(results.length, 8);
  } finally {
    fs.rmSync(generatedFilesDir, {recursive: true, force: true});
  }
});

test('search wrapper preserves explicit options and rejects invalid limits', () => {
  assert.equal(pluginModule.validateOptions({options: {searchResultLimits: 12}, validate}).searchResultLimits, 12);
  assert.throws(() => pluginModule.validateOptions({options: {searchResultLimits: 'invalid'}, validate}));
});
