'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Sidebar from '@/components/Sidebar';
import BottomBar from '@/components/BottomBar';
import { api } from '@/lib/api';
import { useSocket } from '@/app/providers';
import {
  Plus, X, FolderOpen, Edit2, Trash2, Save,
  Layers, ChevronRight,
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
  const [quickAddCol, setQuickAddCol] = useState(null); // column id with inline add open
  const [quickAddTitle, setQuickAddTitle] = useState('');
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
    const onTaskUpdated = (task) => {
      const parsed = { ...task, execution_logs: task.execution_logs || [], attachments: task.attachments || [] };
      setTasks((prev) => prev.map((t) => (t.id === parsed.id ? parsed : t)));
      setViewTask((prev) => prev?.id === parsed.id ? parsed : prev);
    };
    const onTaskCreated = (task) => setTasks((prev) => [{ ...task, execution_logs: task.execution_logs || [] }, ...prev]);
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
    socket.on('task:updated', onTaskUpdated);
    socket.on('task:created', onTaskCreated);
    socket.on('task:deleted', onTaskDeleted);
    socket.on('task:log', onTaskLog);
    return () => {
      socket.off('task:updated', onTaskUpdated);
      socket.off('task:created', onTaskCreated);
      socket.off('task:deleted', onTaskDeleted);
      socket.off('task:log', onTaskLog);
    };
  }, [socket]);

  const moveTask = async (taskId, newStatus) => {
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
    setQuickAddCol(colId);
  };

  const submitQuickAdd = async () => {
    const title = quickAddTitle.trim();
    if (!title) { setQuickAddCol(null); return; }
    try {
      await api.createTask({
        title,
        status: quickAddCol,
        priority: 'medium',
        project_id: selectedProjectId || null,
      });
    } catch (err) {
      toast.error(err.message);
    }
    setQuickAddCol(null);
    setQuickAddTitle('');
  };

  const onQuickAddKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitQuickAdd(); }
    else if (e.key === 'Escape') { setQuickAddCol(null); setQuickAddTitle(''); }
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
                      <div className="rounded-lg p-2" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--accent)' }}>
                        <input
                          ref={quickAddRef}
                          className="w-full bg-transparent text-sm outline-none"
                          style={{ color: 'var(--text-primary)' }}
                          placeholder="Task title…"
                          value={quickAddTitle}
                          onChange={(e) => setQuickAddTitle(e.target.value)}
                          onKeyDown={onQuickAddKey}
                          onBlur={submitQuickAdd}
                        />
                      </div>
                    )}
                    {colTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        agents={agents}
                        projects={projects}
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

function TaskCard({ task, projects, agents, showProject, onDragStart, onClick, onPriorityChange, onAgentChange, onProjectChange }) {
  const isDoing = task.status === 'doing';
  const [openDropdown, setOpenDropdown] = useState(null); // 'agent' | 'project' | null

  const cyclePriority = (e) => {
    e.stopPropagation();
    const next = PRIORITIES[(PRIORITIES.indexOf(task.priority) + 1) % PRIORITIES.length];
    onPriorityChange(task.id, next);
  };

  const toggleDropdown = (e, name) => {
    e.stopPropagation();
    setOpenDropdown((prev) => (prev === name ? null : name));
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

  return (
    <div
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
      </div>
      {task.description && (
        <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--text-tertiary)' }}>{task.description}</p>
      )}
      <div className="flex items-center gap-2 mt-2.5 flex-wrap">
        {/* Priority */}
        <button
          onClick={cyclePriority}
          className="flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:opacity-80"
          style={{ background: `${PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.medium}20` }}
          title="Click to change priority"
        >
          <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.medium }} />
          <span className="text-[10px] uppercase font-semibold" style={{ color: PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.medium }}>{task.priority}</span>
        </button>

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

function TaskDetailModal({ task, agents, projects, onClose, onUpdate, onDelete }) {
  const logsEndRef = useRef(null);
  const isEditable = task.status === 'backlog' || task.status === 'todo';
  const isDoing = task.status === 'doing';
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    title: task.title,
    description: task.description,
    priority: task.priority,
    agent_id: task.agent_id || '',
    project_id: task.project_id || '',
  });
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState(isDoing ? 'logs' : 'details');

  useEffect(() => {
    if (activeTab === 'logs') logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [task.execution_logs?.length, activeTab]);

  useEffect(() => {
    setForm({ title: task.title, description: task.description, priority: task.priority, agent_id: task.agent_id || '', project_id: task.project_id || '' });
  }, [task]);

  const saveChanges = async () => {
    setSaving(true);
    try {
      const data = { ...form, agent_id: form.agent_id || null, project_id: form.project_id || null };
      const updated = await api.updateTask(task.id, data);
      onUpdate(updated);
      setEditing(false);
      toast.success('Task updated');
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
                  <textarea className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={4} />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="label">Priority</label>
                    <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                      <option value="low">Low</option><option value="medium">Medium</option>
                      <option value="high">High</option><option value="critical">Critical</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Agent</label>
                    <select className="input" value={form.agent_id} onChange={(e) => setForm({ ...form, agent_id: e.target.value })}>
                      <option value="">Unassigned</option>
                      {agents.map((a) => <option key={a.id} value={a.id}>{a.avatar} {a.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Project</label>
                    <select className="input" value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}>
                      <option value="">None</option>
                      {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
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
                <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Created: {new Date(task.created_at).toLocaleString()}
                  {task.completed_at && <> · Completed: {new Date(task.completed_at).toLocaleString()}</>}
                </div>
              </div>
            )
          ) : (
            <div className="space-y-0.5 font-mono text-xs" style={{ color: 'var(--text-secondary)' }}>
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
              ) : (
                task.execution_logs.map((log, i) => (
                  <div key={i} className="py-1.5 px-2 rounded animate-fade-in flex gap-2"
                    style={{ background: i % 2 === 0 ? 'transparent' : 'var(--bg-secondary)' }}>
                    <span className="shrink-0 w-16 text-right" style={{ color: 'var(--text-tertiary)' }}>
                      {new Date(log.timestamp).toLocaleTimeString('en-US', { hour12: false })}
                    </span>
                    <span className="shrink-0 w-3 text-center" style={{
                      color: log.type === 'error' ? 'var(--danger)' : log.type === 'success' ? 'var(--success)' :
                        log.type === 'command' ? '#20c997' : log.type === 'warning' ? 'var(--warning)' :
                        log.type === 'thinking' ? 'var(--accent)' : 'var(--text-secondary)',
                    }}>
                      {log.type === 'error' ? '✗' : log.type === 'success' ? '✓' :
                       log.type === 'command' ? '$' : log.type === 'warning' ? '!' :
                       log.type === 'thinking' ? '◆' : '·'}
                    </span>
                    <span className="flex-1 whitespace-pre-wrap break-all" style={{
                      color: log.type === 'error' ? 'var(--danger)' : log.type === 'success' ? 'var(--success)' :
                        log.type === 'command' ? '#20c997' : log.type === 'warning' ? 'var(--warning)' :
                        log.type === 'thinking' ? 'var(--accent)' : 'var(--text-secondary)',
                    }}>
                      {log.content}
                    </span>
                  </div>
                ))
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
          )}
        </div>
      </div>
    </div>
  );
}

function TaskFormModal({ task, agents, projects, defaultProjectId, onClose, onSaved }) {
  const [form, setForm] = useState({
    title: task?.title || '',
    description: task?.description || '',
    status: task?.status || 'backlog',
    priority: task?.priority || 'medium',
    agent_id: task?.agent_id || '',
    project_id: task?.project_id || defaultProjectId || '',
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data = { ...form, agent_id: form.agent_id || null, project_id: form.project_id || null };
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="card p-6 w-full max-w-md animate-fade-in" style={{ background: 'var(--bg-elevated)' }}>
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
          <div>
            <label className="label">Assign Agent</label>
            <select className="input" value={form.agent_id} onChange={(e) => setForm({ ...form, agent_id: e.target.value })}>
              <option value="">Unassigned</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.avatar} {a.name} — {a.role}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Project</label>
            <select className="input" value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })}>
              <option value="">No Project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
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
