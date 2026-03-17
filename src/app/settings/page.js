'use client';

import { useEffect, useState, useCallback } from 'react';
import Sidebar from '@/components/Sidebar';
import BottomBar from '@/components/BottomBar';
import { api } from '@/lib/api';
import { useTheme, useAuth } from '@/app/providers';
import {
  Key, Globe, DollarSign, Shield, Palette, Bell,
  FolderOpen, Save, Eye, EyeOff, TrendingUp, LogOut, BarChart3,
  FileText, Trash2, Copy,
} from 'lucide-react';
import { toast } from 'react-hot-toast';

export default function SettingsPage() {
  const { theme, toggleTheme } = useTheme();
  const { logout } = useAuth();
  const [settings, setSettings] = useState({});
  const [budget, setBudget] = useState(null);
  const [budgetHistory, setBudgetHistory] = useState([]);
  const [budgetByAgent, setBudgetByAgent] = useState([]);
  const [showKeys, setShowKeys] = useState({});
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState([]);

  const load = useCallback(async () => {
    const [s, b, history, byAgent] = await Promise.all([
      api.getSettings(),
      api.getBudget(),
      api.getBudgetHistory(30).catch(() => []),
      api.getBudgetByAgent(30).catch(() => []),
    ]);
    setSettings(s);
    setBudget(b);
    setBudgetHistory(history);
    setBudgetByAgent(byAgent);
    api.getTemplates().then(setTemplates).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const updateField = (key, value) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.updateSettings(settings);
      // If dashboard password was changed, update the auth token
      if (settings.dashboard_password) {
        const result = await api.login(settings.dashboard_password);
        if (result.success && result.token) {
          localStorage.setItem('agentwork-auth-token', result.token);
        }
      } else {
        // Password cleared, remove token
        localStorage.removeItem('agentwork-auth-token');
      }
      toast.success('Settings saved');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <div className="flex items-center justify-between px-6 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <h1 className="font-semibold text-lg" style={{ color: 'var(--text-primary)' }}>Settings</h1>
          <button className="btn btn-primary text-sm" onClick={save} disabled={saving}>
            <Save size={16} /> {saving ? 'Saving...' : 'Save'}
          </button>
        </div>

        <main className="flex-1 overflow-auto p-6" style={{ background: 'var(--bg-primary)' }}>
          <div className="max-w-2xl mx-auto space-y-6">

            {/* API Providers */}
            <Section icon={<Key size={18} />} title="API Providers">
              <div className="space-y-4">
                <div>
                  <label className="label">Anthropic API Key</label>
                  <div className="flex gap-2">
                    <input
                      className="input flex-1 font-mono text-sm"
                      type={showKeys.anthropic ? 'text' : 'password'}
                      value={settings.anthropic_api_key || ''}
                      onChange={(e) => updateField('anthropic_api_key', e.target.value)}
                      placeholder="sk-ant-..."
                    />
                    <button className="btn btn-ghost" onClick={() => setShowKeys((p) => ({ ...p, anthropic: !p.anthropic }))}>
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
                      value={settings.openai_api_key || ''}
                      onChange={(e) => updateField('openai_api_key', e.target.value)}
                      placeholder="sk-..."
                    />
                    <button className="btn btn-ghost" onClick={() => setShowKeys((p) => ({ ...p, openai: !p.openai }))}>
                      {showKeys.openai ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="label">DeepSeek API Key</label>
                  <div className="flex gap-2">
                    <input
                      className="input flex-1 font-mono text-sm"
                      type={showKeys.deepseek ? 'text' : 'password'}
                      value={settings.deepseek_api_key || ''}
                      onChange={(e) => updateField('deepseek_api_key', e.target.value)}
                      placeholder="sk-..."
                    />
                    <button className="btn btn-ghost" onClick={() => setShowKeys((p) => ({ ...p, deepseek: !p.deepseek }))}>
                      {showKeys.deepseek ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="label">Mistral API Key</label>
                  <div className="flex gap-2">
                    <input
                      className="input flex-1 font-mono text-sm"
                      type={showKeys.mistral ? 'text' : 'password'}
                      value={settings.mistral_api_key || ''}
                      onChange={(e) => updateField('mistral_api_key', e.target.value)}
                      placeholder="..."
                    />
                    <button className="btn btn-ghost" onClick={() => setShowKeys((p) => ({ ...p, mistral: !p.mistral }))}>
                      {showKeys.mistral ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="label">OpenRouter API Key</label>
                  <div className="flex gap-2">
                    <input
                      className="input flex-1 font-mono text-sm"
                      type={showKeys.openrouter ? 'text' : 'password'}
                      value={settings.openrouter_api_key || ''}
                      onChange={(e) => updateField('openrouter_api_key', e.target.value)}
                      placeholder="sk-or-..."
                    />
                    <button className="btn btn-ghost" onClick={() => setShowKeys((p) => ({ ...p, openrouter: !p.openrouter }))}>
                      {showKeys.openrouter ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                    Access 200+ models through a single key. Get one at openrouter.ai
                  </p>
                </div>
                <div>
                  <label className="label">Custom Base URL (for local LLMs like Ollama/LMStudio)</label>
                  <input
                    className="input font-mono text-sm"
                    value={settings.custom_base_url || ''}
                    onChange={(e) => updateField('custom_base_url', e.target.value)}
                    placeholder="http://localhost:11434/v1"
                  />
                </div>
              </div>
            </Section>

            {/* Budget */}
            <Section icon={<DollarSign size={18} />} title="Budget Limits">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Daily Budget (USD)</label>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    value={settings.daily_budget_usd || '10'}
                    onChange={(e) => updateField('daily_budget_usd', e.target.value)}
                  />
                  {budget && (
                    <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                      Used today: ${budget.daily.total.toFixed(4)} / ${budget.daily.limit.toFixed(2)}
                    </p>
                  )}
                </div>
                <div>
                  <label className="label">Monthly Budget (USD)</label>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    value={settings.monthly_budget_usd || '100'}
                    onChange={(e) => updateField('monthly_budget_usd', e.target.value)}
                  />
                  {budget && (
                    <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                      Used this month: ${budget.monthly.total.toFixed(4)} / ${budget.monthly.limit.toFixed(2)}
                    </p>
                  )}
                </div>
              </div>
              {budget && (
                <div className="mt-4 p-3 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp size={14} style={{ color: 'var(--accent)' }} />
                    <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Token Usage</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    <div>Today: {formatTokens(budget.daily.input_tokens + budget.daily.output_tokens)} tokens</div>
                    <div>This month: {formatTokens(budget.monthly.input_tokens + budget.monthly.output_tokens)} tokens</div>
                  </div>
                </div>
              )}
            </Section>

            {/* Budget Analytics */}
            <Section icon={<BarChart3 size={18} />} title="Budget Analytics">
              <BudgetAnalytics history={budgetHistory} byAgent={budgetByAgent} />
            </Section>

            {/* Execution */}
            <Section icon={<TrendingUp size={18} />} title="Execution">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Max Iterations per Task</label>
                  <input
                    className="input"
                    type="number"
                    min="1"
                    max="200"
                    value={settings.max_iterations || '30'}
                    onChange={(e) => updateField('max_iterations', e.target.value)}
                  />
                  <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                    API-mode agents stop after this many tool-call loops (default: 30)
                  </p>
                </div>
                <div>
                  <label className="label">Task Timeout (minutes)</label>
                  <input
                    className="input"
                    type="number"
                    min="0"
                    max="1440"
                    value={settings.task_timeout_minutes || '0'}
                    onChange={(e) => updateField('task_timeout_minutes', e.target.value)}
                  />
                  <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                    Auto-block tasks running longer than this (0 = no timeout)
                  </p>
                </div>
              </div>
            </Section>

            {/* Security */}
            <Section icon={<Shield size={18} />} title="Security">
              <div className="space-y-4">
                <div>
                  <label className="label">Dashboard Password</label>
                  <div className="flex gap-2">
                    <input
                      className="input flex-1 font-mono text-sm"
                      type={showKeys.dashboard_password ? 'text' : 'password'}
                      value={settings.dashboard_password || ''}
                      onChange={(e) => updateField('dashboard_password', e.target.value)}
                      placeholder="Leave empty to disable"
                    />
                    <button className="btn btn-ghost" onClick={() => setShowKeys((p) => ({ ...p, dashboard_password: !p.dashboard_password }))}>
                      {showKeys.dashboard_password ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                    Protect the dashboard with a password. Leave empty to disable authentication.
                    After saving, you will need to log in with this password.
                  </p>
                </div>
                {settings.dashboard_password && (
                  <div className="flex">
                    <button className="btn btn-ghost text-sm flex items-center gap-1.5" onClick={logout}>
                      <LogOut size={14} /> Sign Out
                    </button>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      Require confirmation for destructive commands
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      Agents will ask before running rm, drop, delete, etc.
                    </p>
                  </div>
                  <ToggleSwitch
                    checked={settings.require_confirmation_destructive === 'true'}
                    onChange={(v) => updateField('require_confirmation_destructive', v ? 'true' : 'false')}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      Auto Git Branch + PR
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      Auto-create a branch before task execution, then commit, push, and open a PR when done
                    </p>
                  </div>
                  <ToggleSwitch
                    checked={settings.auto_git_branch === 'true'}
                    onChange={(v) => updateField('auto_git_branch', v ? 'true' : 'false')}
                  />
                </div>
              </div>
            </Section>

            {/* Task Templates */}
            <Section icon={<Copy size={18} />} title="Task Templates">
              {templates.length === 0 ? (
                <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                  No templates yet. Save a task as a template from the Kanban board task detail view.
                </p>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
                    {templates.length} template{templates.length !== 1 ? 's' : ''}. Use "From Template" when creating new tasks on the Kanban board.
                  </p>
                  {templates.map((t) => (
                    <div key={t.id} className="flex items-center gap-3 p-3 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
                      <FileText size={16} style={{ color: 'var(--accent)' }} className="shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{t.name}</p>
                        <p className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
                          {t.priority} priority{t.task_type === 'flow' ? ' · Flow' : ''}{t.tags ? ` · ${t.tags}` : ''}
                        </p>
                      </div>
                      <button
                        className="btn btn-ghost text-xs shrink-0"
                        style={{ color: 'var(--danger)' }}
                        onClick={async () => {
                          if (!confirm(`Delete template "${t.name}"?`)) return;
                          try {
                            await api.deleteTemplate(t.id);
                            setTemplates((prev) => prev.filter((x) => x.id !== t.id));
                            toast.success('Template deleted');
                          } catch (err) { toast.error(err.message); }
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* Preferences */}
            <Section icon={<Palette size={18} />} title="Preferences">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Dark Mode</p>
                    <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Toggle between light and dark theme</p>
                  </div>
                  <ToggleSwitch checked={theme === 'dark'} onChange={toggleTheme} />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Notification Sounds</p>
                    <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Play sounds when agents need attention</p>
                  </div>
                  <ToggleSwitch
                    checked={settings.notification_sounds === 'true'}
                    onChange={(v) => updateField('notification_sounds', v ? 'true' : 'false')}
                  />
                </div>
                <div>
                  <label className="label">Default Workspace Directory</label>
                  <input
                    className="input font-mono text-sm"
                    value={settings.default_workspace || ''}
                    onChange={(e) => updateField('default_workspace', e.target.value)}
                    placeholder="/Users/you/projects"
                  />
                </div>
              </div>
            </Section>
          </div>
        </main>
        <BottomBar />
      </div>
    </div>
  );
}

function Section({ icon, title, children }) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        <span style={{ color: 'var(--accent)' }}>{icon}</span>
        <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
      </div>
      {children}
    </div>
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
      {/* Sparkline: daily spend over last 30 days */}
      {hasHistory && (
        <div>
          <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>
            Daily Spend (Last 30 Days)
          </p>
          <SpendSparkline data={history} />
        </div>
      )}

      {/* Mini bar chart: top 5 agents by spend */}
      {hasAgentData && (
        <div>
          <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>
            Top Agents by Spend
          </p>
          <AgentSpendBars data={byAgent.slice(0, 5)} />
        </div>
      )}
    </div>
  );
}

function SpendSparkline({ data }) {
  // Sort chronologically (API returns DESC)
  const sorted = [...data].sort((a, b) => (a.date > b.date ? 1 : -1));
  const costs = sorted.map((d) => d.cost || 0);
  const maxCost = Math.max(...costs, 0.001);
  const totalSpend = costs.reduce((s, c) => s + c, 0);

  const W = 200;
  const H = 40;
  const padY = 2;

  // Build polyline points
  const points = costs.map((c, i) => {
    const x = costs.length === 1 ? W / 2 : (i / (costs.length - 1)) * W;
    const y = H - padY - ((c / maxCost) * (H - padY * 2));
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  // Build gradient fill polygon (area under the line)
  const fillPoints = `0,${H} ${costs.map((c, i) => {
    const x = costs.length === 1 ? W / 2 : (i / (costs.length - 1)) * W;
    const y = H - padY - ((c / maxCost) * (H - padY * 2));
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ')} ${W},${H}`;

  return (
    <div className="flex items-center gap-3">
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        style={{ background: 'var(--bg-secondary)', borderRadius: '6px' }}
      >
        <defs>
          <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
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
        {/* Dot on the last point */}
        {costs.length > 0 && (() => {
          const lastIdx = costs.length - 1;
          const cx = costs.length === 1 ? W / 2 : (lastIdx / (costs.length - 1)) * W;
          const cy = H - padY - ((costs[lastIdx] / maxCost) * (H - padY * 2));
          return <circle cx={cx} cy={cy} r="2.5" fill="var(--accent)" />;
        })()}
      </svg>
      <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
        <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
          ${totalSpend.toFixed(2)}
        </div>
        <div>30-day total</div>
      </div>
    </div>
  );
}

function AgentSpendBars({ data }) {
  const maxCost = Math.max(...data.map((d) => d.total_cost || 0), 0.001);

  return (
    <div className="space-y-2">
      {data.map((agent, i) => {
        const pct = Math.max(((agent.total_cost || 0) / maxCost) * 100, 2);
        const color = AGENT_COLORS[i % AGENT_COLORS.length];
        return (
          <div key={agent.agent_id || i}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-xs flex items-center gap-1 truncate" style={{ color: 'var(--text-secondary)' }}>
                <span>{agent.avatar || ''}</span>
                <span className="truncate">{agent.agent_name || 'Unknown'}</span>
              </span>
              <span className="text-xs font-medium shrink-0 ml-2" style={{ color: 'var(--text-tertiary)' }}>
                ${(agent.total_cost || 0).toFixed(4)}
              </span>
            </div>
            <div
              className="h-2 rounded-full overflow-hidden"
              style={{ background: 'var(--bg-tertiary)' }}
            >
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, background: color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
