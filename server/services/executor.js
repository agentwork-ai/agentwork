const { db, uuidv4, DATA_DIR } = require('../db');
const { createCompletion, estimateCost, runClaudeAgent, runCodexAgent } = require('./ai');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let io = null;
const activeExecutions = new Map();
// Store CLI sessions for chat continuity: agentId -> { sessionId, thread }
const agentSessions = new Map();

function initExecutor(socketIo) {
  io = socketIo;

  io.on('connection', (socket) => {
    socket.on('task:execute', async (data) => {
      const { taskId, agentId } = data;
      if (activeExecutions.has(taskId)) return;
      executeTask(taskId, agentId);
    });

    // Handle user replies to unblock agents
    socket.on('chat:user_reply', (data) => {
      const exec = activeExecutions.get(data.taskId);
      if (exec && exec.waitingForUser) {
        exec.userReply = data.content;
        exec.waitingForUser = false;
      }
    });

    // Direct chat with agent (non-task)
    socket.on('chat:direct', async (data) => {
      const { agentId, content } = data;
      const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
      if (!agent) return;

      try {
        if (agent.auth_type === 'cli') {
          await handleCliChat(agent, content);
        } else {
          await handleApiChat(agent, content);
        }
      } catch (err) {
        sendMessage(agentId, 'agent', `Error: ${err.message}`);
      }
    });
  });
}

// ─── Direct Chat Handlers ───

async function handleCliChat(agent, userMessage) {
  const agentId = agent.id;

  // Update status to working
  db.prepare("UPDATE agents SET status = 'thinking', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(agentId);
  io.emit('agent:status_changed', { agentId, status: 'thinking' });

  try {
    if (agent.provider === 'anthropic' || agent.provider === 'claude-cli') {
      const { chatWithClaudeAgent } = require('./ai');
      const session = agentSessions.get(agentId) || {};
      const result = await chatWithClaudeAgent(userMessage, session.sessionId, process.cwd());

      agentSessions.set(agentId, { ...session, sessionId: result.sessionId });

      if (result.content) {
        sendMessage(agentId, 'agent', result.content);
      } else {
        sendMessage(agentId, 'agent', '(No response from agent)');
      }
    } else if (agent.provider === 'openai' || agent.provider === 'codex-cli') {
      const { chatWithCodexAgent } = require('./ai');
      let session = agentSessions.get(agentId);

      if (!session?.thread) {
        const { Codex } = await import('@openai/codex-sdk');
        const client = new Codex();
        const thread = client.startThread({
          workingDirectory: process.cwd(),
          approvalPolicy: 'never',
          sandboxMode: 'read-only',
        });
        session = { thread };
        agentSessions.set(agentId, session);
      }

      const result = await chatWithCodexAgent(userMessage, session.thread);
      if (result.content) {
        sendMessage(agentId, 'agent', result.content);
      } else {
        sendMessage(agentId, 'agent', '(No response from agent)');
      }
    }
  } catch (err) {
    sendMessage(agentId, 'agent', `Sorry, I encountered an error: ${err.message}`);
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
    // Load the last 20 messages for context
    const recentMsgs = db.prepare(
      'SELECT * FROM messages WHERE agent_id = ? ORDER BY created_at DESC LIMIT 20'
    ).all(agentId).reverse();

    const messages = [
      {
        role: 'system',
        content: `You are ${agent.name}, a ${agent.role}. You are a helpful AI assistant. Be concise and friendly. ${agent.personality || ''}`,
      },
      ...recentMsgs.map((m) => ({
        role: m.sender === 'user' ? 'user' : 'assistant',
        content: m.content,
      })),
      { role: 'user', content: userMessage },
    ];

    const response = await createCompletion(agent.provider, agent.model, messages);

    // Log budget
    logBudget(agentId, agent.provider, agent.model, response.inputTokens, response.outputTokens);

    sendMessage(agentId, 'agent', response.content);
  } catch (err) {
    sendMessage(agentId, 'agent', `Sorry, I encountered an error: ${err.message}`);
  } finally {
    db.prepare("UPDATE agents SET status = 'idle', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(agentId);
    io.emit('agent:status_changed', { agentId, status: 'idle' });
  }
}

// ─── Task Execution ───

async function executeTask(taskId, agentId) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  const project = task.project_id
    ? db.prepare('SELECT * FROM projects WHERE id = ?').get(task.project_id)
    : null;

  if (!task || !agent) return;

  const execState = { waitingForUser: false, userReply: null, aborted: false };
  activeExecutions.set(taskId, execState);

  // Update agent status
  db.prepare("UPDATE agents SET status = 'working', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(agentId);
  io.emit('agent:status_changed', { agentId, status: 'working' });

  addLog(taskId, 'info', `Agent ${agent.name} started working on: ${task.title}`);

  try {
    const workDir = project?.path || process.cwd();

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

async function executeTaskCli(taskId, agentId, agent, task, workDir, execState) {
  const agentDir = path.join(DATA_DIR, 'agents', agent.id);
  const memory = readFile(path.join(agentDir, 'MEMORY.md'));
  const soul = readFile(path.join(agentDir, 'SOUL.md'));

  // Build a comprehensive prompt for the CLI agent
  const prompt = `You are ${agent.name}, a ${agent.role}.

${soul ? `## Your Configuration\n${soul}\n` : ''}
${memory ? `## Your Memory\n${memory}\n` : ''}

## Task
Title: ${task.title}
Description: ${task.description || 'No description provided.'}

Working directory: ${workDir}

Please complete this task autonomously. Analyze the codebase, plan your approach, make the necessary changes, and verify they work.`;

  const abortController = new AbortController();
  execState.abortController = abortController;

  addLog(taskId, 'info', `Using ${agent.provider === 'codex-cli' || agent.provider === 'openai' ? 'Codex' : 'Claude'} Agent SDK (CLI mode)`);

  const onEvent = (event) => {
    if (execState.aborted) return;

    switch (event.type) {
      case 'text':
        addLog(taskId, 'response', event.content);
        break;
      case 'command':
        io.emit('agent:status_changed', { agentId, status: 'executing' });
        addLog(taskId, 'command', event.content);
        break;
      case 'output':
        addLog(taskId, 'output', event.content);
        break;
      case 'file_change':
        addLog(taskId, 'info', event.content);
        break;
      case 'reading':
        io.emit('agent:status_changed', { agentId, status: 'thinking' });
        addLog(taskId, 'info', event.content);
        break;
      case 'thinking':
        io.emit('agent:status_changed', { agentId, status: 'thinking' });
        addLog(taskId, 'thinking', event.content.slice(0, 500));
        break;
      case 'tool':
        addLog(taskId, 'info', event.content);
        break;
      case 'error':
        addLog(taskId, 'error', event.content);
        break;
      case 'done':
        addLog(taskId, 'success', 'Agent finished execution.');
        break;
      case 'session':
        // Store session for future resume
        const session = agentSessions.get(agentId) || {};
        session.sessionId = event.sessionId;
        agentSessions.set(agentId, session);
        break;
    }
  };

  try {
    if (agent.provider === 'codex-cli' || (agent.auth_type === 'cli' && agent.provider === 'openai')) {
      await runCodexAgent(prompt, workDir, onEvent, abortController);
    } else {
      const result = await runClaudeAgent(prompt, workDir, onEvent, abortController);
      if (result.costUsd) {
        logBudget(agentId, agent.provider, agent.model || 'claude-cli', 0, 0, result.costUsd);
      }
    }

    // Task completed via CLI
    moveTask(taskId, 'done');
    sendMessage(agentId, 'agent', `I've completed the task: ${task.title}`, taskId);

    // Update memory
    updateMemory(agentDir, agent.name, task.title, 'Completed via CLI agent.');
  } catch (err) {
    if (err.name === 'AbortError') {
      addLog(taskId, 'warning', 'Task execution was aborted.');
      moveTask(taskId, 'blocked');
    } else {
      addLog(taskId, 'error', `CLI agent error: ${err.message}`);
      moveTask(taskId, 'blocked');
      sendMessage(agentId, 'agent', `I encountered an error: ${err.message}`, taskId);
    }
  }
}

// ─── API-mode task execution (original loop) ───

async function executeTaskApi(taskId, agentId, agent, task, project, workDir, execState) {
  const agentDir = path.join(DATA_DIR, 'agents', agent.id);
  const soul = readFile(path.join(agentDir, 'SOUL.md'));
  const userPrefs = readFile(path.join(agentDir, 'USER.md'));
  const rules = readFile(path.join(agentDir, 'AGENTS.md'));
  const memory = readFile(path.join(agentDir, 'MEMORY.md'));

  let projectDoc = '';
  if (project && project.path) {
    const projDocPath = path.join(project.path, 'PROJECT.md');
    if (fs.existsSync(projDocPath)) {
      projectDoc = fs.readFileSync(projDocPath, 'utf8');
    }
  }

  const systemPrompt = buildSystemPrompt(agent, soul, userPrefs, rules, memory, projectDoc, project);

  // Check budget
  if (!checkBudget()) {
    addLog(taskId, 'error', 'Budget limit exceeded. Agent cannot execute.');
    moveTask(taskId, 'blocked');
    sendMessage(agentId, 'agent', 'Budget limit exceeded. Please increase the budget in Settings.', taskId);
    return;
  }

  const requireConfirmation = db.prepare("SELECT value FROM settings WHERE key = 'require_confirmation_destructive'").get()?.value === 'true';

  let messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Execute this task:\n\nTitle: ${task.title}\nDescription: ${task.description || 'No description provided.'}\n\nWork directory: ${workDir}\n\nPlease analyze the task, plan your approach, then execute it step by step. Use bash commands in \`\`\`bash code blocks. When done, respond with [TASK_COMPLETE] and a summary. If stuck, respond with [NEED_HELP].`,
    },
  ];

  let iterations = 0;
  const maxIterations = 20;

  while (iterations < maxIterations && !execState.aborted) {
    iterations++;
    addLog(taskId, 'thinking', `Iteration ${iterations}/${maxIterations}...`);
    io.emit('agent:status_changed', { agentId, status: 'thinking' });

    let response;
    try {
      response = await createCompletion(agent.provider, agent.model, messages);
    } catch (err) {
      addLog(taskId, 'error', `AI Error: ${err.message}`);
      if (err.message.includes('API key')) {
        moveTask(taskId, 'blocked');
        sendMessage(agentId, 'agent', `I need an API key to work. Error: ${err.message}`, taskId);
        break;
      }
      await sleep(2000);
      try {
        response = await createCompletion(agent.provider, agent.model, messages);
      } catch (retryErr) {
        addLog(taskId, 'error', `Retry failed: ${retryErr.message}`);
        moveTask(taskId, 'blocked');
        sendMessage(agentId, 'agent', `Unrecoverable error: ${retryErr.message}`, taskId);
        break;
      }
    }

    logBudget(agentId, agent.provider, agent.model, response.inputTokens, response.outputTokens);

    const content = response.content;
    addLog(taskId, 'response', content);
    messages.push({ role: 'assistant', content });

    if (content.includes('[TASK_COMPLETE]')) {
      addLog(taskId, 'success', 'Task completed successfully!');
      moveTask(taskId, 'done');
      sendMessage(agentId, 'agent', `I've completed the task: ${task.title}\n\n${extractSummary(content)}`, taskId);
      updateMemory(agentDir, agent.name, task.title, extractSummary(content));
      break;
    }

    if (content.includes('[NEED_HELP]')) {
      addLog(taskId, 'blocked', 'Agent is requesting help from user');
      moveTask(taskId, 'blocked');
      sendMessage(agentId, 'agent', content.replace('[NEED_HELP]', '').trim(), taskId);

      execState.waitingForUser = true;
      const reply = await waitForUserReply(execState, 300000);
      if (reply) {
        addLog(taskId, 'info', `User replied: ${reply}`);
        messages.push({ role: 'user', content: `User's response: ${reply}` });
        moveTask(taskId, 'doing');
        continue;
      } else {
        addLog(taskId, 'info', 'No user reply received.');
        break;
      }
    }

    const commands = extractCommands(content);
    if (commands.length > 0) {
      io.emit('agent:status_changed', { agentId, status: 'executing' });

      let commandResults = '';
      for (const cmd of commands) {
        if (requireConfirmation && isDestructive(cmd)) {
          addLog(taskId, 'warning', `Destructive command blocked: ${cmd}`);
          sendMessage(agentId, 'agent', `I want to run: \`${cmd}\`. Should I proceed?`, taskId);
          execState.waitingForUser = true;
          const approval = await waitForUserReply(execState, 120000);
          if (!approval || !['yes', 'y', 'ok', 'go ahead', 'proceed'].includes(approval.toLowerCase().trim())) {
            commandResults += `\nCommand blocked by user: ${cmd}\n`;
            continue;
          }
        }

        addLog(taskId, 'command', `$ ${cmd}`);
        try {
          const result = execSync(cmd, { cwd: workDir, timeout: 60000, encoding: 'utf8', maxBuffer: 1024 * 1024 });
          const output = result.toString().slice(0, 2000);
          addLog(taskId, 'output', output);
          commandResults += `\n$ ${cmd}\n${output}\n`;
        } catch (err) {
          const errMsg = (err.stderr || err.message || '').slice(0, 1000);
          addLog(taskId, 'error', `Command failed: ${errMsg}`);
          commandResults += `\n$ ${cmd}\nERROR: ${errMsg}\n`;
        }
      }

      messages.push({
        role: 'user',
        content: `Command results:\n${commandResults}\n\nContinue. If done, respond with [TASK_COMPLETE] and a summary.`,
      });
    } else {
      messages.push({
        role: 'user',
        content: 'Please continue. Use ```bash blocks for commands. If done, respond with [TASK_COMPLETE].',
      });
    }

    if (!checkBudget()) {
      addLog(taskId, 'error', 'Budget limit exceeded.');
      moveTask(taskId, 'blocked');
      sendMessage(agentId, 'agent', 'Budget limit exceeded. I had to stop.', taskId);
      break;
    }
  }

  if (iterations >= maxIterations) {
    addLog(taskId, 'warning', 'Maximum iterations reached.');
    moveTask(taskId, 'blocked');
    sendMessage(agentId, 'agent', `Reached max iterations (${maxIterations}). Please review my progress.`, taskId);
  }
}

// ─── Helpers ───

function buildSystemPrompt(agent, soul, userPrefs, rules, memory, projectDoc, project) {
  return `You are ${agent.name}, an AI agent working as a ${agent.role}.

${soul}

## User Preferences
${userPrefs}

## Operational Rules
${rules}

## Your Memory
${memory}

${projectDoc ? `## Project Documentation\n${projectDoc}` : ''}

## Available Tools
You can execute commands by wrapping them in \`\`\`bash code blocks.

## Important Rules
1. Work step by step, explaining your approach.
2. Execute commands one at a time and review results.
3. When done, always include [TASK_COMPLETE] followed by a summary.
4. If you cannot proceed, include [NEED_HELP] followed by your question.
5. Do NOT invent command outputs - wait for real results.
6. ${project ? `Working directory: ${project.path}` : 'Use the current working directory.'}
`;
}

function extractCommands(content) {
  const commands = [];
  const bashBlocks = content.match(/```bash\n([\s\S]*?)```/g);
  if (bashBlocks) {
    for (const block of bashBlocks) {
      const cmd = block.replace(/```bash\n/, '').replace(/```$/, '').trim();
      if (cmd) commands.push(cmd);
    }
  }
  return commands;
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

  db.prepare('UPDATE tasks SET execution_logs = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    JSON.stringify(logs),
    taskId
  );

  if (io) io.emit('task:log', { taskId, log: entry });
}

function moveTask(taskId, status) {
  const completedAt = status === 'done' ? new Date().toISOString() : null;
  db.prepare('UPDATE tasks SET status = ?, completed_at = COALESCE(?, completed_at), updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    status, completedAt, taskId
  );

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
  db.prepare(
    'INSERT INTO messages (id, agent_id, sender, content, task_id) VALUES (?, ?, ?, ?, ?)'
  ).run(id, agentId, sender, content, taskId || null);

  const message = {
    id, agent_id: agentId, sender, content, task_id: taskId || null,
    created_at: new Date().toISOString(),
  };

  if (io) {
    io.emit('chat:message', message);
    if (sender === 'agent') {
      io.emit('notification', { agentId, message: content.slice(0, 100) });
    }
  }
}

function logBudget(agentId, provider, model, inputTokens, outputTokens, directCost) {
  const cost = directCost || estimateCost(provider, model, inputTokens, outputTokens);
  const id = uuidv4();
  db.prepare(
    'INSERT INTO budget_logs (id, agent_id, provider, model, input_tokens, output_tokens, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, agentId, provider, model, inputTokens, outputTokens, cost);

  if (io) io.emit('budget:update', { cost, inputTokens, outputTokens });
}

function checkBudget() {
  const today = new Date().toISOString().split('T')[0];
  const dailyUsage = db.prepare(
    "SELECT COALESCE(SUM(cost_usd), 0) as total FROM budget_logs WHERE date(created_at) = ?"
  ).get(today);

  const dailyLimit = parseFloat(
    db.prepare("SELECT value FROM settings WHERE key = 'daily_budget_usd'").get()?.value || '10'
  );

  if (dailyUsage.total >= dailyLimit) return false;

  const monthStart = new Date();
  monthStart.setDate(1);
  const monthlyUsage = db.prepare(
    "SELECT COALESCE(SUM(cost_usd), 0) as total FROM budget_logs WHERE created_at >= ?"
  ).get(monthStart.toISOString());

  const monthlyLimit = parseFloat(
    db.prepare("SELECT value FROM settings WHERE key = 'monthly_budget_usd'").get()?.value || '100'
  );

  return monthlyUsage.total < monthlyLimit;
}

function updateMemory(agentDir, agentName, taskTitle, summary) {
  const memoryPath = path.join(agentDir, 'MEMORY.md');
  let existing = '';
  if (fs.existsSync(memoryPath)) existing = fs.readFileSync(memoryPath, 'utf8');

  const newEntry = `\n## ${new Date().toISOString().split('T')[0]} - ${taskTitle}\n${summary}\n`;
  const updated = existing + newEntry;

  if (updated.length > 8000) {
    const lines = updated.split('\n');
    const header = lines.slice(0, 3).join('\n');
    const entries = lines.slice(3);
    const keepFrom = Math.floor(entries.length * 0.4);
    fs.writeFileSync(memoryPath, header + '\n' + entries.slice(keepFrom).join('\n'));
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getActiveExecutions() {
  return Array.from(activeExecutions.keys());
}

module.exports = { initExecutor, executeTask, getActiveExecutions };
