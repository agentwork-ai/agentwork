const express = require('express');
const router = express.Router();
const { db, uuidv4, logAudit } = require('../db');

// Lazy-loaded to avoid circular dependency
let _executeTask = null;
function getExecuteTask() {
  if (!_executeTask) {
    _executeTask = require('../services/executor').executeTask;
  }
  return _executeTask;
}

// List all pipelines
router.get('/', (req, res) => {
  const pipelines = db.prepare('SELECT * FROM pipelines ORDER BY updated_at DESC').all();
  pipelines.forEach((p) => {
    p.steps = JSON.parse(p.steps || '[]');
  });
  res.json(pipelines);
});

// Get single pipeline
router.get('/:id', (req, res) => {
  const pipeline = db.prepare('SELECT * FROM pipelines WHERE id = ?').get(req.params.id);
  if (!pipeline) return res.status(404).json({ error: 'Pipeline not found' });
  pipeline.steps = JSON.parse(pipeline.steps || '[]');
  res.json(pipeline);
});

// Create pipeline
router.post('/', (req, res) => {
  const { name, steps } = req.body;
  if (!name) return res.status(400).json({ error: 'Pipeline name is required' });

  const id = uuidv4();
  db.prepare(
    'INSERT INTO pipelines (id, name, steps) VALUES (?, ?, ?)'
  ).run(id, name, steps ? JSON.stringify(steps) : '[]');

  const pipeline = db.prepare('SELECT * FROM pipelines WHERE id = ?').get(id);
  pipeline.steps = JSON.parse(pipeline.steps || '[]');

  logAudit('create', 'pipeline', id, { name });
  const io = req.app.get('io');
  if (io) io.emit('pipeline:created', pipeline);

  res.status(201).json(pipeline);
});

// Update pipeline
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM pipelines WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Pipeline not found' });

  const { name, steps } = req.body;
  db.prepare(
    'UPDATE pipelines SET name = ?, steps = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(
    name !== undefined ? name : existing.name,
    steps !== undefined ? JSON.stringify(steps) : existing.steps,
    req.params.id
  );

  const pipeline = db.prepare('SELECT * FROM pipelines WHERE id = ?').get(req.params.id);
  pipeline.steps = JSON.parse(pipeline.steps || '[]');

  logAudit('update', 'pipeline', req.params.id, { name: pipeline.name });
  const io = req.app.get('io');
  if (io) io.emit('pipeline:updated', pipeline);

  res.json(pipeline);
});

// Delete pipeline
router.delete('/:id', (req, res) => {
  const pipeline = db.prepare('SELECT * FROM pipelines WHERE id = ?').get(req.params.id);
  if (!pipeline) return res.status(404).json({ error: 'Pipeline not found' });

  db.prepare('DELETE FROM pipelines WHERE id = ?').run(req.params.id);
  logAudit('delete', 'pipeline', req.params.id);

  const io = req.app.get('io');
  if (io) io.emit('pipeline:deleted', { id: req.params.id });

  res.json({ success: true });
});

// Run pipeline — convert steps to tasks with depends_on based on connections
router.post('/:id/run', (req, res) => {
  const pipeline = db.prepare('SELECT * FROM pipelines WHERE id = ?').get(req.params.id);
  if (!pipeline) return res.status(404).json({ error: 'Pipeline not found' });

  const steps = JSON.parse(pipeline.steps || '[]');
  if (steps.length === 0) return res.status(400).json({ error: 'Pipeline has no steps' });

  const io = req.app.get('io');
  const executeTask = getExecuteTask();

  // Map step IDs to generated task IDs
  const stepToTaskId = {};
  for (const step of steps) {
    stepToTaskId[step.id] = uuidv4();
  }

  // Build reverse dependency map: for each step, find which steps point to it
  const dependsOnMap = {};
  for (const step of steps) {
    if (!dependsOnMap[step.id]) dependsOnMap[step.id] = [];
    if (Array.isArray(step.next)) {
      for (const nextId of step.next) {
        if (!dependsOnMap[nextId]) dependsOnMap[nextId] = [];
        dependsOnMap[nextId].push(step.id);
      }
    }
  }

  const createdTasks = [];

  for (const step of steps) {
    const taskId = stepToTaskId[step.id];
    const dependsOn = (dependsOnMap[step.id] || []).map((sid) => stepToTaskId[sid]);

    // Root steps (no dependencies) start as "todo"; others start as "backlog"
    const initialStatus = dependsOn.length === 0 ? 'todo' : 'backlog';

    db.prepare(
      `INSERT INTO tasks (id, title, description, status, priority, agent_id, depends_on, parent_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      taskId,
      step.title || 'Untitled Step',
      step.description || '',
      initialStatus,
      'medium',
      step.agent_id || null,
      JSON.stringify(dependsOn),
      `pipeline:${pipeline.id}`
    );

    const task = db.prepare(
      'SELECT t.*, a.name as agent_name, a.avatar as agent_avatar FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id WHERE t.id = ?'
    ).get(taskId);

    task.execution_logs = JSON.parse(task.execution_logs || '[]');
    task.attachments = JSON.parse(task.attachments || '[]');
    task.flow_items = JSON.parse(task.flow_items || '[]');
    task.depends_on = JSON.parse(task.depends_on || '[]');

    if (io) io.emit('task:created', task);
    createdTasks.push(task);
  }

  // Auto-execute root tasks that have agents
  for (const task of createdTasks) {
    if (task.depends_on.length === 0 && task.agent_id) {
      db.prepare("UPDATE tasks SET status = 'doing', started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(task.id);
      task.status = 'doing';
      if (io) io.emit('task:updated', task);
      executeTask(task.id, task.agent_id).catch((err) =>
        console.error(`[Pipeline] Execute error for task ${task.id}:`, err)
      );
    }
  }

  logAudit('run', 'pipeline', pipeline.id, { name: pipeline.name, tasks: createdTasks.length });
  res.json({ success: true, pipeline_id: pipeline.id, tasks: createdTasks });
});

module.exports = router;
