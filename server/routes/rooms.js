const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const router = express.Router();
const { db, uuidv4, logAudit } = require('../db');
const {
  createCompletion,
  createStreamingCompletion,
  estimateCost,
  chatWithClaudeAgent,
  chatWithCodexAgent,
  createCodexClient,
} = require('../services/ai');
const { buildAgentContext, buildChatSystemPrompt } = require('../services/agent-context');

const roomCliSessions = new Map();

function getSetting(key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || '';
}

function resolveConfiguredWorkspaceDir() {
  const configured = String(getSetting('default_workspace') || '').trim();
  if (!configured) return '';

  const resolved = path.resolve(configured);
  try {
    fs.mkdirSync(resolved, { recursive: true });
  } catch {}
  return resolved;
}

function resolveChatWorkingDirectory() {
  return resolveConfiguredWorkspaceDir() || os.homedir() || process.cwd();
}

function isCodexAgent(agent) {
  return agent?.provider === 'codex-cli'
    || agent?.provider === 'openai-codex'
    || (agent?.auth_type === 'cli' && agent?.provider === 'openai');
}

function usesCliRuntime(agent) {
  return Boolean(agent) && (
    agent.auth_type === 'cli'
    || agent.provider === 'claude-cli'
    || isCodexAgent(agent)
  );
}

function slugifyMentionValue(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function compactMentionValue(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function buildMentionDirectory(agents) {
  const aliasCounts = new Map();
  const rawAliasesByAgent = new Map();

  for (const agent of agents) {
    const name = agent.name || '';
    const words = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const fullSlug = slugifyMentionValue(name);
    const compact = compactMentionValue(name);
    const aliases = new Set();

    if (words[0]) aliases.add(words[0]);
    if (fullSlug) aliases.add(fullSlug);
    if (compact) aliases.add(compact);

    const aliasList = Array.from(aliases).filter(Boolean);
    rawAliasesByAgent.set(agent.id, aliasList);
    for (const alias of aliasList) {
      aliasCounts.set(alias, (aliasCounts.get(alias) || 0) + 1);
    }
  }

  const handles = [];
  const aliasToAgent = new Map();

  for (let idx = 0; idx < agents.length; idx += 1) {
    const agent = agents[idx];
    const name = agent.name || '';
    const words = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const fullSlug = slugifyMentionValue(name);
    const aliasCandidates = rawAliasesByAgent.get(agent.id) || [];
    const uniqueAliases = aliasCandidates.filter((alias) => aliasCounts.get(alias) === 1);

    let handle = uniqueAliases[0] || fullSlug || `agent-${idx + 1}`;
    if (handles.some((entry) => entry.handle === handle)) {
      let suffix = 2;
      while (handles.some((entry) => entry.handle === `${handle}-${suffix}`)) suffix += 1;
      handle = `${handle}-${suffix}`;
    }

    const aliases = Array.from(new Set([
      handle,
      ...uniqueAliases,
      fullSlug,
      compactMentionValue(name),
      words[0] || '',
    ].filter(Boolean)));

    const entry = {
      agentId: agent.id,
      name: agent.name,
      handle,
      aliases,
    };

    handles.push(entry);
    for (const alias of aliases) {
      if (!aliasToAgent.has(alias)) aliasToAgent.set(alias, entry);
    }
  }

  return { handles, aliasToAgent };
}

function extractMentionedAgents(content, mentionDirectory) {
  const matches = String(content || '').matchAll(/@([a-zA-Z0-9][a-zA-Z0-9._-]*)/g);
  const ordered = [];
  const seen = new Set();

  for (const match of matches) {
    const alias = slugifyMentionValue(match[1]);
    const entry = mentionDirectory.aliasToAgent.get(alias);
    if (!entry || seen.has(entry.agentId)) continue;
    seen.add(entry.agentId);
    ordered.push(entry);
  }

  return ordered;
}

function mapRoomMessagesForModel(roomMessages, agentId) {
  return roomMessages.map((message) => {
    if (message.sender_type === 'user') {
      return { role: 'user', content: message.content };
    }

    if (message.sender_id === agentId) {
      return { role: 'assistant', content: message.content };
    }

    return {
      role: 'user',
      content: `[${message.sender_name || 'Agent'}]: ${message.content}`,
    };
  });
}

function buildRoomSystemPrompt(agent, agentContext, room, mentionDirectory, mentionedEntry) {
  const participantList = mentionDirectory.handles
    .map((entry) => `@${entry.handle} = ${entry.name}`)
    .join(', ');

  return [
    buildChatSystemPrompt(agent, agentContext),
    `## Group Chat Context
You are participating in the shared room "${room.name}".
Mention handles in this room: ${participantList || 'None'}.
You are replying because the latest user message explicitly mentioned you as @${mentionedEntry.handle}.
Act like one participant in a multi-agent room, not like the only assistant in the conversation.
Keep your response concise, collaborative, and on-topic.
Do not answer on behalf of agents who were not mentioned.`,
  ].join('\n\n');
}

function buildCliRoomPrompt(agent, systemPrompt, roomMessages, mentionedEntry) {
  const transcript = roomMessages.map((message) => {
    const label = message.sender_type === 'user'
      ? 'User'
      : `${message.sender_name || 'Agent'}${message.sender_id === agent.id ? ' (you)' : ''}`;
    return `${label}: ${message.content}`;
  }).join('\n\n');

  return `${systemPrompt}

## Room Transcript
${transcript}

## Your Turn
You were directly mentioned as @${mentionedEntry.handle} in the latest user message. Reply now.`;
}

function logBudget(agentId, provider, model, inputTokens, outputTokens) {
  const cost = estimateCost(provider, model, inputTokens, outputTokens);
  const id = uuidv4();
  db.prepare(
    'INSERT INTO budget_logs (id, agent_id, provider, model, input_tokens, output_tokens, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, agentId, provider, model, inputTokens, outputTokens, cost);
}

async function getRoomAgentResponse(agent, room, roomMessages, mentionDirectory, mentionedEntry, io, agentMsgId) {
  const agentContext = buildAgentContext(agent.id, agent, { includeMemory: true, includeHeartbeat: false });
  const systemPrompt = buildRoomSystemPrompt(agent, agentContext, room, mentionDirectory, mentionedEntry);

  if (usesCliRuntime(agent)) {
    const workDir = resolveChatWorkingDirectory();
    const prompt = buildCliRoomPrompt(agent, systemPrompt, roomMessages, mentionedEntry);

    if (agent.provider === 'anthropic' || agent.provider === 'claude-cli') {
      const cacheKey = `${room.id}:${agent.id}:claude`;
      const session = roomCliSessions.get(cacheKey);
      const result = await chatWithClaudeAgent(prompt, session?.sessionId || null, workDir);
      roomCliSessions.set(cacheKey, { sessionId: result.sessionId });
      if (!result.content?.trim()) {
        throw new Error('Claude completed without returning a response.');
      }
      return { content: result.content };
    }

    if (isCodexAgent(agent)) {
      let Codex;
      try {
        ({ Codex } = await import('@openai/codex-sdk'));
      } catch (importErr) {
        throw new Error(`Failed to load Codex SDK: ${importErr.message}.`);
      }

      const cacheKey = `${room.id}:${agent.id}:codex`;
      let session = roomCliSessions.get(cacheKey);
      if (!session?.thread) {
        const client = createCodexClient(Codex);
        session = {
          thread: client.startThread({
            workingDirectory: workDir,
            approvalPolicy: 'never',
            sandboxMode: 'danger-full-access',
          }),
        };
        roomCliSessions.set(cacheKey, session);
      }

      const result = await chatWithCodexAgent(prompt, session.thread);
      if (!result.content?.trim()) {
        throw new Error('Codex completed without returning a response.');
      }
      return { content: result.content };
    }

    throw new Error(`Unknown CLI provider: ${agent.provider}`);
  }

  const modelMessages = [
    { role: 'system', content: systemPrompt },
    ...mapRoomMessagesForModel(roomMessages, agent.id),
  ];

  let streamedContent = '';
  const onChunk = (chunk) => {
    streamedContent += chunk;
    if (io) {
      io.emit('room:stream', {
        roomId: room.id,
        msgId: agentMsgId,
        agentId: agent.id,
        agentName: agent.name,
        chunk,
        full: streamedContent,
      });
    }
  };

  try {
    const response = await createStreamingCompletion(agent.provider, agent.model, modelMessages, onChunk);
    if (!response.content?.trim()) {
      throw new Error('Agent completed without returning a response.');
    }
    return response;
  } catch (streamErr) {
    const response = await createCompletion(agent.provider, agent.model, modelMessages);
    if (!response.content?.trim()) {
      throw new Error('Agent completed without returning a response.');
    }
    return response;
  }
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

  const dedupedAgentIds = Array.from(new Set(Array.isArray(agent_ids) ? agent_ids.filter(Boolean) : []));
  const id = uuidv4();

  db.prepare('INSERT INTO chat_rooms (id, name, agent_ids) VALUES (?, ?, ?)').run(
    id, name.trim(), JSON.stringify(dedupedAgentIds)
  );

  logAudit('create', 'chat_room', id, { name: name.trim(), agent_ids: dedupedAgentIds });

  const room = db.prepare('SELECT * FROM chat_rooms WHERE id = ?').get(id);
  room.agent_ids = JSON.parse(room.agent_ids || '[]');

  const io = req.app.get('io');
  if (io) io.emit('room:created', room);

  res.status(201).json(room);
});

// ─── PUT /:id — Update a room ───
router.put('/:id', (req, res) => {
  const room = db.prepare('SELECT * FROM chat_rooms WHERE id = ?').get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const nextName = String(req.body.name || '').trim();
  if (!nextName) return res.status(400).json({ error: 'name is required' });

  const nextAgentIds = Array.from(new Set(
    Array.isArray(req.body.agent_ids)
      ? req.body.agent_ids.filter(Boolean)
      : JSON.parse(room.agent_ids || '[]')
  ));

  db.prepare('UPDATE chat_rooms SET name = ?, agent_ids = ? WHERE id = ?').run(
    nextName,
    JSON.stringify(nextAgentIds),
    req.params.id,
  );

  const updatedRoom = db.prepare('SELECT * FROM chat_rooms WHERE id = ?').get(req.params.id);
  updatedRoom.agent_ids = JSON.parse(updatedRoom.agent_ids || '[]');

  logAudit('update', 'chat_room', req.params.id, { name: nextName, agent_ids: nextAgentIds });

  const io = req.app.get('io');
  if (io) io.emit('room:updated', updatedRoom);

  res.json(updatedRoom);
});

// ─── GET /:id/messages — Get messages for a room ───
router.get('/:id/messages', (req, res) => {
  const room = db.prepare('SELECT * FROM chat_rooms WHERE id = ?').get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const limit = parseInt(req.query.limit || '200', 10);
  const offset = parseInt(req.query.offset || '0', 10);

  const messages = db.prepare(
    'SELECT * FROM room_messages WHERE room_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?'
  ).all(req.params.id, limit, offset);

  res.json(messages);
});

// ─── POST /:id/messages — Send a user message, then get mentioned agent responses ───
router.post('/:id/messages', async (req, res) => {
  const room = db.prepare('SELECT * FROM chat_rooms WHERE id = ?').get(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const { content } = req.body;
  if (!content) return res.status(400).json({ error: 'content is required' });

  const roomAgentIds = JSON.parse(room.agent_ids || '[]');
  const roomAgents = roomAgentIds
    .map((agentId) => db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId))
    .filter(Boolean);

  const mentionDirectory = buildMentionDirectory(roomAgents);
  const mentionedAgents = extractMentionedAgents(content, mentionDirectory);
  const io = req.app.get('io');

  const userMsgId = uuidv4();
  db.prepare(
    'INSERT INTO room_messages (id, room_id, sender_type, sender_id, sender_name, content) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(userMsgId, room.id, 'user', null, 'You', content.trim());

  const userMsg = db.prepare('SELECT * FROM room_messages WHERE id = ?').get(userMsgId);
  if (io) io.emit('room:message', { roomId: room.id, message: userMsg });

  if (mentionedAgents.length === 0) {
    return res.json({
      userMessage: userMsg,
      agentResponses: [],
      mentionedAgentIds: [],
      availableMentions: mentionDirectory.handles,
    });
  }

  const roomMessages = db.prepare(
    'SELECT * FROM room_messages WHERE room_id = ? ORDER BY created_at DESC LIMIT 30'
  ).all(room.id).reverse();

  const agentResponses = [];

  for (const mentionedEntry of mentionedAgents) {
    const agent = roomAgents.find((item) => item.id === mentionedEntry.agentId);
    if (!agent) continue;

    const agentMsgId = uuidv4();

    try {
      if (io) {
        io.emit('room:typing', {
          roomId: room.id,
          agentId: agent.id,
          agentName: agent.name,
          msgId: agentMsgId,
        });
      }

      const response = await getRoomAgentResponse(
        agent,
        room,
        roomMessages,
        mentionDirectory,
        mentionedEntry,
        io,
        agentMsgId,
      );

      if (response.inputTokens || response.outputTokens) {
        logBudget(agent.id, agent.provider, agent.model, response.inputTokens || 0, response.outputTokens || 0);
      }

      db.prepare(
        'INSERT INTO room_messages (id, room_id, sender_type, sender_id, sender_name, content) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(agentMsgId, room.id, 'agent', agent.id, agent.name, response.content);

      const agentMsg = db.prepare('SELECT * FROM room_messages WHERE id = ?').get(agentMsgId);
      if (io) {
        io.emit('room:message', { roomId: room.id, message: agentMsg });
        io.emit('room:stream_end', { roomId: room.id, msgId: agentMsgId });
      }

      agentResponses.push(agentMsg);
      roomMessages.push(agentMsg);
    } catch (err) {
      console.error(`[Room] Error getting response from agent ${agent.name}:`, err.message);

      const errMsgId = uuidv4();
      db.prepare(
        'INSERT INTO room_messages (id, room_id, sender_type, sender_id, sender_name, content) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(errMsgId, room.id, 'agent', agent.id, agent.name, `⚠ Error: ${err.message}`);

      const errMsg = db.prepare('SELECT * FROM room_messages WHERE id = ?').get(errMsgId);
      if (io) io.emit('room:message', { roomId: room.id, message: errMsg });

      agentResponses.push(errMsg);
      roomMessages.push(errMsg);
    } finally {
      if (io) {
        io.emit('room:typing_end', {
          roomId: room.id,
          agentId: agent.id,
          msgId: agentMsgId,
        });
      }
    }
  }

  res.json({
    userMessage: userMsg,
    agentResponses,
    mentionedAgentIds: mentionedAgents.map((entry) => entry.agentId),
    availableMentions: mentionDirectory.handles,
  });
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
