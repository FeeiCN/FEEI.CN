import net from 'node:net';
import readline from 'node:readline';

const haeHost = process.env.HAE_HOST || 'localhost';
const haePort = parseIntegerEnv('HAE_PORT', process.env.HAE_PORT || '9000');
const defaultTimeoutMs = parseIntegerEnv('HAE_TIMEOUT', process.env.HAE_TIMEOUT || '86400000');

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
  process.stderr.write(`Performing health check to ${haeHost}:${haePort}...\n`);
  const isHealthy = await healthCheck(haeHost, haePort, 5000);

  if (isHealthy) {
    process.stderr.write(`Health check passed: Successfully connected to ${haeHost}:${haePort}\n`);
  } else {
    process.stderr.write(
      `Health check warning: Cannot connect to ${haeHost}:${haePort}. Ensure Health Auto Export iOS app is running with TCP server enabled.\n`,
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

  return new Promise((resolve) => {
    const client = new net.Socket();
    let responseData = '';
    let settled = false;

    client.setTimeout(defaultTimeoutMs);

    client.connect(haePort, haeHost, () => {
      client.write(JSON.stringify(request));
    });

    client.on('data', (data) => {
      responseData += data.toString();
    });

    client.on('end', () => {
      settleWithResponse();
    });

    client.on('close', () => {
      settleWithResponse();
    });

    client.on('error', (error) => {
      if (responseData) {
        settleWithResponse();
        return;
      }

      settle(`Failed to connect to Health Auto Export at ${haeHost}:${haePort}: ${error.message}`);
    });

    client.on('timeout', () => {
      client.destroy();
      settle(`Request to Health Auto Export timed out after ${defaultTimeoutMs}ms`);
    });

    function settleWithResponse() {
      if (!responseData) {
        settle('No response data received');
        return;
      }

      try {
        settle(JSON.stringify(JSON.parse(responseData), null, 2));
      } catch {
        settle(responseData);
      }
    }

    function settle(text) {
      if (settled) {
        return;
      }

      settled = true;
      resolve(text);
    }
  });
}

function healthCheck(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const client = new net.Socket();
    let settled = false;

    client.setTimeout(timeoutMs);

    client.connect(port, host, () => {
      settle(true);
      client.end();
    });

    client.on('error', () => {
      settle(false);
    });

    client.on('timeout', () => {
      client.destroy();
      settle(false);
    });

    function settle(value) {
      if (settled) {
        return;
      }

      settled = true;
      resolve(value);
    }
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
