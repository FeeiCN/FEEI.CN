import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import createJiti from 'jiti';

const jiti = createJiti(import.meta.url);
const siteDir = path.resolve(import.meta.dirname, '..');
const {getDocIcon, hideRepeatedSidebarIcons} = jiti(path.join(siteDir, 'src/utils/docIcons.ts'));
const {attachDocFrontMatterToSidebar} = jiti(path.join(siteDir, 'config/docusaurusSidebar.ts'));

test('configured document icons take precedence over historical defaults', () => {
  assert.equal(getDocIcon({slug: '/2026-10-23', icon: ' book-icon '}), 'book-icon');
  assert.equal(getDocIcon({slug: '/ssrf', icon: 'globe-icon'}), 'globe-icon');
  assert.equal(getDocIcon({slug: '/unknown'}), undefined);
});

test('historical records resolve missing icons and legacy emoji consistently', () => {
  for (const slug of ['/2026-01-01', '/2026-10-23/', '/annual-review/2026', '/annual-review/2026/09']) {
    assert.equal(getDocIcon({slug}), 'history-circle-icon');
  }
  assert.equal(getDocIcon({slug: '/2026-10-09', icon: '🚗'}), 'history-circle-icon');
});

test('categories without links inherit the matching index document icon', () => {
  const items = [{type: 'category', label: '软件工程', items: [{type: 'doc', id: 'software'}]}];
  const docs = [{id: 'software', title: '软件工程', frontMatter: {icon: 'terminal-icon'}}];
  const [category] = attachDocFrontMatterToSidebar(items, docs);
  assert.equal(category.customProps.icon, 'terminal-icon');
  assert.equal(category.items[0].customProps.icon, 'terminal-icon');
  assert.equal(category.items[0].id, 'software');
  assert.equal(items[0].customProps, undefined);
});

test('explicit category icons override linked index icons', () => {
  const items = [{
    type: 'category', label: '工具', customProps: {icon: 'gear-icon'},
    link: {type: 'doc', id: 'tools'}, items: [],
  }];
  const docs = [{id: 'tools', title: '工具', frontMatter: {icon: 'terminal-icon'}}];
  items[0].items.push({type: 'doc', id: 'another'});
  const [category] = attachDocFrontMatterToSidebar(items, docs);
  assert.equal(category.customProps.icon, 'gear-icon');
  assert.equal(category.items.find(item => item.id === 'tools').customProps.icon, 'terminal-icon');
});

test('nested categories and documents retain their own icons at every depth', () => {
  const items = [{type: 'category', label: '安全', items: [{
    type: 'category', label: '威胁', items: [{
      type: 'category', label: '利用', link: {type: 'doc', id: 'exploits'},
      items: [{type: 'doc', id: 'ssrf'}],
    }],
  }]}];
  const docs = [
    {id: 'exploits', title: '利用', frontMatter: {icon: 'bug-icon'}},
    {id: 'ssrf', title: 'SSRF', frontMatter: {icon: 'globe-icon'}},
  ];
  const [root] = attachDocFrontMatterToSidebar(items, docs);
  assert.equal(root.customProps.icon, 'layers-icon');
  const category = root.items[0].items[0];
  assert.equal(category.customProps.icon, 'bug-icon');
  assert.equal(category.items.find(item => item.id === 'ssrf').customProps.icon, 'globe-icon');
});

test('year and month groups use historical icons without changing their order', () => {
  const [year] = attachDocFrontMatterToSidebar([{type: 'category', label: '2026', items: [
    {type: 'category', label: '十月', items: [{type: 'doc', id: 'october'}]},
    {type: 'category', label: '九月', items: [{type: 'doc', id: 'september'}]},
  ]}], []);
  assert.equal(year.customProps.icon, 'history-circle-icon');
  assert.deepEqual(year.items.map(item => item.label), ['九月', '十月']);
  assert.ok(year.items.every(item => item.customProps.icon === 'history-circle-icon'));
});

test('known category defaults preserve explicit index document choices', () => {
  const [category] = attachDocFrontMatterToSidebar([{
    type: 'category', label: '通用人工智能', items: [{type: 'doc', id: 'ai'}],
  }], []);
  assert.equal(category.customProps.icon, 'bulb-svg');
  const [withIndex] = attachDocFrontMatterToSidebar([{
    type: 'category', label: '通用人工智能', items: [{type: 'doc', id: 'ai'}],
  }], [{id: 'ai', title: '通用人工智能', frontMatter: {icon: 'book-icon'}}]);
  assert.equal(withIndex.customProps.icon, 'book-icon');
});

test('repeated article icons are hidden while categories and icon metadata remain intact', () => {
  const items = [
    {type: 'category', label: '章节', customProps: {icon: 'book-icon'}},
    {type: 'link', label: '第一章', customProps: {icon: 'book-icon'}},
    {type: 'link', label: '第二章', customProps: {icon: 'book-icon'}},
  ];
  const result = hideRepeatedSidebarIcons(items);
  assert.equal(result[0].customProps.hideSidebarIcon, undefined);
  assert.ok(result.slice(1).every(item => item.customProps.hideSidebarIcon === true));
  assert.ok(result.every(item => item.customProps.icon === 'book-icon'));
  assert.ok(items.every(item => item.customProps.hideSidebarIcon === undefined));
});

test('varied attack icons remain visible even when some articles share an icon', () => {
  const items = ['lock-icon', 'globe-icon', 'lock-icon'].map(icon => ({type: 'link', customProps: {icon}}));
  assert.equal(hideRepeatedSidebarIcons(items), items);
});

test('single articles and incomplete groups keep their configured icons', () => {
  const single = [{type: 'link', customProps: {icon: 'book-icon'}}];
  const incomplete = [...single, {type: 'link'}];
  assert.equal(hideRepeatedSidebarIcons(single), single);
  assert.equal(hideRepeatedSidebarIcons(incomplete), incomplete);
});

test('legacy diary groups suppress repetition without changing heading icons', () => {
  const icon = getDocIcon({slug: '/2026-01-01'});
  const items = [{type: 'link', customProps: {icon}}, {type: 'link', customProps: {icon}}];
  assert.ok(hideRepeatedSidebarIcons(items).every(item => item.customProps.hideSidebarIcon === true));
  assert.equal(getDocIcon({slug: '/2026-01-01'}), 'history-circle-icon');
});
