/**
 * Chat Platform Integration Service
 * Manages Telegram and Slack bots per agent.
 * Bridges incoming messages to executor.handleDirectChat
 * and routes agent responses back to the platform.
 */

const { db } = require('../db');
const EventEmitter = require('events');

// Internal bus: platforms subscribe to agent responses
const agentBus = new EventEmitter();
agentBus.setMaxListeners(100);

// Export so executor can emit responses
module.exports.agentBus = agentBus;

// Map of agentId -> { type, stop() }
const activeBots = new Map();

async function startBotForAgent(agent) {
  if (activeBots.has(agent.id)) {
    await stopBotForAgent(agent.id);
  }

  if (!agent.chat_enabled || !agent.chat_platform || !agent.chat_token) return;

  try {
    if (agent.chat_platform === 'telegram') {
      await startTelegramBot(agent);
    } else if (agent.chat_platform === 'slack') {
      await startSlackBot(agent);
    }
  } catch (err) {
    console.error(`[Platforms] Failed to start ${agent.chat_platform} bot for ${agent.name}:`, err.message);
  }
}

async function stopBotForAgent(agentId) {
  const entry = activeBots.get(agentId);
  if (!entry) return;
  try {
    await entry.stop();
  } catch (err) {
    console.error(`[Platforms] Error stopping bot for agent ${agentId}:`, err.message);
  }
  activeBots.delete(agentId);
}

// ----- Telegram -----

async function startTelegramBot(agent) {
  const { Telegraf } = require('telegraf');
  const bot = new Telegraf(agent.chat_token);

  const allowedIds = parseAllowedIds(agent.chat_allowed_ids);

  bot.on('text', async (ctx) => {
    const userId = String(ctx.from.id);
    if (allowedIds.length > 0 && !allowedIds.includes(userId)) return; // silently ignore

    const chatId = ctx.chat.id;
    const text = ctx.message.text;

    console.log(`[Telegram:${agent.name}] Message from ${userId}: ${text.substring(0, 80)}`);

    // Relay agent response back to this chat when it arrives
    const onReply = (reply) => {
      sendTelegramChunks(bot, chatId, reply);
    };
    agentBus.once(`reply:${agent.id}:${chatId}`, onReply);

    // Forward to executor
    const { handleDirectChat } = require('./executor');
    await handleDirectChat(agent.id, text, chatId);
  });

  bot.launch().catch((err) => {
    console.error(`[Telegram:${agent.name}] launch error:`, err.message);
  });

  activeBots.set(agent.id, {
    type: 'telegram',
    stop: () => bot.stop('SIGTERM'),
  });

  console.log(`[Platforms] Telegram bot started for agent: ${agent.name}`);
}

async function sendTelegramChunks(bot, chatId, text) {
  const CHUNK = 4096;
  for (let i = 0; i < text.length; i += CHUNK) {
    try {
      await bot.telegram.sendMessage(chatId, text.substring(i, i + CHUNK));
    } catch (err) {
      console.error(`[Telegram] sendMessage error:`, err.message);
    }
  }
}

// ----- Slack -----

async function startSlackBot(agent) {
  const { App } = require('@slack/bolt');
  const allowedIds = parseAllowedIds(agent.chat_allowed_ids);

  const app = new App({
    token: agent.chat_token,
    appToken: agent.chat_app_token,
    socketMode: true,
  });

  const handleSlackMsg = async ({ message, say }) => {
    const userId = message.user;
    if (!userId) return;
    if (allowedIds.length > 0 && !allowedIds.includes(userId)) return;

    const channelId = message.channel;
    const text = message.text || '';

    console.log(`[Slack:${agent.name}] Message from ${userId}: ${text.substring(0, 80)}`);

    const onReply = (reply) => {
      sendSlackChunks(app, channelId, reply);
    };
    agentBus.once(`reply:${agent.id}:${channelId}`, onReply);

    const { handleDirectChat } = require('./executor');
    await handleDirectChat(agent.id, text, channelId);
  };

  // Direct messages
  app.message(async ({ message, say }) => {
    if (message.channel_type === 'im') {
      await handleSlackMsg({ message, say });
    }
  });

  // Mentions in channels
  app.event('app_mention', async ({ event, say }) => {
    const text = (event.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();
    const channelId = event.channel;
    const userId = event.user;
    if (allowedIds.length > 0 && !allowedIds.includes(userId)) return;

    const onReply = (reply) => {
      sendSlackChunks(app, channelId, reply);
    };
    agentBus.once(`reply:${agent.id}:${channelId}`, onReply);

    const { handleDirectChat } = require('./executor');
    await handleDirectChat(agent.id, text, channelId);
  });

  await app.start();
  activeBots.set(agent.id, {
    type: 'slack',
    stop: () => app.stop(),
  });

  console.log(`[Platforms] Slack bot started for agent: ${agent.name}`);
}

async function sendSlackChunks(app, channelId, text) {
  const CHUNK = 4000;
  for (let i = 0; i < text.length; i += CHUNK) {
    try {
      await app.client.chat.postMessage({
        channel: channelId,
        text: text.substring(i, i + CHUNK),
      });
    } catch (err) {
      console.error(`[Slack] postMessage error:`, err.message);
    }
  }
}

// ----- Helpers -----

function parseAllowedIds(raw) {
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

// ----- Init -----

async function initPlatforms() {
  const agents = db.prepare("SELECT * FROM agents WHERE chat_enabled = 1").all();
  for (const agent of agents) {
    await startBotForAgent(agent).catch((err) =>
      console.error(`[Platforms] init error for ${agent.id}:`, err.message)
    );
  }
  console.log(`[Platforms] Initialized ${agents.length} platform bot(s)`);
}

module.exports = { initPlatforms, startBotForAgent, stopBotForAgent, agentBus, activeBots };
