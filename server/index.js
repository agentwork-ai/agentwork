const express = require('express');
const http = require('http');
const { Server: SocketServer } = require('socket.io');
const next = require('next');
const path = require('path');

const PORT = parseInt(process.env.PORT || '1248', 10);
const dev = process.env.NODE_ENV !== 'production';
const ROOT = process.env.AGENTHUB_ROOT || path.resolve(__dirname, '..');

// Set AGENTHUB_ROOT for other modules
process.env.AGENTHUB_ROOT = ROOT;

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

  // API routes
  server.use('/api/projects', require('./routes/projects'));
  server.use('/api/tasks', require('./routes/tasks'));
  server.use('/api/agents', require('./routes/agents'));
  server.use('/api/settings', require('./routes/settings'));
  server.use('/api/chat', require('./routes/chat'));
  server.use('/api/files', require('./routes/files'));

  // Status endpoint
  const { getSystemStatus } = require('./socket');
  server.get('/api/status', (req, res) => {
    res.json(getSystemStatus());
  });

  // Initialize socket handlers
  const { initSocket } = require('./socket');
  initSocket(io);

  // Initialize executor service
  const { initExecutor } = require('./services/executor');
  initExecutor(io);

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
    console.log(`[AgentHub] Server running on http://localhost:${PORT}`);
    console.log(`[AgentHub] Environment: ${dev ? 'development' : 'production'}`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[AgentHub] Shutting down...');
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
