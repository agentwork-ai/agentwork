const express = require('express');
const router = express.Router();
const { db, logAudit } = require('../db');
const { encrypt, decrypt, isSensitiveKey } = require('../crypto');
const {
  buildAuthOverview,
  completeCodexOAuthFlow,
  deleteProfile,
  getCodexOAuthFlowStatus,
  importCodexCliProfile,
  importGeminiCliProfile,
  saveAnthropicSetupToken,
  startCodexOAuthFlow,
} = require('../services/provider-auth');

// Get all settings (decrypt sensitive values)
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  rows.forEach((r) => {
    settings[r.key] = isSensitiveKey(r.key) ? decrypt(r.value) : r.value;
  });
  res.json(settings);
});

router.get('/provider-auth', (req, res) => {
  res.json(buildAuthOverview());
});

router.post('/provider-auth/anthropic/setup-token', (req, res) => {
  try {
    saveAnthropicSetupToken(req.body?.token);
    logAudit('update', 'provider_auth', 'anthropic', 'setup-token');
    res.json(buildAuthOverview());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/provider-auth/openai-codex/import', (req, res) => {
  try {
    importCodexCliProfile();
    logAudit('update', 'provider_auth', 'openai-codex', 'import-local');
    res.json(buildAuthOverview());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/provider-auth/openai-codex/login', async (req, res) => {
  try {
    const result = await startCodexOAuthFlow();
    logAudit('update', 'provider_auth', 'openai-codex', 'oauth-start');
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/provider-auth/openai-codex/login/:flowId', (req, res) => {
  try {
    res.json(getCodexOAuthFlowStatus(req.params.flowId));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.post('/provider-auth/openai-codex/login/:flowId/complete', async (req, res) => {
  try {
    const result = await completeCodexOAuthFlow(req.params.flowId, req.body?.authorization_response);
    logAudit('update', 'provider_auth', 'openai-codex', 'oauth-complete');
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/provider-auth/google-gemini-cli/import', (req, res) => {
  try {
    importGeminiCliProfile({ projectId: req.body?.project_id });
    logAudit('update', 'provider_auth', 'google-gemini-cli', 'import-local');
    res.json(buildAuthOverview());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/provider-auth/:provider', (req, res) => {
  const provider = String(req.params.provider || '').trim();
  if (!['anthropic', 'openai-codex', 'google-gemini-cli'].includes(provider)) {
    return res.status(404).json({ error: 'Unknown provider auth profile' });
  }

  deleteProfile(provider);
  logAudit('delete', 'provider_auth', provider, 'clear-profile');
  return res.json(buildAuthOverview());
});

// Update settings
router.put('/', (req, res) => {
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?'
  );

  const tx = db.transaction((entries) => {
    for (const [key, value] of entries) {
      const val = isSensitiveKey(key) ? encrypt(String(value)) : String(value);
      upsert.run(key, val, val);
    }
  });

  tx(Object.entries(req.body));
  logAudit('update', 'settings', null, Object.keys(req.body).join(', '));

  const rows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  rows.forEach((r) => {
    settings[r.key] = isSensitiveKey(r.key) ? decrypt(r.value) : r.value;
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

// Generate usage report
router.get('/report', (req, res) => {
  const days = parseInt(req.query.days || '30');

  const totalTasks = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE created_at >= date('now', ?)").get(`-${days} days`).c;
  const completedTasks = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'done' AND completed_at >= date('now', ?)").get(`-${days} days`).c;
  const blockedTasks = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'blocked' AND updated_at >= date('now', ?)").get(`-${days} days`).c;

  const spend = db.prepare("SELECT COALESCE(SUM(cost_usd), 0) as total, COALESCE(SUM(input_tokens + output_tokens), 0) as tokens FROM budget_logs WHERE created_at >= date('now', ?)").get(`-${days} days`);

  const topAgents = db.prepare(
    `SELECT a.name, a.avatar, COUNT(t.id) as tasks_done, COALESCE(SUM(b.cost_usd), 0) as cost
     FROM agents a
     LEFT JOIN tasks t ON t.agent_id = a.id AND t.status = 'done' AND t.completed_at >= date('now', ?)
     LEFT JOIN budget_logs b ON b.agent_id = a.id AND b.created_at >= date('now', ?)
     GROUP BY a.id ORDER BY tasks_done DESC LIMIT 5`
  ).all(`-${days} days`, `-${days} days`);

  const topModels = db.prepare(
    `SELECT model, provider, SUM(cost_usd) as cost, SUM(input_tokens + output_tokens) as tokens, COUNT(*) as calls
     FROM budget_logs WHERE created_at >= date('now', ?)
     GROUP BY provider, model ORDER BY cost DESC LIMIT 5`
  ).all(`-${days} days`);

  const dailySpend = db.prepare(
    `SELECT date(created_at) as date, SUM(cost_usd) as cost
     FROM budget_logs WHERE created_at >= date('now', ?)
     GROUP BY date(created_at) ORDER BY date ASC`
  ).all(`-${days} days`);

  res.json({
    period: `Last ${days} days`,
    tasks: { total: totalTasks, completed: completedTasks, blocked: blockedTasks },
    spend: { total: spend.total, tokens: spend.tokens },
    topAgents, topModels, dailySpend,
    generatedAt: new Date().toISOString(),
  });
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

// List installed plugins
router.get('/plugins', (req, res) => {
  const { getPlugins } = require('../plugins');
  res.json(getPlugins());
});

module.exports = router;
