'use client';

import { useEffect, useState, useCallback } from 'react';
import Sidebar from '@/components/Sidebar';
import BottomBar from '@/components/BottomBar';
import { api } from '@/lib/api';
import { useSocket } from '@/app/providers';
import {
  Plus, Trash2, Edit2, Settings2, Brain, FileText,
  User, Shield, BookOpen, X, RotateCcw,
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

const MODELS = {
  anthropic: [
    { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
    { id: 'claude-opus-4-20250514', label: 'Claude Opus 4' },
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  ],
  openai: [
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { id: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
  ],
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
                          background: statusColors[agent.status] || statusColors.offline,
                          borderColor: 'var(--bg-elevated)',
                        }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{agent.name}</p>
                      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{agent.role}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="badge badge-info text-[10px]">{agent.provider}</span>
                        <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{agent.model}</span>
                      </div>
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
  const [form, setForm] = useState({
    name: agent?.name || '',
    avatar: agent?.avatar || '🤖',
    role: agent?.role || 'General Developer',
    provider: agent?.provider || 'anthropic',
    model: agent?.model || 'claude-sonnet-4-20250514',
    personality: agent?.personality || '',
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (agent) {
        await api.updateAgent(agent.id, form);
        toast.success('Agent updated');
      } else {
        await api.createAgent(form);
        toast.success('Agent hired!');
      }
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="card p-6 w-full max-w-md max-h-[85vh] overflow-auto animate-fade-in" style={{ background: 'var(--bg-elevated)' }}>
        <h3 className="font-semibold text-lg mb-4" style={{ color: 'var(--text-primary)' }}>
          {agent ? 'Edit Agent' : 'Hire New Agent'}
        </h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Avatar</label>
            <div className="flex flex-wrap gap-2">
              {AVATARS.map((a) => (
                <button
                  key={a}
                  type="button"
                  className="w-10 h-10 rounded-lg text-xl flex items-center justify-center transition-all"
                  style={{
                    background: form.avatar === a ? 'var(--accent-light)' : 'var(--bg-secondary)',
                    border: form.avatar === a ? '2px solid var(--accent)' : '1px solid var(--border)',
                  }}
                  onClick={() => setForm({ ...form, avatar: a })}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Name</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g., Alex, Sam, CodeBot" required />
          </div>
          <div>
            <label className="label">Role</label>
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {ROLE_PRESETS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Provider</label>
              <select className="input" value={form.provider}
                onChange={(e) => {
                  const p = e.target.value;
                  setForm({ ...form, provider: p, model: MODELS[p]?.[0]?.id || '' });
                }}>
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai">OpenAI (GPT)</option>
              </select>
            </div>
            <div>
              <label className="label">Model</label>
              <select className="input" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })}>
                {(MODELS[form.provider] || []).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Personality / Instructions</label>
            <textarea className="input" value={form.personality} onChange={(e) => setForm({ ...form, personality: e.target.value })}
              placeholder="e.g., Methodical, always writes tests, prefers functional patterns..." rows={3} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : agent ? 'Update' : 'Hire Agent'}
            </button>
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

        {/* Tabs */}
        <div className="flex border-b px-4" style={{ borderColor: 'var(--border)' }}>
          {TABS.map((tab) => {
            const Icon = TAB_ICONS[tab];
            return (
              <button
                key={tab}
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

        {/* Editor */}
        <div className="flex-1 overflow-auto p-4">
          <textarea
            className="w-full h-full min-h-[300px] font-mono text-sm p-3 rounded-lg border resize-none"
            style={{
              background: 'var(--bg-secondary)',
              borderColor: 'var(--border)',
              color: 'var(--text-primary)',
            }}
            value={content}
            onChange={(e) => setContent(e.target.value)}
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
