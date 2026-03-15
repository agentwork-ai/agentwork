const express = require('express');
const router = express.Router();
const { db, uuidv4, DATA_DIR } = require('../db');
const fs = require('fs');
const path = require('path');

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
router.post('/', (req, res) => {
  const { name, avatar, role, auth_type, provider, model, personality } = req.body;

  if (!name) return res.status(400).json({ error: 'Name is required' });

  const id = uuidv4();
  db.prepare(
    'INSERT INTO agents (id, name, avatar, role, auth_type, provider, model, status, personality) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    name,
    avatar || '🤖',
    role || 'General Developer',
    auth_type || 'api',
    provider || 'anthropic',
    model || '',
    'idle',
    personality || ''
  );

  // Create memory directory with OpenClaw architecture
  const agentDir = path.join(DATA_DIR, 'agents', id);
  fs.mkdirSync(agentDir, { recursive: true });

  const soulContent = `# ${name} - Soul Configuration
## Role: ${role || 'General Developer'}
## Personality
${personality || 'Professional, thorough, and proactive. Writes clean, well-documented code.'}

## Behavioral Rules
- Always explain your reasoning before making changes
- Follow existing code patterns and conventions
- Test your changes when possible
- Ask for clarification when requirements are ambiguous
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
## Safety
- Do not delete files without backing up
- Always run tests before moving a task to Done
- Do not modify configuration files without explicit permission
- Create a git branch for significant changes

## Workflow
- Read PROJECT.md before starting any task
- Log all significant actions to execution logs
- If stuck for more than 3 attempts, move task to Blocked
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
  const io = req.app.get('io');
  if (io) io.emit('agent:created', agent);

  res.status(201).json(agent);
});

// Update agent
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Agent not found' });

  const { name, avatar, role, auth_type, provider, model, status, personality } = req.body;

  db.prepare(
    `UPDATE agents SET name = ?, avatar = ?, role = ?, auth_type = ?, provider = ?, model = ?,
     status = ?, personality = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(
    name || existing.name,
    avatar || existing.avatar,
    role || existing.role,
    auth_type || existing.auth_type,
    provider || existing.provider,
    model !== undefined ? model : existing.model,
    status || existing.status,
    personality !== undefined ? personality : existing.personality,
    req.params.id
  );

  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
  const io = req.app.get('io');
  if (io) io.emit('agent:updated', agent);

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

  db.prepare('DELETE FROM agents WHERE id = ?').run(req.params.id);

  const io = req.app.get('io');
  if (io) io.emit('agent:deleted', { id: req.params.id });

  res.json({ success: true });
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
