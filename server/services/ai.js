const { db } = require('../db');
const { decrypt, isSensitiveKey } = require('../crypto');
const { ensureCodexCliAuthFromStoredProfile, resolveProviderRuntimeAuth } = require('./provider-auth');
const llmProviders = require('../../shared/llm-providers.json');
const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const API_PROVIDER_INDEX = Object.fromEntries(
  (llmProviders.apiProviders || []).map((provider) => [provider.id, provider])
);

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return '';
  return isSensitiveKey(key) ? decrypt(row.value) : row.value;
}

function getProviderConfig(provider) {
  return API_PROVIDER_INDEX[String(provider || '').trim()] || null;
}

function getProviderBaseUrl(provider, customBaseUrl = '') {
  const config = getProviderConfig(provider);
  const trimmedCustomBaseUrl = String(customBaseUrl || '').trim();

  if (['openai', 'anthropic', 'google', 'deepseek', 'mistral'].includes(provider)) {
    return trimmedCustomBaseUrl || config?.baseUrl || '';
  }

  if (config?.baseUrlSetting) {
    const configured = String(getSetting(config.baseUrlSetting) || '').trim();
    if (configured) return configured;
  }

  return config?.baseUrl || '';
}

function providerAllowsAnonymous(provider, baseUrl) {
  const config = getProviderConfig(provider);
  if (config?.authOptional) return true;
  return provider === 'openai' && Boolean(baseUrl);
}

function getProviderDefaultModel(provider, fallback = '') {
  const config = getProviderConfig(provider);
  return fallback || config?.models?.[0]?.id || '';
}

function getOpenAICompatibleHeaders(provider) {
  if (provider === 'openrouter') {
    return {
      'HTTP-Referer': 'http://localhost:1248',
      'X-Title': 'AgentWork',
    };
  }
  return null;
}

function parseJsonSafe(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

function normalizeTextContent(content) {
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        return '';
      })
      .join('');
  }
  return typeof content === 'string' ? content : '';
}

const XML_TOOL_NAME_ALIASES = {
  bash: 'run_bash',
  shell: 'run_bash',
  command: 'run_bash',
  runbash: 'run_bash',
  read: 'read_file',
  readfile: 'read_file',
  write: 'write_file',
  writefile: 'write_file',
  delete: 'delete_path',
  removepath: 'delete_path',
  list: 'list_directory',
  listdirectory: 'list_directory',
  ls: 'list_directory',
  readimage: 'read_image',
  image: 'read_image',
  browser: 'browser',
  taskcomplete: 'task_complete',
  complete: 'task_complete',
  done: 'task_complete',
  requesthelp: 'request_help',
  help: 'request_help',
  message: 'message_agent',
  messageagent: 'message_agent',
  agentmessage: 'message_agent',
};

function normalizeXmlToolName(name) {
  const cleaned = String(name || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

  return XML_TOOL_NAME_ALIASES[cleaned] || String(name || '').trim();
}

function coerceXmlToolValue(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';

  if ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'))) {
    try {
      return JSON.parse(value);
    } catch {}
  }

  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  if (/^null$/i.test(value)) return null;
  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);

  return value;
}

function parseXmlToolParameters(block) {
  const input = {};
  const parameterRe = /<parameter(?:=|\s+name=)(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([\s\S]*?)<\/parameter>/gi;
  let match;

  while ((match = parameterRe.exec(block)) !== null) {
    const key = (match[1] || match[2] || match[3] || '').trim();
    if (!key) continue;
    input[key] = coerceXmlToolValue(match[4]);
  }

  return input;
}

function parseXmlLikeToolCalls(content) {
  const text = normalizeTextContent(content);
  if (!text || (!/<tool_call\b/i.test(text) && !/<invoke\b/i.test(text) && !/<function(?:=|\s+name=)/i.test(text))) {
    return { toolCalls: [], cleanedContent: text };
  }

  const toolCalls = [];
  let sequence = 0;

  const pushToolCall = (name, body) => {
    const normalizedName = normalizeXmlToolName(name);
    if (!normalizedName) return;
    sequence += 1;
    toolCalls.push({
      id: `xml_tool_${sequence}`,
      name: normalizedName,
      input: parseXmlToolParameters(body),
    });
  };

  const toolBlockRe = /<tool_call\b[^>]*>([\s\S]*?)<\/tool_call>/gi;
  let matchedToolBlock = false;
  let match;
  while ((match = toolBlockRe.exec(text)) !== null) {
    matchedToolBlock = true;
    const block = match[1];

    let functionFound = false;
    const functionRe = /<function(?:=|\s+name=)(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([\s\S]*?)<\/function>/gi;
    let functionMatch;
    while ((functionMatch = functionRe.exec(block)) !== null) {
      functionFound = true;
      pushToolCall(functionMatch[1] || functionMatch[2] || functionMatch[3], functionMatch[4]);
    }

    if (!functionFound) {
      const invokeRe = /<invoke\b[^>]*name=(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([\s\S]*?)<\/invoke>/gi;
      let invokeMatch;
      while ((invokeMatch = invokeRe.exec(block)) !== null) {
        functionFound = true;
        pushToolCall(invokeMatch[1] || invokeMatch[2] || invokeMatch[3], invokeMatch[4]);
      }
    }
  }

  if (!matchedToolBlock) {
    const invokeRe = /<invoke\b[^>]*name=(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([\s\S]*?)<\/invoke>/gi;
    while ((match = invokeRe.exec(text)) !== null) {
      pushToolCall(match[1] || match[2] || match[3], match[4]);
    }
  }

  const cleanedContent = text
    .replace(/<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/gi, ' ')
    .replace(/<invoke\b[^>]*>[\s\S]*?<\/invoke>/gi, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { toolCalls, cleanedContent };
}

function buildSyntheticOpenAIToolMessage(toolCalls, cleanedContent) {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) return null;

  return {
    role: 'assistant',
    content: cleanedContent || '',
    tool_calls: toolCalls.map((toolCall) => ({
      id: toolCall.id,
      type: 'function',
      function: {
        name: toolCall.name,
        arguments: JSON.stringify(toolCall.input || {}),
      },
    })),
  };
}

function buildOpenAICompatibleClient(provider, apiKey, baseURL) {
  const OpenAI = require('openai');
  const defaultHeaders = getOpenAICompatibleHeaders(provider);
  const resolvedApiKey = apiKey || (baseURL ? 'agentwork-local' : undefined);

  return new OpenAI({
    ...(resolvedApiKey ? { apiKey: resolvedApiKey } : {}),
    ...(baseURL ? { baseURL } : {}),
    ...(defaultHeaders ? { defaultHeaders } : {}),
  });
}

// Simple per-provider rate limiter
const rateLimitState = {}; // { provider: { lastCallMs, minIntervalMs } }

function enforceRateLimit(provider) {
  const minIntervalMs = parseInt(getSetting('rate_limit_ms') || '0', 10);
  if (minIntervalMs <= 0) return Promise.resolve();

  if (!rateLimitState[provider]) rateLimitState[provider] = { lastCallMs: 0 };
  const state = rateLimitState[provider];
  const now = Date.now();
  const elapsed = now - state.lastCallMs;
  state.lastCallMs = now;

  if (elapsed < minIntervalMs) {
    const waitMs = minIntervalMs - elapsed;
    return new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  return Promise.resolve();
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
  await enforceRateLimit(provider);

  // Verbose AI logging
  const verbose = getSetting('verbose_ai_logging') === 'true';
  if (verbose) {
    const promptLen = messages.reduce((s, m) => s + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content).length), 0);
    console.log(`[AI Verbose] Request: ${provider}/${model} | ${messages.length} messages | ~${promptLen} chars`);
  }

  const customBaseUrl = getSetting('custom_base_url');
  const baseUrl = getProviderBaseUrl(provider, customBaseUrl);
  const auth = await resolveProviderRuntimeAuth(provider);

  if (!auth && !providerAllowsAnonymous(provider, baseUrl)) {
    throw buildMissingAuthError(provider);
  }

  if (provider === 'anthropic') {
    return callAnthropic(auth?.apiKey, model, messages, options, baseUrl);
  }

  if (provider === 'google') {
    return callGoogle(auth, model, messages, options, baseUrl);
  }

  if (provider === 'openrouter' && !openRouterPricingCache) {
    fetchOpenRouterPricing().catch(() => {});
  }

  return callOpenAICompatible(provider, auth?.apiKey, model, messages, options, baseUrl);
}

function buildMissingAuthError(provider) {
  const config = getProviderConfig(provider);
  const label = config?.label?.replace(/\s+\(.*\)$/, '') || provider;
  return new Error(
    `No authentication configured for "${provider}". Go to Settings → API Providers to add your ${label} credentials.`
  );
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
    model: getProviderDefaultModel('anthropic', model || ''),
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

async function callOpenAICompatible(provider, apiKey, model, messages, options, baseUrl) {
  const client = buildOpenAICompatibleClient(provider, apiKey, baseUrl);

  const requestParams = {
    model: getProviderDefaultModel(provider, model || ''),
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
  const content = normalizeTextContent(choice.message.content);
  const nativeToolCalls = (choice.message.tool_calls || []).map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    input: parseJsonSafe(tc.function.arguments),
  }));
  const parsedXml = nativeToolCalls.length === 0 ? parseXmlLikeToolCalls(content) : { toolCalls: [], cleanedContent: content };
  const toolCalls = nativeToolCalls.length > 0 ? nativeToolCalls : parsedXml.toolCalls;
  const cleanedContent = nativeToolCalls.length > 0 ? content : parsedXml.cleanedContent;
  const rawAssistantMsg = nativeToolCalls.length > 0
    ? { role: 'assistant', content: choice.message.content, tool_calls: choice.message.tool_calls }
    : buildSyntheticOpenAIToolMessage(toolCalls, cleanedContent);

  return {
    content: cleanedContent,
    toolCalls,
    rawAssistantMsg,
    inputTokens,
    outputTokens,
    model: response.model,
    stopReason: choice.finish_reason,
  };
}

async function callOpenRouter(apiKey, model, messages, options) {
  return callOpenAICompatible('openrouter', apiKey, model, messages, options, getProviderBaseUrl('openrouter'));
}

async function callGoogle(auth, model, messages, options, customBaseUrl) {
  const baseUrl = customBaseUrl || 'https://generativelanguage.googleapis.com/v1beta/openai';
  const headers = {
    'Content-Type': 'application/json',
  };

  if (auth?.mode === 'oauth' && auth.token) {
    headers.Authorization = `Bearer ${auth.token}`;
    if (auth.projectId) {
      headers['x-goog-user-project'] = auth.projectId;
    }
  } else if (auth?.apiKey) {
    headers.Authorization = `Bearer ${auth.apiKey}`;
  }

  const requestParams = {
    model: getProviderDefaultModel('google', model || ''),
    max_tokens: options.maxTokens || 8096,
    messages,
  };

  if (options.tools && options.tools.length > 0) {
    requestParams.tools = options.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestParams),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google request failed (${response.status}): ${text || response.statusText}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0] || {};
  const message = choice.message || {};
  const inputTokens = data.usage?.prompt_tokens || 0;
  const outputTokens = data.usage?.completion_tokens || 0;
  const content = normalizeTextContent(message.content);
  const nativeToolCalls = (message.tool_calls || []).map((tc) => ({
    id: tc.id,
    name: tc.function?.name,
    input: parseJsonSafe(tc.function?.arguments),
  }));
  const parsedXml = nativeToolCalls.length === 0 ? parseXmlLikeToolCalls(content) : { toolCalls: [], cleanedContent: content };
  const toolCalls = nativeToolCalls.length > 0 ? nativeToolCalls : parsedXml.toolCalls;
  const cleanedContent = nativeToolCalls.length > 0 ? content : parsedXml.cleanedContent;
  const rawAssistantMsg = nativeToolCalls.length > 0
    ? { role: 'assistant', content: message.content, tool_calls: message.tool_calls }
    : buildSyntheticOpenAIToolMessage(toolCalls, cleanedContent);

  return {
    content: cleanedContent,
    toolCalls,
    rawAssistantMsg,
    inputTokens,
    outputTokens,
    model: data.model || model,
    stopReason: choice.finish_reason,
  };
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

  const client = createCodexClient(Codex);
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
      } else if (item.type === 'error') {
        onEvent({ type: 'error', content: item.message || 'Codex agent failed' });
      }
    }

    if (event.type === 'error') {
      onEvent({ type: 'error', content: event.message || 'Codex agent failed' });
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
  let lastError = '';
  const { events } = await thread.runStreamed(prompt);

  for await (const event of events) {
    if (event.type === 'item.completed') {
      if (event.item.type === 'agent_message') {
        responseText += event.item.text || '';
      } else if (event.item.type === 'error') {
        lastError = event.item.message || lastError;
      }
    }
    if (event.type === 'error') {
      lastError = event.message || lastError;
    }
    if (event.type === 'turn.failed') {
      throw new Error(event.error?.message || lastError || 'Codex agent failed');
    }
    if (event.type === 'turn.completed') break;
  }

  if (!responseText.trim()) {
    if (lastError) throw new Error(lastError);
    throw new Error('Codex completed without returning an assistant message.');
  }

  return { content: responseText };
}

function createCodexClient(Codex) {
  ensureCodexCliAuthFromStoredProfile();
  return new Codex({ baseUrl: CODEX_BASE_URL });
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

// Streaming completion for chat — yields partial text chunks
async function createStreamingCompletion(provider, model, messages, onChunk) {
  const customBaseUrl = getSetting('custom_base_url');
  const baseUrl = getProviderBaseUrl(provider, customBaseUrl);
  const auth = await resolveProviderRuntimeAuth(provider);
  if (!auth && !providerAllowsAnonymous(provider, baseUrl)) throw buildMissingAuthError(provider);

  let fullContent = '';
  let inputTokens = 0, outputTokens = 0;

  if (provider === 'anthropic') {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: auth?.apiKey, ...(baseUrl ? { baseURL: baseUrl } : {}) });
    const systemMessage = messages.find((m) => m.role === 'system');
    const chatMessages = messages.filter((m) => m.role !== 'system');
    const stream = client.messages.stream({
      model: getProviderDefaultModel('anthropic', model || ''),
      max_tokens: 4096,
      system: systemMessage?.content || '',
      messages: chatMessages,
    });
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.text) {
        fullContent += event.delta.text;
        onChunk(event.delta.text);
      }
    }
    const final = await stream.finalMessage();
    inputTokens = final.usage?.input_tokens || 0;
    outputTokens = final.usage?.output_tokens || 0;
  } else if (provider === 'google') {
    const response = await callGoogle(auth, model, messages, { maxTokens: 4096 }, baseUrl);
    fullContent = response.content || '';
    inputTokens = response.inputTokens || 0;
    outputTokens = response.outputTokens || 0;
    if (fullContent) onChunk(fullContent);
  } else {
    const client = buildOpenAICompatibleClient(provider, auth?.apiKey, baseUrl);
    const stream = await client.chat.completions.create({
      model: getProviderDefaultModel(provider, model || ''),
      max_tokens: 4096,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    });
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) { fullContent += delta; onChunk(delta); }
      if (chunk.usage) { inputTokens = chunk.usage.prompt_tokens || 0; outputTokens = chunk.usage.completion_tokens || 0; }
    }
  }

  return { content: fullContent, inputTokens, outputTokens };
}

module.exports = {
  createCompletion,
  createStreamingCompletion,
  estimateCost,
  fetchOpenRouterPricing,
  runClaudeAgent,
  runCodexAgent,
  chatWithClaudeAgent,
  chatWithCodexAgent,
  createCodexClient,
};
