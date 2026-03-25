'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import Sidebar from '../../components/Sidebar';
import BottomBar from '../../components/BottomBar';
import { api } from '../../lib/api';
import { useSocket } from '../providers';
import {
  Bot,
  Clock3,
  FolderOpen,
  RefreshCw,
  Trash2,
  TimerReset,
  Activity,
} from 'lucide-react';

function formatDateTime(value) {
  if (!value) return 'Waiting for scheduler';
  return new Date(value).toLocaleString();
}

function StatusBadge({ job }) {
  const isRunning = job.status === 'doing';
  const isActive = Boolean(job.schedule_active);
  const color = isRunning ? '#1c7ed6' : isActive ? '#2f9e44' : '#f08c00';
  const bg = isRunning ? '#1c7ed620' : isActive ? '#2f9e4420' : '#f08c0020';

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold"
      style={{ color, background: bg }}
    >
      <Activity size={12} className={isRunning ? 'animate-pulse' : ''} />
      {isRunning ? 'Running' : isActive ? 'Scheduled' : 'Not active'}
    </span>
  );
}

function StatCard({ icon: Icon, label, value, hint }) {
  return (
    <div className="rounded-2xl border p-4" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border)' }}>
      <div className="flex items-center gap-2">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}
        >
          <Icon size={17} />
        </div>
        <div>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{label}</p>
          <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</p>
        </div>
      </div>
      {hint ? (
        <p className="text-xs mt-3" style={{ color: 'var(--text-tertiary)' }}>{hint}</p>
      ) : null}
    </div>
  );
}

export default function CronPage() {
  const socket = useSocket();
  const [projects, setProjects] = useState([]);
  const [agents, setAgents] = useState([]);
  const [cronJobs, setCronJobs] = useState([]);
  const [loading, setLoading] = useState(true);
const [selectedProjectId, setSelectedProjectId] = useState('all');
  const [selectedAgentId, setSelectedAgentId] = useState('all');

  const loadCronJobs = useCallback(async () => {
    const jobs = await api.getCronJobs();
    setCronJobs(jobs);
  }, []);

  const loadBaseData = useCallback(async () => {
    try {
      const [projectData, agentData, jobs] = await Promise.all([
        api.getProjects(),
        api.getAgents(),
        api.getCronJobs(),
      ]);
      setProjects(projectData);
      setAgents(agentData);
      setCronJobs(jobs);
    } catch (err) {
      toast.error(err.message || 'Failed to load cron jobs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBaseData();
  }, [loadBaseData]);

  useEffect(() => {
    if (!socket) return;

    const refreshJobs = () => {
      loadCronJobs().catch((err) => {
        console.error('[Cron] Failed to refresh jobs:', err);
      });
    };

    const onTaskCreated = (task) => {
      if (task?.trigger_type === 'cron') refreshJobs();
    };
    const onTaskUpdated = (task) => {
      if (task?.trigger_type === 'cron') refreshJobs();
    };
    const onTaskDeleted = () => refreshJobs();

    socket.on('task:created', onTaskCreated);
    socket.on('task:updated', onTaskUpdated);
    socket.on('task:deleted', onTaskDeleted);

    return () => {
      socket.off('task:created', onTaskCreated);
      socket.off('task:updated', onTaskUpdated);
      socket.off('task:deleted', onTaskDeleted);
    };
  }, [socket, loadCronJobs]);

  const filteredJobs = useMemo(
    () => cronJobs.filter((job) => {
      if (selectedProjectId === 'none') {
        if (job.project_id) return false;
      } else if (selectedProjectId !== 'all' && job.project_id !== selectedProjectId) {
        return false;
      }

      if (selectedAgentId === 'none') {
        if (job.agent_id) return false;
      } else if (selectedAgentId !== 'all' && job.agent_id !== selectedAgentId) {
        return false;
      }

      return true;
    }),
    [cronJobs, selectedProjectId, selectedAgentId],
  );

  const nextJob = useMemo(() => {
    const dated = filteredJobs
      .filter((job) => job.next_run)
      .sort((a, b) => new Date(a.next_run).getTime() - new Date(b.next_run).getTime());
    return dated[0] || null;
  }, [filteredJobs]);

  const activeCount = filteredJobs.filter((job) => job.schedule_active).length;
  const distinctAgents = new Set(filteredJobs.map((job) => job.agent_id).filter(Boolean)).size;

  const deleteJob = async (job) => {
    if (!window.confirm(`Delete cron job "${job.title}"?`)) return;
    try {
      await api.deleteCronJob(job.id);
      setCronJobs((current) => current.filter((item) => item.id !== job.id));
      toast.success('Cron job deleted');
    } catch (err) {
      toast.error(err.message || 'Failed to delete cron job');
    }
  };

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <main className="flex-1 overflow-auto" style={{ background: 'var(--bg-primary)' }}>
          <div className="p-4 md:p-6 space-y-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h1 className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>Cron</h1>
                <p className="text-sm mt-2 max-w-3xl" style={{ color: 'var(--text-tertiary)' }}>
                  Recurring automations assigned to agents. Ask an agent something like “Every weekday at 9am review open PRs and summarize blockers” and it will create a cron job here automatically.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  className="input min-w-[180px]"
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                >
                  <option value="all">All projects</option>
                  <option value="none">No project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>

                <select
                  className="input min-w-[180px]"
                  value={selectedAgentId}
                  onChange={(e) => setSelectedAgentId(e.target.value)}
                >
                  <option value="all">All agents</option>
                  <option value="none">Unassigned</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>{agent.name}</option>
                  ))}
                </select>

                <button className="btn btn-secondary" onClick={() => loadCronJobs().catch((err) => toast.error(err.message || 'Failed to refresh cron jobs'))}>
                  <RefreshCw size={14} />
                  Refresh
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <StatCard icon={Clock3} label="Cron jobs" value={filteredJobs.length} hint="Recurring jobs are powered by the existing task scheduler." />
              <StatCard icon={Bot} label="Agents on duty" value={distinctAgents} hint="Each job stays assigned to the chosen agent and runs under that agent." />
              <StatCard
                icon={TimerReset}
                label="Next run"
                value={nextJob ? formatDateTime(nextJob.next_run) : 'No upcoming run'}
                hint={nextJob ? nextJob.title : 'Create one by asking an agent to do something on a schedule.'}
              />
            </div>

            <div className="rounded-3xl border overflow-hidden" style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
                <div>
                  <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Recurring Jobs</h2>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                    {activeCount} active schedule{activeCount === 1 ? '' : 's'} in the current view.
                  </p>
                </div>
              </div>

              {loading ? (
                <div className="p-8 text-center text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading cron jobs...</div>
              ) : filteredJobs.length === 0 ? (
                <div className="p-8 md:p-12 text-center">
                  <Clock3 size={44} className="mx-auto mb-4" style={{ color: 'var(--text-tertiary)' }} />
                  <p className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>No cron jobs yet</p>
                  <p className="text-sm mt-2 max-w-xl mx-auto" style={{ color: 'var(--text-tertiary)' }}>
                    Ask an agent to do something on a schedule. Example: “Every weekday at 9am check support tickets and summarize anything urgent.”
                  </p>
                </div>
              ) : (
                <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                  {filteredJobs.map((job) => (
                    <div key={job.id} className="p-5">
                      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{job.title}</p>
                            <StatusBadge job={job} />
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 mt-4">
                            <div className="rounded-2xl p-3" style={{ background: 'var(--bg-secondary)' }}>
                              <p className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>Agent</p>
                              <p className="text-sm mt-1 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                <Bot size={14} />
                                {job.agent_name || 'Unassigned'}
                              </p>
                            </div>

                            <div className="rounded-2xl p-3" style={{ background: 'var(--bg-secondary)' }}>
                              <p className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>Project</p>
                              <p className="text-sm mt-1 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                <FolderOpen size={14} />
                                {job.project_name || 'No project'}
                              </p>
                            </div>

                            <div className="rounded-2xl p-3" style={{ background: 'var(--bg-secondary)' }}>
                              <p className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>Schedule</p>
                              <p className="text-sm mt-1" style={{ color: 'var(--text-primary)' }}>{job.schedule_label}</p>
                              <p className="text-[11px] mt-1 font-mono" style={{ color: 'var(--text-tertiary)' }}>{job.trigger_cron}</p>
                            </div>

                            <div className="rounded-2xl p-3" style={{ background: 'var(--bg-secondary)' }}>
                              <p className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>Next run</p>
                              <p className="text-sm mt-1" style={{ color: 'var(--text-primary)' }}>{formatDateTime(job.next_run)}</p>
                              <p className="text-[11px] mt-1" style={{ color: 'var(--text-tertiary)' }}>Created {formatDateTime(job.created_at)}</p>
                            </div>
                          </div>

                          {job.description ? (
                            <p className="text-sm mt-4 whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>
                              {job.description}
                            </p>
                          ) : null}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button className="btn btn-ghost" onClick={() => deleteJob(job)} style={{ color: '#e03131' }}>
                            <Trash2 size={14} />
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </main>
        <BottomBar />
      </div>
    </div>
  );
}
