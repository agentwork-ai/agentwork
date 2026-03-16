const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { Server: SocketServer } = require('socket.io');
const next = require('next');
const path = require('path');

const PORT = parseInt(process.env.PORT || '1248', 10);
const dev = process.env.NODE_ENV !== 'production';
const ROOT = process.env.AGENTWORK_ROOT || path.resolve(__dirname, '..');

// Set AGENTWORK_ROOT for other modules
process.env.AGENTWORK_ROOT = ROOT;

const app = next({ dev, dir: ROOT });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = express();
  const httpServer = http.createServer(server);
  const io = new SocketServer(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  // Make io accessible to routes
  server.set('io', io);

  // Middleware
  server.use(express.json({ limit: '10mb' }));
  server.use(express.urlencoded({ extended: true }));

  // --- Dashboard Authentication ---

  function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
  }

  function getAuthToken(req) {
    // Check x-auth-token header first, then cookie
    const header = req.headers['x-auth-token'];
    if (header) return header;
    const cookies = req.headers.cookie;
    if (cookies) {
      const match = cookies.split(';').map(c => c.trim()).find(c => c.startsWith('auth_token='));
      if (match) return match.split('=')[1];
    }
    return null;
  }

  // Auth endpoints (always accessible)
  server.post('/api/auth/login', (req, res) => {
    const { db: dbAuth } = require('./db');
    const stored = dbAuth.prepare("SELECT value FROM settings WHERE key = 'dashboard_password'").get()?.value || '';
    if (!stored) {
      return res.json({ success: true, token: null, message: 'No password set' });
    }
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }
    if (password !== stored) {
      return res.status(401).json({ error: 'Invalid password' });
    }
    const token = hashPassword(stored);
    res.json({ success: true, token });
  });

  server.get('/api/auth/check', (req, res) => {
    const { db: dbAuth } = require('./db');
    const stored = dbAuth.prepare("SELECT value FROM settings WHERE key = 'dashboard_password'").get()?.value || '';
    if (!stored) {
      return res.json({ required: false, valid: true });
    }
    const token = getAuthToken(req);
    const expectedToken = hashPassword(stored);
    const valid = token === expectedToken;
    return res.json({ required: true, valid });
  });

  // Auth middleware - protect API and page routes
  server.use((req, res, next) => {
    // Skip auth for auth endpoints and health check
    if (req.path.startsWith('/api/auth/') || req.path === '/api/health') {
      return next();
    }

    // Skip auth for Next.js internal assets
    if (req.path.startsWith('/_next/') || req.path.startsWith('/__nextjs')) {
      return next();
    }

    // Skip static assets
    if (req.path.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|map)$/)) {
      return next();
    }

    const { db: dbAuth } = require('./db');
    const stored = dbAuth.prepare("SELECT value FROM settings WHERE key = 'dashboard_password'").get()?.value || '';

    // No password set = no protection
    if (!stored) {
      return next();
    }

    const token = getAuthToken(req);
    const expectedToken = hashPassword(stored);

    if (token === expectedToken) {
      return next();
    }

    // For API requests, return 401
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // For page requests, let the frontend handle it (the frontend will check auth and show login)
    return next();
  });

  // API routes
  server.use('/api/projects', require('./routes/projects'));
  server.use('/api/tasks', require('./routes/tasks'));
  server.use('/api/agents', require('./routes/agents'));
  server.use('/api/settings', require('./routes/settings'));
  server.use('/api/chat', require('./routes/chat'));
  server.use('/api/files', require('./routes/files'));
  server.use('/api/templates', require('./routes/templates'));

  // Webhook endpoint for external triggers
  server.post('/api/webhooks/trigger', (req, res) => {
    const { db: dbHook, uuidv4: uuidHook, logAudit: logAuditHook } = require('./db');
    const { title, description, agent_id, project_id, priority, status } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });

    const id = uuidHook();
    const targetStatus = status || 'doing';

    dbHook.prepare(
      `INSERT INTO tasks (id, title, description, status, priority, agent_id, project_id) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, title, description || '', targetStatus, priority || 'medium', agent_id || null, project_id || null);

    const task = dbHook.prepare(
      'SELECT t.*, a.name as agent_name, a.avatar as agent_avatar, p.name as project_name FROM tasks t LEFT JOIN agents a ON t.agent_id = a.id LEFT JOIN projects p ON t.project_id = p.id WHERE t.id = ?'
    ).get(id);
    task.execution_logs = JSON.parse(task.execution_logs || '[]');
    task.attachments = JSON.parse(task.attachments || '[]');
    task.flow_items = JSON.parse(task.flow_items || '[]');
    task.depends_on = JSON.parse(task.depends_on || '[]');

    logAuditHook('webhook_trigger', 'task', id, { title });
    const ioRef = server.get('io');
    if (ioRef) ioRef.emit('task:created', task);

    // Auto-execute if moved to doing with an agent
    if (targetStatus === 'doing' && agent_id) {
      const { executeTask } = require('./services/executor');
      executeTask(id, agent_id).catch((err) => console.error(`[Webhook] Execute error:`, err));
    }

    res.status(201).json(task);
  });

  // API documentation endpoint
  server.get('/api/docs', (req, res) => {
    res.json({
      name: 'AgentWork API',
      version: '1.0.0',
      endpoints: [
        { method: 'GET', path: '/api/status', description: 'System status (agents, tasks, spend)' },
        { method: 'GET', path: '/api/health', description: 'Health check (DB, memory, uptime)' },
        { method: 'GET', path: '/api/docs', description: 'This API documentation' },
        { method: 'POST', path: '/api/auth/login', description: 'Login with password', body: '{ password }' },
        { method: 'GET', path: '/api/auth/check', description: 'Check auth status' },
        { method: 'GET', path: '/api/projects', description: 'List all projects' },
        { method: 'POST', path: '/api/projects', description: 'Create project', body: '{ name, path, description, ignore_patterns }' },
        { method: 'GET', path: '/api/projects/:id', description: 'Get project' },
        { method: 'PUT', path: '/api/projects/:id', description: 'Update project' },
        { method: 'DELETE', path: '/api/projects/:id', description: 'Delete project' },
        { method: 'GET', path: '/api/projects/:id/files', description: 'Get file tree' },
        { method: 'GET', path: '/api/projects/:id/search', description: 'Search files', query: 'q, content' },
        { method: 'GET', path: '/api/projects/:id/health', description: 'Project health score' },
        { method: 'GET', path: '/api/projects/:id/git-status', description: 'Git status' },
        { method: 'GET', path: '/api/projects/:id/diff', description: 'Git diff', query: 'ref' },
        { method: 'POST', path: '/api/projects/:id/regenerate-doc', description: 'Regenerate PROJECT.md' },
        { method: 'GET', path: '/api/tasks', description: 'List tasks', query: 'project_id, status, agent_id' },
        { method: 'POST', path: '/api/tasks', description: 'Create task' },
        { method: 'POST', path: '/api/tasks/bulk', description: 'Bulk operations', body: '{ action, task_ids, data }' },
        { method: 'GET', path: '/api/tasks/:id', description: 'Get task' },
        { method: 'PUT', path: '/api/tasks/:id', description: 'Update task' },
        { method: 'DELETE', path: '/api/tasks/:id', description: 'Delete task' },
        { method: 'GET', path: '/api/tasks/:id/subtasks', description: 'Get subtasks' },
        { method: 'POST', path: '/api/tasks/:id/subtasks', description: 'Create subtask' },
        { method: 'GET', path: '/api/tasks/:id/comments', description: 'Get comments' },
        { method: 'POST', path: '/api/tasks/:id/comments', description: 'Add comment' },
        { method: 'GET', path: '/api/agents', description: 'List agents' },
        { method: 'GET', path: '/api/agents/suggest', description: 'Suggest agent for task', query: 'title, description, project_id' },
        { method: 'POST', path: '/api/agents', description: 'Hire agent' },
        { method: 'GET', path: '/api/agents/:id', description: 'Get agent with memory files' },
        { method: 'PUT', path: '/api/agents/:id', description: 'Update agent' },
        { method: 'DELETE', path: '/api/agents/:id', description: 'Fire agent' },
        { method: 'GET', path: '/api/agents/:id/metrics', description: 'Agent performance metrics' },
        { method: 'POST', path: '/api/agents/:id/clone', description: 'Clone agent' },
        { method: 'PUT', path: '/api/agents/:id/memory/:filename', description: 'Update memory file' },
        { method: 'POST', path: '/api/agents/:id/clear-memory', description: 'Clear agent memory' },
        { method: 'GET', path: '/api/chat/:agentId', description: 'Get messages' },
        { method: 'GET', path: '/api/chat/:agentId/search', description: 'Search messages', query: 'q' },
        { method: 'GET', path: '/api/chat/:agentId/export', description: 'Export chat as Markdown' },
        { method: 'GET', path: '/api/settings', description: 'Get all settings' },
        { method: 'PUT', path: '/api/settings', description: 'Update settings' },
        { method: 'GET', path: '/api/settings/budget', description: 'Budget summary' },
        { method: 'GET', path: '/api/settings/budget/history', description: 'Budget history', query: 'days' },
        { method: 'GET', path: '/api/settings/budget/by-agent', description: 'Cost by agent', query: 'days' },
        { method: 'GET', path: '/api/settings/budget/by-model', description: 'Cost by model', query: 'days' },
        { method: 'GET', path: '/api/settings/report', description: 'Usage report', query: 'days' },
        { method: 'GET', path: '/api/settings/export', description: 'Export data as JSON', query: 'type' },
        { method: 'GET', path: '/api/settings/audit-logs', description: 'Audit logs', query: 'limit, offset' },
        { method: 'GET', path: '/api/templates', description: 'List templates' },
        { method: 'POST', path: '/api/templates', description: 'Create template' },
        { method: 'POST', path: '/api/templates/:id/use', description: 'Create task from template' },
        { method: 'DELETE', path: '/api/templates/:id', description: 'Delete template' },
        { method: 'POST', path: '/api/webhooks/trigger', description: 'Create and execute task via webhook', body: '{ title, description, agent_id, project_id }' },
        { method: 'GET', path: '/api/files/read', description: 'Read file content', query: 'path' },
        { method: 'POST', path: '/api/files/write', description: 'Write file content', body: '{ path, content }' },
      ],
    });
  });

  // Status endpoint
  const { getSystemStatus } = require('./socket');
  server.get('/api/status', (req, res) => {
    res.json(getSystemStatus());
  });

  // Health check endpoint
  server.get('/api/health', (req, res) => {
    const health = { status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() };
    try {
      const { db: dbCheck } = require('./db');
      dbCheck.prepare('SELECT 1').get();
      health.database = 'ok';
    } catch (err) {
      health.database = 'error';
      health.database_error = err.message;
      health.status = 'degraded';
    }
    try {
      const mem = process.memoryUsage();
      health.memory = {
        rss: `${Math.round(mem.rss / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(mem.heapTotal / 1024 / 1024)}MB`,
      };
    } catch {}
    const sysStatus = getSystemStatus();
    health.activeAgents = sysStatus.activeAgents;
    health.activeTasks = sysStatus.activeTasks;
    health.socketClients = io.engine?.clientsCount || 0;
    res.status(health.status === 'ok' ? 200 : 503).json(health);
  });

  // Initialize socket handlers
  const { initSocket } = require('./socket');
  initSocket(io);

  // Initialize executor service
  const { initExecutor } = require('./services/executor');
  initExecutor(io);

  // Recover orphaned tasks (stuck in 'doing' from previous crash)
  const { db: dbRecover } = require('./db');
  const orphaned = dbRecover.prepare("SELECT id FROM tasks WHERE status = 'doing'").all();
  if (orphaned.length > 0) {
    dbRecover.prepare("UPDATE tasks SET status = 'todo', updated_at = CURRENT_TIMESTAMP WHERE status = 'doing'").run();
    console.log(`[AgentWork] Recovered ${orphaned.length} orphaned task(s) from 'doing' → 'todo'`);
  }

  // Initialize task scheduler
  const { initScheduler } = require('./services/scheduler');
  initScheduler(io);

  // Initialize chat platform bots (Telegram/Slack)
  const { initPlatforms } = require('./services/platforms');
  initPlatforms().catch((err) => console.error('[Platforms] init error:', err.message));

  // Pre-warm OpenRouter pricing cache if key is configured
  const { db: dbInit } = require('./db');
  const orKey = dbInit.prepare("SELECT value FROM settings WHERE key = 'openrouter_api_key'").get()?.value;
  if (orKey) {
    const { fetchOpenRouterPricing } = require('./services/ai');
    fetchOpenRouterPricing().catch(() => {});
  }

  // Next.js handler for everything else
  server.all('*', (req, res) => handle(req, res));

  httpServer.listen(PORT, () => {
    console.log(`[AgentWork] Server running on http://localhost:${PORT}`);
    console.log(`[AgentWork] Environment: ${dev ? 'development' : 'production'}`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[AgentWork] Shutting down...');
    const { db } = require('./db');
    // Stop platform bots
    try {
      const { activeBots } = require('./services/platforms');
      if (activeBots) {
        for (const [, entry] of activeBots) {
          try { entry.stop(); } catch {}
        }
      }
    } catch {}
    // Set all agents to offline
    db.prepare("UPDATE agents SET status = 'offline'").run();
    httpServer.close(() => {
      db.close();
      process.exit(0);
    });
    // Force close after 5s
    setTimeout(() => process.exit(0), 5000);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
});
