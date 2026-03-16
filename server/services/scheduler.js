/**
 * Task Scheduler Service
 * Handles Schedule (one-shot) and Cron (recurring) task triggers.
 */

const cron = require('node-cron');
const { db } = require('../db');

let io = null;

// Map of taskId → { type: 'timeout'|'cron', handle }
const activeSchedules = new Map();

function initScheduler(socketIo) {
  io = socketIo;

  // Load all scheduled/cron tasks on startup
  const tasks = db.prepare(
    "SELECT * FROM tasks WHERE trigger_type IN ('schedule', 'cron') AND status NOT IN ('doing')"
  ).all();

  for (const task of tasks) {
    scheduleTask(task);
  }

  console.log(`[Scheduler] Initialized with ${tasks.length} scheduled task(s)`);
}

function scheduleTask(task) {
  // Cancel any existing schedule for this task
  cancelTask(task.id);

  if (task.trigger_type === 'schedule') {
    scheduleOnce(task);
  } else if (task.trigger_type === 'cron') {
    scheduleCron(task);
  }
}

function scheduleOnce(task) {
  if (!task.trigger_at) return;

  const fireAt = new Date(task.trigger_at).getTime();
  const now = Date.now();
  const delay = fireAt - now;

  if (delay <= 0) {
    console.log(`[Scheduler] Scheduled task "${task.title}" is in the past, skipping`);
    return;
  }

  const handle = setTimeout(() => {
    triggerTask(task.id);
  }, delay);

  activeSchedules.set(task.id, { type: 'timeout', handle });
  console.log(`[Scheduler] Scheduled "${task.title}" to fire in ${Math.round(delay / 1000)}s`);
}

function scheduleCron(task) {
  if (!task.trigger_cron) return;

  if (!cron.validate(task.trigger_cron)) {
    console.warn(`[Scheduler] Invalid cron expression for task "${task.title}": ${task.trigger_cron}`);
    return;
  }

  const job = cron.schedule(task.trigger_cron, () => {
    // Only trigger if not already running
    const current = db.prepare('SELECT status FROM tasks WHERE id = ?').get(task.id);
    if (current && current.status !== 'doing') {
      triggerTask(task.id);
    }
  }, { scheduled: true });

  activeSchedules.set(task.id, { type: 'cron', handle: job });
  console.log(`[Scheduler] Cron "${task.title}" scheduled: ${task.trigger_cron}`);
}

function cancelTask(taskId) {
  const entry = activeSchedules.get(taskId);
  if (!entry) return;

  if (entry.type === 'timeout') {
    clearTimeout(entry.handle);
  } else if (entry.type === 'cron') {
    entry.handle.stop();
  }

  activeSchedules.delete(taskId);
}

function triggerTask(taskId) {
  const task = db.prepare(
    'SELECT t.*, a.name as agent_name FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id WHERE t.id = ?'
  ).get(taskId);

  if (!task) return;
  if (!task.agent_id) {
    console.warn(`[Scheduler] Task "${task.title}" has no agent, cannot trigger`);
    return;
  }

  console.log(`[Scheduler] Triggering task "${task.title}"`);

  // Move to doing
  db.prepare('UPDATE tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('doing', taskId);
  const updated = db.prepare(
    'SELECT t.*, a.name as agent_name, a.avatar as agent_avatar, p.name as project_name FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id LEFT JOIN projects p ON t.project_id = p.id WHERE t.id = ?'
  ).get(taskId);
  if (updated) {
    updated.execution_logs = JSON.parse(updated.execution_logs || '[]');
    updated.attachments = JSON.parse(updated.attachments || '[]');
    if (io) io.emit('task:updated', updated);
  }

  // Execute
  const { executeTask } = require('./executor');
  executeTask(taskId, task.agent_id).catch((err) => {
    console.error(`[Scheduler] Execution error for task "${task.title}":`, err.message);
  });
}

// Called after a cron task completes — reschedule stays alive (cron handles it)
// Called after a schedule task completes — remove from active (one-shot)
function onTaskCompleted(task) {
  if (task.trigger_type === 'schedule') {
    cancelTask(task.id);
  }
  // cron jobs keep running automatically via node-cron
}

module.exports = { initScheduler, scheduleTask, cancelTask, onTaskCompleted };
