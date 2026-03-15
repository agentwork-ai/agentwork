const { db } = require('../db');

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : '';
}

async function createCompletion(provider, model, messages, options = {}) {
  const apiKey =
    provider === 'anthropic'
      ? getSetting('anthropic_api_key')
      : getSetting('openai_api_key');

  const customBaseUrl = getSetting('custom_base_url');

  if (!apiKey && !customBaseUrl) {
    throw new Error(`No API key configured for ${provider}. Set it in Settings.`);
  }

  if (provider === 'anthropic') {
    return callAnthropic(apiKey, model, messages, options, customBaseUrl);
  } else {
    return callOpenAI(apiKey, model, messages, options, customBaseUrl);
  }
}

async function callAnthropic(apiKey, model, messages, options, customBaseUrl) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({
    apiKey,
    ...(customBaseUrl ? { baseURL: customBaseUrl } : {}),
  });

  const systemMessage = messages.find((m) => m.role === 'system');
  const chatMessages = messages.filter((m) => m.role !== 'system');

  const response = await client.messages.create({
    model: model || 'claude-sonnet-4-20250514',
    max_tokens: options.maxTokens || 4096,
    system: systemMessage?.content || '',
    messages: chatMessages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  });

  const inputTokens = response.usage?.input_tokens || 0;
  const outputTokens = response.usage?.output_tokens || 0;
  const content = response.content.map((c) => c.text).join('');

  return {
    content,
    inputTokens,
    outputTokens,
    model: response.model,
    stopReason: response.stop_reason,
  };
}

async function callOpenAI(apiKey, model, messages, options, customBaseUrl) {
  const OpenAI = require('openai');
  const client = new OpenAI({
    apiKey,
    ...(customBaseUrl ? { baseURL: customBaseUrl } : {}),
  });

  const response = await client.chat.completions.create({
    model: model || 'gpt-4o',
    max_tokens: options.maxTokens || 4096,
    messages,
  });

  const choice = response.choices[0];
  const inputTokens = response.usage?.prompt_tokens || 0;
  const outputTokens = response.usage?.completion_tokens || 0;

  return {
    content: choice.message.content,
    inputTokens,
    outputTokens,
    model: response.model,
    stopReason: choice.finish_reason,
  };
}

// Calculate cost based on model
function estimateCost(provider, model, inputTokens, outputTokens) {
  // Approximate pricing per 1M tokens
  const pricing = {
    'claude-sonnet-4-20250514': { input: 3, output: 15 },
    'claude-opus-4-20250514': { input: 15, output: 75 },
    'claude-haiku-4-5-20251001': { input: 0.8, output: 4 },
    'gpt-4o': { input: 2.5, output: 10 },
    'gpt-4o-mini': { input: 0.15, output: 0.6 },
    'gpt-4-turbo': { input: 10, output: 30 },
  };

  const rates = pricing[model] || { input: 3, output: 15 };
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
}

module.exports = { createCompletion, estimateCost };
