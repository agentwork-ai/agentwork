'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import Sidebar from '../../components/Sidebar';
import BottomBar from '../../components/BottomBar';
import MarkdownContent from '../../components/MarkdownContent';
import { api } from '../../lib/api';
import { useSocket } from '../providers';
import {
  Plus,
  FolderOpen,
  Users,
  Play,
  CheckSquare,
  Trash2,
  Pencil,
  Presentation,
  Sparkles,
  Clock3,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  FilePlus2,
  X,
  Bot,
  User,
} from 'lucide-react';

const DEFAULT_MEETING_MODES = [
  {
    id: 'rapid',
    label: 'Rapid Alignment',
    rounds: 1,
    discussionStyle: 'Fast first-pass scoping with a lean task breakdown.',
  },
  {
    id: 'working',
    label: 'Working Session',
    rounds: 2,
    discussionStyle: 'Balanced discussion focused on practical scope, approach, and sequencing.',
  },
  {
    id: 'deep',
    label: 'Deep Dive',
    rounds: 3,
    discussionStyle: 'Thorough discussion with stronger risk analysis and sharper task decomposition.',
  },
];

const STATUS_META = {
  draft: { label: 'Draft', color: '#868e96', bg: '#868e9620', Icon: Clock3 },
  running: { label: 'Running', color: '#4c6ef5', bg: '#4c6ef520', Icon: Loader2 },
  awaiting_confirmation: { label: 'Awaiting Approval', color: '#f08c00', bg: '#ff922b20', Icon: AlertTriangle },
  completed: { label: 'Completed', color: '#2f9e44', bg: '#2f9e4420', Icon: CheckCircle2 },
  failed: { label: 'Failed', color: '#e03131', bg: '#e0313120', Icon: AlertTriangle },
};

function getStatusMeta(status) {
  return STATUS_META[status] || STATUS_META.draft;
}

function emptyMeetingForm(projectId = '') {
  return {
    project_id: projectId,
    topic: '',
    goal: '',
    agent_ids: [],
    mode: 'working',
    auto_apply_tasks: false,
  };
}

function formatTimestamp(value) {
  if (!value) return 'Not started';
  return new Date(value).toLocaleString();
}

function MeetingStatusBadge({ status }) {
  const meta = getStatusMeta(status);
  const Icon = meta.Icon;

  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full"
      style={{ color: meta.color, background: meta.bg }}
    >
      <Icon size={12} className={status === 'running' ? 'animate-spin' : ''} />
      {meta.label}
    </span>
  );
}

function MeetingFormModal({ agents, projects, modes, form, setForm, mode, onClose, onSubmit }) {
  useEffect(() => {
    const onModalClose = () => onClose();
    window.addEventListener('modal:close', onModalClose);
    return () => window.removeEventListener('modal:close', onModalClose);
  }, [onClose]);

  const toggleAgent = (agentId) => {
    setForm((current) => ({
      ...current,
      agent_ids: current.agent_ids.includes(agentId)
        ? current.agent_ids.filter((id) => id !== agentId)
        : [...current.agent_ids, agentId],
    }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0, 0, 0, 0.45)' }}>
      <div className="w-full max-w-3xl rounded-2xl border overflow-hidden" style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {mode === 'edit' ? 'Edit Meeting Draft' : 'New Meeting'}
            </h2>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Invite the right agents, define the topic, and they will work out the task plan without you in the discussion loop.
            </p>
          </div>
          <button className="p-2 rounded-lg" onClick={onClose} style={{ color: 'var(--text-tertiary)' }}>
            <X size={16} />
          </button>
        </div>

        <div className="p-5 grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-5 max-h-[80vh] overflow-auto">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Project</label>
              <select
                className="input w-full"
                value={form.project_id}
                onChange={(e) => setForm((current) => ({ ...current, project_id: e.target.value }))}
              >
                <option value="">Select project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Topic</label>
              <input
                className="input w-full"
                value={form.topic}
                onChange={(e) => setForm((current) => ({ ...current, topic: e.target.value }))}
                placeholder="Create login functionality"
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Goal <span style={{ color: 'var(--text-tertiary)' }}>(Optional)</span></label>
              <textarea
                className="input w-full resize-none"
                rows={4}
                value={form.goal}
                onChange={(e) => setForm((current) => ({ ...current, goal: e.target.value }))}
                placeholder="Clarify scope, identify technical constraints, and produce a board-ready task list."
              />
            </div>

            <label className="flex items-start gap-3 p-4 rounded-xl border cursor-pointer" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
              <input
                type="checkbox"
                className="mt-1"
                checked={form.auto_apply_tasks}
                onChange={(e) => setForm((current) => ({ ...current, auto_apply_tasks: e.target.checked }))}
              />
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Auto-add tasks to the project board</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                  If off, the meeting will stop at a task proposal list and wait for your confirmation before anything is added to the project.
                </p>
              </div>
            </label>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Discussion Depth</label>
              <div className="space-y-2">
                {modes.map((entry) => (
                  <label
                    key={entry.id}
                    className="flex items-start gap-3 p-3 rounded-xl border cursor-pointer"
                    style={{
                      borderColor: form.mode === entry.id ? 'var(--accent)' : 'var(--border)',
                      background: form.mode === entry.id ? 'var(--accent-light)' : 'var(--bg-secondary)',
                    }}
                  >
                    <input
                      type="radio"
                      checked={form.mode === entry.id}
                      onChange={() => setForm((current) => ({ ...current, mode: entry.id }))}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{entry.label}</p>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ color: 'var(--text-tertiary)', background: 'var(--bg-primary)' }}>
                          {entry.rounds} round{entry.rounds === 1 ? '' : 's'}
                        </span>
                      </div>
                      <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                        {entry.discussionStyle}
                      </p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Participants</label>
                <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                  Recommended: PM / CEO / PM / BA + Tech Lead
                </span>
              </div>
              <div className="max-h-72 overflow-auto space-y-2">
                {agents.map((agent) => (
                  <label
                    key={agent.id}
                    className="flex items-center gap-3 p-3 rounded-xl border cursor-pointer"
                    style={{
                      borderColor: form.agent_ids.includes(agent.id) ? 'var(--accent)' : 'var(--border)',
                      background: form.agent_ids.includes(agent.id) ? 'var(--accent-light)' : 'var(--bg-secondary)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={form.agent_ids.includes(agent.id)}
                      onChange={() => toggleAgent(agent.id)}
                    />
                    <span className="text-lg">{agent.avatar}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{agent.name}</p>
                      <p className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>{agent.role}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t" style={{ borderColor: 'var(--border)' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={onSubmit}
            disabled={!form.project_id || !form.topic.trim() || form.agent_ids.length === 0}
          >
            {mode === 'edit' ? 'Save Draft' : 'Create Draft'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MeetingsPage() {
  const socket = useSocket();
  const [projects, setProjects] = useState([]);
  const [agents, setAgents] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [meetingModes, setMeetingModes] = useState(DEFAULT_MEETING_MODES);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [selectedMeetingId, setSelectedMeetingId] = useState(null);
  const [selectedMeeting, setSelectedMeeting] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [formMode, setFormMode] = useState(null);
  const [meetingForm, setMeetingForm] = useState(emptyMeetingForm());

  const selectedProject = projects.find((project) => project.id === selectedProjectId) || null;
  const projectMeetings = useMemo(
    () => meetings.filter((meeting) => !selectedProjectId || meeting.project_id === selectedProjectId),
    [meetings, selectedProjectId],
  );

  const loadBaseData = useCallback(async () => {
    try {
      const [projectData, agentData, meetingData, modeData] = await Promise.all([
        api.getProjects(),
        api.getAgents(),
        api.getMeetings(),
        api.getMeetingModes().catch(() => DEFAULT_MEETING_MODES),
      ]);
      setProjects(projectData);
      setAgents(agentData);
      setMeetings(meetingData);
      setMeetingModes(Array.isArray(modeData) && modeData.length ? modeData : DEFAULT_MEETING_MODES);
    } catch (err) {
      toast.error(err.message || 'Failed to load meetings');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMeetingDetail = useCallback(async (meetingId) => {
    if (!meetingId) {
      setSelectedMeeting(null);
      return;
    }
    setDetailLoading(true);
    try {
      const detail = await api.getMeeting(meetingId);
      setSelectedMeeting(detail);
    } catch (err) {
      setSelectedMeeting(null);
      toast.error(err.message || 'Failed to load meeting');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBaseData();
  }, [loadBaseData]);

  useEffect(() => {
    if (!selectedProjectId && projects.length > 0) {
      setSelectedProjectId(projects[0].id);
    }
    if (selectedProjectId && projects.every((project) => project.id !== selectedProjectId)) {
      setSelectedProjectId(projects[0]?.id || null);
    }
  }, [projects, selectedProjectId]);

  useEffect(() => {
    if (projectMeetings.length === 0) {
      setSelectedMeetingId(null);
      setSelectedMeeting(null);
      return;
    }

    if (!selectedMeetingId || !projectMeetings.some((meeting) => meeting.id === selectedMeetingId)) {
      setSelectedMeetingId(projectMeetings[0].id);
    }
  }, [projectMeetings, selectedMeetingId]);

  useEffect(() => {
    if (selectedMeetingId) {
      loadMeetingDetail(selectedMeetingId);
    }
  }, [selectedMeetingId, loadMeetingDetail]);

  useEffect(() => {
    if (!socket) return;

    const onProjectCreated = () => loadBaseData();
    const onProjectUpdated = () => loadBaseData();
    const onProjectDeleted = ({ id }) => {
      setProjects((current) => current.filter((project) => project.id !== id));
      setMeetings((current) => current.filter((meeting) => meeting.project_id !== id));
      if (selectedProjectId === id) {
        setSelectedProjectId(null);
      }
    };

    const onMeetingCreated = (meeting) => {
      setMeetings((current) => [meeting, ...current.filter((item) => item.id !== meeting.id)]);
    };

    const onMeetingUpdated = (meeting) => {
      setMeetings((current) => current.map((item) => (item.id === meeting.id ? { ...item, ...meeting } : item)));
      setSelectedMeeting((current) => (current?.id === meeting.id ? { ...current, ...meeting } : current));
      if (selectedMeetingId === meeting.id && meeting.status !== 'running') {
        loadMeetingDetail(meeting.id);
      }
    };

    const onMeetingDeleted = ({ id }) => {
      setMeetings((current) => current.filter((meeting) => meeting.id !== id));
      if (selectedMeetingId === id) {
        setSelectedMeetingId(null);
        setSelectedMeeting(null);
      }
    };

    const onMeetingMessage = ({ meetingId, message }) => {
      if (selectedMeetingId !== meetingId) return;
      setSelectedMeeting((current) => {
        if (!current || current.id !== meetingId) return current;
        if (current.messages?.some((item) => item.id === message.id)) return current;
        return {
          ...current,
          messages: [...(current.messages || []), message],
        };
      });
    };

    socket.on('project:created', onProjectCreated);
    socket.on('project:updated', onProjectUpdated);
    socket.on('project:deleted', onProjectDeleted);
    socket.on('meeting:created', onMeetingCreated);
    socket.on('meeting:updated', onMeetingUpdated);
    socket.on('meeting:deleted', onMeetingDeleted);
    socket.on('meeting:message', onMeetingMessage);

    return () => {
      socket.off('project:created', onProjectCreated);
      socket.off('project:updated', onProjectUpdated);
      socket.off('project:deleted', onProjectDeleted);
      socket.off('meeting:created', onMeetingCreated);
      socket.off('meeting:updated', onMeetingUpdated);
      socket.off('meeting:deleted', onMeetingDeleted);
      socket.off('meeting:message', onMeetingMessage);
    };
  }, [socket, loadBaseData, loadMeetingDetail, selectedMeetingId, selectedProjectId]);

  const openCreateModal = () => {
    const defaultProjectId = selectedProjectId || projects[0]?.id || '';
    setMeetingForm(emptyMeetingForm(defaultProjectId));
    setFormMode('create');
  };

  const openEditModal = () => {
    if (!selectedMeeting) return;
    setMeetingForm({
      project_id: selectedMeeting.project_id,
      topic: selectedMeeting.topic,
      goal: selectedMeeting.goal || '',
      agent_ids: selectedMeeting.agent_ids || [],
      mode: selectedMeeting.mode || 'working',
      auto_apply_tasks: Boolean(selectedMeeting.auto_apply_tasks),
    });
    setFormMode('edit');
  };

  const saveMeetingDraft = async () => {
    try {
      if (formMode === 'edit' && selectedMeeting) {
        const updated = await api.updateMeeting(selectedMeeting.id, meetingForm);
        setMeetings((current) => current.map((meeting) => (meeting.id === updated.id ? updated : meeting)));
        setSelectedMeetingId(updated.id);
        await loadMeetingDetail(updated.id);
        toast.success('Meeting draft updated');
      } else {
        const created = await api.createMeeting(meetingForm);
        setMeetings((current) => [created, ...current.filter((meeting) => meeting.id !== created.id)]);
        setSelectedProjectId(created.project_id);
        setSelectedMeetingId(created.id);
        await loadMeetingDetail(created.id);
        toast.success('Meeting draft created');
      }
      setFormMode(null);
    } catch (err) {
      toast.error(err.message || 'Failed to save meeting draft');
    }
  };

  const startMeetingRun = async () => {
    if (!selectedMeeting) return;
    try {
      const detail = await api.startMeeting(selectedMeeting.id);
      setSelectedMeeting(detail);
      setMeetings((current) => current.map((meeting) => (meeting.id === detail.id ? { ...meeting, ...detail } : meeting)));
      toast.success('Meeting started');
    } catch (err) {
      toast.error(err.message || 'Failed to start meeting');
    }
  };

  const applyTasks = async () => {
    if (!selectedMeeting) return;
    try {
      const detail = await api.applyMeetingTasks(selectedMeeting.id);
      setSelectedMeeting(detail);
      setMeetings((current) => current.map((meeting) => (meeting.id === detail.id ? { ...meeting, ...detail } : meeting)));
      toast.success('Tasks added to the project board');
    } catch (err) {
      toast.error(err.message || 'Failed to add tasks');
    }
  };

  const deleteMeeting = async () => {
    if (!selectedMeeting) return;
    if (!window.confirm(`Delete meeting "${selectedMeeting.topic}"?`)) return;
    try {
      await api.deleteMeeting(selectedMeeting.id);
      setMeetings((current) => current.filter((meeting) => meeting.id !== selectedMeeting.id));
      setSelectedMeetingId(null);
      setSelectedMeeting(null);
      toast.success('Meeting deleted');
    } catch (err) {
      toast.error(err.message || 'Failed to delete meeting');
    }
  };

  const projectMeetingCount = (projectId) => meetings.filter((meeting) => meeting.project_id === projectId).length;

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <main className="flex-1 overflow-hidden flex" style={{ background: 'var(--bg-primary)' }}>
          <div className="w-72 border-r flex flex-col shrink-0" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
            <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
              <h2 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Projects</h2>
              <button className="btn btn-primary text-xs py-1.5 px-3" onClick={openCreateModal} disabled={projects.length === 0}>
                <Plus size={14} />
                New
              </button>
            </div>

            <div className="flex-1 overflow-auto p-2 space-y-1">
              {loading ? (
                <p className="text-center text-sm py-8" style={{ color: 'var(--text-tertiary)' }}>Loading...</p>
              ) : projects.length === 0 ? (
                <p className="text-center text-sm py-8" style={{ color: 'var(--text-tertiary)' }}>
                  Add a project first, then you can run planning meetings against it.
                </p>
              ) : (
                projects.map((project) => (
                  <button
                    key={project.id}
                    className="w-full flex items-center gap-3 p-3 rounded-xl text-left transition-colors"
                    style={{
                      background: selectedProjectId === project.id ? 'var(--accent-light)' : 'transparent',
                    }}
                    onClick={() => setSelectedProjectId(project.id)}
                  >
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--bg-primary)', color: 'var(--accent)' }}>
                      <FolderOpen size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{project.name}</p>
                      <p className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
                        {projectMeetingCount(project.id)} meeting{projectMeetingCount(project.id) === 1 ? '' : 's'}
                      </p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="w-80 border-r flex flex-col shrink-0" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
            <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Meetings</h2>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                    {selectedProject ? selectedProject.name : 'Select a project'}
                  </p>
                </div>
                <button className="btn btn-primary text-xs py-1.5 px-3" onClick={openCreateModal} disabled={!selectedProject}>
                  <Plus size={14} />
                  Draft
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-2 space-y-2">
              {!selectedProject ? (
                <p className="text-center text-sm py-8" style={{ color: 'var(--text-tertiary)' }}>
                  Pick a project to see its meetings.
                </p>
              ) : projectMeetings.length === 0 ? (
                <div className="text-center py-12 px-4">
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>
                    <Presentation size={20} />
                  </div>
                  <p className="text-sm" style={{ color: 'var(--text-primary)' }}>No meetings for this project yet</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                    Draft a meeting, invite the right agents, and let them work out the scope and task list.
                  </p>
                </div>
              ) : (
                projectMeetings.map((meeting) => {
                  const statusMeta = getStatusMeta(meeting.status);
                  return (
                    <button
                      key={meeting.id}
                      className="w-full text-left p-3 rounded-xl border transition-colors"
                      style={{
                        borderColor: selectedMeetingId === meeting.id ? 'var(--accent)' : 'var(--border)',
                        background: selectedMeetingId === meeting.id ? 'var(--accent-light)' : 'transparent',
                      }}
                      onClick={() => setSelectedMeetingId(meeting.id)}
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: statusMeta.bg, color: statusMeta.color }}>
                          <Presentation size={18} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium line-clamp-2" style={{ color: 'var(--text-primary)' }}>{meeting.topic}</p>
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            <MeetingStatusBadge status={meeting.status} />
                            <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                              {(meeting.agent_ids || []).length} agent{(meeting.agent_ids || []).length === 1 ? '' : 's'}
                            </span>
                            <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                              {(meetingModes.find((entry) => entry.id === meeting.mode)?.label) || meeting.mode}
                            </span>
                          </div>
                          <p className="text-[11px] mt-2 truncate" style={{ color: 'var(--text-tertiary)' }}>
                            Updated {formatTimestamp(meeting.updated_at)}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="flex-1 flex flex-col min-w-0">
            {selectedMeeting ? (
              <>
                <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}>
                      <Sparkles size={22} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{selectedMeeting.topic}</h1>
                        <MeetingStatusBadge status={selectedMeeting.status} />
                      </div>
                      <p className="text-sm mt-1" style={{ color: 'var(--text-tertiary)' }}>
                        {selectedMeeting.goal || 'No explicit goal set for this meeting.'}
                      </p>
                      <div className="flex items-center gap-3 mt-3 flex-wrap text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
                        <span>{selectedProject?.name || selectedMeeting.project_name}</span>
                        <span>{(meetingModes.find((entry) => entry.id === selectedMeeting.mode)?.label) || selectedMeeting.mode}</span>
                        <span>{selectedMeeting.auto_apply_tasks ? 'Auto-add tasks on' : 'Manual task approval'}</span>
                        <span>Started {formatTimestamp(selectedMeeting.started_at)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      {(selectedMeeting.status === 'draft' || selectedMeeting.status === 'failed') ? (
                        <>
                          <button className="btn btn-ghost !px-3 !py-2 !text-xs" onClick={openEditModal}>
                            <Pencil size={14} />
                            Edit
                          </button>
                          <button className="btn btn-primary !px-3 !py-2 !text-xs" onClick={startMeetingRun}>
                            <Play size={14} />
                            Start Meeting
                          </button>
                        </>
                      ) : null}
                      {selectedMeeting.status === 'awaiting_confirmation' && !selectedMeeting.tasks_applied ? (
                        <button className="btn btn-primary !px-3 !py-2 !text-xs" onClick={applyTasks}>
                          <FilePlus2 size={14} />
                          Add Tasks to Board
                        </button>
                      ) : null}
                      {selectedMeeting.status !== 'running' ? (
                        <button className="btn btn-ghost !px-3 !py-2 !text-xs" onClick={deleteMeeting}>
                          <Trash2 size={14} />
                          Delete
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[1.3fr_1fr]">
                  <div className="min-h-0 flex flex-col border-r" style={{ borderColor: 'var(--border)' }}>
                    <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
                      <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Participants</p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {(selectedMeeting.agent_ids || []).map((agentId) => {
                          const agent = agents.find((entry) => entry.id === agentId);
                          if (!agent) return null;
                          const isFacilitator = selectedMeeting.facilitator_agent_id === agent.id;
                          return (
                            <span
                              key={agent.id}
                              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs"
                              style={{ background: isFacilitator ? 'var(--accent-light)' : 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                            >
                              <span>{agent.avatar}</span>
                              {agent.name}
                              {isFacilitator ? (
                                <span style={{ color: 'var(--accent)' }}>Facilitator</span>
                              ) : null}
                            </span>
                          );
                        })}
                      </div>
                    </div>

                    {selectedMeeting.summary ? (
                      <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
                        <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>Meeting Summary</p>
                        <div className="text-sm" style={{ color: 'var(--text-primary)' }}>
                          <MarkdownContent content={selectedMeeting.summary} />
                        </div>
                      </div>
                    ) : null}

                    <div className="flex-1 overflow-auto px-5 py-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Transcript</p>
                        {detailLoading ? (
                          <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>Refreshing...</span>
                        ) : null}
                      </div>

                      {(selectedMeeting.messages || []).length === 0 ? (
                        <div className="text-center py-12">
                          <Bot size={40} className="mx-auto mb-3" style={{ color: 'var(--text-tertiary)' }} />
                          <p className="text-sm" style={{ color: 'var(--text-primary)' }}>No meeting transcript yet</p>
                          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                            Start the meeting and the invited agents will begin discussing the topic.
                          </p>
                        </div>
                      ) : (
                        (selectedMeeting.messages || []).map((message) => {
                          const isAgent = message.speaker_type === 'agent';
                          const speaker = isAgent ? agents.find((agent) => agent.id === message.speaker_id) : null;
                          return (
                            <div key={message.id} className="flex gap-3">
                              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--bg-secondary)' }}>
                                {isAgent ? (
                                  <span className="text-lg">{speaker?.avatar || '🤖'}</span>
                                ) : (
                                  <User size={16} style={{ color: 'var(--text-tertiary)' }} />
                                )}
                              </div>
                              <div className="min-w-0 flex-1 px-4 py-3 rounded-2xl" style={{ background: 'var(--bg-secondary)' }}>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                                    {message.speaker_name || (isAgent ? speaker?.name : 'System') || 'System'}
                                  </p>
                                  <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                                    {new Date(message.created_at).toLocaleTimeString()}
                                  </span>
                                </div>
                                <div className="text-sm mt-2" style={{ color: 'var(--text-primary)' }}>
                                  {isAgent ? (
                                    <MarkdownContent content={message.content} />
                                  ) : (
                                    <p className="whitespace-pre-wrap">{message.content}</p>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  <div className="min-h-0 flex flex-col">
                    <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
                      <p className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Proposed Tasks</p>
                      <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                        The meeting produces board-ready tasks at the end. If auto-add is off, review them here before pushing them to the project.
                      </p>
                    </div>

                    <div className="flex-1 overflow-auto p-5 space-y-3">
                      {(selectedMeeting.proposed_tasks || []).length === 0 ? (
                        <div className="text-center py-12">
                          <CheckSquare size={40} className="mx-auto mb-3" style={{ color: 'var(--text-tertiary)' }} />
                          <p className="text-sm" style={{ color: 'var(--text-primary)' }}>No tasks proposed yet</p>
                          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                            Once the agents reach a conclusion, their task breakdown will appear here.
                          </p>
                        </div>
                      ) : (
                        (selectedMeeting.proposed_tasks || []).map((task, index) => {
                          const suggestedAgent = agents.find((agent) => agent.id === task.suggested_agent_id);
                          return (
                            <div key={task.id} className="rounded-2xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
                              <div className="flex items-start gap-3">
                                <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--bg-primary)', color: 'var(--accent)' }}>
                                  {index + 1}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{task.title}</p>
                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--bg-primary)', color: 'var(--text-tertiary)' }}>
                                      {task.priority}
                                    </span>
                                    {task.created_task_id ? (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: '#2f9e4420', color: '#2f9e44' }}>
                                        Added to board
                                      </span>
                                    ) : null}
                                  </div>
                                  {task.description ? (
                                    <p className="text-xs mt-2 whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>{task.description}</p>
                                  ) : null}
                                  {(task.owner_hint || suggestedAgent || task.rationale) ? (
                                    <div className="mt-3 space-y-1">
                                      {task.owner_hint || suggestedAgent ? (
                                        <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                                          Suggested owner: {suggestedAgent ? `${suggestedAgent.avatar} ${suggestedAgent.name}` : task.owner_hint}
                                        </p>
                                      ) : null}
                                      {task.rationale ? (
                                        <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                                          Why: {task.rationale}
                                        </p>
                                      ) : null}
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center max-w-lg px-6">
                  <Presentation size={54} className="mx-auto mb-4" style={{ color: 'var(--text-tertiary)' }} />
                  <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Planning Meetings</p>
                  <p className="text-sm mt-2" style={{ color: 'var(--text-tertiary)' }}>
                    Draft a meeting for a project, invite the right agents, and let them talk through the topic without waiting for user input.
                  </p>
                  <div className="mt-4 rounded-2xl p-4 text-left" style={{ background: 'var(--bg-secondary)' }}>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Example</p>
                    <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
                      Topic: “Create login functionality”
                    </p>
                    <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                      Invite: Project Manager + Tech Lead
                    </p>
                    <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                      Result: scoped plan, technical breakdown, and tasks ready for the board.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
        <BottomBar />
      </div>

      {formMode ? (
        <MeetingFormModal
          agents={agents}
          projects={projects}
          modes={meetingModes}
          form={meetingForm}
          setForm={setMeetingForm}
          mode={formMode}
          onClose={() => setFormMode(null)}
          onSubmit={saveMeetingDraft}
        />
      ) : null}
    </div>
  );
}
