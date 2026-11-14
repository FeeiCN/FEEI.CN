import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function freePort() {
  const server = net.createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const {port} = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'feei-shared-dev-'));
  const cliPath = path.join(root, 'fake-cli.mjs');
  const runner = path.join(root, 'runner.mjs');
  const starts = path.join(root, 'starts');
  fs.writeFileSync(cliPath, `
    import http from 'node:http';
    import fs from 'node:fs';
    fs.appendFileSync(${JSON.stringify(starts)}, process.pid + '\\n');
    if (process.argv.includes('--fail')) process.exit(13);
    const port = Number(process.argv[process.argv.indexOf('--port') + 1]);
    setTimeout(() => http.createServer((_req, res) => res.end('ok'))
      .listen(port, '127.0.0.1', () => console.log('READY')), 200);
  `);
  fs.writeFileSync(runner, `
    import {startSharedDevServer} from ${JSON.stringify(new URL('./start_shared_dev_server.mjs', import.meta.url).href)};
    try {process.exitCode = await startSharedDevServer(JSON.parse(process.argv[2]));}
    catch (error) {console.error(error.message); process.exitCode = 1;}
  `);
  const children = [];
  const run = (args, siteDir = root) => {
    const child = spawn(process.execPath, [runner, JSON.stringify({siteDir, cliPath, args})], {stdio: ['ignore', 'pipe', 'pipe']});
    const state = {child, output: ''};
    child.stdout.on('data', data => {state.output += data;});
    child.stderr.on('data', data => {state.output += data;});
    state.exit = once(child, 'exit').then(([code]) => code);
    children.push(state);
    return state;
  };
  t.after(async () => {
    for (const state of children) {
      if (state.child.exitCode === null && state.child.signalCode === null) state.child.kill('SIGTERM');
      await state.exit;
    }
    fs.rmSync(root, {recursive: true, force: true});
  });
  return {root, run, count: () => fs.existsSync(starts) ? fs.readFileSync(starts, 'utf8').trim().split('\n').length : 0};
}

async function ready(state) {
  const deadline = Date.now() + 10000;
  while (!state.output.includes('READY')) {
    if (state.child.exitCode !== null || Date.now() > deadline) throw new Error(state.output || 'Server did not become ready');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

test('concurrent sessions share one child, including before its HTTP port is ready', {timeout: 20000}, async t => {
  const f = fixture(t);
  const port = await freePort();
  const args = ['--host', '127.0.0.1', '--port', String(port)];
  const sessions = Array.from({length: 6}, () => f.run(args));
  await Promise.all(sessions.map(async state => {
    while (!state.output.includes('READY') && !state.output.includes('复用共享开发服务')) {
      if (state.child.exitCode !== null) throw new Error(state.output);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    if (!state.output.includes('READY')) assert.equal(await state.exit, 0);
  }));
  assert.equal(f.count(), 1);
  assert.equal(sessions.filter(state => state.output.includes('READY')).length, 1);
});

test('same real workspace reuses the original port and can restart after its owner exits', {timeout: 20000}, async t => {
  const f = fixture(t);
  const port = await freePort();
  const args = ['--host', '127.0.0.1', '--port', String(port)];
  const first = f.run(args);
  await ready(first);
  const alias = path.join(f.root, 'alias');
  fs.symlinkSync(f.root, alias);
  const duplicate = f.run(['--port', String(await freePort())], alias);
  assert.equal(await duplicate.exit, 0);
  assert.ok(duplicate.output.includes(`http://127.0.0.1:${port}/`));
  assert.equal(f.count(), 1);
  first.child.kill('SIGTERM');
  await first.exit;
  const restarted = f.run(args);
  await ready(restarted);
  assert.equal(f.count(), 2);
});

test('failed starts release ownership and unrelated port listeners are never reused', {timeout: 20000}, async t => {
  const f = fixture(t);
  const port = await freePort();
  const args = ['--host', '127.0.0.1', '--port', String(port)];
  assert.equal(await f.run([...args, '--fail']).exit, 13);
  const other = net.createServer().listen(port, '127.0.0.1');
  await once(other, 'listening');
  const blocked = f.run(args);
  assert.equal(await blocked.exit, 1);
  assert.match(blocked.output, /无法使用/);
  assert.equal(f.count(), 1);
  await new Promise(resolve => other.close(resolve));
  const restarted = f.run(args);
  await ready(restarted);
  assert.equal(f.count(), 2);
});
