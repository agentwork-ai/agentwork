'use client';

import { useEffect, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import BottomBar from '@/components/BottomBar';
import { api } from '@/lib/api';
import { useStatus } from '@/app/providers';
import {
  FolderKanban,
  Users,
  CheckCircle2,
  Clock,
  AlertTriangle,
  TrendingUp,
  Zap,
  ArrowRight,
} from 'lucide-react';
import Link from 'next/link';

export default function DashboardPage() {
  const status = useStatus();
  const [stats, setStats] = useState({ projects: 0, agents: 0, tasks: [], recentTasks: [] });

  useEffect(() => {
    Promise.all([api.getProjects(), api.getAgents(), api.getTasks()]).then(
      ([projects, agents, tasks]) => {
        setStats({
          projects: projects.length,
          agents: agents.length,
          tasks,
          recentTasks: tasks.slice(0, 5),
        });
      }
    ).catch(() => {});
  }, []);

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
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
              Welcome to AgentHub
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

            {/* Recent Tasks */}
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Recent Tasks
                </h2>
                <Link
                  href="/kanban"
                  className="text-xs font-medium flex items-center gap-1"
                  style={{ color: 'var(--accent)' }}
                >
                  View All <ArrowRight size={12} />
                </Link>
              </div>
              {stats.recentTasks.length === 0 ? (
                <p className="text-sm py-8 text-center" style={{ color: 'var(--text-tertiary)' }}>
                  No tasks yet. Create one in the Tasks board.
                </p>
              ) : (
                <div className="space-y-2">
                  {stats.recentTasks.map((task) => (
                    <div
                      key={task.id}
                      className="flex items-center justify-between p-3 rounded-lg"
                      style={{ background: 'var(--bg-secondary)' }}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                          {task.title}
                        </p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                          {task.agent_name || 'Unassigned'} {task.project_name ? `• ${task.project_name}` : ''}
                        </p>
                      </div>
                      <StatusBadge status={task.status} />
                    </div>
                  ))}
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
