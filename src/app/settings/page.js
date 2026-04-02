'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Sidebar from '../../components/Sidebar';
import BottomBar from '../../components/BottomBar';
import { api } from '../../lib/api';
import { API_PROVIDER_DEFS } from '../../lib/llmProviders';
import { usePersistentState } from '../../lib/persistentState';
import { useTheme, useAuth } from '../providers';
import {
  BarChart3,
  Bell,
  Copy,
  Eye,
  EyeOff,
  FileText,
  FolderOpen,
  GitBranch,
  Globe,
  Key,
  Link2,
  LogOut,
  Palette,
  Save,
  Shield,
  Trash2,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { toast } from 'react-hot-toast';

const SECTION_DEFS = [
  { id: 'providers', title: 'Model Providers', description: 'API keys and local model endpoints.', icon: Key },
  { id: 'oauth', title: 'Connected Accounts', description: 'Reusable OAuth and CLI sign-ins.', icon: Link2 },
  { id: 'budget', title: 'Spend Controls', description: 'Budgets, trends, and token usage.', icon: Wallet },
  { id: 'runtime', title: 'Runtime & Access', description: 'Execution limits, auth, and safety.', icon: Shield },
  { id: 'git', title: 'Git Automation', description: 'Branching, sync, merge, and commit behavior.', icon: GitBranch },
  { id: 'templates', title: 'Task Blueprints', description: 'Reusable task and flow templates.', icon: Copy },
  { id: 'preferences', title: 'Workspace & Preferences', description: 'Interface, notifications, and defaults.', icon: Palette },
];

const ACCENT_OPTIONS = [
  { value: 'blue', label: 'Blue' },
  { value: 'green', label: 'Green' },
  { value: 'orange', label: 'Orange' },
  { value: 'red', label: 'Red' },
  { value: 'pink', label: 'Pink' },
];

export default function SettingsPage() {
  const { theme, toggleTheme } = useTheme();
  const { logout } = useAuth();
  const [settings, setSettings] = useState({});
  const [providerAuth, setProviderAuth] = useState(null);
  const [budget, setBudget] = useState(null);
  const [budgetHistory, setBudgetHistory] = useState([]);
  const [budgetByAgent, setBudgetByAgent] = useState([]);
  const [showKeys, setShowKeys] = useState({});
  const [saving, setSaving] = useState(false);
  const [authBusy, setAuthBusy] = useState({});
  const [anthropicSetupToken, setAnthropicSetupToken] = useState('');
  const [googleProjectId, setGoogleProjectId] = useState('');
  const [codexOauthFlow, setCodexOauthFlow] = useState(null);
  const [codexManualInput, setCodexManualInput] = useState('');
  const [templates, setTemplates] = useState([]);
  const [activeSection, setActiveSection, activeSectionReady] = usePersistentState('agentwork:settings:active-section', SECTION_DEFS[0].id);
  const restoredSectionRef = useRef(false);

  const applyProviderAuthState = useCallback((auth) => {
    setProviderAuth(auth);
    const googleOauth = auth?.providers
      ?.find((provider) => provider.id === 'google')
      ?.methods?.find((method) => method.id === 'google-gemini-cli');
    setGoogleProjectId(googleOauth?.profile?.projectId || '');
  }, []);

  const load = useCallback(async () => {
    const [s, auth, b, history, byAgent] = await Promise.all([
      api.getSettings(),
      api.getProviderAuth().catch(() => null),
      api.getBudget(),
      api.getBudgetHistory(30).catch(() => []),
      api.getBudgetByAgent(30).catch(() => []),
    ]);
    setSettings(s);
    applyProviderAuthState(auth);
    setBudget(b);
    setBudgetHistory(history);
    setBudgetByAgent(byAgent);
    api.getTemplates().then(setTemplates).catch(() => {});
  }, [applyProviderAuthState]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target?.id) setActiveSection(visible.target.id);
      },
      { rootMargin: '-20% 0px -55% 0px', threshold: [0.15, 0.35, 0.6] }
    );

    SECTION_DEFS.forEach((section) => {
      const node = document.getElementById(section.id);
      if (node) observer.observe(node);
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!activeSectionReady) return;
    if (!SECTION_DEFS.some((section) => section.id === activeSection)) {
      setActiveSection(SECTION_DEFS[0].id);
      return;
    }
    if (restoredSectionRef.current) return;

    requestAnimationFrame(() => {
      document.getElementById(activeSection)?.scrollIntoView({ block: 'start' });
      restoredSectionRef.current = true;
    });
  }, [activeSection, activeSectionReady, setActiveSection]);

  const updateField = (key, value) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const localModelBaseUrl = settings.custom_base_url || settings.ollama_base_url || 'http://127.0.0.1:11434/v1';

  const save = async () => {
    setSaving(true);
    try {
      await api.updateSettings(settings);
      if (settings.dashboard_password) {
        const result = await api.login(settings.dashboard_password);
        if (result.success && result.token) {
          localStorage.setItem('agentwork-auth-token', result.token);
        }
      } else {
        localStorage.removeItem('agentwork-auth-token');
      }
      toast.success('Settings saved');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const getAuthMethod = (providerId, methodId) =>
    providerAuth?.providers
      ?.find((provider) => provider.id === providerId)
      ?.methods?.find((method) => method.id === methodId);

  const runAuthAction = async (key, action, successMessage) => {
    setAuthBusy((prev) => ({ ...prev, [key]: true }));
    try {
      const next = await action();
      applyProviderAuthState(next);
      toast.success(successMessage);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAuthBusy((prev) => ({ ...prev, [key]: false }));
    }
  };

  const startCodexOAuth = async () => {
    setAuthBusy((prev) => ({ ...prev, codex_login: true }));
    const popup = typeof window !== 'undefined' ? window.open('', '_blank') : null;

    try {
      const result = await api.startCodexOAuth();
      const flow = result?.flow || null;
      setCodexOauthFlow(flow);
      setCodexManualInput('');

      if (flow?.authUrl) {
        if (popup) {
          popup.location.href = flow.authUrl;
        } else if (typeof window !== 'undefined') {
          window.open(flow.authUrl, '_blank');
        }
      } else if (popup) {
        popup.close();
      }

      toast.success(
        flow?.callbackReady
          ? 'Browser opened for Codex sign-in'
          : 'Codex sign-in started. Finish in browser, then paste the redirect URL below.'
      );
    } catch (err) {
      if (popup) popup.close();
      toast.error(err.message);
    } finally {
      setAuthBusy((prev) => ({ ...prev, codex_login: false }));
    }
  };

  const completeCodexOAuth = async () => {
    if (!codexOauthFlow?.id || !codexManualInput.trim()) return;

    setAuthBusy((prev) => ({ ...prev, codex_manual: true }));
    try {
      const result = await api.completeCodexOAuth(codexOauthFlow.id, codexManualInput.trim());
      applyProviderAuthState(result?.overview || providerAuth);
      setCodexOauthFlow(null);
      setCodexManualInput('');
      toast.success('Codex OAuth connected');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAuthBusy((prev) => ({ ...prev, codex_manual: false }));
    }
  };

  useEffect(() => {
    if (!codexOauthFlow?.id || codexOauthFlow.status !== 'pending') return undefined;

    let disposed = false;
    const poll = async () => {
      try {
        const result = await api.getCodexOAuthStatus(codexOauthFlow.id);
        if (disposed) return;
        const nextFlow = result?.flow || null;
        if (nextFlow?.status === 'success') {
          applyProviderAuthState(result?.overview || providerAuth);
          setCodexOauthFlow(null);
          setCodexManualInput('');
          toast.success('Codex OAuth connected');
          return;
        }
        setCodexOauthFlow(nextFlow);
      } catch (err) {
        if (!disposed) {
          setCodexOauthFlow((prev) => (
            prev ? { ...prev, error: err.message || 'Failed to refresh Codex OAuth status.' } : prev
          ));
        }
      }
    };

    poll();
    const timer = setInterval(poll, 1500);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [applyProviderAuthState, codexOauthFlow?.id, codexOauthFlow?.status, providerAuth]);

  const jumpToSection = (sectionId) => {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const configuredProviderCount = useMemo(
    () => API_PROVIDER_DEFS.filter((provider) => String(settings[provider.keySetting] || '').trim()).length,
    [settings]
  );

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <div className="flex items-center justify-between px-6 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h1 className="font-semibold text-lg" style={{ color: 'var(--text-primary)' }}>Settings</h1>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Organize providers, security, budgets, automation, and workspace defaults in one place.
            </p>
          </div>
          <button className="btn btn-primary text-sm" onClick={save} disabled={saving}>
            <Save size={16} /> {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>

        <main className="flex-1 overflow-auto p-4 md:p-6" style={{ background: 'var(--bg-primary)' }}>
          <div className="max-w-7xl mx-auto space-y-6">
            <div
              className="rounded-[28px] p-5 md:p-6 border"
              style={{
                borderColor: 'var(--border)',
                background: 'linear-gradient(135deg, var(--bg-elevated) 0%, var(--bg-secondary) 100%)',
              }}
            >
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr),minmax(320px,1fr)] lg:items-end">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em]" style={{ color: 'var(--text-tertiary)' }}>
                    Control Room
                  </p>
                  <h2 className="text-2xl md:text-3xl font-semibold mt-2" style={{ color: 'var(--text-primary)' }}>
                    Tune how AgentWork connects, spends, executes, and ships.
                  </h2>
                  <p className="text-sm mt-3 max-w-2xl" style={{ color: 'var(--text-secondary)' }}>
                    The page is split into focused sections so you can jump straight to provider setup, runtime guardrails,
                    git automation, and workspace-level preferences without scrolling through one long form.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <StatTile label="API keys" value={configuredProviderCount} hint="Configured providers" />
                  <StatTile
                    label="Budget"
                    value={budget ? `$${budget.monthly.total.toFixed(2)}` : '...'}
                    hint="Current monthly spend"
                  />
                  <StatTile label="Templates" value={templates.length} hint="Saved task blueprints" />
                  <StatTile
                    label="Runtime"
                    value={`${settings.max_concurrent_executions || '3'}x`}
                    hint="Max concurrent executions"
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-[240px,minmax(0,1fr)]">
              <aside className="space-y-4">
                <div className="lg:sticky lg:top-4 space-y-4">
                  <div className="rounded-3xl border p-3" style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}>
                    <p className="text-[11px] uppercase tracking-[0.18em] px-2 pb-2" style={{ color: 'var(--text-tertiary)' }}>
                      Sections
                    </p>
                    <div className="space-y-1">
                      {SECTION_DEFS.map((section) => {
                        const Icon = section.icon;
                        const active = activeSection === section.id;
                        return (
                          <button
                            key={section.id}
                            className="w-full text-left rounded-2xl px-3 py-3 transition-colors"
                            style={{
                              background: active ? 'var(--accent-light)' : 'transparent',
                              color: active ? 'var(--accent)' : 'var(--text-secondary)',
                            }}
                            onClick={() => jumpToSection(section.id)}
                          >
                            <div className="flex items-center gap-3">
                              <div
                                className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                                style={{ background: active ? 'rgba(255,255,255,0.75)' : 'var(--bg-secondary)' }}
                              >
                                <Icon size={15} />
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-medium truncate">{section.title}</p>
                                <p className="text-[11px] truncate" style={{ color: active ? 'var(--accent)' : 'var(--text-tertiary)' }}>
                                  {section.description}
                                </p>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="rounded-3xl border p-4 hidden lg:block" style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Save discipline</p>
                    <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>
                      Changes are local until you hit save. Settings update live across the dashboard after persistence.
                    </p>
                  </div>
                </div>
              </aside>

              <div className="space-y-6 min-w-0">
                <MobileSectionTabs activeSection={activeSection} onSelect={jumpToSection} />

                <SectionPanel
                  id="providers"
                  icon={<Key size={18} />}
                  title="Model Providers"
                  description="Keep provider credentials and local endpoints in one place. The local endpoint is shared for Ollama, LM Studio, and other OpenAI-compatible local runtimes."
                >
                  <div className="grid gap-4 xl:grid-cols-2">
                    {API_PROVIDER_DEFS.map((provider) => (
                      <ProviderCard
                        key={provider.id}
                        provider={provider}
                        value={settings[provider.keySetting] || ''}
                        showValue={showKeys[provider.id]}
                        onToggleVisibility={() => setShowKeys((prev) => ({ ...prev, [provider.id]: !prev[provider.id] }))}
                        onChange={(value) => updateField(provider.keySetting, value)}
                      />
                    ))}
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2 mt-5">
                    <InfoCard
                      icon={<Globe size={16} />}
                      title="Local model endpoint"
                      description="Use one OpenAI-compatible base URL for Ollama, LM Studio, or another local gateway."
                    >
                      <Field
                        label="Base URL"
                        value={localModelBaseUrl}
                        onChange={(value) => updateField('custom_base_url', value)}
                        placeholder="http://127.0.0.1:11434/v1"
                        monospace
                      />
                    </InfoCard>

                    <InfoCard
                      icon={<FolderOpen size={16} />}
                      title="Provider notes"
                      description="Ollama auth is optional. Most hosted providers require a key. OpenRouter can cover several model families through one credential."
                    >
                      <div className="grid grid-cols-2 gap-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        <MetaPill label="OpenRouter" value="multi-provider access" />
                        <MetaPill label="Ollama" value="local or cloud" />
                        <MetaPill label="Gemini" value="API key or OAuth" />
                        <MetaPill label="Codex" value="browser OAuth" />
                      </div>
                    </InfoCard>
                  </div>
                </SectionPanel>

                <SectionPanel
                  id="oauth"
                  icon={<Link2 size={18} />}
                  title="Connected Accounts"
                  description="Store reusable sign-ins once, then assign them to agents that need browser or CLI-backed authentication."
                >
                  <div className="grid gap-4 xl:grid-cols-3">
                    <AuthCard
                      title="Anthropic setup-token"
                      description="Reuse setup-token based auth for Anthropic-backed agents."
                      method={getAuthMethod('anthropic', 'setup-token')}
                    >
                      <div className="flex gap-2">
                        <input
                          className="input flex-1 font-mono text-sm"
                          type={showKeys.anthropic_setup_token ? 'text' : 'password'}
                          value={anthropicSetupToken}
                          onChange={(e) => setAnthropicSetupToken(e.target.value)}
                          placeholder="Paste token from claude setup-token"
                        />
                        <button
                          className="btn btn-ghost"
                          onClick={() => setShowKeys((prev) => ({ ...prev, anthropic_setup_token: !prev.anthropic_setup_token }))}
                        >
                          {showKeys.anthropic_setup_token ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2 mt-3">
                        <button
                          className="btn btn-primary text-sm"
                          disabled={authBusy.anthropic_token}
                          onClick={() => runAuthAction('anthropic_token', () => api.saveAnthropicSetupToken(anthropicSetupToken), 'Anthropic setup-token saved')}
                        >
                          {authBusy.anthropic_token ? 'Saving...' : 'Save token'}
                        </button>
                        {getAuthMethod('anthropic', 'setup-token')?.configured && (
                          <button
                            className="btn btn-ghost text-sm"
                            onClick={() => runAuthAction('anthropic_clear', () => api.clearProviderAuth('anthropic'), 'Anthropic setup-token cleared')}
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </AuthCard>

                    <AuthCard
                      title="OpenAI Codex OAuth"
                      description="Browser-based sign-in for Codex-backed task runs and chat."
                      method={getAuthMethod('openai', 'openai-codex')}
                    >
                      <div className="flex flex-wrap gap-2">
                        <button className="btn btn-primary text-sm" disabled={authBusy.codex_login} onClick={startCodexOAuth}>
                          {authBusy.codex_login ? 'Opening...' : 'Connect in browser'}
                        </button>
                        <button
                          className="btn btn-ghost text-sm"
                          disabled={authBusy.codex_import}
                          onClick={() => runAuthAction('codex_import', () => api.importCodexOAuth(), 'Codex OAuth imported from ~/.codex/auth.json')}
                        >
                          {authBusy.codex_import ? 'Importing...' : 'Import existing auth.json'}
                        </button>
                        {getAuthMethod('openai', 'openai-codex')?.configured && (
                          <button
                            className="btn btn-ghost text-sm"
                            onClick={() => runAuthAction('codex_clear', () => api.clearProviderAuth('openai-codex'), 'Codex OAuth profile cleared')}
                          >
                            Clear
                          </button>
                        )}
                      </div>

                      {codexOauthFlow?.id ? (
                        <div className="mt-3 p-3 rounded-2xl border space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--bg-primary)' }}>
                          <div className="space-y-1">
                            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                              {codexOauthFlow.callbackReady
                                ? 'Finish sign-in in the opened browser tab. If the callback does not complete, paste the full redirect URL or the authorization code below.'
                                : 'The localhost callback on port 1455 is unavailable. Finish sign-in in the browser, then paste the redirect URL or authorization code below.'}
                            </p>
                            <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                              Expected callback: <code>http://localhost:1455/auth/callback</code>
                            </p>
                            {codexOauthFlow.error ? (
                              <p className="text-[11px]" style={{ color: 'var(--danger)' }}>{codexOauthFlow.error}</p>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <input
                              className="input font-mono text-sm min-w-[240px] flex-1"
                              value={codexManualInput}
                              onChange={(e) => setCodexManualInput(e.target.value)}
                              placeholder="Paste redirect URL or authorization code"
                            />
                            <button className="btn btn-secondary text-sm" disabled={!codexManualInput.trim() || authBusy.codex_manual} onClick={completeCodexOAuth}>
                              {authBusy.codex_manual ? 'Completing...' : 'Complete manually'}
                            </button>
                            <button
                              className="btn btn-ghost text-sm"
                              onClick={() => {
                                if (codexOauthFlow?.authUrl && typeof window !== 'undefined') {
                                  window.open(codexOauthFlow.authUrl, '_blank');
                                }
                              }}
                            >
                              Open sign-in again
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </AuthCard>

                    <AuthCard
                      title="Gemini CLI OAuth"
                      description="Import local Gemini CLI credentials for Google-backed agents."
                      method={getAuthMethod('google', 'google-gemini-cli')}
                    >
                      <Field
                        label="Optional project override"
                        value={googleProjectId}
                        onChange={setGoogleProjectId}
                        placeholder="GOOGLE_CLOUD_PROJECT"
                        monospace
                      />
                      <div className="flex flex-wrap gap-2 mt-3">
                        <button
                          className="btn btn-primary text-sm"
                          disabled={authBusy.gemini_import}
                          onClick={() => runAuthAction('gemini_import', () => api.importGeminiOAuth(googleProjectId), 'Gemini OAuth imported from local auth')}
                        >
                          {authBusy.gemini_import ? 'Importing...' : 'Import from ~/.gemini'}
                        </button>
                        {getAuthMethod('google', 'google-gemini-cli')?.configured && (
                          <button
                            className="btn btn-ghost text-sm"
                            onClick={() => runAuthAction('gemini_clear', () => api.clearProviderAuth('google-gemini-cli'), 'Gemini OAuth profile cleared')}
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </AuthCard>
                  </div>
                </SectionPanel>

                <SectionPanel
                  id="budget"
                  icon={<Wallet size={18} />}
                  title="Spend Controls"
                  description="Set global budget caps, review current usage, and inspect where spend is accumulating."
                >
                  <div className="grid gap-4 lg:grid-cols-2">
                    <InfoCard icon={<Wallet size={16} />} title="Budget caps" description="Hard limits used to guard monthly and daily spend.">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Field
                          label="Daily budget (USD)"
                          type="number"
                          step="0.01"
                          value={settings.daily_budget_usd || '10'}
                          onChange={(value) => updateField('daily_budget_usd', value)}
                        />
                        <Field
                          label="Monthly budget (USD)"
                          type="number"
                          step="0.01"
                          value={settings.monthly_budget_usd || '100'}
                          onChange={(value) => updateField('monthly_budget_usd', value)}
                        />
                      </div>
                      {budget ? (
                        <div className="grid grid-cols-2 gap-3 mt-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                          <MetaPill label="Today" value={`$${budget.daily.total.toFixed(4)} / $${budget.daily.limit.toFixed(2)}`} />
                          <MetaPill label="Month" value={`$${budget.monthly.total.toFixed(4)} / $${budget.monthly.limit.toFixed(2)}`} />
                        </div>
                      ) : null}
                    </InfoCard>

                    <InfoCard icon={<TrendingUp size={16} />} title="Usage snapshot" description="Quick readout of token and cost activity.">
                      {budget ? (
                        <div className="grid grid-cols-2 gap-3">
                          <MetricCard label="Today's tokens" value={formatTokens(budget.daily.input_tokens + budget.daily.output_tokens)} />
                          <MetricCard label="Monthly tokens" value={formatTokens(budget.monthly.input_tokens + budget.monthly.output_tokens)} />
                          <MetricCard label="Today's spend" value={`$${budget.daily.total.toFixed(2)}`} />
                          <MetricCard label="Monthly spend" value={`$${budget.monthly.total.toFixed(2)}`} />
                        </div>
                      ) : (
                        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Budget data will appear after the first paid model calls.</p>
                      )}
                    </InfoCard>
                  </div>

                  <div className="mt-5">
                    <InfoCard icon={<BarChart3 size={16} />} title="Spend analytics" description="Trend line for daily cost and a ranked breakdown by agent.">
                      <BudgetAnalytics history={budgetHistory} byAgent={budgetByAgent} />
                    </InfoCard>
                  </div>
                </SectionPanel>

                <SectionPanel
                  id="runtime"
                  icon={<Shield size={18} />}
                  title="Runtime & Access"
                  description="Tune execution limits, dashboard access, concurrency, rate limiting, and logging behavior."
                >
                  <div className="grid gap-4 xl:grid-cols-2">
                    <InfoCard icon={<TrendingUp size={16} />} title="Execution limits" description="Bound how much work the scheduler and API-mode agents can do at once.">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Field
                          label="Max iterations per task"
                          type="number"
                          value={settings.max_iterations || '30'}
                          onChange={(value) => updateField('max_iterations', value)}
                        />
                        <Field
                          label="Task timeout (minutes)"
                          type="number"
                          value={settings.task_timeout_minutes || '0'}
                          onChange={(value) => updateField('task_timeout_minutes', value)}
                        />
                        <Field
                          label="Max concurrent executions"
                          type="number"
                          value={settings.max_concurrent_executions || '3'}
                          onChange={(value) => updateField('max_concurrent_executions', value)}
                        />
                        <Field
                          label="Rate limit between model calls (ms)"
                          type="number"
                          value={settings.rate_limit_ms || '0'}
                          onChange={(value) => updateField('rate_limit_ms', value)}
                        />
                      </div>
                    </InfoCard>

                    <InfoCard icon={<Shield size={16} />} title="Dashboard access" description="Protect the dashboard and decide how careful the runtime should be with destructive commands.">
                      <Field
                        label="Dashboard password"
                        type={showKeys.dashboard_password ? 'text' : 'password'}
                        value={settings.dashboard_password || ''}
                        onChange={(value) => updateField('dashboard_password', value)}
                        placeholder="Leave empty to disable"
                        trailing={(
                          <button className="btn btn-ghost" onClick={() => setShowKeys((prev) => ({ ...prev, dashboard_password: !prev.dashboard_password }))}>
                            {showKeys.dashboard_password ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        )}
                        monospace
                      />
                      {settings.dashboard_password ? (
                        <div className="mt-3">
                          <button className="btn btn-ghost text-sm flex items-center gap-1.5" onClick={logout}>
                            <LogOut size={14} /> Sign out
                          </button>
                        </div>
                      ) : null}
                      <div className="mt-4 space-y-3">
                        <ToggleRow
                          title="Confirm destructive commands"
                          description="Ask before running rm, drop, delete, and similar high-risk actions."
                          checked={settings.require_confirmation_destructive === 'true'}
                          onChange={(v) => updateField('require_confirmation_destructive', v ? 'true' : 'false')}
                        />
                        <ToggleRow
                          title="Verbose AI logging"
                          description="Log expanded provider request metadata for debugging and audits."
                          checked={settings.verbose_ai_logging === 'true'}
                          onChange={(v) => updateField('verbose_ai_logging', v ? 'true' : 'false')}
                        />
                      </div>
                    </InfoCard>
                  </div>
                </SectionPanel>

                <SectionPanel
                  id="git"
                  icon={<GitBranch size={18} />}
                  title="Git Automation"
                  description="Control how tasks initialize repositories, sync from main, branch, commit, push, and merge."
                >
                  <div className="grid gap-4 xl:grid-cols-2">
                    <InfoCard icon={<GitBranch size={16} />} title="Task branch flow" description="Use task-scoped branches and PRs when you want execution isolated from the main line.">
                      <div className="space-y-3">
                        <ToggleRow
                          title="Auto branch + PR"
                          description="Create a task branch before work starts, then push and open a PR after completion."
                          checked={settings.auto_git_branch === 'true'}
                          onChange={(v) => updateField('auto_git_branch', v ? 'true' : 'false')}
                        />
                        <ToggleRow
                          title="Auto commit code"
                          description="Commit successful task changes automatically, even if branch creation is disabled."
                          checked={settings.auto_commit_code !== 'false'}
                          onChange={(v) => updateField('auto_commit_code', v ? 'true' : 'false')}
                        />
                        <ToggleRow
                          title="Auto merge back to main"
                          description="Merge completed task branches after push or PR completion."
                          checked={settings.auto_git_merge === 'true'}
                          onChange={(v) => updateField('auto_git_merge', v ? 'true' : 'false')}
                        />
                      </div>
                    </InfoCard>

                    <InfoCard icon={<FolderOpen size={16} />} title="Repository prep" description="Prepare the working tree before an agent starts making changes.">
                      <div className="space-y-3">
                        <ToggleRow
                          title="Auto sync from main"
                          description="Pull latest changes before starting each task and attempt stash-based recovery."
                          checked={settings.auto_git_sync === 'true'}
                          onChange={(v) => updateField('auto_git_sync', v ? 'true' : 'false')}
                        />
                        <ToggleRow
                          title="Auto initialize git"
                          description="Create a repository automatically if the project path does not already have one."
                          checked={settings.auto_git_init === 'true'}
                          onChange={(v) => updateField('auto_git_init', v ? 'true' : 'false')}
                        />
                      </div>
                    </InfoCard>
                  </div>
                </SectionPanel>

                <SectionPanel
                  id="templates"
                  icon={<Copy size={18} />}
                  title="Task Blueprints"
                  description="Reusable single-task and multi-step flow templates for recurring work patterns."
                >
                  <InfoCard icon={<FileText size={16} />} title="Saved templates" description="These are available from the Kanban board when creating new tasks.">
                    {templates.length === 0 ? (
                      <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                        No templates yet. Save a task as a template from the Kanban board task detail view.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
                          {templates.length} template{templates.length !== 1 ? 's' : ''} available for reuse.
                        </p>
                        {templates.map((template) => (
                          <div
                            key={template.id}
                            className="flex items-center gap-3 p-3 rounded-2xl"
                            style={{ background: 'var(--bg-secondary)' }}
                          >
                            <FileText size={16} style={{ color: 'var(--accent)' }} className="shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{template.name}</p>
                              <p className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
                                {template.priority} priority{template.task_type === 'flow' ? ' · Flow' : ''}{template.tags ? ` · ${template.tags}` : ''}
                              </p>
                            </div>
                            <button
                              className="btn btn-ghost text-xs shrink-0"
                              style={{ color: 'var(--danger)' }}
                              onClick={async () => {
                                if (!confirm(`Delete template "${template.name}"?`)) return;
                                try {
                                  await api.deleteTemplate(template.id);
                                  setTemplates((prev) => prev.filter((item) => item.id !== template.id));
                                  toast.success('Template deleted');
                                } catch (err) {
                                  toast.error(err.message);
                                }
                              }}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </InfoCard>
                </SectionPanel>

                <SectionPanel
                  id="preferences"
                  icon={<Palette size={18} />}
                  title="Workspace & Preferences"
                  description="Personalize the UI, set notification behavior, and define default directories and visual accents."
                >
                  <div className="grid gap-4 xl:grid-cols-2">
                    <InfoCard icon={<Palette size={16} />} title="Interface" description="Visual defaults for your own dashboard workspace.">
                      <div className="space-y-3">
                        <ToggleRow
                          title="Dark mode"
                          description="Switch between the light and dark dashboard theme."
                          checked={theme === 'dark'}
                          onChange={toggleTheme}
                        />
                        <ToggleRow
                          title="Notification sounds"
                          description="Play sounds when agents need attention or workflows require review."
                          checked={settings.notification_sounds === 'true'}
                          onChange={(v) => updateField('notification_sounds', v ? 'true' : 'false')}
                        />
                        <SelectField
                          label="Accent color"
                          value={settings.accent_color || 'blue'}
                          onChange={(value) => updateField('accent_color', value)}
                          options={ACCENT_OPTIONS}
                        />
                        <Field
                          label="Default workspace directory"
                          value={settings.default_workspace || ''}
                          onChange={(value) => updateField('default_workspace', value)}
                          placeholder="/Users/you/projects"
                          monospace
                        />
                      </div>
                    </InfoCard>

                    <InfoCard icon={<Bell size={16} />} title="Alerts & email" description="Notification routing and SMTP values for dashboard-driven alerts.">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Field
                          label="Notification email"
                          value={settings.notification_email || ''}
                          onChange={(value) => updateField('notification_email', value)}
                          placeholder="ops@example.com"
                        />
                        <Field
                          label="From address"
                          value={settings.smtp_from || ''}
                          onChange={(value) => updateField('smtp_from', value)}
                          placeholder="AgentWork <noreply@example.com>"
                        />
                        <Field
                          label="SMTP host"
                          value={settings.smtp_host || ''}
                          onChange={(value) => updateField('smtp_host', value)}
                          placeholder="smtp.example.com"
                        />
                        <Field
                          label="SMTP port"
                          value={settings.smtp_port || '587'}
                          onChange={(value) => updateField('smtp_port', value)}
                          placeholder="587"
                        />
                        <Field
                          label="SMTP user"
                          value={settings.smtp_user || ''}
                          onChange={(value) => updateField('smtp_user', value)}
                          placeholder="smtp-user"
                        />
                        <Field
                          label="SMTP password"
                          type={showKeys.smtp_pass ? 'text' : 'password'}
                          value={settings.smtp_pass || ''}
                          onChange={(value) => updateField('smtp_pass', value)}
                          placeholder="••••••••"
                          trailing={(
                            <button className="btn btn-ghost" onClick={() => setShowKeys((prev) => ({ ...prev, smtp_pass: !prev.smtp_pass }))}>
                              {showKeys.smtp_pass ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                          )}
                        />
                      </div>
                      <div className="mt-4 space-y-3">
                        <ToggleRow
                          title="Notify when tasks complete"
                          description="Use email notifications for successful runs."
                          checked={settings.notify_task_complete === 'true'}
                          onChange={(v) => updateField('notify_task_complete', v ? 'true' : 'false')}
                        />
                        <ToggleRow
                          title="Notify when tasks block"
                          description="Send alerts when an agent asks for help or gets blocked."
                          checked={settings.notify_task_blocked === 'true'}
                          onChange={(v) => updateField('notify_task_blocked', v ? 'true' : 'false')}
                        />
                        <ToggleRow
                          title="Notify on budget threshold"
                          description="Alert when budget usage crosses configured limits."
                          checked={settings.notify_budget_threshold === 'true'}
                          onChange={(v) => updateField('notify_budget_threshold', v ? 'true' : 'false')}
                        />
                        <ToggleRow
                          title="Notify on agent messages"
                          description="Alert when agents send direct messages that need attention."
                          checked={settings.notify_agent_messages === 'true'}
                          onChange={(v) => updateField('notify_agent_messages', v ? 'true' : 'false')}
                        />
                      </div>
                    </InfoCard>
                  </div>
                </SectionPanel>
              </div>
            </div>
          </div>
        </main>
        <BottomBar />
      </div>
    </div>
  );
}

function MobileSectionTabs({ activeSection, onSelect }) {
  return (
    <div className="lg:hidden -mx-1 overflow-x-auto pb-1">
      <div className="flex gap-2 min-w-max px-1">
        {SECTION_DEFS.map((section) => {
          const active = activeSection === section.id;
          return (
            <button
              key={section.id}
              className="px-3 py-2 rounded-full text-sm whitespace-nowrap"
              style={{
                background: active ? 'var(--accent-light)' : 'var(--bg-secondary)',
                color: active ? 'var(--accent)' : 'var(--text-secondary)',
              }}
              onClick={() => onSelect(section.id)}
            >
              {section.title}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SectionPanel({ id, icon, title, description, children }) {
  return (
    <section id={id} className="rounded-[28px] border p-5 md:p-6 scroll-mt-6" style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}>
      <div className="flex items-start gap-4 mb-5">
        <div
          className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
          style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
          <p className="text-sm mt-1 max-w-3xl" style={{ color: 'var(--text-tertiary)' }}>{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function InfoCard({ icon, title, description, children }) {
  return (
    <div className="rounded-3xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
      <div className="flex items-start gap-3 mb-4">
        <div
          className="w-9 h-9 rounded-2xl flex items-center justify-center shrink-0"
          style={{ background: 'var(--bg-elevated)', color: 'var(--accent)' }}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function ProviderCard({ provider, value, showValue, onToggleVisibility, onChange }) {
  return (
    <div className="rounded-3xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{provider.label}</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
            {provider.helperText || 'Stored locally and reused by provider-backed agents.'}
          </p>
        </div>
        <AuthStateTag active={Boolean(String(value || '').trim())} activeLabel="Key added" inactiveLabel="Empty" />
      </div>
      <div className="flex gap-2">
        <input
          className="input flex-1 font-mono text-sm"
          type={showValue ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={provider.keyPlaceholder}
        />
        <button className="btn btn-ghost" onClick={onToggleVisibility}>
          {showValue ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
}

function AuthCard({ title, description, method, children }) {
  return (
    <div className="rounded-3xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>{description}</p>
        </div>
        <AuthMethodBadge method={method} />
      </div>
      {children}
      <AuthMethodMeta method={method} />
    </div>
  );
}

function ToggleRow({ title, description, checked, onChange }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{title}</p>
        <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>{description}</p>
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} />
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text', trailing = null, monospace = false, step = undefined }) {
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex gap-2">
        <input
          className={`input flex-1 ${monospace ? 'font-mono text-sm' : ''}`}
          type={type}
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
        {trailing}
      </div>
    </div>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <div>
      <label className="label">{label}</label>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  );
}

function StatTile({ label, value, hint }) {
  return (
    <div className="rounded-2xl p-3" style={{ background: 'rgba(255,255,255,0.55)', border: '1px solid var(--border)' }}>
      <p className="text-[11px] uppercase tracking-[0.18em]" style={{ color: 'var(--text-tertiary)' }}>{label}</p>
      <p className="text-xl font-semibold mt-2" style={{ color: 'var(--text-primary)' }}>{value}</p>
      <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>{hint}</p>
    </div>
  );
}

function MetricCard({ label, value }) {
  return (
    <div className="rounded-2xl p-3" style={{ background: 'var(--bg-primary)' }}>
      <p className="text-[11px] uppercase tracking-[0.14em]" style={{ color: 'var(--text-tertiary)' }}>{label}</p>
      <p className="text-lg font-semibold mt-2" style={{ color: 'var(--text-primary)' }}>{value}</p>
    </div>
  );
}

function MetaPill({ label, value }) {
  return (
    <div className="rounded-2xl px-3 py-2" style={{ background: 'var(--bg-primary)' }}>
      <p className="text-[10px] uppercase tracking-[0.16em]" style={{ color: 'var(--text-tertiary)' }}>{label}</p>
      <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{value}</p>
    </div>
  );
}

function AuthStateTag({ active, activeLabel, inactiveLabel }) {
  return (
    <span
      className="px-2.5 py-1 rounded-full text-[11px] font-medium shrink-0"
      style={{
        background: active ? '#2f9e4420' : 'var(--bg-tertiary)',
        color: active ? '#2f9e44' : 'var(--text-tertiary)',
      }}
    >
      {active ? activeLabel : inactiveLabel}
    </span>
  );
}

function ToggleSwitch({ checked, onChange }) {
  return (
    <button
      className="relative w-11 h-6 rounded-full transition-colors shrink-0"
      style={{ background: checked ? 'var(--accent)' : 'var(--bg-tertiary)' }}
      onClick={() => onChange(!checked)}
    >
      <div
        className="absolute top-1 w-4 h-4 rounded-full bg-white transition-transform"
        style={{ left: checked ? '24px' : '4px' }}
      />
    </button>
  );
}

function AuthMethodBadge({ method }) {
  const configured = Boolean(method?.configured);
  return (
    <span
      className="px-2 py-1 rounded-full text-[11px] font-medium shrink-0"
      style={{
        background: configured ? '#2f9e4420' : 'var(--bg-tertiary)',
        color: configured ? '#2f9e44' : 'var(--text-tertiary)',
      }}
    >
      {configured ? 'Configured' : 'Not configured'}
    </span>
  );
}

function AuthMethodMeta({ method }) {
  if (!method?.profile) return null;

  const parts = [];
  if (method.profile.email) parts.push(method.profile.email);
  if (method.profile.source) parts.push(method.profile.source);
  if (method.profile.projectId) parts.push(`project ${method.profile.projectId}`);
  if (method.profile.expiresAt) {
    parts.push(`${method.profile.expired ? 'expired' : 'expires'} ${new Date(method.profile.expiresAt).toLocaleString()}`);
  }

  if (parts.length === 0) return null;

  return (
    <p className="text-xs mt-3" style={{ color: 'var(--text-tertiary)' }}>
      {parts.join(' · ')}
    </p>
  );
}

function formatTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const AGENT_COLORS = ['#4c6ef5', '#40c057', '#fab005', '#f06595', '#20c997', '#7950f2', '#fd7e14', '#fa5252'];

function BudgetAnalytics({ history, byAgent }) {
  const hasHistory = history && history.length > 0;
  const hasAgentData = byAgent && byAgent.length > 0;

  if (!hasHistory && !hasAgentData) {
    return (
      <p className="text-sm py-4 text-center" style={{ color: 'var(--text-tertiary)' }}>
        No spend data yet. Cost data will appear here once agents start running tasks.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {hasHistory && (
        <div>
          <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>
            Daily spend over the last 30 days
          </p>
          <SpendSparkline data={history} />
        </div>
      )}

      {hasAgentData && (
        <div>
          <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>
            Top agents by spend
          </p>
          <AgentSpendBars data={byAgent.slice(0, 5)} />
        </div>
      )}
    </div>
  );
}

function SpendSparkline({ data }) {
  const sorted = [...data].sort((a, b) => (a.date > b.date ? 1 : -1));
  const costs = sorted.map((d) => d.cost || 0);
  const maxCost = Math.max(...costs, 0.001);
  const totalSpend = costs.reduce((sum, cost) => sum + cost, 0);

  const W = 240;
  const H = 48;
  const padY = 2;

  const points = costs.map((cost, i) => {
    const x = costs.length === 1 ? W / 2 : (i / (costs.length - 1)) * W;
    const y = H - padY - ((cost / maxCost) * (H - padY * 2));
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const fillPoints = `0,${H} ${costs.map((cost, i) => {
    const x = costs.length === 1 ? W / 2 : (i / (costs.length - 1)) * W;
    const y = H - padY - ((cost / maxCost) * (H - padY * 2));
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ')} ${W},${H}`;

  return (
    <div className="flex items-center gap-3">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ background: 'var(--bg-primary)', borderRadius: '10px' }}>
        <defs>
          <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.03" />
          </linearGradient>
        </defs>
        <polygon points={fillPoints} fill="url(#sparkFill)" />
        <polyline
          points={points}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {costs.length > 0 && (() => {
          const lastIdx = costs.length - 1;
          const cx = costs.length === 1 ? W / 2 : (lastIdx / (costs.length - 1)) * W;
          const cy = H - padY - ((costs[lastIdx] / maxCost) * (H - padY * 2));
          return <circle cx={cx} cy={cy} r="2.5" fill="var(--accent)" />;
        })()}
      </svg>
      <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
        <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>${totalSpend.toFixed(2)}</div>
        <div>30-day total</div>
      </div>
    </div>
  );
}

function AgentSpendBars({ data }) {
  const maxCost = Math.max(...data.map((item) => item.total_cost || 0), 0.001);

  return (
    <div className="space-y-2">
      {data.map((agent, index) => {
        const pct = Math.max(((agent.total_cost || 0) / maxCost) * 100, 2);
        const color = AGENT_COLORS[index % AGENT_COLORS.length];
        return (
          <div key={agent.agent_id || index}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-xs flex items-center gap-1 truncate" style={{ color: 'var(--text-secondary)' }}>
                <span>{agent.avatar || ''}</span>
                <span className="truncate">{agent.agent_name || 'Unknown'}</span>
              </span>
              <span className="text-xs font-medium shrink-0 ml-2" style={{ color: 'var(--text-tertiary)' }}>
                ${(agent.total_cost || 0).toFixed(4)}
              </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
