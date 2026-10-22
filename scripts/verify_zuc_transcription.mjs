import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
  throw new Error('Usage: node scripts/verify_zuc_transcription.mjs <markdown-file>');
}

const text = fs.readFileSync(file, 'utf8');

function words(rows) {
  return [...rows.matchAll(/^\| (\d+) \| ((?:[0-9a-f]{8} \| ){7}[0-9a-f]{8}) \|$/gm)]
    .map((match) => [Number(match[1]), ...match[2].split(' | ').map((word) => Number.parseInt(word, 16))]);
}

function same(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: ${actual.toString(16)} != ${expected.toString(16)}`);
  }
}

function sBox(number) {
  const block = text.split(`**表 A.${number}`)[1]?.split('```text')[1]?.split('```')[0]?.trim();
  if (!block) throw new Error(`Missing S-box A.${number}`);
  const values = block.split('\n').flatMap((line, row) => {
    const parts = line.trim().split(/\s+/);
    same(Number.parseInt(parts[0], 16), row, `S-box A.${number} row`);
    same(parts.length, 17, `S-box A.${number} width`);
    return parts.slice(1).map((value) => Number.parseInt(value, 16));
  });
  same(values.length, 256, `S-box A.${number} length`);
  same(new Set(values).size, 256, `S-box A.${number} distinct values`);
  return values;
}

const S0 = sBox(1);
const S1 = sBox(2);
const constants = [...text.matchAll(/\| (\d+) \| `([01]{15})` \| `([0-9A-F]{4})` \|/g)]
  .map((match, index) => {
    same(Number(match[1]), index, 'd index');
    same(Number.parseInt(match[2], 2), Number.parseInt(match[3], 16), `d${index}`);
    return Number.parseInt(match[3], 16);
  });
same(constants.length, 16, 'd count');

const rotate = (value, bits) => ((value << bits) | (value >>> (32 - bits))) >>> 0;
const L1 = (value) => (value ^ rotate(value, 2) ^ rotate(value, 10) ^ rotate(value, 18) ^ rotate(value, 24)) >>> 0;
const L2 = (value) => (value ^ rotate(value, 8) ^ rotate(value, 14) ^ rotate(value, 22) ^ rotate(value, 30)) >>> 0;
const substitute = (value) => (
  (S0[value >>> 24] << 24)
  | (S1[(value >>> 16) & 255] << 16)
  | (S0[(value >>> 8) & 255] << 8)
  | S1[value & 255]
) >>> 0;

for (let vector = 1; vector <= 3; vector += 1) {
  const block = text.split(`### C.${vector}`)[1]?.split(vector === 3 ? '## 参考文献' : `### C.${vector + 1}`)[0] ?? '';
  const inputs = [...block.matchAll(/(?:密钥|初始向量) `(?:k|iv) = ([0-9a-f ]+)`/g)]
    .map((match) => Buffer.from(match[1].replaceAll(' ', ''), 'hex'));
  same(inputs.length, 2, `vector ${vector} inputs`);
  for (const input of inputs) same(input.length, 16, `vector ${vector} input length`);
  const [key, iv] = inputs;
  let state = Array.from({ length: 16 }, (_, index) => (
    (key[index] << 23) | (constants[index] << 8) | iv[index]
  ));
  let r1 = 0;
  let r2 = 0;

  function checkState(expected, label) {
    same(expected.length, 16, `${label} length`);
    expected.forEach((value, index) => same(state[index], value, `${label} s${index}`));
  }

  function reconstruct() {
    const s = state;
    return [
      (((s[15] >>> 15) << 16) | (s[14] & 65535)) >>> 0,
      (((s[11] & 65535) << 16) | (s[9] >>> 15)) >>> 0,
      (((s[7] & 65535) << 16) | (s[5] >>> 15)) >>> 0,
      (((s[2] & 65535) << 16) | (s[0] >>> 15)) >>> 0,
    ];
  }

  function nonlinear(x) {
    const w = (((x[0] ^ r1) >>> 0) + r2) >>> 0;
    const w1 = (r1 + x[1]) >>> 0;
    const w2 = (r2 ^ x[2]) >>> 0;
    r1 = substitute(L1(((w1 << 16) | (w2 >>> 16)) >>> 0));
    r2 = substitute(L2(((w2 << 16) | (w1 >>> 16)) >>> 0));
    return w;
  }

  function shift(input) {
    const s = state;
    const modulus = 2147483647n;
    const sum = (
      32768n * BigInt(s[15]) + 131072n * BigInt(s[13])
      + 2097152n * BigInt(s[10]) + 1048576n * BigInt(s[4])
      + 257n * BigInt(s[0]) + BigInt(input)
    ) % modulus;
    state = s.slice(1).concat(Number(sum || modulus));
  }

  function checkRound(row, x, output, label) {
    same(row.length, 9, `${label} width`);
    x.forEach((value, index) => same(value, row[index + 1], `${label} X${index}`));
    [r1, r2, output >>> 0, state[15]].forEach((value, index) => {
      same(value, row[index + 5], `${label} column ${index + 5}`);
    });
  }

  checkState(words(sectionIn(block, '初始化时线性反馈移位寄存器初态：', '初始化过程中的状态：'))
    .flatMap((row) => row.slice(1)), `vector ${vector} initial`);
  const initialRounds = words(sectionIn(block, '初始化过程中的状态：', '初始化后线性反馈移位寄存器状态：'));
  same(initialRounds.length, 10, `vector ${vector} initial rounds`);
  for (let round = 0; round < 32; round += 1) {
    const x = reconstruct();
    const w = nonlinear(x);
    shift(w >>> 1);
    if (round < 10) {
      same(initialRounds[round][0], round, `vector ${vector} initial round index`);
      checkRound(initialRounds[round], x, w, `vector ${vector} initial round ${round}`);
    }
  }

  checkState(words(sectionIn(block, '初始化后线性反馈移位寄存器状态：', '有限状态机内部状态：'))
    .flatMap((row) => row.slice(1)), `vector ${vector} after initialization`);
  const fsm = [...block.matchAll(/R[₁₂] = ([0-9a-f]{8})/g)].map((match) => Number.parseInt(match[1], 16));
  same(r1, fsm[0], `vector ${vector} R1`);
  same(r2, fsm[1], `vector ${vector} R2`);

  const keystream = words(block.split('密钥流：')[1] ?? '');
  same(keystream.length, 3, `vector ${vector} keystream rounds`);
  for (let round = 0; round < 3; round += 1) {
    const x = reconstruct();
    const z = nonlinear(x) ^ x[3];
    shift(0);
    same(keystream[round][0], round, `vector ${vector} keystream index`);
    checkRound(keystream[round], x, z, `vector ${vector} keystream round ${round}`);
  }
  const outputs = [...block.matchAll(/`z[₁₂] = ([0-9a-f]{8})`/g)].map((match) => Number.parseInt(match[1], 16));
  same(outputs[0], keystream[1][7], `vector ${vector} z1`);
  same(outputs[1], keystream[2][7], `vector ${vector} z2`);
  console.log(`Vector ${vector}: all listed states and outputs match`);
}

function sectionIn(block, start, end) {
  return block.split(start)[1]?.split(end)[0] ?? '';
}
