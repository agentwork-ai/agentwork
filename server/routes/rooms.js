const express = require('express');
const router = express.Router();
const { db, uuidv4, DATA_DIR, logAudit } = require('../db');
const { createCompletion, createStreamingCompletion, estimateCost } = require('../services/ai');
const fs = require('fs');
const path = require('path');

// ─── Helpers ───

function readFile(filePath) {
  try {
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, 'utf8');
  } catch {}
  return '';
}

function logBudget(agentId, provider, model, inputTokens, outputTokens) {
  const cost = estimateCost(provider, model, inputTokens, outputTokens);
  const id = uuidv4();
  db.prepare(
    'INSERT INTO budget_logs (id, agent_id, provider, model, input_tokens, output_tokens, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, agentId, provider, model, inputTokens, outputTokens, cost);
}

// ─── GET / — List all rooms ───
router.get('/', (req, res) => {
  const rooms = db.prepare('SELECT * FROM chat_rooms ORDER BY created_at DESC').all();
  for (const room of rooms) {
    room.agent_ids = JSON.parse(room.agent_ids || '[]');
  }
  res.json(rooms);
});

// ─── POST / — Create a room ───
router.post('/', (req, res) => {
  const { name, agent_ids } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const agentIds = Array.isArray(agent_ids) ? agent_ids : [];
  const id = uuidv4();

  db.prepare('INSERT INTO chat_rooms (id, name, agent_ids) VALUES (?, ?, ?)').run(
    id, name, JSON.stringify(agentIds)
  );

  logAudit('create', 'chat_room', id, { name, agent_ids: agentIds });

  const room = db.prepare('SELECT * FROM chat_rooms WHERE id = ?').get(id);
  room.agent_ids = JSON.parse(room.agent_ids || '[]');

  const io = req.app.get('io');
  if (io) io.emit('room:created', room);

  res.status(201).json(room);
});

// ─── GET /:id/messages — Get messages for a room ───
router.get('/:id/messages', (req, res) => {
  const room = db.prepare('SELECT * FROM chat_rooms WHERE id = ?').get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const limit = parseInt(req.query.limit || '200');
  const offset = parseInt(req.query.offset || '0');

  const messages = db.prepare(
    'SELECT * FROM room_messages WHERE room_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?'
  ).all(req.params.id, limit, offset);

  res.json(messages);
});

// ─── POST /:id/messages — Send a user message, then get agent responses ───
router.post('/:id/messages', async (req, res) => {
  const room = db.prepare('SELECT * FROM chat_rooms WHERE id = ?').get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'content is required' });

  const agentIds = JSON.parse(room.agent_ids || '[]');
  const io = req.app.get('io');

  // 1. Save and emit the user message
  const userMsgId = uuidv4();
  db.prepare(
    'INSERT INTO room_messages (id, room_id, sender_type, sender_id, sender_name, content) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(userMsgId, room.id, 'user', null, 'You', content);

  const userMsg = db.prepare('SELECT * FROM room_messages WHERE id = ?').get(userMsgId);
  if (io) io.emit('room:message', { roomId: room.id, message: userMsg });

  // 2. Sequentially get a response from each agent in the room
  const agentResponses = [];

  for (const agentId of agentIds) {
    const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
    if (!agent) continue;

    try {
      // Build context: system prompt + recent room history + current user message
      const agentDir = path.join(DATA_DIR, 'agents', agentId);
      const soul = readFile(path.join(agentDir, 'SOUL.md'));
      const memory = readFile(path.join(agentDir, 'MEMORY.md'));

      // Gather recent room messages for context
      const recentRoomMsgs = db.prepare(
        'SELECT * FROM room_messages WHERE room_id = ? ORDER BY created_at DESC LIMIT 30'
      ).all(room.id).reverse();

      const otherAgentNames = agentIds
        .filter((id) => id !== agentId)
        .map((id) => {
          const a = db.prepare('SELECT name FROM agents WHERE id = ?').get(id);
          return a ? a.name : 'Unknown';
        });

      const systemContent = [
        `You are ${agent.name}, a ${agent.role}.`,
        agent.personality ? agent.personality : '',
        `You are in a group brainstorming room called "${room.name}" with the user${otherAgentNames.length ? ` and these other agents: ${otherAgentNames.join(', ')}` : ''}.`,
        'Keep your responses concise and collaborative. Build on what others have said. Stay on topic.',
        soul ? `\n## Your Configuration\n${soul}` : '',
        memory ? `\n## Your Memory\n${memory}` : '',
      ].filter(Boolean).join(' ').trim();

      const messages = [
        { role: 'system', content: systemContent },
        ...recentRoomMsgs.map((m) => ({
          role: m.sender_type === 'user' ? 'user' : (m.sender_id === agentId ? 'assistant' : 'user'),
          content: m.sender_type === 'agent' ? `[${m.sender_name}]: ${m.content}` : m.content,
        })),
      ];

      // Stream response if socket is available, otherwise use non-streaming
      const agentMsgId = uuidv4();
      let response;

      try {
        let streamedContent = '';
        const onChunk = (chunk) => {
          streamedContent += chunk;
          if (io) io.emit('room:stream', { roomId: room.id, msgId: agentMsgId, agentId, agentName: agent.name, chunk, full: streamedContent });
        };
        response = await createStreamingCompletion(agent.provider, agent.model, messages, onChunk);
      } catch {
        // Fallback to non-streaming
        response = await createCompletion(agent.provider, agent.model, messages);
      }

      logBudget(agentId, agent.provider, agent.model, response.inputTokens, response.outputTokens);

      // Save the agent response
      db.prepare(
        'INSERT INTO room_messages (id, room_id, sender_type, sender_id, sender_name, content) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(agentMsgId, room.id, 'agent', agentId, agent.name, response.content);

      const agentMsg = db.prepare('SELECT * FROM room_messages WHERE id = ?').get(agentMsgId);
      if (io) {
        io.emit('room:message', { roomId: room.id, message: agentMsg });
        io.emit('room:stream_end', { roomId: room.id, msgId: agentMsgId });
      }

      agentResponses.push(agentMsg);
    } catch (err) {
      console.error(`[Room] Error getting response from agent ${agent.name}:`, err.message);

      // Save error message so the conversation flow is visible
      const errMsgId = uuidv4();
      db.prepare(
        'INSERT INTO room_messages (id, room_id, sender_type, sender_id, sender_name, content) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(errMsgId, room.id, 'agent', agentId, agent.name, `Error: ${err.message}`);

      const errMsg = db.prepare('SELECT * FROM room_messages WHERE id = ?').get(errMsgId);
      if (io) io.emit('room:message', { roomId: room.id, message: errMsg });

      agentResponses.push(errMsg);
    }
  }

  res.json({ userMessage: userMsg, agentResponses });
});

// ─── DELETE /:id — Delete a room ───
router.delete('/:id', (req, res) => {
  const room = db.prepare('SELECT * FROM chat_rooms WHERE id = ?').get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  db.prepare('DELETE FROM room_messages WHERE room_id = ?').run(req.params.id);
  db.prepare('DELETE FROM chat_rooms WHERE id = ?').run(req.params.id);

  logAudit('delete', 'chat_room', req.params.id, { name: room.name });

  const io = req.app.get('io');
  if (io) io.emit('room:deleted', { id: req.params.id });

  res.json({ success: true });
});

module.exports = router;
