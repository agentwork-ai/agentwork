const express = require('express');
const router = express.Router();
const { db, logAudit } = require('../db');
const { cancelTask, getScheduleStatus } = require('../services/scheduler');
const { humanizeCronExpression } = require('../services/cron-jobs');

function serializeCronTask(task) {
  const schedule = getScheduleStatus(task.id, task);
  return {
    ...task,
    execution_logs: JSON.parse(task.execution_logs || '[]'),
    attachments: JSON.parse(task.attachments || '[]'),
    flow_items: JSON.parse(task.flow_items || '[]'),
    depends_on: JSON.parse(task.depends_on || '[]'),
    next_run: schedule.next_run,
    schedule_active: schedule.active,
    schedule_label: humanizeCronExpression(task.trigger_cron),
  };
}

router.get('/', (req, res) => {
  const { project_id, agent_id } = req.query;
  let query = `
    SELECT
      t.*,
      a.name AS agent_name,
      a.avatar AS agent_avatar,
      p.name AS project_name
    FROM tasks t
    LEFT JOIN agents a ON t.agent_id = a.id
    LEFT JOIN projects p ON t.project_id = p.id
    WHERE t.trigger_type = 'cron'
  `;
  const params = [];

  if (project_id) {
    query += ' AND t.project_id = ?';
    params.push(project_id);
  }
  if (agent_id) {
    query += ' AND t.agent_id = ?';
    params.push(agent_id);
  }

  query += ' ORDER BY t.created_at DESC';

  const tasks = db.prepare(query).all(...params).map(serializeCronTask);
  res.json(tasks);
});

router.delete('/:id', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND trigger_type = ?').get(req.params.id, 'cron');
  if (!task) {
    return res.status(404).json({ error: 'Cron job not found' });
  }

  cancelTask(task.id);
  db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
  logAudit('delete', 'cron_job', task.id, { title: task.title, trigger_cron: task.trigger_cron });

  const io = req.app.get('io');
  if (io) io.emit('task:deleted', { id: task.id });

  res.json({ success: true });
});

module.exports = router;
