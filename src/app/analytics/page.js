'use client';

import { useEffect, useState, useCallback } from 'react';
import Sidebar from '../../components/Sidebar';
import BottomBar from '../../components/BottomBar';
import { api } from '../../lib/api';
import {
  BarChart3,
  TrendingUp,
  CheckCircle2,
  AlertTriangle,
  DollarSign,
  Coins,
  Bot,
  Cpu,
  RefreshCw,
} from 'lucide-react';

function formatCost(n) {
  if (n == null) return '$0.00';
  return `$${Number(n).toFixed(4)}`;
}

function formatTokens(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatNumber(n) {
  if (!n) return '0';
  return Number(n).toLocaleString();
}

export default function AnalyticsPage() {
  const [report, setReport] = useState(null);
  const [budgetHistory, setBudgetHistory] = useState([]);
  const [byAgent, setByAgent] = useState([]);
  const [byModel, setByModel] = useState([]);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback((period) => {
    setLoading(true);
    Promise.all([
      api.getUsageReport(period),
      api.getBudgetHistory(period),
      api.getBudgetByAgent(period),
      api.getBudgetByModel(period),
    ])
      .then(([reportData, history, agentData, modelData]) => {
        setReport(reportData);
        setBudgetHistory(history);
        setByAgent(agentData);
        setByModel(modelData);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadData(days);
  }, [days, loadData]);

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <main className="flex-1 overflow-auto p-6" style={{ background: 'var(--bg-primary)' }}>
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
                Analytics
              </h1>
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                {report?.period || `Last ${days} days`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {[7, 14, 30, 90].map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className="btn"
                  style={{
                    background: days === d ? 'var(--accent)' : 'var(--bg-tertiary)',
                    color: days === d ? 'white' : 'var(--text-secondary)',
                    border: days === d ? 'none' : '1px solid var(--border)',
                    padding: '6px 12px',
                    fontSize: '12px',
                  }}
                >
                  {d}d
                </button>
              ))}
              <button
                onClick={() => loadData(days)}
                className="btn btn-ghost"
                style={{ padding: '6px 10px' }}
                title="Refresh"
              >
                <RefreshCw size={14} />
              </button>
            </div>
          </div>

          {loading && !report ? (
            <div
              className="flex items-center justify-center py-20 text-sm"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Loading analytics...
            </div>
          ) : (
            <>
              {/* Overview Cards */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
                <OverviewCard
                  icon={<BarChart3 size={18} />}
                  label="Total Tasks"
                  value={report?.tasks?.total ?? 0}
                  color="var(--accent)"
                />
                <OverviewCard
                  icon={<CheckCircle2 size={18} />}
                  label="Completed"
                  value={report?.tasks?.completed ?? 0}
                  color="var(--success)"
                />
                <OverviewCard
                  icon={<AlertTriangle size={18} />}
                  label="Blocked"
                  value={report?.tasks?.blocked ?? 0}
                  color="var(--danger)"
                />
                <OverviewCard
                  icon={<DollarSign size={18} />}
                  label="Total Spend"
                  value={formatCost(report?.spend?.total)}
                  color="#f06595"
                />
                <OverviewCard
                  icon={<Coins size={18} />}
                  label="Total Tokens"
                  value={formatTokens(report?.spend?.tokens)}
                  color="var(--warning)"
                />
              </div>

              {/* Charts Row */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                {/* Daily Spend */}
                <div className="card p-5">
                  <h2 className="font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                    Daily Spend
                  </h2>
                  <DailySpendChart data={report?.dailySpend || []} />
                </div>

                {/* Cost by Agent */}
                <div className="card p-5">
                  <h2 className="font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                    Cost by Agent
                  </h2>
                  <AgentCostChart data={byAgent} />
                </div>
              </div>

              {/* Bottom Row */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Cost by Model */}
                <div className="card p-5">
                  <h2 className="font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                    Cost by Model
                  </h2>
                  <ModelCostTable data={byModel} />
                </div>

                {/* Top Agents */}
                <div className="card p-5">
                  <h2 className="font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                    Top Agents
                  </h2>
                  <TopAgentsList data={report?.topAgents || []} />
                </div>
              </div>
            </>
          )}
        </main>
        <BottomBar />
      </div>
    </div>
  );
}

/* ── Overview Card ─────────────────────────────────────── */
function OverviewCard({ icon, label, value, color }) {
  return (
    <div className="card p-4 flex items-start gap-3">
      <div
        className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0"
        style={{ background: `${color}18`, color }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium truncate" style={{ color: 'var(--text-tertiary)' }}>
          {label}
        </p>
        <p className="text-lg font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>
          {value}
        </p>
      </div>
    </div>
  );
}

/* ── Daily Spend Bar Chart ─────────────────────────────── */
function DailySpendChart({ data }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm" style={{ color: 'var(--text-tertiary)' }}>
        No spend data for this period.
      </div>
    );
  }

  const maxCost = Math.max(...data.map((d) => d.cost || 0), 0.001);

  return (
    <div className="flex items-end gap-1 h-40" style={{ minHeight: '160px' }}>
      {data.map((d, i) => {
        const height = Math.max(((d.cost || 0) / maxCost) * 100, 2);
        const dateLabel = d.date ? d.date.slice(5) : '';
        return (
          <div
            key={i}
            className="flex-1 flex flex-col items-center justify-end gap-1"
            style={{ minWidth: 0 }}
          >
            <span
              className="text-[10px] font-medium"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {d.cost > 0 ? `$${d.cost.toFixed(2)}` : ''}
            </span>
            <div
              className="w-full rounded-t-sm transition-all duration-300"
              style={{
                height: `${height}%`,
                background: 'var(--accent)',
                opacity: 0.85,
                minHeight: '2px',
                maxWidth: '32px',
                margin: '0 auto',
              }}
              title={`${d.date}: $${(d.cost || 0).toFixed(4)}`}
            />
            <span
              className="text-[9px] truncate w-full text-center"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {dateLabel}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Agent Cost Horizontal Bar Chart ───────────────────── */
function AgentCostChart({ data }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm" style={{ color: 'var(--text-tertiary)' }}>
        No agent cost data for this period.
      </div>
    );
  }

  const maxCost = Math.max(...data.map((d) => d.total_cost || 0), 0.001);

  const COLORS = ['#4c6ef5', '#40c057', '#fab005', '#f06595', '#20c997', '#7950f2', '#fd7e14', '#fa5252'];

  return (
    <div className="space-y-3 max-h-[260px] overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
      {data.map((agent, i) => {
        const pct = ((agent.total_cost || 0) / maxCost) * 100;
        const color = COLORS[i % COLORS.length];
        return (
          <div key={agent.agent_id || i}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="flex items-center gap-1.5 truncate" style={{ color: 'var(--text-secondary)' }}>
                <span>{agent.avatar || ''}</span>
                <span className="truncate">{agent.agent_name || 'Unknown'}</span>
              </span>
              <span className="shrink-0 ml-2 font-medium" style={{ color: 'var(--text-tertiary)' }}>
                {formatCost(agent.total_cost)}
              </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.max(pct, 1)}%`, background: color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Model Cost Table ──────────────────────────────────── */
function ModelCostTable({ data }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm" style={{ color: 'var(--text-tertiary)' }}>
        No model data for this period.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
      <table className="w-full text-xs" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
        <thead>
          <tr style={{ color: 'var(--text-tertiary)' }}>
            <th className="text-left font-medium pb-2 pr-3">Model</th>
            <th className="text-left font-medium pb-2 pr-3">Provider</th>
            <th className="text-right font-medium pb-2 pr-3">Cost</th>
            <th className="text-right font-medium pb-2 pr-3">Tokens</th>
            <th className="text-right font-medium pb-2">Calls</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr
              key={i}
              style={{
                borderTop: i > 0 ? '1px solid var(--border-light)' : 'none',
              }}
            >
              <td
                className="py-2 pr-3 font-medium truncate"
                style={{ color: 'var(--text-primary)', maxWidth: '180px' }}
              >
                {row.model || 'unknown'}
              </td>
              <td className="py-2 pr-3 capitalize" style={{ color: 'var(--text-secondary)' }}>
                {row.provider || '-'}
              </td>
              <td className="py-2 pr-3 text-right font-medium" style={{ color: 'var(--text-primary)' }}>
                {formatCost(row.total_cost)}
              </td>
              <td className="py-2 pr-3 text-right" style={{ color: 'var(--text-tertiary)' }}>
                {formatTokens((row.input_tokens || 0) + (row.output_tokens || 0))}
              </td>
              <td className="py-2 text-right" style={{ color: 'var(--text-tertiary)' }}>
                {formatNumber(row.call_count)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Top Agents Ranked List ────────────────────────────── */
function TopAgentsList({ data }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm" style={{ color: 'var(--text-tertiary)' }}>
        No agent activity for this period.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {data.map((agent, i) => (
        <div
          key={i}
          className="flex items-center gap-3 p-3 rounded-lg"
          style={{ background: 'var(--bg-secondary)' }}
        >
          <div
            className="flex items-center justify-center w-8 h-8 rounded-lg text-sm shrink-0 font-bold"
            style={{
              background: i === 0 ? 'var(--accent-light)' : 'var(--bg-tertiary)',
              color: i === 0 ? 'var(--accent)' : 'var(--text-tertiary)',
            }}
          >
            {agent.avatar || `#${i + 1}`}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
              {agent.name || 'Unknown'}
            </p>
            <div className="flex items-center gap-3 mt-0.5">
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                {agent.tasks_done || 0} tasks done
              </span>
              <span className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>
                {formatCost(agent.cost)}
              </span>
            </div>
          </div>
          <div
            className="text-lg font-bold shrink-0"
            style={{ color: i === 0 ? 'var(--accent)' : 'var(--text-tertiary)' }}
          >
            #{i + 1}
          </div>
        </div>
      ))}
    </div>
  );
}
