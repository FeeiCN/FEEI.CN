const fs = require('node:fs');
const path = require('node:path');

const PHASES = new Set(['preparing', 'running', 'verifying', 'delivering', 'finished']);
const STATES = new Set(['running', 'success', 'failure', 'cancelled', 'skipped', 'completed', 'no_update', 'blocked']);
const LABELS = new Set(['planning', 'executing', 'plan-ready', 'done', 'failed', 'paused', 'discussing', 'cancelled', 'skipped']);
const FINAL_LABELS = new Set(['plan-ready', 'done', 'failed', 'paused', 'discussing', 'cancelled']);
const NAMES = {preparing: '准备环境', running: '执行任务', verifying: '验证结果', delivering: '交付结果', finished: '任务结束'};

function readJson(filename, limit = 1_000_000) {
  if (!filename || !fs.existsSync(filename) || fs.statSync(filename).size > limit) return null;
  try { return JSON.parse(fs.readFileSync(filename, 'utf8')); } catch { return null; }
}

function options(env = process.env, argv = process.argv.slice(2)) {
  const result = {};
  for (const key of ['phase', 'state', 'issue-number', 'label', 'result-file', 'details-file', 'task', 'token']) {
    result[key] = env['INPUT_' + key.toUpperCase()] || '';
  }
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index].replace(/^--/, '');
    if (!(key in result) || argv[index + 1] === undefined) throw new Error('invalid status option');
    result[key] = argv[index + 1];
  }
  result.phase ||= 'preparing';
  result.state ||= 'running';
  result.token ||= env.GH_TOKEN || '';
  return result;
}

function recordPath(env, task = env.WORKFLOW_STATUS_TASK || env.GITHUB_JOB) {
  return path.join(env.RUNNER_TEMP, 'workflow-status', `${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`,
    `${env.GITHUB_JOB}-${task}.json`);
}

async function issueLabel(repo, number, label, token, env, fetcher = fetch) {
  if (!/^\d+$/.test(number) || !LABELS.has(label) || !token) return false;
  const event = readJson(env.GITHUB_EVENT_PATH) || {};
  const actor = event.sender?.login || env.GITHUB_ACTOR;
  if (env.GITHUB_REF !== 'refs/heads/main' || actor?.toLowerCase() !== repo.split('/')[0].toLowerCase()) return false;
  const base = env.GITHUB_API_URL || 'https://api.github.com';
  const headers = {Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'};
  const url = base + '/repos/' + repo + '/issues/' + number;
  const response = await fetcher(url, {headers, signal: AbortSignal.timeout(10_000)});
  if (!response.ok) throw new Error('label read failed');
  const issue = await response.json();
  if (issue.pull_request) return false;
  const current = issue.labels.map(item => typeof item === 'string' ? item : item.name);
  const managed = current.filter(name => LABELS.has(name.replace(/^codex:/, '')) && name.startsWith('codex:'));
  const target = 'codex:' + label;
  if (managed.length === 1 && managed[0] === target) return true;
  const definition = await fetcher(base + '/repos/' + repo + '/labels/' + encodeURIComponent(target),
    {headers, signal: AbortSignal.timeout(10_000)});
  if (definition.status === 404) {
    const created = await fetcher(base + '/repos/' + repo + '/labels', {
      method: 'POST', headers: {...headers, 'Content-Type': 'application/json'},
      body: JSON.stringify({name: target, color: label === 'failed' ? 'd93f0b' : 'bfdadc', description: 'Workflow task state'}),
      signal: AbortSignal.timeout(10_000),
    });
    if (!created.ok && created.status !== 422) throw new Error('label definition failed');
  } else if (!definition.ok) throw new Error('label definition failed');
  const labels = current.filter(name => !managed.includes(name)).concat(target);
  const updated = await fetcher(url, {method: 'PATCH', headers: {...headers, 'Content-Type': 'application/json'},
    body: JSON.stringify({labels}), signal: AbortSignal.timeout(10_000)});
  if (!updated.ok) throw new Error('label update failed');
  return true;
}

function sourceStates(filename) {
  const value = readJson(filename);
  return (Array.isArray(value?.vendors) ? value.vendors : []).flatMap(item =>
    /^[a-z][a-z0-9_-]{0,63}$/.test(item.vendor) && ['success', 'skipped', 'failed'].includes(item.status)
      ? [{source: item.vendor, state: item.status}] : []);
}

async function update(input, env = process.env, fetcher = fetch, now = new Date()) {
  if (!PHASES.has(input.phase) || !STATES.has(input.state) || (input.label && !LABELS.has(input.label))) {
    throw new Error('invalid status');
  }
  if (!env.RUNNER_TEMP || !/^[^/]+\/[^/]+$/.test(env.GITHUB_REPOSITORY || '')) return null;
  const task = input.task || env.WORKFLOW_STATUS_TASK || env.GITHUB_JOB;
  if (!/^[a-z0-9_-]{1,80}$/i.test(task || '')) throw new Error('invalid task');
  const filename = recordPath(env, task);
  let record = readJson(filename) || {
    version: 1, repository: env.GITHUB_REPOSITORY, workflow: env.GITHUB_WORKFLOW,
    job: env.GITHUB_JOB, task, run_id: env.GITHUB_RUN_ID, run_attempt: env.GITHUB_RUN_ATTEMPT,
    commit: env.GITHUB_SHA, run_url: `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
    started_at: now.toISOString(), events: [],
  };
  let state = input.state;
  if (input.phase === 'finished' && state === 'success' && input['result-file']) {
    const result = readJson(path.resolve(env.GITHUB_WORKSPACE, input['result-file']));
    if (['no_update', 'blocked', 'skipped'].includes(result?.status)) state = result.status;
  }
  if (input.phase === 'finished' && state === 'success' && record.final_label === 'failed') state = 'blocked';
  record.phase = input.phase;
  record.state = state;
  record.updated_at = now.toISOString();
  record.events.push({phase: input.phase, state, at: record.updated_at});
  record.events = record.events.slice(-100);
  if (input['issue-number']) {
    if (!/^[1-9]\d*$/.test(input['issue-number'])) throw new Error('invalid Issue');
    record.issue = input['issue-number'];
  }
  if (input.label && FINAL_LABELS.has(input.label)) record.final_label = input.label;
  let label = input.label;
  if (input.phase === 'finished') {
    record.finished_at = record.updated_at;
    record.duration_seconds = Math.max(0, Math.round((now - new Date(record.started_at)) / 1000));
    label = ['cancelled', 'skipped'].includes(state) ? state : ['failure', 'blocked'].includes(state) ? 'failed'
      : record.final_label || 'done';
    if (input['details-file']) record.sources = sourceStates(path.resolve(env.GITHUB_WORKSPACE, input['details-file']));
  }
  if (record.issue && label) {
    try {
      record.label_updated = await issueLabel(record.repository, record.issue, label, input.token, env, fetcher);
      record.label = label;
    } catch {
      record.label_updated = false;
      process.stdout.write('::warning::任务状态标签未更新；任务本身继续执行，详见运行记录。\n');
    }
  }
  fs.mkdirSync(path.dirname(filename), {recursive: true});
  fs.writeFileSync(filename, JSON.stringify(record, null, 2) + '\n');
  if (env.GITHUB_STEP_SUMMARY) {
    const escaped = text => String(text || '').replace(/[\r\n|<>`]/g, ' ');
    const lines = [`- ${NAMES[input.phase]}：**${escaped(state)}** · [运行记录](${record.run_url})`];
    if (input.phase === 'finished' && record.sources?.length) {
      lines.push('', '| 来源 | 状态 |', '|---|---|', ...record.sources.map(item => `| ${item.source} | ${item.state} |`));
    }
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  }
  process.stdout.write(`任务状态：${NAMES[input.phase]} / ${state}\n`);
  return record;
}

async function main() {
  try {
    const input = options();
    if (process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_ENV) {
      const target = path.join(process.env.RUNNER_TEMP, 'feei-workflow-status.cjs');
      if (path.resolve(target) !== __filename) fs.copyFileSync(__filename, target);
      const task = input.task || process.env.WORKFLOW_STATUS_TASK || process.env.GITHUB_JOB;
      if (!/^[a-z0-9_-]{1,80}$/i.test(task || '')) throw new Error('invalid task');
      fs.appendFileSync(process.env.GITHUB_ENV, `WORKFLOW_STATUS_NODE=${process.execPath}\nWORKFLOW_STATUS_SCRIPT=${target}\nWORKFLOW_STATUS_TASK=${task}\n`);
    }
    await update(input);
  } catch {
    process.stdout.write('::warning::任务状态记录不可用；未改变任务执行结果。\n');
  }
}

module.exports = {update, issueLabel, options, recordPath, sourceStates};
if (require.main === module) main();
