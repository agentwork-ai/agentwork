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
      db.prepare('UPDATE tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, taskId);

      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
      io.emit('task:updated', task);

      if (status === 'doing' && task && task.agent_id) {
        const executor = getExecutor();
        if (executor?.executeTask) {
          executor.executeTask(taskId, task.agent_id).catch((err) => {
            console.error(`[Socket] Task execute error:`, err);
          });
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
