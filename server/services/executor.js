const { db, uuidv4, DATA_DIR } = require('../db');
const { createCompletion, estimateCost } = require('./ai');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

let io = null;
const activeExecutions = new Map();

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
  });
}

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
    // Load agent memory files
    const agentDir = path.join(DATA_DIR, 'agents', agent.id);
    const soul = readFile(path.join(agentDir, 'SOUL.md'));
    const userPrefs = readFile(path.join(agentDir, 'USER.md'));
    const rules = readFile(path.join(agentDir, 'AGENTS.md'));
    const memory = readFile(path.join(agentDir, 'MEMORY.md'));

    // Load PROJECT.md if applicable
    let projectDoc = '';
    if (project && project.path) {
      const projDocPath = path.join(project.path, 'PROJECT.md');
      if (fs.existsSync(projDocPath)) {
        projectDoc = fs.readFileSync(projDocPath, 'utf8');
      }
    }

    // Build the system prompt
    const systemPrompt = buildSystemPrompt(agent, soul, userPrefs, rules, memory, projectDoc, project);

    // Check budget before starting
    const budgetOk = checkBudget();
    if (!budgetOk) {
      addLog(taskId, 'error', 'Budget limit exceeded. Agent cannot execute.');
      moveTask(taskId, 'blocked');
      sendMessage(agentId, 'agent', 'I cannot work on this task because the budget limit has been exceeded. Please increase the budget in Settings.', taskId);
      activeExecutions.delete(taskId);
      db.prepare("UPDATE agents SET status = 'idle', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(agentId);
      io.emit('agent:status_changed', { agentId, status: 'idle' });
      return;
    }

    // Require confirmation for destructive commands?
    const requireConfirmation = db.prepare("SELECT value FROM settings WHERE key = 'require_confirmation_destructive'").get()?.value === 'true';

    // Main execution loop
    let messages = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Execute this task:\n\nTitle: ${task.title}\nDescription: ${task.description || 'No description provided.'}\n\nWork directory: ${project?.path || process.cwd()}\n\nPlease analyze the task, plan your approach, then execute it step by step. Use the available tools (bash commands, file read/write) to complete the work. When you're done, respond with [TASK_COMPLETE] and a summary. If you're stuck, respond with [NEED_HELP] and explain what you need.`,
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
        // Retry once
        await sleep(2000);
        try {
          response = await createCompletion(agent.provider, agent.model, messages);
        } catch (retryErr) {
          addLog(taskId, 'error', `Retry failed: ${retryErr.message}`);
          moveTask(taskId, 'blocked');
          sendMessage(agentId, 'agent', `I encountered an error I can't recover from: ${retryErr.message}`, taskId);
          break;
        }
      }

      // Log budget
      logBudget(agentId, agent.provider, agent.model, response.inputTokens, response.outputTokens);

      const content = response.content;
      addLog(taskId, 'response', content);
      messages.push({ role: 'assistant', content });

      // Check for completion
      if (content.includes('[TASK_COMPLETE]')) {
        addLog(taskId, 'success', 'Task completed successfully!');
        moveTask(taskId, 'done');
        sendMessage(agentId, 'agent', `I've completed the task: ${task.title}\n\n${extractSummary(content)}`, taskId);

        // Update MEMORY.md
        updateMemory(agentDir, agent.name, task.title, extractSummary(content));
        break;
      }

      // Check if agent needs help
      if (content.includes('[NEED_HELP]')) {
        addLog(taskId, 'blocked', 'Agent is requesting help from user');
        moveTask(taskId, 'blocked');
        sendMessage(agentId, 'agent', content.replace('[NEED_HELP]', '').trim(), taskId);

        // Wait for user reply (max 5 minutes)
        execState.waitingForUser = true;
        const reply = await waitForUserReply(execState, 300000);
        if (reply) {
          addLog(taskId, 'info', `User replied: ${reply}`);
          messages.push({ role: 'user', content: `User's response: ${reply}` });
          moveTask(taskId, 'doing');
          continue;
        } else {
          addLog(taskId, 'info', 'No user reply received, task remains blocked.');
          break;
        }
      }

      // Extract and execute bash commands from the response
      const commands = extractCommands(content);
      if (commands.length > 0) {
        io.emit('agent:status_changed', { agentId, status: 'executing' });

        let commandResults = '';
        for (const cmd of commands) {
          // Check for destructive commands
          if (requireConfirmation && isDestructive(cmd)) {
            addLog(taskId, 'warning', `Destructive command blocked: ${cmd}`);
            sendMessage(agentId, 'agent', `I want to run a potentially destructive command: \`${cmd}\`. Should I proceed?`, taskId);
            execState.waitingForUser = true;
            const approval = await waitForUserReply(execState, 120000);
            if (!approval || !['yes', 'y', 'ok', 'go ahead', 'proceed'].includes(approval.toLowerCase().trim())) {
              commandResults += `\nCommand blocked by user: ${cmd}\n`;
              continue;
            }
          }

          addLog(taskId, 'command', `$ ${cmd}`);
          try {
            const result = execSync(cmd, {
              cwd: project?.path || process.cwd(),
              timeout: 60000,
              encoding: 'utf8',
              maxBuffer: 1024 * 1024,
            });
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
          content: `Command execution results:\n${commandResults}\n\nContinue with the task. If all work is done, respond with [TASK_COMPLETE] and a summary. If you need help, respond with [NEED_HELP].`,
        });
      } else {
        // No commands found, ask the agent to continue
        messages.push({
          role: 'user',
          content: 'Please continue executing the task. Use bash commands wrapped in ```bash code blocks to perform actions. If the task is complete, respond with [TASK_COMPLETE] and a summary.',
        });
      }

      // Check budget again
      if (!checkBudget()) {
        addLog(taskId, 'error', 'Budget limit exceeded during execution.');
        moveTask(taskId, 'blocked');
        sendMessage(agentId, 'agent', 'Budget limit exceeded. I had to stop working.', taskId);
        break;
      }
    }

    if (iterations >= maxIterations) {
      addLog(taskId, 'warning', 'Maximum iterations reached.');
      moveTask(taskId, 'blocked');
      sendMessage(agentId, 'agent', `I've reached the maximum number of iterations (${maxIterations}) without completing the task. Please review my progress and provide guidance.`, taskId);
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
You can execute commands by wrapping them in \`\`\`bash code blocks. For example:
\`\`\`bash
ls -la
\`\`\`

You can also write files by specifying the path and content:
\`\`\`bash
cat > filename.js << 'EOF'
// file content here
EOF
\`\`\`

## Important Rules
1. Work step by step, explaining your approach.
2. Execute commands one at a time and review results.
3. When done, always include [TASK_COMPLETE] followed by a summary.
4. If you cannot proceed, include [NEED_HELP] followed by your question.
5. Always log your reasoning in your responses.
6. Do NOT invent or hallucinate command outputs - wait for real results.
7. ${project ? `Working directory: ${project.path}` : 'Use the current working directory.'}
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
    status,
    completedAt,
    taskId
  );

  const task = db.prepare(
    'SELECT t.*, a.name as agent_name, a.avatar as agent_avatar FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id WHERE t.id = ?'
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
    id,
    agent_id: agentId,
    sender,
    content,
    task_id: taskId || null,
    created_at: new Date().toISOString(),
  };

  if (io) {
    io.emit('chat:message', message);
    if (sender === 'agent') {
      io.emit('notification', { agentId, message: content.slice(0, 100) });
    }
  }
}

function logBudget(agentId, provider, model, inputTokens, outputTokens) {
  const cost = estimateCost(provider, model, inputTokens, outputTokens);
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
  if (fs.existsSync(memoryPath)) {
    existing = fs.readFileSync(memoryPath, 'utf8');
  }

  const newEntry = `\n## ${new Date().toISOString().split('T')[0]} - ${taskTitle}\n${summary}\n`;
  const updated = existing + newEntry;

  // Keep memory compact (under ~2000 tokens ≈ 8000 chars)
  if (updated.length > 8000) {
    const lines = updated.split('\n');
    // Keep header and last ~60% of entries
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
