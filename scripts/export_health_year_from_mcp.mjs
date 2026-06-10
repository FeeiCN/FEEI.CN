import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultTargetRoot = path.join(repoRoot, 'static', 'health');
const defaultMcpServerPath = '/Users/feei/Projects/health-auto-export-mcp-server/dist/server.js';
const timeZone = 'Asia/Shanghai';
const timeZoneOffset = '+0800';

const collectionMappings = [
  {
    tool: 'get_health_metrics',
    args: {
      metrics: '',
      interval: 'days',
      aggregate: true,
    },
    targetSection: 'healthMetrics',
    targetKey: 'metrics',
    sourceKeys: ['metrics'],
  },
  {
    tool: 'get_workouts',
    args: {
      includeMetadata: true,
      includeRoutes: false,
      metadataAggregation: 'minutes',
    },
    targetSection: 'workouts',
    targetKey: 'workouts',
    sourceKeys: ['workouts'],
  },
  {
    tool: 'get_medications',
    args: {},
    targetSection: 'medications',
    targetKey: 'medications',
    sourceKeys: ['medications'],
  },
  {
    tool: 'get_heart_notifications',
    args: {},
    targetSection: 'heartNotifications',
    targetKey: 'heartRateNotifications',
    sourceKeys: ['heartRateNotifications', 'heartNotifications'],
  },
  {
    tool: 'get_state_of_mind',
    args: {},
    targetSection: 'stateOfMind',
    targetKey: 'stateOfMind',
    sourceKeys: ['stateOfMind', 'state_of_mind'],
  },
  {
    tool: 'get_cycle_tracking',
    args: {},
    targetSection: 'cycleTracking',
    targetKey: 'cycleTracking',
    sourceKeys: ['cycleTracking', 'cycle_tracking'],
  },
  {
    tool: 'get_ecg',
    args: {},
    targetSection: 'ecg',
    targetKey: 'ecg',
    sourceKeys: ['ecg'],
  },
  {
    tool: 'get_symptoms',
    args: {},
    targetSection: 'symptoms',
    targetKey: 'symptoms',
    sourceKeys: ['symptoms'],
  },
];

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const targetYear = args.year ?? getCurrentYear();
  const targetMonth = args.month;
  assertYear(targetYear);

  const targetRoot = path.resolve(expandHome(args.target ?? defaultTargetRoot));

  let startDate, endDate, targetFile;

  if (targetMonth) {
    assertMonth(targetMonth);
    const [y, m] = targetMonth.split('-');
    startDate = `${y}-${m}-01`;
    endDate = args.endDate ?? defaultEndDateMonth(y, m);
    targetFile = path.join(targetRoot, y, `${m}.json`);
  } else if (args.year) {
    // Explicit --year: export full year
    startDate = `${targetYear}-01-01`;
    endDate = args.endDate ?? defaultEndDate(targetYear);
    targetFile = path.join(targetRoot, `health_data_${targetYear}.json`);
  } else {
    // Default: export current month
    const currentMonthStr = getCurrentMonth();
    const [y, m] = currentMonthStr.split('-');
    startDate = `${y}-${m}-01`;
    endDate = args.endDate ?? defaultEndDateMonth(y, m);
    targetFile = path.join(targetRoot, y, `${m}.json`);
  }

  if (!endDate.startsWith(targetYear)) {
    throw new Error(`End date must be in ${targetYear}: ${endDate}`);
  }

  const mcpServerPath = path.resolve(expandHome(args.mcpServer ?? process.env.HEALTH_AUTO_EXPORT_MCP_SERVER ?? defaultMcpServerPath));
  const timeoutMs = Number(args.timeout ?? process.env.HEALTH_AUTO_EXPORT_MCP_TIMEOUT ?? 86400000);

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Invalid timeout: ${args.timeout}`);
  }

  if (!fs.existsSync(mcpServerPath)) {
    throw new Error(`MCP server does not exist: ${mcpServerPath}`);
  }

  fs.mkdirSync(targetRoot, {recursive: true});
  if (targetMonth || !args.year) {
    fs.mkdirSync(path.join(targetRoot, targetYear), {recursive: true});
  }

  const start = `${startDate} 00:00:00 ${timeZoneOffset}`;
  const end = `${endDate} 23:59:59 ${timeZoneOffset}`;
  const client = new McpClient('node', [mcpServerPath], {timeoutMs});

  try {
    await client.start();
    await client.initialize();

    const data = {};
    const summary = {};

    for (const mapping of collectionMappings) {
      const toolArgs = {
        start,
        end,
        ...mapping.args,
      };

      process.stderr.write(`Exporting ${mapping.targetSection}...\n`);
      const payload = await client.callTool(mapping.tool, toolArgs);
      const sourceData = extractData(payload);
      const records = findCollection(sourceData, mapping.sourceKeys);

      if (mapping.targetSection === 'healthMetrics') {
        data[mapping.targetSection] = {
          [mapping.targetKey]: Array.isArray(records) ? records : [],
        };
        summary[mapping.targetSection] = sumMetricRecords(data[mapping.targetSection][mapping.targetKey]);
        continue;
      }

      if (Array.isArray(records) && records.length > 0) {
        data[mapping.targetSection] = {
          [mapping.targetKey]: records,
        };
      } else {
        data[mapping.targetSection] = {};
      }

      summary[mapping.targetSection] = Array.isArray(records) ? records.length : 0;
    }

    const annualData = {
      exportedAt: `${endDate}T23:59:59+08:00`,
      dateRange: {
        start,
        end,
      },
      data,
    };

    fs.writeFileSync(targetFile, `${JSON.stringify(annualData, null, 2)}\n`);

    console.log(`Exported ${targetYear} health data to ${path.relative(repoRoot, targetFile)}`);
    for (const [section, count] of Object.entries(summary)) {
      console.log(`${section}: ${count}`);
    }
  } finally {
    await client.close();
  }
}

class McpClient {
  constructor(command, commandArgs, options = {}) {
    this.command = command;
    this.commandArgs = commandArgs;
    this.timeoutMs = options.timeoutMs ?? 86400000;
    this.nextId = 1;
    this.pending = new Map();
    this.stdoutBuffer = '';
    this.process = null;
  }

  async start() {
    this.process = spawn(this.command, this.commandArgs, {
      cwd: repoRoot,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout.setEncoding('utf8');
    this.process.stderr.setEncoding('utf8');

    this.process.stdout.on('data', (chunk) => {
      this.stdoutBuffer += chunk;
      this.readStdoutLines();
    });

    this.process.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
    });

    this.process.on('error', (error) => {
      for (const pending of this.pending.values()) {
        pending.reject(error);
      }
      this.pending.clear();
    });

    this.process.on('exit', (code, signal) => {
      const detail = signal ? `signal ${signal}` : `code ${code}`;
      for (const pending of this.pending.values()) {
        pending.reject(new Error(`MCP server exited before responding: ${detail}`));
      }
      this.pending.clear();
    });
  }

  async initialize() {
    await this.request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: {
        name: 'FEEI.CN health export script',
        version: '1.0.0',
      },
    });

    this.notify('notifications/initialized', {});
  }

  async callTool(name, toolArgs) {
    const result = await this.request('tools/call', {
      name,
      arguments: toolArgs,
    });

    if (result.isError) {
      throw new Error(extractText(result) || `MCP tool failed: ${name}`);
    }

    return unwrapToolResult(result);
  }

  request(method, params) {
    const id = this.nextId;
    this.nextId += 1;

    const message = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      this.process.stdin.write(`${JSON.stringify(message)}\n`);
    });
  }

  notify(method, params) {
    this.process.stdin.write(`${JSON.stringify({jsonrpc: '2.0', method, params})}\n`);
  }

  readStdoutLines() {
    while (true) {
      const index = this.stdoutBuffer.indexOf('\n');

      if (index === -1) {
        return;
      }

      const line = this.stdoutBuffer.slice(0, index).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(index + 1);

      if (!line) {
        continue;
      }

      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        process.stderr.write(`Ignoring non-JSON MCP output: ${line}\n`);
        continue;
      }

      if (message.id === undefined || !this.pending.has(message.id)) {
        continue;
      }

      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);

      if (message.error) {
        pending.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
      } else {
        pending.resolve(message.result);
      }
    }
  }

  async close() {
    if (!this.process) {
      return;
    }

    if (!this.process.killed) {
      this.process.kill('SIGTERM');
    }
  }
}

function unwrapToolResult(result) {
  const text = extractText(result);

  if (!text) {
    return result;
  }

  const parsed = parseJsonText(text);

  if (!parsed) {
    throw new Error(text);
  }

  return parsed;
}

function extractData(value) {
  if (value?.error) {
    throw new Error(value.error.message ?? JSON.stringify(value.error));
  }

  if (Array.isArray(value?.content)) {
    return extractData(unwrapToolResult(value));
  }

  if (typeof value?.result?.content?.[0]?.text === 'string') {
    return extractData(parseJsonText(value.result.content[0].text));
  }

  if (value?.result?.data && typeof value.result.data === 'object') {
    return value.result.data;
  }

  if (value?.data && typeof value.data === 'object') {
    return value.data;
  }

  if (value?.result && typeof value.result === 'object') {
    return value.result;
  }

  if (value && typeof value === 'object') {
    return value;
  }

  return {};
}

function extractText(result) {
  return result?.content?.find((item) => item.type === 'text')?.text;
}

function parseJsonText(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function findCollection(sourceData, sourceKeys) {
  for (const key of sourceKeys) {
    if (Array.isArray(sourceData?.[key])) {
      return sourceData[key];
    }
  }

  return [];
}

function sumMetricRecords(metrics) {
  if (!Array.isArray(metrics)) {
    return 0;
  }

  return metrics.reduce((sum, metric) => sum + (Array.isArray(metric?.data) ? metric.data.length : 0), 0);
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }

    if (arg === '--year' || arg === '--month' || arg === '--end-date' || arg === '--target' || arg === '--mcp-server' || arg === '--timeout') {
      const value = argv[index + 1];

      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${arg}`);
      }

      parsed[toCamelCase(arg.slice(2))] = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function printHelp() {
  console.log(`Usage: npm run export-health-year -- [options]

Options:
  --year <year>              Export full year (defaults to current month if omitted).
  --month <YYYY-MM>          Export specific month.
  --end-date <YYYY-MM-DD>    End date. Defaults to today for current year/month.
  --target <dir>             Output directory. Defaults to static/health.
  --mcp-server <file>        health_auto_export MCP server path.
  --timeout <ms>             Per-tool timeout. Defaults to 86400000.
  -h, --help                 Show this help.`);
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function assertYear(value) {
  if (!/^\d{4}$/.test(value)) {
    throw new Error(`Invalid year: ${value}`);
  }
}

function assertDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid date: ${value}`);
  }
}

function assertMonth(value) {
  if (!/^\d{4}-\d{2}$/.test(value)) {
    throw new Error(`Invalid month: ${value}`);
  }
}

function getCurrentYear() {
  return formatLocalDate(new Date()).slice(0, 4);
}

function getCurrentMonth() {
  return formatLocalDate(new Date()).slice(0, 7);
}

function defaultEndDate(year) {
  const today = formatLocalDate(new Date());
  return today.startsWith(`${year}-`) ? today : `${year}-12-31`;
}

function defaultEndDateMonth(year, month) {
  const today = formatLocalDate(new Date());
  const monthPrefix = `${year}-${month}`;
  if (today.startsWith(monthPrefix)) {
    return today;
  }
  // Last day of month
  const lastDay = new Date(Number(year), Number(month), 0);
  return formatLocalDate(lastDay);
}

function formatLocalDate(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function expandHome(value) {
  if (value === '~') {
    return process.env.HOME;
  }

  if (value.startsWith('~/')) {
    return path.join(process.env.HOME, value.slice(2));
  }

  return value;
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
