'use client';

import { useEffect, useState, useCallback } from 'react';
import Sidebar from '../../components/Sidebar';
import BottomBar from '../../components/BottomBar';
import { api } from '../../lib/api';
import { useSocket } from '../providers';
import agentMetadata from '../../../shared/agent-metadata.json';
import {
  Plus, Trash2, Edit2, Settings2, Brain, FileText, Copy,
  User, Shield, BookOpen, X, RotateCcw, Key, Terminal, MessageCircle,
} from 'lucide-react';
import { toast } from 'react-hot-toast';

const AVATARS = ['🤖', '🧠', '⚡', '🔧', '🎯', '🚀', '💡', '🛠️', '🔬', '🎨', '👾', '🦾'];

const ROLE_PRESETS = agentMetadata.roles.map((role) => role.label);
const AGENT_TYPE_PRESETS = agentMetadata.agentTypes;

const API_MODELS = {
  anthropic: [
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', tier: 'flagship' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', tier: 'balanced' },
    { id: 'claude-opus-4-5', label: 'Claude Opus 4.5', tier: 'flagship' },
    { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', tier: 'balanced' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', tier: 'fast' },
    { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', tier: 'balanced' },
    { id: 'claude-opus-4-20250514', label: 'Claude Opus 4', tier: 'flagship' },
  ],
  openai: [
    { id: 'gpt-5.4', label: 'GPT-5.4', tier: 'flagship' },
    { id: 'gpt-5.4-pro', label: 'GPT-5.4 Pro', tier: 'flagship' },
    { id: 'gpt-5.1', label: 'GPT-5.1', tier: 'flagship' },
    { id: 'gpt-5-mini', label: 'GPT-5 Mini', tier: 'fast' },
    { id: 'gpt-5-nano', label: 'GPT-5 Nano', tier: 'fast' },
    { id: 'gpt-4.1', label: 'GPT-4.1', tier: 'balanced' },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', tier: 'fast' },
    { id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano', tier: 'fast' },
    { id: 'gpt-4o', label: 'GPT-4o', tier: 'balanced' },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini', tier: 'fast' },
    { id: 'o3', label: 'o3 (Reasoning)', tier: 'reasoning' },
    { id: 'o3-pro', label: 'o3 Pro', tier: 'reasoning' },
    { id: 'o3-mini', label: 'o3 Mini', tier: 'reasoning' },
    { id: 'o4-mini', label: 'o4 Mini', tier: 'reasoning' },
  ],
  google: [
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', tier: 'flagship' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', tier: 'fast' },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', tier: 'fast' },
  ],
  deepseek: [
    { id: 'deepseek-chat', label: 'DeepSeek V3', tier: 'balanced' },
    { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner', tier: 'reasoning' },
  ],
  mistral: [
    { id: 'mistral-large-latest', label: 'Mistral Large', tier: 'flagship' },
    { id: 'mistral-small-latest', label: 'Mistral Small', tier: 'fast' },
    { id: 'codestral-latest', label: 'Codestral', tier: 'code' },
  ],
  openrouter: [
    { id: 'anthropic/claude-opus-4', label: 'Claude Opus 4', tier: 'flagship' },
    { id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4', tier: 'balanced' },
    { id: 'anthropic/claude-haiku-4', label: 'Claude Haiku 4', tier: 'fast' },
    { id: 'openai/gpt-4o', label: 'GPT-4o', tier: 'balanced' },
    { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini', tier: 'fast' },
    { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro', tier: 'flagship' },
    { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', tier: 'fast' },
    { id: 'deepseek/deepseek-chat-v3', label: 'DeepSeek V3', tier: 'balanced' },
    { id: 'meta-llama/llama-4-maverick', label: 'Llama 4 Maverick', tier: 'flagship' },
    { id: 'meta-llama/llama-4-scout', label: 'Llama 4 Scout', tier: 'balanced' },
    { id: 'mistralai/mistral-large', label: 'Mistral Large', tier: 'flagship' },
    { id: 'qwen/qwen3-235b', label: 'Qwen3 235B', tier: 'flagship' },
  ],
};

const CLI_PROVIDERS = [
  { id: 'claude-cli', label: 'Claude Code (Agent SDK)', description: 'Uses your local Claude CLI auth — no API key needed' },
  { id: 'codex-cli', label: 'Codex CLI (Codex SDK)', description: 'Uses your local Codex CLI auth — no API key needed' },
];

const API_PROVIDERS = [
  { id: 'anthropic', label: 'Anthropic (Claude)' },
  { id: 'openai', label: 'OpenAI (GPT)' },
  { id: 'openrouter', label: 'OpenRouter (Multi-provider)' },
  { id: 'google', label: 'Google (Gemini)' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'mistral', label: 'Mistral AI' },
];

const OAUTH_PROVIDERS = [
  {
    id: 'anthropic',
    providerId: 'anthropic',
    methodId: 'setup-token',
    label: 'Anthropic setup-token',
    description: 'Uses the saved Anthropic setup-token from Settings.',
    runtime: 'api',
  },
  {
    id: 'google',
    providerId: 'google',
    methodId: 'google-gemini-cli',
    label: 'Gemini CLI OAuth',
    description: 'Uses the imported Gemini CLI OAuth profile from Settings.',
    runtime: 'api',
  },
  {
    id: 'openai-codex',
    providerId: 'openai',
    methodId: 'openai-codex',
    label: 'OpenAI Codex OAuth',
    description: 'Uses the saved Codex OAuth connection from Settings.',
    runtime: 'cli',
  },
];

const TIER_COLORS = {
  flagship: { bg: '#ffd43b20', color: '#fcc419' },
  balanced: { bg: '#4c6ef520', color: '#5c7cfa' },
  fast: { bg: '#40c05720', color: '#51cf66' },
  reasoning: { bg: '#f0659520', color: '#f06595' },
  code: { bg: '#20c99720', color: '#20c997' },
};

const AUTH_MODE_META = {
  api: { label: '🔑 API', bg: 'var(--accent-light)', color: 'var(--accent)' },
  cli: { label: '⌨ CLI', bg: '#20c99720', color: '#20c997' },
  oauth: { label: '🪪 OAuth', bg: '#ff922b20', color: '#f08c00' },
};

function getAuthModeMeta(authType) {
  return AUTH_MODE_META[authType] || AUTH_MODE_META.api;
}

function normalizeAgentType(agentType) {
  if (agentType === 'worker') return 'worker';
  if (agentType === 'cli') return 'cli';
  return 'smart';
}

function getAgentTypeMeta(agentType) {
  const normalized = normalizeAgentType(agentType);
  return AGENT_TYPE_PRESETS.find((type) => type.id === normalized) || AGENT_TYPE_PRESETS[0];
}

function getProviderAuthMethod(providerAuth, providerId, methodId) {
  return providerAuth?.providers
    ?.find((provider) => provider.id === providerId)
    ?.methods?.find((method) => method.id === methodId) || null;
}

export default function AgentsPage() {
  const socket = useSocket();
  const [agents, setAgents] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editAgent, setEditAgent] = useState(null);
  const [memoryAgent, setMemoryAgent] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadAgents = useCallback(async () => {
    try {
      const data = await api.getAgents();
      setAgents(data);
    } catch {} finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAgents(); }, [loadAgents]);

  useEffect(() => {
    if (!socket) return;
    const onCreated = () => loadAgents();
    const onUpdated = () => loadAgents();
    const onDeleted = ({ id }) => setAgents((prev) => prev.filter((a) => a.id !== id));
    const onStatusChanged = ({ agentId, status }) => {
      setAgents((prev) => prev.map((a) => (a.id === agentId ? { ...a, status } : a)));
    };

    socket.on('agent:created', onCreated);
    socket.on('agent:updated', onUpdated);
    socket.on('agent:deleted', onDeleted);
    socket.on('agent:status_changed', onStatusChanged);
    return () => {
      socket.off('agent:created', onCreated);
      socket.off('agent:updated', onUpdated);
      socket.off('agent:deleted', onDeleted);
      socket.off('agent:status_changed', onStatusChanged);
    };
  }, [socket, loadAgents]);

  const cloneAgent = async (id) => {
    try {
      const cloned = await api.cloneAgent(id);
      toast.success(`Cloned as ${cloned.name}`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const deleteAgent = async (id) => {
    if (!confirm('Fire this agent? This will delete their memory files.')) return;
    await api.deleteAgent(id);
    toast.success('Agent removed');
  };

  const openMemory = async (agent) => {
    try {
      const full = await api.getAgent(agent.id);
      setMemoryAgent(full);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const statusColors = {
    offline: '#868e96',
    idle: '#40c057',
    working: '#fab005',
    thinking: '#4c6ef5',
    executing: '#f06595',
  };

  const statusLabels = {
    offline: 'Offline',
    idle: 'Online',
    working: 'Working',
    thinking: 'Thinking',
    executing: 'Executing',
  };

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <div className="flex items-center justify-between px-6 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h1 className="font-semibold text-lg" style={{ color: 'var(--text-primary)' }}>Agents (HR Department)</h1>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Hire, manage, and configure your AI agents</p>
          </div>
          <button className="btn btn-primary text-sm" onClick={() => { setShowForm(true); setEditAgent(null); }}>
            <Plus size={16} /> Hire Agent
          </button>
        </div>

        <main className="flex-1 overflow-auto p-6" style={{ background: 'var(--bg-primary)' }}>
          {loading ? (
            <p className="text-center text-sm py-12" style={{ color: 'var(--text-tertiary)' }}>Loading...</p>
          ) : agents.length === 0 ? (
            <div className="text-center py-16">
              <Brain size={48} className="mx-auto mb-3" style={{ color: 'var(--text-tertiary)' }} />
              <p className="text-sm mb-2" style={{ color: 'var(--text-tertiary)' }}>No agents hired yet</p>
              <button className="btn btn-primary" onClick={() => setShowForm(true)}>
                <Plus size={16} /> Hire Your First Agent
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {agents.map((agent) => (
                <div key={agent.id} className="card p-5 group">
                  {(() => {
                    const authMode = getAuthModeMeta(agent.auth_type);
                    const agentType = getAgentTypeMeta(agent.agent_type);
                    return (
                      <>
                  <div className="flex items-start gap-4">
                    <div className="relative">
                      <span className="text-4xl">{agent.avatar}</span>
                      <div
                        className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2"
                        style={{
                          background: statusColors[agent.status] || statusColors.idle,
                          borderColor: 'var(--bg-elevated)',
                        }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{agent.name}</p>
                      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{agent.role}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="badge text-[10px]" style={{
                          background: authMode.bg,
                          color: authMode.color,
                        }}>
                          {authMode.label}
                        </span>
                        <span className="badge text-[10px]" style={{
                          background: normalizeAgentType(agent.agent_type) === 'smart'
                            ? '#4c6ef520'
                            : normalizeAgentType(agent.agent_type) === 'worker'
                            ? '#40c05720'
                            : '#ff922b20',
                          color: normalizeAgentType(agent.agent_type) === 'smart'
                            ? '#5c7cfa'
                            : normalizeAgentType(agent.agent_type) === 'worker'
                            ? '#2f9e44'
                            : '#f08c00',
                        }}>
                          {agentType.label}
                        </span>
                        <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                          {agent.provider}{agent.model ? ` / ${agent.model}` : ''}
                        </span>
                        {agent.chat_enabled ? (
                          <span className="badge text-[10px]" style={{ background: '#7950f220', color: '#7950f2' }}>
                            {agent.chat_platform === 'telegram' ? '✈ Telegram' : '💬 Slack'}
                          </span>
                        ) : null}
                      </div>
                      <p className="text-[10px] mt-1" style={{ color: statusColors[agent.status] || statusColors.idle }}>
                        {statusLabels[agent.status] || 'Online'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mt-4 pt-3 border-t" style={{ borderColor: 'var(--border-light)' }}>
                    <button className="btn btn-ghost text-xs flex-1" onClick={() => openMemory(agent)}>
                      <Brain size={14} /> Memory
                    </button>
                    <button className="btn btn-ghost text-xs flex-1" onClick={() => { setEditAgent(agent); setShowForm(true); }}>
                      <Edit2 size={14} /> Edit
                    </button>
                    <button className="btn btn-ghost text-xs" onClick={() => cloneAgent(agent.id)} title="Clone agent">
                      <Copy size={14} />
                    </button>
                    <button className="btn btn-ghost text-xs" style={{ color: 'var(--danger)' }} onClick={() => deleteAgent(agent.id)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                      </>
                    );
                  })()}
                </div>
              ))}
            </div>
          )}
        </main>
        <BottomBar />
      </div>

      {showForm && (
        <AgentFormModal
          agent={editAgent}
          onClose={() => { setShowForm(false); setEditAgent(null); }}
          onSaved={() => { setShowForm(false); setEditAgent(null); loadAgents(); }}
        />
      )}

      {memoryAgent && (
        <MemoryModal agent={memoryAgent} onClose={() => setMemoryAgent(null)} />
      )}
    </div>
  );
}

function AgentFormModal({ agent, onClose, onSaved }) {
  const [authType, setAuthType] = useState(agent?.auth_type || null);
  const [form, setForm] = useState({
    name: agent?.name || '',
    avatar: agent?.avatar || '🤖',
    role: agent?.role || 'Assistant',
    agent_type: normalizeAgentType(agent?.agent_type),
    auth_type: agent?.auth_type || 'api',
    provider: agent?.provider || 'anthropic',
    model: agent?.model || '',
    personality: agent?.personality || '',
    daily_budget_usd: agent?.daily_budget_usd || 0,
    chat_enabled: agent?.chat_enabled ? true : false,
    chat_platform: agent?.chat_platform || 'telegram',
    chat_token: agent?.chat_token || '',
    chat_app_token: agent?.chat_app_token || '',
    chat_allowed_ids: agent?.chat_allowed_ids || '',
    allowed_tools: agent?.allowed_tools || '',
  });
  const [saving, setSaving] = useState(false);
  const [providerAuth, setProviderAuth] = useState(null);
  const [providerAuthLoading, setProviderAuthLoading] = useState(false);

  // If editing, skip the type selection
  const showTypeSelector = !agent && !authType;

  useEffect(() => {
    let cancelled = false;
    setProviderAuthLoading(true);
    api.getProviderAuth()
      .then((data) => {
        if (!cancelled) setProviderAuth(data);
      })
      .catch(() => {
        if (!cancelled) setProviderAuth(null);
      })
      .finally(() => {
        if (!cancelled) setProviderAuthLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const oauthOptions = OAUTH_PROVIDERS.map((option) => {
    const method = getProviderAuthMethod(providerAuth, option.providerId, option.methodId);
    return {
      ...option,
      method,
      configured: Boolean(method?.configured),
    };
  });
  const configuredOauthOptions = oauthOptions.filter((option) => option.configured);

  useEffect(() => {
    if (form.auth_type !== 'oauth') return;
    if (oauthOptions.some((option) => option.id === form.provider)) return;

    const fallback = configuredOauthOptions[0] || oauthOptions[0];
    if (!fallback) return;

    setForm((current) => ({
      ...current,
      provider: fallback.id,
      model: fallback.runtime === 'cli' ? '' : (API_MODELS[fallback.id]?.[0]?.id || ''),
    }));
  }, [form.auth_type, form.provider, configuredOauthOptions, oauthOptions]);

  const chooseAuthType = (nextType) => {
    setAuthType(nextType);

    if (nextType === 'api') {
      setForm((current) => ({
        ...current,
        agent_type: current.agent_type === 'cli' ? 'smart' : current.agent_type,
        auth_type: 'api',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
      }));
      return;
    }

    if (nextType === 'cli') {
      setForm((current) => ({
        ...current,
        agent_type: 'cli',
        auth_type: 'cli',
        provider: 'claude-cli',
        model: '',
      }));
      return;
    }

    const fallback = configuredOauthOptions[0] || oauthOptions[0] || OAUTH_PROVIDERS[0];
    setForm((current) => ({
      ...current,
      agent_type: current.agent_type === 'cli' ? 'smart' : current.agent_type,
      auth_type: 'oauth',
      provider: fallback.id,
      model: fallback.runtime === 'cli' ? '' : (API_MODELS[fallback.id]?.[0]?.id || ''),
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data = { ...form };
      if (data.auth_type === 'cli') {
        // CLI mode: model is optional
        if (!data.model) data.model = '';
      }
      if (data.auth_type === 'oauth') {
        const selectedOauth = oauthOptions.find((option) => option.id === data.provider);
        if (!selectedOauth) {
          throw new Error('Select a provider-auth method.');
        }
        if (!selectedOauth.configured) {
          throw new Error('Configure this provider-auth method in Settings first.');
        }
        if (selectedOauth.runtime === 'cli') {
          data.model = '';
        } else if (!data.model) {
          data.model = API_MODELS[data.provider]?.[0]?.id || '';
        }
      }
      if (agent) {
        await api.updateAgent(agent.id, data);
        toast.success('Agent updated');
      } else {
        await api.createAgent(data);
        toast.success('Agent hired!');
      }
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Type selection screen
  if (showTypeSelector) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
        <div className="card p-6 w-full max-w-3xl animate-fade-in" style={{ background: 'var(--bg-elevated)' }}>
          <h3 className="font-semibold text-lg mb-2" style={{ color: 'var(--text-primary)' }}>
            Hire New Agent
          </h3>
          <p className="text-sm mb-5" style={{ color: 'var(--text-tertiary)' }}>
            Choose how this agent will authenticate
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* API Key option */}
            <button
              className="card p-5 text-left hover:scale-[1.02] transition-transform"
              style={{ borderColor: 'var(--border)' }}
              onClick={() => chooseAuthType('api')}
            >
              <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-3"
                style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}>
                <Key size={20} />
              </div>
              <p className="font-semibold text-sm mb-1" style={{ color: 'var(--text-primary)' }}>API Key</p>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
                Uses your API keys from Settings. Supports Anthropic, OpenAI, Google, DeepSeek, Mistral.
              </p>
            </button>

            {/* Provider auth option */}
            <button
              className="card p-5 text-left hover:scale-[1.02] transition-transform"
              style={{ borderColor: 'var(--border)' }}
              onClick={() => chooseAuthType('oauth')}
            >
              <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-3"
                style={{ background: '#ff922b20', color: '#f08c00' }}>
                <Shield size={20} />
              </div>
              <p className="font-semibold text-sm mb-1" style={{ color: 'var(--text-primary)' }}>OAuth / Provider Auth</p>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
                Uses saved provider auth from Settings. Supports Anthropic setup-token, Gemini CLI OAuth, and Codex OAuth.
              </p>
            </button>

            {/* CLI option */}
            <button
              className="card p-5 text-left hover:scale-[1.02] transition-transform"
              style={{ borderColor: 'var(--border)' }}
              onClick={() => chooseAuthType('cli')}
            >
              <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-3"
                style={{ background: '#20c99720', color: '#20c997' }}>
                <Terminal size={20} />
              </div>
              <p className="font-semibold text-sm mb-1" style={{ color: 'var(--text-primary)' }}>CLI (No API Key)</p>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
                Uses Claude Code or Codex CLI. Requires the CLI to be installed and signed in locally.
              </p>
            </button>
          </div>

          <p className="text-xs mt-4" style={{ color: 'var(--text-tertiary)' }}>
            Every hired agent is bootstrapped with `AGENTS.md`, `ROLE.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `TOOLS.md`, `HEARTBEAT.md`, and `MEMORY.md`.
          </p>

          <div className="flex justify-end mt-5">
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  const isCli = form.auth_type === 'cli';
  const isOauth = form.auth_type === 'oauth';
  const isOauthCodex = isOauth && form.provider === 'openai-codex';
  const providerModels = !isCli && !isOauthCodex ? (API_MODELS[form.provider] || []) : [];
  const authMode = getAuthModeMeta(form.auth_type);
  const roleOptions = ROLE_PRESETS.includes(form.role) ? ROLE_PRESETS : [form.role, ...ROLE_PRESETS];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="card p-6 w-full max-w-lg max-h-[85vh] overflow-auto animate-fade-in" style={{ background: 'var(--bg-elevated)' }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-lg" style={{ color: 'var(--text-primary)' }}>
            {agent ? 'Edit Agent' : 'Hire New Agent'}
          </h3>
          <span className="badge text-[10px]" style={{
            background: authMode.bg,
            color: authMode.color,
          }}>
            {authMode.label} Mode
          </span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Avatar */}
          <div>
            <label className="label">Avatar</label>
            <div className="flex flex-wrap gap-2">
              {AVATARS.map((a) => (
                <button key={a} type="button"
                  className="w-10 h-10 rounded-lg text-xl flex items-center justify-center transition-all"
                  style={{
                    background: form.avatar === a ? 'var(--accent-light)' : 'var(--bg-secondary)',
                    border: form.avatar === a ? '2px solid var(--accent)' : '1px solid var(--border)',
                  }}
                  onClick={() => setForm({ ...form, avatar: a })}
                >{a}</button>
              ))}
            </div>
          </div>

          {/* Name */}
          <div>
            <label className="label">Name</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g., Alex, Sam, CodeBot" required />
          </div>

          {/* Role */}
          <div>
            <label className="label">Role</label>
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          <div>
            <label className="label">Agent Type</label>
            <div className="space-y-2">
              {AGENT_TYPE_PRESETS.map((type) => (
                <label
                  key={type.id}
                  className="flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors"
                  style={{
                    background: form.agent_type === type.id ? 'var(--accent-light)' : 'var(--bg-secondary)',
                    border: form.agent_type === type.id ? '1px solid var(--accent)' : '1px solid var(--border)',
                  }}
                >
                  <input
                    type="radio"
                    name="agent-type"
                    className="mt-1"
                    checked={form.agent_type === type.id}
                    onChange={() => setForm({ ...form, agent_type: type.id })}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{type.label}</p>
                      {type.id === 'smart' ? (
                        <span className="badge text-[10px]" style={{ background: '#4c6ef520', color: '#5c7cfa' }}>Default</span>
                      ) : null}
                    </div>
                    <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{type.description}</p>
                    <p className="text-[11px] mt-1" style={{ color: 'var(--text-secondary)' }}>Recommended for: {type.recommendedFor}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Provider & Model */}
          {isCli ? (
            <div>
              <label className="label">CLI Provider</label>
              <div className="space-y-2">
                {CLI_PROVIDERS.map((cp) => (
                  <label key={cp.id}
                    className="flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors"
                    style={{
                      background: form.provider === cp.id ? 'var(--accent-light)' : 'var(--bg-secondary)',
                      border: form.provider === cp.id ? '1px solid var(--accent)' : '1px solid var(--border)',
                    }}
                  >
                    <input type="radio" name="cli-provider" className="mt-1"
                      checked={form.provider === cp.id}
                      onChange={() => setForm({ ...form, provider: cp.id, model: '' })} />
                    <div>
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{cp.label}</p>
                      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{cp.description}</p>
                    </div>
                  </label>
                ))}
              </div>
              <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>
                Model is optional for CLI mode — it uses the default from your CLI config.
              </p>
            </div>
          ) : isOauth ? (
            <>
              <div>
                <label className="label">Provider Auth Method</label>
                <div className="space-y-2">
                  {oauthOptions.map((option) => {
                    const details = [
                      option.method?.profile?.email,
                      option.method?.profile?.projectId,
                    ].filter(Boolean).join(' · ');
                    return (
                      <label key={option.id}
                        className="flex items-start gap-3 p-3 rounded-lg transition-colors"
                        style={{
                          background: form.provider === option.id ? 'var(--accent-light)' : 'var(--bg-secondary)',
                          border: form.provider === option.id ? '1px solid var(--accent)' : '1px solid var(--border)',
                          opacity: option.configured ? 1 : 0.6,
                          cursor: option.configured ? 'pointer' : 'not-allowed',
                        }}
                      >
                        <input
                          type="radio"
                          name="oauth-provider"
                          className="mt-1"
                          checked={form.provider === option.id}
                          disabled={!option.configured}
                          onChange={() => setForm({
                            ...form,
                            provider: option.id,
                            model: option.runtime === 'cli' ? '' : (API_MODELS[option.id]?.[0]?.id || ''),
                          })}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{option.label}</p>
                            <span className="badge text-[10px]" style={{
                              background: option.configured ? '#40c05720' : '#868e9620',
                              color: option.configured ? '#2f9e44' : '#868e96',
                            }}>
                              {option.configured ? 'Configured' : 'Not configured'}
                            </span>
                          </div>
                          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{option.description}</p>
                          {details ? (
                            <p className="text-[11px] mt-1" style={{ color: 'var(--text-secondary)' }}>{details}</p>
                          ) : null}
                        </div>
                      </label>
                    );
                  })}
                </div>
                <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>
                  Configure these in Settings → API Providers before hiring an OAuth-backed agent.
                </p>
                {!providerAuthLoading && configuredOauthOptions.length === 0 ? (
                  <p className="text-xs mt-2" style={{ color: 'var(--danger)' }}>
                    No provider-auth methods are configured yet.
                  </p>
                ) : null}
              </div>
              {isOauthCodex ? (
                <div className="p-3 rounded-lg text-xs" style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>
                  Codex OAuth agents run through the Codex SDK. Model selection is handled by your local Codex auth/config after you connect it in Settings, so no model picker is needed here.
                </div>
              ) : (
                <div>
                  <label className="label">Model</label>
                  <select className="input" value={providerModels.some((m) => m.id === form.model) || !form.model ? form.model : '__custom__'}
                    onChange={(e) => {
                      if (e.target.value === '__custom__') {
                        setForm({ ...form, model: '' });
                      } else {
                        setForm({ ...form, model: e.target.value });
                      }
                    }}>
                    {providerModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label} ({m.tier})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          ) : (
            <>
              <div>
                <label className="label">Provider</label>
                <select className="input" value={form.provider}
                  onChange={(e) => {
                    const p = e.target.value;
                    const models = API_MODELS[p] || [];
                    setForm({ ...form, provider: p, model: models[0]?.id || '' });
                  }}>
                  {API_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Model</label>
                <select className="input" value={providerModels.some((m) => m.id === form.model) || !form.model ? form.model : '__custom__'}
                  onChange={(e) => {
                    if (e.target.value === '__custom__') {
                      setForm({ ...form, model: '' });
                    } else {
                      setForm({ ...form, model: e.target.value });
                    }
                  }}>
                  {providerModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} ({m.tier})
                    </option>
                  ))}
                  {form.provider === 'openrouter' && (
                    <option value="__custom__">Custom model ID...</option>
                  )}
                </select>
                {form.provider === 'openrouter' && (!providerModels.some((m) => m.id === form.model)) && (
                  <input
                    className="input mt-2 font-mono text-sm"
                    value={form.model}
                    onChange={(e) => setForm({ ...form, model: e.target.value })}
                    placeholder="e.g. anthropic/claude-sonnet-4.5 or meta-llama/llama-4-scout"
                  />
                )}
              </div>
            </>
          )}

          {/* Personality */}
          <div>
            <label className="label">Personality / Instructions</label>
            <textarea className="input" value={form.personality} onChange={(e) => setForm({ ...form, personality: e.target.value })}
              placeholder="e.g., Methodical, always writes tests, prefers functional patterns..." rows={3} />
          </div>

          {/* Per-Agent Budget */}
          <div>
            <label className="label">Daily Budget Limit (USD)</label>
            <input className="input" type="number" step="0.01" min="0" value={form.daily_budget_usd}
              onChange={(e) => setForm({ ...form, daily_budget_usd: parseFloat(e.target.value) || 0 })} />
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>0 = no per-agent limit (global budget still applies)</p>
          </div>

          {/* Tool Restrictions */}
          <div className="pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2 mb-2">
              <Shield size={16} style={{ color: 'var(--text-secondary)' }} />
              <label className="label mb-0" style={{ marginBottom: 0 }}>Tool Restrictions</label>
            </div>
            <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
              Limit which tools this agent can use during task execution. Unchecked tools will not be available. Leave all unchecked to allow all tools.
            </p>
            <div className="space-y-2">
              {[
                { name: 'read_file', label: 'Read File', desc: 'Read file contents' },
                { name: 'write_file', label: 'Write File', desc: 'Create or overwrite files' },
                { name: 'delete_path', label: 'Delete Path', desc: 'Delete files or directories' },
                { name: 'run_bash', label: 'Run Bash', desc: 'Execute shell commands' },
                { name: 'list_directory', label: 'List Directory', desc: 'List files in a directory' },
              ].map((tool) => {
                const allowedSet = new Set(
                  (form.allowed_tools || '').split(',').map((t) => t.trim()).filter(Boolean)
                );
                const checked = allowedSet.has(tool.name);
                const toggleTool = () => {
                  const next = new Set(allowedSet);
                  if (checked) {
                    next.delete(tool.name);
                  } else {
                    next.add(tool.name);
                  }
                  setForm({ ...form, allowed_tools: Array.from(next).join(',') });
                };
                return (
                  <label key={tool.name}
                    className="flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-colors"
                    style={{
                      background: checked ? 'var(--accent-light)' : 'var(--bg-secondary)',
                      border: checked ? '1px solid var(--accent)' : '1px solid var(--border)',
                    }}
                  >
                    <input type="checkbox" checked={checked} onChange={toggleTool} />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{tool.label}</span>
                      <span className="text-xs ml-2" style={{ color: 'var(--text-tertiary)' }}>{tool.desc}</span>
                    </div>
                  </label>
                );
              })}
            </div>
            <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>
              task_complete and request_help are always available regardless of restrictions.
            </p>
          </div>

          {/* Chat Platform Integration */}
          <div className="pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <MessageCircle size={16} style={{ color: 'var(--text-secondary)' }} />
                <label className="label mb-0" style={{ marginBottom: 0 }}>Chat Platform</label>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  {form.chat_enabled ? 'Enabled' : 'Disabled'}
                </span>
                <div
                  className="relative w-10 h-5 rounded-full transition-colors"
                  style={{ background: form.chat_enabled ? 'var(--accent)' : 'var(--border)' }}
                  onClick={() => setForm({ ...form, chat_enabled: !form.chat_enabled })}
                >
                  <div className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform"
                    style={{ left: form.chat_enabled ? '22px' : '2px' }} />
                </div>
              </label>
            </div>

            {form.chat_enabled && (
              <div className="space-y-3">
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Connect this agent to a messaging platform so users can chat directly via Telegram or Slack.
                </p>

                {/* Platform selector */}
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'telegram', label: '✈ Telegram', desc: 'Bot API' },
                    { id: 'slack', label: '💬 Slack', desc: 'Socket Mode' },
                  ].map((p) => (
                    <button key={p.id} type="button"
                      className="p-2.5 rounded-lg text-left text-xs transition-all"
                      style={{
                        background: form.chat_platform === p.id ? 'var(--accent-light)' : 'var(--bg-secondary)',
                        border: form.chat_platform === p.id ? '1px solid var(--accent)' : '1px solid var(--border)',
                        color: form.chat_platform === p.id ? 'var(--accent)' : 'var(--text-secondary)',
                      }}
                      onClick={() => setForm({ ...form, chat_platform: p.id })}
                    >
                      <span className="font-medium">{p.label}</span>
                      <span className="block opacity-60">{p.desc}</span>
                    </button>
                  ))}
                </div>

                {/* Bot Token */}
                <div>
                  <label className="label text-xs">
                    {form.chat_platform === 'telegram' ? 'Bot Token' : 'Bot Token (xoxb-...)'}
                  </label>
                  <input className="input text-xs font-mono" type="password"
                    value={form.chat_token}
                    onChange={(e) => setForm({ ...form, chat_token: e.target.value })}
                    placeholder={form.chat_platform === 'telegram'
                      ? 'your-telegram-bot-token'
                      : 'xoxb-your-bot-token'}
                  />
                  {form.chat_platform === 'telegram' && (
                    <p className="text-[10px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
                      Create a bot with @BotFather on Telegram to get this token.
                    </p>
                  )}
                </div>

                {/* App Token (Slack only) */}
                {form.chat_platform === 'slack' && (
                  <div>
                    <label className="label text-xs">App Token (xapp-...)</label>
                    <input className="input text-xs font-mono" type="password"
                      value={form.chat_app_token}
                      onChange={(e) => setForm({ ...form, chat_app_token: e.target.value })}
                      placeholder="xapp-your-app-token"
                    />
                    <p className="text-[10px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
                      Required for Socket Mode. Enable in your Slack App settings → Basic Information.
                    </p>
                  </div>
                )}

                {/* Allowed User IDs */}
                <div>
                  <label className="label text-xs">Allowed User IDs <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(optional)</span></label>
                  <input className="input text-xs"
                    value={form.chat_allowed_ids}
                    onChange={(e) => setForm({ ...form, chat_allowed_ids: e.target.value })}
                    placeholder="123456789, 987654321"
                  />
                  <p className="text-[10px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
                    Comma-separated user IDs. Leave empty to allow anyone with access to the bot.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-between pt-2">
            {!agent && (
              <button type="button" className="btn btn-ghost text-xs" onClick={() => setAuthType(null)}>
                ← Change type
              </button>
            )}
            <div className="flex gap-2 ml-auto">
              <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving...' : agent ? 'Update' : 'Hire Agent'}
              </button>
            </div>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Workspace files are created immediately when the agent is hired and are editable from the Memory drawer, including role-specific guidance in `ROLE.md`.
          </p>
        </form>
      </div>
    </div>
  );
}

function MemoryModal({ agent, onClose }) {
  const TABS = ['AGENTS.md', 'ROLE.md', 'SOUL.md', 'IDENTITY.md', 'USER.md', 'TOOLS.md', 'HEARTBEAT.md', 'MEMORY.md'];
  const TAB_ICONS = {
    'AGENTS.md': Shield,
    'ROLE.md': FileText,
    'SOUL.md': User,
    'IDENTITY.md': Key,
    'USER.md': Settings2,
    'TOOLS.md': Terminal,
    'HEARTBEAT.md': MessageCircle,
    'MEMORY.md': BookOpen,
  };
  const [activeTab, setActiveTab] = useState('AGENTS.md');
  const [content, setContent] = useState(agent.memory?.['AGENTS.md'] || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setContent(agent.memory?.[activeTab] || '');
  }, [activeTab, agent.memory]);

  const save = async () => {
    setSaving(true);
    try {
      await api.updateAgentMemory(agent.id, activeTab, content);
      toast.success('Saved');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const clearMemory = async () => {
    if (!confirm('Clear this agent\'s MEMORY.md?')) return;
    try {
      await api.clearAgentMemory(agent.id);
      if (activeTab === 'MEMORY.md') {
        setContent(`# MEMORY.md - Long-Term Memory\n\nUse this file for durable, curated memory: decisions, preferences, project context, and things worth remembering across sessions.\n\n## Reset\nCleared at: ${new Date().toISOString()}\n`);
      }
      toast.success('Memory cleared');
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="card w-full max-w-2xl max-h-[80vh] flex flex-col animate-fade-in" style={{ background: 'var(--bg-elevated)' }}>
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <span className="text-xl">{agent.avatar}</span>
            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{agent.name} — Workspace Files</span>
          </div>
          <button onClick={onClose} className="p-1" style={{ color: 'var(--text-tertiary)' }}><X size={18} /></button>
        </div>

        <div className="flex border-b px-4 overflow-x-auto" style={{ borderColor: 'var(--border)' }}>
          {TABS.map((tab) => {
            const Icon = TAB_ICONS[tab];
            return (
              <button key={tab}
                className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap"
                style={{
                  borderColor: activeTab === tab ? 'var(--accent)' : 'transparent',
                  color: activeTab === tab ? 'var(--accent)' : 'var(--text-tertiary)',
                }}
                onClick={() => setActiveTab(tab)}
              >
                <Icon size={13} /> {tab}
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-auto p-4">
          <textarea
            className="w-full h-full min-h-[300px] font-mono text-sm p-3 rounded-lg border resize-none"
            style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            value={content} onChange={(e) => setContent(e.target.value)}
          />
        </div>

        <div className="flex items-center justify-between p-4 border-t" style={{ borderColor: 'var(--border)' }}>
          <button className="btn btn-ghost text-xs" onClick={clearMemory} style={{ color: 'var(--danger)' }}>
            <RotateCcw size={14} /> Clear MEMORY.md
          </button>
          <div className="flex gap-2">
            <button className="btn btn-secondary text-xs" onClick={onClose}>Close</button>
            <button className="btn btn-primary text-xs" onClick={save} disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
