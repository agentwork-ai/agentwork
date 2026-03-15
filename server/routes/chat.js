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
