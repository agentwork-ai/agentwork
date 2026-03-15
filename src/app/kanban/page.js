'use client';

import { useEffect, useState, useCallback } from 'react';
import Sidebar from '@/components/Sidebar';
import BottomBar from '@/components/BottomBar';
import { api } from '@/lib/api';
import { useSocket } from '@/app/providers';
import {
  Plus, X, GripVertical, Clock, User, FolderOpen,
  AlertTriangle, CheckCircle2, ChevronDown, Play, Eye,
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
  const [showForm, setShowForm] = useState(false);
  const [editTask, setEditTask] = useState(null);
  const [viewTask, setViewTask] = useState(null);
  const [dragTask, setDragTask] = useState(null);

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
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...task, execution_logs: task.execution_logs || [] } : t)));
      if (viewTask?.id === task.id) setViewTask({ ...task, execution_logs: task.execution_logs || [] });
    };
    const onTaskCreated = (task) => setTasks((prev) => [task, ...prev]);
    const onTaskDeleted = ({ id }) => setTasks((prev) => prev.filter((t) => t.id !== id));
    const onTaskLog = ({ taskId, log }) => {
      setTasks((prev) => prev.map((t) => {
        if (t.id !== taskId) return t;
        return { ...t, execution_logs: [...(t.execution_logs || []), log] };
      }));
      if (viewTask?.id === taskId) {
        setViewTask((prev) => prev ? { ...prev, execution_logs: [...(prev.execution_logs || []), log] } : prev);
      }
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
  }, [socket, viewTask]);

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
    if (dragTask && dragTask.status !== columnId) {
      moveTask(dragTask.id, columnId);
    }
    setDragTask(null);
  };

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <div className="flex items-center justify-between px-6 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <h1 className="font-semibold text-lg" style={{ color: 'var(--text-primary)' }}>Task Board</h1>
          <button className="btn btn-primary text-sm" onClick={() => { setShowForm(true); setEditTask(null); }}>
            <Plus size={16} /> New Task
          </button>
        </div>

        <main className="flex-1 overflow-x-auto overflow-y-hidden p-4" style={{ background: 'var(--bg-primary)' }}>
          <div className="flex gap-4 h-full min-w-max">
            {COLUMNS.map((col) => {
              const colTasks = tasks.filter((t) => t.status === col.id);
              return (
                <div
                  key={col.id}
                  className="w-72 flex flex-col rounded-xl shrink-0"
                  style={{ background: 'var(--bg-secondary)' }}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, col.id)}
                >
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: col.color }} />
                    <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{col.label}</span>
                    <span className="text-xs ml-auto px-1.5 py-0.5 rounded-md" style={{ background: 'var(--bg-tertiary)', color: 'var(--text-tertiary)' }}>
                      {colTasks.length}
                    </span>
                  </div>
                  <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">
                    {colTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        onDragStart={(e) => handleDragStart(e, task)}
                        onView={() => setViewTask(task)}
                        onEdit={() => { setEditTask(task); setShowForm(true); }}
                        onDelete={() => deleteTask(task.id)}
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
          onClose={() => { setShowForm(false); setEditTask(null); }}
          onSaved={() => { setShowForm(false); setEditTask(null); loadData(); }}
        />
      )}

      {viewTask && (
        <TaskDetailModal task={viewTask} onClose={() => setViewTask(null)} />
      )}
    </div>
  );
}

function TaskCard({ task, onDragStart, onView, onEdit, onDelete }) {
  const priorityColors = { low: '#868e96', medium: '#fab005', high: '#fa5252', critical: '#e03131' };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="card p-3 cursor-grab active:cursor-grabbing animate-fade-in group"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium flex-1" style={{ color: 'var(--text-primary)' }}>{task.title}</p>
        <div className="hidden group-hover:flex gap-1 shrink-0">
          <button onClick={onView} className="p-1 rounded hover:opacity-70"><Eye size={13} style={{ color: 'var(--text-tertiary)' }} /></button>
        </div>
      </div>
      {task.description && (
        <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--text-tertiary)' }}>{task.description}</p>
      )}
      <div className="flex items-center gap-2 mt-2.5">
        <div className="w-1.5 h-1.5 rounded-full" style={{ background: priorityColors[task.priority] || priorityColors.medium }} />
        <span className="text-[10px] uppercase font-semibold" style={{ color: 'var(--text-tertiary)' }}>{task.priority}</span>
        {task.agent_name && (
          <span className="text-[10px] ml-auto flex items-center gap-1" style={{ color: 'var(--text-tertiary)' }}>
            <span>{task.agent_avatar}</span> {task.agent_name}
          </span>
        )}
      </div>
    </div>
  );
}

function TaskDetailModal({ task, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="card w-full max-w-2xl max-h-[80vh] flex flex-col animate-fade-in" style={{ background: 'var(--bg-elevated)' }}>
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>{task.title}</h3>
          <button onClick={onClose} className="p-1 rounded" style={{ color: 'var(--text-tertiary)' }}><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {task.description && (
            <div>
              <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-tertiary)' }}>Description</p>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{task.description}</p>
            </div>
          )}
          <div className="flex gap-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            <span>Agent: {task.agent_name || 'Unassigned'}</span>
            <span>Project: {task.project_name || 'None'}</span>
            <span>Priority: {task.priority}</span>
          </div>

          <div>
            <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-tertiary)' }}>Execution Logs</p>
            <div className="space-y-1 max-h-96 overflow-auto rounded-lg p-3" style={{ background: 'var(--bg-secondary)' }}>
              {(!task.execution_logs || task.execution_logs.length === 0) ? (
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>No logs yet.</p>
              ) : (
                task.execution_logs.map((log, i) => (
                  <div key={i} className="text-xs font-mono py-1 border-b" style={{ borderColor: 'var(--border-light)' }}>
                    <span style={{ color: 'var(--text-tertiary)' }}>[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                    <span className="ml-2" style={{
                      color: log.type === 'error' ? 'var(--danger)' : log.type === 'success' ? 'var(--success)' :
                        log.type === 'command' ? 'var(--accent)' : log.type === 'warning' ? 'var(--warning)' : 'var(--text-secondary)',
                    }}>
                      {log.content}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TaskFormModal({ task, agents, projects, onClose, onSaved }) {
  const [form, setForm] = useState({
    title: task?.title || '',
    description: task?.description || '',
    status: task?.status || 'backlog',
    priority: task?.priority || 'medium',
    agent_id: task?.agent_id || '',
    project_id: task?.project_id || '',
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
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
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
