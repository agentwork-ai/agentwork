'use client';

import { useEffect, useState, useRef } from 'react';
import Sidebar from '@/components/Sidebar';
import BottomBar from '@/components/BottomBar';
import { api } from '@/lib/api';
import { useSocket } from '@/app/providers';
import { X, Terminal, Cpu, BookOpen, Keyboard, Moon as SleepIcon, Cog } from 'lucide-react';

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
              style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)' }}
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
        </main>
        <BottomBar />
      </div>
    </div>
  );
}
