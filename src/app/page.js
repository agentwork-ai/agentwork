'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import Sidebar from '@/components/Sidebar';
import BottomBar from '@/components/BottomBar';
import OnboardingWizard from '@/components/OnboardingWizard';
import { api } from '@/lib/api';
import { useStatus, useSocket } from '@/app/providers';
import {
  FolderKanban,
  Users,
  CheckCircle2,
  Clock,
  AlertTriangle,
  TrendingUp,
  Zap,
  ArrowRight,
  Activity,
  Plus,
  Trash2,
  RefreshCw,
  Bot,
  DollarSign,
  Bell,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';

const MAX_ACTIVITY_ITEMS = 30;

const ACTIVITY_CONFIG = {
  'task:created':    { icon: Plus,       color: '#4c6ef5', label: 'Task Created' },
  'task:updated':    { icon: RefreshCw,  color: '#4c6ef5', label: 'Task Updated' },
  'task:deleted':    { icon: Trash2,     color: '#4c6ef5', label: 'Task Deleted' },
  'agent:status_changed': { icon: Bot,   color: '#40c057', label: 'Agent Status' },
  'agent:created':   { icon: Plus,       color: '#40c057', label: 'Agent Created' },
  'agent:deleted':   { icon: Trash2,     color: '#40c057', label: 'Agent Deleted' },
  'notification':    { icon: Bell,       color: '#4c6ef5', label: 'Notification' },
  'budget:update':   { icon: DollarSign, color: '#fab005', label: 'Budget Update' },
  'error':           { icon: XCircle,    color: '#fa5252', label: 'Error' },
};

function buildDescription(event, data) {
  switch (event) {
    case 'task:created':
      return `Task "${data?.title || data?.task?.title || 'Untitled'}" was created`;
    case 'task:updated':
      return `Task "${data?.title || data?.task?.title || 'Untitled'}" was updated${data?.status ? ` to ${data.status}` : ''}`;
    case 'task:deleted':
      return `Task "${data?.title || data?.task?.title || 'Untitled'}" was deleted`;
    case 'agent:status_changed':
      return `Agent "${data?.name || data?.agent?.name || 'Unknown'}" is now ${data?.status || data?.agent?.status || 'unknown'}`;
    case 'agent:created':
      return `Agent "${data?.name || data?.agent?.name || 'Unknown'}" was created`;
    case 'agent:deleted':
      return `Agent "${data?.name || data?.agent?.name || 'Unknown'}" was removed`;
    case 'notification':
      return data?.message || 'New notification';
    case 'budget:update':
      return data?.message || 'Budget was updated';
    default:
      return data?.message || 'Activity event';
  }
}

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now - d;
  if (diffMs < 60000) return 'just now';
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
  if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)}h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function DashboardPage() {
  const status = useStatus();
  const socket = useSocket();
  const [stats, setStats] = useState({ projects: 0, agents: 0, tasks: [], recentTasks: [] });
  const [activities, setActivities] = useState([]);
  const [hasNew, setHasNew] = useState(false);
  const newTimerRef = useRef(null);
  const [showOnboarding, setShowOnboarding] = useState(false);

  const addActivity = useCallback((event, data) => {
    const item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      event,
      data,
      description: buildDescription(event, data),
      timestamp: Date.now(),
    };
    setActivities((prev) => [item, ...prev].slice(0, MAX_ACTIVITY_ITEMS));
    setHasNew(true);
    if (newTimerRef.current) clearTimeout(newTimerRef.current);
    newTimerRef.current = setTimeout(() => setHasNew(false), 3000);
  }, []);

  // Socket event listeners for live activity feed
  useEffect(() => {
    if (!socket) return;
    const events = [
      'task:updated',
      'task:created',
      'task:deleted',
      'agent:status_changed',
      'agent:created',
      'agent:deleted',
      'notification',
      'budget:update',
    ];
    const handlers = events.map((event) => {
      const handler = (data) => addActivity(event, data);
      socket.on(event, handler);
      return { event, handler };
    });
    return () => {
      handlers.forEach(({ event, handler }) => socket.off(event, handler));
      if (newTimerRef.current) clearTimeout(newTimerRef.current);
    };
  }, [socket, addActivity]);

  const loadDashboard = useCallback(() => {
    Promise.all([api.getProjects(), api.getAgents(), api.getTasks(), api.getSettings()]).then(
      ([projects, agents, tasks, settings]) => {
        setStats({
          projects: projects.length,
          agents: agents.length,
          tasks,
          recentTasks: tasks.slice(0, 5),
        });
        // Show onboarding when there are no projects, no agents, and onboarding hasn't been dismissed
        if (
          projects.length === 0 &&
          agents.length === 0 &&
          settings.onboarding_complete !== 'true'
        ) {
          setShowOnboarding(true);
        }
      }
    ).catch(() => {});
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const tasksByStatus = {
    backlog: stats.tasks.filter((t) => t.status === 'backlog').length,
    todo: stats.tasks.filter((t) => t.status === 'todo').length,
    doing: stats.tasks.filter((t) => t.status === 'doing').length,
    blocked: stats.tasks.filter((t) => t.status === 'blocked').length,
    done: stats.tasks.filter((t) => t.status === 'done').length,
  };

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <main className="flex-1 overflow-auto p-6" style={{ background: 'var(--bg-primary)' }}>
          {showOnboarding && (
            <OnboardingWizard
              onComplete={() => {
                setShowOnboarding(false);
                loadDashboard();
              }}
            />
          )}
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
              Welcome to AgentWork
            </h1>
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
              Your autonomous AI agent orchestrator
            </p>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <StatCard
              icon={<FolderKanban size={20} />}
              label="Projects"
              value={stats.projects}
              color="var(--accent)"
              href="/projects"
            />
            <StatCard
              icon={<Users size={20} />}
              label="Agents"
              value={stats.agents}
              sub={`${status.activeAgents || 0} active`}
              color="#40c057"
              href="/agents"
            />
            <StatCard
              icon={<CheckCircle2 size={20} />}
              label="Tasks Done"
              value={tasksByStatus.done}
              sub={`of ${stats.tasks.length} total`}
              color="#fab005"
              href="/kanban"
            />
            <StatCard
              icon={<TrendingUp size={20} />}
              label="Monthly Spend"
              value={`$${(status.monthlySpend || 0).toFixed(2)}`}
              color="#f06595"
              href="/settings"
            />
          </div>

          {/* Two columns */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Task Pipeline */}
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Task Pipeline
                </h2>
                <Link
                  href="/kanban"
                  className="text-xs font-medium flex items-center gap-1"
                  style={{ color: 'var(--accent)' }}
                >
                  View Board <ArrowRight size={12} />
                </Link>
              </div>
              <div className="space-y-3">
                <PipelineBar label="Backlog" count={tasksByStatus.backlog} total={stats.tasks.length} color="#868e96" />
                <PipelineBar label="To Do" count={tasksByStatus.todo} total={stats.tasks.length} color="#4c6ef5" />
                <PipelineBar label="Doing" count={tasksByStatus.doing} total={stats.tasks.length} color="#fab005" />
                <PipelineBar label="Blocked" count={tasksByStatus.blocked} total={stats.tasks.length} color="#fa5252" />
                <PipelineBar label="Done" count={tasksByStatus.done} total={stats.tasks.length} color="#40c057" />
              </div>
            </div>

            {/* Live Activity */}
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                    Live Activity
                  </h2>
                  {hasNew && (
                    <span
                      className="inline-block w-2 h-2 rounded-full"
                      style={{
                        background: '#4c6ef5',
                        animation: 'pulse-dot 1.5s ease-in-out infinite',
                      }}
                    />
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  <Activity size={12} />
                  <span>{activities.length} events</span>
                </div>
              </div>
              {activities.length === 0 ? (
                <div className="text-sm py-8 text-center" style={{ color: 'var(--text-tertiary)' }}>
                  <Activity size={24} className="mx-auto mb-2 opacity-40" />
                  <p>No activity yet. Events will appear here in real time.</p>
                </div>
              ) : (
                <div className="space-y-1 max-h-[320px] overflow-y-auto pr-1" style={{ scrollbarWidth: 'thin' }}>
                  {activities.map((item) => {
                    const config = ACTIVITY_CONFIG[item.event] || ACTIVITY_CONFIG['error'];
                    const IconComponent = config.icon;
                    return (
                      <div
                        key={item.id}
                        className="flex items-start gap-3 p-2.5 rounded-lg transition-colors"
                        style={{ background: 'var(--bg-secondary)' }}
                      >
                        <div
                          className="flex items-center justify-center w-7 h-7 rounded-md shrink-0 mt-0.5"
                          style={{ background: `${config.color}18`, color: config.color }}
                        >
                          <IconComponent size={14} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm leading-snug truncate" style={{ color: 'var(--text-primary)' }}>
                            {item.description}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                              {formatTime(item.timestamp)}
                            </span>
                            <span
                              className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                              style={{
                                background: `${config.color}18`,
                                color: config.color,
                              }}
                            >
                              {config.label}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Quick Actions */}
          <div className="mt-6">
            <h2 className="font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
              Quick Actions
            </h2>
            <div className="flex gap-3 flex-wrap">
              <Link href="/agents" className="btn btn-primary">
                <Users size={16} /> Hire Agent
              </Link>
              <Link href="/projects" className="btn btn-secondary">
                <FolderKanban size={16} /> Add Project
              </Link>
              <Link href="/kanban" className="btn btn-secondary">
                <Zap size={16} /> Create Task
              </Link>
              <Link href="/settings" className="btn btn-secondary">
                <AlertTriangle size={16} /> Configure API Keys
              </Link>
            </div>
          </div>
        </main>
        <BottomBar />
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, sub, color, href }) {
  return (
    <Link href={href} className="card p-4 flex items-start gap-3 hover:scale-[1.01] transition-transform">
      <div
        className="flex items-center justify-center w-10 h-10 rounded-lg shrink-0"
        style={{ background: `${color}18`, color }}
      >
        {icon}
      </div>
      <div>
        <p className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>
          {label}
        </p>
        <p className="text-xl font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>
          {value}
        </p>
        {sub && (
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            {sub}
          </p>
        )}
      </div>
    </Link>
  );
}

function PipelineBar({ label, count, total, color }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <span style={{ color: 'var(--text-tertiary)' }}>{count}</span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-tertiary)' }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const config = {
    backlog: { label: 'Backlog', cls: 'badge' },
    todo: { label: 'To Do', cls: 'badge badge-info' },
    doing: { label: 'Doing', cls: 'badge badge-warning' },
    blocked: { label: 'Blocked', cls: 'badge badge-danger' },
    done: { label: 'Done', cls: 'badge badge-success' },
  };
  const c = config[status] || config.backlog;
  return <span className={c.cls}>{c.label}</span>;
}
