'use client';

import { useEffect, useState, useCallback } from 'react';
import Sidebar from '@/components/Sidebar';
import BottomBar from '@/components/BottomBar';
import { api } from '@/lib/api';
import { useSocket } from '@/app/providers';
import {
  Plus, Trash2, Edit2, Settings2, Brain, FileText,
  User, Shield, BookOpen, X, RotateCcw, Key, Terminal,
} from 'lucide-react';
import { toast } from 'react-hot-toast';

const AVATARS = ['🤖', '🧠', '⚡', '🔧', '🎯', '🚀', '💡', '🛠️', '🔬', '🎨', '👾', '🦾'];

const ROLE_PRESETS = [
  'General Developer',
  'Senior React Developer',
  'Backend Engineer',
  'DevOps Engineer',
  'Full-Stack Developer',
  'UI/UX Developer',
  'Data Engineer',
  'Security Engineer',
  'QA / Test Engineer',
  'Technical Writer',
];

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

const TIER_COLORS = {
  flagship: { bg: '#ffd43b20', color: '#fcc419' },
  balanced: { bg: '#4c6ef520', color: '#5c7cfa' },
  fast: { bg: '#40c05720', color: '#51cf66' },
  reasoning: { bg: '#f0659520', color: '#f06595' },
  code: { bg: '#20c99720', color: '#20c997' },
};

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
                          background: agent.auth_type === 'cli' ? '#20c99720' : 'var(--accent-light)',
                          color: agent.auth_type === 'cli' ? '#20c997' : 'var(--accent)',
                        }}>
                          {agent.auth_type === 'cli' ? '⌨ CLI' : '🔑 API'}
                        </span>
                        <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                          {agent.provider}{agent.model ? ` / ${agent.model}` : ''}
                        </span>
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
                    <button className="btn btn-ghost text-xs" style={{ color: 'var(--danger)' }} onClick={() => deleteAgent(agent.id)}>
                      <Trash2 size={14} />
                    </button>
                  </div>
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
    role: agent?.role || 'General Developer',
    auth_type: agent?.auth_type || 'api',
    provider: agent?.provider || 'anthropic',
    model: agent?.model || '',
    personality: agent?.personality || '',
  });
  const [saving, setSaving] = useState(false);

  // If editing, skip the type selection
  const showTypeSelector = !agent && !authType;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data = { ...form };
      if (data.auth_type === 'cli') {
        // CLI mode: model is optional
        if (!data.model) data.model = '';
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
        <div className="card p-6 w-full max-w-lg animate-fade-in" style={{ background: 'var(--bg-elevated)' }}>
          <h3 className="font-semibold text-lg mb-2" style={{ color: 'var(--text-primary)' }}>
            Hire New Agent
          </h3>
          <p className="text-sm mb-5" style={{ color: 'var(--text-tertiary)' }}>
            Choose how this agent will authenticate
          </p>

          <div className="grid grid-cols-2 gap-4">
            {/* API Key option */}
            <button
              className="card p-5 text-left hover:scale-[1.02] transition-transform"
              style={{ borderColor: 'var(--border)' }}
              onClick={() => {
                setAuthType('api');
                setForm((f) => ({ ...f, auth_type: 'api', provider: 'anthropic', model: 'claude-sonnet-4-6' }));
              }}
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

            {/* CLI option */}
            <button
              className="card p-5 text-left hover:scale-[1.02] transition-transform"
              style={{ borderColor: 'var(--border)' }}
              onClick={() => {
                setAuthType('cli');
                setForm((f) => ({ ...f, auth_type: 'cli', provider: 'claude-cli', model: '' }));
              }}
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

          <div className="flex justify-end mt-5">
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  const isCli = form.auth_type === 'cli';
  const providerModels = !isCli ? (API_MODELS[form.provider] || []) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="card p-6 w-full max-w-md max-h-[85vh] overflow-auto animate-fade-in" style={{ background: 'var(--bg-elevated)' }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-lg" style={{ color: 'var(--text-primary)' }}>
            {agent ? 'Edit Agent' : 'Hire New Agent'}
          </h3>
          <span className="badge text-[10px]" style={{
            background: isCli ? '#20c99720' : 'var(--accent-light)',
            color: isCli ? '#20c997' : 'var(--accent)',
          }}>
            {isCli ? '⌨ CLI Mode' : '🔑 API Mode'}
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
              {ROLE_PRESETS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
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
        </form>
      </div>
    </div>
  );
}

function MemoryModal({ agent, onClose }) {
  const TABS = ['SOUL.md', 'USER.md', 'AGENTS.md', 'MEMORY.md'];
  const TAB_ICONS = { 'SOUL.md': User, 'USER.md': Settings2, 'AGENTS.md': Shield, 'MEMORY.md': BookOpen };
  const [activeTab, setActiveTab] = useState('SOUL.md');
  const [content, setContent] = useState(agent.memory?.['SOUL.md'] || '');
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
        setContent(`# ${agent.name} - Long-term Memory\n## Cleared: ${new Date().toISOString()}\nNo memories recorded yet.\n`);
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
            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{agent.name} — Memory Files</span>
          </div>
          <button onClick={onClose} className="p-1" style={{ color: 'var(--text-tertiary)' }}><X size={18} /></button>
        </div>

        <div className="flex border-b px-4" style={{ borderColor: 'var(--border)' }}>
          {TABS.map((tab) => {
            const Icon = TAB_ICONS[tab];
            return (
              <button key={tab}
                className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors"
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
