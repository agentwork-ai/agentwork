const express = require('express');
const router = express.Router();
const { db, logAudit } = require('../db');

// Get all settings
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  rows.forEach((r) => {
    settings[r.key] = r.value;
  });
  res.json(settings);
});

// Update settings
router.put('/', (req, res) => {
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?'
  );

  const tx = db.transaction((entries) => {
    for (const [key, value] of entries) {
      upsert.run(key, String(value), String(value));
    }
  });

  tx(Object.entries(req.body));
  logAudit('update', 'settings', null, Object.keys(req.body).join(', '));

  const rows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  rows.forEach((r) => {
    settings[r.key] = r.value;
  });

  const io = req.app.get('io');
  if (io) io.emit('settings:updated', settings);

  res.json(settings);
});

// Get budget summary
router.get('/budget', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const monthStart = new Date();
  monthStart.setDate(1);

  const dailyUsage = db.prepare(
    "SELECT COALESCE(SUM(cost_usd), 0) as total, COALESCE(SUM(input_tokens), 0) as input_tokens, COALESCE(SUM(output_tokens), 0) as output_tokens FROM budget_logs WHERE date(created_at) = ?"
  ).get(today);

  const monthlyUsage = db.prepare(
    "SELECT COALESCE(SUM(cost_usd), 0) as total, COALESCE(SUM(input_tokens), 0) as input_tokens, COALESCE(SUM(output_tokens), 0) as output_tokens FROM budget_logs WHERE created_at >= ?"
  ).get(monthStart.toISOString());

  const dailyLimit = parseFloat(db.prepare("SELECT value FROM settings WHERE key = 'daily_budget_usd'").get()?.value || '10');
  const monthlyLimit = parseFloat(db.prepare("SELECT value FROM settings WHERE key = 'monthly_budget_usd'").get()?.value || '100');

  res.json({
    daily: { ...dailyUsage, limit: dailyLimit },
    monthly: { ...monthlyUsage, limit: monthlyLimit },
  });
});

// Get budget history
router.get('/budget/history', (req, res) => {
  const days = parseInt(req.query.days || '30');
  const logs = db.prepare(
    `SELECT date(created_at) as date, SUM(cost_usd) as cost, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens
     FROM budget_logs WHERE created_at >= date('now', ?)
     GROUP BY date(created_at) ORDER BY date DESC`
  ).all(`-${days} days`);

  res.json(logs);
});

// Cost breakdown by agent
router.get('/budget/by-agent', (req, res) => {
  const days = parseInt(req.query.days || '30');
  const rows = db.prepare(
    `SELECT b.agent_id, a.name as agent_name, a.avatar,
      SUM(b.cost_usd) as total_cost, SUM(b.input_tokens) as input_tokens, SUM(b.output_tokens) as output_tokens,
      COUNT(*) as call_count
     FROM budget_logs b LEFT JOIN agents a ON b.agent_id = a.id
     WHERE b.created_at >= date('now', ?)
     GROUP BY b.agent_id ORDER BY total_cost DESC`
  ).all(`-${days} days`);
  res.json(rows);
});

// Cost breakdown by model
router.get('/budget/by-model', (req, res) => {
  const days = parseInt(req.query.days || '30');
  const rows = db.prepare(
    `SELECT provider, model, SUM(cost_usd) as total_cost,
      SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens, COUNT(*) as call_count
     FROM budget_logs WHERE created_at >= date('now', ?)
     GROUP BY provider, model ORDER BY total_cost DESC`
  ).all(`-${days} days`);
  res.json(rows);
});

// Export data as JSON
router.get('/export', (req, res) => {
  const type = req.query.type || 'all';
  const data = {};
  if (type === 'all' || type === 'tasks') {
    data.tasks = db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all();
  }
  if (type === 'all' || type === 'agents') {
    data.agents = db.prepare('SELECT id, name, avatar, role, auth_type, provider, model, status, personality, created_at FROM agents ORDER BY created_at DESC').all();
  }
  if (type === 'all' || type === 'projects') {
    data.projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
  }
  if (type === 'all' || type === 'budget') {
    data.budget_logs = db.prepare('SELECT * FROM budget_logs ORDER BY created_at DESC LIMIT 10000').all();
  }
  if (type === 'all' || type === 'messages') {
    data.messages = db.prepare('SELECT * FROM messages ORDER BY created_at DESC LIMIT 10000').all();
  }
  data.exported_at = new Date().toISOString();
  res.setHeader('Content-Disposition', `attachment; filename="agentwork-export-${new Date().toISOString().split('T')[0]}.json"`);
  res.json(data);
});

// Get audit logs
router.get('/audit-logs', (req, res) => {
  const limit = parseInt(req.query.limit || '100');
  const offset = parseInt(req.query.offset || '0');
  const logs = db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
  const total = db.prepare('SELECT COUNT(*) as count FROM audit_logs').get().count;
  res.json({ logs, total });
});

module.exports = router;
