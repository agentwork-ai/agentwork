'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Sidebar from '@/components/Sidebar';
import BottomBar from '@/components/BottomBar';
import { api } from '@/lib/api';
import { useSocket } from '@/app/providers';
import {
  Plus, X, FolderOpen, Edit2, Trash2, Save,
  Layers, ChevronRight, Clock, RefreshCw, Play, Lock,
  Search, Filter,
} from 'lucide-react';
import { toast } from 'react-hot-toast';

const COLUMNS = [
  { id: 'backlog', label: 'Backlog', color: '#868e96' },
  { id: 'todo', label: 'To Do', color: '#4c6ef5' },
  { id: 'doing', label: 'Doing', color: '#fab005' },
  { id: 'blocked', label: 'Blocked / Review', color: '#fa5252' },
  { id: 'done', label: 'Done', color: '#40c057' },
];

export default function KanbanPage() {
  const socket = useSocket();
  const [tasks, setTasks] = useState([]);
  const [agents, setAgents] = useState([]);
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(null); // null = All
  const [showForm, setShowForm] = useState(false);
  const [editTask, setEditTask] = useState(null);
  const [viewTask, setViewTask] = useState(null);
  const [dragTask, setDragTask] = useState(null);
  const [quickAddCol, setQuickAddCol] = useState(null);
  const [quickAddTitle, setQuickAddTitle] = useState('');
  const [quickAddPriority, setQuickAddPriority] = useState('medium');
  const [quickAddAgentId, setQuickAddAgentId] = useState('');
  const [quickAddProjectId, setQuickAddProjectId] = useState('');
  const quickAddRef = useRef(null);

  const loadData = useCallback(async () => {
    const [t, a, p] = await Promise.all([api.getTasks(), api.getAgents(), api.getProjects()]);
    setTasks(t);
    setAgents(a);
    setProjects(p);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!socket) return;
    const parseTaskFields = (task) => ({
      ...task,
      execution_logs: Array.isArray(task.execution_logs) ? task.execution_logs : JSON.parse(task.execution_logs || '[]'),
      attachments: Array.isArray(task.attachments) ? task.attachments : JSON.parse(task.attachments || '[]'),
      flow_items: Array.isArray(task.flow_items) ? task.flow_items : JSON.parse(task.flow_items || '[]'),
      depends_on: Array.isArray(task.depends_on) ? task.depends_on : JSON.parse(task.depends_on || '[]'),
    });
    const onTaskUpdated = (task) => {
      const parsed = parseTaskFields(task);
      setTasks((prev) => prev.map((t) => (t.id === parsed.id ? parsed : t)));
      setViewTask((prev) => prev?.id === parsed.id ? parsed : prev);
    };
    const onTaskCreated = (task) => setTasks((prev) => [parseTaskFields(task), ...prev]);
    const onTaskDeleted = ({ id }) => {
      setTasks((prev) => prev.filter((t) => t.id !== id));
      setViewTask((prev) => prev?.id === id ? null : prev);
    };
    const onTaskLog = ({ taskId, log }) => {
      setTasks((prev) => prev.map((t) => {
        if (t.id !== taskId) return t;
        return { ...t, execution_logs: [...(t.execution_logs || []), log] };
      }));
      setViewTask((prev) => {
        if (!prev || prev.id !== taskId) return prev;
        return { ...prev, execution_logs: [...(prev.execution_logs || []), log] };
      });
    };
    const onMoveError = ({ message }) => toast.error(message);
    socket.on('task:updated', onTaskUpdated);
    socket.on('task:created', onTaskCreated);
    socket.on('task:deleted', onTaskDeleted);
    socket.on('task:log', onTaskLog);
    socket.on('task:move_error', onMoveError);
    return () => {
      socket.off('task:updated', onTaskUpdated);
      socket.off('task:created', onTaskCreated);
      socket.off('task:deleted', onTaskDeleted);
      socket.off('task:log', onTaskLog);
      socket.off('task:move_error', onMoveError);
    };
  }, [socket]);

  const moveTask = async (taskId, newStatus) => {
    if (newStatus !== 'backlog' && newStatus !== 'todo') {
      const task = tasks.find((t) => t.id === taskId);
      if (task && !task.agent_id) {
        const isFlowTask = (task.task_type || 'single') === 'flow';
        const flowHasAgents = task.flow_items?.some((i) => i.agent_id);
        if (!isFlowTask || !flowHasAgents) {
          toast.error('Assign an agent before moving this task.');
          return;
        }
      }
      // Client-side dependency check
      if (newStatus === 'doing' && task) {
        const depIds = task.depends_on || [];
        if (depIds.length > 0) {
          const unmet = tasks.filter((t) => depIds.includes(t.id) && t.status !== 'done');
          if (unmet.length > 0) {
            toast.error(`Dependencies not met: ${unmet.map((t) => t.title).join(', ')}`);
            return;
          }
        }
      }
    }
    try {
      await api.updateTask(taskId, { status: newStatus });
    } catch (err) {
      toast.error(err.message);
    }
  };

  const deleteTask = async (id) => {
    if (!confirm('Delete this task?')) return;
    await api.deleteTask(id);
    toast.success('Task deleted');
  };

  const changePriority = async (taskId, priority) => {
    try {
      await api.updateTask(taskId, { priority });
    } catch (err) {
      toast.error(err.message);
    }
  };

  const changeAgent = async (taskId, agentId) => {
    try {
      await api.updateTask(taskId, { agent_id: agentId });
    } catch (err) {
      toast.error(err.message);
    }
  };

  const changeProject = async (taskId, projectId) => {
    try {
      await api.updateTask(taskId, { project_id: projectId });
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDragStart = (e, task) => {
    setDragTask(task);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e, columnId) => {
    e.preventDefault();
    if (dragTask && dragTask.status !== columnId) moveTask(dragTask.id, columnId);
    setDragTask(null);
  };

  // Autofocus quick-add input when opened
  useEffect(() => {
    if (quickAddCol) quickAddRef.current?.focus();
  }, [quickAddCol]);

  const openQuickAdd = (colId) => {
    setQuickAddTitle('');
    setQuickAddPriority('medium');
    setQuickAddAgentId('');
    setQuickAddProjectId(selectedProjectId || '');
    setQuickAddCol(colId);
  };

  const closeQuickAdd = () => {
    setQuickAddCol(null);
    setQuickAddTitle('');
  };

  const submitQuickAdd = async () => {
    const title = quickAddTitle.trim();
    if (!title) { closeQuickAdd(); return; }
    try {
      await api.createTask({
        title,
        status: quickAddCol,
        priority: quickAddPriority,
        agent_id: quickAddAgentId || null,
        project_id: quickAddProjectId || null,
      });
    } catch (err) {
      toast.error(err.message);
    }
    closeQuickAdd();
  };

  const onQuickAddKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitQuickAdd(); }
    else if (e.key === 'Escape') { closeQuickAdd(); }
  };

  // Filter tasks by selected project
  const visibleTasks = selectedProjectId
    ? tasks.filter((t) => t.project_id === selectedProjectId)
    : tasks;

  const selectedProject = projects.find((p) => p.id === selectedProjectId) || null;

  // Task counts per project for the panel
  const countByProject = (pid) => tasks.filter((t) => t.project_id === pid).length;

  return (
    <div className="flex h-screen">
      <Sidebar />

      {/* Project panel */}
      <div className="w-52 shrink-0 border-r flex flex-col" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
        <div className="px-3 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Boards</p>
        </div>
        <div className="flex-1 overflow-auto py-1">
          {/* All tasks */}
          <button
            onClick={() => setSelectedProjectId(null)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors"
            style={{
              background: selectedProjectId === null ? 'var(--accent-light)' : 'transparent',
              color: selectedProjectId === null ? 'var(--accent)' : 'var(--text-secondary)',
            }}
          >
            <Layers size={14} className="shrink-0" />
            <span className="flex-1 text-left truncate font-medium">All Tasks</span>
            <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' }}>
              {tasks.length}
            </span>
          </button>

          {/* Divider */}
          {projects.length > 0 && (
            <div className="mx-3 my-1 border-t" style={{ borderColor: 'var(--border)' }} />
          )}

          {/* Project list */}
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedProjectId(p.id)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors group"
              style={{
                background: selectedProjectId === p.id ? 'var(--accent-light)' : 'transparent',
                color: selectedProjectId === p.id ? 'var(--accent)' : 'var(--text-secondary)',
              }}
            >
              <FolderOpen size={14} className="shrink-0" style={{ opacity: selectedProjectId === p.id ? 1 : 0.6 }} />
              <span className="flex-1 text-left truncate">{p.name}</span>
              <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' }}>
                {countByProject(p.id)}
              </span>
            </button>
          ))}

          {projects.length === 0 && (
            <p className="text-xs px-3 py-4 text-center" style={{ color: 'var(--text-tertiary)' }}>
              No projects yet
            </p>
          )}
        </div>
      </div>

      {/* Main board area */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Board header */}
        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            {selectedProject ? (
              <>
                <FolderOpen size={16} style={{ color: 'var(--accent)' }} />
                <h1 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>{selectedProject.name}</h1>
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{selectedProject.path}</span>
              </>
            ) : (
              <>
                <Layers size={16} style={{ color: 'var(--accent)' }} />
                <h1 className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>All Tasks</h1>
              </>
            )}
          </div>
          <button
            className="btn btn-primary text-sm"
            onClick={() => { setShowForm(true); setEditTask(null); }}
          >
            <Plus size={15} /> New Task
          </button>
        </div>

        <main className="flex-1 overflow-x-auto overflow-y-hidden p-4" style={{ background: 'var(--bg-primary)' }}>
          <div className="flex gap-4 h-full min-w-max">
            {COLUMNS.map((col) => {
              const colTasks = visibleTasks.filter((t) => t.status === col.id);
              return (
                <div
                  key={col.id}
                  className="w-72 flex flex-col rounded-xl shrink-0"
                  style={{ background: 'var(--bg-secondary)' }}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, col.id)}
                >
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: col.color }} />
                    <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{col.label}</span>
                    <span className="text-xs ml-auto px-1.5 py-0.5 rounded-md" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' }}>
                      {colTasks.length}
                    </span>
                    {(col.id === 'backlog' || col.id === 'todo') && (
                      <button
                        onClick={() => openQuickAdd(col.id)}
                        className="w-5 h-5 rounded flex items-center justify-center transition-colors"
                        style={{ color: 'var(--text-tertiary)' }}
                        title="Quick add task"
                      >
                        <Plus size={14} />
                      </button>
                    )}
                  </div>
                  <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">
                    {quickAddCol === col.id && (
                      <div className="rounded-lg p-2.5 space-y-2" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--accent)' }}>
                        <input
                          ref={quickAddRef}
                          className="w-full bg-transparent text-sm outline-none"
                          style={{ color: 'var(--text-primary)' }}
                          placeholder="Task title…"
                          value={quickAddTitle}
                          onChange={(e) => setQuickAddTitle(e.target.value)}
                          onKeyDown={onQuickAddKey}
                        />
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {/* Priority */}
                          <select
                            className="text-[10px] rounded px-1.5 py-0.5 outline-none cursor-pointer"
                            style={{
                              background: `${PRIORITY_COLORS[quickAddPriority]}20`,
                              color: PRIORITY_COLORS[quickAddPriority],
                              border: 'none',
                            }}
                            value={quickAddPriority}
                            onChange={(e) => setQuickAddPriority(e.target.value)}
                          >
                            {PRIORITIES.map((p) => (
                              <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                            ))}
                          </select>

                          {/* Agent */}
                          <select
                            className="text-[10px] rounded px-1.5 py-0.5 outline-none cursor-pointer flex-1 min-w-0"
                            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: 'none' }}
                            value={quickAddAgentId}
                            onChange={(e) => setQuickAddAgentId(e.target.value)}
                          >
                            <option value="">No agent</option>
                            {agents.map((a) => (
                              <option key={a.id} value={a.id}>{a.avatar} {a.name}</option>
                            ))}
                          </select>

                          {/* Project */}
                          <select
                            className="text-[10px] rounded px-1.5 py-0.5 outline-none cursor-pointer flex-1 min-w-0"
                            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: 'none' }}
                            value={quickAddProjectId}
                            onChange={(e) => setQuickAddProjectId(e.target.value)}
                          >
                            <option value="">No project</option>
                            {projects.map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="flex justify-end gap-1.5">
                          <button className="btn btn-ghost text-[10px] py-0.5 px-2" onClick={closeQuickAdd}>Cancel</button>
                          <button className="btn btn-primary text-[10px] py-0.5 px-2" onClick={submitQuickAdd}>Add</button>
                        </div>
                      </div>
                    )}
                    {colTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        agents={agents}
                        projects={projects}
                        allTasks={tasks}
                        showProject={!selectedProjectId}
                        onDragStart={(e) => handleDragStart(e, task)}
                        onClick={() => setViewTask(task)}
                        onPriorityChange={changePriority}
                        onAgentChange={changeAgent}
                        onProjectChange={changeProject}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </main>
        <BottomBar />
      </div>

      {showForm && (
        <TaskFormModal
          task={editTask}
          agents={agents}
          projects={projects}
          allTasks={tasks}
          defaultProjectId={selectedProjectId}
          onClose={() => { setShowForm(false); setEditTask(null); }}
          onSaved={() => { setShowForm(false); setEditTask(null); loadData(); }}
        />
      )}

      {viewTask && (
        <TaskDetailModal
          task={viewTask}
          agents={agents}
          projects={projects}
          allTasks={tasks}
          onClose={() => setViewTask(null)}
          onUpdate={(updated) => {
            setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
            setViewTask(updated);
          }}
          onDelete={() => { deleteTask(viewTask.id); setViewTask(null); }}
        />
      )}
    </div>
  );
}

const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const PRIORITY_COLORS = { low: '#868e96', medium: '#fab005', high: '#fa5252', critical: '#e03131' };

function TaskCard({ task, projects, agents, allTasks, showProject, onDragStart, onClick, onPriorityChange, onAgentChange, onProjectChange }) {
  const isDoing = task.status === 'doing';
  const [openDropdown, setOpenDropdown] = useState(null); // 'priority' | 'project' | 'agent' | null
  const cardRef = useRef(null);

  // Check for unmet dependencies
  const depIds = task.depends_on || [];
  const unmetDeps = depIds.length > 0
    ? (allTasks || []).filter((t) => depIds.includes(t.id) && t.status !== 'done')
    : [];

  // Close dropdown on outside click
  useEffect(() => {
    if (!openDropdown) return;
    const handler = (e) => {
      if (cardRef.current && !cardRef.current.contains(e.target)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [openDropdown]);

  const toggleDropdown = (e, name) => {
    e.stopPropagation();
    setOpenDropdown((prev) => (prev === name ? null : name));
  };

  const selectPriority = (e, priority) => {
    e.stopPropagation();
    onPriorityChange(task.id, priority);
    setOpenDropdown(null);
  };

  const selectAgent = (e, agentId) => {
    e.stopPropagation();
    onAgentChange(task.id, agentId);
    setOpenDropdown(null);
  };

  const selectProject = (e, projectId) => {
    e.stopPropagation();
    onProjectChange(task.id, projectId);
    setOpenDropdown(null);
  };

  const assignedAgent = agents?.find((a) => a.id === task.agent_id);
  const assignedProject = projects?.find((p) => p.id === task.project_id);
  const priorityColor = PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.medium;

  return (
    <div
      ref={cardRef}
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className={`card p-3 cursor-pointer active:cursor-grabbing animate-fade-in transition-all hover:scale-[1.01] ${isDoing ? 'doing-card' : ''}`}
      style={{ borderLeft: isDoing ? '3px solid #fab005' : undefined }}
    >
      {isDoing && (
        <div className="flex items-center gap-1.5 mb-2">
          <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse-slow" />
          <span className="text-[10px] font-semibold" style={{ color: '#fab005' }}>Working...</span>
        </div>
      )}
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium flex-1" style={{ color: 'var(--text-primary)' }}>{task.title}</p>
        {unmetDeps.length > 0 && (
          <span title={`Blocked by: ${unmetDeps.map((d) => d.title).join(', ')}`}
            className="shrink-0 mt-0.5"
            style={{ color: '#fa5252' }}>
            <Lock size={13} />
          </span>
        )}
      </div>
      {task.description && (
        <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--text-tertiary)' }}>{task.description}</p>
      )}
      {task.tags && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {task.tags.split(',').filter(Boolean).map((tag) => (
            <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
              style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}>
              {tag.trim()}
            </span>
          ))}
        </div>
      )}
      {task.trigger_type && task.trigger_type !== 'manual' && (
        <div className="flex items-center gap-1 mt-1.5">
          <div className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
            style={{ background: task.trigger_type === 'cron' ? '#7c3aed20' : '#4c6ef520', color: task.trigger_type === 'cron' ? '#7c3aed' : '#4c6ef5' }}>
            {task.trigger_type === 'cron' ? <RefreshCw size={9} /> : <Clock size={9} />}
            <span>{task.trigger_type === 'cron' ? task.trigger_cron || 'Cron' : 'Scheduled'}</span>
          </div>
        </div>
      )}
      {(task.task_type || 'single') === 'flow' && task.flow_items?.length > 0 && (
        <div className="mt-2 pt-2 border-t space-y-1" style={{ borderColor: 'var(--border-light)' }}>
          {task.flow_items.map((item, idx) => {
            const stepAgent = agents?.find((a) => a.id === item.agent_id);
            const sc = { pending: 'var(--text-tertiary)', doing: '#fab005', done: '#40c057', failed: 'var(--danger)' }[item.status] || 'var(--text-tertiary)';
            const icon = { pending: '○', doing: '◆', done: '✓', failed: '✗' }[item.status] || '○';
            return (
              <div key={item.id || idx} className="flex items-center gap-1.5 text-[10px]">
                <span className="shrink-0 font-bold" style={{ color: sc }}>{icon}</span>
                <span className="flex-1 truncate" style={{ color: item.status === 'doing' ? '#fab005' : 'var(--text-secondary)' }}>
                  {item.title || `Step ${idx + 1}`}
                </span>
                {stepAgent && (
                  <span className="shrink-0" style={{ color: 'var(--text-tertiary)' }}>{stepAgent.avatar} {stepAgent.name}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="flex items-center gap-2 mt-2.5 flex-wrap">
        {/* Priority dropdown */}
        <div className="relative">
          <button
            onClick={(e) => toggleDropdown(e, 'priority')}
            className="flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:opacity-80"
            style={{ background: `${priorityColor}20` }}
          >
            <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: priorityColor }} />
            <span className="text-[10px] uppercase font-semibold" style={{ color: priorityColor }}>{task.priority}</span>
          </button>
          {openDropdown === 'priority' && (
            <div
              className="absolute left-0 top-full mt-1 rounded-lg shadow-lg z-50 py-1 min-w-[100px]"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
              onClick={(e) => e.stopPropagation()}
            >
              {PRIORITIES.map((p) => (
                <button
                  key={p}
                  className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:opacity-80 transition-colors"
                  style={{ background: task.priority === p ? `${PRIORITY_COLORS[p]}20` : 'transparent', color: PRIORITY_COLORS[p] }}
                  onClick={(e) => selectPriority(e, p)}
                >
                  <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: PRIORITY_COLORS[p] }} />
                  <span className="uppercase font-semibold">{p}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Project picker */}
        <div className="relative">
          <button
            onClick={(e) => toggleDropdown(e, 'project')}
            className="text-[10px] flex items-center gap-0.5 px-1.5 py-0.5 rounded transition-colors hover:opacity-80"
            style={assignedProject
              ? { background: 'var(--accent-light)', color: 'var(--accent)' }
              : { background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' }}
          >
            <FolderOpen size={10} />
            {assignedProject ? assignedProject.name : 'Project'}
          </button>
          {openDropdown === 'project' && (
            <div
              className="absolute left-0 top-full mt-1 rounded-lg shadow-lg z-50 py-1 min-w-[140px]"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="w-full text-left px-3 py-1.5 text-xs hover:opacity-80 transition-colors"
                style={{ color: 'var(--text-tertiary)' }}
                onClick={(e) => selectProject(e, null)}
              >
                None
              </button>
              {projects?.map((p) => (
                <button
                  key={p.id}
                  className="w-full text-left px-3 py-1.5 text-xs hover:opacity-80 transition-colors"
                  style={{ color: task.project_id === p.id ? 'var(--accent)' : 'var(--text-primary)', background: task.project_id === p.id ? 'var(--accent-light)' : 'transparent' }}
                  onClick={(e) => selectProject(e, p.id)}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Agent picker */}
        <div className="relative ml-auto">
          <button
            onClick={(e) => toggleDropdown(e, 'agent')}
            className="text-[10px] flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors hover:opacity-80"
            style={assignedAgent
              ? { background: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }
              : { background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' }}
          >
            {assignedAgent ? <><span>{assignedAgent.avatar}</span>{assignedAgent.name}</> : '+ Agent'}
          </button>
          {openDropdown === 'agent' && (
            <div
              className="absolute right-0 top-full mt-1 rounded-lg shadow-lg z-50 py-1 min-w-[140px]"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="w-full text-left px-3 py-1.5 text-xs hover:opacity-80 transition-colors"
                style={{ color: 'var(--text-tertiary)' }}
                onClick={(e) => selectAgent(e, null)}
              >
                Unassign
              </button>
              {agents?.map((a) => (
                <button
                  key={a.id}
                  className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:opacity-80 transition-colors"
                  style={{ color: task.agent_id === a.id ? 'var(--accent)' : 'var(--text-primary)', background: task.agent_id === a.id ? 'var(--accent-light)' : 'transparent' }}
                  onClick={(e) => selectAgent(e, a.id)}
                >
                  <span>{a.avatar}</span>{a.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {isDoing && task.execution_logs?.length > 0 && (
        <div className="mt-2 pt-2 border-t" style={{ borderColor: 'var(--border-light)' }}>
          <p className="text-[10px] font-mono truncate" style={{ color: 'var(--text-tertiary)' }}>
            {task.execution_logs[task.execution_logs.length - 1]?.content?.slice(0, 60)}...
          </p>
        </div>
      )}
    </div>
  );
}

const LOG_TYPE_CONFIG = {
  all:         { label: 'All',         color: 'var(--text-secondary)', bg: 'var(--bg-secondary)', icon: '●' },
  response:    { label: 'Response',    color: '#339af0', bg: '#339af015', icon: '◉' },
  command:     { label: 'Command',     color: '#20c997', bg: '#20c99715', icon: '$' },
  output:      { label: 'Output',      color: '#868e96', bg: '#868e9615', icon: '▸' },
  error:       { label: 'Error',       color: '#fa5252', bg: '#fa525215', icon: '✗' },
  info:        { label: 'Info',        color: '#339af0', bg: '#339af015', icon: 'ℹ' },
  thinking:    { label: 'Thinking',    color: '#7950f2', bg: '#7950f215', icon: '◆' },
  success:     { label: 'Success',     color: '#40c057', bg: '#40c05715', icon: '✓' },
  warning:     { label: 'Warning',     color: '#fab005', bg: '#fab00515', icon: '!' },
  file_change: { label: 'File Change', color: '#f783ac', bg: '#f783ac15', icon: '△' },
};

const LOG_TYPE_KEYS = Object.keys(LOG_TYPE_CONFIG);

function TaskDetailModal({ task, agents, projects, allTasks, onClose, onUpdate, onDelete }) {
  const logsEndRef = useRef(null);
  const isEditable = task.status !== 'doing';
  const isDoing = task.status === 'doing';
  const isFlow = (task.task_type || 'single') === 'flow';
  const [editing, setEditing] = useState(false);
  const [depSearch, setDepSearch] = useState('');
  const [form, setForm] = useState({
    title: task.title,
    description: task.description,
    priority: task.priority,
    agent_id: task.agent_id || '',
    project_id: task.project_id || '',
    tags: task.tags || '',
    flow_items: task.flow_items || [],
    depends_on: task.depends_on || [],
  });
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState(isDoing ? 'logs' : 'details');
  const [logTypeFilter, setLogTypeFilter] = useState('all');
  const [logSearchText, setLogSearchText] = useState('');

  const filteredLogs = (task.execution_logs || []).filter((log) => {
    if (logTypeFilter !== 'all' && log.type !== logTypeFilter) return false;
    if (logSearchText && !log.content?.toLowerCase().includes(logSearchText.toLowerCase())) return false;
    return true;
  });

  const logTypeCounts = (task.execution_logs || []).reduce((acc, log) => {
    acc[log.type] = (acc[log.type] || 0) + 1;
    return acc;
  }, {});

  useEffect(() => {
    if (activeTab === 'logs') logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [task.execution_logs?.length, activeTab]);

  useEffect(() => {
    setForm({
      title: task.title,
      description: task.description,
      priority: task.priority,
      agent_id: task.agent_id || '',
      project_id: task.project_id || '',
      tags: task.tags || '',
      flow_items: task.flow_items || [],
      depends_on: task.depends_on || [],
    });
  }, [task]);

  const addFlowItem = () => setForm((f) => ({
    ...f,
    flow_items: [...f.flow_items, { id: String(Date.now()), title: '', agent_id: '', status: 'pending', output: '' }],
  }));
  const removeFlowItem = (idx) => setForm((f) => ({ ...f, flow_items: f.flow_items.filter((_, i) => i !== idx) }));
  const updateFlowItem = (idx, field, value) => setForm((f) => {
    const items = [...f.flow_items];
    items[idx] = { ...items[idx], [field]: value };
    return { ...f, flow_items: items };
  });

  const saveChanges = async () => {
    setSaving(true);
    try {
      const retryAfterSave = form._retryAfterSave;
      const data = {
        ...form,
        agent_id: form.agent_id || null,
        project_id: form.project_id || null,
        flow_items: isFlow ? form.flow_items : undefined,
        depends_on: form.depends_on || [],
      };
      delete data._retryAfterSave;
      if (retryAfterSave) data.status = 'doing';
      const updated = await api.updateTask(task.id, data);
      onUpdate(updated);
      setEditing(false);
      toast.success(retryAfterSave ? 'Task retrying...' : 'Task updated');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const statusColor = COLUMNS.find((c) => c.id === task.status)?.color || '#868e96';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card w-full max-w-3xl max-h-[85vh] flex flex-col animate-fade-in" style={{ background: 'var(--bg-elevated)' }}>
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-3">
            {isDoing && <div className="w-2.5 h-2.5 rounded-full bg-yellow-400 animate-pulse-slow" />}
            <span className="badge" style={{ background: `${statusColor}20`, color: statusColor }}>
              {COLUMNS.find((c) => c.id === task.status)?.label}
            </span>
            <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>{task.title}</h3>
          </div>
          <div className="flex items-center gap-2">
            {task.status === 'blocked' && !editing && (
              <button className="btn btn-primary text-xs" onClick={() => {
                setEditing(true);
                setForm((f) => ({ ...f, _retryAfterSave: true }));
              }}><RefreshCw size={13} /> Retry</button>
            )}
            {isEditable && !editing && (
              <button className="btn btn-ghost text-xs" onClick={() => setEditing(true)}><Edit2 size={13} /> Edit</button>
            )}
            <button className="btn btn-ghost text-xs" style={{ color: 'var(--danger)' }} onClick={onDelete}><Trash2 size={13} /></button>
            <button onClick={onClose} className="p-1 rounded" style={{ color: 'var(--text-tertiary)' }}><X size={18} /></button>
          </div>
        </div>

        <div className="flex border-b px-4" style={{ borderColor: 'var(--border)' }}>
          {['details', 'logs'].map((tab) => (
            <button key={tab}
              className="px-4 py-2.5 text-xs font-medium border-b-2 transition-colors capitalize"
              style={{
                borderColor: activeTab === tab ? 'var(--accent)' : 'transparent',
                color: activeTab === tab ? 'var(--accent)' : 'var(--text-tertiary)',
              }}
              onClick={() => setActiveTab(tab)}
            >
              {tab === 'logs' && isDoing && <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse-slow mr-1.5" />}
              {tab === 'logs' ? `Execution Logs (${task.execution_logs?.length || 0})` : 'Details'}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-4">
          {activeTab === 'details' ? (
            editing ? (
              <div className="space-y-4">
                <div>
                  <label className="label">Title</label>
                  <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                </div>
                <div>
                  <label className="label">Description</label>
                  <textarea className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
                </div>
                <div>
                  <label className="label">Tags <span className="font-normal text-[10px]" style={{ color: 'var(--text-tertiary)' }}>(comma-separated)</span></label>
                  <input className="input text-sm" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="bug, feature, urgent" />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="label">Priority</label>
                    <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                      <option value="low">Low</option><option value="medium">Medium</option>
                      <option value="high">High</option><option value="critical">Critical</option>
                    </select>
                  </div>
                  {!isFlow && (
                    <div>
                      <label className="label">Agent</label>
                      <select className="input" value={form.agent_id} onChange={(e) => setForm({ ...form, agent_id: e.target.value })}>
                        <option value="">Unassigned</option>
                        {agents.map((a) => <option key={a.id} value={a.id}>{a.avatar} {a.name}</option>)}
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="label">Project</label>
                    <select className="input" value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}>
                      <option value="">None</option>
                      {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                </div>
                {isFlow && (
                  <div className="pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                    <div className="flex items-center justify-between mb-2">
                      <label className="label m-0">Flow Steps</label>
                      <button type="button" className="btn btn-ghost text-xs py-1 px-2" onClick={addFlowItem}>
                        <Plus size={11} /> Add Step
                      </button>
                    </div>
                    {form.flow_items.length === 0 ? (
                      <p className="text-xs text-center py-3 rounded-lg" style={{ color: 'var(--text-tertiary)', background: 'var(--bg-secondary)' }}>
                        No steps. Click "Add Step" to begin.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {form.flow_items.map((item, idx) => (
                          <div key={item.id || idx} className="flex gap-2 p-2.5 rounded-lg"
                            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                            <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-1"
                              style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}>
                              {idx + 1}
                            </div>
                            <div className="flex-1 space-y-1.5">
                              <textarea className="input text-sm py-1.5 resize-none"
                                rows={2}
                                placeholder={`Step ${idx + 1} description…`}
                                value={item.title}
                                onChange={(e) => updateFlowItem(idx, 'title', e.target.value)} />
                              <select className="input text-sm py-1.5" value={item.agent_id}
                                onChange={(e) => updateFlowItem(idx, 'agent_id', e.target.value)}>
                                <option value="">Assign agent…</option>
                                {agents.map((a) => <option key={a.id} value={a.id}>{a.avatar} {a.name}</option>)}
                              </select>
                            </div>
                            <button type="button" className="p-1 rounded hover:opacity-70 shrink-0"
                              style={{ color: 'var(--text-tertiary)' }} onClick={() => removeFlowItem(idx)}>
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {/* Dependencies */}
                <div className="pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                  <label className="label">Dependencies <span className="font-normal text-[10px]" style={{ color: 'var(--text-tertiary)' }}>(must be done before this task can start)</span></label>
                  {form.depends_on.length > 0 && (
                    <div className="space-y-1 mb-2">
                      {form.depends_on.map((depId) => {
                        const dep = (allTasks || []).find((t) => t.id === depId);
                        return (
                          <div key={depId} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs"
                            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                            <span className="w-1.5 h-1.5 rounded-full shrink-0"
                              style={{ background: dep?.status === 'done' ? '#40c057' : '#fa5252' }} />
                            <span className="flex-1 truncate" style={{ color: 'var(--text-primary)' }}>
                              {dep ? dep.title : depId}
                            </span>
                            <span className="text-[10px] capitalize px-1.5 py-0.5 rounded"
                              style={{
                                background: dep?.status === 'done' ? '#40c05720' : 'var(--bg-tertiary)',
                                color: dep?.status === 'done' ? '#40c057' : 'var(--text-tertiary)',
                              }}>
                              {dep?.status || 'unknown'}
                            </span>
                            <button type="button" className="p-0.5 rounded hover:opacity-70"
                              style={{ color: 'var(--text-tertiary)' }}
                              onClick={() => setForm((f) => ({ ...f, depends_on: f.depends_on.filter((id) => id !== depId) }))}>
                              <X size={12} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="relative">
                    <input
                      className="input text-sm"
                      placeholder="Search tasks to add as dependency..."
                      value={depSearch}
                      onChange={(e) => setDepSearch(e.target.value)}
                    />
                    {depSearch.trim() && (
                      <div className="absolute left-0 right-0 top-full mt-1 rounded-lg shadow-lg z-50 py-1 max-h-40 overflow-auto"
                        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                        {(allTasks || [])
                          .filter((t) => t.id !== task.id && !form.depends_on.includes(t.id) && t.title.toLowerCase().includes(depSearch.toLowerCase()))
                          .slice(0, 10)
                          .map((t) => (
                            <button key={t.id} type="button"
                              className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:opacity-80 transition-colors"
                              style={{ color: 'var(--text-primary)' }}
                              onClick={() => {
                                setForm((f) => ({ ...f, depends_on: [...f.depends_on, t.id] }));
                                setDepSearch('');
                              }}>
                              <span className="w-1.5 h-1.5 rounded-full shrink-0"
                                style={{ background: COLUMNS.find((c) => c.id === t.status)?.color || '#868e96' }} />
                              <span className="flex-1 truncate">{t.title}</span>
                              <span className="text-[10px] capitalize" style={{ color: 'var(--text-tertiary)' }}>{t.status}</span>
                            </button>
                          ))}
                        {(allTasks || []).filter((t) => t.id !== task.id && !form.depends_on.includes(t.id) && t.title.toLowerCase().includes(depSearch.toLowerCase())).length === 0 && (
                          <p className="px-3 py-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>No matching tasks found</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button className="btn btn-secondary text-xs" onClick={() => setEditing(false)}>Cancel</button>
                  <button className="btn btn-primary text-xs" onClick={saveChanges} disabled={saving}>
                    <Save size={13} /> {saving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {task.description
                  ? <div><p className="text-xs font-medium mb-1" style={{ color: 'var(--text-tertiary)' }}>Description</p>
                      <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>{task.description}</p></div>
                  : <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No description.</p>
                }
                {task.completion_output && (
                  <div>
                    <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-tertiary)' }}>Completion Output</p>
                    <div className="p-3 rounded-lg text-sm whitespace-pre-wrap" style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', borderLeft: '3px solid #40c057' }}>
                      {task.completion_output}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-4 p-3 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
                  <div>
                    <p className="text-[10px] font-semibold uppercase mb-0.5" style={{ color: 'var(--text-tertiary)' }}>Agent</p>
                    <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{task.agent_avatar} {task.agent_name || 'Unassigned'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase mb-0.5" style={{ color: 'var(--text-tertiary)' }}>Project</p>
                    <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{task.project_name || 'None'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase mb-0.5" style={{ color: 'var(--text-tertiary)' }}>Priority</p>
                    <p className="text-sm capitalize" style={{ color: 'var(--text-primary)' }}>{task.priority}</p>
                  </div>
                </div>
                {task.depends_on && task.depends_on.length > 0 && (
                  <div>
                    <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-tertiary)' }}>Dependencies</p>
                    <div className="space-y-1">
                      {task.depends_on.map((depId) => {
                        const dep = (allTasks || []).find((t) => t.id === depId);
                        const met = dep?.status === 'done';
                        return (
                          <div key={depId} className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
                            style={{ background: 'var(--bg-secondary)', border: `1px solid ${met ? '#40c05740' : '#fa525240'}` }}>
                            <span className="w-2 h-2 rounded-full shrink-0"
                              style={{ background: met ? '#40c057' : '#fa5252' }} />
                            <span className="flex-1" style={{ color: 'var(--text-primary)' }}>
                              {dep ? dep.title : depId}
                            </span>
                            <span className="text-[10px] capitalize px-1.5 py-0.5 rounded font-medium"
                              style={{
                                background: met ? '#40c05720' : '#fa525220',
                                color: met ? '#40c057' : '#fa5252',
                              }}>
                              {met ? 'done' : (dep?.status || 'unknown')}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {(task.task_type || 'single') === 'flow' && task.flow_items?.length > 0 && (
                  <div>
                    <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-tertiary)' }}>Flow Steps</p>
                    <div className="space-y-2">
                      {task.flow_items.map((item, idx) => {
                        const stepAgent = agents.find((a) => a.id === item.agent_id);
                        const statusColors = { pending: 'var(--text-tertiary)', doing: '#fab005', done: '#40c057', failed: 'var(--danger)' };
                        const statusIcons = { pending: '○', doing: '◆', done: '✓', failed: '✗' };
                        const sc = statusColors[item.status] || statusColors.pending;
                        return (
                          <div key={item.id || idx} className="p-3 rounded-lg"
                            style={{ background: 'var(--bg-secondary)', border: `1px solid ${item.status === 'doing' ? '#fab005' : 'var(--border)'}` }}>
                            <div className="flex items-start gap-3">
                              <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs shrink-0 mt-0.5 font-bold"
                                style={{ background: `${sc}20`, color: sc }}>
                                {statusIcons[item.status] || idx + 1}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{item.title || `Step ${idx + 1}`}</p>
                                {stepAgent && (
                                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                                    {stepAgent.avatar} {stepAgent.name}
                                  </p>
                                )}
                                {item.output && (
                                  <div className="mt-2 p-2 rounded text-xs whitespace-pre-wrap"
                                    style={{ background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', borderLeft: '2px solid #40c057' }}>
                                    {item.output}
                                  </div>
                                )}
                              </div>
                              <span className="text-[10px] capitalize px-1.5 py-0.5 rounded shrink-0"
                                style={{ background: `${sc}20`, color: sc }}>
                                {item.status || 'pending'}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {task.trigger_type && task.trigger_type !== 'manual' && (
                  <div className="flex items-center gap-2 p-3 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
                    <div className="flex items-center gap-1.5 font-medium text-xs"
                      style={{ color: task.trigger_type === 'cron' ? '#7c3aed' : '#4c6ef5' }}>
                      {task.trigger_type === 'cron' ? <RefreshCw size={13} /> : <Clock size={13} />}
                      <span>{task.trigger_type === 'cron' ? 'Cron' : 'Scheduled'}</span>
                    </div>
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                      {task.trigger_type === 'schedule' && task.trigger_at && new Date(task.trigger_at).toLocaleString()}
                      {task.trigger_type === 'cron' && task.trigger_cron}
                    </span>
                    {task.trigger_type === 'cron' && (
                      <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>· resets to To Do after each run</span>
                    )}
                  </div>
                )}
                <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Created: {new Date(task.created_at).toLocaleString()}
                  {task.completed_at && <> · Completed: {new Date(task.completed_at).toLocaleString()}</>}
                </div>
              </div>
            )
          ) : (
            <div className="flex flex-col gap-2" style={{ color: 'var(--text-secondary)' }}>
              {/* Filter Bar */}
              {task.execution_logs?.length > 0 && (
                <div className="space-y-2 pb-2 border-b" style={{ borderColor: 'var(--border)' }}>
                  {/* Search Input */}
                  <div className="relative">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
                    <input
                      className="input text-xs pl-8 py-1.5"
                      placeholder="Search logs..."
                      value={logSearchText}
                      onChange={(e) => setLogSearchText(e.target.value)}
                    />
                    {logSearchText && (
                      <button
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:opacity-70"
                        style={{ color: 'var(--text-tertiary)' }}
                        onClick={() => setLogSearchText('')}
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                  {/* Type Filter Chips */}
                  <div className="flex flex-wrap gap-1">
                    {LOG_TYPE_KEYS.map((type) => {
                      const cfg = LOG_TYPE_CONFIG[type];
                      const count = type === 'all' ? (task.execution_logs?.length || 0) : (logTypeCounts[type] || 0);
                      if (type !== 'all' && count === 0) return null;
                      const isActive = logTypeFilter === type;
                      return (
                        <button
                          key={type}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-all"
                          style={{
                            background: isActive ? cfg.color : 'var(--bg-secondary)',
                            color: isActive ? '#fff' : cfg.color,
                            border: `1px solid ${isActive ? cfg.color : 'var(--border)'}`,
                          }}
                          onClick={() => setLogTypeFilter(type)}
                        >
                          <span>{cfg.label}</span>
                          <span className="opacity-70">{count}</span>
                        </button>
                      );
                    })}
                  </div>
                  {/* Active filter summary */}
                  {(logTypeFilter !== 'all' || logSearchText) && (
                    <div className="flex items-center justify-between text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                      <span>
                        Showing {filteredLogs.length} of {task.execution_logs.length} entries
                        {logTypeFilter !== 'all' && <> ({LOG_TYPE_CONFIG[logTypeFilter]?.label})</>}
                        {logSearchText && <> matching "{logSearchText}"</>}
                      </span>
                      <button
                        className="hover:underline"
                        style={{ color: 'var(--accent)' }}
                        onClick={() => { setLogTypeFilter('all'); setLogSearchText(''); }}
                      >
                        Clear filters
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Log Entries */}
              <div className="space-y-0.5 font-mono text-xs">
                {(!task.execution_logs || task.execution_logs.length === 0) ? (
                  <div className="text-center py-12">
                    <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                      {isDoing ? 'Waiting for logs...' : 'No execution logs yet.'}
                    </p>
                    {isDoing && <div className="mt-3 flex justify-center gap-1">
                      {[0,1,2].map((i) => (
                        <div key={i} className="w-2 h-2 rounded-full animate-pulse-slow"
                          style={{ background: 'var(--accent)', animationDelay: `${i * 0.3}s` }} />
                      ))}
                    </div>}
                  </div>
                ) : filteredLogs.length === 0 ? (
                  <div className="text-center py-8">
                    <Filter size={20} className="mx-auto mb-2" style={{ color: 'var(--text-tertiary)', opacity: 0.5 }} />
                    <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      No logs match the current filters.
                    </p>
                  </div>
                ) : (
                  filteredLogs.map((log, i) => {
                    const cfg = LOG_TYPE_CONFIG[log.type] || LOG_TYPE_CONFIG.output;
                    return (
                      <div key={i} className="py-1.5 px-2 rounded animate-fade-in flex gap-2"
                        style={{ background: i % 2 === 0 ? 'transparent' : 'var(--bg-secondary)' }}>
                        <span className="shrink-0 w-16 text-right" style={{ color: 'var(--text-tertiary)' }}>
                          {new Date(log.timestamp).toLocaleTimeString('en-US', { hour12: false })}
                        </span>
                        <span className="shrink-0 rounded px-1 text-center text-[9px] font-bold" style={{
                          color: cfg.color,
                          background: cfg.bg,
                          minWidth: '16px',
                        }}>
                          {cfg.icon}
                        </span>
                        <span className="shrink-0 rounded px-1.5 py-0 text-[9px] uppercase font-semibold tracking-wide" style={{
                          color: cfg.color,
                          background: cfg.bg,
                        }}>
                          {log.type || 'log'}
                        </span>
                        <span className="flex-1 whitespace-pre-wrap break-all" style={{
                          color: cfg.color,
                        }}>
                          {log.content}
                        </span>
                      </div>
                    );
                  })
                )}
                <div ref={logsEndRef} />
                {isDoing && task.execution_logs?.length > 0 && (
                  <div className="flex items-center gap-2 py-2 px-2" style={{ color: 'var(--text-tertiary)' }}>
                    <div className="flex gap-0.5">
                      {[0,1,2].map((i) => (
                        <div key={i} className="w-1.5 h-1.5 rounded-full animate-pulse-slow"
                          style={{ background: '#fab005', animationDelay: `${i * 0.2}s` }} />
                      ))}
                    </div>
                    <span className="text-[10px]">Agent is working...</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const CRON_PRESETS = [
  { label: 'Every hour',        value: '0 * * * *' },
  { label: 'Every day at 9am',  value: '0 9 * * *' },
  { label: 'Every day at 6pm',  value: '0 18 * * *' },
  { label: 'Every Monday 9am',  value: '0 9 * * 1' },
  { label: 'Every weekday 9am', value: '0 9 * * 1-5' },
  { label: 'Custom…',           value: '__custom__' },
];

function TaskFormModal({ task, agents, projects, allTasks, defaultProjectId, onClose, onSaved }) {
  const [depSearch, setDepSearch] = useState('');
  const [form, setForm] = useState({
    title: task?.title || '',
    description: task?.description || '',
    status: task?.status || 'backlog',
    priority: task?.priority || 'medium',
    agent_id: task?.agent_id || '',
    project_id: task?.project_id || defaultProjectId || '',
    trigger_type: task?.trigger_type || 'manual',
    trigger_at: task?.trigger_at ? task.trigger_at.slice(0, 16) : '',
    trigger_cron: task?.trigger_cron || '',
    task_type: task?.task_type || 'single',
    flow_items: task?.flow_items || [],
    depends_on: task?.depends_on || [],
  });
  const [cronPreset, setCronPreset] = useState(() => {
    const match = CRON_PRESETS.find((p) => p.value === task?.trigger_cron && p.value !== '__custom__');
    return match ? match.value : (task?.trigger_cron ? '__custom__' : '0 9 * * *');
  });
  const [saving, setSaving] = useState(false);

  const addFlowItem = () => setForm((f) => ({
    ...f,
    flow_items: [...f.flow_items, { id: String(Date.now()), title: '', agent_id: '', status: 'pending', output: '' }],
  }));

  const removeFlowItem = (idx) => setForm((f) => ({
    ...f,
    flow_items: f.flow_items.filter((_, i) => i !== idx),
  }));

  const updateFlowItem = (idx, field, value) => setForm((f) => {
    const items = [...f.flow_items];
    items[idx] = { ...items[idx], [field]: value };
    return { ...f, flow_items: items };
  });

  const handleCronPreset = (val) => {
    setCronPreset(val);
    if (val !== '__custom__') setForm((f) => ({ ...f, trigger_cron: val }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data = {
        ...form,
        agent_id: form.agent_id || null,
        project_id: form.project_id || null,
        trigger_at: form.trigger_type === 'schedule' ? (form.trigger_at ? new Date(form.trigger_at).toISOString() : null) : null,
        trigger_cron: form.trigger_type === 'cron' ? form.trigger_cron : '',
        flow_items: form.task_type === 'flow' ? form.flow_items : [],
        depends_on: form.depends_on || [],
      };
      if (task) {
        await api.updateTask(task.id, data);
        toast.success('Task updated');
      } else {
        await api.createTask(data);
        toast.success('Task created');
      }
      onSaved();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const triggerIcons = { manual: <Play size={13} />, schedule: <Clock size={13} />, cron: <RefreshCw size={13} /> };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="card p-6 w-full max-w-lg max-h-[90vh] overflow-auto animate-fade-in" style={{ background: 'var(--bg-elevated)' }}>
        <h3 className="font-semibold text-lg mb-4" style={{ color: 'var(--text-primary)' }}>
          {task ? 'Edit Task' : 'New Task'}
        </h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Title</label>
            <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </div>
          <div>
            <label className="label">Description</label>
            <textarea className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
          </div>

          <div>
            <label className="label">Tags <span className="font-normal text-[10px]" style={{ color: 'var(--text-tertiary)' }}>(comma-separated)</span></label>
            <input className="input text-sm" value={form.tags || ''} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="bug, feature, urgent" />
          </div>

          {/* Task Type */}
          <div>
            <label className="label">Task Type</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'single', label: 'Single', desc: 'One agent handles the task', icon: <Play size={13} /> },
                { id: 'flow',   label: 'Flow',   desc: 'Sequential steps with different agents', icon: <Layers size={13} /> },
              ].map((t) => (
                <button key={t.id} type="button"
                  className="p-2.5 rounded-lg text-left transition-all"
                  style={{
                    background: form.task_type === t.id ? 'var(--accent-light)' : 'var(--bg-secondary)',
                    border: `1px solid ${form.task_type === t.id ? 'var(--accent)' : 'var(--border)'}`,
                  }}
                  onClick={() => {
                    const next = { ...form, task_type: t.id };
                    if (t.id === 'flow' && next.flow_items.length === 0) {
                      next.flow_items = [{ id: String(Date.now()), title: '', agent_id: '', status: 'pending', output: '' }];
                    }
                    setForm(next);
                  }}
                >
                  <div className="flex items-center gap-1.5 mb-0.5" style={{ color: form.task_type === t.id ? 'var(--accent)' : 'var(--text-secondary)' }}>
                    {t.icon}
                    <span className="text-xs font-semibold">{t.label}</span>
                  </div>
                  <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{t.desc}</p>
                </button>
              ))}
            </div>
            {form.task_type === 'flow' && (
              <div className="mt-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Flow Steps</span>
                  <button type="button" className="btn btn-ghost text-xs py-1 px-2" onClick={addFlowItem}>
                    <Plus size={11} /> Add Step
                  </button>
                </div>
                {form.flow_items.length === 0 ? (
                  <p className="text-xs text-center py-4 rounded-lg" style={{ color: 'var(--text-tertiary)', background: 'var(--bg-secondary)' }}>
                    No steps yet. Click "Add Step" to begin.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {form.flow_items.map((item, idx) => (
                      <div key={item.id || idx} className="flex gap-2 p-2.5 rounded-lg"
                        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                        <div className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-1"
                          style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}>
                          {idx + 1}
                        </div>
                        <div className="flex-1 space-y-1.5">
                          <textarea className="input text-sm py-1.5 resize-none"
                            rows={2}
                            placeholder={`Step ${idx + 1} description…`}
                            value={item.title}
                            onChange={(e) => updateFlowItem(idx, 'title', e.target.value)} />
                          <select className="input text-sm py-1.5" value={item.agent_id}
                            onChange={(e) => updateFlowItem(idx, 'agent_id', e.target.value)}>
                            <option value="">Assign agent…</option>
                            {agents.map((a) => <option key={a.id} value={a.id}>{a.avatar} {a.name}</option>)}
                          </select>
                        </div>
                        <button type="button" className="p-1 rounded hover:opacity-70 shrink-0"
                          style={{ color: 'var(--text-tertiary)' }} onClick={() => removeFlowItem(idx)}>
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Priority</label>
              <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                <option value="low">Low</option><option value="medium">Medium</option>
                <option value="high">High</option><option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className="label">Status</label>
              <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {COLUMNS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
          </div>
          {form.task_type !== 'flow' && (
            <div>
              <label className="label">Assign Agent</label>
              <select className="input" value={form.agent_id} onChange={(e) => setForm({ ...form, agent_id: e.target.value })}>
                <option value="">Unassigned</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.avatar} {a.name} — {a.role}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="label">Project</label>
            <select className="input" value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}>
              <option value="">No Project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          {/* Dependencies */}
          <div>
            <label className="label">Dependencies <span className="font-normal text-[10px]" style={{ color: 'var(--text-tertiary)' }}>(must be done before this task can start)</span></label>
            {form.depends_on.length > 0 && (
              <div className="space-y-1 mb-2">
                {form.depends_on.map((depId) => {
                  const dep = (allTasks || []).find((t) => t.id === depId);
                  return (
                    <div key={depId} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs"
                      style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
                      <span className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: dep?.status === 'done' ? '#40c057' : COLUMNS.find((c) => c.id === dep?.status)?.color || '#868e96' }} />
                      <span className="flex-1 truncate" style={{ color: 'var(--text-primary)' }}>
                        {dep ? dep.title : depId}
                      </span>
                      <span className="text-[10px] capitalize" style={{ color: 'var(--text-tertiary)' }}>{dep?.status || 'unknown'}</span>
                      <button type="button" className="p-0.5 rounded hover:opacity-70"
                        style={{ color: 'var(--text-tertiary)' }}
                        onClick={() => setForm((f) => ({ ...f, depends_on: f.depends_on.filter((id) => id !== depId) }))}>
                        <X size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="relative">
              <input
                className="input text-sm"
                placeholder="Search tasks to add as dependency..."
                value={depSearch}
                onChange={(e) => setDepSearch(e.target.value)}
              />
              {depSearch.trim() && (
                <div className="absolute left-0 right-0 top-full mt-1 rounded-lg shadow-lg z-50 py-1 max-h-40 overflow-auto"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                  {(allTasks || [])
                    .filter((t) => t.id !== task?.id && !form.depends_on.includes(t.id) && t.title.toLowerCase().includes(depSearch.toLowerCase()))
                    .slice(0, 10)
                    .map((t) => (
                      <button key={t.id} type="button"
                        className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:opacity-80 transition-colors"
                        style={{ color: 'var(--text-primary)' }}
                        onClick={() => {
                          setForm((f) => ({ ...f, depends_on: [...f.depends_on, t.id] }));
                          setDepSearch('');
                        }}>
                        <span className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ background: COLUMNS.find((c) => c.id === t.status)?.color || '#868e96' }} />
                        <span className="flex-1 truncate">{t.title}</span>
                        <span className="text-[10px] capitalize" style={{ color: 'var(--text-tertiary)' }}>{t.status}</span>
                      </button>
                    ))}
                  {(allTasks || []).filter((t) => t.id !== task?.id && !form.depends_on.includes(t.id) && t.title.toLowerCase().includes(depSearch.toLowerCase())).length === 0 && (
                    <p className="px-3 py-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>No matching tasks found</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Trigger */}
          <div className="pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
            <label className="label">Trigger</label>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {[
                { id: 'manual',   label: 'Manual',   desc: 'Drag to Doing' },
                { id: 'schedule', label: 'Schedule',  desc: 'Run once at time' },
                { id: 'cron',     label: 'Cron',      desc: 'Run periodically' },
              ].map((t) => (
                <button key={t.id} type="button"
                  className="p-2.5 rounded-lg text-left transition-all"
                  style={{
                    background: form.trigger_type === t.id ? 'var(--accent-light)' : 'var(--bg-secondary)',
                    border: `1px solid ${form.trigger_type === t.id ? 'var(--accent)' : 'var(--border)'}`,
                  }}
                  onClick={() => setForm({ ...form, trigger_type: t.id })}
                >
                  <div className="flex items-center gap-1.5 mb-0.5" style={{ color: form.trigger_type === t.id ? 'var(--accent)' : 'var(--text-secondary)' }}>
                    {triggerIcons[t.id]}
                    <span className="text-xs font-semibold">{t.label}</span>
                  </div>
                  <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{t.desc}</p>
                </button>
              ))}
            </div>

            {form.trigger_type === 'schedule' && (
              <div>
                <label className="label">Run at</label>
                <input
                  type="datetime-local"
                  className="input"
                  value={form.trigger_at}
                  onChange={(e) => setForm({ ...form, trigger_at: e.target.value })}
                  required
                />
              </div>
            )}

            {form.trigger_type === 'cron' && (
              <div className="space-y-2">
                <label className="label">Schedule</label>
                <select className="input" value={cronPreset} onChange={(e) => handleCronPreset(e.target.value)}>
                  {CRON_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
                {cronPreset === '__custom__' && (
                  <input
                    className="input font-mono text-sm"
                    placeholder="e.g. 0 9 * * 1-5"
                    value={form.trigger_cron}
                    onChange={(e) => setForm({ ...form, trigger_cron: e.target.value })}
                  />
                )}
                {form.trigger_cron && (
                  <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                    Expression: <code className="font-mono">{form.trigger_cron}</code> · Task moves back to To Do after each run
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : task ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
