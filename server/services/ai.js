const { db } = require('../db');

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : '';
}

// API-based completion (requires API key)
async function createCompletion(provider, model, messages, options = {}) {
  let apiKey;
  let customBaseUrl = getSetting('custom_base_url');

  if (provider === 'anthropic') {
    apiKey = getSetting('anthropic_api_key');
  } else if (provider === 'openrouter') {
    apiKey = getSetting('openrouter_api_key');
  } else {
    apiKey = getSetting('openai_api_key');
  }

  if (!apiKey && !customBaseUrl) {
    const label = provider === 'anthropic' ? 'Anthropic' : provider === 'openrouter' ? 'OpenRouter' : 'OpenAI';
    throw new Error(`No API key configured for "${provider}". Go to Settings → API Providers to add your ${label} API key.`);
  }

  if (provider === 'anthropic') {
    return callAnthropic(apiKey, model, messages, options, customBaseUrl);
  } else if (provider === 'openrouter') {
    return callOpenRouter(apiKey, model, messages, options);
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

  return { content, inputTokens, outputTokens, model: response.model, stopReason: response.stop_reason };
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

  return { content: choice.message.content, inputTokens, outputTokens, model: response.model, stopReason: choice.finish_reason };
}

async function callOpenRouter(apiKey, model, messages, options) {
  const OpenAI = require('openai');
  const client = new OpenAI({
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': 'http://localhost:1248',
      'X-Title': 'AgentHub',
    },
  });

  const response = await client.chat.completions.create({
    model: model || 'anthropic/claude-sonnet-4',
    max_tokens: options.maxTokens || 4096,
    messages,
  });

  const choice = response.choices[0];
  const inputTokens = response.usage?.prompt_tokens || 0;
  const outputTokens = response.usage?.completion_tokens || 0;

  return { content: choice.message.content, inputTokens, outputTokens, model: response.model, stopReason: choice.finish_reason };
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

// Calculate cost based on model
function estimateCost(provider, model, inputTokens, outputTokens) {
  const pricing = {
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
    // OpenRouter (uses provider/model format — pricing varies, use approximate)
    'anthropic/claude-opus-4': { input: 15, output: 75 },
    'anthropic/claude-sonnet-4': { input: 3, output: 15 },
    'anthropic/claude-haiku-4': { input: 0.8, output: 4 },
    'openai/gpt-4o': { input: 2.5, output: 10 },
    'openai/gpt-4o-mini': { input: 0.15, output: 0.6 },
    'google/gemini-2.5-pro': { input: 1.25, output: 10 },
    'google/gemini-2.5-flash': { input: 0.15, output: 0.6 },
    'deepseek/deepseek-chat-v3': { input: 0.27, output: 1.1 },
    'meta-llama/llama-4-maverick': { input: 0.2, output: 0.6 },
    'meta-llama/llama-4-scout': { input: 0.1, output: 0.3 },
    'mistralai/mistral-large': { input: 2, output: 6 },
    'qwen/qwen3-235b': { input: 0.5, output: 2 },
  };

  const rates = pricing[model] || { input: 3, output: 15 };
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
}

module.exports = {
  createCompletion,
  estimateCost,
  runClaudeAgent,
  runCodexAgent,
  chatWithClaudeAgent,
  chatWithCodexAgent,
};
