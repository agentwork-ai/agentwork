/**
 * Discord Bot Integration Service
 * Requires: discord_bot_token setting.
 * To use: npm install discord.js, then enable via agent chat_platform = 'discord'.
 *
 * This is a service stub. Install discord.js to activate:
 *   npm install discord.js
 */
const { db } = require('../db');

let discordClient = null;

async function startDiscordBot(agent) {
  try {
    const { Client, GatewayIntentBits } = require('discord.js');
    const token = agent.chat_token;
    if (!token) return;

    const client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
    });

    client.on('messageCreate', async (message) => {
      if (message.author.bot) return;
      const allowedIds = (agent.chat_allowed_ids || '').split(',').filter(Boolean);
      if (allowedIds.length > 0 && !allowedIds.includes(message.author.id)) return;

      // Route to agent chat handler
      const { handleDirectChat } = require('./executor');
      const platformChatId = `discord:${message.channelId}`;
      const { agentBus } = require('./platforms');

      agentBus.once(`reply:${agent.id}:${platformChatId}`, async (reply) => {
        // Chunk responses for Discord's 2000 char limit
        const chunks = reply.match(/.{1,1900}/gs) || [reply];
        for (const chunk of chunks) {
          await message.reply(chunk);
        }
      });

      handleDirectChat(agent.id, message.content, platformChatId);
    });

    await client.login(token);
    discordClient = client;
    console.log(`[Discord] Bot started for agent ${agent.name}`);
    return client;
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      console.warn('[Discord] discord.js not installed. Run: npm install discord.js');
    } else {
      console.error(`[Discord] Error: ${err.message}`);
    }
    return null;
  }
}

async function stopDiscordBot() {
  if (discordClient) {
    discordClient.destroy();
    discordClient = null;
  }
}

module.exports = { startDiscordBot, stopDiscordBot };
