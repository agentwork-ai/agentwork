const express = require('express');
const router = express.Router();
const { db, uuidv4, DATA_DIR, logAudit } = require('../db');
const fs = require('fs');
const path = require('path');

// Lazy-load platforms to avoid circular deps
function getPlatforms() {
  try { return require('../services/platforms'); } catch { return null; }
}

// Get all agents
router.get('/', (req, res) => {
  const agents = db.prepare('SELECT * FROM agents ORDER BY created_at DESC').all();
  res.json(agents);
});

// Get single agent
router.get('/:id', (req, res) => {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  // Load memory files
  const agentDir = path.join(DATA_DIR, 'agents', agent.id);
  agent.memory = {};
  for (const file of ['SOUL.md', 'USER.md', 'AGENTS.md', 'MEMORY.md']) {
    const filePath = path.join(agentDir, file);
    if (fs.existsSync(filePath)) {
      agent.memory[file] = fs.readFileSync(filePath, 'utf8');
    }
  }

  res.json(agent);
});

// Create (hire) agent
router.post('/', async (req, res) => {
  const { name, avatar, role, auth_type, provider, model, personality,
          chat_enabled, chat_platform, chat_token, chat_app_token, chat_allowed_ids,
          daily_budget_usd } = req.body;

  if (!name) return res.status(400).json({ error: 'Name is required' });

  const id = uuidv4();
  db.prepare(
    `INSERT INTO agents (id, name, avatar, role, auth_type, provider, model, status, personality,
      chat_enabled, chat_platform, chat_token, chat_app_token, chat_allowed_ids, daily_budget_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    name,
    avatar || '🤖',
    role || 'General Developer',
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
    daily_budget_usd || 0
  );

  // Create memory directory with OpenClaw architecture
  const agentDir = path.join(DATA_DIR, 'agents', id);
  fs.mkdirSync(agentDir, { recursive: true });

  const soulContent = `# ${name} - Soul Configuration
## Role: ${role || 'General Developer'}
## Personality
${personality || 'Professional, thorough, and proactive. Writes clean, well-documented code.'}

## Behavioral Rules
- ALWAYS proceed autonomously — never ask the user for confirmation or clarification
- Make reasonable assumptions and pick the best approach yourself
- Follow existing code patterns and conventions
- Test your changes when possible
`;

  const userContent = `# User Preferences
## Code Style
- Follow the project's existing conventions
- Write clear, readable code
- Add comments for complex logic

## Communication
- Be concise but thorough
- Proactively report blockers
- Summarize changes after completion
`;

  const agentsContent = `# Operational Rules
## Autonomy
- ALWAYS proceed with the task without asking the user for permission or confirmation
- Make your best judgment on ambiguous requirements — do not stop to ask
- If multiple approaches are possible, pick the most reasonable one and go

## Workflow
- Read PROJECT.md before starting any task if it exists
- Log all significant actions to execution logs
- Only use [NEED_HELP] if something is truly impossible (e.g. missing credentials, broken environment)
`;

  const memoryContent = `# ${name} - Long-term Memory
## Initialized: ${new Date().toISOString()}
No memories recorded yet.
`;

  fs.writeFileSync(path.join(agentDir, 'SOUL.md'), soulContent);
  fs.writeFileSync(path.join(agentDir, 'USER.md'), userContent);
  fs.writeFileSync(path.join(agentDir, 'AGENTS.md'), agentsContent);
  fs.writeFileSync(path.join(agentDir, 'MEMORY.md'), memoryContent);

  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
  logAudit('create', 'agent', id, { name, role: role || 'General Developer' });
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

  const { name, avatar, role, auth_type, provider, model, status, personality,
          chat_enabled, chat_platform, chat_token, chat_app_token, chat_allowed_ids,
          daily_budget_usd } = req.body;

  const newChatEnabled = chat_enabled !== undefined ? (chat_enabled ? 1 : 0) : existing.chat_enabled;

  db.prepare(
    `UPDATE agents SET name = ?, avatar = ?, role = ?, auth_type = ?, provider = ?, model = ?,
     status = ?, personality = ?,
     chat_enabled = ?, chat_platform = ?, chat_token = ?, chat_app_token = ?, chat_allowed_ids = ?,
     daily_budget_usd = ?,
     updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(
    name || existing.name,
    avatar || existing.avatar,
    role || existing.role,
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
    req.params.id
  );

  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
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

  const allowedFiles = ['SOUL.md', 'USER.md', 'AGENTS.md', 'MEMORY.md'];
  if (!allowedFiles.includes(req.params.filename)) {
    return res.status(400).json({ error: 'Invalid memory file' });
  }

  const agentDir = path.join(DATA_DIR, 'agents', agent.id);
  const filePath = path.join(agentDir, req.params.filename);
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
    `INSERT INTO agents (id, name, avatar, role, auth_type, provider, model, status, personality,
      chat_enabled, chat_platform, chat_token, chat_app_token, chat_allowed_ids)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, cloneName, source.avatar, source.role, source.auth_type, source.provider,
    source.model, 'idle', source.personality, 0, '', '', '', '');

  // Clone memory files
  const srcDir = path.join(DATA_DIR, 'agents', source.id);
  const destDir = path.join(DATA_DIR, 'agents', id);
  fs.mkdirSync(destDir, { recursive: true });
  for (const file of ['SOUL.md', 'USER.md', 'AGENTS.md', 'MEMORY.md']) {
    const srcPath = path.join(srcDir, file);
    if (fs.existsSync(srcPath)) {
      let content = fs.readFileSync(srcPath, 'utf8');
      if (file === 'SOUL.md') content = content.replace(source.name, cloneName);
      if (file === 'MEMORY.md') content = `# ${cloneName} - Long-term Memory\n## Cloned from: ${source.name}\n## ${new Date().toISOString()}\nNo new memories recorded yet.\n`;
      fs.writeFileSync(path.join(destDir, file), content);
    }
  }

  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
  const io = req.app.get('io');
  if (io) io.emit('agent:created', agent);
  res.status(201).json(agent);
});

// Clear agent memory
router.post('/:id/clear-memory', (req, res) => {
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const agentDir = path.join(DATA_DIR, 'agents', agent.id);
  const memoryPath = path.join(agentDir, 'MEMORY.md');
  fs.writeFileSync(memoryPath, `# ${agent.name} - Long-term Memory\n## Cleared: ${new Date().toISOString()}\nNo memories recorded yet.\n`);

  res.json({ success: true });
});

module.exports = router;
