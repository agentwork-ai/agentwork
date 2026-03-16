const express = require('express');
const router = express.Router();
const { db, uuidv4, logAudit } = require('../db');

// GET /api/tools — list all custom tools
router.get('/', (req, res) => {
  const tools = db.prepare('SELECT * FROM custom_tools ORDER BY created_at DESC').all();
  res.json(tools);
});

// POST /api/tools — create a custom tool
router.post('/', (req, res) => {
  const { name, description, command_template } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (!description || !description.trim()) {
    return res.status(400).json({ error: 'description is required' });
  }
  if (!command_template || !command_template.trim()) {
    return res.status(400).json({ error: 'command_template is required' });
  }

  // Validate name format: alphanumeric, underscores, hyphens only
  const sanitizedName = name.trim().toLowerCase().replace(/\s+/g, '_');
  if (!/^[a-z0-9_-]+$/.test(sanitizedName)) {
    return res.status(400).json({ error: 'name must contain only letters, numbers, underscores, and hyphens' });
  }

  // Check for conflicts with built-in tool names
  const builtInTools = ['read_file', 'write_file', 'delete_path', 'run_bash', 'list_directory', 'task_complete', 'request_help', 'message_agent'];
  if (builtInTools.includes(sanitizedName)) {
    return res.status(400).json({ error: `"${sanitizedName}" conflicts with a built-in tool name` });
  }

  // Check uniqueness
  const existing = db.prepare('SELECT id FROM custom_tools WHERE name = ?').get(sanitizedName);
  if (existing) {
    return res.status(400).json({ error: `A custom tool named "${sanitizedName}" already exists` });
  }

  const id = uuidv4();
  db.prepare(
    'INSERT INTO custom_tools (id, name, description, command_template) VALUES (?, ?, ?, ?)'
  ).run(id, sanitizedName, description.trim(), command_template.trim());

  const tool = db.prepare('SELECT * FROM custom_tools WHERE id = ?').get(id);
  logAudit('create', 'custom_tool', id, { name: sanitizedName });

  const io = req.app.get('io');
  if (io) io.emit('tools:updated');

  res.status(201).json(tool);
});

// DELETE /api/tools/:id — delete a custom tool
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const tool = db.prepare('SELECT * FROM custom_tools WHERE id = ?').get(id);
  if (!tool) {
    return res.status(404).json({ error: 'Custom tool not found' });
  }

  db.prepare('DELETE FROM custom_tools WHERE id = ?').run(id);
  logAudit('delete', 'custom_tool', id, { name: tool.name });

  const io = req.app.get('io');
  if (io) io.emit('tools:updated');

  res.json({ success: true });
});

module.exports = router;
