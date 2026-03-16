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

// Get audit logs
router.get('/audit-logs', (req, res) => {
  const limit = parseInt(req.query.limit || '100');
  const offset = parseInt(req.query.offset || '0');
  const logs = db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
  const total = db.prepare('SELECT COUNT(*) as count FROM audit_logs').get().count;
  res.json({ logs, total });
});

module.exports = router;
