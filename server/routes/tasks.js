const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { db, uuidv4, logAudit, DATA_DIR } = require('../db');

const TASK_STORAGE_DIR = path.join(DATA_DIR, 'tasks');
const IMAGE_MIME_TO_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};
const IMAGE_EXTENSIONS = new Set(Object.values(IMAGE_MIME_TO_EXT));
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

// Lazy-loaded to avoid circular dependency
let _executeTask = null;
function getExecuteTask() {
  if (!_executeTask) {
    _executeTask = require('../services/executor').executeTask;
  }
  return _executeTask;
}

function getProjectById(projectId) {
  const id = String(projectId || '').trim();
  if (!id) return null;
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id) || null;
}

function resolveDefaultTaskAgentId(projectId, providedAgentId) {
  if (providedAgentId !== undefined) return providedAgentId;
  const project = getProjectById(projectId);
  return project?.main_developer_agent_id || null;
}

function getTaskAttachmentDir(taskId) {
  return path.join(TASK_STORAGE_DIR, String(taskId), 'attachments');
}

function ensureTaskAttachmentDir(taskId) {
  const dir = getTaskAttachmentDir(taskId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function buildAttachmentUrl(taskId, attachmentId) {
  return `/api/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

function sanitizeAttachmentStem(name) {
  const stem = path.basename(String(name || 'attachment'), path.extname(String(name || '')));
  return stem
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'attachment';
}

function getImageMimeFromPath(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  for (const [mime, mappedExt] of Object.entries(IMAGE_MIME_TO_EXT)) {
    if (mappedExt === ext) return mime;
  }
  return '';
}

function parseTaskAttachments(rawValue) {
  if (Array.isArray(rawValue)) return rawValue;
  try {
    const parsed = JSON.parse(rawValue || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeExistingAttachment(taskId, attachment) {
  if (!attachment?.path) return null;
  const attachmentId = String(attachment.id || uuidv4());
  return {
    id: attachmentId,
    name: attachment.name || path.basename(attachment.path),
    kind: 'image',
    mime_type: attachment.mime_type || getImageMimeFromPath(attachment.path),
    size: Number(attachment.size || 0),
    path: attachment.path,
    url: attachment.url || buildAttachmentUrl(taskId, attachmentId),
  };
}

function persistTaskAttachments(taskId, nextAttachments, existingAttachments = []) {
  const normalizedInput = Array.isArray(nextAttachments) ? nextAttachments : [];
  const persisted = [];
  const keptPaths = new Set();
  const attachmentDir = getTaskAttachmentDir(taskId);

  for (const attachment of normalizedInput) {
    if (!attachment) continue;

    const attachmentId = String(attachment.id || uuidv4()).trim() || uuidv4();
    if (attachment.data_url) {
      const match = String(attachment.data_url).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
      if (!match) {
        throw new Error(`Invalid image attachment payload for "${attachment.name || attachmentId}"`);
      }

      const mimeType = match[1].toLowerCase();
      const ext = IMAGE_MIME_TO_EXT[mimeType];
      if (!ext) {
        throw new Error(`Unsupported image type: ${mimeType}`);
      }

      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length > MAX_ATTACHMENT_BYTES) {
        throw new Error(`Image "${attachment.name || attachmentId}" exceeds 5MB`);
      }

      ensureTaskAttachmentDir(taskId);
      const fileName = `${attachmentId}-${sanitizeAttachmentStem(attachment.name)}${ext}`;
      const filePath = path.join(attachmentDir, fileName);
      fs.writeFileSync(filePath, buffer);
      keptPaths.add(filePath);
      persisted.push({
        id: attachmentId,
        name: attachment.name || fileName,
        kind: 'image',
        mime_type: mimeType,
        size: buffer.length,
        path: filePath,
        url: buildAttachmentUrl(taskId, attachmentId),
      });
      continue;
    }

    const normalized = normalizeExistingAttachment(taskId, attachment);
    if (!normalized) continue;
    if (!normalized.mime_type || !normalized.mime_type.startsWith('image/')) continue;
    if (normalized.path.startsWith(attachmentDir) && fs.existsSync(normalized.path)) {
      keptPaths.add(normalized.path);
    }
    persisted.push(normalized);
  }

  for (const existing of parseTaskAttachments(existingAttachments)) {
    const existingPath = String(existing?.path || '');
    if (!existingPath || !existingPath.startsWith(attachmentDir)) continue;
    if (keptPaths.has(existingPath)) continue;
    try {
      if (fs.existsSync(existingPath)) fs.unlinkSync(existingPath);
    } catch {}
  }

  try {
    if (fs.existsSync(attachmentDir) && fs.readdirSync(attachmentDir).length === 0) {
      fs.rmSync(path.join(TASK_STORAGE_DIR, String(taskId)), { recursive: true, force: true });
    }
  } catch {}

  return persisted;
}

function removeTaskStorage(taskId) {
  try {
    fs.rmSync(path.join(TASK_STORAGE_DIR, String(taskId)), { recursive: true, force: true });
  } catch {}
}

// Bulk operations on multiple tasks
router.post('/bulk', (req, res) => {
  const { action, task_ids, data } = req.body;

  if (!action || !Array.isArray(task_ids) || task_ids.length === 0) {
    return res.status(400).json({ error: 'action and task_ids[] are required' });
  }

  const io = req.app.get('io');

  if (action === 'delete') {
    const deleteStmt = db.prepare('DELETE FROM tasks WHERE id = ?');
    const deleteTx = db.transaction((ids) => {
      for (const id of ids) {
        try { require('../services/scheduler').cancelTask(id); } catch {}
        removeTaskStorage(id);
        deleteStmt.run(id);
        logAudit('delete', 'task', id);
        if (io) io.emit('task:deleted', { id });
      }
    });
    deleteTx(task_ids);
    return res.json({ success: true, deleted: task_ids.length });
  }

  if (action === 'move') {
    const newStatus = data?.status;
    if (!newStatus) return res.status(400).json({ error: 'data.status is required for move action' });

    const results = [];
    for (const id of task_ids) {
      const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
      if (!existing) continue;

      const completedAt = newStatus === 'done' && existing.status !== 'done' ? new Date().toISOString() : existing.completed_at;

      db.prepare('UPDATE tasks SET status = ?, completed_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(newStatus, completedAt, id);

      const task = db.prepare(
        'SELECT t.*, a.name as agent_name, a.avatar as agent_avatar, p.name as project_name FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id LEFT JOIN projects p ON t.project_id = p.id WHERE t.id = ?'
      ).get(id);

      task.execution_logs = JSON.parse(task.execution_logs || '[]');
      task.attachments = JSON.parse(task.attachments || '[]');
      task.flow_items = JSON.parse(task.flow_items || '[]');
      task.depends_on = JSON.parse(task.depends_on || '[]');

      if (io) io.emit('task:updated', task);
      results.push(task);
    }
    return res.json(results);
  }

  if (action === 'assign') {
    const agentId = data?.agent_id !== undefined ? data.agent_id : null;

    const results = [];
    for (const id of task_ids) {
      const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
      if (!existing) continue;

      db.prepare('UPDATE tasks SET agent_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(agentId, id);

      const task = db.prepare(
        'SELECT t.*, a.name as agent_name, a.avatar as agent_avatar, p.name as project_name FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id LEFT JOIN projects p ON t.project_id = p.id WHERE t.id = ?'
      ).get(id);

      task.execution_logs = JSON.parse(task.execution_logs || '[]');
      task.attachments = JSON.parse(task.attachments || '[]');
      task.flow_items = JSON.parse(task.flow_items || '[]');
      task.depends_on = JSON.parse(task.depends_on || '[]');

      if (io) io.emit('task:updated', task);
      results.push(task);
    }
    return res.json(results);
  }

  if (action === 'set_priority') {
    const priority = data?.priority;
    if (!priority) return res.status(400).json({ error: 'data.priority is required for set_priority action' });

    const results = [];
    for (const id of task_ids) {
      const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
      if (!existing) continue;

      db.prepare('UPDATE tasks SET priority = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(priority, id);

      const task = db.prepare(
        'SELECT t.*, a.name as agent_name, a.avatar as agent_avatar, p.name as project_name FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id LEFT JOIN projects p ON t.project_id = p.id WHERE t.id = ?'
      ).get(id);

      task.execution_logs = JSON.parse(task.execution_logs || '[]');
      task.attachments = JSON.parse(task.attachments || '[]');
      task.flow_items = JSON.parse(task.flow_items || '[]');
      task.depends_on = JSON.parse(task.depends_on || '[]');

      if (io) io.emit('task:updated', task);
      results.push(task);
    }
    return res.json(results);
  }

  return res.status(400).json({ error: `Unknown action: ${action}` });
});

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
    t.depends_on = JSON.parse(t.depends_on || '[]');
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
  task.depends_on = JSON.parse(task.depends_on || '[]');

  res.json(task);
});

// Create task
router.post('/', (req, res) => {
  const { title, description, status, priority, agent_id, project_id,
          trigger_type, trigger_at, trigger_cron, task_type, flow_items, tags, depends_on, attachments } = req.body;

  if (!title) return res.status(400).json({ error: 'Title is required' });
  const resolvedAgentId = resolveDefaultTaskAgentId(project_id, agent_id);

  const id = uuidv4();
  let persistedAttachments = [];
  try {
    persistedAttachments = persistTaskAttachments(id, attachments, []);
  } catch (err) {
    removeTaskStorage(id);
    return res.status(400).json({ error: err.message });
  }
  db.prepare(
    `INSERT INTO tasks (id, title, description, status, priority, agent_id, project_id,
      trigger_type, trigger_at, trigger_cron, task_type, flow_items, tags, depends_on, attachments)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, title, description || '',
    status || 'backlog', priority || 'medium',
    resolvedAgentId || null, project_id || null,
    trigger_type || 'manual',
    trigger_at || null,
    trigger_cron || '',
    task_type || 'single',
    flow_items ? JSON.stringify(flow_items) : '[]',
    tags || '',
    depends_on ? JSON.stringify(depends_on) : '[]',
    JSON.stringify(persistedAttachments)
  );

  const task = db.prepare(
    'SELECT t.*, a.name as agent_name, a.avatar as agent_avatar, p.name as project_name FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id LEFT JOIN projects p ON t.project_id = p.id WHERE t.id = ?'
  ).get(id);

  task.execution_logs = JSON.parse(task.execution_logs || '[]');
  task.attachments = JSON.parse(task.attachments || '[]');
  task.flow_items = JSON.parse(task.flow_items || '[]');
  task.depends_on = JSON.parse(task.depends_on || '[]');

  logAudit('create', 'task', id, { title });
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
          trigger_type, trigger_at, trigger_cron, task_type, flow_items, tags, depends_on } = req.body;

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

  // Check dependencies when moving to 'doing'
  if (newStatus === 'doing' && existing.status !== 'doing') {
    const depIds = JSON.parse(depends_on !== undefined ? JSON.stringify(depends_on) : (existing.depends_on || '[]'));
    if (Array.isArray(depIds) && depIds.length > 0) {
      const placeholders = depIds.map(() => '?').join(',');
      const depTasks = db.prepare(`SELECT id, title, status FROM tasks WHERE id IN (${placeholders})`).all(...depIds);
      const unmet = depTasks.filter((d) => d.status !== 'done');
      if (unmet.length > 0) {
        const names = unmet.map((d) => d.title).join(', ');
        return res.status(400).json({ error: `Dependencies not met: ${names}` });
      }
    }
  }

  const completedAt = newStatus === 'done' && existing.status !== 'done' ? new Date().toISOString() : existing.completed_at;
  const startedAt = newStatus === 'doing' && existing.status !== 'doing' ? new Date().toISOString() : (existing.started_at || null);
  let nextAttachments = parseTaskAttachments(existing.attachments);
  if (attachments !== undefined) {
    try {
      nextAttachments = persistTaskAttachments(req.params.id, attachments, existing.attachments);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  db.prepare(
    `UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?, agent_id = ?, project_id = ?,
     execution_logs = ?, attachments = ?, completed_at = ?,
     trigger_type = ?, trigger_at = ?, trigger_cron = ?,
     task_type = ?, flow_items = ?, tags = ?, depends_on = ?,
     updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(
    title || existing.title,
    description !== undefined ? description : existing.description,
    newStatus,
    priority || existing.priority,
    agent_id !== undefined ? agent_id : existing.agent_id,
    project_id !== undefined ? project_id : existing.project_id,
    execution_logs ? JSON.stringify(execution_logs) : existing.execution_logs,
    attachments !== undefined ? JSON.stringify(nextAttachments) : existing.attachments,
    completedAt,
    trigger_type !== undefined ? trigger_type : existing.trigger_type,
    trigger_at !== undefined ? trigger_at : existing.trigger_at,
    trigger_cron !== undefined ? trigger_cron : existing.trigger_cron,
    task_type !== undefined ? task_type : (existing.task_type || 'single'),
    flow_items ? JSON.stringify(flow_items) : existing.flow_items,
    tags !== undefined ? tags : (existing.tags || ''),
    depends_on !== undefined ? JSON.stringify(depends_on) : (existing.depends_on || '[]'),
    req.params.id
  );

  const task = db.prepare(
    'SELECT t.*, a.name as agent_name, a.avatar as agent_avatar, p.name as project_name FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id LEFT JOIN projects p ON t.project_id = p.id WHERE t.id = ?'
  ).get(req.params.id);

  task.execution_logs = JSON.parse(task.execution_logs || '[]');
  task.attachments = JSON.parse(task.attachments || '[]');
  task.flow_items = JSON.parse(task.flow_items || '[]');
  task.depends_on = JSON.parse(task.depends_on || '[]');

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

router.get('/:id/attachments/:attachmentId', (req, res) => {
  const task = db.prepare('SELECT attachments FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const attachment = parseTaskAttachments(task.attachments)
    .find((item) => String(item?.id || '') === String(req.params.attachmentId));
  if (!attachment?.path || !fs.existsSync(attachment.path)) {
    return res.status(404).json({ error: 'Attachment not found' });
  }

  if (attachment.mime_type) res.type(attachment.mime_type);
  res.sendFile(attachment.path);
});

// Delete task
router.delete('/:id', (req, res) => {
  try { require('../services/scheduler').cancelTask(req.params.id); } catch {}
  removeTaskStorage(req.params.id);
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  logAudit('delete', 'task', req.params.id);
  const io = req.app.get('io');
  if (io) io.emit('task:deleted', { id: req.params.id });
  res.json({ success: true });
});

// Get sub-tasks for a parent
router.get('/:id/subtasks', (req, res) => {
  const subtasks = db.prepare(
    'SELECT t.*, a.name as agent_name, a.avatar as agent_avatar FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id WHERE t.parent_id = ? ORDER BY t.created_at ASC'
  ).all(req.params.id);
  subtasks.forEach((t) => {
    t.execution_logs = JSON.parse(t.execution_logs || '[]');
    t.attachments = JSON.parse(t.attachments || '[]');
    t.flow_items = JSON.parse(t.flow_items || '[]');
    t.depends_on = JSON.parse(t.depends_on || '[]');
  });
  res.json(subtasks);
});

// Create sub-task
router.post('/:id/subtasks', (req, res) => {
  const parent = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!parent) return res.status(404).json({ error: 'Parent task not found' });

  const { title, description, priority, agent_id } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });

  const id = uuidv4();
  db.prepare(
    'INSERT INTO tasks (id, title, description, status, priority, agent_id, project_id, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, title, description || '', 'todo', priority || parent.priority, agent_id || parent.agent_id, parent.project_id, req.params.id);

  const task = db.prepare(
    'SELECT t.*, a.name as agent_name, a.avatar as agent_avatar, p.name as project_name FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id LEFT JOIN projects p ON t.project_id = p.id WHERE t.id = ?'
  ).get(id);
  task.execution_logs = []; task.attachments = []; task.flow_items = []; task.depends_on = [];

  const io = req.app.get('io');
  if (io) io.emit('task:created', task);
  res.status(201).json(task);
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

// Get execution replay data
router.get('/:id/replay', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const logs = JSON.parse(task.execution_logs || '[]');
  if (logs.length === 0) return res.json({ events: [], duration: 0 });

  const startTime = new Date(logs[0]?.timestamp).getTime();
  const events = logs.map((log, i) => ({
    index: i,
    type: log.type,
    content: log.content,
    timestamp: log.timestamp,
    offsetMs: new Date(log.timestamp).getTime() - startTime,
  }));

  const duration = events.length > 1 ? events[events.length - 1].offsetMs : 0;
  res.json({
    taskTitle: task.title,
    startedAt: logs[0]?.timestamp,
    events,
    duration,
    totalEvents: events.length,
  });
});

// Get all comments for a task
router.get('/:id/comments', (req, res) => {
  const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const comments = db.prepare(
    'SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC'
  ).all(req.params.id);

  res.json(comments);
});

// Add a comment to a task
router.post('/:id/comments', (req, res) => {
  const task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Content is required' });

  const id = uuidv4();
  db.prepare(
    'INSERT INTO task_comments (id, task_id, content) VALUES (?, ?, ?)'
  ).run(id, req.params.id, content.trim());

  const comment = db.prepare('SELECT * FROM task_comments WHERE id = ?').get(id);

  logAudit('comment', 'task', req.params.id, { comment_id: id });

  const io = req.app.get('io');
  if (io) io.emit('task:comment', { taskId: req.params.id, comment });

  res.status(201).json(comment);
});

module.exports = router;
