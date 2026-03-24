'use client';

import { useEffect, useState, useRef } from 'react';
import Sidebar from '../../components/Sidebar';
import BottomBar from '../../components/BottomBar';
import { api } from '../../lib/api';
import { useSocket } from '../providers';
import { X, Terminal, Cpu, BookOpen, Keyboard, Moon as SleepIcon, Cog, Clock } from 'lucide-react';

const STATUS_CONFIG = {
  offline: { icon: SleepIcon, label: 'Sleeping', color: '#868e96', anim: '' },
  idle: { icon: SleepIcon, label: 'Idle', color: '#40c057', anim: '' },
  thinking: { icon: BookOpen, label: 'Reading', color: '#4c6ef5', anim: 'animate-pulse-slow' },
  working: { icon: Keyboard, label: 'Coding', color: '#fab005', anim: 'animate-pulse-slow' },
  executing: { icon: Cog, label: 'Running', color: '#f06595', anim: 'animate-spin' },
};

export default function OfficePage() {
  const socket = useSocket();
  const [agents, setAgents] = useState([]);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [tasks, setTasks] = useState([]);
  const canvasRef = useRef(null);

  useEffect(() => {
    Promise.all([api.getAgents(), api.getTasks()]).then(([a, t]) => {
      setAgents(a);
      setTasks(t);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!socket) return;
    const onStatusChanged = ({ agentId, status }) => {
      setAgents((prev) => prev.map((a) => (a.id === agentId ? { ...a, status } : a)));
    };
    socket.on('agent:status_changed', onStatusChanged);
    return () => socket.off('agent:status_changed', onStatusChanged);
  }, [socket]);

  // Grid positions for agents
  const getPosition = (index, total) => {
    const cols = Math.ceil(Math.sqrt(total));
    const row = Math.floor(index / cols);
    const col = index % cols;
    return {
      x: 120 + col * 220,
      y: 100 + row * 200,
    };
  };

  const agentTasks = selectedAgent
    ? tasks.filter((t) => t.agent_id === selectedAgent.id && t.status === 'doing')
    : [];

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <div className="flex items-center justify-between px-6 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <h1 className="font-semibold text-lg" style={{ color: 'var(--text-primary)' }}>The Office</h1>
          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {agents.filter((a) => a.status !== 'offline').length} agents active
          </span>
        </div>

        <main className="flex-1 overflow-auto relative" style={{ background: 'var(--bg-primary)' }}>
          {agents.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <Cpu size={48} className="mx-auto mb-3" style={{ color: 'var(--text-tertiary)' }} />
                <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                  No agents hired yet. Visit the Agents page to hire some.
                </p>
              </div>
            </div>
          ) : (
            <div ref={canvasRef} className="relative min-h-full p-8">
              {/* Central server node */}
              <div
                className="absolute left-1/2 top-8 -translate-x-1/2 w-28 h-28 rounded-2xl flex flex-col items-center justify-center card z-10"
                style={{ background: 'var(--bg-elevated)' }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-1" style={{ background: 'var(--accent)', color: 'white' }}>
                  <Cpu size={22} />
                </div>
                <span className="text-[10px] font-semibold mt-1" style={{ color: 'var(--text-secondary)' }}>Hub Server</span>
                <div className="w-2 h-2 rounded-full mt-1" style={{ background: 'var(--success)' }} />
              </div>

              {/* Agent desks */}
              <div className="flex flex-wrap gap-6 justify-center mt-44 px-8">
                {agents.map((agent, i) => {
                  const cfg = STATUS_CONFIG[agent.status] || STATUS_CONFIG.offline;
                  const StatusIcon = cfg.icon;
                  const isActive = agent.status !== 'offline';

                  return (
                    <div
                      key={agent.id}
                      className="card p-5 w-48 flex flex-col items-center cursor-pointer transition-all hover:scale-105"
                      style={{
                        borderColor: selectedAgent?.id === agent.id ? 'var(--accent)' : 'var(--border)',
                        borderWidth: selectedAgent?.id === agent.id ? '2px' : '1px',
                      }}
                      onClick={() => setSelectedAgent(agent)}
                    >
                      {/* Connection line indicator */}
                      {isActive && (
                        <div
                          className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full"
                          style={{ background: cfg.color }}
                        />
                      )}

                      {/* Avatar */}
                      <div className="text-4xl mb-2">{agent.avatar}</div>

                      {/* Name */}
                      <p className="text-sm font-semibold text-center" style={{ color: 'var(--text-primary)' }}>
                        {agent.name}
                      </p>

                      {/* Role */}
                      <p className="text-[10px] text-center mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                        {agent.role}
                      </p>

                      {/* Status */}
                      <div className="flex items-center gap-1.5 mt-3 px-2.5 py-1 rounded-full" style={{ background: `${cfg.color}18` }}>
                        <StatusIcon size={12} className={cfg.anim} style={{ color: cfg.color }} />
                        <span className="text-[10px] font-semibold" style={{ color: cfg.color }}>{cfg.label}</span>
                      </div>

                      {/* Activity beam when active */}
                      {isActive && (
                        <div className="mt-2 flex gap-0.5">
                          {[0, 1, 2, 3, 4].map((i) => (
                            <div
                              key={i}
                              className="w-1 rounded-full animate-pulse-slow"
                              style={{
                                height: `${8 + Math.random() * 12}px`,
                                background: cfg.color,
                                animationDelay: `${i * 0.15}s`,
                                opacity: 0.6,
                              }}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Agent detail panel */}
          {selectedAgent && (
            <div
              className="absolute right-0 top-0 bottom-0 w-80 border-l flex flex-col animate-slide-in"
              style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)', zIndex: 20 }}
            >
              <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--border)' }}>
                <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Agent Details</span>
                <button onClick={() => setSelectedAgent(null)} className="p-1" style={{ color: 'var(--text-tertiary)' }}>
                  <X size={16} />
                </button>
              </div>
              <div className="flex-1 overflow-auto p-4 space-y-4">
                <div className="text-center">
                  <span className="text-5xl">{selectedAgent.avatar}</span>
                  <p className="font-semibold mt-2" style={{ color: 'var(--text-primary)' }}>{selectedAgent.name}</p>
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{selectedAgent.role}</p>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Current Activity</p>
                  {agentTasks.length > 0 ? (
                    agentTasks.map((t) => (
                      <div key={t.id} className="p-3 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
                        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{t.title}</p>
                        {t.execution_logs?.length > 0 && (
                          <div className="mt-2 p-2 rounded font-mono text-[10px] max-h-32 overflow-auto"
                            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>
                            {t.execution_logs.slice(-5).map((log, i) => (
                              <div key={i}>{log.content?.slice(0, 100)}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>No active tasks</p>
                  )}
                </div>

                <div>
                  <p className="text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>Provider</p>
                  <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{selectedAgent.provider} / {selectedAgent.model}</p>
                </div>
              </div>
            </div>
          )}

          {/* Execution Timeline / Gantt Chart */}
          {agents.length > 0 && (
            <ExecutionTimeline tasks={tasks} agents={agents} />
          )}
        </main>
        <BottomBar />
      </div>
    </div>
  );
}

/* ── Execution Timeline / Gantt Chart ──────────────────── */

const TIMELINE_COLORS = ['#4c6ef5', '#40c057', '#fab005', '#f06595', '#20c997', '#7950f2', '#fd7e14', '#fa5252'];

function ExecutionTimeline({ tasks, agents }) {
  // Filter tasks from the last 24 hours that have both started_at and completed_at
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const timelineTasks = tasks.filter((t) => {
    if (!t.started_at || !t.completed_at) return false;
    const start = new Date(t.started_at);
    const end = new Date(t.completed_at);
    // Task must overlap with the last 24 hour window
    return end > oneDayAgo && start < now && end > start;
  });

  if (timelineTasks.length === 0) {
    return (
      <div className="mx-8 mb-8">
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-3">
            <Clock size={16} style={{ color: 'var(--accent)' }} />
            <h2 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
              Execution Timeline
            </h2>
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>(Last 24 hours)</span>
          </div>
          <p className="text-xs py-4 text-center" style={{ color: 'var(--text-tertiary)' }}>
            No completed tasks with timing data in the last 24 hours.
          </p>
        </div>
      </div>
    );
  }

  // Determine time bounds (clamp to the 24h window)
  const allStarts = timelineTasks.map((t) => Math.max(new Date(t.started_at).getTime(), oneDayAgo.getTime()));
  const allEnds = timelineTasks.map((t) => Math.min(new Date(t.completed_at).getTime(), now.getTime()));
  const timeMin = Math.min(...allStarts);
  const timeMax = Math.max(...allEnds);
  const timeRange = timeMax - timeMin || 1;

  // Group tasks by agent (swimlanes)
  const agentMap = {};
  agents.forEach((a) => { agentMap[a.id] = a; });

  const swimlanes = {};
  timelineTasks.forEach((t) => {
    const agentId = t.agent_id || '__unassigned__';
    if (!swimlanes[agentId]) swimlanes[agentId] = [];
    swimlanes[agentId].push(t);
  });

  const laneIds = Object.keys(swimlanes);

  // Assign colors to agents
  const agentColorMap = {};
  laneIds.forEach((id, i) => {
    agentColorMap[id] = TIMELINE_COLORS[i % TIMELINE_COLORS.length];
  });

  // Generate time axis ticks
  const ticks = [];
  const tickCount = Math.min(8, Math.max(3, Math.floor(timeRange / (60 * 60 * 1000)) + 1));
  for (let i = 0; i <= tickCount; i++) {
    const t = new Date(timeMin + (timeRange * i) / tickCount);
    const label = timeRange > 12 * 60 * 60 * 1000
      ? t.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    ticks.push({ pct: (i / tickCount) * 100, label });
  }

  const LANE_HEIGHT = 36;
  const BAR_HEIGHT = 22;
  const LABEL_WIDTH = 120;

  return (
    <div className="mx-8 mb-8">
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Clock size={16} style={{ color: 'var(--accent)' }} />
          <h2 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
            Execution Timeline
          </h2>
          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            (Last 24 hours &middot; {timelineTasks.length} task{timelineTasks.length !== 1 ? 's' : ''})
          </span>
        </div>

        <div className="overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
          <div style={{ minWidth: '600px' }}>
            {/* Time axis */}
            <div className="flex" style={{ marginLeft: `${LABEL_WIDTH}px` }}>
              <div className="relative w-full" style={{ height: '20px' }}>
                {ticks.map((tick, i) => (
                  <span
                    key={i}
                    className="absolute text-[9px] whitespace-nowrap"
                    style={{
                      left: `${tick.pct}%`,
                      transform: 'translateX(-50%)',
                      color: 'var(--text-tertiary)',
                    }}
                  >
                    {tick.label}
                  </span>
                ))}
              </div>
            </div>

            {/* Tick lines + swimlanes */}
            <div className="relative" style={{ marginLeft: `${LABEL_WIDTH}px` }}>
              {/* Vertical grid lines */}
              {ticks.map((tick, i) => (
                <div
                  key={i}
                  className="absolute top-0 bottom-0"
                  style={{
                    left: `${tick.pct}%`,
                    width: '1px',
                    background: 'var(--border)',
                    opacity: 0.4,
                    height: `${laneIds.length * LANE_HEIGHT}px`,
                  }}
                />
              ))}
            </div>

            {/* Swimlanes */}
            {laneIds.map((agentId, laneIdx) => {
              const agent = agentMap[agentId];
              const laneTasks = swimlanes[agentId];
              const color = agentColorMap[agentId];

              return (
                <div
                  key={agentId}
                  className="flex items-center"
                  style={{
                    height: `${LANE_HEIGHT}px`,
                    borderBottom: '1px solid var(--border)',
                    borderBottomStyle: laneIdx < laneIds.length - 1 ? 'solid' : 'none',
                  }}
                >
                  {/* Agent label */}
                  <div
                    className="flex items-center gap-1.5 shrink-0 pr-2"
                    style={{ width: `${LABEL_WIDTH}px` }}
                  >
                    <span className="text-sm">{agent?.avatar || ''}</span>
                    <span
                      className="text-[11px] font-medium truncate"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {agent?.name || 'Unassigned'}
                    </span>
                  </div>

                  {/* Task bars area */}
                  <div className="flex-1 relative" style={{ height: `${LANE_HEIGHT}px` }}>
                    {laneTasks.map((task) => {
                      const tStart = Math.max(new Date(task.started_at).getTime(), timeMin);
                      const tEnd = Math.min(new Date(task.completed_at).getTime(), timeMax);
                      const leftPct = ((tStart - timeMin) / timeRange) * 100;
                      const widthPct = Math.max(((tEnd - tStart) / timeRange) * 100, 0.5);

                      const durationMs = new Date(task.completed_at).getTime() - new Date(task.started_at).getTime();
                      const durationMin = Math.round(durationMs / 60000);
                      const durationLabel = durationMin >= 60
                        ? `${Math.floor(durationMin / 60)}h ${durationMin % 60}m`
                        : `${durationMin}m`;

                      return (
                        <div
                          key={task.id}
                          className="absolute rounded"
                          style={{
                            left: `${leftPct}%`,
                            width: `${widthPct}%`,
                            height: `${BAR_HEIGHT}px`,
                            top: `${(LANE_HEIGHT - BAR_HEIGHT) / 2}px`,
                            background: color,
                            opacity: 0.85,
                            minWidth: '4px',
                            cursor: 'default',
                          }}
                          title={`${task.title}\nDuration: ${durationLabel}\nStarted: ${new Date(task.started_at).toLocaleTimeString()}\nCompleted: ${new Date(task.completed_at).toLocaleTimeString()}`}
                        >
                          {/* Show title inside bar if wide enough */}
                          <span
                            className="absolute inset-0 flex items-center px-1.5 text-[9px] font-medium truncate"
                            style={{
                              color: 'white',
                              textShadow: '0 1px 2px rgba(0,0,0,0.3)',
                              lineHeight: `${BAR_HEIGHT}px`,
                            }}
                          >
                            {widthPct > 8 ? task.title : ''}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
