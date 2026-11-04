import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import createJiti from 'jiti';
import {parseMermaid, renderMermaidSVG} from 'beautiful-mermaid';

const jiti = createJiti(import.meta.url);
const {getBeautifulDiagram} = jiti(path.resolve(import.meta.dirname, '../src/theme/Mermaid/source.ts'));

test('layout metadata and accessibility text do not become phantom flowchart nodes', () => {
  const diagram = getBeautifulDiagram(`---
config:
  flowchart:
    useMaxWidth: false
    nodeSpacing: 28
---
%% 事件复盘
flowchart TB
accTitle: 入侵过程
accDescr {
攻击者从公网进入应用，再访问数据。
}
A[公网入口] --> B[应用]
B --> C[数据库]`);
  assert.equal(diagram.title, '入侵过程');
  assert.equal(diagram.description, '攻击者从公网进入应用，再访问数据。');
  const graph = parseMermaid(diagram.source);
  assert.deepEqual([...graph.nodes.keys()], ['A', 'B', 'C']);
  assert.equal(graph.edges.length, 2);
});

test('supported diagram families render without per-diagram activation', () => {
  const sources = [
    ['flowchart', 'flowchart TD\nA[入口] --> B[应用]'],
    ['state', 'stateDiagram-v2\n[*] --> Active\nActive --> [*]'],
    ['sequence', '%% 注释\nsequenceDiagram\nparticipant A as 浏览器\nparticipant B as 服务\nA->>B: 请求'],
    ['class', 'classDiagram\nAnimal <|-- Duck'],
    ['er', 'erDiagram\nUSER ||--o{ ORDER : places'],
    ['xychart', 'xychart-beta\nx-axis [A, B]\ny-axis 0 --> 10\nbar [2, 5]'],
  ];
  for (const [kind, source] of sources) {
    const diagram = getBeautifulDiagram(source);
    assert.equal(diagram?.kind, kind);
    assert.match(renderMermaidSVG(diagram.source), /<svg\b/);
  }
});

test('unsupported semantics keep the original renderer instead of silently dropping information', () => {
  const sources = [
    'block-beta\ncolumns 2\nA B',
    'pie title 数据\n"A" : 10',
    'sequenceDiagram\nbox 审批角色\nparticipant A\nend\nA->>A: 审批',
    'sequenceDiagram\nparticipant A\nactivate A\nA->>A: 执行\ndeactivate A',
    'flowchart TD\nA --> B\nclick A "https://example.com"',
    'flowchart TD\nA@{ shape: cloud, label: "系统" }',
    '---\ntitle: 需要展示的标题\n---\nflowchart TD\nA --> B',
    '%%{init: {"theme": "dark"}}%%\nflowchart TD\nA --> B',
  ];
  for (const source of sources) assert.equal(getBeautifulDiagram(source), null, source);
});

test('the original renderer can be selected explicitly while legacy activation is optional', () => {
  assert.equal(getBeautifulDiagram('%% renderer: mermaid\nflowchart TD\nA --> B'), null);
  const plain = getBeautifulDiagram('flowchart TD\nA --> B');
  const legacy = getBeautifulDiagram('%% renderer: beautiful-mermaid\nflowchart TD\nA --> B');
  assert.equal(plain.source, legacy.source);
});

test('quoted group labels keep their text and inline multiple statements use native parsing', () => {
  const diagram = getBeautifulDiagram('flowchart TB\nsubgraph internal["内部系统"]\nA --> B\nend');
  assert.equal(parseMermaid(diagram.source).subgraphs[0].label, '内部系统');
  assert.equal(getBeautifulDiagram('flowchart TB\nA --> B; B --> C'), null);
});
