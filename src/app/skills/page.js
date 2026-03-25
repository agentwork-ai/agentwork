'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import Sidebar from '../../components/Sidebar';
import BottomBar from '../../components/BottomBar';
import MarkdownContent from '../../components/MarkdownContent';
import { api } from '../../lib/api';
import {
  Plus,
  Upload,
  Download,
  ExternalLink,
  Trash2,
  Sparkles,
  Bot,
  Wrench,
  X,
  RefreshCw,
} from 'lucide-react';

const SOURCE_META = {
  created: { label: 'Created', color: '#5c7cfa', bg: '#4c6ef520' },
  imported: { label: 'Imported', color: '#20c997', bg: '#20c99720' },
  clawhub: { label: 'ClawHub', color: '#f08c00', bg: '#ff922b20' },
  local: { label: 'Local', color: '#868e96', bg: '#868e9620' },
};

function getSourceMeta(source) {
  return SOURCE_META[source] || SOURCE_META.local;
}

function formatTimestamp(value) {
  if (!value) return 'Unknown';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function emptyCreateForm(agentId = '') {
  return {
    creator_agent_id: agentId,
    name: '',
    slug: '',
    description: '',
    use_when: '',
    workflow: '',
    notes: '',
  };
}

function CreateSkillModal({ agents, form, setForm, saving, onClose, onSubmit }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="card w-full max-w-2xl max-h-[85vh] overflow-auto animate-fade-in" style={{ background: 'var(--bg-elevated)' }}>
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Create Skill</h2>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Choose an agent to author the first draft, then store the skill in `~/.agentwork/skills`.
            </p>
          </div>
          <button className="p-2 rounded-lg" onClick={onClose} style={{ color: 'var(--text-tertiary)' }}>
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="label">Creator Agent</label>
            <select
              className="input"
              value={form.creator_agent_id}
              onChange={(e) => setForm((current) => ({ ...current, creator_agent_id: e.target.value }))}
            >
              <option value="">Select agent</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.avatar} {agent.name} · {agent.role}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">Skill Name</label>
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
                placeholder="Firebase crash insights"
              />
            </div>
            <div>
              <label className="label">Slug <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(Optional)</span></label>
              <input
                className="input font-mono text-sm"
                value={form.slug}
                onChange={(e) => setForm((current) => ({ ...current, slug: e.target.value }))}
                placeholder="firebase-crash-insights"
              />
            </div>
          </div>

          <div>
            <label className="label">Short Description</label>
            <input
              className="input"
              value={form.description}
              onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))}
              placeholder="Summarize crash trends, propose fixes, and help implement them."
            />
          </div>

          <div>
            <label className="label">Use When</label>
            <textarea
              className="input resize-none"
              rows={3}
              value={form.use_when}
              onChange={(e) => setForm((current) => ({ ...current, use_when: e.target.value }))}
              placeholder="Use when the user asks to review Crashlytics health or identify the top crash regressions."
            />
          </div>

          <div>
            <label className="label">Workflow</label>
            <textarea
              className="input resize-none"
              rows={4}
              value={form.workflow}
              onChange={(e) => setForm((current) => ({ ...current, workflow: e.target.value }))}
              placeholder={'1. Gather context.\n2. Inspect the relevant project state.\n3. Execute the task.\n4. Verify and summarize.'}
            />
          </div>

          <div>
            <label className="label">Notes <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(Optional)</span></label>
            <textarea
              className="input resize-none"
              rows={3}
              value={form.notes}
              onChange={(e) => setForm((current) => ({ ...current, notes: e.target.value }))}
              placeholder="Mention important tools, constraints, or output expectations."
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-5 border-t" style={{ borderColor: 'var(--border)' }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={onSubmit}
            disabled={saving || !form.creator_agent_id || !form.name.trim()}
          >
            {saving ? 'Creating...' : 'Create Skill'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportSkillModal({ form, setForm, saving, onClose, onSubmit }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="card w-full max-w-xl animate-fade-in" style={{ background: 'var(--bg-elevated)' }}>
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Import Skill</h2>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Import a local skill folder or a direct `SKILL.md` path into `~/.agentwork/skills`.
            </p>
          </div>
          <button className="p-2 rounded-lg" onClick={onClose} style={{ color: 'var(--text-tertiary)' }}>
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="label">Source Path</label>
            <input
              className="input font-mono text-sm"
              value={form.source_path}
              onChange={(e) => setForm((current) => ({ ...current, source_path: e.target.value }))}
              placeholder="/Users/you/skills/firebase-crash-insights"
            />
          </div>
          <div>
            <label className="label">Target Slug <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>(Optional)</span></label>
            <input
              className="input font-mono text-sm"
              value={form.slug}
              onChange={(e) => setForm((current) => ({ ...current, slug: e.target.value }))}
              placeholder="firebase-crash-insights"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 p-5 border-t" style={{ borderColor: 'var(--border)' }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={onSubmit}
            disabled={saving || !form.source_path.trim()}
          >
            {saving ? 'Importing...' : 'Import Skill'}
          </button>
        </div>
      </div>
    </div>
  );
}

function InstallSkillModal({ form, setForm, saving, onClose, onSubmit }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="card w-full max-w-xl animate-fade-in" style={{ background: 'var(--bg-elevated)' }}>
        <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Install From Marketplace</h2>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Paste a ClawHub skill slug or full URL. AgentWork will install it into `~/.agentwork/skills`.
            </p>
          </div>
          <button className="p-2 rounded-lg" onClick={onClose} style={{ color: 'var(--text-tertiary)' }}>
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="label">ClawHub Slug or URL</label>
            <input
              className="input font-mono text-sm"
              value={form.slug_or_url}
              onChange={(e) => setForm((current) => ({ ...current, slug_or_url: e.target.value }))}
              placeholder="firebase-crash-insights or https://clawhub.ai/skills/firebase-crash-insights"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 p-5 border-t" style={{ borderColor: 'var(--border)' }}>
          <a
            href="https://clawhub.ai/"
            target="_blank"
            rel="noreferrer"
            className="text-xs inline-flex items-center gap-1.5"
            style={{ color: 'var(--accent)' }}
          >
            Browse ClawHub <ExternalLink size={13} />
          </a>
          <div className="flex items-center gap-2">
            <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button
              className="btn btn-primary"
              onClick={onSubmit}
              disabled={saving || !form.slug_or_url.trim()}
            >
              {saving ? 'Installing...' : 'Install Skill'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SkillsPage() {
  const [agents, setAgents] = useState([]);
  const [skillsData, setSkillsData] = useState(null);
  const [selectedSlug, setSelectedSlug] = useState('');
  const [selectedSkill, setSelectedSkill] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showInstall, setShowInstall] = useState(false);
  const [savingAction, setSavingAction] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreateForm());
  const [importForm, setImportForm] = useState({ source_path: '', slug: '' });
  const [installForm, setInstallForm] = useState({ slug_or_url: '' });

  const loadBase = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const [skillsResult, agentsResult] = await Promise.all([
        api.getSkills(),
        api.getAgents(),
      ]);
      setSkillsData(skillsResult);
      setAgents(agentsResult);
      setSelectedSlug((current) => {
        if (current && skillsResult.skills.some((skill) => skill.slug === current)) return current;
        return skillsResult.skills[0]?.slug || '';
      });
    } catch (err) {
      toast.error(err.message);
    } finally {
      if (!silent) setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadBase();
  }, [loadBase]);

  useEffect(() => {
    if (!selectedSlug) {
      setSelectedSkill(null);
      return;
    }

    let cancelled = false;
    setDetailLoading(true);
    api.getSkill(selectedSlug)
      .then((data) => {
        if (!cancelled) setSelectedSkill(data);
      })
      .catch((err) => {
        if (!cancelled) toast.error(err.message);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSlug]);

  useEffect(() => {
    if (!showCreate) return;
    setCreateForm((current) => ({
      ...current,
      creator_agent_id: current.creator_agent_id || agents[0]?.id || '',
    }));
  }, [showCreate, agents]);

  const installedSkills = skillsData?.skills || [];
  const selectedSkillSummary = useMemo(
    () => installedSkills.find((skill) => skill.slug === selectedSlug) || null,
    [installedSkills, selectedSlug]
  );

  const handleCreateSkill = async () => {
    setSavingAction(true);
    try {
      const created = await api.createSkill(createForm);
      toast.success(`Created ${created.name}`);
      setShowCreate(false);
      setCreateForm(emptyCreateForm(agents[0]?.id || ''));
      await loadBase({ silent: true });
      setSelectedSlug(created.slug);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingAction(false);
    }
  };

  const handleImportSkill = async () => {
    setSavingAction(true);
    try {
      const created = await api.importSkill(importForm);
      toast.success(`Imported ${created.name}`);
      setShowImport(false);
      setImportForm({ source_path: '', slug: '' });
      await loadBase({ silent: true });
      setSelectedSlug(created.slug);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingAction(false);
    }
  };

  const handleInstallSkill = async () => {
    setSavingAction(true);
    try {
      const created = await api.installSkill(installForm);
      toast.success(`Installed ${created.name}`);
      setShowInstall(false);
      setInstallForm({ slug_or_url: '' });
      await loadBase({ silent: true });
      setSelectedSlug(created.slug);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSavingAction(false);
    }
  };

  const handleDeleteSkill = async (skill) => {
    if (!confirm(`Delete ${skill.name}? This will also remove it from any assigned agents.`)) return;
    try {
      await api.deleteSkill(skill.slug);
      toast.success(`Deleted ${skill.name}`);
      await loadBase({ silent: true });
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <div className="flex items-center justify-between px-6 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h1 className="font-semibold text-lg" style={{ color: 'var(--text-primary)' }}>Skills</h1>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Shared skill library stored in `~/.agentwork/skills` and assignable to agents.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn btn-secondary text-sm" onClick={() => loadBase({ silent: true })} disabled={refreshing}>
              <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /> Refresh
            </button>
            <button className="btn btn-secondary text-sm" onClick={() => setShowImport(true)}>
              <Upload size={15} /> Import
            </button>
            <button className="btn btn-secondary text-sm" onClick={() => setShowInstall(true)}>
              <Download size={15} /> Install
            </button>
            <button className="btn btn-primary text-sm" onClick={() => setShowCreate(true)}>
              <Plus size={16} /> Create Skill
            </button>
          </div>
        </div>

        <main className="flex-1 overflow-auto p-6" style={{ background: 'var(--bg-primary)' }}>
          <div className="grid grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)] gap-5">
            <section className="card p-4 flex flex-col min-h-[420px]">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Installed Skills</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                    {installedSkills.length} installed
                  </p>
                </div>
                <a
                  href={skillsData?.marketplace_url || 'https://clawhub.ai/'}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs inline-flex items-center gap-1.5"
                  style={{ color: 'var(--accent)' }}
                >
                  Marketplace <ExternalLink size={13} />
                </a>
              </div>

              {loading ? (
                <div className="flex-1 flex items-center justify-center text-sm" style={{ color: 'var(--text-tertiary)' }}>
                  Loading skills...
                </div>
              ) : installedSkills.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6 rounded-xl border"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
                  <Wrench size={36} style={{ color: 'var(--text-tertiary)' }} />
                  <p className="text-sm font-medium mt-3" style={{ color: 'var(--text-primary)' }}>No skills installed yet</p>
                  <p className="text-xs mt-2 max-w-xs" style={{ color: 'var(--text-tertiary)' }}>
                    Create one with an agent, import an existing skill folder, or install from ClawHub.
                  </p>
                  <div className="flex flex-wrap justify-center gap-2 mt-4">
                    <button className="btn btn-primary text-sm" onClick={() => setShowCreate(true)}>
                      <Plus size={15} /> Create
                    </button>
                    <button className="btn btn-secondary text-sm" onClick={() => setShowInstall(true)}>
                      <Download size={15} /> Install
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 overflow-auto pr-1">
                  {installedSkills.map((skill) => {
                    const source = getSourceMeta(skill.source);
                    const selected = skill.slug === selectedSlug;
                    return (
                      <button
                        key={skill.slug}
                        className="w-full text-left p-3 rounded-xl border transition-colors"
                        style={{
                          borderColor: selected ? 'var(--accent)' : 'var(--border)',
                          background: selected ? 'var(--accent-light)' : 'var(--bg-secondary)',
                        }}
                        onClick={() => setSelectedSlug(skill.slug)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{skill.name}</p>
                            <p className="text-[11px] font-mono truncate mt-1" style={{ color: 'var(--text-tertiary)' }}>{skill.slug}</p>
                          </div>
                          <span className="text-[10px] px-2 py-1 rounded-full" style={{ color: source.color, background: source.bg }}>
                            {source.label}
                          </span>
                        </div>
                        <p className="text-xs mt-2 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
                          {skill.description || 'No description'}
                        </p>
                        <div className="flex items-center gap-3 mt-3 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                          <span>{skill.assigned_count || 0} agent{skill.assigned_count === 1 ? '' : 's'}</span>
                          <span>{skill.has_scripts ? 'scripts' : 'no scripts'}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="card min-h-[420px] overflow-hidden">
              {selectedSkillSummary ? (
                <div className="flex flex-col h-full">
                  <div className="flex items-start justify-between gap-4 p-5 border-b" style={{ borderColor: 'var(--border)' }}>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {selectedSkillSummary.name}
                        </h2>
                        {(() => {
                          const source = getSourceMeta(selectedSkillSummary.source);
                          return (
                            <span className="text-[10px] px-2 py-1 rounded-full" style={{ color: source.color, background: source.bg }}>
                              {source.label}
                            </span>
                          );
                        })()}
                      </div>
                      <p className="text-xs font-mono mt-1" style={{ color: 'var(--text-tertiary)' }}>
                        {selectedSkillSummary.slug}
                      </p>
                      <p className="text-sm mt-3 max-w-3xl" style={{ color: 'var(--text-secondary)' }}>
                        {selectedSkillSummary.description || 'No description'}
                      </p>
                    </div>
                    <button
                      className="btn btn-ghost text-sm shrink-0"
                      style={{ color: 'var(--danger)' }}
                      onClick={() => handleDeleteSkill(selectedSkillSummary)}
                    >
                      <Trash2 size={15} /> Delete
                    </button>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] flex-1 min-h-0">
                    <div className="p-5 border-r overflow-auto" style={{ borderColor: 'var(--border)' }}>
                      <div className="space-y-4">
                        <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
                          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>
                            Storage
                          </p>
                          <p className="text-xs font-mono mt-2 break-all" style={{ color: 'var(--text-secondary)' }}>
                            {skillsData?.shared_skills_dir || '~/.agentwork/skills'}
                          </p>
                          <p className="text-[11px] mt-2" style={{ color: 'var(--text-tertiary)' }}>
                            Installed into the shared skills library and available for assignment to any agent.
                          </p>
                        </div>

                        <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
                          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>
                            Metadata
                          </p>
                          <div className="space-y-2 mt-3 text-xs">
                            <div>
                              <p style={{ color: 'var(--text-tertiary)' }}>Created / Updated</p>
                              <p style={{ color: 'var(--text-primary)' }}>{formatTimestamp(selectedSkillSummary.created_at)} / {formatTimestamp(selectedSkillSummary.updated_at)}</p>
                            </div>
                            {selectedSkillSummary.creator_agent_name ? (
                              <div>
                                <p style={{ color: 'var(--text-tertiary)' }}>Creator Agent</p>
                                <p style={{ color: 'var(--text-primary)' }}>{selectedSkillSummary.creator_agent_name}</p>
                              </div>
                            ) : null}
                            {selectedSkillSummary.marketplace_slug ? (
                              <div>
                                <p style={{ color: 'var(--text-tertiary)' }}>Marketplace Slug</p>
                                <p className="font-mono" style={{ color: 'var(--text-primary)' }}>{selectedSkillSummary.marketplace_slug}</p>
                              </div>
                            ) : null}
                            {selectedSkillSummary.source_path ? (
                              <div>
                                <p style={{ color: 'var(--text-tertiary)' }}>Imported From</p>
                                <p className="font-mono break-all" style={{ color: 'var(--text-primary)' }}>{selectedSkillSummary.source_path}</p>
                              </div>
                            ) : null}
                          </div>
                        </div>

                        <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
                          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>
                            Resources
                          </p>
                          <div className="flex flex-wrap gap-2 mt-3">
                            {selectedSkillSummary.has_scripts ? (
                              <span className="badge text-[10px]" style={{ background: '#20c99720', color: '#20c997' }}>scripts/</span>
                            ) : null}
                            {selectedSkillSummary.has_references ? (
                              <span className="badge text-[10px]" style={{ background: '#4c6ef520', color: '#5c7cfa' }}>references/</span>
                            ) : null}
                            {selectedSkillSummary.has_assets ? (
                              <span className="badge text-[10px]" style={{ background: '#ff922b20', color: '#f08c00' }}>assets/</span>
                            ) : null}
                            {selectedSkillSummary.extra_files?.map((file) => (
                              <span key={file} className="badge text-[10px]" style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>
                                {file}
                              </span>
                            ))}
                            {!selectedSkillSummary.has_scripts && !selectedSkillSummary.has_references && !selectedSkillSummary.has_assets && (!selectedSkillSummary.extra_files || selectedSkillSummary.extra_files.length === 0) ? (
                              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>No extra resources</span>
                            ) : null}
                          </div>
                        </div>

                        <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
                          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>
                            Assigned Agents
                          </p>
                          {selectedSkill?.assigned_agents?.length ? (
                            <div className="space-y-2 mt-3">
                              {selectedSkill.assigned_agents.map((agent) => (
                                <div key={agent.id} className="flex items-center gap-2">
                                  <span className="text-base">{agent.avatar}</span>
                                  <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{agent.name}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs mt-3" style={{ color: 'var(--text-tertiary)' }}>
                              No agents are using this skill yet. Assign it from Agents or onboarding.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="p-5 overflow-auto min-h-0">
                      <div className="flex items-center gap-2 mb-4">
                        <Sparkles size={16} style={{ color: 'var(--accent)' }} />
                        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                          SKILL.md
                        </p>
                      </div>
                      {detailLoading ? (
                        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading skill content...</p>
                      ) : selectedSkill?.content ? (
                        <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
                          <MarkdownContent content={selectedSkill.content} />
                        </div>
                      ) : (
                        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No SKILL.md content found.</p>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-full min-h-[420px] flex flex-col items-center justify-center p-8 text-center">
                  <Bot size={40} style={{ color: 'var(--text-tertiary)' }} />
                  <p className="text-base font-semibold mt-4" style={{ color: 'var(--text-primary)' }}>No skill selected</p>
                  <p className="text-sm mt-2 max-w-md" style={{ color: 'var(--text-tertiary)' }}>
                    Pick an installed skill to inspect its `SKILL.md`, see who uses it, or remove it from the shared library.
                  </p>
                </div>
              )}
            </section>
          </div>
        </main>
        <BottomBar />
      </div>

      {showCreate ? (
        <CreateSkillModal
          agents={agents}
          form={createForm}
          setForm={setCreateForm}
          saving={savingAction}
          onClose={() => setShowCreate(false)}
          onSubmit={handleCreateSkill}
        />
      ) : null}

      {showImport ? (
        <ImportSkillModal
          form={importForm}
          setForm={setImportForm}
          saving={savingAction}
          onClose={() => setShowImport(false)}
          onSubmit={handleImportSkill}
        />
      ) : null}

      {showInstall ? (
        <InstallSkillModal
          form={installForm}
          setForm={setInstallForm}
          saving={savingAction}
          onClose={() => setShowInstall(false)}
          onSubmit={handleInstallSkill}
        />
      ) : null}
    </div>
  );
}
