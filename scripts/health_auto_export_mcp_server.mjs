import net from 'node:net';
import dns from 'node:dns/promises';
import {spawn} from 'node:child_process';
import readline from 'node:readline';

const haeHost = process.env.HAE_HOST || 'localhost';
const haePort = parseIntegerEnv('HAE_PORT', process.env.HAE_PORT || '9000');
const defaultTimeoutMs = parseIntegerEnv('HAE_TIMEOUT', process.env.HAE_TIMEOUT || '86400000');
let resolvedHaeHost = haeHost;

const tools = {
  get_health_metrics: {
    description: 'Get health metrics data for a specified date range from Apple Health',
    inputSchema: {
      type: 'object',
      properties: {
        start: {type: 'string'},
        end: {type: 'string'},
        metrics: {type: 'string'},
        interval: {type: 'string'},
        aggregate: {type: 'boolean'},
      },
      required: ['start', 'end'],
    },
    buildRequest: (args) => ({
      name: 'health_metrics',
      arguments: {
        start: args.start,
        end: args.end,
        metrics: args.metrics || '',
        interval: args.interval || 'hours',
        aggregate: args.aggregate ?? true,
      },
    }),
  },
  get_workouts: {
    description: 'Get workout data for a specified date range from Apple Health',
    inputSchema: {
      type: 'object',
      properties: {
        start: {type: 'string'},
        end: {type: 'string'},
        includeMetadata: {type: 'boolean'},
        includeRoutes: {type: 'boolean'},
        metadataAggregation: {type: 'string'},
      },
      required: ['start', 'end'],
    },
    buildRequest: (args) => ({
      name: 'workouts',
      arguments: {
        start: args.start,
        end: args.end,
        includeMetadata: args.includeMetadata ?? true,
        includeRoutes: args.includeRoutes ?? false,
        metadataAggregation: args.metadataAggregation || 'minutes',
      },
    }),
  },
  get_medications: simpleRangeTool('medications', 'Get medications data for a specified date range from Apple Health'),
  get_heart_notifications: simpleRangeTool(
    'heart_notifications',
    'Get heart notification events for a specified date range from Apple Health',
  ),
  get_state_of_mind: simpleRangeTool('state_of_mind', 'Get state of mind data for a specified date range from Apple Health'),
  get_cycle_tracking: simpleRangeTool('cycle_tracking', 'Get menstrual cycle tracking data for a specified date range from Apple Health'),
  get_ecg: simpleRangeTool('ecg', 'Get ECG data for a specified date range from Apple Health'),
  get_symptoms: simpleRangeTool('symptoms', 'Get symptoms data for a specified date range from Apple Health'),
};

await main();

async function main() {
  resolvedHaeHost = await resolveHealthAutoExportHost(haeHost);

  process.stderr.write(`Performing health check to ${resolvedHaeHost}:${haePort}...\n`);
  const isHealthy = await healthCheck(resolvedHaeHost, haePort, 5000);

  if (isHealthy) {
    process.stderr.write(`Health check passed: Successfully connected to ${resolvedHaeHost}:${haePort}\n`);
  } else {
    process.stderr.write(
      `Health check warning: Cannot connect to ${resolvedHaeHost}:${haePort}. Ensure Health Auto Export iOS app is running with TCP server enabled.\n`,
    );
  }

  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const messageText = line.trim();

    if (!messageText) {
      continue;
    }

    let message;
    try {
      message = JSON.parse(messageText);
    } catch (error) {
      writeError(null, -32700, error instanceof Error ? error.message : 'Parse error');
      continue;
    }

    handleMessage(message).catch((error) => {
      writeError(
        message?.id ?? null,
        -32603,
        error instanceof Error ? error.message : String(error),
      );
    });
  }
}

async function handleMessage(message) {
  if (message.id === undefined) {
    return;
  }

  if (message.method === 'initialize') {
    writeResult(message.id, {
      protocolVersion: message.params?.protocolVersion ?? '2025-11-25',
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: 'FEEI.CN Health Auto Export',
        version: '1.0.0',
      },
    });
    return;
  }

  if (message.method === 'tools/list') {
    writeResult(message.id, {
      tools: Object.entries(tools).map(([name, tool]) => ({
        name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    });
    return;
  }

  if (message.method === 'tools/call') {
    const tool = tools[message.params?.name];

    if (!tool) {
      writeError(message.id, -32602, `Unknown tool: ${message.params?.name}`);
      return;
    }

    const args = message.params?.arguments ?? {};
    assertDateRangeArgs(args);

    const request = tool.buildRequest(args);
    const payload = await sendHealthAutoExportRequest(request.name, request.arguments);

    writeResult(message.id, {
      content: [
        {
          type: 'text',
          text: payload,
        },
      ],
    });
    return;
  }

  writeError(message.id, -32601, `Method not found: ${message.method}`);
}

function simpleRangeTool(name, description) {
  return {
    description,
    inputSchema: {
      type: 'object',
      properties: {
        start: {type: 'string'},
        end: {type: 'string'},
      },
      required: ['start', 'end'],
    },
    buildRequest: (args) => ({
      name,
      arguments: {
        start: args.start,
        end: args.end,
      },
    }),
  };
}

function sendHealthAutoExportRequest(toolName, args) {
  const request = {
    jsonrpc: '2.0',
    id: Math.floor(Math.random() * 1000000),
    method: 'callTool',
    params: {
      name: toolName,
      arguments: args,
    },
  };

  return sendTcpPayloadWithPython(resolvedHaeHost, haePort, JSON.stringify(request), defaultTimeoutMs);
}

async function resolveHealthAutoExportHost(host) {
  if (net.isIP(host)) {
    return host;
  }

  try {
    const addresses = await dns.lookup(host, {all: true, verbatim: false});
    const selected = selectPreferredAddress(addresses);

    if (selected) {
      const addressList = addresses.map((item) => item.address).join(', ');
      process.stderr.write(`Resolved HAE_HOST ${host} -> ${selected.address} (${addressList})\n`);
      return selected.address;
    }
  } catch (error) {
    process.stderr.write(
      `HAE_HOST resolution warning: failed to resolve ${host}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }

  return host;
}

function selectPreferredAddress(addresses) {
  return addresses.find((item) => item.family === 4 && isPrivateLanIPv4(item.address))
    ?? addresses.find((item) => item.family === 4 && !item.address.startsWith('169.254.'))
    ?? addresses.find((item) => item.family === 6 && !item.address.toLowerCase().startsWith('fe80:'))
    ?? addresses.find((item) => item.family === 4)
    ?? addresses[0];
}

function isPrivateLanIPv4(address) {
  if (address.startsWith('10.') || address.startsWith('192.168.')) {
    return true;
  }

  const parts = address.split('.').map((part) => Number.parseInt(part, 10));
  return parts.length === 4 && parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
}

function healthCheck(host, port, timeoutMs) {
  return tcpHealthCheckWithPython(host, port, timeoutMs);
}

function sendTcpPayloadWithPython(host, port, payload, timeoutMs) {
  const script = `
import json
import socket
import sys

host = sys.argv[1]
port = int(sys.argv[2])
timeout = int(sys.argv[3]) / 1000
payload = sys.stdin.read().encode("utf-8")

try:
    with socket.create_connection((host, port), timeout) as sock:
        sock.settimeout(timeout)
        sock.sendall(payload)
        try:
            sock.shutdown(socket.SHUT_WR)
        except OSError:
            pass

        chunks = []
        while True:
            chunk = sock.recv(65536)
            if not chunk:
                break
            chunks.append(chunk)

    response = b"".join(chunks).decode("utf-8", "replace")
    if not response:
        print("No response data received")
    else:
        try:
            print(json.dumps(json.loads(response), ensure_ascii=False, indent=2))
        except Exception:
            print(response, end="" if response.endswith("\\n") else "\\n")
except Exception as error:
    print(f"Failed to connect to Health Auto Export at {host}:{port}: {error}")
`;

  return new Promise((resolve) => {
    const child = spawn('/usr/bin/python3', ['-c', script, host, String(port), String(timeoutMs)], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      resolve(`Failed to run Python TCP client: ${error.message}`);
    });
    child.on('close', () => {
      resolve(stdout.trim() || stderr.trim() || 'No response data received');
    });
    child.stdin.end(payload);
  });
}

function tcpHealthCheckWithPython(host, port, timeoutMs) {
  const script = `
import socket
import sys

host = sys.argv[1]
port = int(sys.argv[2])
timeout = int(sys.argv[3]) / 1000

try:
    with socket.create_connection((host, port), timeout):
        pass
    sys.exit(0)
except Exception:
    sys.exit(1)
`;

  return new Promise((resolve) => {
    const child = spawn('/usr/bin/python3', ['-c', script, host, String(port), String(timeoutMs)], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });

    child.on('error', () => {
      resolve(false);
    });
    child.on('close', (code) => {
      resolve(code === 0);
    });
  });
}

function assertDateRangeArgs(args) {
  if (typeof args.start !== 'string' || typeof args.end !== 'string') {
    throw new Error('Tool arguments must include start and end strings');
  }
}

function parseIntegerEnv(name, value) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: ${value}`);
  }

  return parsed;
}

function writeResult(id, result) {
  process.stdout.write(`${JSON.stringify({jsonrpc: '2.0', id, result})}\n`);
}

function writeError(id, code, message) {
  process.stdout.write(`${JSON.stringify({jsonrpc: '2.0', id, error: {code, message}})}\n`);
}
