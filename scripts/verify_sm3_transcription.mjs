import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const path = new URL('../docs/01-网络安全/01-网络空间安全/03-安全体系/01-安全合法合规/05-密码与身份认证/02-密码算法与协议/原文/_GB-T-32905-2016-原文转写.md', import.meta.url);
const marker = '## 附录 A（资料性附录）运算示例';
const iv = [0x7380166f, 0x4914b2b9, 0x172442d7, 0xda8a0600, 0xa96f30bc, 0x163138aa, 0xe38dee4d, 0xb0fb0e4e];

const rot = (x, n) => ((x << (n & 31)) | (x >>> ((32 - n) & 31))) >>> 0;
const p0 = (x) => (x ^ rot(x, 9) ^ rot(x, 17)) >>> 0;
const p1 = (x) => (x ^ rot(x, 15) ^ rot(x, 23)) >>> 0;
const hex = (x) => x.toString(16).padStart(8, '0');
const words = (xs) => xs.map(hex).join(' ');

function pad(message) {
  const result = Buffer.alloc(Math.ceil((message.length + 9) / 64) * 64);
  message.copy(result);
  result[message.length] = 0x80;
  result.writeBigUInt64BE(BigInt(message.length) * 8n, result.length - 8);
  return result;
}

function traceBlock(block, input) {
  const w = Array.from({ length: 16 }, (_, i) => block.readUInt32BE(i * 4));
  for (let j = 16; j <= 67; j++) {
    w.push((p1(w[j - 16] ^ w[j - 9] ^ rot(w[j - 3], 15)) ^ rot(w[j - 13], 7) ^ w[j - 6]) >>> 0);
  }
  const wp = Array.from({ length: 64 }, (_, j) => (w[j] ^ w[j + 4]) >>> 0);
  let [a, b, c, d, e, f, g, h] = input;
  const states = [[a, b, c, d, e, f, g, h]];
  for (let j = 0; j < 64; j++) {
    const tj = j < 16 ? 0x79cc4519 : 0x7a879d8a;
    const ss1 = rot((rot(a, 12) + e + rot(tj, j)) >>> 0, 7);
    const ss2 = (ss1 ^ rot(a, 12)) >>> 0;
    const ff = j < 16 ? (a ^ b ^ c) : ((a & b) | (a & c) | (b & c));
    const gg = j < 16 ? (e ^ f ^ g) : ((e & f) | (~e & g));
    const tt1 = (ff + d + ss2 + wp[j]) >>> 0;
    const tt2 = (gg + h + ss1 + w[j]) >>> 0;
    [a, b, c, d, e, f, g, h] = [tt1, a, rot(b, 9), c, p0(tt2), e, rot(f, 19), g];
    states.push([a, b, c, d, e, f, g, h]);
  }
  return { w, wp, states, output: [a, b, c, d, e, f, g, h].map((x, i) => (x ^ input[i]) >>> 0) };
}

function grid(xs) {
  return ['```text', ...Array.from({ length: Math.ceil(xs.length / 8) }, (_, i) => words(xs.slice(i * 8, i * 8 + 8))), '```'].join('\n');
}

function stateTable(states) {
  return [
    '```text',
    'j   A        B        C        D        E        F        G        H',
    `    ${words(states[0])}`,
    ...states.slice(1).map((state, j) => `${String(j).padEnd(3)} ${words(state)}`),
    '```',
  ].join('\n');
}

const example1 = Buffer.from('616263', 'hex');
const example2 = Buffer.from('61626364'.repeat(16), 'hex');
const padded1 = pad(example1);
const padded2 = pad(example2);
const one = traceBlock(padded1.subarray(0, 64), iv);
const first = traceBlock(padded2.subarray(0, 64), iv);
const second = traceBlock(padded2.subarray(64, 128), first.output);
const digest1 = '66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0';
const digest2 = 'debe9ff92275b8a138604889c18e5a4d6fdb70e5387e5765293dcba39c0c5732';
assert.equal(one.output.map(hex).join(''), digest1);
assert.equal(second.output.map(hex).join(''), digest2);
assert.equal(createHash('sm3').update(example1).digest('hex'), digest1);
assert.equal(createHash('sm3').update(example2).digest('hex'), digest2);
assert.equal(words(first.output), '5950de81 468664eb 42fd4c86 1e7ca00a c0a5910b ae9a55ea 1adb8d17 763ca222');
for (const [actual, expected] of [
  [one.w[16], '9092e200'],
  [one.states[3][0], '609f2850'],
  [one.states[46][0], 'd2090a86'],
  [one.states[64][0], '1547e69b'],
  [first.w[16], 'a121a024'],
  [first.states[26][0], 'eaf54f3e'],
  [first.states[64][0], '2ad0c8ee'],
  [second.w[16], '80404000'],
  [second.states[21][0], 'f477625b'],
  [second.states[64][0], '87ee4178'],
]) {
  assert.equal(hex(actual), expected, 'value checked against the corresponding page image');
}

const appendix = [
  marker,
  '',
  '### A.1 示例 1',
  '',
  '#### A.1.1 输入十六进制数据',
  '',
  '`616263`',
  '',
  '#### A.1.2 填充后的消息',
  '',
  grid(one.w.slice(0, 16)),
  '',
  '#### A.1.3 扩展后的消息',
  '',
  '$W_0,W_1,\ldots,W_{67}$：',
  '',
  grid(one.w),
  '',
  "$W'_0,W'_1,\ldots,W'_{63}$：",
  '',
  grid(one.wp),
  '',
  '#### A.1.4 迭代压缩中间值',
  '',
  stateTable(one.states),
  '',
  '#### A.1.5 杂凑值',
  '',
  '`' + words(one.output) + '`',
  '',
  '### A.2 示例 2',
  '',
  '#### A.2.1 512 比特消息',
  '',
  grid(first.w.slice(0, 16)),
  '',
  '#### A.2.2 填充后的消息',
  '',
  grid([...first.w.slice(0, 16), ...second.w.slice(0, 16)]),
  '',
  '#### A.2.3 第一个消息分组',
  '',
  '##### A.2.3.1 扩展后的消息',
  '',
  '$W_0,W_1,\ldots,W_{67}$：',
  '',
  grid(first.w),
  '',
  "$W'_0,W'_1,\ldots,W'_{63}$：",
  '',
  grid(first.wp),
  '',
  '##### A.2.3.2 迭代压缩中间值',
  '',
  stateTable(first.states),
  '',
  '#### A.2.4 第二个消息分组',
  '',
  '##### A.2.4.1 扩展后的消息',
  '',
  '$W_0,W_1,\ldots,W_{67}$：',
  '',
  grid(second.w),
  '',
  "$W'_0,W'_1,\ldots,W'_{63}$：",
  '',
  grid(second.wp),
  '',
  '##### A.2.4.2 迭代压缩中间值',
  '',
  stateTable(second.states),
  '',
  '##### A.2.4.3 杂凑值',
  '',
  '`' + words(second.output) + '`',
  '',
].join('\n');

const current = readFileSync(path, 'utf8');
assert.equal(current.split(marker).length, 2, 'appendix marker must occur once');
const complete = current.split(marker)[0] + appendix;
if (process.argv.includes('--write')) {
  writeFileSync(path, complete);
} else {
  assert.equal(current, complete, 'SM3 appendix differs from independently calculated values');
}
console.log('SM3 appendix and two standard test vectors verified');
