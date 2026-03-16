const { db, uuidv4, DATA_DIR } = require('../db');
const { createCompletion, estimateCost, runClaudeAgent, runCodexAgent } = require('./ai');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let io = null;
const activeExecutions = new Map();
const agentSessions = new Map();

function initExecutor(socketIo) {
  io = socketIo;

  io.on('connection', (socket) => {
    socket.on('task:execute', async (data) => {
      const { taskId, agentId } = data;
      if (activeExecutions.has(taskId)) return;
      executeTask(taskId, agentId);
    });

    socket.on('chat:user_reply', (data) => {
      const exec = activeExecutions.get(data.taskId);
      if (exec && exec.waitingForUser) {
        exec.userReply = data.content;
        exec.waitingForUser = false;
      }
    });
  });
}

async function handleDirectChat(agentId, content, platformChatId) {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  if (!agent) {
    sendMessage(agentId, 'agent', 'Error: Agent not found.', null, platformChatId);
    return;
  }

  console.log(`[Chat] Direct message to ${agent.name} (${agent.auth_type}/${agent.provider}): "${content.slice(0, 80)}"`);

  try {
    if (agent.auth_type === 'cli') {
      await handleCliChat(agent, content, platformChatId);
    } else {
      await handleApiChat(agent, content, platformChatId);
    }
  } catch (err) {
    console.error(`[Chat] Unhandled error for agent ${agent.name}:`, err);
    sendMessage(agentId, 'agent', `Error: ${err.message}`, null, platformChatId);
    db.prepare("UPDATE agents SET status = 'idle', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(agentId);
    io.emit('agent:status_changed', { agentId, status: 'idle' });
  }
}

// ─── Direct Chat Handlers ───

async function handleCliChat(agent, userMessage, platformChatId) {
  const agentId = agent.id;
  const agentDir = path.join(DATA_DIR, 'agents', agentId);
  db.prepare("UPDATE agents SET status = 'thinking', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(agentId);
  io.emit('agent:status_changed', { agentId, status: 'thinking' });

  try {
    let responseContent = '';
    if (agent.provider === 'anthropic' || agent.provider === 'claude-cli') {
      let chatWithClaudeAgent;
      try {
        ({ chatWithClaudeAgent } = require('./ai'));
      } catch (importErr) {
        throw new Error(`Failed to load Claude Agent SDK: ${importErr.message}. Is @anthropic-ai/claude-agent-sdk installed?`);
      }
      const session = agentSessions.get(agentId) || {};
      const result = await chatWithClaudeAgent(userMessage, session.sessionId, process.cwd());
      agentSessions.set(agentId, { ...session, sessionId: result.sessionId });
      responseContent = result.content || '(Agent returned an empty response)';
    } else if (agent.provider === 'openai' || agent.provider === 'codex-cli') {
      let Codex, chatWithCodexAgent;
      try {
        ({ chatWithCodexAgent } = require('./ai'));
        ({ Codex } = await import('@openai/codex-sdk'));
      } catch (importErr) {
        throw new Error(`Failed to load Codex SDK: ${importErr.message}.`);
      }
      let session = agentSessions.get(agentId);
      if (!session?.thread) {
        const client = new Codex();
        const thread = client.startThread({ workingDirectory: process.cwd(), approvalPolicy: 'never', sandboxMode: 'read-only' });
        session = { thread };
        agentSessions.set(agentId, session);
      }
      const result = await chatWithCodexAgent(userMessage, session.thread);
      responseContent = result.content || '(Agent returned an empty response)';
    } else {
      throw new Error(`Unknown CLI provider: ${agent.provider}`);
    }
    sendMessage(agentId, 'agent', responseContent, null, platformChatId);
    reflectAfterChat(agent, agentDir, userMessage, responseContent);
  } catch (err) {
    console.error(`[Chat CLI] Error for agent ${agent.name}:`, err);
    sendMessage(agentId, 'agent', `⚠ Error: ${err.message}`, null, platformChatId);
  } finally {
    db.prepare("UPDATE agents SET status = 'idle', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(agentId);
    io.emit('agent:status_changed', { agentId, status: 'idle' });
  }
}

async function handleApiChat(agent, userMessage, platformChatId) {
  const agentId = agent.id;
  const agentDir = path.join(DATA_DIR, 'agents', agentId);
  db.prepare("UPDATE agents SET status = 'thinking', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(agentId);
  io.emit('agent:status_changed', { agentId, status: 'thinking' });

  try {
    const keyMap = { anthropic: 'anthropic_api_key', openai: 'openai_api_key', openrouter: 'openrouter_api_key', deepseek: 'deepseek_api_key', mistral: 'mistral_api_key', google: 'openai_api_key' };
    const apiKey = db.prepare("SELECT value FROM settings WHERE key = ?").get(keyMap[agent.provider] || 'openai_api_key')?.value;
    const customBaseUrl = db.prepare("SELECT value FROM settings WHERE key = 'custom_base_url'").get()?.value;
    if (!apiKey && !customBaseUrl) {
      const labels = { anthropic: 'Anthropic', openai: 'OpenAI', openrouter: 'OpenRouter', google: 'Google', deepseek: 'DeepSeek', mistral: 'Mistral' };
      throw new Error(`No API key configured for "${agent.provider}". Go to Settings → API Providers to add your ${labels[agent.provider] || agent.provider} API key.`);
    }

    const soul = readFile(path.join(agentDir, 'SOUL.md'));
    const memory = readFile(path.join(agentDir, 'MEMORY.md'));
    const userPrefs = readFile(path.join(agentDir, 'USER.md'));

    const recentMsgs = db.prepare('SELECT * FROM messages WHERE agent_id = ? ORDER BY created_at DESC LIMIT 20').all(agentId).reverse();
    const messages = [
      {
        role: 'system',
        content: `You are ${agent.name}, a ${agent.role}. Be concise and friendly. ${agent.personality || ''}\n\n${soul ? `## Your Configuration\n${soul}` : ''}\n\n${userPrefs ? `## User Preferences\n${userPrefs}` : ''}\n\n${memory ? `## Your Memory\n${memory}` : ''}`.trim(),
      },
      ...recentMsgs.map((m) => ({ role: m.sender === 'user' ? 'user' : 'assistant', content: m.content })),
      { role: 'user', content: userMessage },
    ];

    const response = await createCompletion(agent.provider, agent.model, messages);
    logBudget(agentId, agent.provider, agent.model, response.inputTokens, response.outputTokens);
    sendMessage(agentId, 'agent', response.content, null, platformChatId);

    // Fire-and-forget memory reflection
    reflectAfterChat(agent, agentDir, userMessage, response.content);
  } catch (err) {
    console.error(`[Chat API] Error for agent ${agent.name}:`, err);
    sendMessage(agentId, 'agent', `⚠ Error: ${err.message}`, null, platformChatId);
  } finally {
    db.prepare("UPDATE agents SET status = 'idle', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(agentId);
    io.emit('agent:status_changed', { agentId, status: 'idle' });
  }
}

// ─── Task Execution ───

async function executeTask(taskId, agentId) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  const project = task?.project_id ? db.prepare('SELECT * FROM projects WHERE id = ?').get(task.project_id) : null;

  if (!task || !agent) return;

  const execState = { waitingForUser: false, userReply: null, aborted: false };
  activeExecutions.set(taskId, execState);

  db.prepare("UPDATE agents SET status = 'working', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(agentId);
  io.emit('agent:status_changed', { agentId, status: 'working' });
  addLog(taskId, 'info', `Agent ${agent.name} started working on: ${task.title}`);

  try {
    const workDir = project?.path || process.cwd();

    // Ensure working directory exists
    if (!fs.existsSync(workDir)) {
      addLog(taskId, 'info', `Creating working directory: ${workDir}`);
      fs.mkdirSync(workDir, { recursive: true });
    }

    if (agent.auth_type === 'cli') {
      await executeTaskCli(taskId, agentId, agent, task, workDir, execState);
    } else {
      await executeTaskApi(taskId, agentId, agent, task, project, workDir, execState);
    }
  } catch (err) {
    addLog(taskId, 'error', `Execution error: ${err.message}`);
    moveTask(taskId, 'blocked');
    sendMessage(agentId, 'agent', `An unexpected error occurred: ${err.message}`, taskId);
  } finally {
    activeExecutions.delete(taskId);
    db.prepare("UPDATE agents SET status = 'idle', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(agentId);
    io.emit('agent:status_changed', { agentId, status: 'idle' });
    io.emit('system:status_update');
  }
}

// ─── CLI-mode task execution ───

function ensureGitRepo(workDir, taskId) {
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd: workDir, stdio: 'pipe' });
    return; // already a git repo
  } catch {
    // Not a git repo — init one
    addLog(taskId, 'info', `Initializing git repo in ${workDir} (required by Codex CLI)`);
    try {
      execSync('git init', { cwd: workDir, stdio: 'pipe' });
      execSync('git add -A && git commit -m "Initial commit" --allow-empty', { cwd: workDir, stdio: 'pipe', shell: true });
      addLog(taskId, 'info', 'Git repo initialized');
    } catch (gitErr) {
      addLog(taskId, 'warning', `Git init warning: ${gitErr.message}`);
    }
  }
}

async function executeTaskCli(taskId, agentId, agent, task, workDir, execState) {
  const agentDir = path.join(DATA_DIR, 'agents', agent.id);
  const memory = readFile(path.join(agentDir, 'MEMORY.md'));
  const soul = readFile(path.join(agentDir, 'SOUL.md'));

  const isCodex = agent.provider === 'codex-cli' || (agent.auth_type === 'cli' && agent.provider === 'openai');
  const sdkName = isCodex ? 'Codex' : 'Claude';

  addLog(taskId, 'info', `Using ${sdkName} Agent SDK (CLI mode)`);
  addLog(taskId, 'info', `Provider: ${agent.provider} | Working dir: ${workDir}`);

  // Codex requires a git repo
  if (isCodex) {
    ensureGitRepo(workDir, taskId);
  }

  const prompt = `You are ${agent.name}, a ${agent.role}.

${soul ? `## Your Configuration\n${soul}\n` : ''}
${memory ? `## Your Memory\n${memory}\n` : ''}

## Task
Title: ${task.title}
Description: ${task.description || 'No description provided.'}

Working directory: ${workDir}

Please complete this task autonomously. Analyze the codebase, plan your approach, make the necessary changes, and verify they work.`;

  addLog(taskId, 'info', `Prompt length: ${prompt.length} chars`);

  const abortController = new AbortController();
  execState.abortController = abortController;

  const onEvent = (event) => {
    if (execState.aborted) return;
    switch (event.type) {
      case 'text': addLog(taskId, 'response', event.content); break;
      case 'command':
        io.emit('agent:status_changed', { agentId, status: 'executing' });
        addLog(taskId, 'command', event.content);
        break;
      case 'output': addLog(taskId, 'output', event.content); break;
      case 'file_change': addLog(taskId, 'info', `File: ${event.content}`); break;
      case 'reading':
        io.emit('agent:status_changed', { agentId, status: 'thinking' });
        addLog(taskId, 'info', event.content);
        break;
      case 'thinking':
        io.emit('agent:status_changed', { agentId, status: 'thinking' });
        addLog(taskId, 'thinking', event.content.slice(0, 500));
        break;
      case 'tool': addLog(taskId, 'info', `Tool: ${event.content}`); break;
      case 'error': addLog(taskId, 'error', event.content); break;
      case 'done': addLog(taskId, 'success', 'Agent finished execution.'); break;
      case 'session':
        addLog(taskId, 'info', `Session ID: ${event.sessionId}`);
        const s = agentSessions.get(agentId) || {};
        s.sessionId = event.sessionId;
        agentSessions.set(agentId, s);
        break;
      default: addLog(taskId, 'info', `[${event.type}] ${event.content || ''}`); break;
    }
  };

  try {
    addLog(taskId, 'info', `Loading ${sdkName} SDK...`);

    if (isCodex) {
      let Codex;
      try {
        ({ Codex } = await import('@openai/codex-sdk'));
        addLog(taskId, 'info', 'Codex SDK loaded');
      } catch (importErr) {
        addLog(taskId, 'error', `Failed to load Codex SDK: ${importErr.message}`);
        throw importErr;
      }

      addLog(taskId, 'info', 'Creating Codex client and thread...');
      let client, thread;
      try {
        client = new Codex();
        thread = client.startThread({ workingDirectory: workDir, approvalPolicy: 'never', sandboxMode: 'danger-full-access' });
        addLog(taskId, 'info', 'Codex thread created');
      } catch (initErr) {
        addLog(taskId, 'error', `Failed to create Codex thread: ${initErr.message}`);
        throw initErr;
      }

      addLog(taskId, 'info', 'Starting Codex streamed run...');
      let streamedTurn;
      try {
        streamedTurn = await thread.runStreamed(prompt, { signal: abortController.signal });
        addLog(taskId, 'info', 'Codex stream started, processing events...');
      } catch (runErr) {
        addLog(taskId, 'error', `Failed to start Codex run: ${runErr.message}`);
        throw runErr;
      }

      let eventCount = 0;
      try {
        for await (const event of streamedTurn.events) {
          eventCount++;
          if (eventCount <= 5 || eventCount % 10 === 0) {
            addLog(taskId, 'info', `[Event #${eventCount}] type=${event.type}${event.item ? ` item.type=${event.item.type}` : ''}`);
          }
          if (event.type === 'item.completed') {
            const item = event.item;
            if (item.type === 'agent_message') {
              onEvent({ type: 'text', content: item.text || '' });
            } else if (item.type === 'command_execution') {
              onEvent({ type: 'command', content: `$ ${item.command || ''}` });
              if (item.output) onEvent({ type: 'output', content: (item.output || '').slice(0, 2000) });
              if (item.exit_code !== 0) onEvent({ type: 'error', content: `Exit code ${item.exit_code}` });
            } else if (item.type === 'file_change') {
              for (const c of (item.changes || [])) onEvent({ type: 'file_change', content: `${c.kind || 'update'}: ${c.path || ''}` });
            } else if (item.type === 'reasoning') {
              onEvent({ type: 'thinking', content: item.text || '' });
            } else if (item.type === 'error') {
              onEvent({ type: 'error', content: item.text || item.message || 'Unknown item error' });
            } else {
              addLog(taskId, 'info', `[Codex item] type=${item.type} ${JSON.stringify(item).slice(0, 300)}`);
            }
          } else if (event.type === 'turn.completed') {
            const usage = event.usage || {};
            addLog(taskId, 'info', `Turn completed. Tokens: in=${usage.input_tokens || 0} out=${usage.output_tokens || 0}`);
            onEvent({ type: 'done', content: 'Agent finished.' });
          } else if (event.type === 'turn.failed') {
            const errMsg = event.error?.message || JSON.stringify(event.error) || 'Turn failure';
            addLog(taskId, 'error', `Turn failed: ${errMsg}`);
          } else if (event.type === 'thread.started' || event.type === 'turn.started') {
            addLog(taskId, 'info', event.type);
          }
        }
        addLog(taskId, 'info', `Stream ended. Total events: ${eventCount}`);
      } catch (streamErr) {
        addLog(taskId, 'error', `Stream error: ${streamErr.message}`);
        addLog(taskId, 'error', `Events before error: ${eventCount}`);
        throw streamErr;
      }
    } else {
      // Claude Agent SDK
      try {
        const result = await runClaudeAgent(prompt, workDir, onEvent, abortController);
        addLog(taskId, 'info', `Claude finished. Cost: $${(result.costUsd || 0).toFixed(4)}`);
        if (result.costUsd) logBudget(agentId, agent.provider, agent.model || 'claude-cli', 0, 0, result.costUsd);
      } catch (claudeErr) {
        addLog(taskId, 'error', `Claude SDK error: ${claudeErr.message}`);
        throw claudeErr;
      }
    }

    const cliCompletionMsg = `I've completed the task: ${task.title}`;
    moveTask(taskId, 'done', cliCompletionMsg);
    sendMessage(agentId, 'agent', cliCompletionMsg, taskId);
    reflectAfterTask(agent, agentDir, task.title, 'Completed via CLI agent.', project);
  } catch (err) {
    if (err.name === 'AbortError') {
      addLog(taskId, 'warning', 'Task execution was aborted.');
    } else {
      addLog(taskId, 'error', `${sdkName} agent failed: ${err.message}`);
    }
    moveTask(taskId, 'blocked');
    sendMessage(agentId, 'agent', `I encountered an error: ${err.message}`, taskId);
  }
}

// ─── Agent Tools (for API-mode task execution) ───

const AGENT_TOOLS = [
  {
    name: 'read_file',
    description: 'Read the content of a file. Returns the file content as text.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'File path relative to the working directory' } },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file with the given content. Creates parent directories automatically.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the working directory' },
        content: { type: 'string', description: 'Content to write to the file' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'delete_path',
    description: 'Delete a file or directory (recursive for directories).',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Path to delete, relative to the working directory' } },
      required: ['path'],
    },
  },
  {
    name: 'run_bash',
    description: 'Execute a bash command in the working directory. Use for: npm install, mkdir, git, running tests, etc. Avoid interactive commands.',
    parameters: {
      type: 'object',
      properties: { command: { type: 'string', description: 'Bash command to execute' } },
      required: ['command'],
    },
  },
  {
    name: 'list_directory',
    description: 'List files and folders in a directory.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Directory path (defaults to working directory if omitted)' } },
      required: [],
    },
  },
  {
    name: 'task_complete',
    description: 'Signal that the task is fully done. Call this when all work is finished.',
    parameters: {
      type: 'object',
      properties: { summary: { type: 'string', description: 'Brief summary of what was accomplished' } },
      required: ['summary'],
    },
  },
  {
    name: 'request_help',
    description: 'Signal that you are blocked and need human help. Only use when truly impossible to proceed (e.g. missing API credentials, broken environment).',
    parameters: {
      type: 'object',
      properties: { reason: { type: 'string', description: 'Why you are blocked and what you need' } },
      required: ['reason'],
    },
  },
];

function executeTool(name, input, workDir, taskId, agentId) {
  switch (name) {
    case 'read_file': {
      const fullPath = path.resolve(workDir, input.path);
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        addLog(taskId, 'info', `read_file: ${input.path} (${content.length} chars)`);
        return content.length > 10000 ? content.slice(0, 10000) + '\n...(truncated)' : content;
      } catch (err) {
        return `Error reading file: ${err.message}`;
      }
    }
    case 'write_file': {
      const fullPath = path.resolve(workDir, input.path);
      try {
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, input.content);
        addLog(taskId, 'file_change', `write: ${input.path} (${input.content.length} bytes)`);
        io.emit('agent:status_changed', { agentId, status: 'executing' });
        return `File written: ${input.path}`;
      } catch (err) {
        return `Error writing file: ${err.message}`;
      }
    }
    case 'delete_path': {
      const fullPath = path.resolve(workDir, input.path);
      try {
        if (!fs.existsSync(fullPath)) return `Path does not exist: ${input.path}`;
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) fs.rmSync(fullPath, { recursive: true });
        else fs.unlinkSync(fullPath);
        addLog(taskId, 'info', `deleted: ${input.path}`);
        return `Deleted: ${input.path}`;
      } catch (err) {
        return `Error deleting: ${err.message}`;
      }
    }
    case 'run_bash': {
      addLog(taskId, 'command', `$ ${input.command}`);
      io.emit('agent:status_changed', { agentId, status: 'executing' });
      try {
        const output = execSync(input.command, {
          cwd: workDir,
          timeout: 120000,
          encoding: 'utf8',
          maxBuffer: 2 * 1024 * 1024,
          shell: true,
        });
        const result = output.toString().slice(0, 3000);
        addLog(taskId, 'output', result || '(no output)');
        return result || '(command completed with no output)';
      } catch (err) {
        const errMsg = ((err.stderr || '') + '\n' + (err.stdout || '') + '\n' + err.message).trim().slice(0, 2000);
        addLog(taskId, 'error', errMsg);
        return `Command failed (exit ${err.status || 'unknown'}): ${errMsg}`;
      }
    }
    case 'list_directory': {
      const dirPath = path.resolve(workDir, input.path || '.');
      try {
        const output = execSync(`ls -la "${dirPath}"`, { encoding: 'utf8', timeout: 5000, shell: true });
        return output.slice(0, 2000);
      } catch {
        try { return fs.readdirSync(dirPath).join('\n'); } catch (err) { return `Error: ${err.message}`; }
      }
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

function appendToolResults(messages, toolResults, provider) {
  if (provider === 'anthropic') {
    messages.push({
      role: 'user',
      content: toolResults.map((tr) => ({ type: 'tool_result', tool_use_id: tr.id, content: tr.result })),
    });
  } else {
    for (const tr of toolResults) {
      messages.push({ role: 'tool', tool_call_id: tr.id, content: tr.result });
    }
  }
}

// ─── API-mode task execution ───

async function executeTaskApi(taskId, agentId, agent, task, project, workDir, execState) {
  const agentDir = path.join(DATA_DIR, 'agents', agent.id);
  const soul = readFile(path.join(agentDir, 'SOUL.md'));
  const userPrefs = readFile(path.join(agentDir, 'USER.md'));
  const rules = readFile(path.join(agentDir, 'AGENTS.md'));
  const memory = readFile(path.join(agentDir, 'MEMORY.md'));

  let projectDoc = '';
  if (project?.path) {
    const projDocPath = path.join(project.path, 'PROJECT.md');
    if (fs.existsSync(projDocPath)) projectDoc = fs.readFileSync(projDocPath, 'utf8');
  }

  if (!checkBudget()) {
    addLog(taskId, 'error', 'Budget limit exceeded.');
    moveTask(taskId, 'blocked');
    sendMessage(agentId, 'agent', 'Budget limit exceeded.', taskId);
    return;
  }

  addLog(taskId, 'info', `API mode: ${agent.provider} / ${agent.model}`);
  addLog(taskId, 'info', `Working directory: ${workDir}`);

  let dirListing = '';
  try {
    dirListing = execSync('ls -la', { cwd: workDir, encoding: 'utf8', timeout: 5000 }).slice(0, 1000);
  } catch {}

  const systemPrompt = `You are ${agent.name}, an autonomous AI agent working as a ${agent.role}.

${soul}

## User Preferences
${userPrefs}

## Operational Rules
${rules}

## Your Memory
${memory}

${projectDoc ? `## Project Documentation\n${projectDoc}\n` : ''}
## Available Tools
Use tools to complete your task — do NOT write explanations without acting:
- **read_file**: Read any file
- **write_file**: Create or modify files (auto-creates directories)
- **delete_path**: Remove files or directories
- **run_bash**: Execute shell commands (npm, git, mkdir, etc.)
- **list_directory**: Browse the file structure
- **task_complete**: Call when ALL work is done (required to finish the task)
- **request_help**: Only if truly blocked (missing credentials, broken env)

## Rules
1. ALWAYS proceed autonomously. Never ask for confirmation or clarification.
2. Make your best judgment on ambiguous requirements.
3. Use tools to read code, make changes, and verify your work.
4. When finished, call task_complete with a summary.
5. ${project ? `Working directory: ${project.path}` : 'Use the provided working directory.'}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Complete this task:\n\nTitle: ${task.title}\nDescription: ${task.description || 'No description provided.'}\n\nWorking directory: ${workDir}\n\nCurrent files:\n${dirListing}\n\nStart immediately. Use the tools to explore, make changes, and complete the task.`,
    },
  ];

  let iterations = 0;
  const maxIterations = 30;

  while (iterations < maxIterations && !execState.aborted) {
    iterations++;
    addLog(taskId, 'thinking', `Iteration ${iterations}...`);
    io.emit('agent:status_changed', { agentId, status: 'thinking' });

    let response;
    try {
      response = await createCompletion(agent.provider, agent.model, messages, { tools: AGENT_TOOLS });
    } catch (err) {
      addLog(taskId, 'error', `AI Error: ${err.message}`);
      moveTask(taskId, 'blocked');
      sendMessage(agentId, 'agent', `Error: ${err.message}`, taskId);
      break;
    }

    logBudget(agentId, agent.provider, agent.model, response.inputTokens, response.outputTokens);

    if (response.content) addLog(taskId, 'response', response.content);

    const toolCalls = response.toolCalls || [];

    if (toolCalls.length > 0) {
      // Append assistant message (with tool_use blocks) to history
      if (response.rawAssistantMsg) {
        messages.push(response.rawAssistantMsg);
      } else {
        messages.push({ role: 'assistant', content: response.content || '' });
      }

      let taskDone = false;
      let needHelp = false;
      let helpReason = '';
      let summary = '';
      const toolResults = [];

      for (const toolCall of toolCalls) {
        addLog(taskId, 'info', `Tool: ${toolCall.name}(${JSON.stringify(toolCall.input).slice(0, 200)})`);

        if (toolCall.name === 'task_complete') {
          taskDone = true;
          summary = toolCall.input.summary || 'Task completed.';
          toolResults.push({ id: toolCall.id, result: 'Task marked as complete.' });
          break;
        }

        if (toolCall.name === 'request_help') {
          needHelp = true;
          helpReason = toolCall.input.reason || 'Agent needs help.';
          toolResults.push({ id: toolCall.id, result: 'Help request noted.' });
          break;
        }

        const result = executeTool(toolCall.name, toolCall.input, workDir, taskId, agentId);
        toolResults.push({ id: toolCall.id, result });
      }

      if (taskDone) {
        addLog(taskId, 'success', 'Task completed!');
        const completionMsg = `I've completed the task: ${task.title}\n\n${summary}`;
        moveTask(taskId, 'done', completionMsg);
        sendMessage(agentId, 'agent', completionMsg, taskId);
        reflectAfterTask(agent, agentDir, task.title, summary, project);
        break;
      }

      if (needHelp) {
        addLog(taskId, 'blocked', `Agent needs help: ${helpReason}`);
        moveTask(taskId, 'blocked');
        sendMessage(agentId, 'agent', helpReason, taskId);
        execState.waitingForUser = true;
        appendToolResults(messages, toolResults, agent.provider);
        const reply = await waitForUserReply(execState, 300000);
        if (reply) {
          addLog(taskId, 'info', `User replied: ${reply}`);
          messages.push({ role: 'user', content: `User's response: ${reply}` });
          moveTask(taskId, 'doing');
          continue;
        } else {
          break;
        }
      }

      appendToolResults(messages, toolResults, agent.provider);
    } else {
      // No tool calls — text-only response
      messages.push({ role: 'assistant', content: response.content || '' });

      // Legacy text signals (fallback)
      if (response.content?.includes('[TASK_COMPLETE]')) {
        addLog(taskId, 'success', 'Task completed (text signal)!');
        const textSummary = extractSummary(response.content);
        const textCompletionMsg = `I've completed the task: ${task.title}\n\n${textSummary}`;
        moveTask(taskId, 'done', textCompletionMsg);
        sendMessage(agentId, 'agent', textCompletionMsg, taskId);
        reflectAfterTask(agent, agentDir, task.title, extractSummary(response.content), project);
        break;
      }

      if (response.content?.includes('[NEED_HELP]')) {
        addLog(taskId, 'blocked', 'Agent requesting help (text signal)');
        moveTask(taskId, 'blocked');
        sendMessage(agentId, 'agent', response.content.replace('[NEED_HELP]', '').trim(), taskId);
        execState.waitingForUser = true;
        const reply = await waitForUserReply(execState, 300000);
        if (reply) {
          messages.push({ role: 'user', content: `User's response: ${reply}` });
          moveTask(taskId, 'doing');
          continue;
        } else {
          break;
        }
      }

      // Prompt agent to use tools
      addLog(taskId, 'warning', 'No tool calls — prompting agent to use tools');
      messages.push({
        role: 'user',
        content: 'You must use the provided tools to complete this task. Use write_file to create/edit files, run_bash for commands, read_file to inspect code. When done, call task_complete.',
      });
    }

    if (!checkBudget()) {
      addLog(taskId, 'error', 'Budget limit exceeded.');
      moveTask(taskId, 'blocked');
      sendMessage(agentId, 'agent', 'Budget limit exceeded.', taskId);
      break;
    }
  }

  if (iterations >= maxIterations && !execState.aborted) {
    addLog(taskId, 'warning', 'Maximum iterations reached.');
    moveTask(taskId, 'blocked');
    sendMessage(agentId, 'agent', `Reached max iterations (${maxIterations}). Please review my progress.`, taskId);
  }
}

// ─── Helpers ───

function readFile(filePath) {
  try {
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf8');
  } catch {}
  return '';
}

function addLog(taskId, type, content) {
  const task = db.prepare('SELECT execution_logs FROM tasks WHERE id = ?').get(taskId);
  if (!task) return;
  const logs = JSON.parse(task.execution_logs || '[]');
  const entry = { timestamp: new Date().toISOString(), type, content };
  logs.push(entry);
  db.prepare('UPDATE tasks SET execution_logs = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(JSON.stringify(logs), taskId);
  if (io) io.emit('task:log', { taskId, log: entry });
}

function moveTask(taskId, status, output) {
  const completedAt = status === 'done' ? new Date().toISOString() : null;
  if (output !== undefined) {
    db.prepare('UPDATE tasks SET status = ?, completed_at = COALESCE(?, completed_at), completion_output = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, completedAt, output, taskId);
  } else {
    db.prepare('UPDATE tasks SET status = ?, completed_at = COALESCE(?, completed_at), updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, completedAt, taskId);
  }
  const task = db.prepare(
    'SELECT t.*, a.name as agent_name, a.avatar as agent_avatar, p.name as project_name FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id LEFT JOIN projects p ON t.project_id = p.id WHERE t.id = ?'
  ).get(taskId);
  if (task) {
    task.execution_logs = JSON.parse(task.execution_logs || '[]');
    task.attachments = JSON.parse(task.attachments || '[]');
    if (io) io.emit('task:updated', task);
  }
}

function sendMessage(agentId, sender, content, taskId, platformChatId) {
  const id = uuidv4();
  db.prepare('INSERT INTO messages (id, agent_id, sender, content, task_id) VALUES (?, ?, ?, ?, ?)').run(id, agentId, sender, content, taskId || null);
  const message = { id, agent_id: agentId, sender, content, task_id: taskId || null, created_at: new Date().toISOString() };
  if (io) {
    io.emit('chat:message', message);
    if (sender === 'agent') io.emit('notification', { agentId, message: content.slice(0, 100) });
  }
  // Route agent response back to platform (Telegram/Slack)
  if (sender === 'agent' && platformChatId) {
    try {
      const { agentBus } = require('./platforms');
      agentBus.emit(`reply:${agentId}:${platformChatId}`, content);
    } catch {}
  }
}

function logBudget(agentId, provider, model, inputTokens, outputTokens, directCost) {
  const cost = directCost || estimateCost(provider, model, inputTokens, outputTokens);
  const id = uuidv4();
  db.prepare('INSERT INTO budget_logs (id, agent_id, provider, model, input_tokens, output_tokens, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, agentId, provider, model, inputTokens, outputTokens, cost);
  if (io) io.emit('budget:update', { cost, inputTokens, outputTokens });
}

function checkBudget() {
  const today = new Date().toISOString().split('T')[0];
  const daily = db.prepare("SELECT COALESCE(SUM(cost_usd), 0) as total FROM budget_logs WHERE date(created_at) = ?").get(today);
  const dailyLimit = parseFloat(db.prepare("SELECT value FROM settings WHERE key = 'daily_budget_usd'").get()?.value || '10');
  if (daily.total >= dailyLimit) return false;
  const monthStart = new Date(); monthStart.setDate(1);
  const monthly = db.prepare("SELECT COALESCE(SUM(cost_usd), 0) as total FROM budget_logs WHERE created_at >= ?").get(monthStart.toISOString());
  const monthlyLimit = parseFloat(db.prepare("SELECT value FROM settings WHERE key = 'monthly_budget_usd'").get()?.value || '100');
  return monthly.total < monthlyLimit;
}

// ─── Memory Reflection ───

// Cheapest available model per provider for background reflection
const REFLECTION_MODELS = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-4o-mini',
  openrouter: 'openai/gpt-4o-mini',
  deepseek: 'deepseek-chat',
  mistral: 'mistral-small-latest',
};

function parseJsonResponse(content) {
  try {
    let str = content.trim();
    const blockMatch = str.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (blockMatch) str = blockMatch[1].trim();
    const objMatch = str.match(/(\{[\s\S]*\})/);
    if (objMatch) str = objMatch[1];
    return JSON.parse(str);
  } catch { return {}; }
}

function appendMemoryEntry(agentDir, title, content) {
  const memPath = path.join(agentDir, 'MEMORY.md');
  const existing = readFile(memPath) || '';
  const today = new Date().toISOString().split('T')[0];
  const updated = existing + `\n## ${today} - ${title}\n${content}\n`;
  if (updated.length > 8000) {
    const lines = updated.split('\n');
    const header = lines.slice(0, 3).join('\n');
    const entries = lines.slice(3);
    fs.writeFileSync(memPath, header + '\n' + entries.slice(Math.floor(entries.length * 0.4)).join('\n'));
  } else {
    fs.writeFileSync(memPath, updated);
  }
}

// Full AI-powered reflection after task completion — async, fire-and-forget
async function reflectAfterTask(agent, agentDir, taskTitle, taskSummary, project) {
  if (agent.auth_type !== 'api') {
    appendMemoryEntry(agentDir, taskTitle, taskSummary);
    return;
  }
  try {
    const reflModel = REFLECTION_MODELS[agent.provider] || agent.model;
    const today = new Date().toISOString().split('T')[0];

    const memory = readFile(path.join(agentDir, 'MEMORY.md'));
    const userPrefs = readFile(path.join(agentDir, 'USER.md'));
    const agentRules = readFile(path.join(agentDir, 'AGENTS.md'));
    let projectDoc = '';
    const projectDocPath = project?.path ? path.join(project.path, 'PROJECT.md') : null;
    if (projectDocPath && fs.existsSync(projectDocPath)) {
      projectDoc = fs.readFileSync(projectDocPath, 'utf8');
    }

    const response = await createCompletion(agent.provider, reflModel, [
      {
        role: 'system',
        content: `You are the memory system for AI agent "${agent.name}". Update the agent's memory files based on completed work. Respond ONLY with valid JSON — no explanation, no markdown outside the JSON.`,
      },
      {
        role: 'user',
        content: `## Completed Task (${today})
Title: "${taskTitle}"
Summary: ${taskSummary}

## Current Memory Files

MEMORY.md:
${memory || '(empty)'}

USER.md:
${userPrefs || '(empty)'}

AGENTS.md:
${agentRules || '(empty)'}

${project ? `PROJECT.md (${project.path}/PROJECT.md):\n${projectDoc || '(empty - create it)'}` : ''}

## Instructions
Analyze the completed task and return a JSON object with only the files that need updating:
{
  "MEMORY.md": "full updated content",
  "USER.md": "full updated content — only if new user preferences/patterns were observed",
  "AGENTS.md": "full updated content — only if new project conventions/tools/rules were learned",
  "PROJECT.md": "full updated content — only if project knowledge was gained (tech stack, structure, commands, etc.)"
}

Rules:
- MEMORY.md: Always add a concise dated entry. Keep full history, trim oldest 40% if >8000 chars.
- USER.md: Update if the task revealed user preferences, coding style, or communication patterns.
- AGENTS.md: Update if you learned project conventions (e.g. "uses yarn", "tests with Jest", "deploy with Vercel").
- PROJECT.md: Document what the project does, tech stack, directory structure, key commands, recent changes. Very valuable — be detailed if this is new info.
- Omit a key if that file genuinely needs no changes.`,
      },
    ], { maxTokens: 3000 });

    logBudget(agent.id, agent.provider, reflModel, response.inputTokens, response.outputTokens);
    const updates = parseJsonResponse(response.content);

    if (updates['MEMORY.md']) { fs.writeFileSync(path.join(agentDir, 'MEMORY.md'), updates['MEMORY.md']); console.log(`[Reflect] MEMORY.md ← ${agent.name}`); }
    if (updates['USER.md']) { fs.writeFileSync(path.join(agentDir, 'USER.md'), updates['USER.md']); console.log(`[Reflect] USER.md ← ${agent.name}`); }
    if (updates['AGENTS.md']) { fs.writeFileSync(path.join(agentDir, 'AGENTS.md'), updates['AGENTS.md']); console.log(`[Reflect] AGENTS.md ← ${agent.name}`); }
    if (updates['PROJECT.md'] && project?.path) { fs.writeFileSync(path.join(project.path, 'PROJECT.md'), updates['PROJECT.md']); console.log(`[Reflect] PROJECT.md ← ${project.path}`); }
  } catch (err) {
    console.error(`[Reflect] Task reflection failed for ${agent.name}:`, err.message);
    appendMemoryEntry(agentDir, taskTitle, taskSummary);
  }
}

// Lightweight AI reflection after a chat exchange — async, fire-and-forget
async function reflectAfterChat(agent, agentDir, userMessage, agentResponse) {
  if (agent.auth_type !== 'api') {
    const today = new Date().toISOString().split('T')[0];
    appendMemoryEntry(agentDir, 'Chat', `User: ${userMessage.slice(0, 150)}\nAgent: ${agentResponse.slice(0, 150)}`);
    return;
  }
  try {
    const reflModel = REFLECTION_MODELS[agent.provider] || agent.model;
    const today = new Date().toISOString().split('T')[0];

    const memory = readFile(path.join(agentDir, 'MEMORY.md'));
    const userPrefs = readFile(path.join(agentDir, 'USER.md'));

    const response = await createCompletion(agent.provider, reflModel, [
      {
        role: 'system',
        content: `You are the memory system for AI agent "${agent.name}". Update memory files based on a chat exchange. Respond ONLY with valid JSON.`,
      },
      {
        role: 'user',
        content: `## Chat Exchange (${today})
User: ${userMessage.slice(0, 600)}
Agent: ${agentResponse.slice(0, 600)}

## Current Files

MEMORY.md:
${memory || '(empty)'}

USER.md:
${userPrefs || '(empty)'}

## Instructions
Return JSON with only files that need updating:
{
  "MEMORY.md": "full updated content",
  "USER.md": "full updated content — only if user preferences/patterns observed"
}

Rules:
- MEMORY.md: Add a brief entry only if something meaningful was discussed (skip trivial/greeting exchanges).
- USER.md: Update if the user expressed preferences, a working style, or communication patterns.
- Return {} if nothing meaningful needs to be remembered.`,
      },
    ], { maxTokens: 1500 });

    logBudget(agent.id, agent.provider, reflModel, response.inputTokens, response.outputTokens);
    const updates = parseJsonResponse(response.content);

    if (updates['MEMORY.md']) { fs.writeFileSync(path.join(agentDir, 'MEMORY.md'), updates['MEMORY.md']); console.log(`[Reflect] MEMORY.md ← ${agent.name} (chat)`); }
    if (updates['USER.md']) { fs.writeFileSync(path.join(agentDir, 'USER.md'), updates['USER.md']); console.log(`[Reflect] USER.md ← ${agent.name} (chat)`); }
  } catch (err) {
    console.error(`[Reflect] Chat reflection failed for ${agent.name}:`, err.message);
  }
}

function extractSummary(content) {
  const match = content.match(/\[TASK_COMPLETE\]([\s\S]*)/);
  return match ? match[1].trim().slice(0, 500) : 'Task completed.';
}

function waitForUserReply(execState, timeout) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const check = setInterval(() => {
      if (execState.userReply) {
        clearInterval(check);
        const reply = execState.userReply;
        execState.userReply = null;
        resolve(reply);
      } else if (Date.now() - startTime > timeout || execState.aborted) {
        clearInterval(check);
        resolve(null);
      }
    }, 1000);
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function getActiveExecutions() { return Array.from(activeExecutions.keys()); }

module.exports = { initExecutor, executeTask, getActiveExecutions, handleDirectChat };
