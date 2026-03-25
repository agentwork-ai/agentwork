const { db, uuidv4, DATA_DIR, logAudit } = require('../db');
const { createCompletion, estimateCost, runClaudeAgent, runCodexAgent, createCodexClient } = require('./ai');
const { runBrowserTool } = require('./browser');
const { getPluginTools } = require('../plugins');
const { buildAgentContext, buildTaskSystemPrompt, buildChatSystemPrompt, buildFlowStepSystemPrompt, normalizeAgentType } = require('./agent-context');
const { parsePeriodicTaskRequest } = require('./cron-jobs');
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let io = null;
const activeExecutions = new Map();
const agentSessions = new Map(); // In-memory cache for Codex threads (non-serializable)

// Agent context warm-up cache
const agentContextCache = new Map();
const CONTEXT_CACHE_TTL = 60000; // 1 minute

function isCodexAgent(agent) {
  return agent?.provider === 'codex-cli'
    || agent?.provider === 'openai-codex'
    || (agent?.auth_type === 'cli' && agent?.provider === 'openai');
}

function usesCliRuntime(agent) {
  return Boolean(agent) && (
    agent.auth_type === 'cli'
    || agent.provider === 'claude-cli'
    || isCodexAgent(agent)
  );
}

function supportsApiReflection(agent) {
  return !usesCliRuntime(agent);
}

function getAgentContext(agentId) {
  const cached = agentContextCache.get(agentId);
  if (cached && Date.now() - cached.timestamp < CONTEXT_CACHE_TTL) return cached;
  const agentDir = path.join(DATA_DIR, 'agents', agentId);
  const ctx = {
    identity: readFileCached(path.join(agentDir, 'IDENTITY.md')),
    soul: readFileCached(path.join(agentDir, 'SOUL.md')),
    tools: readFileCached(path.join(agentDir, 'TOOLS.md')),
    userPrefs: readFileCached(path.join(agentDir, 'USER.md')),
    rules: readFileCached(path.join(agentDir, 'AGENTS.md')),
    heartbeat: readFileCached(path.join(agentDir, 'HEARTBEAT.md')),
    memory: readFileCached(path.join(agentDir, 'MEMORY.md')),
    timestamp: Date.now(),
  };
  agentContextCache.set(agentId, ctx);
  return ctx;
}

function readFileCached(filePath) {
  try { return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''; } catch { return ''; }
}

// ─── Git Automation Helpers ───

function getSetting(key) {
  return db.prepare("SELECT value FROM settings WHERE key = ?").get(key)?.value || '';
}

function resolveConfiguredWorkspaceDir() {
  const configured = String(getSetting('default_workspace') || '').trim();
  if (!configured) return '';

  const resolved = path.resolve(configured);
  try {
    fs.mkdirSync(resolved, { recursive: true });
  } catch {}
  return resolved;
}

function resolveChatWorkingDirectory() {
  return resolveConfiguredWorkspaceDir() || os.homedir() || process.cwd();
}

function resolveTaskWorkingDirectory(project) {
  return project?.path || resolveConfiguredWorkspaceDir() || process.cwd();
}

function isGitRepo(workDir) {
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd: workDir, stdio: 'pipe' });
    return true;
  } catch { return false; }
}

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function getMainBranch(workDir) {
  try {
    const branch = execSync('git symbolic-ref refs/remotes/origin/HEAD --short 2>/dev/null || echo origin/main', { cwd: workDir, encoding: 'utf8', shell: true }).trim().replace('origin/', '');
    return branch || 'main';
  } catch { return 'main'; }
}

/**
 * Initialize git repo if auto_git_init is enabled and directory is not a repo.
 */
function gitAutoInit(workDir, logFn, taskId) {
  if (getSetting('auto_git_init') !== 'true') return;
  if (isGitRepo(workDir)) return;

  try {
    execSync('git init', { cwd: workDir, stdio: 'pipe' });
    execSync('git add -A', { cwd: workDir, stdio: 'pipe' });
    execSync('git commit -m "Initial commit (auto-created by AgentWork)" --allow-empty', { cwd: workDir, stdio: 'pipe', shell: true });
    logFn(taskId, 'info', 'Git: auto-initialized repository');
  } catch (err) {
    logFn(taskId, 'warning', `Git auto-init failed: ${err.message}`);
  }
}

/**
 * Sync from main/master before creating a task branch.
 * Pulls latest changes and handles conflicts.
 */
function gitSyncFromMain(workDir, logFn, taskId) {
  if (getSetting('auto_git_sync') !== 'true') return;
  if (!isGitRepo(workDir)) return;

  try {
    const mainBranch = getMainBranch(workDir);

    // Stash any uncommitted changes
    const hasChanges = execSync('git status --porcelain', { cwd: workDir, encoding: 'utf8' }).trim();
    if (hasChanges) {
      execSync('git stash --include-untracked', { cwd: workDir, stdio: 'pipe' });
      logFn(taskId, 'info', 'Git: stashed local changes');
    }

    // Checkout main and pull latest
    try {
      execSync(`git checkout ${mainBranch}`, { cwd: workDir, stdio: 'pipe' });
      execSync('git pull --ff-only 2>/dev/null || git pull --rebase 2>/dev/null || true', { cwd: workDir, stdio: 'pipe', shell: true, timeout: 30000 });
      logFn(taskId, 'info', `Git: synced with ${mainBranch}`);
    } catch (err) {
      logFn(taskId, 'warning', `Git: could not sync from ${mainBranch}: ${err.message}`);
    }

    // Restore stashed changes
    if (hasChanges) {
      try {
        execSync('git stash pop', { cwd: workDir, stdio: 'pipe' });
        logFn(taskId, 'info', 'Git: restored stashed changes');
      } catch {
        // Conflict during stash pop — accept theirs for auto-resolve
        logFn(taskId, 'warning', 'Git: conflict restoring stash, attempting auto-resolve');
        try {
          execSync('git checkout --theirs . && git add -A && git stash drop', { cwd: workDir, stdio: 'pipe', shell: true });
          logFn(taskId, 'info', 'Git: auto-resolved conflicts (accepted incoming changes)');
        } catch {
          execSync('git stash drop 2>/dev/null || true', { cwd: workDir, stdio: 'pipe', shell: true });
          logFn(taskId, 'warning', 'Git: could not auto-resolve, proceeding with clean state');
        }
      }
    }
  } catch (err) {
    logFn(taskId, 'warning', `Git sync failed: ${err.message}`);
  }
}

/**
 * Create a feature branch for the task.
 */
function gitCreateBranch(workDir, taskId, taskTitle, logFn) {
  if (getSetting('auto_git_branch') !== 'true') return null;

  // Auto-init if needed
  gitAutoInit(workDir, logFn, taskId);
  if (!isGitRepo(workDir)) return null;

  // Sync from main first
  gitSyncFromMain(workDir, logFn, taskId);

  try {
    const branchName = `agentwork/${slugify(taskTitle)}-${taskId.slice(0, 8)}`;
    execSync(`git checkout -b "${branchName}"`, { cwd: workDir, stdio: 'pipe' });
    logFn(taskId, 'info', `Git: created branch ${branchName}`);
    return branchName;
  } catch (err) {
    logFn(taskId, 'warning', `Git branch creation failed: ${err.message}`);
    return null;
  }
}

/**
 * After task completion: commit, push, create PR, merge if auto-merge enabled.
 */
function gitCommitAndPR(workDir, taskId, taskTitle, branchName, logFn) {
  if (getSetting('auto_git_branch') !== 'true' || !branchName) return;
  if (!isGitRepo(workDir)) return;

  try {
    // Check if there are changes to commit
    const status = execSync('git status --porcelain', { cwd: workDir, encoding: 'utf8' }).trim();
    if (!status) {
      logFn(taskId, 'info', 'Git: no changes to commit');
      // Still switch back to main
      try { execSync('git checkout -', { cwd: workDir, stdio: 'pipe' }); } catch {}
      return;
    }

    // Stage and commit all changes
    execSync('git add -A', { cwd: workDir, stdio: 'pipe' });
    const commitMsg = `feat: ${taskTitle}\n\nCompleted by AgentWork task ${taskId}`;
    execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, { cwd: workDir, stdio: 'pipe' });
    logFn(taskId, 'info', `Git: committed changes on ${branchName}`);

    // Try to push and create PR
    let prMerged = false;
    try {
      execSync(`git push -u origin "${branchName}"`, { cwd: workDir, stdio: 'pipe', timeout: 30000 });
      logFn(taskId, 'info', `Git: pushed branch ${branchName}`);

      // Try to create and merge PR via gh CLI
      try {
        const mainBranch = getMainBranch(workDir);
        const prUrl = execSync(
          `gh pr create --title "${taskTitle.replace(/"/g, '\\"')}" --body "Automated PR from AgentWork task \`${taskId}\`" --head "${branchName}" --base "${mainBranch}" 2>&1`,
          { cwd: workDir, encoding: 'utf8', timeout: 15000 }
        ).trim();
        logFn(taskId, 'success', `Git: PR created — ${prUrl}`);

        // Auto-merge PR
        if (getSetting('auto_git_merge') === 'true') {
          try {
            execSync(`gh pr merge "${branchName}" --squash --delete-branch 2>&1`, { cwd: workDir, encoding: 'utf8', timeout: 15000 });
            logFn(taskId, 'success', 'Git: PR auto-merged and branch deleted');
            prMerged = true;
          } catch {
            logFn(taskId, 'info', 'Git: PR created but could not auto-merge via gh, will merge locally');
          }
        }
      } catch {
        logFn(taskId, 'info', 'Git: pushed but gh CLI unavailable, will merge locally');
      }
    } catch {
      logFn(taskId, 'info', 'Git: no remote configured, will merge locally');
    }

    // Always merge locally if PR wasn't merged remotely
    if (!prMerged) {
      const mainBranch = getMainBranch(workDir);
      try {
        execSync(`git checkout ${mainBranch}`, { cwd: workDir, stdio: 'pipe' });
        execSync(`git merge "${branchName}" --no-edit`, { cwd: workDir, stdio: 'pipe' });
        execSync(`git branch -d "${branchName}"`, { cwd: workDir, stdio: 'pipe' });
        logFn(taskId, 'info', `Git: merged ${branchName} into ${mainBranch}`);
      } catch {
        logFn(taskId, 'warning', 'Git: merge conflict, auto-resolving');
        try {
          execSync('git add -A && git commit --no-edit', { cwd: workDir, stdio: 'pipe', shell: true });
          execSync(`git branch -D "${branchName}" 2>/dev/null || true`, { cwd: workDir, stdio: 'pipe', shell: true });
          logFn(taskId, 'info', 'Git: conflict auto-resolved');
        } catch {
          logFn(taskId, 'warning', 'Git: could not auto-resolve merge conflict');
        }
      }
    } else {
      // PR was merged remotely — just checkout main and pull
      try {
        const mainBranch = getMainBranch(workDir);
        execSync(`git checkout ${mainBranch}`, { cwd: workDir, stdio: 'pipe' });
        execSync('git pull 2>/dev/null || true', { cwd: workDir, stdio: 'pipe', shell: true });
      } catch {}
    }
  } catch (err) {
    logFn(taskId, 'warning', `Git commit failed: ${err.message}`);
    try { execSync('git checkout - 2>/dev/null || true', { cwd: workDir, stdio: 'pipe', shell: true }); } catch {}
  }
}

/**
 * Generate a summary of what changed for the PR/commit message.
 */
function gitDiffSummary(workDir) {
  try {
    const stat = execSync('git diff --stat HEAD~1', { cwd: workDir, encoding: 'utf8', timeout: 5000 });
    return stat.trim().split('\n').slice(-1)[0] || ''; // last line has summary
  } catch { return ''; }
}

// DB-backed session persistence for Claude CLI sessions
function getPersistedSession(agentId) {
  const row = db.prepare('SELECT session_id, provider FROM agent_sessions WHERE agent_id = ?').get(agentId);
  return row || {};
}
function persistSession(agentId, sessionId, provider) {
  db.prepare(
    'INSERT INTO agent_sessions (agent_id, session_id, provider, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(agent_id) DO UPDATE SET session_id = ?, provider = ?, updated_at = CURRENT_TIMESTAMP'
  ).run(agentId, sessionId, provider, sessionId, provider);
}

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

function createRecurringTaskFromChat(agent, userMessage) {
  const parsed = parsePeriodicTaskRequest(userMessage);
  if (!parsed) return null;

  const id = uuidv4();
  db.prepare(
    `INSERT INTO tasks (
      id, title, description, status, priority, agent_id, project_id,
      trigger_type, trigger_at, trigger_cron, task_type, flow_items, tags, depends_on
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    parsed.title,
    `Recurring automation created from chat.\n\nInstructions:\n${parsed.action_text}\n\nOriginal request:\n${String(userMessage || '').trim()}`,
    'todo',
    'medium',
    agent.id,
    null,
    'cron',
    null,
    parsed.trigger_cron,
    'single',
    '[]',
    'cron,automation',
    '[]',
  );

  const task = db.prepare(
    'SELECT t.*, a.name as agent_name, a.avatar as agent_avatar, p.name as project_name FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id LEFT JOIN projects p ON t.project_id = p.id WHERE t.id = ?'
  ).get(id);

  if (!task) return null;

  task.execution_logs = JSON.parse(task.execution_logs || '[]');
  task.attachments = JSON.parse(task.attachments || '[]');
  task.flow_items = JSON.parse(task.flow_items || '[]');
  task.depends_on = JSON.parse(task.depends_on || '[]');

  try {
    require('./scheduler').scheduleTask(task);
  } catch (err) {
    console.error(`[Cron] Failed to schedule recurring task ${task.id}:`, err.message);
  }

  logAudit('create', 'cron_job', task.id, {
    title: task.title,
    agent_id: agent.id,
    trigger_cron: parsed.trigger_cron,
  });

  if (io) io.emit('task:created', task);

  const timezoneLabel = Intl.DateTimeFormat().resolvedOptions().timeZone || 'server local time';
  const details = [
    `I set up a recurring job for myself: "${task.title}".`,
    `Schedule: ${parsed.schedule_label}.`,
    `Cron: \`${parsed.trigger_cron}\`.`,
  ];
  if (parsed.defaulted_time) {
    details.push(`No time was specified, so I used ${parsed.schedule_label.replace(/^Every (?:day|weekday|[A-Za-z]+) at /, '')} in ${timezoneLabel}.`);
  } else {
    details.push(`Timing uses ${timezoneLabel}.`);
  }
  details.push(`You can manage or delete it from the task board.`);

  return {
    task,
    confirmation: details.join('\n'),
  };
}

function getChatToolsForAgent(agent) {
  return getToolsForAgent(agent).filter((tool) => !['task_complete', 'request_help'].includes(tool.name));
}

function buildChatToolsPrompt(toolDefs) {
  if (!Array.isArray(toolDefs) || toolDefs.length === 0) return '';
  const hasBrowser = toolDefs.some((tool) => tool.name === 'browser');

  const lines = [
    '## Chat Tools',
    'You may use tools during chat when the user needs real browser actions, filesystem work, or command execution.',
    'After using tools, reply naturally to the user with the result.',
    'When the user asks about a website or web app, use the browser tool instead of run_bash with curl/wget.',
    ...toolDefs.map((tool) => `- **${tool.name}**: ${tool.description}`),
  ];

  if (hasBrowser) {
    lines.push('- For websites, prefer `browser snapshot` before `browser act` so you can act on stable refs.');
  }

  return lines.join('\n');
}

async function handleDirectChat(agentId, content, platformChatId) {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  if (!agent) {
    sendMessage(agentId, 'agent', 'Error: Agent not found.', null, platformChatId);
    return;
  }

  console.log(`[Chat] Direct message to ${agent.name} (${agent.auth_type}/${agent.provider}): "${content.slice(0, 80)}"`);

  try {
    const recurringTask = createRecurringTaskFromChat(agent, content);
    if (recurringTask) {
      sendMessage(agentId, 'agent', recurringTask.confirmation, null, platformChatId);
      reflectAfterChat(agent, path.join(DATA_DIR, 'agents', agentId), content, recurringTask.confirmation);
      return;
    }

    if (usesCliRuntime(agent)) {
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
  const chatWorkDir = resolveChatWorkingDirectory();
  const agentContext = buildAgentContext(agentId, agent, { includeMemory: true, includeHeartbeat: false });
  const prompt = `${buildChatSystemPrompt(agent, agentContext)}\n\n## Latest User Message\n${userMessage}`;
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
      const session = getPersistedSession(agentId);
      const result = await chatWithClaudeAgent(prompt, session.session_id, chatWorkDir);
      persistSession(agentId, result.sessionId, 'anthropic');
      responseContent = result.content;
      if (!responseContent?.trim()) {
        throw new Error('Claude completed without returning a response.');
      }
    } else if (isCodexAgent(agent)) {
      let Codex, chatWithCodexAgent;
      try {
        ({ chatWithCodexAgent } = require('./ai'));
        ({ Codex } = await import('@openai/codex-sdk'));
      } catch (importErr) {
        throw new Error(`Failed to load Codex SDK: ${importErr.message}.`);
      }
      let session = agentSessions.get(agentId);
      if (!session?.thread) {
        const client = createCodexClient(Codex);
        const thread = client.startThread({ workingDirectory: chatWorkDir, approvalPolicy: 'never', sandboxMode: 'danger-full-access' });
        session = { thread };
        agentSessions.set(agentId, session);
      }
      const result = await chatWithCodexAgent(prompt, session.thread);
      responseContent = result.content;
      if (!responseContent?.trim()) {
        throw new Error('Codex completed without returning a response.');
      }
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
  const chatWorkDir = resolveChatWorkingDirectory();
  db.prepare("UPDATE agents SET status = 'thinking', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(agentId);
  io.emit('agent:status_changed', { agentId, status: 'thinking' });

  try {
    const agentContext = buildAgentContext(agentId, agent, { includeMemory: true, includeHeartbeat: false });
    const chatTools = getChatToolsForAgent(agent);

    const recentMsgs = db.prepare('SELECT * FROM messages WHERE agent_id = ? ORDER BY created_at DESC LIMIT 20').all(agentId).reverse();
    const messages = [
      {
        role: 'system',
        content: [
          buildChatSystemPrompt(agent, agentContext),
          buildChatToolsPrompt(chatTools),
        ].filter(Boolean).join('\n\n'),
      },
      ...recentMsgs.map((m) => ({ role: m.sender === 'user' ? 'user' : 'assistant', content: m.content })),
      { role: 'user', content: userMessage },
    ];

    const maxIterations = Math.min(
      parseInt(db.prepare("SELECT value FROM settings WHERE key = 'max_iterations'").get()?.value || '30', 10),
      8
    );
    let reply = '';

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      const response = await createCompletion(agent.provider, agent.model, messages, {
        ...(chatTools.length > 0 ? { tools: chatTools } : {}),
        fallbackModel: agent.fallback_model,
      });

      logBudget(agentId, agent.provider, response.model || agent.model, response.inputTokens, response.outputTokens);

      const toolCalls = response.toolCalls || [];
      if (toolCalls.length === 0) {
        reply = response.content || '';
        break;
      }

      if (response.rawAssistantMsg) messages.push(response.rawAssistantMsg);
      else messages.push({ role: 'assistant', content: response.content || '' });

      const toolResults = [];
      for (const toolCall of toolCalls) {
        const result = await executeTool(toolCall.name, toolCall.input, chatWorkDir, null, agentId);
        toolResults.push({ id: toolCall.id, result });
      }
      appendToolResults(messages, toolResults, agent.provider);
    }

    if (!reply.trim()) {
      throw new Error('Agent completed without returning a chat reply.');
    }

    sendMessage(agentId, 'agent', reply, null, platformChatId);

    // Fire-and-forget memory reflection
    reflectAfterChat(agent, agentDir, userMessage, reply);
  } catch (err) {
    console.error(`[Chat API] Error for agent ${agent.name}:`, err);
    sendMessage(agentId, 'agent', `⚠ Error: ${err.message}`, null, platformChatId);
  } finally {
    db.prepare("UPDATE agents SET status = 'idle', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(agentId);
    io.emit('agent:status_changed', { agentId, status: 'idle' });
  }
}

// ─── Execution Queue with Concurrency Limits ───

const executionQueue = [];
let runningCount = 0;

function getMaxConcurrent() {
  return parseInt(db.prepare("SELECT value FROM settings WHERE key = 'max_concurrent_executions'").get()?.value || '3', 10);
}

function processQueue() {
  const max = getMaxConcurrent();
  while (executionQueue.length > 0 && runningCount < max) {
    const next = executionQueue.shift();
    runningCount++;
    _executeTask(next.taskId, next.agentId).finally(() => {
      runningCount--;
      processQueue();
    });
  }
}

async function executeTask(taskId, agentId) {
  if (activeExecutions.has(taskId)) return;
  const max = getMaxConcurrent();
  if (runningCount >= max) {
    console.log(`[Executor] Queue full (${runningCount}/${max}), queuing task ${taskId}`);
    executionQueue.push({ taskId, agentId });
    return;
  }
  runningCount++;
  try {
    await _executeTask(taskId, agentId);
  } finally {
    runningCount--;
    processQueue();
  }
}

// ─── Task Execution ───

async function _executeTask(taskId, agentId) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) return;

  const isFlow = (task.task_type || 'single') === 'flow';
  const agent = agentId ? db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) : null;
  const project = task.project_id ? db.prepare('SELECT * FROM projects WHERE id = ?').get(task.project_id) : null;

  if (!isFlow && !agent) return;

  const execState = { waitingForUser: false, userReply: null, aborted: false };
  activeExecutions.set(taskId, execState);

  // Task timeout
  const timeoutMinutes = parseInt(db.prepare("SELECT value FROM settings WHERE key = 'task_timeout_minutes'").get()?.value || '0', 10);
  let timeoutTimer = null;
  if (timeoutMinutes > 0) {
    timeoutTimer = setTimeout(() => {
      execState.aborted = true;
      if (execState.abortController) execState.abortController.abort();
      addLog(taskId, 'error', `Task timed out after ${timeoutMinutes} minute(s).`);
      moveTask(taskId, 'blocked');
      sendMessage(agentId || 'system', 'agent', `Task timed out after ${timeoutMinutes} minute(s).`, taskId);
    }, timeoutMinutes * 60 * 1000);
  }

  if (!isFlow) {
    db.prepare("UPDATE agents SET status = 'working', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(agentId);
    io.emit('agent:status_changed', { agentId, status: 'working' });
    addLog(taskId, 'info', `Agent ${agent.name} started working on: ${task.title}`);
  } else {
    addLog(taskId, 'info', `Flow task started: ${task.title}`);
  }

  let gitBranch = null;

  try {
    const workDir = resolveTaskWorkingDirectory(project);

    if (!isFlow && !fs.existsSync(workDir)) {
      addLog(taskId, 'info', `Creating working directory: ${workDir}`);
      fs.mkdirSync(workDir, { recursive: true });
    }

    // Auto-create git branch before execution
    if (!isFlow) {
      gitBranch = gitCreateBranch(workDir, taskId, task.title, addLog);
    }

    if (isFlow) {
      await executeFlowTask(taskId, agentId, task, project, execState);
    } else if (usesCliRuntime(agent)) {
      await executeTaskCli(taskId, agentId, agent, task, project, workDir, execState);
    } else {
      await executeTaskApi(taskId, agentId, agent, task, project, workDir, execState);
    }
  } catch (err) {
    addLog(taskId, 'error', `Execution error: ${err.message}`);
    moveTask(taskId, 'blocked');
    sendMessage(agentId || 'system', 'agent', `An unexpected error occurred: ${err.message}`, taskId);
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer);

    // Auto-commit, push, and create PR after task completion
    const finalTask = db.prepare('SELECT status FROM tasks WHERE id = ?').get(taskId);
    if (finalTask?.status === 'done' && gitBranch && project?.path) {
      gitCommitAndPR(project.path, taskId, task.title, gitBranch, addLog);
    }

    activeExecutions.delete(taskId);
    if (!isFlow && agent) {
      db.prepare("UPDATE agents SET status = 'idle', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(agentId);
      io.emit('agent:status_changed', { agentId, status: 'idle' });
    }
    io.emit('system:status_update');

    // Auto-queue next task for this agent
    if (finalTask?.status === 'done' && agentId) {
      autoQueueNextTask(agentId);
    }
  }
}

// ─── Flow Task Execution ───

async function executeFlowTask(taskId, mainAgentId, task, project, execState) {
  const workDir = resolveTaskWorkingDirectory(project);

  let flowItems = JSON.parse(task.flow_items || '[]');
  if (flowItems.length === 0) {
    addLog(taskId, 'warning', 'Flow task has no steps configured.');
    moveTask(taskId, 'done', 'No flow steps to execute.');
    return;
  }

  // If all items are already done (re-triggered cron), reset them
  if (flowItems.every((i) => i.status === 'done')) {
    flowItems = flowItems.map((i) => ({ ...i, status: 'pending', output: '' }));
    updateFlowItems(taskId, flowItems);
  }

  addLog(taskId, 'info', `Starting flow with ${flowItems.length} step(s)`);

  while (!execState.aborted) {
    const currentTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (!currentTask || currentTask.status === 'blocked') break;

    flowItems = JSON.parse(currentTask.flow_items || '[]');

    // Collect consecutive pending parallel steps
    const pendingIdx = flowItems.findIndex((i) => i.status === 'pending');
    if (pendingIdx === -1) break;

    const parallelGroup = [pendingIdx];
    for (let i = pendingIdx + 1; i < flowItems.length; i++) {
      if (flowItems[i].status === 'pending' && flowItems[i].parallel) parallelGroup.push(i);
      else break;
    }

    // Execute parallel steps concurrently
    if (parallelGroup.length > 1) {
      addLog(taskId, 'info', `Running ${parallelGroup.length} parallel steps: ${parallelGroup.map((i) => flowItems[i].title).join(', ')}`);
      const parallelResults = await Promise.allSettled(
        parallelGroup.map((idx) => executeFlowStepWrapper(taskId, mainAgentId, task, project, execState, flowItems, idx))
      );
      let anyFailed = false;
      for (let pi = 0; pi < parallelGroup.length; pi++) {
        const idx = parallelGroup[pi];
        const result = parallelResults[pi];
        flowItems = JSON.parse(db.prepare('SELECT flow_items FROM tasks WHERE id = ?').get(taskId)?.flow_items || '[]');
        if (result.status === 'rejected') {
          flowItems[idx] = { ...flowItems[idx], status: 'failed' };
          anyFailed = true;
        } else {
          flowItems[idx] = { ...flowItems[idx], status: 'done', output: result.value || '' };
        }
        updateFlowItems(taskId, flowItems);
      }
      if (anyFailed) { moveTask(taskId, 'blocked'); return; }
      continue;
    }

    const currentIdx = pendingIdx;
    const currentItem = flowItems[currentIdx];
    const agentId = currentItem.agent_id || mainAgentId;
    if (!agentId) {
      addLog(taskId, 'error', `Step ${currentIdx + 1}: No agent assigned`);
      moveTask(taskId, 'blocked');
      return;
    }

    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
    if (!agent) {
      addLog(taskId, 'error', `Step ${currentIdx + 1}: Agent not found`);
      moveTask(taskId, 'blocked');
      return;
    }

    // Mark step as doing
    flowItems[currentIdx] = { ...currentItem, status: 'doing' };
    updateFlowItems(taskId, flowItems);
    addLog(taskId, 'info', `▶ Step ${currentIdx + 1}/${flowItems.length}: "${currentItem.title}" (${agent.name})`);

    // Build context from completed steps
    const previousContext = flowItems
      .slice(0, currentIdx)
      .filter((i) => i.status === 'done' && i.output)
      .map((i, idx) => `=== Step ${idx + 1}: ${i.title} ===\n${i.output}`)
      .join('\n\n');

    db.prepare("UPDATE agents SET status = 'working', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(agentId);
    io.emit('agent:status_changed', { agentId, status: 'working' });

    let stepOutput = '';
    let stepFailed = false;

    try {
      if (usesCliRuntime(agent)) {
        stepOutput = await executeFlowStepCli(taskId, agentId, agent, task, currentItem, previousContext, workDir, execState, currentIdx, flowItems.length);
      } else {
        stepOutput = await executeFlowStepApi(taskId, agentId, agent, task, currentItem, previousContext, project, workDir, execState, currentIdx, flowItems.length);
      }
    } catch (err) {
      addLog(taskId, 'error', `Step ${currentIdx + 1} failed: ${err.message}`);
      // Re-read latest flowItems before marking failed
      const latest = JSON.parse(db.prepare('SELECT flow_items FROM tasks WHERE id = ?').get(taskId)?.flow_items || '[]');
      latest[currentIdx] = { ...currentItem, status: 'failed' };
      updateFlowItems(taskId, latest);
      stepFailed = true;
    } finally {
      db.prepare("UPDATE agents SET status = 'idle', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(agentId);
      io.emit('agent:status_changed', { agentId, status: 'idle' });
    }

    if (stepFailed) {
      moveTask(taskId, 'blocked');
      sendMessage(agentId, 'agent', `Flow step ${currentIdx + 1} failed. Task blocked for review.`, taskId);
      return;
    }

    // Mark step done
    const latestItems = JSON.parse(db.prepare('SELECT flow_items FROM tasks WHERE id = ?').get(taskId)?.flow_items || '[]');
    latestItems[currentIdx] = { ...currentItem, status: 'done', output: stepOutput };
    updateFlowItems(taskId, latestItems);
    addLog(taskId, 'success', `Step ${currentIdx + 1} completed.`);
    flowItems = latestItems;
  }

  if (execState.aborted) return;

  // Check if all steps completed
  const finalTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!finalTask || finalTask.status === 'blocked') return;

  const finalItems = JSON.parse(finalTask.flow_items || '[]');
  const allDone = finalItems.length > 0 && finalItems.every((i) => i.status === 'done');

  if (allDone) {
    const summaryLines = finalItems.map((item, i) => `Step ${i + 1}: ${item.title}\n${item.output || '(no output)'}`);
    const completionMsg = `Flow task completed: ${task.title}\n\n${summaryLines.join('\n\n')}`;
    const doneStatus = task.trigger_type === 'cron' ? 'todo' : 'done';
    moveTask(taskId, doneStatus, completionMsg);

    const notifyAgentId = mainAgentId || finalItems[finalItems.length - 1]?.agent_id;
    if (notifyAgentId) sendMessage(notifyAgentId, 'agent', completionMsg, taskId);

    // For cron: reset steps for next run
    if (task.trigger_type === 'cron') {
      updateFlowItems(taskId, finalItems.map((i) => ({ ...i, status: 'pending', output: '' })));
    }

    try { require('./scheduler').onTaskCompleted(task); } catch {}
  }
}

async function executeFlowStepApi(taskId, agentId, agent, task, flowItem, previousContext, project, workDir, execState, stepIdx, totalSteps) {
  // Flow steps use subagent context — skip MEMORY.md for token efficiency
  const agentContext = buildAgentContext(agentId, agent, { includeMemory: false, includeHeartbeat: false });

  let projectDoc = '';
  if (project?.path) {
    const docPath = path.join(project.path, 'PROJECT.md');
    if (fs.existsSync(docPath)) projectDoc = fs.readFileSync(docPath, 'utf8');
  }

  if (!checkBudget()) throw new Error('Budget limit exceeded');

  addLog(taskId, 'info', `Step ${stepIdx + 1} API mode: ${agent.provider} / ${agent.model}`);

  // Build custom tools section for the system prompt
  const flowCustomToolDefs = getCustomToolDefinitions();
  const flowCustomToolsPrompt = flowCustomToolDefs.length > 0
    ? '\n' + flowCustomToolDefs.map((t) => `- **${t.name}**: ${t.description}`).join('\n')
    : '';

  const systemPrompt = buildFlowStepSystemPrompt(agent, agentContext, { projectDoc, customToolsPrompt: flowCustomToolsPrompt, workDir, stepIdx, totalSteps });

  const userContent = `You are working on step ${stepIdx + 1} of ${totalSteps} in a multi-step flow task.

## Overall Task
Title: ${task.title}
${task.description ? `Description: ${task.description}` : ''}

## Your Step (${stepIdx + 1}/${totalSteps})
${flowItem.title}

${previousContext ? `## Output from Previous Steps\n${previousContext}\n` : ''}Working directory: ${workDir}

Complete your step using the tools. When done, call task_complete with a summary of what you accomplished.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];

  let iterations = 0;
  const maxIterations = parseInt(db.prepare("SELECT value FROM settings WHERE key = 'max_iterations'").get()?.value || '30', 10);
  let stepOutput = '';

  while (iterations < maxIterations && !execState.aborted) {
    iterations++;
    addLog(taskId, 'thinking', `Step ${stepIdx + 1} · Iteration ${iterations}...`);
    io.emit('agent:status_changed', { agentId, status: 'thinking' });

    let response;
    try {
      response = await createCompletion(agent.provider, agent.model, messages, { tools: getToolsForAgent(agent) });
    } catch (err) {
      addLog(taskId, 'error', `AI Error: ${err.message}`);
      throw err;
    }

    logBudget(agentId, agent.provider, agent.model, response.inputTokens, response.outputTokens);
    if (response.content) addLog(taskId, 'response', response.content);

    const toolCalls = response.toolCalls || [];

    if (toolCalls.length > 0) {
      if (response.rawAssistantMsg) messages.push(response.rawAssistantMsg);
      else messages.push({ role: 'assistant', content: response.content || '' });

      let stepDone = false;
      const toolResults = [];

      for (const tc of toolCalls) {
        if (tc.name === 'task_complete') {
          stepDone = true;
          stepOutput = tc.input.summary || `Step ${stepIdx + 1} completed.`;
          toolResults.push({ id: tc.id, result: 'Step marked as complete.' });
          break;
        }
        if (tc.name === 'request_help') {
          const reason = tc.input.reason || 'Agent needs help.';
          addLog(taskId, 'blocked', `Step ${stepIdx + 1} blocked: ${reason}`);
          throw new Error(`Step blocked: ${reason}`);
        }
        const result = await executeTool(tc.name, tc.input, workDir, taskId, agentId);
        toolResults.push({ id: tc.id, result });
      }

      if (stepDone) {
        addLog(taskId, 'success', `Step ${stepIdx + 1}: ${stepOutput.slice(0, 100)}`);
        break;
      }

      appendToolResults(messages, toolResults, agent.provider);
    } else {
      messages.push({ role: 'assistant', content: response.content || '' });
      if (response.content?.includes('[TASK_COMPLETE]')) {
        stepOutput = extractSummary(response.content);
        break;
      }
      messages.push({ role: 'user', content: 'Use the provided tools to complete your step. When done, call task_complete.' });
    }

    if (!checkBudget()) throw new Error('Budget limit exceeded');
  }

  return stepOutput || `Step ${stepIdx + 1}: ${flowItem.title} — completed`;
}

async function executeFlowStepCli(taskId, agentId, agent, task, flowItem, previousContext, workDir, execState, stepIdx, totalSteps) {
  const agentContext = buildAgentContext(agentId, agent, { includeMemory: false, includeHeartbeat: false });
  const isCodex = isCodexAgent(agent);

  if (isCodex) ensureGitRepo(workDir, taskId);

  const prompt = `You are ${agent.name}, a ${agent.role}.
${agentContext}

## Overall Task
Title: ${task.title}
${task.description ? `Description: ${task.description}` : ''}

## Your Step (${stepIdx + 1}/${totalSteps})
${flowItem.title}

${previousContext ? `## Output from Previous Steps\n${previousContext}\n` : ''}Working directory: ${workDir}

Complete your step autonomously.`;

  const abortController = new AbortController();
  execState.abortController = abortController;

  let stepOutput = '';
  const onEvent = (event) => {
    if (execState.aborted) return;
    switch (event.type) {
      case 'text': addLog(taskId, 'response', event.content); stepOutput = event.content; break;
      case 'command': io.emit('agent:status_changed', { agentId, status: 'executing' }); addLog(taskId, 'command', event.content); break;
      case 'output': addLog(taskId, 'output', event.content); break;
      case 'file_change': addLog(taskId, 'info', `File: ${event.content}`); break;
      case 'thinking': io.emit('agent:status_changed', { agentId, status: 'thinking' }); addLog(taskId, 'thinking', event.content.slice(0, 500)); break;
      case 'done': addLog(taskId, 'success', `Step ${stepIdx + 1} finished.`); break;
      default: break;
    }
  };

  if (isCodex) {
    const { Codex } = await import('@openai/codex-sdk');
    const client = createCodexClient(Codex);
    const thread = client.startThread({ workingDirectory: workDir, approvalPolicy: 'never', sandboxMode: 'danger-full-access' });
    const streamedTurn = await thread.runStreamed(prompt, { signal: abortController.signal });
    for await (const event of streamedTurn.events) {
      if (event.type === 'item.completed') {
        const item = event.item;
        if (item.type === 'agent_message') onEvent({ type: 'text', content: item.text || '' });
        else if (item.type === 'command_execution') { onEvent({ type: 'command', content: `$ ${item.command || ''}` }); if (item.output) onEvent({ type: 'output', content: item.output.slice(0, 2000) }); }
        else if (item.type === 'reasoning') onEvent({ type: 'thinking', content: item.text || '' });
        else if (item.type === 'error') onEvent({ type: 'error', content: item.message || 'Codex agent failed' });
      } else if (event.type === 'error') {
        onEvent({ type: 'error', content: event.message || 'Codex agent failed' });
      } else if (event.type === 'turn.failed') {
        onEvent({ type: 'error', content: event.error?.message || 'Codex agent failed' });
      } else if (event.type === 'turn.completed') {
        onEvent({ type: 'done', content: '' });
      }
    }
  } else {
    const result = await runClaudeAgent(prompt, workDir, onEvent, abortController);
    if (result.costUsd) logBudget(agentId, agent.provider, agent.model || 'claude-cli', 0, 0, result.costUsd);
  }

  return stepOutput || `Step ${stepIdx + 1}: ${flowItem.title} — completed`;
}

async function executeFlowStepWrapper(taskId, mainAgentId, task, project, execState, flowItems, stepIdx) {
  const item = flowItems[stepIdx];
  const agentId = item.agent_id || mainAgentId;
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  if (!agent) throw new Error(`Agent not found for step ${stepIdx + 1}`);
  const workDir = resolveTaskWorkingDirectory(project);
  const previousContext = flowItems.slice(0, stepIdx).filter((i) => i.status === 'done' && i.output).map((i, idx) => `Step ${idx + 1}: ${i.output}`).join('\n');

  db.prepare("UPDATE agents SET status = 'working', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(agentId);
  io.emit('agent:status_changed', { agentId, status: 'working' });
  try {
    if (usesCliRuntime(agent)) {
      return await executeFlowStepCli(taskId, agentId, agent, task, item, previousContext, workDir, execState, stepIdx, flowItems.length);
    } else {
      return await executeFlowStepApi(taskId, agentId, agent, task, item, previousContext, project, workDir, execState, stepIdx, flowItems.length);
    }
  } finally {
    db.prepare("UPDATE agents SET status = 'idle', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(agentId);
    io.emit('agent:status_changed', { agentId, status: 'idle' });
  }
}

function updateFlowItems(taskId, flowItems) {
  db.prepare('UPDATE tasks SET flow_items = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(JSON.stringify(flowItems), taskId);
  const task = db.prepare(
    'SELECT t.*, a.name as agent_name, a.avatar as agent_avatar, p.name as project_name FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id LEFT JOIN projects p ON t.project_id = p.id WHERE t.id = ?'
  ).get(taskId);
  if (task) {
    task.execution_logs = JSON.parse(task.execution_logs || '[]');
    task.attachments = JSON.parse(task.attachments || '[]');
    task.flow_items = JSON.parse(task.flow_items || '[]');
    if (io) io.emit('task:updated', task);
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

async function executeTaskCli(taskId, agentId, agent, task, project, workDir, execState) {
  const agentDir = path.join(DATA_DIR, 'agents', agentId);
  const isRecurring = task.trigger_type === 'cron';
  const agentContext = buildAgentContext(agentId, agent, {
    includeMemory: !isRecurring,
    includeHeartbeat: isRecurring,
  });

  const isCodex = isCodexAgent(agent);
  const sdkName = isCodex ? 'Codex' : 'Claude';

  addLog(taskId, 'info', `Using ${sdkName} Agent SDK (CLI mode)`);
  addLog(taskId, 'info', `Provider: ${agent.provider} | Working dir: ${workDir}`);

  // Codex requires a git repo
  if (isCodex) {
    ensureGitRepo(workDir, taskId);
  }

  let projectDoc = '';
  if (project?.path) {
    const projDocPath = path.join(project.path, 'PROJECT.md');
    if (fs.existsSync(projDocPath)) projectDoc = fs.readFileSync(projDocPath, 'utf8');
  }

  const prompt = `You are ${agent.name}, a ${agent.role}.

${agentContext}

${projectDoc ? `## Project Documentation\n${projectDoc}\n\n` : ''}## Task
Title: ${task.title}
Description: ${task.description || 'No description provided.'}

Working directory: ${workDir}

${isRecurring ? 'This is a recurring scheduled run. Treat HEARTBEAT.md as the live checklist and ignore stale work if that file is empty.\n\n' : ''}Please complete this task autonomously. Analyze the codebase, plan your approach, make the necessary changes, and verify they work.`;

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
        persistSession(agentId, event.sessionId, 'anthropic');
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
        client = createCodexClient(Codex);
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
          } else if (event.type === 'error') {
            const errMsg = event.message || 'Codex stream error';
            addLog(taskId, 'error', `Stream error event: ${errMsg}`);
            onEvent({ type: 'error', content: errMsg });
            throw new Error(errMsg);
          } else if (event.type === 'turn.failed') {
            const errMsg = event.error?.message || JSON.stringify(event.error) || 'Turn failure';
            addLog(taskId, 'error', `Turn failed: ${errMsg}`);
            onEvent({ type: 'error', content: errMsg });
            throw new Error(errMsg);
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
    const cliDoneStatus = task.trigger_type === 'cron' ? 'todo' : 'done';
    moveTask(taskId, cliDoneStatus, cliCompletionMsg);
    sendMessage(agentId, 'agent', cliCompletionMsg, taskId);
    reflectAfterTask(agent, agentDir, task.title, 'Completed via CLI agent.', project);
    try { require('./scheduler').onTaskCompleted(task); } catch {}
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
    name: 'read_image',
    description: 'Read an image file and analyze its contents. Supports PNG, JPG, GIF, WebP.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Path to the image file relative to working directory' } },
      required: ['path'],
    },
  },
  {
    name: 'browser',
    description: 'Control a managed browser session. Supports status/start/stop/tabs/open/focus/close/navigate/snapshot/screenshot/act/wait. Use snapshot first, then act on the returned refs.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'start', 'stop', 'tabs', 'open', 'focus', 'close', 'navigate', 'snapshot', 'screenshot', 'act', 'wait'],
          description: 'Browser operation to perform',
        },
        profile: { type: 'string', description: 'Optional persistent browser profile name. Defaults to a profile derived from the current agent.' },
        headless: { type: 'boolean', description: 'Optional override for start; defaults to headless unless AGENTWORK_BROWSER_HEADLESS=false.' },
        url: { type: 'string', description: 'URL for open or navigate, or URL pattern for wait.' },
        tabId: { type: 'string', description: 'Specific tab id returned by status or tabs.' },
        tabIndex: { type: 'integer', description: 'Specific tab index returned by status or tabs.' },
        ref: { type: 'string', description: 'Element ref returned by browser snapshot.' },
        toRef: { type: 'string', description: 'Destination ref for browser act kind=drag.' },
        selector: { type: 'string', description: 'Optional CSS selector fallback for wait or advanced actions when ref is unavailable.' },
        format: { type: 'string', enum: ['text', 'json'], description: 'Snapshot output format.' },
        limit: { type: 'integer', description: 'Maximum interactive elements to include in the snapshot.' },
        fullPage: { type: 'boolean', description: 'For screenshot, capture the full page.' },
        path: { type: 'string', description: 'Optional absolute or relative output path for screenshots.' },
        kind: {
          type: 'string',
          enum: ['click', 'double_click', 'hover', 'type', 'fill', 'press', 'select', 'check', 'uncheck', 'scroll_into_view', 'drag'],
          description: 'Interaction kind for browser act.',
        },
        text: { type: 'string', description: 'Text for type/fill, or visible text to wait for.' },
        key: { type: 'string', description: 'Keyboard key for browser act kind=press.' },
        value: { type: 'string', description: 'Single option value for browser act kind=select.' },
        values: { type: 'array', items: { type: 'string' }, description: 'Multiple option values for browser act kind=select.' },
        loadState: { type: 'string', enum: ['load', 'domcontentloaded', 'networkidle'], description: 'Optional load state for browser wait.' },
        timeoutMs: { type: 'integer', description: 'Optional timeout in milliseconds.' },
      },
      required: ['action'],
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
  {
    name: 'message_agent',
    description: 'Send a message to another agent. Use this to delegate work, ask for review, or share findings.',
    parameters: {
      type: 'object',
      properties: {
        agent_name: { type: 'string', description: 'The name of the agent to send a message to' },
        message: { type: 'string', description: 'The message content to send' },
      },
      required: ['agent_name', 'message'],
    },
  },
];

/**
 * Load user-defined custom tools from the database and convert them into
 * the same tool-definition format used by the built-in AGENT_TOOLS.
 */
function getCustomToolDefinitions() {
  try {
    const rows = db.prepare('SELECT * FROM custom_tools').all();
    return rows.map((row) => ({
      name: row.name,
      description: row.description,
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'Input to pass to the tool (replaces {{input}} in the command template)' },
        },
        required: ['input'],
      },
      _custom: true,
      _command_template: row.command_template,
    }));
  } catch (err) {
    console.error('[Executor] Failed to load custom tools:', err.message);
    return [];
  }
}

/**
 * Filter AGENT_TOOLS based on agent.allowed_tools.
 * If allowed_tools is empty, all tools are returned.
 * Otherwise only tools whose name is in the comma-separated whitelist are
 * included — plus task_complete and request_help which are always required.
 *
 * Custom tools from the DB are always appended (subject to the same whitelist
 * filtering when an allowed_tools whitelist is active).
 */
function getToolsForAgent(agent) {
  const customTools = getCustomToolDefinitions();
  const pTools = getPluginTools();
  const allTools = [...AGENT_TOOLS, ...customTools, ...pTools];

  const raw = (agent && agent.allowed_tools) || '';
  if (!raw.trim()) return allTools;

  const whitelist = new Set(
    raw.split(',').map((t) => t.trim()).filter(Boolean)
  );
  // Always include these essential tools
  whitelist.add('task_complete');
  whitelist.add('request_help');

  return allTools.filter((tool) => whitelist.has(tool.name));
}

// ─── Command Sandboxing Helpers ───

const BLOCKED_COMMAND_PATTERNS = [
  /rm\s+-rf\s+\/(?!\S)/,           // rm -rf /
  /rm\s+-rf\s+~/,                   // rm -rf ~
  /DROP\s+TABLE/i,                  // DROP TABLE
  /DROP\s+DATABASE/i,               // DROP DATABASE
  /\bmkfs\b/,                       // mkfs (format filesystem)
  /\bdd\s+if=/,                     // dd if= (raw disk write)
  /:\(\)\{\s*:\|:&\s*\};:/,        // fork bomb :(){ :|:& };:
  />\s*\/dev\/sda/,                 // > /dev/sda
  /chmod\s+-R\s+777\s+\//,         // chmod -R 777 /
];

/**
 * Check whether a command matches any blocked dangerous pattern.
 * Returns the matched pattern string if blocked, or null if safe.
 */
function isCommandBlocked(command) {
  for (const pattern of BLOCKED_COMMAND_PATTERNS) {
    if (pattern.test(command)) {
      return pattern.toString();
    }
  }
  return null;
}

// Destructive command keywords that require confirmation when the setting is enabled
const DESTRUCTIVE_KEYWORDS = ['rm', 'drop', 'delete', 'truncate', 'destroy'];

async function executeTool(name, input, workDir, taskId, agentId) {
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
      // --- Sandbox: blocked command patterns ---
      const blockedPattern = isCommandBlocked(input.command);
      if (blockedPattern) {
        addLog(taskId, 'error', `Sandbox violation: command blocked by pattern ${blockedPattern} — "${input.command}"`);
        return `Error: Command rejected — matches dangerous pattern ${blockedPattern}. This command is not allowed.`;
      }

      // --- Sandbox: destructive command confirmation ---
      const requireConfirmation = db.prepare("SELECT value FROM settings WHERE key = 'require_confirmation_destructive'").get()?.value === 'true';
      if (requireConfirmation) {
        const cmdLower = input.command.toLowerCase();
        const matchedKeyword = DESTRUCTIVE_KEYWORDS.find(kw => cmdLower.includes(kw));
        if (matchedKeyword) {
          addLog(taskId, 'warning', `Destructive command blocked (require_confirmation_destructive=true): "${input.command}" contains "${matchedKeyword}".`);
          return `Error: Destructive command rejected — the command contains "${matchedKeyword}" and the system requires confirmation for destructive operations. This command was not executed. Please use a safer alternative or ask the user for confirmation.`;
        }
      }

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
    case 'read_image': {
      const imgPath = path.resolve(workDir, input.path);
      try {
        const ext = path.extname(imgPath).toLowerCase();
        const supported = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
        if (!supported.includes(ext)) return `Error: unsupported format. Supported: ${supported.join(', ')}`;
        const stat = fs.statSync(imgPath);
        if (stat.size > 5 * 1024 * 1024) return 'Error: image too large (>5MB)';
        addLog(taskId, 'info', `read_image: ${input.path} (${(stat.size / 1024).toFixed(1)}KB)`);
        return `Image loaded: ${input.path} (${stat.size} bytes). Describe what needs to be done with this image.`;
      } catch (err) { return `Error: ${err.message}`; }
    }
    case 'browser': {
      try {
        io.emit('agent:status_changed', { agentId, status: 'executing' });
        const result = await runBrowserTool(agentId, input);
        addLog(taskId, 'info', `browser.${input.action || 'status'} executed`);
        return result;
      } catch (err) {
        addLog(taskId, 'error', `browser tool failed: ${err.message}`);
        return `Browser tool failed: ${err.message}`;
      }
    }
    case 'message_agent': {
      try {
        const targetAgent = db.prepare('SELECT * FROM agents WHERE LOWER(name) = LOWER(?)').get(input.agent_name);
        if (!targetAgent) {
          const allAgents = db.prepare('SELECT name FROM agents').all().map(a => a.name);
          return `Error: Agent "${input.agent_name}" not found. Available agents: ${allAgents.join(', ') || 'none'}`;
        }
        const msgId = uuidv4();
        db.prepare(
          'INSERT INTO agent_messages (id, from_agent_id, to_agent_id, content) VALUES (?, ?, ?, ?)'
        ).run(msgId, agentId, targetAgent.id, input.message);

        const fromAgent = db.prepare('SELECT name, avatar FROM agents WHERE id = ?').get(agentId);
        const message = {
          id: msgId,
          from_agent_id: agentId,
          to_agent_id: targetAgent.id,
          content: input.message,
          from_agent_name: fromAgent?.name || 'Unknown',
          from_agent_avatar: fromAgent?.avatar || '',
          to_agent_name: targetAgent.name,
          to_agent_avatar: targetAgent.avatar,
          created_at: new Date().toISOString(),
        };

        if (io) io.emit('agent:message', message);
        addLog(taskId, 'info', `Sent message to agent "${targetAgent.name}": ${input.message.slice(0, 200)}`);
        return `Message sent to ${targetAgent.name} successfully.`;
      } catch (err) {
        return `Error sending message: ${err.message}`;
      }
    }
    default: {
      // Check if this is a user-defined custom tool
      const customTool = db.prepare('SELECT * FROM custom_tools WHERE name = ?').get(name);
      if (customTool) {
        const toolInput = (input && input.input) || '';
        // Replace {{input}} placeholders in the command template
        const command = customTool.command_template.replace(/\{\{input\}\}/g, toolInput);

        // Apply the same sandboxing as run_bash
        const blockedPattern = isCommandBlocked(command);
        if (blockedPattern) {
          addLog(taskId, 'error', `Sandbox violation: custom tool "${name}" command blocked by pattern ${blockedPattern}`);
          return `Error: Custom tool command rejected — matches dangerous pattern ${blockedPattern}.`;
        }

        addLog(taskId, 'command', `[custom:${name}] $ ${command}`);
        io.emit('agent:status_changed', { agentId, status: 'executing' });
        try {
          const output = execSync(command, {
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
          addLog(taskId, 'error', `Custom tool "${name}" failed: ${errMsg}`);
          return `Custom tool "${name}" failed (exit ${err.status || 'unknown'}): ${errMsg}`;
        }
      }

      // Check if this is a plugin tool
      const pTools = getPluginTools();
      const pluginTool = pTools.find((t) => t.name === name);
      if (pluginTool && pluginTool._handler) {
        addLog(taskId, 'command', `[plugin:${name}] executing`);
        io.emit('agent:status_changed', { agentId, status: 'executing' });
        try {
          const result = await Promise.resolve(pluginTool._handler(input, workDir));
          const output = typeof result === 'string' ? result : JSON.stringify(result);
          const truncated = output.slice(0, 3000);
          addLog(taskId, 'output', truncated || '(no output)');
          return truncated || '(plugin completed with no output)';
        } catch (err) {
          addLog(taskId, 'error', `Plugin tool "${name}" failed: ${err.message}`);
          return `Plugin tool "${name}" failed: ${err.message}`;
        }
      }

      return `Unknown tool: ${name}`;
    }
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
  const isRecurring = task.trigger_type === 'cron';
  const agentContext = buildAgentContext(agentId, agent, {
    includeMemory: !isRecurring,
    includeHeartbeat: isRecurring,
  });

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

  // Build recent project activity context so agents know what others did
  let projectActivity = '';
  if (project) {
    try {
      const recentDone = db.prepare(
        "SELECT t.title, t.completion_output, a.name as agent_name FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id WHERE t.project_id = ? AND t.status = 'done' AND t.id != ? ORDER BY t.completed_at DESC LIMIT 5"
      ).all(project.id, taskId);
      if (recentDone.length > 0) {
        projectActivity = '\n## Recent Activity on This Project\n' +
          recentDone.map((t) => `- ${t.agent_name || 'Agent'}: ${t.title}${t.completion_output ? ` — ${t.completion_output.slice(0, 150)}` : ''}`).join('\n');
      }
    } catch {}

    // Show git log if available
    try {
      if (isGitRepo(workDir)) {
        const gitLog = execSync('git log --oneline -5 2>/dev/null', { cwd: workDir, encoding: 'utf8', timeout: 3000 }).trim();
        if (gitLog) projectActivity += `\n\n## Recent Git Commits\n\`\`\`\n${gitLog}\n\`\`\``;
      }
    } catch {}
  }

  // Build custom tools section for the system prompt
  const customToolDefs = getCustomToolDefinitions();
  const customToolsPrompt = customToolDefs.length > 0
    ? '\n' + customToolDefs.map((t) => `- **${t.name}**: ${t.description}`).join('\n')
    : '';

  const systemPrompt = buildTaskSystemPrompt(agent, agentContext, {
    projectDoc,
    projectActivity,
    customToolsPrompt,
    workDir: project?.path || workDir,
    includeHeartbeat: isRecurring,
  });

  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Complete this task:\n\nTitle: ${task.title}\nDescription: ${task.description || 'No description provided.'}\n\nWorking directory: ${workDir}\n\nCurrent files:\n${dirListing}\n\nStart immediately. Use the tools to explore, make changes, and complete the task.`,
    },
  ];

  let iterations = 0;
  const maxIterations = parseInt(db.prepare("SELECT value FROM settings WHERE key = 'max_iterations'").get()?.value || '30', 10);

  while (iterations < maxIterations && !execState.aborted) {
    iterations++;
    addLog(taskId, 'thinking', `Iteration ${iterations}...`);
    io.emit('agent:status_changed', { agentId, status: 'thinking' });

    // Prune context if too large
    const pruned = pruneMessages(messages);
    if (pruned.length < messages.length) {
      messages.length = 0;
      messages.push(...pruned);
      addLog(taskId, 'info', `Context pruned: ${pruned.length} messages (was larger)`);
    }

    let response;
    try {
      response = await createCompletion(agent.provider, agent.model, messages, { tools: getToolsForAgent(agent), fallbackModel: agent.fallback_model });
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

        const result = await executeTool(toolCall.name, toolCall.input, workDir, taskId, agentId);
        toolResults.push({ id: toolCall.id, result });
      }

      if (taskDone) {
        const doneStatus = task.trigger_type === 'cron' ? 'todo' : 'done';
        const heartbeatAck = task.trigger_type === 'cron' && String(summary || '').trim() === 'HEARTBEAT_OK';
        if (heartbeatAck) {
          addLog(taskId, 'info', 'Recurring run completed with HEARTBEAT_OK.');
          moveTask(taskId, doneStatus, 'HEARTBEAT_OK');
        } else {
          addLog(taskId, 'success', 'Task completed!');
          const completionMsg = `I've completed the task: ${task.title}\n\n${summary}`;
          moveTask(taskId, doneStatus, completionMsg);
          sendMessage(agentId, 'agent', completionMsg, taskId);
          reflectAfterTask(agent, agentDir, task.title, summary, project);
        }
        try { require('./scheduler').onTaskCompleted(task); } catch {}
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
        const textSummary = extractSummary(response.content);
        const textDoneStatus = task.trigger_type === 'cron' ? 'todo' : 'done';
        const heartbeatAck = task.trigger_type === 'cron' && textSummary.trim() === 'HEARTBEAT_OK';
        if (heartbeatAck) {
          addLog(taskId, 'info', 'Recurring run completed with HEARTBEAT_OK.');
          moveTask(taskId, textDoneStatus, 'HEARTBEAT_OK');
        } else {
          addLog(taskId, 'success', 'Task completed (text signal)!');
          const textCompletionMsg = `I've completed the task: ${task.title}\n\n${textSummary}`;
          moveTask(taskId, textDoneStatus, textCompletionMsg);
          sendMessage(agentId, 'agent', textCompletionMsg, taskId);
          reflectAfterTask(agent, agentDir, task.title, extractSummary(response.content), project);
        }
        try { require('./scheduler').onTaskCompleted(task); } catch {}
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

// Context window management: prune old messages when approaching limits
const MAX_CONTEXT_CHARS = 200000; // ~50K tokens rough estimate

function pruneMessages(messages) {
  // Estimate total size
  const totalChars = messages.reduce((sum, m) => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return sum + content.length;
  }, 0);

  if (totalChars <= MAX_CONTEXT_CHARS) return messages;

  // Keep system message (first) and last 10 messages, summarize the middle
  const system = messages[0];
  const recent = messages.slice(-10);
  const middle = messages.slice(1, -10);

  // Summarize middle messages
  const summaryParts = middle.map((m) => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    return `[${m.role}]: ${content.slice(0, 100)}...`;
  });

  const summaryMsg = {
    role: 'user',
    content: `[Context compressed — ${middle.length} earlier messages summarized]\n${summaryParts.slice(-5).join('\n')}`,
  };

  return [system, summaryMsg, ...recent];
}

const MAX_EXECUTION_LOGS = 500;

function addLog(taskId, type, content) {
  const task = db.prepare('SELECT execution_logs FROM tasks WHERE id = ?').get(taskId);
  if (!task) return;
  let logs = JSON.parse(task.execution_logs || '[]');
  const entry = { timestamp: new Date().toISOString(), type, content };
  logs.push(entry);
  // Trim old logs if exceeding limit, keeping first 5 (start markers) and last N
  if (logs.length > MAX_EXECUTION_LOGS) {
    const header = logs.slice(0, 5);
    const recent = logs.slice(-(MAX_EXECUTION_LOGS - 6));
    logs = [...header, { timestamp: new Date().toISOString(), type: 'info', content: `... ${logs.length - MAX_EXECUTION_LOGS} older log entries trimmed ...` }, ...recent];
  }
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

function checkBudget(agentId) {
  const today = new Date().toISOString().split('T')[0];
  const daily = db.prepare("SELECT COALESCE(SUM(cost_usd), 0) as total FROM budget_logs WHERE date(created_at) = ?").get(today);
  const dailyLimit = parseFloat(db.prepare("SELECT value FROM settings WHERE key = 'daily_budget_usd'").get()?.value || '10');
  if (daily.total >= dailyLimit) return false;
  const monthStart = new Date(); monthStart.setDate(1);
  const monthly = db.prepare("SELECT COALESCE(SUM(cost_usd), 0) as total FROM budget_logs WHERE created_at >= ?").get(monthStart.toISOString());
  const monthlyLimit = parseFloat(db.prepare("SELECT value FROM settings WHERE key = 'monthly_budget_usd'").get()?.value || '100');
  if (monthly.total >= monthlyLimit) return false;

  // Per-agent budget check
  if (agentId) {
    const agent = db.prepare('SELECT daily_budget_usd FROM agents WHERE id = ?').get(agentId);
    if (agent && agent.daily_budget_usd > 0) {
      const agentDaily = db.prepare("SELECT COALESCE(SUM(cost_usd), 0) as total FROM budget_logs WHERE agent_id = ? AND date(created_at) = ?").get(agentId, today);
      if (agentDaily.total >= agent.daily_budget_usd) return false;
    }
  }

  return true;
}

// ─── Memory Reflection ───

// Cheapest available model per provider for background reflection
const REFLECTION_MODELS = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-4o-mini',
  openrouter: 'openai/gpt-4o-mini',
  deepseek: 'deepseek-chat',
  mistral: 'mistral-small-latest',
  xai: 'grok-code-fast-1',
  groq: 'llama-3.1-8b-instant',
  together: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  moonshot: 'kimi-k2-turbo-preview',
  ollama: 'glm-4.7-flash',
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

function formatLocalDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function appendDailyMemoryEntry(agentDir, title, content) {
  const dailyDir = path.join(agentDir, 'memory');
  fs.mkdirSync(dailyDir, { recursive: true });
  const dailyPath = path.join(dailyDir, `${formatLocalDate()}.md`);
  const existing = readFile(dailyPath) || `# ${formatLocalDate()}\n`;
  const timestamp = new Date().toISOString();
  const next = `${existing.trimEnd()}\n\n## ${timestamp} - ${title}\n${content}\n`;
  fs.writeFileSync(dailyPath, next);
}

function appendMemoryEntry(agentDir, title, content) {
  const memPath = path.join(agentDir, 'MEMORY.md');
  const existing = readFile(memPath) || '';
  const today = formatLocalDate();
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
  const agentType = normalizeAgentType(agent?.agent_type);
  if (agentType === 'cli') return;

  appendDailyMemoryEntry(agentDir, taskTitle, taskSummary);
  if (!supportsApiReflection(agent)) {
    appendMemoryEntry(agentDir, taskTitle, taskSummary);
    return;
  }
  try {
    const reflModel = REFLECTION_MODELS[agent.provider] || agent.model;
    const today = new Date().toISOString().split('T')[0];

    const memory = readFile(path.join(agentDir, 'MEMORY.md'));
    let projectDoc = '';
    const projectDocPath = project?.path ? path.join(project.path, 'PROJECT.md') : null;
    if (projectDocPath && fs.existsSync(projectDocPath)) {
      projectDoc = fs.readFileSync(projectDocPath, 'utf8');
    }

    const userPrefs = agentType === 'smart' ? readFile(path.join(agentDir, 'USER.md')) : '';
    const agentRules = agentType === 'smart' ? readFile(path.join(agentDir, 'AGENTS.md')) : '';
    const toolsNotes = agentType === 'smart' ? readFile(path.join(agentDir, 'TOOLS.md')) : '';
    const workerJsonShape = `{
  "MEMORY.md": "full updated content",
  "PROJECT.md": "full updated content — only if project knowledge was gained"
}`;
    const smartJsonShape = `{
  "MEMORY.md": "full updated content",
  "USER.md": "full updated content — only if new user preferences/patterns were observed",
  "AGENTS.md": "full updated content — only if new project conventions/tools/rules were learned",
  "TOOLS.md": "full updated content — only if local environment notes or setup-specific shortcuts were learned",
  "PROJECT.md": "full updated content — only if project knowledge was gained (tech stack, structure, commands, etc.)"
}`;

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

${agentType === 'smart' ? `USER.md:
${userPrefs || '(empty)'}

AGENTS.md:
${agentRules || '(empty)'}

TOOLS.md:
${toolsNotes || '(empty)'}

` : ''}${project ? `PROJECT.md (${project.path}/PROJECT.md):\n${projectDoc || '(empty - create it)'}` : ''}

## Instructions
Analyze the completed task and return a JSON object with only the files that need updating:
${agentType === 'smart' ? smartJsonShape : workerJsonShape}

Rules:
- MEMORY.md: Keep it curated and durable. Record decisions, preferences, or lessons worth carrying forward. The raw task log already lives in memory/YYYY-MM-DD.md.
${agentType === 'smart' ? '- USER.md: Update if the task revealed user preferences, coding style, or communication patterns.\n- AGENTS.md: Update if you learned project conventions (e.g. "uses yarn", "tests with Jest", "deploy with Vercel").\n- TOOLS.md: Update only for environment-specific notes such as aliases, scripts, hosts, devices, or local operational shortcuts.' : '- Worker Agents only maintain memory plus project knowledge. Do not emit USER.md, AGENTS.md, TOOLS.md, ROLE.md, or any other file.'}
- PROJECT.md: Document what the project does, tech stack, directory structure, key commands, recent changes. Very valuable — be detailed if this is new info.
- Omit a key if that file genuinely needs no changes.`,
      },
    ], { maxTokens: 3000 });

    logBudget(agent.id, agent.provider, reflModel, response.inputTokens, response.outputTokens);
    const updates = parseJsonResponse(response.content);

    if (updates['MEMORY.md']) { fs.writeFileSync(path.join(agentDir, 'MEMORY.md'), updates['MEMORY.md']); console.log(`[Reflect] MEMORY.md ← ${agent.name}`); }
    if (agentType === 'smart' && updates['USER.md']) { fs.writeFileSync(path.join(agentDir, 'USER.md'), updates['USER.md']); console.log(`[Reflect] USER.md ← ${agent.name}`); }
    if (agentType === 'smart' && updates['AGENTS.md']) { fs.writeFileSync(path.join(agentDir, 'AGENTS.md'), updates['AGENTS.md']); console.log(`[Reflect] AGENTS.md ← ${agent.name}`); }
    if (agentType === 'smart' && updates['TOOLS.md']) { fs.writeFileSync(path.join(agentDir, 'TOOLS.md'), updates['TOOLS.md']); console.log(`[Reflect] TOOLS.md ← ${agent.name}`); }
    if (updates['PROJECT.md'] && project?.path) { fs.writeFileSync(path.join(project.path, 'PROJECT.md'), updates['PROJECT.md']); console.log(`[Reflect] PROJECT.md ← ${project.path}`); }
  } catch (err) {
    console.error(`[Reflect] Task reflection failed for ${agent.name}:`, err.message);
    appendMemoryEntry(agentDir, taskTitle, taskSummary);
  }
}

// Lightweight AI reflection after a chat exchange — async, fire-and-forget
async function reflectAfterChat(agent, agentDir, userMessage, agentResponse) {
  const agentType = normalizeAgentType(agent?.agent_type);
  if (agentType === 'cli') return;

  if (!supportsApiReflection(agent)) {
    appendDailyMemoryEntry(agentDir, 'Chat', `User: ${userMessage.slice(0, 300)}\nAgent: ${agentResponse.slice(0, 300)}`);
    appendMemoryEntry(agentDir, 'Chat', `User: ${userMessage.slice(0, 150)}\nAgent: ${agentResponse.slice(0, 150)}`);
    return;
  }
  try {
    const reflModel = REFLECTION_MODELS[agent.provider] || agent.model;
    const today = new Date().toISOString().split('T')[0];

    const memory = readFile(path.join(agentDir, 'MEMORY.md'));
    const userPrefs = agentType === 'smart' ? readFile(path.join(agentDir, 'USER.md')) : '';
    const workerJsonShape = `{
  "MEMORY.md": "full updated content"
}`;
    const smartJsonShape = `{
  "MEMORY.md": "full updated content",
  "USER.md": "full updated content — only if user preferences/patterns observed"
}`;

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

${agentType === 'smart' ? `USER.md:
${userPrefs || '(empty)'}

` : ''}## Instructions
Return JSON with only files that need updating:
${agentType === 'smart' ? smartJsonShape : workerJsonShape}

Rules:
- MEMORY.md: Add a brief entry only if something meaningful was discussed (skip trivial/greeting exchanges). Keep it curated, not chat-transcript-like.
${agentType === 'smart' ? '- USER.md: Update if the user expressed preferences, a working style, or communication patterns.' : '- Worker Agents do not update USER.md, AGENTS.md, TOOLS.md, ROLE.md, or other workspace files from chat reflection.'}
- Return {} if nothing meaningful needs to be remembered.`,
      },
    ], { maxTokens: 1500 });

    logBudget(agent.id, agent.provider, reflModel, response.inputTokens, response.outputTokens);
    const updates = parseJsonResponse(response.content);

    if (updates['MEMORY.md']) { fs.writeFileSync(path.join(agentDir, 'MEMORY.md'), updates['MEMORY.md']); console.log(`[Reflect] MEMORY.md ← ${agent.name} (chat)`); }
    if (agentType === 'smart' && updates['USER.md']) { fs.writeFileSync(path.join(agentDir, 'USER.md'), updates['USER.md']); console.log(`[Reflect] USER.md ← ${agent.name} (chat)`); }
  } catch (err) {
    console.error(`[Reflect] Chat reflection failed for ${agent.name}:`, err.message);
    appendDailyMemoryEntry(agentDir, 'Chat', `User: ${userMessage.slice(0, 300)}\nAgent: ${agentResponse.slice(0, 300)}`);
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

// Auto-queue: after an agent completes a task, start the next 'todo' task for the same agent
function autoQueueNextTask(agentId) {
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const nextTask = db.prepare(
    "SELECT * FROM tasks WHERE agent_id = ? AND status = 'todo' AND trigger_type = 'manual' ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, created_at ASC LIMIT 1"
  ).get(agentId);

  if (nextTask && !activeExecutions.has(nextTask.id)) {
    console.log(`[AutoQueue] Starting next task for agent ${agentId}: ${nextTask.title}`);
    db.prepare("UPDATE tasks SET status = 'doing', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(nextTask.id);
    const task = db.prepare(
      'SELECT t.*, a.name as agent_name, a.avatar as agent_avatar, p.name as project_name FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id LEFT JOIN projects p ON t.project_id = p.id WHERE t.id = ?'
    ).get(nextTask.id);
    if (task) {
      task.execution_logs = JSON.parse(task.execution_logs || '[]');
      task.attachments = JSON.parse(task.attachments || '[]');
      if (io) io.emit('task:updated', task);
    }
    // Delay briefly to let previous execution fully clean up
    setTimeout(() => executeTask(nextTask.id, agentId).catch(() => {}), 1000);
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function getActiveExecutions() { return Array.from(activeExecutions.keys()); }

module.exports = { initExecutor, executeTask, getActiveExecutions, handleDirectChat };
