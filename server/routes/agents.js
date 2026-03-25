const express = require('express');
const router = express.Router();
const { db, uuidv4, DATA_DIR, logAudit } = require('../db');
const fs = require('fs');
const path = require('path');
const {
  STANDARD_AGENT_FILES,
  ensureMemoryFiles,
  getDefaultFileContent,
  normalizeAgentType,
} = require('../services/agent-context');
const {
  filterInstalledSkillSlugs,
} = require('../services/skills');

// Lazy-load platforms to avoid circular deps
function getPlatforms() {
  try { return require('../services/platforms'); } catch { return null; }
}

function listMarkdownFiles(dir, baseDir = dir) {
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listMarkdownFiles(fullPath, baseDir));
      continue;
    }
    if (!entry.name.endsWith('.md')) continue;
    files.push(path.relative(baseDir, fullPath));
  }
  return files.sort();
}

function copyMarkdownTree(srcDir, destDir, transform) {
  for (const relPath of listMarkdownFiles(srcDir)) {
    const srcPath = path.join(srcDir, relPath);
    const destPath = path.join(destDir, relPath);
    let content = fs.readFileSync(srcPath, 'utf8');
    if (transform) content = transform(relPath, content);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, content);
  }
}

function replaceIdentityField(content, label, value) {
  const lines = String(content || '').split(/\r?\n/);
  let replaced = false;

  const updated = lines.map((line) => {
    const trimmed = line.trim().replace(/^\s*-\s*/, '').replace(/\*/g, '');
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) return line;

    const lineLabel = trimmed.slice(0, colonIndex).trim().toLowerCase();
    if (lineLabel !== label.toLowerCase()) return line;

    replaced = true;
    const prefix = line.match(/^\s*-\s*/) ? '- ' : '';
    return `${prefix}${label}: ${value}`;
  });

  if (!replaced) updated.push(`- ${label}: ${value}`);
  return `${updated.join('\n').trimEnd()}\n`;
}

function parseSkillsJson(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function serializeAgentRecord(agent) {
  if (!agent) return agent;
  const { skills_json, ...rest } = agent;
  return {
    ...rest,
    skills: parseSkillsJson(skills_json),
  };
}

// Get all agents
router.get('/', (req, res) => {
  const agents = db.prepare('SELECT * FROM agents ORDER BY created_at DESC').all().map(serializeAgentRecord);
  res.json(agents);
});

// Suggest best agent for a task
router.get('/suggest', (req, res) => {
  const { title, description, project_id } = req.query;
  const text = `${title || ''} ${description || ''}`.toLowerCase();
  const agents = db.prepare('SELECT * FROM agents ORDER BY created_at DESC').all();
  if (agents.length === 0) return res.json([]);

  // Score agents based on role match, project history, and workload
  const scored = agents.map((agent) => {
    let score = 0;
    const role = (agent.role || '').toLowerCase();

    // Role keyword matching
    const keywords = text.split(/\s+/).filter((w) => w.length > 3);
    for (const kw of keywords) {
      if (role.includes(kw)) score += 10;
    }

    // Common role-task associations
    if (text.match(/react|frontend|ui|css|component/) && role.match(/react|frontend|ui|full.?stack/)) score += 15;
    if (text.match(/api|backend|server|database|sql/) && role.match(/backend|server|full.?stack|data/)) score += 15;
    if (text.match(/test|qa|bug|fix/) && role.match(/qa|test|quality/)) score += 15;
    if (text.match(/deploy|ci|docker|infra/) && role.match(/devops|infra|deploy/)) score += 15;
    if (text.match(/doc|readme|write/) && role.match(/writer|doc/)) score += 15;

    // Past performance on same project
    if (project_id) {
      const completed = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE agent_id = ? AND project_id = ? AND status = 'done'").get(agent.id, project_id);
      score += (completed?.c || 0) * 5;
    }

    // Penalize busy agents
    const active = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE agent_id = ? AND status = 'doing'").get(agent.id);
    score -= (active?.c || 0) * 10;

    // Prefer idle agents
    if (agent.status === 'idle') score += 5;

    return { ...agent, score };
  });

  scored.sort((a, b) => b.score - a.score);
  res.json(scored.slice(0, 5));
});

// Get prompt effectiveness analysis for an agent
router.get('/:id/prompt-analysis', (req, res) => {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const agentId = req.params.id;
  const total = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE agent_id = ?").get(agentId).c;
  const blocked = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE agent_id = ? AND status = 'blocked'").get(agentId).c;
  const done = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE agent_id = ? AND status = 'done'").get(agentId).c;
  const successRate = total > 0 ? (done / total * 100).toFixed(1) : 0;
  const blockRate = total > 0 ? (blocked / total * 100).toFixed(1) : 0;

  // Analyze blocked task reasons from execution logs
  const blockedTasks = db.prepare("SELECT title, execution_logs FROM tasks WHERE agent_id = ? AND status = 'blocked' ORDER BY updated_at DESC LIMIT 10").all(agentId);
  const blockReasons = blockedTasks.map((t) => {
    const logs = JSON.parse(t.execution_logs || '[]');
    const blockLog = logs.filter((l) => l.type === 'blocked' || l.type === 'error').slice(-1)[0];
    return { title: t.title, reason: blockLog?.content || 'Unknown' };
  });

  const suggestions = [];
  if (parseFloat(blockRate) > 30) suggestions.push('High block rate — consider adding more specific instructions to SOUL.md');
  if (parseFloat(blockRate) > 50) suggestions.push('Very high block rate — the agent may need a different model or more operational rules in AGENTS.md');
  if (blockedTasks.some((t) => JSON.parse(t.execution_logs || '[]').some((l) => l.content?.includes('Budget')))) {
    suggestions.push('Agent hitting budget limits — consider increasing per-agent or global budget');
  }
  if (blockedTasks.some((t) => JSON.parse(t.execution_logs || '[]').some((l) => l.content?.includes('API key')))) {
    suggestions.push('Missing API key errors — check Settings > API Providers');
  }
  if (total > 5 && parseFloat(successRate) < 50) {
    suggestions.push('Low success rate — review the agent personality and task descriptions for clarity');
  }

  res.json({ total, done, blocked, successRate: parseFloat(successRate), blockRate: parseFloat(blockRate), blockReasons, suggestions });
});

// Get single agent
router.get('/:id', (req, res) => {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  // Load all .md memory files from agent directory
  const agentDir = path.join(DATA_DIR, 'agents', agent.id);
  ensureMemoryFiles(agent.id, agent);
  agent.memory = {};
  for (const file of listMarkdownFiles(agentDir)) {
    agent.memory[file] = fs.readFileSync(path.join(agentDir, file), 'utf8');
  }
  // Ensure standard files exist in response
  for (const std of STANDARD_AGENT_FILES) {
    if (!agent.memory[std]) agent.memory[std] = getDefaultFileContent(std, agent);
  }
  // Load shared TEAM.md
  const teamPath = path.join(DATA_DIR, 'TEAM.md');
  agent.memory['TEAM.md'] = fs.existsSync(teamPath) ? fs.readFileSync(teamPath, 'utf8') : '';

  res.json(serializeAgentRecord(agent));
});

// Create (hire) agent
router.post('/', async (req, res) => {
  const { name, avatar, role, agent_type, auth_type, provider, model, personality,
          chat_enabled, chat_platform, chat_token, chat_app_token, chat_allowed_ids,
          daily_budget_usd, allowed_tools, skills } = req.body;

  if (!name) return res.status(400).json({ error: 'Name is required' });

  const id = uuidv4();
  const normalizedAgentType = normalizeAgentType(agent_type || (auth_type === 'cli' ? 'cli' : 'smart'));
  const assignedSkills = filterInstalledSkillSlugs(skills);
  db.prepare(
    `INSERT INTO agents (id, name, avatar, role, agent_type, auth_type, provider, model, status, personality,
      chat_enabled, chat_platform, chat_token, chat_app_token, chat_allowed_ids, daily_budget_usd, allowed_tools, skills_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    name,
    avatar || '🤖',
    role || 'Assistant',
    normalizedAgentType,
    auth_type || 'api',
    provider || 'anthropic',
    model || '',
    'idle',
    personality || '',
    chat_enabled ? 1 : 0,
    chat_platform || '',
    chat_token || '',
    chat_app_token || '',
    chat_allowed_ids || '',
    daily_budget_usd || 0,
    allowed_tools || '',
    JSON.stringify(assignedSkills)
  );

  const agent = serializeAgentRecord(db.prepare('SELECT * FROM agents WHERE id = ?').get(id));
  ensureMemoryFiles(id, agent, { syncRole: true });
  logAudit('create', 'agent', id, { name, role: role || 'Assistant', agent_type: normalizedAgentType });
  const io = req.app.get('io');
  if (io) io.emit('agent:created', agent);

  // Start platform bot if enabled
  if (chat_enabled) {
    const platforms = getPlatforms();
    if (platforms) platforms.startBotForAgent(agent).catch(() => {});
  }

  res.status(201).json(agent);
});

// Update agent
router.put('/:id', async (req, res) => {
  const existing = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Agent not found' });

  const { name, avatar, role, agent_type, auth_type, provider, model, status, personality,
          chat_enabled, chat_platform, chat_token, chat_app_token, chat_allowed_ids,
          daily_budget_usd, allowed_tools, skills } = req.body;

  const newChatEnabled = chat_enabled !== undefined ? (chat_enabled ? 1 : 0) : existing.chat_enabled;
  const nextAgentType = agent_type !== undefined ? normalizeAgentType(agent_type) : normalizeAgentType(existing.agent_type);
  const nextSkills = skills !== undefined
    ? filterInstalledSkillSlugs(skills)
    : parseSkillsJson(existing.skills_json);

  db.prepare(
    `UPDATE agents SET name = ?, avatar = ?, role = ?, agent_type = ?, auth_type = ?, provider = ?, model = ?,
     status = ?, personality = ?,
     chat_enabled = ?, chat_platform = ?, chat_token = ?, chat_app_token = ?, chat_allowed_ids = ?,
     daily_budget_usd = ?, allowed_tools = ?, skills_json = ?,
     updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(
    name || existing.name,
    avatar || existing.avatar,
    role || existing.role,
    nextAgentType,
    auth_type || existing.auth_type,
    provider || existing.provider,
    model !== undefined ? model : existing.model,
    status || existing.status,
    personality !== undefined ? personality : existing.personality,
    newChatEnabled,
    chat_platform !== undefined ? chat_platform : existing.chat_platform,
    chat_token !== undefined ? chat_token : existing.chat_token,
    chat_app_token !== undefined ? chat_app_token : existing.chat_app_token,
    chat_allowed_ids !== undefined ? chat_allowed_ids : existing.chat_allowed_ids,
    daily_budget_usd !== undefined ? daily_budget_usd : (existing.daily_budget_usd || 0),
    allowed_tools !== undefined ? allowed_tools : (existing.allowed_tools || ''),
    JSON.stringify(nextSkills),
    req.params.id
  );

  const agent = serializeAgentRecord(db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id));
  ensureMemoryFiles(req.params.id, agent, { previousAgent: existing, syncRole: true });
  const io = req.app.get('io');
  if (io) io.emit('agent:updated', agent);

  // Restart platform bot with new config
  const platforms = getPlatforms();
  if (platforms) {
    if (newChatEnabled) {
      platforms.startBotForAgent(agent).catch(() => {});
    } else {
      platforms.stopBotForAgent(agent.id).catch(() => {});
    }
  }

  res.json(agent);
});

// Update agent memory file
router.put('/:id/memory/:filename', (req, res) => {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const filename = req.params.filename;
  // Allow standard files + nested .md files under the agent directory (no path traversal)
  if (!filename.endsWith('.md') || filename.includes('..') || path.isAbsolute(filename)) {
    return res.status(400).json({ error: 'Invalid memory file. Must stay within the agent directory.' });
  }

  // TEAM.md is shared — stored at DATA_DIR level, not per-agent
  if (req.params.filename === 'TEAM.md') {
    fs.writeFileSync(path.join(DATA_DIR, 'TEAM.md'), req.body.content || '');
    return res.json({ success: true });
  }

  const agentDir = path.join(DATA_DIR, 'agents', agent.id);
  ensureMemoryFiles(agent.id, agent);
  const filePath = path.join(agentDir, req.params.filename);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, req.body.content || '');

  res.json({ success: true });
});

// Delete (fire) agent
router.delete('/:id', (req, res) => {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  // Remove memory directory
  const agentDir = path.join(DATA_DIR, 'agents', agent.id);
  if (fs.existsSync(agentDir)) {
    fs.rmSync(agentDir, { recursive: true });
  }

  // Stop platform bot if running
  const platforms = getPlatforms();
  if (platforms) platforms.stopBotForAgent(req.params.id).catch(() => {});

  db.prepare('DELETE FROM agents WHERE id = ?').run(req.params.id);
  logAudit('delete', 'agent', req.params.id, { name: agent.name });

  const io = req.app.get('io');
  if (io) io.emit('agent:deleted', { id: req.params.id });

  res.json({ success: true });
});

// Get agent performance metrics
router.get('/:id/metrics', (req, res) => {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const agentId = req.params.id;
  const totalTasks = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE agent_id = ?").get(agentId).count;
  const completedTasks = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE agent_id = ? AND status = 'done'").get(agentId).count;
  const blockedTasks = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE agent_id = ? AND status = 'blocked'").get(agentId).count;
  const successRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const budget = db.prepare(
    "SELECT COALESCE(SUM(cost_usd), 0) as total_cost, COALESCE(SUM(input_tokens), 0) as input_tokens, COALESCE(SUM(output_tokens), 0) as output_tokens, COUNT(*) as api_calls FROM budget_logs WHERE agent_id = ?"
  ).get(agentId);

  const avgCostPerTask = completedTasks > 0 ? budget.total_cost / completedTasks : 0;

  const recentTasks = db.prepare(
    "SELECT id, title, status, created_at, completed_at FROM tasks WHERE agent_id = ? ORDER BY updated_at DESC LIMIT 10"
  ).all(agentId);

  // Calculate average completion time from tasks that have both created_at and completed_at
  const completedWithTime = db.prepare(
    "SELECT created_at, completed_at FROM tasks WHERE agent_id = ? AND status = 'done' AND completed_at IS NOT NULL"
  ).all(agentId);
  let avgCompletionMinutes = 0;
  if (completedWithTime.length > 0) {
    const totalMs = completedWithTime.reduce((sum, t) => sum + (new Date(t.completed_at) - new Date(t.created_at)), 0);
    avgCompletionMinutes = Math.round(totalMs / completedWithTime.length / 60000);
  }

  res.json({
    totalTasks, completedTasks, blockedTasks, successRate,
    totalCost: budget.total_cost,
    totalTokens: budget.input_tokens + budget.output_tokens,
    apiCalls: budget.api_calls,
    avgCostPerTask,
    avgCompletionMinutes,
    recentTasks,
  });
});

// Clone agent
router.post('/:id/clone', (req, res) => {
  const source = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
  if (!source) return res.status(404).json({ error: 'Agent not found' });

  const id = uuidv4();
  const cloneName = req.body.name || `${source.name} (Copy)`;

  db.prepare(
    `INSERT INTO agents (id, name, avatar, role, agent_type, auth_type, provider, model, status, personality,
      chat_enabled, chat_platform, chat_token, chat_app_token, chat_allowed_ids, daily_budget_usd, allowed_tools, skills_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, cloneName, source.avatar, source.role, normalizeAgentType(source.agent_type), source.auth_type, source.provider,
    source.model, 'idle', source.personality, 0, '', '', '', '', source.daily_budget_usd || 0, source.allowed_tools || '', source.skills_json || '[]');

  const cloneAgent = serializeAgentRecord(db.prepare('SELECT * FROM agents WHERE id = ?').get(id));
  ensureMemoryFiles(id, cloneAgent, { syncRole: true });

  // Clone workspace files
  const srcDir = path.join(DATA_DIR, 'agents', source.id);
  const destDir = path.join(DATA_DIR, 'agents', id);
  fs.mkdirSync(destDir, { recursive: true });
  copyMarkdownTree(srcDir, destDir, (file, originalContent) => {
    let content = originalContent;
    if (file === 'SOUL.md') content = content.replace(source.name, cloneName);
    if (file === 'IDENTITY.md') {
      content = replaceIdentityField(content, 'Name', cloneName);
      content = replaceIdentityField(content, 'Emoji', source.avatar || '🤖');
    }
    if (file === 'MEMORY.md') {
      content = `${getDefaultFileContent('MEMORY.md', cloneAgent)}\n## Clone Provenance\nCloned from: ${source.name}\nCloned at: ${new Date().toISOString()}\n`;
    }
    return content;
  });

  const io = req.app.get('io');
  if (io) io.emit('agent:created', cloneAgent);
  res.status(201).json(cloneAgent);
});

// Send a message to an agent from another agent
router.post('/:id/message', (req, res) => {
  const toAgent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
  if (!toAgent) return res.status(404).json({ error: 'Recipient agent not found' });

  const { from_agent_id, content } = req.body;
  if (!from_agent_id) return res.status(400).json({ error: 'from_agent_id is required' });
  if (!content) return res.status(400).json({ error: 'content is required' });

  const fromAgent = db.prepare('SELECT * FROM agents WHERE id = ?').get(from_agent_id);
  if (!fromAgent) return res.status(404).json({ error: 'Sender agent not found' });

  const id = uuidv4();
  db.prepare(
    'INSERT INTO agent_messages (id, from_agent_id, to_agent_id, content) VALUES (?, ?, ?, ?)'
  ).run(id, from_agent_id, req.params.id, content);

  const message = db.prepare(
    `SELECT m.*, fa.name as from_agent_name, fa.avatar as from_agent_avatar,
            ta.name as to_agent_name, ta.avatar as to_agent_avatar
     FROM agent_messages m
     JOIN agents fa ON m.from_agent_id = fa.id
     JOIN agents ta ON m.to_agent_id = ta.id
     WHERE m.id = ?`
  ).get(id);

  logAudit('agent_message', 'agent', req.params.id, { from: fromAgent.name, to: toAgent.name });

  const io = req.app.get('io');
  if (io) io.emit('agent:message', message);

  res.status(201).json(message);
});

// Get inbox messages for an agent
router.get('/:id/inbox', (req, res) => {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const messages = db.prepare(
    `SELECT m.*, fa.name as from_agent_name, fa.avatar as from_agent_avatar,
            ta.name as to_agent_name, ta.avatar as to_agent_avatar
     FROM agent_messages m
     JOIN agents fa ON m.from_agent_id = fa.id
     JOIN agents ta ON m.to_agent_id = ta.id
     WHERE m.to_agent_id = ?
     ORDER BY m.created_at DESC`
  ).all(req.params.id);

  res.json(messages);
});

// Clear agent memory
router.post('/:id/clear-memory', (req, res) => {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const agentDir = path.join(DATA_DIR, 'agents', agent.id);
  const memoryPath = path.join(agentDir, 'MEMORY.md');
  ensureMemoryFiles(agent.id, agent);
  fs.writeFileSync(memoryPath, `${getDefaultFileContent('MEMORY.md', agent)}\n## Reset\nCleared at: ${new Date().toISOString()}\n`);

  res.json({ success: true });
});

module.exports = router;
