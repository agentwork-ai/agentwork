'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { toast } from 'react-hot-toast';
import {
  Zap,
  Key,
  FolderOpen,
  Users,
  ChevronRight,
  ChevronLeft,
  Check,
  Eye,
  EyeOff,
  SkipForward,
  X,
} from 'lucide-react';

const ROLE_PRESETS = [
  'General Developer',
  'Senior React Developer',
  'Backend Engineer',
  'DevOps Engineer',
  'Full-Stack Developer',
  'UI/UX Developer',
  'Data Engineer',
  'QA / Test Engineer',
];

const PROVIDERS = [
  { id: 'anthropic', label: 'Anthropic (Claude)' },
  { id: 'openai', label: 'OpenAI (GPT)' },
  { id: 'google', label: 'Google (Gemini)' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'mistral', label: 'Mistral AI' },
  { id: 'openrouter', label: 'OpenRouter' },
];

const MODELS = {
  anthropic: [
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  ],
  openai: [
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { id: 'o3-mini', label: 'o3 Mini' },
  ],
  google: [
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  ],
  deepseek: [
    { id: 'deepseek-chat', label: 'DeepSeek V3' },
    { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
  ],
  mistral: [
    { id: 'mistral-large-latest', label: 'Mistral Large' },
    { id: 'codestral-latest', label: 'Codestral' },
  ],
  openrouter: [
    { id: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4' },
    { id: 'openai/gpt-4o', label: 'GPT-4o' },
    { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  ],
};

const STEPS = [
  { key: 'welcome', label: 'Welcome', icon: Zap },
  { key: 'agent', label: 'Agent', icon: Users },
  { key: 'api-keys', label: 'API Keys', icon: Key },
  { key: 'project', label: 'Project', icon: FolderOpen },
];

export default function OnboardingWizard({ onComplete }) {
  const [step, setStep] = useState(0);
  const [dontShowAgain, setDontShowAgain] = useState(true);
  const [saving, setSaving] = useState(false);

  // Step 2: API Keys
  const [showKeys, setShowKeys] = useState({});
  const [apiKeys, setApiKeys] = useState({
    anthropic_api_key: '',
    openai_api_key: '',
    openrouter_api_key: '',
  });

  // Step 3: Project
  const [project, setProject] = useState({ name: '', path: '' });
  const [browsing, setBrowsing] = useState(false);

  // Step 4: Agent
  const [agentAuthType, setAgentAuthType] = useState('api'); // 'api' or 'cli'
  const [agent, setAgent] = useState({
    name: '',
    role: 'General Developer',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    customModel: '',
  });

  const currentStep = STEPS[step];
  const isLast = step === STEPS.length - 1;

  const handleFinish = async () => {
    if (dontShowAgain) {
      try {
        await api.updateSettings({ onboarding_complete: 'true' });
      } catch {}
    }
    onComplete();
  };

  const handleSkip = () => {
    if (isLast) {
      handleFinish();
    } else {
      setStep(step + 1);
    }
  };

  const handleNext = () => {
    if (isLast) {
      handleFinish();
    } else {
      setStep(step + 1);
    }
  };

  const handleBack = () => {
    if (step > 0) setStep(step - 1);
  };

  // Step 2: Save API Keys
  const saveApiKeys = async () => {
    setSaving(true);
    try {
      const keysToSave = {};
      if (apiKeys.anthropic_api_key) keysToSave.anthropic_api_key = apiKeys.anthropic_api_key;
      if (apiKeys.openai_api_key) keysToSave.openai_api_key = apiKeys.openai_api_key;
      if (apiKeys.openrouter_api_key) keysToSave.openrouter_api_key = apiKeys.openrouter_api_key;
      if (Object.keys(keysToSave).length > 0) {
        await api.updateSettings(keysToSave);
        toast.success('API keys saved');
      }
      handleNext();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Step 3: Create Project
  const saveProject = async () => {
    if (!project.name || !project.path) {
      toast.error('Please fill in both name and path');
      return;
    }
    setSaving(true);
    try {
      await api.createProject({ name: project.name, path: project.path });
      toast.success('Project created');
      handleFinish();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Step 4: Create Agent
  const saveAgent = async () => {
    if (!agent.name) {
      toast.error('Please enter an agent name');
      return;
    }
    setSaving(true);
    try {
      const modelId = agent.provider === 'openrouter' && agent.customModel
        ? agent.customModel
        : agent.model;
      await api.createAgent({
        name: agent.name,
        role: agent.role,
        auth_type: agentAuthType,
        provider: agentAuthType === 'cli' ? 'anthropic' : agent.provider,
        model: agentAuthType === 'cli' ? '' : modelId,
      });
      toast.success('Agent hired!');
      handleNext();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleBrowse = async () => {
    setBrowsing(true);
    try {
      const result = await api.browseFolder();
      if (result.path) {
        const folderPath = result.path.replace(/\/$/, '');
        const folderName = folderPath.split('/').pop();
        setProject((f) => ({
          ...f,
          path: folderPath,
          name: f.name || folderName,
        }));
      }
    } catch (err) {
      toast.error('Could not open folder picker: ' + err.message);
    } finally {
      setBrowsing(false);
    }
  };

  const providerModels = MODELS[agent.provider] || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div
        className="card w-full max-w-lg animate-fade-in"
        style={{ background: 'var(--bg-elevated)' }}
      >
        {/* Progress indicator */}
        <div className="flex items-center gap-1 px-6 pt-5 pb-2">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const isActive = i === step;
            const isDone = i < step;
            return (
              <div key={s.key} className="flex items-center flex-1">
                <div className="flex items-center gap-2 flex-1">
                  <div
                    className="flex items-center justify-center w-7 h-7 rounded-full shrink-0 transition-all"
                    style={{
                      background: isActive
                        ? 'var(--accent)'
                        : isDone
                        ? 'var(--success)'
                        : 'var(--bg-tertiary)',
                      color: isActive || isDone ? 'white' : 'var(--text-tertiary)',
                    }}
                  >
                    {isDone ? <Check size={14} /> : <Icon size={14} />}
                  </div>
                  <span
                    className="text-xs font-medium hidden sm:block"
                    style={{
                      color: isActive ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    }}
                  >
                    {s.label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div
                    className="h-px flex-1 mx-2"
                    style={{
                      background: i < step ? 'var(--success)' : 'var(--border)',
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>

        <div className="text-[11px] px-6 pb-3" style={{ color: 'var(--text-tertiary)' }}>
          Step {step + 1} of {STEPS.length}
        </div>

        {/* Step Content */}
        <div className="px-6 pb-4" style={{ minHeight: '260px' }}>
          {/* Step 1: Welcome */}
          {currentStep.key === 'welcome' && (
            <div className="text-center py-6">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-5"
                style={{ background: 'var(--accent)', color: 'white' }}
              >
                <Zap size={32} />
              </div>
              <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
                Welcome to AgentWork
              </h2>
              <p className="text-sm leading-relaxed max-w-sm mx-auto" style={{ color: 'var(--text-secondary)' }}>
                Your autonomous AI agent orchestrator. Let's get you set up in just a few steps
                -- add your API keys, create a project, and hire your first agent.
              </p>
            </div>
          )}

          {/* API Keys */}
          {currentStep.key === 'api-keys' && (
            <div>
              <h2 className="text-lg font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                Add API Keys
              </h2>
              <p className="text-sm mb-5" style={{ color: 'var(--text-tertiary)' }}>
                Enter at least one API key so your agents can call AI models. You can always add more later in Settings.
              </p>
              <div className="space-y-4">
                <div>
                  <label className="label">Anthropic API Key</label>
                  <div className="flex gap-2">
                    <input
                      className="input flex-1 font-mono text-sm"
                      type={showKeys.anthropic ? 'text' : 'password'}
                      value={apiKeys.anthropic_api_key}
                      onChange={(e) =>
                        setApiKeys({ ...apiKeys, anthropic_api_key: e.target.value })
                      }
                      placeholder="sk-ant-..."
                    />
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setShowKeys((p) => ({ ...p, anthropic: !p.anthropic }))}
                    >
                      {showKeys.anthropic ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="label">OpenAI API Key</label>
                  <div className="flex gap-2">
                    <input
                      className="input flex-1 font-mono text-sm"
                      type={showKeys.openai ? 'text' : 'password'}
                      value={apiKeys.openai_api_key}
                      onChange={(e) =>
                        setApiKeys({ ...apiKeys, openai_api_key: e.target.value })
                      }
                      placeholder="sk-..."
                    />
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setShowKeys((p) => ({ ...p, openai: !p.openai }))}
                    >
                      {showKeys.openai ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="label">OpenRouter API Key <span className="font-normal text-[10px]" style={{ color: 'var(--text-tertiary)' }}>(200+ models via one key)</span></label>
                  <div className="flex gap-2">
                    <input
                      className="input flex-1 font-mono text-sm"
                      type={showKeys.openrouter ? 'text' : 'password'}
                      value={apiKeys.openrouter_api_key}
                      onChange={(e) =>
                        setApiKeys({ ...apiKeys, openrouter_api_key: e.target.value })
                      }
                      placeholder="sk-or-..."
                    />
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setShowKeys((p) => ({ ...p, openrouter: !p.openrouter }))}
                    >
                      {showKeys.openrouter ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <p className="text-[10px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
                    Get a key at openrouter.ai — access Claude, GPT, Gemini, and more with one key
                  </p>
                </div>
                <div className="pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    Or skip API keys entirely — you can use <strong>Claude Code CLI</strong> or <strong>OpenAI Codex CLI</strong> in the next step (no API key needed).
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Create Project */}
          {currentStep.key === 'project' && (
            <div>
              <h2 className="text-lg font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                Create a Project
              </h2>
              <p className="text-sm mb-5" style={{ color: 'var(--text-tertiary)' }}>
                Link a local codebase so agents know what they're working on.
              </p>
              <div className="space-y-4">
                <div>
                  <label className="label">Project Name</label>
                  <input
                    className="input"
                    value={project.name}
                    onChange={(e) => setProject({ ...project, name: e.target.value })}
                    placeholder="e.g., My App"
                  />
                </div>
                <div>
                  <label className="label">Local Path</label>
                  <div className="flex gap-2">
                    <input
                      className="input font-mono text-sm flex-1"
                      value={project.path}
                      onChange={(e) => setProject({ ...project, path: e.target.value })}
                      placeholder="/Users/you/projects/myapp"
                    />
                    <button
                      type="button"
                      className="btn btn-secondary shrink-0 flex items-center gap-1.5"
                      onClick={handleBrowse}
                      disabled={browsing}
                    >
                      <FolderOpen size={14} />
                      {browsing ? '...' : 'Browse'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 4: Hire Agent */}
          {currentStep.key === 'agent' && (
            <div>
              <h2 className="text-lg font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                Hire Your First Agent
              </h2>
              <p className="text-sm mb-4" style={{ color: 'var(--text-tertiary)' }}>
                Create an AI agent that will work on your tasks.
              </p>
              <div className="space-y-3">
                {/* Auth Type Toggle */}
                <div>
                  <label className="label">Authentication Mode</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className="p-2.5 rounded-lg border text-xs text-left transition-all"
                      style={{
                        borderColor: agentAuthType === 'api' ? 'var(--accent)' : 'var(--border)',
                        background: agentAuthType === 'api' ? 'var(--accent-light)' : 'transparent',
                        color: agentAuthType === 'api' ? 'var(--accent)' : 'var(--text-secondary)',
                      }}
                      onClick={() => setAgentAuthType('api')}
                    >
                      <div className="flex items-center gap-1.5 font-semibold mb-0.5"><Key size={12} /> API Key</div>
                      <span style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>Uses provider API keys from previous step</span>
                    </button>
                    <button
                      type="button"
                      className="p-2.5 rounded-lg border text-xs text-left transition-all"
                      style={{
                        borderColor: agentAuthType === 'cli' ? 'var(--accent)' : 'var(--border)',
                        background: agentAuthType === 'cli' ? 'var(--accent-light)' : 'transparent',
                        color: agentAuthType === 'cli' ? 'var(--accent)' : 'var(--text-secondary)',
                      }}
                      onClick={() => setAgentAuthType('cli')}
                    >
                      <div className="flex items-center gap-1.5 font-semibold mb-0.5"><Zap size={12} /> CLI Mode</div>
                      <span style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>Uses local Claude Code or Codex CLI — no API key needed</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label">Agent Name</label>
                    <input
                      className="input"
                      value={agent.name}
                      onChange={(e) => setAgent({ ...agent, name: e.target.value })}
                      placeholder="e.g., Alex, CodeBot"
                    />
                  </div>
                  <div>
                    <label className="label">Role</label>
                    <select
                      className="input"
                      value={agent.role}
                      onChange={(e) => setAgent({ ...agent, role: e.target.value })}
                    >
                      {ROLE_PRESETS.map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {agentAuthType === 'cli' ? (
                  <div className="p-3 rounded-lg text-xs" style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>
                    The agent will use your locally installed <strong>Claude Code</strong> or <strong>Codex</strong> CLI.
                    Make sure you have it installed and authenticated (<code className="px-1 py-0.5 rounded" style={{ background: 'var(--bg-tertiary)' }}>claude</code> or <code className="px-1 py-0.5 rounded" style={{ background: 'var(--bg-tertiary)' }}>codex</code> command available).
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">Provider</label>
                      <select
                        className="input"
                        value={agent.provider}
                        onChange={(e) => {
                          const p = e.target.value;
                          const models = MODELS[p] || [];
                          setAgent({ ...agent, provider: p, model: models[0]?.id || '', customModel: '' });
                        }}
                      >
                        {PROVIDERS.map((p) => (
                          <option key={p.id} value={p.id}>{p.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label">Model</label>
                      {agent.provider === 'openrouter' ? (
                        <div className="space-y-1.5">
                          <select
                            className="input"
                            value={agent.customModel ? '__custom__' : agent.model}
                            onChange={(e) => {
                              if (e.target.value === '__custom__') {
                                setAgent({ ...agent, model: '', customModel: '' });
                              } else {
                                setAgent({ ...agent, model: e.target.value, customModel: '' });
                              }
                            }}
                          >
                            {providerModels.map((m) => (
                              <option key={m.id} value={m.id}>{m.label}</option>
                            ))}
                            <option value="__custom__">Custom model...</option>
                          </select>
                          {(agent.customModel !== undefined && (agent.customModel || (!agent.model && agent.customModel !== undefined))) && agent.model === '' && (
                            <input
                              className="input font-mono text-xs"
                              value={agent.customModel}
                              onChange={(e) => setAgent({ ...agent, customModel: e.target.value })}
                              placeholder="e.g., meta-llama/llama-3.1-70b-instruct"
                            />
                          )}
                        </div>
                      ) : (
                        <select
                          className="input"
                          value={agent.model}
                          onChange={(e) => setAgent({ ...agent, model: e.target.value })}
                        >
                          {providerModels.map((m) => (
                            <option key={m.id} value={m.id}>{m.label}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-6 py-4 border-t flex items-center justify-between"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={dontShowAgain}
                onChange={(e) => setDontShowAgain(e.target.checked)}
                style={{ accentColor: 'var(--accent)' }}
              />
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Don't show again
              </span>
            </label>
          </div>

          <div className="flex items-center gap-2">
            {step > 0 && (
              <button className="btn btn-ghost text-sm" onClick={handleBack}>
                <ChevronLeft size={16} /> Back
              </button>
            )}

            <button
              className="btn btn-ghost text-sm"
              onClick={handleSkip}
            >
              <SkipForward size={14} /> Skip
            </button>

            {currentStep.key === 'welcome' && (
              <button className="btn btn-primary text-sm" onClick={handleNext}>
                Get Started <ChevronRight size={16} />
              </button>
            )}

            {currentStep.key === 'api-keys' && (
              <button className="btn btn-primary text-sm" onClick={saveApiKeys} disabled={saving}>
                {saving ? 'Saving...' : 'Save & Continue'}
              </button>
            )}

            {currentStep.key === 'project' && (
              <button className="btn btn-primary text-sm" onClick={saveProject} disabled={saving}>
                {saving ? 'Saving...' : 'Create & Finish'}
              </button>
            )}

            {currentStep.key === 'agent' && (
              <button className="btn btn-primary text-sm" onClick={saveAgent} disabled={saving}>
                {saving ? 'Saving...' : 'Hire & Continue'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
