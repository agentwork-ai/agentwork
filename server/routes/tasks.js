const express = require('express');
const router = express.Router();
const { db, uuidv4 } = require('../db');

// Lazy-loaded to avoid circular dependency
let _executeTask = null;
function getExecuteTask() {
  if (!_executeTask) {
    _executeTask = require('../services/executor').executeTask;
  }
  return _executeTask;
}

// Get all tasks (optionally filtered by project)
router.get('/', (req, res) => {
  const { project_id, status, agent_id } = req.query;
  let query = 'SELECT t.*, a.name as agent_name, a.avatar as agent_avatar, p.name as project_name FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id LEFT JOIN projects p ON t.project_id = p.id WHERE 1=1';
  const params = [];

  if (project_id) {
    query += ' AND t.project_id = ?';
    params.push(project_id);
  }
  if (status) {
    query += ' AND t.status = ?';
    params.push(status);
  }
  if (agent_id) {
    query += ' AND t.agent_id = ?';
    params.push(agent_id);
  }

  query += ' ORDER BY t.created_at DESC';
  const tasks = db.prepare(query).all(...params);

  // Parse JSON fields
  tasks.forEach((t) => {
    t.execution_logs = JSON.parse(t.execution_logs || '[]');
    t.attachments = JSON.parse(t.attachments || '[]');
    t.flow_items = JSON.parse(t.flow_items || '[]');
  });

  res.json(tasks);
});

// Get single task
router.get('/:id', (req, res) => {
  const task = db.prepare(
    'SELECT t.*, a.name as agent_name, a.avatar as agent_avatar, p.name as project_name FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id LEFT JOIN projects p ON t.project_id = p.id WHERE t.id = ?'
  ).get(req.params.id);

  if (!task) return res.status(404).json({ error: 'Task not found' });

  task.execution_logs = JSON.parse(task.execution_logs || '[]');
  task.attachments = JSON.parse(task.attachments || '[]');
  task.flow_items = JSON.parse(task.flow_items || '[]');

  res.json(task);
});

// Create task
router.post('/', (req, res) => {
  const { title, description, status, priority, agent_id, project_id,
          trigger_type, trigger_at, trigger_cron, task_type, flow_items, tags } = req.body;

  if (!title) return res.status(400).json({ error: 'Title is required' });

  const id = uuidv4();
  db.prepare(
    `INSERT INTO tasks (id, title, description, status, priority, agent_id, project_id,
      trigger_type, trigger_at, trigger_cron, task_type, flow_items, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, title, description || '',
    status || 'backlog', priority || 'medium',
    agent_id || null, project_id || null,
    trigger_type || 'manual',
    trigger_at || null,
    trigger_cron || '',
    task_type || 'single',
    flow_items ? JSON.stringify(flow_items) : '[]',
    tags || ''
  );

  const task = db.prepare(
    'SELECT t.*, a.name as agent_name, a.avatar as agent_avatar, p.name as project_name FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id LEFT JOIN projects p ON t.project_id = p.id WHERE t.id = ?'
  ).get(id);

  task.execution_logs = JSON.parse(task.execution_logs || '[]');
  task.attachments = JSON.parse(task.attachments || '[]');
  task.flow_items = JSON.parse(task.flow_items || '[]');

  const io = req.app.get('io');
  if (io) io.emit('task:created', task);

  // Schedule if needed
  try {
    const { scheduleTask } = require('../services/scheduler');
    scheduleTask(task);
  } catch {}

  res.status(201).json(task);
});

// Update task
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Task not found' });

  const { title, description, status, priority, agent_id, project_id, execution_logs, attachments,
          trigger_type, trigger_at, trigger_cron, task_type, flow_items, tags } = req.body;

  const newStatus = status || existing.status;
  const newAgentId = agent_id !== undefined ? agent_id : existing.agent_id;

  // Prevent moving unassigned tasks to active columns (flow tasks are exempt if they have step agents)
  if (newStatus !== 'backlog' && newStatus !== 'todo' && newStatus !== existing.status && !newAgentId) {
    const newTaskType = task_type !== undefined ? task_type : (existing.task_type || 'single');
    const newFlowItems = flow_items || JSON.parse(existing.flow_items || '[]');
    const flowHasAgents = newTaskType === 'flow' && newFlowItems.some((i) => i.agent_id);
    if (!flowHasAgents) {
      return res.status(400).json({ error: 'Assign an agent before moving this task.' });
    }
  }

  const completedAt = newStatus === 'done' && existing.status !== 'done' ? new Date().toISOString() : existing.completed_at;

  db.prepare(
    `UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?, agent_id = ?, project_id = ?,
     execution_logs = ?, attachments = ?, completed_at = ?,
     trigger_type = ?, trigger_at = ?, trigger_cron = ?,
     task_type = ?, flow_items = ?, tags = ?,
     updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(
    title || existing.title,
    description !== undefined ? description : existing.description,
    newStatus,
    priority || existing.priority,
    agent_id !== undefined ? agent_id : existing.agent_id,
    project_id !== undefined ? project_id : existing.project_id,
    execution_logs ? JSON.stringify(execution_logs) : existing.execution_logs,
    attachments ? JSON.stringify(attachments) : existing.attachments,
    completedAt,
    trigger_type !== undefined ? trigger_type : existing.trigger_type,
    trigger_at !== undefined ? trigger_at : existing.trigger_at,
    trigger_cron !== undefined ? trigger_cron : existing.trigger_cron,
    task_type !== undefined ? task_type : (existing.task_type || 'single'),
    flow_items ? JSON.stringify(flow_items) : existing.flow_items,
    tags !== undefined ? tags : (existing.tags || ''),
    req.params.id
  );

  const task = db.prepare(
    'SELECT t.*, a.name as agent_name, a.avatar as agent_avatar, p.name as project_name FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id LEFT JOIN projects p ON t.project_id = p.id WHERE t.id = ?'
  ).get(req.params.id);

  task.execution_logs = JSON.parse(task.execution_logs || '[]');
  task.attachments = JSON.parse(task.attachments || '[]');
  task.flow_items = JSON.parse(task.flow_items || '[]');

  const io = req.app.get('io');
  if (io) {
    io.emit('task:updated', task);

    // If moved to "doing", trigger agent execution
    if (newStatus === 'doing' && existing.status !== 'doing') {
      const isFlowTask = (task.task_type || 'single') === 'flow';
      const flowHasAgents = task.flow_items.some((i) => i.agent_id);
      if (task.agent_id || (isFlowTask && flowHasAgents)) {
        const exec = getExecuteTask();
        if (exec) {
          exec(task.id, task.agent_id).catch((err) => {
            console.error(`[Tasks] Failed to execute task ${task.id}:`, err);
          });
        }
      }
    }
  }

  // Reschedule if trigger config changed
  try {
    const { scheduleTask, cancelTask } = require('../services/scheduler');
    if (task.trigger_type === 'manual') {
      cancelTask(task.id);
    } else {
      scheduleTask(task);
    }
  } catch {}

  res.json(task);
});

// Delete task
router.delete('/:id', (req, res) => {
  try { require('../services/scheduler').cancelTask(req.params.id); } catch {}
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  const io = req.app.get('io');
  if (io) io.emit('task:deleted', { id: req.params.id });
  res.json({ success: true });
});

// Append execution log
router.post('/:id/log', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const logs = JSON.parse(task.execution_logs || '[]');
  logs.push({
    timestamp: new Date().toISOString(),
    type: req.body.type || 'info',
    content: req.body.content,
  });

  db.prepare('UPDATE tasks SET execution_logs = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    JSON.stringify(logs),
    req.params.id
  );

  const io = req.app.get('io');
  if (io) io.emit('task:log', { taskId: req.params.id, log: logs[logs.length - 1] });

  res.json({ success: true });
});

module.exports = router;
