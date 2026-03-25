'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import {
  API_MODELS,
  API_PROVIDERS as PROVIDERS,
  API_PROVIDER_DEFS,
  getDefaultModelForProvider,
  getModelSelectValue,
  providerSupportsCustomModel,
} from '../lib/llmProviders';
import agentMetadata from '../../shared/agent-metadata.json';
import { toast } from 'react-hot-toast';
import {
  Zap,
  Key,
  FolderOpen,
  Users,
  Shield,
  ChevronRight,
  ChevronLeft,
  Check,
  Eye,
  EyeOff,
  SkipForward,
  X,
  Wrench,
} from 'lucide-react';

const ROLE_PRESETS = agentMetadata.roles.map((role) => role.label);
const ROLE_META_BY_LABEL = Object.fromEntries(agentMetadata.roles.map((role) => [role.label, role]));
const AGENT_TYPE_PRESETS = agentMetadata.agentTypes;
const TOOL_RESTRICTION_OPTIONS = [
  { name: 'read_file', label: 'Read File', desc: 'Read file contents' },
  { name: 'write_file', label: 'Write File', desc: 'Create or overwrite files' },
  { name: 'delete_path', label: 'Delete Path', desc: 'Delete files or directories' },
  { name: 'run_bash', label: 'Run Bash', desc: 'Execute shell commands' },
  { name: 'list_directory', label: 'List Directory', desc: 'List files in a directory' },
  { name: 'browser', label: 'Browser', desc: 'Open pages, inspect them, click, type, and capture screenshots' },
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

const STEPS = [
  { key: 'welcome', label: 'Welcome', icon: Zap },
  { key: 'agent', label: 'Agent', icon: Users },
  { key: 'api-keys', label: 'API Keys', icon: Key },
  { key: 'project', label: 'Project', icon: FolderOpen },
];

function getProviderAuthMethod(providerAuth, providerId, methodId) {
  return providerAuth?.providers
    ?.find((provider) => provider.id === providerId)
    ?.methods?.find((method) => method.id === methodId) || null;
}

function normalizeAgentType(agentType) {
  if (agentType === 'worker') return 'worker';
  if (agentType === 'cli') return 'cli';
  return 'smart';
}

function getRoleMeta(roleLabel) {
  return ROLE_META_BY_LABEL[roleLabel] || null;
}

export default function OnboardingWizard({ onComplete }) {
  const [step, setStep] = useState(0);
  const [dontShowAgain, setDontShowAgain] = useState(true);
  const [saving, setSaving] = useState(false);

  // Step 2: API Keys
  const [showKeys, setShowKeys] = useState({});
  const [apiKeys, setApiKeys] = useState(() => (
    Object.fromEntries(API_PROVIDER_DEFS.map((provider) => [provider.keySetting, '']))
  ));
  const [providerAuth, setProviderAuth] = useState(null);
  const [providerAuthLoading, setProviderAuthLoading] = useState(false);
  const [availableSkills, setAvailableSkills] = useState([]);
  const [skillsLoading, setSkillsLoading] = useState(false);

  // Step 3: Project
  const [project, setProject] = useState({ name: '', path: '' });
  const [browsing, setBrowsing] = useState(false);

  // Step 4: Agent
  const [agentAuthType, setAgentAuthType] = useState('api'); // 'api' or 'cli'
  const [agent, setAgent] = useState({
    name: '',
    role: 'Assistant',
    agent_type: 'smart',
    provider: 'anthropic',
    model: getDefaultModelForProvider('anthropic'),
    personality: '',
    allowed_tools: '',
    skills: [],
  });
  const [toolRestrictionsEnabled, setToolRestrictionsEnabled] = useState(false);

  const currentStep = STEPS[step];
  const isLast = step === STEPS.length - 1;

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

  useEffect(() => {
    let cancelled = false;
    setSkillsLoading(true);
    api.getSkills()
      .then((data) => {
        if (!cancelled) setAvailableSkills(data.skills || []);
      })
      .catch(() => {
        if (!cancelled) setAvailableSkills([]);
      })
      .finally(() => {
        if (!cancelled) setSkillsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
      for (const provider of API_PROVIDER_DEFS) {
        if (apiKeys[provider.keySetting]) keysToSave[provider.keySetting] = apiKeys[provider.keySetting];
      }
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
    if (agent.role === 'Custom' && !String(agent.personality || '').trim()) {
      toast.error('Please add a custom role instruction');
      return;
    }
    setSaving(true);
    try {
      const selectedOauth = OAUTH_PROVIDERS.map((option) => ({
        ...option,
        method: getProviderAuthMethod(providerAuth, option.providerId, option.methodId),
      })).find((option) => option.id === agent.provider);
      if (agentAuthType === 'oauth' && !selectedOauth?.method?.configured) {
        throw new Error('Configure this provider-auth method in Settings first.');
      }
      const usesCliRuntime = agentAuthType === 'cli' || (agentAuthType === 'oauth' && agent.provider === 'openai-codex');
      await api.createAgent({
        name: agent.name,
        role: agent.role,
        agent_type: agent.agent_type,
        auth_type: agentAuthType,
        provider: agentAuthType === 'cli' ? 'claude-cli' : agent.provider,
        model: usesCliRuntime ? '' : agent.model,
        personality: agent.personality,
        allowed_tools: toolRestrictionsEnabled ? agent.allowed_tools : '',
        skills: agent.skills,
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

  const providerModels = API_MODELS[agent.provider] || [];
  const canUseCustomModel = providerSupportsCustomModel(agent.provider);
  const modelSelectValue = getModelSelectValue(agent.provider, agent.model);
  const roleMeta = getRoleMeta(agent.role);
  const isCustomRole = agent.role === 'Custom';
  const allowedToolSet = new Set(
    (agent.allowed_tools || '').split(',').map((tool) => tool.trim()).filter(Boolean)
  );
  const oauthOptions = OAUTH_PROVIDERS.map((option) => {
    const method = getProviderAuthMethod(providerAuth, option.providerId, option.methodId);
    return {
      ...option,
      method,
      configured: Boolean(method?.configured),
    };
  });
  const configuredOauthOptions = oauthOptions.filter((option) => option.configured);
  const toggleAgentTool = (toolName) => {
    setAgent((current) => {
      const next = new Set(
        (current.allowed_tools || '').split(',').map((tool) => tool.trim()).filter(Boolean)
      );
      if (next.has(toolName)) {
        next.delete(toolName);
      } else {
        next.add(toolName);
      }
      return { ...current, allowed_tools: Array.from(next).join(',') };
    });
  };
  const toggleAgentSkill = (skillSlug) => {
    setAgent((current) => ({
      ...current,
      skills: current.skills.includes(skillSlug)
        ? current.skills.filter((slug) => slug !== skillSlug)
        : [...current.skills, skillSlug],
    }));
  };

  const setAuthMode = (nextType) => {
    setAgentAuthType(nextType);

    if (nextType === 'api') {
      setAgent((current) => ({
        ...current,
        agent_type: current.agent_type === 'cli' ? 'smart' : current.agent_type,
        provider: 'anthropic',
        model: getDefaultModelForProvider('anthropic'),
      }));
      return;
    }

    if (nextType === 'cli') {
      setAgent((current) => ({
        ...current,
        agent_type: 'cli',
        provider: 'claude-cli',
        model: '',
      }));
      return;
    }

    const fallback = configuredOauthOptions[0] || oauthOptions[0];
    if (!fallback) return;
    setAgent((current) => ({
      ...current,
      agent_type: current.agent_type === 'cli' ? 'smart' : current.agent_type,
      provider: fallback.id,
      model: fallback.runtime === 'cli' ? '' : getDefaultModelForProvider(fallback.id),
    }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div
        className="card w-full max-w-lg max-h-[88vh] overflow-hidden flex flex-col animate-fade-in"
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
        <div className="px-6 pb-4 flex-1 overflow-y-auto" style={{ minHeight: '260px' }}>
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
                {API_PROVIDER_DEFS.map((provider) => (
                  <div key={provider.id}>
                    <label className="label">
                      {provider.keyLabel}
                      {provider.helperText ? (
                        <span className="font-normal text-[10px] ml-1" style={{ color: 'var(--text-tertiary)' }}>
                          {provider.helperText}
                        </span>
                      ) : null}
                    </label>
                    <div className="flex gap-2">
                      <input
                        className="input flex-1 font-mono text-sm"
                        type={showKeys[provider.id] ? 'text' : 'password'}
                        value={apiKeys[provider.keySetting] || ''}
                        onChange={(e) =>
                          setApiKeys({ ...apiKeys, [provider.keySetting]: e.target.value })
                        }
                        placeholder={provider.keyPlaceholder}
                      />
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setShowKeys((p) => ({ ...p, [provider.id]: !p[provider.id] }))}
                      >
                        {showKeys[provider.id] ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                ))}
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
                  <div className="grid grid-cols-1 gap-2">
                    <button
                      type="button"
                      className="p-2.5 rounded-lg border text-xs text-left transition-all"
                      style={{
                        borderColor: agentAuthType === 'api' ? 'var(--accent)' : 'var(--border)',
                        background: agentAuthType === 'api' ? 'var(--accent-light)' : 'transparent',
                        color: agentAuthType === 'api' ? 'var(--accent)' : 'var(--text-secondary)',
                      }}
                      onClick={() => setAuthMode('api')}
                    >
                      <div className="flex items-center gap-1.5 font-semibold mb-0.5"><Key size={12} /> API Key</div>
                      <span style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>Uses provider API keys you can add in the API Keys step next</span>
                    </button>
                    <button
                      type="button"
                      className="p-2.5 rounded-lg border text-xs text-left transition-all"
                      style={{
                        borderColor: agentAuthType === 'oauth' ? 'var(--accent)' : 'var(--border)',
                        background: agentAuthType === 'oauth' ? 'var(--accent-light)' : 'transparent',
                        color: agentAuthType === 'oauth' ? 'var(--accent)' : 'var(--text-secondary)',
                      }}
                      onClick={() => setAuthMode('oauth')}
                    >
                      <div className="flex items-center gap-1.5 font-semibold mb-0.5"><Users size={12} /> OAuth / Provider Auth</div>
                      <span style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>Uses saved provider sign-ins from Settings, including Anthropic, Gemini, and Codex</span>
                    </button>
                    <button
                      type="button"
                      className="p-2.5 rounded-lg border text-xs text-left transition-all"
                      style={{
                        borderColor: agentAuthType === 'cli' ? 'var(--accent)' : 'var(--border)',
                        background: agentAuthType === 'cli' ? 'var(--accent-light)' : 'transparent',
                        color: agentAuthType === 'cli' ? 'var(--accent)' : 'var(--text-secondary)',
                      }}
                      onClick={() => setAuthMode('cli')}
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
                    {roleMeta?.summary ? (
                      <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>{roleMeta.summary}</p>
                    ) : null}
                    {isCustomRole ? (
                      <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                        Define the exact responsibilities, tone, and decision style this custom role should follow.
                      </p>
                    ) : null}
                  </div>
                </div>

                {isCustomRole ? (
                  <div>
                    <label className="label">Custom Role Instruction</label>
                    <textarea
                      className="input"
                      rows={3}
                      value={agent.personality}
                      onChange={(e) => setAgent({ ...agent, personality: e.target.value })}
                      placeholder="Example: Operate as a lifecycle marketer focused on onboarding, messaging tests, retention campaigns, and conversion analysis."
                    />
                    <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>
                      Hint: describe the role&apos;s scope, key skills, communication style, and how it should make tradeoffs.
                    </p>
                  </div>
                ) : null}

                <div>
                  <label className="label">Agent Type</label>
                  <div className="space-y-2">
                    {AGENT_TYPE_PRESETS.map((type) => (
                      <label
                        key={type.id}
                        className="flex items-start gap-3 p-3 rounded-lg transition-colors"
                        style={{
                          background: agent.agent_type === type.id ? 'var(--accent-light)' : 'var(--bg-secondary)',
                          border: agent.agent_type === type.id ? '1px solid var(--accent)' : '1px solid var(--border)',
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="radio"
                          name="onboarding-agent-type"
                          className="mt-1"
                          checked={agent.agent_type === type.id}
                          onChange={() => setAgent({ ...agent, agent_type: type.id })}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{type.label}</span>
                            {type.id === 'smart' ? (
                              <span className="text-[10px]" style={{ color: '#5c7cfa' }}>Default</span>
                            ) : null}
                          </div>
                          <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{type.description}</p>
                          <p className="text-[10px] mt-1" style={{ color: 'var(--text-secondary)' }}>Recommended for: {type.recommendedFor}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {agentAuthType === 'cli' ? (
                  <div className="p-3 rounded-lg text-xs" style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>
                    The agent will use your locally installed <strong>Claude Code</strong> or <strong>Codex</strong> CLI.
                    Make sure you have it installed and authenticated (<code className="px-1 py-0.5 rounded" style={{ background: 'var(--bg-tertiary)' }}>claude</code> or <code className="px-1 py-0.5 rounded" style={{ background: 'var(--bg-tertiary)' }}>codex</code> command available).
                  </div>
                ) : agentAuthType === 'oauth' ? (
                  <div className="space-y-3">
                    <div className="space-y-2">
                      {oauthOptions.map((option) => (
                        <label
                          key={option.id}
                          className="flex items-start gap-3 p-3 rounded-lg transition-colors"
                          style={{
                            background: agent.provider === option.id ? 'var(--accent-light)' : 'var(--bg-secondary)',
                            border: agent.provider === option.id ? '1px solid var(--accent)' : '1px solid var(--border)',
                            opacity: option.configured ? 1 : 0.6,
                            cursor: option.configured ? 'pointer' : 'not-allowed',
                          }}
                        >
                          <input
                            type="radio"
                            name="onboarding-oauth-provider"
                            className="mt-1"
                            checked={agent.provider === option.id}
                            disabled={!option.configured}
                            onChange={() => setAgent({
                              ...agent,
                              provider: option.id,
                              model: option.runtime === 'cli' ? '' : getDefaultModelForProvider(option.id),
                            })}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{option.label}</span>
                              <span className="text-[10px]" style={{ color: option.configured ? '#2f9e44' : 'var(--text-tertiary)' }}>
                                {option.configured ? 'Configured' : 'Not configured'}
                              </span>
                            </div>
                            <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{option.description}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                    {!providerAuthLoading && configuredOauthOptions.length === 0 ? (
                      <p className="text-xs" style={{ color: 'var(--danger)' }}>
                        No provider-auth methods are configured yet. Connect one in Settings first.
                      </p>
                    ) : null}
                    {agent.provider === 'openai-codex' ? (
                      <div className="p-3 rounded-lg text-xs" style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>
                        Codex OAuth uses the Codex SDK runtime, so model selection stays in your local Codex auth/config after you connect it in Settings.
                      </div>
                    ) : (
                      <div>
                        <label className="label">Model</label>
                        <select
                          className="input"
                          value={getModelSelectValue(agent.provider, agent.model)}
                          onChange={(e) => {
                            if (e.target.value === '__custom__') {
                              setAgent({ ...agent, model: '' });
                            } else {
                              setAgent({ ...agent, model: e.target.value });
                            }
                          }}
                        >
                          {providerModels.map((m) => (
                            <option key={m.id} value={m.id}>{m.label}</option>
                          ))}
                          {providerSupportsCustomModel(agent.provider) ? (
                            <option value="__custom__">Custom model ID...</option>
                          ) : null}
                        </select>
                        {providerSupportsCustomModel(agent.provider) && getModelSelectValue(agent.provider, agent.model) === '__custom__' ? (
                          <input
                            className="input mt-1.5 font-mono text-xs"
                            value={agent.model}
                            onChange={(e) => setAgent({ ...agent, model: e.target.value })}
                            placeholder="Enter the exact model ID for this provider"
                          />
                        ) : null}
                      </div>
                    )}
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
                          setAgent({ ...agent, provider: p, model: getDefaultModelForProvider(p) });
                        }}
                      >
                        {PROVIDERS.map((p) => (
                          <option key={p.id} value={p.id}>{p.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label">Model</label>
                      <div className="space-y-1.5">
                        <select
                          className="input"
                          value={modelSelectValue}
                          onChange={(e) => {
                            if (e.target.value === '__custom__') {
                              setAgent({ ...agent, model: '' });
                            } else {
                              setAgent({ ...agent, model: e.target.value });
                            }
                          }}
                        >
                          {providerModels.map((m) => (
                            <option key={m.id} value={m.id}>{m.label}</option>
                          ))}
                          {canUseCustomModel ? <option value="__custom__">Custom model ID...</option> : null}
                        </select>
                        {canUseCustomModel && modelSelectValue === '__custom__' ? (
                          <input
                            className="input font-mono text-xs"
                            value={agent.model}
                            onChange={(e) => setAgent({ ...agent, model: e.target.value })}
                            placeholder="Enter the exact model ID for this provider"
                          />
                        ) : null}
                      </div>
                    </div>
                  </div>
                )}

                <div className="pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Shield size={16} style={{ color: 'var(--text-secondary)' }} />
                      <label className="label mb-0" style={{ marginBottom: 0 }}>Tool Restrictions</label>
                    </div>
                    <button
                      type="button"
                      className="flex items-center gap-2 cursor-pointer"
                      onClick={() => setToolRestrictionsEnabled((current) => !current)}
                    >
                      <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        {toolRestrictionsEnabled ? 'Enabled' : 'Disabled'}
                      </span>
                      <span
                        className="relative w-10 h-5 rounded-full transition-colors"
                        style={{ background: toolRestrictionsEnabled ? 'var(--accent)' : 'var(--border)' }}
                      >
                        <span
                          className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform"
                          style={{ left: toolRestrictionsEnabled ? '22px' : '2px' }}
                        />
                      </span>
                    </button>
                  </div>

                  {toolRestrictionsEnabled && (
                    <div className="space-y-3">
                      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        Limit which tools this agent can use during tasks and direct chat. Leave all unchecked to allow all tools.
                      </p>
                      <div className="space-y-2">
                        {TOOL_RESTRICTION_OPTIONS.map((tool) => {
                          const checked = allowedToolSet.has(tool.name);
                          return (
                            <label
                              key={tool.name}
                              className="flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-colors"
                              style={{
                                background: checked ? 'var(--accent-light)' : 'var(--bg-secondary)',
                                border: checked ? '1px solid var(--accent)' : '1px solid var(--border)',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleAgentTool(tool.name)}
                              />
                              <div className="flex-1 min-w-0">
                                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{tool.label}</span>
                                <span className="text-xs ml-2" style={{ color: 'var(--text-tertiary)' }}>{tool.desc}</span>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        `task_complete` and `request_help` stay available even when restrictions are enabled.
                      </p>
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex items-center gap-2 mb-3">
                    <Wrench size={16} style={{ color: 'var(--text-secondary)' }} />
                    <label className="label mb-0" style={{ marginBottom: 0 }}>Assigned Skills</label>
                  </div>
                  {skillsLoading ? (
                    <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Loading shared skills...</p>
                  ) : availableSkills.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        Optional shared skills from `~/.agentwork/skills`. Assign the ones this agent should use during tasks and chat.
                      </p>
                      {availableSkills.map((skill) => {
                        const checked = agent.skills.includes(skill.slug);
                        return (
                          <label
                            key={skill.slug}
                            className="flex items-start gap-3 p-2.5 rounded-lg cursor-pointer transition-colors"
                            style={{
                              background: checked ? 'var(--accent-light)' : 'var(--bg-secondary)',
                              border: checked ? '1px solid var(--accent)' : '1px solid var(--border)',
                            }}
                          >
                            <input
                              type="checkbox"
                              className="mt-1"
                              checked={checked}
                              onChange={() => toggleAgentSkill(skill.slug)}
                            />
                            <div className="min-w-0 flex-1">
                              <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{skill.name}</span>
                              <p className="text-[10px] mt-1" style={{ color: 'var(--text-tertiary)' }}>{skill.description || 'No description'}</p>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      No shared skills are installed yet. You can add them later from the Skills page.
                    </p>
                  )}
                </div>

                <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                  Hired agents get `AGENTS.md`, `ROLE.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `TOOLS.md`, `HEARTBEAT.md`, and `MEMORY.md` automatically.
                </p>
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
