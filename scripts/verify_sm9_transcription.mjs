import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const path = process.argv[2] || 'docs/01-网络安全/01-网络空间安全/03-安全体系/01-安全合法合规/05-密码与身份认证/02-密码算法与协议/原文/_GB-T-41389-2022-原文转写.md';
const markdown = readFileSync(path, 'utf8');
const sections = Object.fromEntries(
  [...markdown.matchAll(/^### (A\.\d) [^\n]+\n([\s\S]*?)(?=^### A\.\d |$(?![\s\S]))/gm)]
    .map((match) => [match[1], match[2]]),
);

function blocks(section) {
  assert.ok(sections[section], `missing ${section}`);
  return [...sections[section].matchAll(/```text\n([\s\S]*?)\n```/g)].map((match) => match[1]);
}

function raw(block) {
  const value = block.replace(/\s/g, '').toUpperCase();
  assert.match(value, /^(?:[0-9A-F]{2})+$/);
  return value;
}

function der(block) {
  return block.split('\n').filter((line) => line.includes(':') && !line.includes('}'))
    .map((line) => {
      const [before, after] = line.split(':', 2);
      return /^\s*(?:30|02|03|04)\s+[0-9A-F]{2}/.test(before) ? raw(before) : raw(after);
    }).join('');
}

const a2 = blocks('A.2');
const a3 = blocks('A.3');
const a4 = blocks('A.4');
const a5 = blocks('A.5');
const a6 = blocks('A.6');
assert.deepEqual([a2.length, a3.length, a4.length, a5.length, a6.length], [6, 16, 8, 9, 9]);
const x2 = a2.slice(0, 4).map(raw);
const x3 = a3.slice(0, 10).map(raw);
const x4 = a4.slice(0, 7).map(raw);
const x5 = a5.slice(0, 8).map(raw);
const x6 = a6.slice(0, 7).map(raw);

assert.equal(der(a2[4]), '03420004' + x2[0] + x2[1]);
assert.equal(der(a2[5]), '0381820004' + x2[2] + x2[3]);
assert.equal(der(a3[10]), '021F' + x3[0]);
assert.equal(der(a3[11]), '0381820004' + x3[1] + x3[2]);
assert.equal(der(a3[12]), '021F' + x3[3]);
assert.equal(der(a3[13]), '03420004' + x3[4] + x3[5]);
assert.equal(der(a3[14]), '03420004' + x3[6] + x3[7]);
assert.equal(der(a3[15]), '0381820004' + x3[8] + x3[9]);
assert.deepEqual(x4.slice(0, 5), [x3[0], x3[1], x3[2], x3[6], x3[7]]);
assert.equal(Buffer.from(x4[5], 'hex').length, 32);
assert.equal(Buffer.from(x4[6], 'hex').length, 65);
assert.equal(der(a4[7]), '30660420' + x4[5] + '034200' + x4[6]);
assert.equal(Buffer.from(x5[6], 'hex').length, 20);
assert.equal(Buffer.from(x5[7], 'hex').length, 32);
assert.equal(der(a5[8]), '307F02010003420004' + x5[5] + '0420' + x5[7] + '0414' + x5[6]);
assert.deepEqual(x6.slice(0, 5), x5.slice(0, 5));
assert.equal(Buffer.from(x6[5], 'hex').length, 64);
assert.equal(Buffer.from(x6[6], 'hex').length, 32);
assert.equal(der(a6[7]), '03420004' + x6[5]);
assert.equal(der(a6[8]), '30660420' + x6[6] + '03420004' + x6[5]);

assert.ok(!/^\d{1,2}$/m.test(markdown), 'isolated page number remains');
assert.equal((markdown.match(/^```/gm) || []).length % 2, 0, 'unbalanced fenced code blocks');
console.log('SM9: A.2-A.6 coordinates, repeated vectors and DER encodings verified');
