const { db } = require('../db');

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : '';
}

// Cache of OpenRouter model pricing: { modelId: { input, output } } in $/M tokens
let openRouterPricingCache = null;
let openRouterPricingFetchedAt = 0;
const PRICING_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

async function fetchOpenRouterPricing() {
  const now = Date.now();
  if (openRouterPricingCache && now - openRouterPricingFetchedAt < PRICING_CACHE_TTL_MS) {
    return openRouterPricingCache;
  }

  try {
    const apiKey = getSetting('openrouter_api_key');
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const res = await fetch('https://openrouter.ai/api/v1/models', { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { data } = await res.json();

    const cache = {};
    for (const m of data) {
      const p = m.pricing;
      if (!p) continue;
      const input = parseFloat(p.prompt) * 1_000_000;   // convert per-token → per-million
      const output = parseFloat(p.completion) * 1_000_000;
      if (!isNaN(input) && !isNaN(output)) {
        cache[m.id] = { input, output };
      }
    }

    openRouterPricingCache = cache;
    openRouterPricingFetchedAt = now;
    console.log(`[AI] Cached OpenRouter pricing for ${Object.keys(cache).length} models`);
    return cache;
  } catch (err) {
    console.warn(`[AI] Failed to fetch OpenRouter pricing: ${err.message}`);
    return openRouterPricingCache || {};
  }
}

// API-based completion with optional fallback
async function createCompletion(provider, model, messages, options = {}) {
  try {
    return await _createCompletion(provider, model, messages, options);
  } catch (err) {
    if (options.fallbackModel && options.fallbackModel !== model) {
      console.log(`[AI] Primary model ${model} failed (${err.message}), falling back to ${options.fallbackModel}`);
      return await _createCompletion(provider, options.fallbackModel, messages, { ...options, fallbackModel: undefined });
    }
    throw err;
  }
}

async function _createCompletion(provider, model, messages, options = {}) {
  let apiKey;
  let customBaseUrl = getSetting('custom_base_url');

  const keyMap = {
    anthropic: 'anthropic_api_key',
    openai: 'openai_api_key',
    openrouter: 'openrouter_api_key',
    deepseek: 'deepseek_api_key',
    mistral: 'mistral_api_key',
    google: 'openai_api_key',
  };
  apiKey = getSetting(keyMap[provider] || 'openai_api_key');

  if (!apiKey && !customBaseUrl) {
    const labels = { anthropic: 'Anthropic', openai: 'OpenAI', openrouter: 'OpenRouter', deepseek: 'DeepSeek', mistral: 'Mistral', google: 'Google' };
    throw new Error(`No API key configured for "${provider}". Go to Settings → API Providers to add your ${labels[provider] || provider} API key.`);
  }

  if (provider === 'anthropic') {
    return callAnthropic(apiKey, model, messages, options, customBaseUrl);
  } else if (provider === 'openrouter') {
    // Warm pricing cache in background so cost logging is accurate
    if (!openRouterPricingCache) fetchOpenRouterPricing().catch(() => {});
    return callOpenRouter(apiKey, model, messages, options);
  } else if (provider === 'deepseek') {
    return callOpenAI(apiKey, model, messages, options, 'https://api.deepseek.com');
  } else if (provider === 'mistral') {
    return callOpenAI(apiKey, model, messages, options, 'https://api.mistral.ai/v1');
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

  const requestParams = {
    model: model || 'claude-sonnet-4-20250514',
    max_tokens: options.maxTokens || 8096,
    system: systemMessage?.content || '',
    messages: chatMessages,
  };

  if (options.tools && options.tools.length > 0) {
    requestParams.tools = options.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  const response = await client.messages.create(requestParams);

  const inputTokens = response.usage?.input_tokens || 0;
  const outputTokens = response.usage?.output_tokens || 0;
  const content = response.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
  const toolCalls = response.content
    .filter((c) => c.type === 'tool_use')
    .map((c) => ({ id: c.id, name: c.name, input: c.input }));
  const rawAssistantMsg = toolCalls.length > 0 ? { role: 'assistant', content: response.content } : null;

  return { content, toolCalls, rawAssistantMsg, inputTokens, outputTokens, model: response.model, stopReason: response.stop_reason };
}

async function callOpenAI(apiKey, model, messages, options, customBaseUrl) {
  const OpenAI = require('openai');
  const client = new OpenAI({
    apiKey,
    ...(customBaseUrl ? { baseURL: customBaseUrl } : {}),
  });

  const requestParams = {
    model: model || 'gpt-4o',
    max_tokens: options.maxTokens || 8096,
    messages,
  };

  if (options.tools && options.tools.length > 0) {
    requestParams.tools = options.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  const response = await client.chat.completions.create(requestParams);

  const choice = response.choices[0];
  const inputTokens = response.usage?.prompt_tokens || 0;
  const outputTokens = response.usage?.completion_tokens || 0;
  const content = choice.message.content || '';
  const toolCalls = (choice.message.tool_calls || []).map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    input: JSON.parse(tc.function.arguments || '{}'),
  }));
  const rawAssistantMsg = toolCalls.length > 0
    ? { role: 'assistant', content: choice.message.content, tool_calls: choice.message.tool_calls }
    : null;

  return { content, toolCalls, rawAssistantMsg, inputTokens, outputTokens, model: response.model, stopReason: choice.finish_reason };
}

async function callOpenRouter(apiKey, model, messages, options) {
  const OpenAI = require('openai');
  const client = new OpenAI({
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': 'http://localhost:1248',
      'X-Title': 'AgentWork',
    },
  });

  const requestParams = {
    model: model || 'anthropic/claude-sonnet-4',
    max_tokens: options.maxTokens || 8096,
    messages,
  };

  if (options.tools && options.tools.length > 0) {
    requestParams.tools = options.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  const response = await client.chat.completions.create(requestParams);

  const choice = response.choices[0];
  const inputTokens = response.usage?.prompt_tokens || 0;
  const outputTokens = response.usage?.completion_tokens || 0;
  const content = choice.message.content || '';
  const toolCalls = (choice.message.tool_calls || []).map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    input: JSON.parse(tc.function.arguments || '{}'),
  }));
  const rawAssistantMsg = toolCalls.length > 0
    ? { role: 'assistant', content: choice.message.content, tool_calls: choice.message.tool_calls }
    : null;

  return { content, toolCalls, rawAssistantMsg, inputTokens, outputTokens, model: response.model, stopReason: choice.finish_reason };
}

// ─── CLI-based execution (no API key needed) ───

/**
 * Execute a task via Claude Agent SDK (claude CLI).
 * Streams messages back via the onEvent callback.
 * Returns { costUsd }
 */
async function runClaudeAgent(prompt, workDir, onEvent, abortController) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');

  const options = {
    cwd: workDir,
    allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Glob', 'Grep', 'Agent'],
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    abortController,
    maxTurns: 50,
  };

  const stream = query({ prompt, options });
  let sessionId = null;
  let costUsd = 0;

  for await (const message of stream) {
    if (message.type === 'system' && message.subtype === 'init') {
      sessionId = message.session_id;
      onEvent({ type: 'session', sessionId });
    }

    if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type === 'text') {
          onEvent({ type: 'text', content: block.text });
        }
        if (block.type === 'tool_use') {
          const toolName = block.name;
          const input = block.input || {};
          if (toolName === 'Bash') {
            onEvent({ type: 'command', content: input.command || JSON.stringify(input) });
          } else if (toolName === 'Write' || toolName === 'Edit') {
            onEvent({ type: 'file_change', content: `${toolName}: ${input.file_path || input.path || ''}` });
          } else if (toolName === 'Read') {
            onEvent({ type: 'reading', content: `Reading: ${input.file_path || input.path || ''}` });
          } else {
            onEvent({ type: 'tool', content: `${toolName}: ${JSON.stringify(input).slice(0, 200)}` });
          }
        }
      }
    }

    if (message.type === 'result') {
      costUsd = message.total_cost_usd || 0;
      if (message.subtype === 'error') {
        onEvent({ type: 'error', content: message.error || 'Agent encountered an error' });
      } else {
        onEvent({ type: 'done', content: 'Agent finished.' });
      }
    }
  }

  return { costUsd, sessionId };
}

/**
 * Execute a task via OpenAI Codex SDK (codex CLI).
 * Streams messages back via the onEvent callback.
 */
async function runCodexAgent(prompt, workDir, onEvent, abortController) {
  const { Codex } = await import('@openai/codex-sdk');

  const client = new Codex();
  const thread = client.startThread({
    workingDirectory: workDir,
    approvalPolicy: 'never',
    sandboxMode: 'danger-full-access',
  });

  const { events } = await thread.runStreamed(prompt, {
    signal: abortController?.signal,
  });

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for await (const event of events) {
    if (event.type === 'item.completed') {
      const item = event.item;
      if (item.type === 'agent_message') {
        onEvent({ type: 'text', content: item.text || '' });
      } else if (item.type === 'command_execution') {
        const cmd = item.command || '';
        const output = (item.output || '').slice(0, 2000);
        onEvent({ type: 'command', content: `$ ${cmd}` });
        if (output) onEvent({ type: 'output', content: output });
        if (item.exit_code !== 0) {
          onEvent({ type: 'error', content: `Command exited with code ${item.exit_code}` });
        }
      } else if (item.type === 'file_change') {
        const changes = item.changes || [];
        for (const c of changes) {
          onEvent({ type: 'file_change', content: `${c.kind || 'update'}: ${c.path || ''}` });
        }
      } else if (item.type === 'reasoning') {
        onEvent({ type: 'thinking', content: item.text || '' });
      }
    }

    if (event.type === 'turn.completed') {
      const usage = event.usage || {};
      totalInputTokens += usage.input_tokens || 0;
      totalOutputTokens += usage.output_tokens || 0;
      onEvent({ type: 'done', content: 'Agent finished.' });
    }

    if (event.type === 'turn.failed') {
      onEvent({ type: 'error', content: event.error?.message || 'Codex agent failed' });
    }
  }

  return { inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
}

/**
 * Send a chat message to Claude Agent SDK and get a response.
 * Used for direct chat (non-task) conversations.
 */
async function chatWithClaudeAgent(prompt, sessionId, workDir) {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');

  const options = {
    cwd: workDir || process.cwd(),
    allowedTools: [],
    permissionMode: 'default',
    maxTurns: 1,
  };

  if (sessionId) {
    options.resume = sessionId;
  }

  const stream = query({ prompt, options });
  let newSessionId = sessionId;
  let responseText = '';

  for await (const message of stream) {
    if (message.type === 'system' && message.subtype === 'init') {
      newSessionId = message.session_id;
    }
    if (message.type === 'assistant') {
      for (const block of message.message.content) {
        if (block.type === 'text') {
          responseText += block.text;
        }
      }
    }
  }

  return { content: responseText, sessionId: newSessionId };
}

/**
 * Send a chat message to Codex SDK and get a response.
 */
async function chatWithCodexAgent(prompt, thread) {
  let responseText = '';
  const { events } = await thread.runStreamed(prompt);

  for await (const event of events) {
    if (event.type === 'item.completed' && event.item.type === 'agent_message') {
      responseText += event.item.text || '';
    }
    if (event.type === 'turn.completed' || event.type === 'turn.failed') break;
  }

  return { content: responseText };
}

// Static pricing table ($/M tokens)
const STATIC_PRICING = {
  // Anthropic
  'claude-opus-4-6': { input: 15, output: 75 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-opus-4-5': { input: 15, output: 75 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 0.8, output: 4 },
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'claude-opus-4-20250514': { input: 15, output: 75 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4 },
  // OpenAI
  'gpt-5.4': { input: 5, output: 15 },
  'gpt-5.4-pro': { input: 10, output: 30 },
  'gpt-5.1': { input: 5, output: 15 },
  'gpt-5-mini': { input: 1.5, output: 6 },
  'gpt-5-nano': { input: 0.5, output: 2 },
  'gpt-4.1': { input: 2, output: 8 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'o3': { input: 10, output: 40 },
  'o3-mini': { input: 1.1, output: 4.4 },
  'o4-mini': { input: 1.1, output: 4.4 },
  // Google
  'gemini-2.5-pro': { input: 1.25, output: 10 },
  'gemini-2.5-flash': { input: 0.15, output: 0.6 },
  // DeepSeek
  'deepseek-chat': { input: 0.27, output: 1.1 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
};

// Calculate cost based on model. For OpenRouter models not in static table,
// falls back to the live-fetched cache (populated by fetchOpenRouterPricing).
function estimateCost(provider, model, inputTokens, outputTokens) {
  let rates = STATIC_PRICING[model];

  if (!rates && provider === 'openrouter' && openRouterPricingCache) {
    rates = openRouterPricingCache[model];
  }

  if (!rates) return 0;

  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
}

module.exports = {
  createCompletion,
  estimateCost,
  fetchOpenRouterPricing,
  runClaudeAgent,
  runCodexAgent,
  chatWithClaudeAgent,
  chatWithCodexAgent,
};
