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

async function handleDirectChat(agentId, content) {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  if (!agent) {
    sendMessage(agentId, 'agent', 'Error: Agent not found.');
    return;
  }

  console.log(`[Chat] Direct message to ${agent.name} (${agent.auth_type}/${agent.provider}): "${content.slice(0, 80)}"`);

  try {
    if (agent.auth_type === 'cli') {
      await handleCliChat(agent, content);
    } else {
      await handleApiChat(agent, content);
    }
  } catch (err) {
    console.error(`[Chat] Unhandled error for agent ${agent.name}:`, err);
    sendMessage(agentId, 'agent', `Error: ${err.message}`);
    db.prepare("UPDATE agents SET status = 'idle', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(agentId);
    io.emit('agent:status_changed', { agentId, status: 'idle' });
  }
}

// ─── Direct Chat Handlers ───

async function handleCliChat(agent, userMessage) {
  const agentId = agent.id;
  db.prepare("UPDATE agents SET status = 'thinking', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(agentId);
  io.emit('agent:status_changed', { agentId, status: 'thinking' });

  try {
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
      sendMessage(agentId, 'agent', result.content || '(Agent returned an empty response)');
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
      sendMessage(agentId, 'agent', result.content || '(Agent returned an empty response)');
    } else {
      throw new Error(`Unknown CLI provider: ${agent.provider}`);
    }
  } catch (err) {
    console.error(`[Chat CLI] Error for agent ${agent.name}:`, err);
    sendMessage(agentId, 'agent', `⚠ Error: ${err.message}`);
  } finally {
    db.prepare("UPDATE agents SET status = 'idle', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(agentId);
    io.emit('agent:status_changed', { agentId, status: 'idle' });
  }
}

async function handleApiChat(agent, userMessage) {
  const agentId = agent.id;
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

    const recentMsgs = db.prepare('SELECT * FROM messages WHERE agent_id = ? ORDER BY created_at DESC LIMIT 20').all(agentId).reverse();
    const messages = [
      { role: 'system', content: `You are ${agent.name}, a ${agent.role}. Be concise and friendly. ${agent.personality || ''}` },
      ...recentMsgs.map((m) => ({ role: m.sender === 'user' ? 'user' : 'assistant', content: m.content })),
      { role: 'user', content: userMessage },
    ];

    const response = await createCompletion(agent.provider, agent.model, messages);
    logBudget(agentId, agent.provider, agent.model, response.inputTokens, response.outputTokens);
    sendMessage(agentId, 'agent', response.content);
  } catch (err) {
    console.error(`[Chat API] Error for agent ${agent.name}:`, err);
    sendMessage(agentId, 'agent', `⚠ Error: ${err.message}`);
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

    moveTask(taskId, 'done');
    sendMessage(agentId, 'agent', `I've completed the task: ${task.title}`, taskId);
    updateMemory(agentDir, agent.name, task.title, 'Completed via CLI agent.');
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

  const systemPrompt = buildSystemPrompt(agent, soul, userPrefs, rules, memory, projectDoc, project);

  if (!checkBudget()) {
    addLog(taskId, 'error', 'Budget limit exceeded.');
    moveTask(taskId, 'blocked');
    sendMessage(agentId, 'agent', 'Budget limit exceeded.', taskId);
    return;
  }

  addLog(taskId, 'info', `API mode: ${agent.provider} / ${agent.model}`);
  addLog(taskId, 'info', `Working directory: ${workDir}`);

  // List existing files for context
  let dirListing = '';
  try {
    dirListing = execSync('ls -la 2>/dev/null || dir', { cwd: workDir, encoding: 'utf8', timeout: 5000 }).slice(0, 1500);
  } catch {}

  let messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Execute this task NOW. Do NOT ask for confirmation — just do it.\n\nTitle: ${task.title}\nDescription: ${task.description || 'No description provided.'}\n\nWorking directory: ${workDir}\n\nCurrent directory listing:\n${dirListing}\n\nIMPORTANT: To create or edit files, use bash commands in \`\`\`bash code blocks. Examples:\n- Create file: \`\`\`bash\ncat > filename.js << 'FILEEOF'\ncontent here\nFILEEOF\n\`\`\`\n- Create directory: \`\`\`bash\nmkdir -p src/components\n\`\`\`\n- Read file: \`\`\`bash\ncat filename.js\n\`\`\`\n- Delete file: \`\`\`bash\nrm filename.js\n\`\`\`\n\nRULES:\n- Do NOT ask for confirmation or clarification. Proceed immediately.\n- Make your best judgment on any ambiguous requirements.\n- Start executing commands right away.\n- After all work is done, respond with [TASK_COMPLETE] and a brief summary.\n- Only use [NEED_HELP] if something is truly impossible (missing credentials, broken environment).`,
    },
  ];

  let iterations = 0;
  const maxIterations = 25;
  let noProgressCount = 0;

  while (iterations < maxIterations && !execState.aborted) {
    iterations++;
    addLog(taskId, 'thinking', `Iteration ${iterations}/${maxIterations}...`);
    io.emit('agent:status_changed', { agentId, status: 'thinking' });

    let response;
    try {
      response = await createCompletion(agent.provider, agent.model, messages);
    } catch (err) {
      addLog(taskId, 'error', `AI Error: ${err.message}`);
      moveTask(taskId, 'blocked');
      sendMessage(agentId, 'agent', `Error: ${err.message}`, taskId);
      break;
    }

    logBudget(agentId, agent.provider, agent.model, response.inputTokens, response.outputTokens);

    const content = response.content;
    addLog(taskId, 'response', content);
    messages.push({ role: 'assistant', content });

    // Check for completion
    if (content.includes('[TASK_COMPLETE]')) {
      addLog(taskId, 'success', 'Task completed successfully!');
      moveTask(taskId, 'done');
      sendMessage(agentId, 'agent', `I've completed the task: ${task.title}\n\n${extractSummary(content)}`, taskId);
      updateMemory(agentDir, agent.name, task.title, extractSummary(content));
      break;
    }

    // Check if agent needs help
    if (content.includes('[NEED_HELP]')) {
      addLog(taskId, 'blocked', 'Agent is requesting help');
      moveTask(taskId, 'blocked');
      sendMessage(agentId, 'agent', content.replace('[NEED_HELP]', '').trim(), taskId);
      execState.waitingForUser = true;
      const reply = await waitForUserReply(execState, 300000);
      if (reply) {
        addLog(taskId, 'info', `User replied: ${reply}`);
        messages.push({ role: 'user', content: `User's response: ${reply}` });
        moveTask(taskId, 'doing');
        noProgressCount = 0;
        continue;
      } else {
        addLog(taskId, 'info', 'No user reply received.');
        break;
      }
    }

    // Extract commands from response
    const commands = extractCommands(content);

    // Also extract inline file writes: ```filename\ncontent\n```
    const fileWrites = extractFileWrites(content, workDir);

    if (commands.length > 0 || fileWrites.length > 0) {
      noProgressCount = 0;
      io.emit('agent:status_changed', { agentId, status: 'executing' });

      let commandResults = '';

      // Execute file writes first
      for (const fw of fileWrites) {
        addLog(taskId, 'command', `[write] ${fw.path}`);
        try {
          const dir = path.dirname(fw.fullPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(fw.fullPath, fw.content);
          addLog(taskId, 'output', `Created: ${fw.path} (${fw.content.length} bytes)`);
          commandResults += `\nCreated file ${fw.path} successfully.\n`;
        } catch (err) {
          addLog(taskId, 'error', `Failed to write ${fw.path}: ${err.message}`);
          commandResults += `\nFailed to write ${fw.path}: ${err.message}\n`;
        }
      }

      // Execute bash commands
      for (const cmd of commands) {
        addLog(taskId, 'command', `$ ${cmd}`);
        try {
          const result = execSync(cmd, {
            cwd: workDir,
            timeout: 120000,
            encoding: 'utf8',
            maxBuffer: 2 * 1024 * 1024,
            shell: true,
          });
          const output = result.toString().slice(0, 3000);
          addLog(taskId, 'output', output || '(no output)');
          commandResults += `\n$ ${cmd}\n${output}\n`;
        } catch (err) {
          const stderr = (err.stderr || '').slice(0, 1000);
          const stdout = (err.stdout || '').slice(0, 500);
          const errMsg = stderr || err.message || 'Command failed';
          addLog(taskId, 'error', `Command failed: ${errMsg}`);
          commandResults += `\n$ ${cmd}\nSTDOUT: ${stdout}\nSTDERR: ${errMsg}\nExit code: ${err.status || 'unknown'}\n`;
        }
      }

      messages.push({
        role: 'user',
        content: `Command results:\n${commandResults}\n\nContinue working. If all work is done, respond with [TASK_COMPLETE] and a summary of what you did.`,
      });
    } else {
      // No commands extracted
      noProgressCount++;
      addLog(taskId, 'warning', `No commands found in response (attempt ${noProgressCount}/3)`);

      if (noProgressCount >= 3) {
        addLog(taskId, 'warning', 'Agent stuck — no commands after 3 attempts. Moving to blocked.');
        moveTask(taskId, 'blocked');
        sendMessage(agentId, 'agent', `I seem to be stuck on this task. I couldn't produce executable commands. Please review my progress.`, taskId);
        break;
      }

      messages.push({
        role: 'user',
        content: `You need to execute actual commands to make changes. Use \`\`\`bash code blocks to run shell commands.\n\nTo create a file:\n\`\`\`bash\ncat > path/to/file.js << 'FILEEOF'\nyour code here\nFILEEOF\n\`\`\`\n\nTo create a directory:\n\`\`\`bash\nmkdir -p path/to/dir\n\`\`\`\n\nTo list files:\n\`\`\`bash\nls -la\n\`\`\`\n\nPlease produce commands now to complete the task. If already done, respond with [TASK_COMPLETE] and a summary.`,
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

function buildSystemPrompt(agent, soul, userPrefs, rules, memory, projectDoc, project) {
  return `You are ${agent.name}, an autonomous AI agent working as a ${agent.role}.

${soul}

## User Preferences
${userPrefs}

## Operational Rules
${rules}

## Your Memory
${memory}

${projectDoc ? `## Project Documentation\n${projectDoc}` : ''}

## How to Execute Commands
You MUST use \`\`\`bash code blocks to execute shell commands. This is the ONLY way to make changes.

### Create a file:
\`\`\`bash
mkdir -p path/to/dir
cat > path/to/file.ext << 'FILEEOF'
file content here
FILEEOF
\`\`\`

### Read a file:
\`\`\`bash
cat path/to/file.ext
\`\`\`

### Create a directory:
\`\`\`bash
mkdir -p path/to/new/dir
\`\`\`

### Delete a file:
\`\`\`bash
rm path/to/file.ext
\`\`\`

### Run any command:
\`\`\`bash
npm install express
\`\`\`

## Important Rules
1. ALWAYS use \`\`\`bash blocks to execute commands — this is the only way to make changes.
2. Work step by step. Execute one or two commands at a time, then review the results.
3. Use \`cat > file << 'FILEEOF'...FILEEOF\` to create files with content.
4. When done, respond with [TASK_COMPLETE] followed by a brief summary.
5. Do NOT invent or guess command outputs — wait for real results.
6. ${project ? `Working directory: ${project.path}` : 'Use the current working directory.'}

## CRITICAL: Full Autonomy
- NEVER ask the user for permission, confirmation, or clarification.
- NEVER use [NEED_HELP] unless something is truly impossible (e.g. missing API credentials).
- If requirements are ambiguous, make your best judgment and proceed.
- If multiple approaches exist, pick the most reasonable one and execute it.
- Start producing \`\`\`bash commands IMMEDIATELY in your first response.
`;
}

function extractCommands(content) {
  const commands = [];
  // Match ```bash, ```sh, ```shell, ```zsh blocks
  const bashBlocks = content.match(/```(?:bash|sh|shell|zsh)\n([\s\S]*?)```/g);
  if (bashBlocks) {
    for (const block of bashBlocks) {
      const cmd = block.replace(/```(?:bash|sh|shell|zsh)\n/, '').replace(/```$/, '').trim();
      if (cmd) commands.push(cmd);
    }
  }
  return commands;
}

/**
 * Extract inline file write patterns like:
 * ```path/to/file.js
 * content
 * ```
 * Only matches if the language tag looks like a file path.
 */
function extractFileWrites(content, workDir) {
  const writes = [];
  const pattern = /```([\w./\\-]+\.\w+)\n([\s\S]*?)```/g;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    const filePath = match[1];
    const fileContent = match[2];
    // Only if it looks like a file path (has extension, not a known language)
    const knownLangs = ['bash', 'sh', 'shell', 'zsh', 'javascript', 'typescript', 'python', 'java', 'go', 'rust', 'c', 'cpp', 'json', 'yaml', 'yml', 'xml', 'html', 'css', 'sql', 'markdown', 'md', 'txt', 'plaintext', 'diff', 'log'];
    if (!knownLangs.includes(filePath.toLowerCase()) && filePath.includes('.')) {
      writes.push({
        path: filePath,
        fullPath: path.resolve(workDir, filePath),
        content: fileContent,
      });
    }
  }
  return writes;
}

function isDestructive(cmd) {
  const patterns = [/\brm\s/, /\brmdir\s/, /\bdrop\s/i, /\bdelete\s/i, /--force/, /-rf/, /\btruncate\s/i];
  return patterns.some((p) => p.test(cmd));
}

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

function moveTask(taskId, status) {
  const completedAt = status === 'done' ? new Date().toISOString() : null;
  db.prepare('UPDATE tasks SET status = ?, completed_at = COALESCE(?, completed_at), updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, completedAt, taskId);
  const task = db.prepare(
    'SELECT t.*, a.name as agent_name, a.avatar as agent_avatar, p.name as project_name FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id LEFT JOIN projects p ON t.project_id = p.id WHERE t.id = ?'
  ).get(taskId);
  if (task) {
    task.execution_logs = JSON.parse(task.execution_logs || '[]');
    task.attachments = JSON.parse(task.attachments || '[]');
    if (io) io.emit('task:updated', task);
  }
}

function sendMessage(agentId, sender, content, taskId) {
  const id = uuidv4();
  db.prepare('INSERT INTO messages (id, agent_id, sender, content, task_id) VALUES (?, ?, ?, ?, ?)').run(id, agentId, sender, content, taskId || null);
  const message = { id, agent_id: agentId, sender, content, task_id: taskId || null, created_at: new Date().toISOString() };
  if (io) {
    io.emit('chat:message', message);
    if (sender === 'agent') io.emit('notification', { agentId, message: content.slice(0, 100) });
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

function updateMemory(agentDir, agentName, taskTitle, summary) {
  const memoryPath = path.join(agentDir, 'MEMORY.md');
  let existing = fs.existsSync(memoryPath) ? fs.readFileSync(memoryPath, 'utf8') : '';
  const updated = existing + `\n## ${new Date().toISOString().split('T')[0]} - ${taskTitle}\n${summary}\n`;
  if (updated.length > 8000) {
    const lines = updated.split('\n');
    const header = lines.slice(0, 3).join('\n');
    const entries = lines.slice(3);
    fs.writeFileSync(memoryPath, header + '\n' + entries.slice(Math.floor(entries.length * 0.4)).join('\n'));
  } else {
    fs.writeFileSync(memoryPath, updated);
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
