import {createHash} from 'node:crypto';
import {execFileSync, spawn} from 'node:child_process';
import {realpathSync} from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function address(args) {
  const {values} = parseArgs({args, strict: false, allowPositionals: true, options: {
    host: {type: 'string', short: 'h'}, port: {type: 'string', short: 'p'},
  }});
  const host = values.host ?? 'localhost';
  const port = Number(values.port ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口必须在 1–65535 之间。');
  const browserHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
  return {host, port, url: `http://${browserHost.includes(':') ? `[${browserHost}]` : browserHost}:${port}/`};
}

function existingDocusaurus(workspace) {
  try {
    const pids = execFileSync('pgrep', ['-f', 'docusaurus.* start'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim().split('\n');
    for (const pid of pids) {
      try {
        const command = execFileSync('ps', ['-p', pid, '-o', 'command='], {encoding: 'utf8'});
        if (!/^(?:\S*\/)?node\s+/.test(command.trim())) continue;
        if (!/\/(?:\.bin\/docusaurus|@docusaurus\/core\/bin\/docusaurus\.mjs)\s+start(?:\s|$)/.test(command)) continue;
        const cwd = execFileSync('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']})
          .split('\n').find(line => line.startsWith('n'))?.slice(1);
        if (!cwd || realpathSync(cwd) !== workspace) continue;
        const host = command.match(/(?:--host(?:=|\s+)|-h\s+)(\S+)/)?.[1] ?? 'localhost';
        const port = command.match(/(?:--port(?:=|\s+)|-p\s+)(\d+)/)?.[1] ?? '3000';
        return address(['--host', host, '--port', port]).url;
      } catch { /* The process may have exited during inspection. */ }
    }
  } catch { /* Platforms without pgrep/lsof still use the shared launcher lock. */ }
  return undefined;
}

function listen(server, options) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options, () => {server.removeListener('error', reject); resolve();});
  });
}

export async function startSharedDevServer({siteDir = repoRoot, args = [], cliPath} = {}) {
  cliPath ??= path.join(path.dirname(require.resolve('@docusaurus/core/package.json')), 'bin/docusaurus.mjs');
  if (args.includes('--help')) {
    const child = spawn(process.execPath, [cliPath, 'start', ...args], {cwd: siteDir, stdio: 'inherit'});
    return new Promise((resolve, reject) => {child.once('error', reject); child.once('exit', code => resolve(code ?? 1));});
  }
  const workspace = realpathSync(siteDir);
  const current = existingDocusaurus(workspace);
  if (current) {console.log(`[INFO] 复用已有开发服务：${current}`); return 0;}

  const target = address(args);
  const coordinationPort = 40000 + createHash('sha256').update(workspace).digest().readUInt32BE(0) % 20000;
  const state = {kind: 'feei-dev-server', workspace, url: target.url};
  const lock = http.createServer((_req, res) => {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify(state));
  });
  try {
    await listen(lock, {host: '127.0.0.1', port: coordinationPort, exclusive: true});
  } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    let owner;
    try {
      owner = await (await fetch(`http://127.0.0.1:${coordinationPort}/`, {signal: AbortSignal.timeout(2000)})).json();
    } catch { throw new Error('开发服务协调端口被其他程序占用，未启动新实例。'); }
    if (owner.kind !== state.kind || owner.workspace !== workspace) throw new Error('开发服务协调端口冲突，未启动新实例。');
    console.log(`[INFO] 复用共享开发服务（启动或运行中）：${owner.url}`);
    return 0;
  }

  const signalHandlers = new Map();
  try {
    const probe = net.createServer();
    try {await listen(probe, {host: target.host, port: target.port, exclusive: true});}
    catch (error) {throw new Error(`${target.url} 无法使用；未另开端口或启动新实例。`, {cause: error});}
    await new Promise(resolve => probe.close(resolve));
    const child = spawn(process.execPath, [cliPath, 'start', ...args], {cwd: workspace, stdio: 'inherit'});
    for (const signal of ['SIGINT', 'SIGTERM']) {
      const forward = () => {if (!child.killed) child.kill(signal);};
      signalHandlers.set(signal, forward);
      process.on(signal, forward);
    }
    return await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => resolve(code ?? 1));
    });
  } finally {
    for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
    await new Promise(resolve => lock.close(resolve));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startSharedDevServer({args: process.argv.slice(2)}).then(code => {process.exitCode = code;}).catch(error => {
    console.error(`[ERROR] ${error.message}`);
    process.exitCode = 1;
  });
}
