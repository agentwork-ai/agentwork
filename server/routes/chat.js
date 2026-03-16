const express = require('express');
const router = express.Router();
const { db } = require('../db');

// Get messages for an agent
router.get('/:agentId', (req, res) => {
  const limit = parseInt(req.query.limit || '100');
  const offset = parseInt(req.query.offset || '0');

  const messages = db.prepare(
    'SELECT * FROM messages WHERE agent_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?'
  ).all(req.params.agentId, limit, offset);

  res.json(messages);
});

// Search messages
router.get('/:agentId/search', (req, res) => {
  const query = req.query.q;
  if (!query) return res.json([]);
  const messages = db.prepare(
    "SELECT * FROM messages WHERE agent_id = ? AND content LIKE ? ORDER BY created_at DESC LIMIT 50"
  ).all(req.params.agentId, `%${query}%`);
  res.json(messages);
});

// Export chat as markdown
router.get('/:agentId/export', (req, res) => {
  const agent = db.prepare('SELECT name FROM agents WHERE id = ?').get(req.params.agentId);
  const agentName = agent?.name || 'Agent';
  const messages = db.prepare(
    'SELECT * FROM messages WHERE agent_id = ? ORDER BY created_at ASC'
  ).all(req.params.agentId);

  let md = `# Chat with ${agentName}\n\nExported: ${new Date().toISOString()}\n\n---\n\n`;
  for (const msg of messages) {
    const time = new Date(msg.created_at).toLocaleString();
    const sender = msg.sender === 'user' ? 'You' : agentName;
    md += `**${sender}** (${time}):\n\n${msg.content}\n\n---\n\n`;
  }

  res.setHeader('Content-Type', 'text/markdown');
  res.setHeader('Content-Disposition', `attachment; filename="chat-${agentName.replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.md"`);
  res.send(md);
});

// Get unread notification count
router.get('/notifications/count', (req, res) => {
  // Messages from agents that haven't been responded to
  const count = db.prepare(
    `SELECT COUNT(DISTINCT agent_id) as count FROM messages m
     WHERE m.sender = 'agent'
     AND NOT EXISTS (
       SELECT 1 FROM messages m2
       WHERE m2.agent_id = m.agent_id
       AND m2.sender = 'user'
       AND m2.created_at > m.created_at
     )`
  ).get();

  res.json(count);
});

module.exports = router;
