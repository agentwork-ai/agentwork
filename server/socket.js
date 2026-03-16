const { db } = require('./db');

// Lazy-loaded to avoid circular dependency at require time
let _executor = null;
function getExecutor() {
  if (!_executor) {
    _executor = require('./services/executor');
  }
  return _executor;
}

function initSocket(io) {
  io.on('connection', (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    // Send initial status
    socket.emit('system:status', getSystemStatus());

    // Chat messages - save and broadcast, then trigger agent response
    socket.on('chat:send', (data) => {
      const { agentId, content } = data;
      const { v4: uuidv4 } = require('uuid');
      const id = uuidv4();

      db.prepare(
        'INSERT INTO messages (id, agent_id, sender, content, task_id) VALUES (?, ?, ?, ?, ?)'
      ).run(id, agentId, 'user', content, data.taskId || null);

      const message = {
        id,
        agent_id: agentId,
        sender: 'user',
        content,
        task_id: data.taskId || null,
        created_at: new Date().toISOString(),
      };

      io.emit('chat:message', message);

      // If agent has an active task that's blocked, forward as user reply
      if (data.taskId) {
        io.emit('chat:user_reply', { agentId, content, taskId: data.taskId });
      } else {
        // Direct chat — call executor directly (not via socket event)
        const executor = getExecutor();
        if (executor?.handleDirectChat) {
          executor.handleDirectChat(agentId, content).catch((err) => {
            console.error(`[Socket] Direct chat error:`, err);
          });
        } else {
          console.error('[Socket] handleDirectChat not available yet');
        }
      }
    });

    // Task status changes
    socket.on('task:move', (data) => {
      const { taskId, status } = data;

      if (status !== 'backlog' && status !== 'todo') {
        const check = db.prepare('SELECT agent_id, task_type, flow_items, depends_on FROM tasks WHERE id = ?').get(taskId);
        if (check && !check.agent_id) {
          const isFlow = (check.task_type || 'single') === 'flow';
          const flowItems = JSON.parse(check.flow_items || '[]');
          const flowHasAgents = isFlow && flowItems.some((i) => i.agent_id);
          if (!flowHasAgents) {
            socket.emit('task:move_error', { taskId, message: 'Assign an agent before moving this task.' });
            return;
          }
        }

        // Check dependencies when moving to 'doing'
        if (status === 'doing' && check) {
          const depIds = JSON.parse(check.depends_on || '[]');
          if (Array.isArray(depIds) && depIds.length > 0) {
            const placeholders = depIds.map(() => '?').join(',');
            const depTasks = db.prepare(`SELECT id, title, status FROM tasks WHERE id IN (${placeholders})`).all(...depIds);
            const unmet = depTasks.filter((d) => d.status !== 'done');
            if (unmet.length > 0) {
              const names = unmet.map((d) => d.title).join(', ');
              socket.emit('task:move_error', { taskId, message: `Dependencies not met: ${names}` });
              return;
            }
          }
        }
      }

      db.prepare('UPDATE tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, taskId);

      const task = db.prepare(
        'SELECT t.*, a.name as agent_name, a.avatar as agent_avatar, p.name as project_name FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id LEFT JOIN projects p ON t.project_id = p.id WHERE t.id = ?'
      ).get(taskId);
      if (task) {
        task.execution_logs = JSON.parse(task.execution_logs || '[]');
        task.attachments = JSON.parse(task.attachments || '[]');
        task.flow_items = JSON.parse(task.flow_items || '[]');
        task.depends_on = JSON.parse(task.depends_on || '[]');
      }
      io.emit('task:updated', task);

      if (status === 'doing' && task) {
        const isFlowTask = (task.task_type || 'single') === 'flow';
        const flowItems = JSON.parse(task.flow_items || '[]');
        const flowHasAgents = flowItems.some((i) => i.agent_id);
        if (task.agent_id || (isFlowTask && flowHasAgents)) {
          const executor = getExecutor();
          if (executor?.executeTask) {
            executor.executeTask(taskId, task.agent_id).catch((err) => {
              console.error(`[Socket] Task execute error:`, err);
            });
          }
        }
      }
    });

    // Agent status changes
    socket.on('agent:status', (data) => {
      const { agentId, status } = data;
      db.prepare('UPDATE agents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, agentId);
      io.emit('agent:status_changed', { agentId, status });
    });

    // Request system status
    socket.on('system:get_status', () => {
      socket.emit('system:status', getSystemStatus());
    });

    socket.on('disconnect', () => {
      console.log(`[Socket] Client disconnected: ${socket.id}`);
    });
  });

  return io;
}

function getSystemStatus() {
  const activeAgents = db.prepare("SELECT COUNT(*) as count FROM agents WHERE status != 'offline'").get().count;
  const activeTasks = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'doing'").get().count;
  const totalTasks = db.prepare('SELECT COUNT(*) as count FROM tasks').get().count;

  const today = new Date().toISOString().split('T')[0];
  const dailyUsage = db.prepare(
    "SELECT COALESCE(SUM(cost_usd), 0) as total FROM budget_logs WHERE date(created_at) = ?"
  ).get(today);

  const monthStart = new Date();
  monthStart.setDate(1);
  const monthlyUsage = db.prepare(
    "SELECT COALESCE(SUM(cost_usd), 0) as total FROM budget_logs WHERE created_at >= ?"
  ).get(monthStart.toISOString());

  const totalTokens = db.prepare(
    "SELECT COALESCE(SUM(input_tokens + output_tokens), 0) as total FROM budget_logs"
  ).get();

  return {
    connected: true,
    activeAgents,
    activeTasks,
    totalTasks,
    dailySpend: dailyUsage.total,
    monthlySpend: monthlyUsage.total,
    totalTokens: totalTokens.total,
  };
}

module.exports = { initSocket, getSystemStatus };
