/**
 * MCP (Model Context Protocol) Tool Server
 * Exposes AgentWork tasks, agents, and projects as MCP resources/tools.
 *
 * To use with Claude Desktop, add to claude_desktop_config.json:
 * {
 *   "mcpServers": {
 *     "agentwork": {
 *       "command": "node",
 *       "args": ["/path/to/agentwork/server/mcp.js"]
 *     }
 *   }
 * }
 *
 * This is a standalone MCP server that connects to the running AgentWork instance.
 */

const BASE_URL = process.env.AGENTWORK_URL || 'http://localhost:1248';

async function apiRequest(method, path, body) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// MCP protocol implementation (simplified stdio JSON-RPC)
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });

const tools = [
  {
    name: 'agentwork_list_tasks',
    description: 'List all tasks in AgentWork',
    inputSchema: { type: 'object', properties: { status: { type: 'string' } } },
  },
  {
    name: 'agentwork_create_task',
    description: 'Create a new task in AgentWork',
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' } }, required: ['title'] },
  },
  {
    name: 'agentwork_list_agents',
    description: 'List all agents in AgentWork',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'agentwork_list_projects',
    description: 'List all projects in AgentWork',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'agentwork_get_status',
    description: 'Get AgentWork system status',
    inputSchema: { type: 'object', properties: {} },
  },
];

async function handleToolCall(name, args) {
  switch (name) {
    case 'agentwork_list_tasks':
      return apiRequest('GET', `/api/tasks${args.status ? `?status=${args.status}` : ''}`);
    case 'agentwork_create_task':
      return apiRequest('POST', '/api/tasks', { title: args.title, description: args.description, status: 'todo' });
    case 'agentwork_list_agents':
      return apiRequest('GET', '/api/agents');
    case 'agentwork_list_projects':
      return apiRequest('GET', '/api/projects');
    case 'agentwork_get_status':
      return apiRequest('GET', '/api/status');
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

rl.on('line', async (line) => {
  try {
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') {
      respond(msg.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'agentwork', version: '1.0.0' } });
    } else if (msg.method === 'tools/list') {
      respond(msg.id, { tools });
    } else if (msg.method === 'tools/call') {
      const result = await handleToolCall(msg.params.name, msg.params.arguments || {});
      respond(msg.id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
    } else {
      respond(msg.id, {});
    }
  } catch (err) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -1, message: err.message } }) + '\n');
  }
});

console.error('[MCP] AgentWork MCP server started');
