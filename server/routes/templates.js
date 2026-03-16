const express = require('express');
const router = express.Router();
const { db, uuidv4, logAudit } = require('../db');

// Get all templates
router.get('/', (req, res) => {
  const templates = db.prepare('SELECT * FROM task_templates ORDER BY created_at DESC').all();
  templates.forEach((t) => {
    t.flow_items = JSON.parse(t.flow_items || '[]');
  });
  res.json(templates);
});

// Create template (from scratch or from existing task)
router.post('/', (req, res) => {
  const { name, description, priority, agent_id, project_id, task_type, flow_items, tags, from_task_id } = req.body;

  let templateData = { name, description, priority, agent_id, project_id, task_type, flow_items, tags };

  // If creating from an existing task, pull data from that task
  if (from_task_id) {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(from_task_id);
    if (!task) return res.status(404).json({ error: 'Source task not found' });

    templateData = {
      name: name || task.title,
      description: task.description || '',
      priority: task.priority || 'medium',
      agent_id: task.agent_id || null,
      project_id: task.project_id || null,
      task_type: task.task_type || 'single',
      flow_items: JSON.parse(task.flow_items || '[]'),
      tags: task.tags || '',
    };
  }

  if (!templateData.name) return res.status(400).json({ error: 'Template name is required' });

  const id = uuidv4();
  db.prepare(
    `INSERT INTO task_templates (id, name, description, priority, agent_id, project_id, task_type, flow_items, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    templateData.name,
    templateData.description || '',
    templateData.priority || 'medium',
    templateData.agent_id || null,
    templateData.project_id || null,
    templateData.task_type || 'single',
    templateData.flow_items ? JSON.stringify(templateData.flow_items) : '[]',
    templateData.tags || ''
  );

  const template = db.prepare('SELECT * FROM task_templates WHERE id = ?').get(id);
  template.flow_items = JSON.parse(template.flow_items || '[]');

  logAudit('create', 'task_template', id, { name: templateData.name });
  res.status(201).json(template);
});

// Create a new task from a template
router.post('/:id/use', (req, res) => {
  const template = db.prepare('SELECT * FROM task_templates WHERE id = ?').get(req.params.id);
  if (!template) return res.status(404).json({ error: 'Template not found' });

  // Allow overrides from the request body
  const { title, description, priority, agent_id, project_id, status, task_type, tags } = req.body;

  const flowItems = JSON.parse(template.flow_items || '[]');
  // Reset flow step statuses to pending for the new task
  const resetFlowItems = flowItems.map((item) => ({
    ...item,
    id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
    status: 'pending',
    output: '',
  }));

  const taskId = uuidv4();
  db.prepare(
    `INSERT INTO tasks (id, title, description, status, priority, agent_id, project_id, task_type, flow_items, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    taskId,
    title || template.name,
    description !== undefined ? description : (template.description || ''),
    status || 'backlog',
    priority || template.priority || 'medium',
    agent_id !== undefined ? (agent_id || null) : (template.agent_id || null),
    project_id !== undefined ? (project_id || null) : (template.project_id || null),
    task_type || template.task_type || 'single',
    JSON.stringify(resetFlowItems),
    tags !== undefined ? tags : (template.tags || '')
  );

  const task = db.prepare(
    'SELECT t.*, a.name as agent_name, a.avatar as agent_avatar, p.name as project_name FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id LEFT JOIN projects p ON t.project_id = p.id WHERE t.id = ?'
  ).get(taskId);

  task.execution_logs = JSON.parse(task.execution_logs || '[]');
  task.attachments = JSON.parse(task.attachments || '[]');
  task.flow_items = JSON.parse(task.flow_items || '[]');
  task.depends_on = JSON.parse(task.depends_on || '[]');

  logAudit('create_from_template', 'task', taskId, { template_id: req.params.id, template_name: template.name });

  const io = req.app.get('io');
  if (io) io.emit('task:created', task);

  res.status(201).json(task);
});

// Delete template
router.delete('/:id', (req, res) => {
  const template = db.prepare('SELECT * FROM task_templates WHERE id = ?').get(req.params.id);
  if (!template) return res.status(404).json({ error: 'Template not found' });

  db.prepare('DELETE FROM task_templates WHERE id = ?').run(req.params.id);
  logAudit('delete', 'task_template', req.params.id);
  res.json({ success: true });
});

module.exports = router;
