'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import Sidebar from '@/components/Sidebar';
import BottomBar from '@/components/BottomBar';
import MarkdownContent from '@/components/MarkdownContent';
import { api } from '@/lib/api';
import { useSocket, useUnread } from '@/app/providers';
import {
  Send,
  Bot,
  User,
  Key,
  Terminal,
  Search,
  X,
  Shield,
  Users,
  Plus,
  Trash2,
  Hash,
} from 'lucide-react';

const AUTH_MODE_META = {
  api: { label: 'API Mode', bg: 'var(--accent-light)', color: 'var(--accent)', Icon: Key },
  cli: { label: 'CLI Mode', bg: '#20c99715', color: '#20c997', Icon: Terminal },
  oauth: { label: 'OAuth Mode', bg: '#ff922b20', color: '#f08c00', Icon: Shield },
};

function getAuthModeMeta(authType) {
  return AUTH_MODE_META[authType] || AUTH_MODE_META.api;
}

function getAuthDescription(agent) {
  if (agent?.auth_type === 'cli') {
    return 'This agent uses your local CLI auth.';
  }
  if (agent?.auth_type === 'oauth') {
    return agent.provider === 'openai-codex'
      ? 'This agent uses saved Codex OAuth from Settings.'
      : 'This agent uses saved provider auth from Settings.';
  }
  return 'Make sure the required API credentials are configured in Settings.';
}

function appendUniqueMessage(current, message) {
  if (current.some((item) => item.id === message.id)) return current;
  return [...current, message];
}

function slugifyMentionValue(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function compactMentionValue(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function buildMentionEntries(roomAgents) {
  const aliasCounts = new Map();
  const rawAliasesByAgent = new Map();

  for (const agent of roomAgents) {
    const words = (agent.name || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const fullSlug = slugifyMentionValue(agent.name);
    const compact = compactMentionValue(agent.name);
    const aliases = Array.from(new Set([words[0] || '', fullSlug, compact].filter(Boolean)));
    rawAliasesByAgent.set(agent.id, aliases);
    for (const alias of aliases) {
      aliasCounts.set(alias, (aliasCounts.get(alias) || 0) + 1);
    }
  }

  const handles = [];
  for (let idx = 0; idx < roomAgents.length; idx += 1) {
    const agent = roomAgents[idx];
    const aliases = rawAliasesByAgent.get(agent.id) || [];
    const uniqueAliases = aliases.filter((alias) => aliasCounts.get(alias) === 1);
    const baseHandle = uniqueAliases[0] || slugifyMentionValue(agent.name) || `agent-${idx + 1}`;
    let handle = baseHandle;

    if (handles.some((entry) => entry.handle === handle)) {
      let suffix = 2;
      while (handles.some((entry) => entry.handle === `${baseHandle}-${suffix}`)) suffix += 1;
      handle = `${baseHandle}-${suffix}`;
    }

    handles.push({ ...agent, handle });
  }

  return handles;
}

function formatRoomHandles(room, agents) {
  const roomAgents = (room?.agent_ids || [])
    .map((agentId) => agents.find((agent) => agent.id === agentId))
    .filter(Boolean);
  return buildMentionEntries(roomAgents);
}

function GroupChatComposer({ agents, draft, setDraft, onClose, onSubmit }) {
  const toggleAgent = (agentId) => {
    setDraft((current) => ({
      ...current,
      agentIds: current.agentIds.includes(agentId)
        ? current.agentIds.filter((id) => id !== agentId)
        : [...current.agentIds, agentId],
    }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0, 0, 0, 0.45)' }}>
      <div className="w-full max-w-lg rounded-2xl border overflow-hidden" style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Create Group Chat</h2>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Pick the agents that can be mentioned in this room.
            </p>
          </div>
          <button className="p-2 rounded-lg" onClick={onClose} style={{ color: 'var(--text-tertiary)' }}>
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Room Name</label>
            <input
              className="input w-full"
              value={draft.name}
              onChange={(e) => setDraft((current) => ({ ...current, name: e.target.value }))}
              placeholder="Cross-functional standup"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Agents</label>
              <button
                type="button"
                className="text-[11px]"
                style={{ color: 'var(--accent)' }}
                onClick={() => setDraft((current) => ({ ...current, agentIds: agents.map((agent) => agent.id) }))}
              >
                Select all
              </button>
            </div>
            <div className="max-h-72 overflow-auto space-y-2">
              {agents.map((agent) => (
                <label
                  key={agent.id}
                  className="flex items-center gap-3 p-3 rounded-xl border cursor-pointer"
                  style={{
                    borderColor: draft.agentIds.includes(agent.id) ? 'var(--accent)' : 'var(--border)',
                    background: draft.agentIds.includes(agent.id) ? 'var(--accent-light)' : 'var(--bg-secondary)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={draft.agentIds.includes(agent.id)}
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

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t" style={{ borderColor: 'var(--border)' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={onSubmit}
            disabled={!draft.name.trim() || draft.agentIds.length === 0}
          >
            Create Room
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ChatPage() {
  const socket = useSocket();
  const { unread, clearUnread } = useUnread();
  const [agents, setAgents] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [sidebarMode, setSidebarMode] = useState('agents');
  const [selectedChat, setSelectedChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [roomTypingAgents, setRoomTypingAgents] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const [roomDraft, setRoomDraft] = useState({ name: '', agentIds: [] });
  const messagesEndRef = useRef(null);

  const selectedAgent = selectedChat?.kind === 'agent'
    ? agents.find((agent) => agent.id === selectedChat.id) || null
    : null;
  const selectedRoom = selectedChat?.kind === 'room'
    ? rooms.find((room) => room.id === selectedChat.id) || null
    : null;
  const selectedRoomHandles = selectedRoom ? formatRoomHandles(selectedRoom, agents) : [];

  const loadAgents = useCallback(async () => {
    try {
      const data = await api.getAgents();
      setAgents(data);
    } catch {}
  }, []);

  const loadRooms = useCallback(async () => {
    try {
      const data = await api.getRooms();
      setRooms(data);
    } catch {}
  }, []);

  useEffect(() => {
    loadAgents();
    loadRooms();
  }, [loadAgents, loadRooms]);

  useEffect(() => {
    if (!socket) return;

    const onMessage = (msg) => {
      if (msg.agent_id === selectedAgent?.id) {
        setMessages((current) => appendUniqueMessage(current, msg));
        if (msg.sender === 'agent') {
          setIsTyping(false);
        }
      }
    };

    const onRoomMessage = ({ roomId, message }) => {
      if (roomId === selectedRoom?.id) {
        setMessages((current) => appendUniqueMessage(current, message));
      }
      if (message.sender_type === 'agent') {
        setRoomTypingAgents((current) => current.filter((item) => item.agentId !== message.sender_id));
      }
    };

    const onRoomCreated = (room) => {
      setRooms((current) => {
        if (current.some((item) => item.id === room.id)) {
          return current.map((item) => (item.id === room.id ? room : item));
        }
        return [room, ...current];
      });
    };

    const onRoomDeleted = ({ id }) => {
      setRooms((current) => current.filter((room) => room.id !== id));
      if (selectedChat?.kind === 'room' && selectedChat.id === id) {
        setSelectedChat(null);
        setMessages([]);
        setRoomTypingAgents([]);
      }
    };

    const onRoomTyping = ({ roomId, agentId, agentName, msgId }) => {
      if (roomId !== selectedRoom?.id) return;
      setRoomTypingAgents((current) => {
        if (current.some((entry) => entry.agentId === agentId)) return current;
        return [...current, { agentId, agentName, msgId }];
      });
    };

    const onRoomTypingEnd = ({ roomId, agentId }) => {
      if (roomId !== selectedRoom?.id) return;
      setRoomTypingAgents((current) => current.filter((entry) => entry.agentId !== agentId));
    };

    const onStatusChanged = ({ agentId, status }) => {
      setAgents((current) => current.map((agent) => (agent.id === agentId ? { ...agent, status } : agent)));
      if (agentId === selectedAgent?.id) {
        if (status === 'thinking') setIsTyping(true);
        if (status === 'idle' || status === 'offline') setIsTyping(false);
      }
    };

    socket.on('chat:message', onMessage);
    socket.on('room:message', onRoomMessage);
    socket.on('room:created', onRoomCreated);
    socket.on('room:deleted', onRoomDeleted);
    socket.on('room:typing', onRoomTyping);
    socket.on('room:typing_end', onRoomTypingEnd);
    socket.on('agent:status_changed', onStatusChanged);

    return () => {
      socket.off('chat:message', onMessage);
      socket.off('room:message', onRoomMessage);
      socket.off('room:created', onRoomCreated);
      socket.off('room:deleted', onRoomDeleted);
      socket.off('room:typing', onRoomTyping);
      socket.off('room:typing_end', onRoomTypingEnd);
      socket.off('agent:status_changed', onStatusChanged);
    };
  }, [socket, selectedAgent?.id, selectedRoom?.id, selectedChat, clearUnread]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping, roomTypingAgents]);

  const selectAgent = async (agent) => {
    setSidebarMode('agents');
    setSelectedChat({ kind: 'agent', id: agent.id });
    setMessages([]);
    setInput('');
    setSearchResults(null);
    setSearchQuery('');
    setRoomTypingAgents([]);
    setIsTyping(false);
    clearUnread(agent.id);
    try {
      const loaded = await api.getMessages(agent.id);
      setMessages(loaded);
    } catch {
      setMessages([]);
    }
  };

  const selectRoom = async (room) => {
    setSidebarMode('rooms');
    setSelectedChat({ kind: 'room', id: room.id });
    setMessages([]);
    setInput('');
    setSearchResults(null);
    setSearchQuery('');
    setRoomTypingAgents([]);
    setIsTyping(false);
    try {
      const loaded = await api.getRoomMessages(room.id);
      setMessages(loaded);
    } catch {
      setMessages([]);
    }
  };

  const openCreateRoomModal = () => {
    const defaultAgentIds = agents.map((agent) => agent.id);
    const firstNames = agents.slice(0, 3).map((agent) => agent.name).join(', ');
    setRoomDraft({
      name: firstNames ? `${firstNames} Room` : 'New Group Chat',
      agentIds: defaultAgentIds,
    });
    setShowCreateRoom(true);
  };

  const createRoom = async () => {
    try {
      const room = await api.createRoom({
        name: roomDraft.name.trim(),
        agent_ids: roomDraft.agentIds,
      });
      setShowCreateRoom(false);
      setRooms((current) => [room, ...current.filter((item) => item.id !== room.id)]);
      await selectRoom(room);
    } catch (err) {
      toast.error(err.message || 'Failed to create room');
    }
  };

  const deleteSelectedRoom = async () => {
    if (!selectedRoom) return;
    if (!window.confirm(`Delete "${selectedRoom.name}"?`)) return;
    try {
      await api.deleteRoom(selectedRoom.id);
      setSelectedChat(null);
      setMessages([]);
      setRoomTypingAgents([]);
    } catch (err) {
      toast.error(err.message || 'Failed to delete room');
    }
  };

  const insertMention = (handle) => {
    setInput((current) => {
      const prefix = current && !/\s$/.test(current) ? `${current} ` : current;
      return `${prefix}@${handle} `;
    });
  };

  const sendMessage = async () => {
    const content = input.trim();
    if (!content) return;

    if (selectedAgent) {
      if (!socket) return;
      socket.emit('chat:send', {
        agentId: selectedAgent.id,
        content,
      });
      setInput('');
      setIsTyping(true);
      return;
    }

    if (!selectedRoom) return;

    setInput('');
    try {
      const result = await api.sendRoomMessage(selectedRoom.id, content);
      if (!result?.mentionedAgentIds?.length) {
        const suggestions = (result?.availableMentions || []).slice(0, 4).map((entry) => `@${entry.handle}`).join(', ');
        toast(suggestions ? `Mention an agent to get a reply. Try ${suggestions}.` : 'Mention an agent in the room to get a reply.');
      }
    } catch (err) {
      toast.error(err.message || 'Failed to send message');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const selectedAuthMode = getAuthModeMeta(selectedAgent?.auth_type);

  const statusColors = {
    offline: '#868e96',
    idle: '#40c057',
    working: '#fab005',
    thinking: '#4c6ef5',
    executing: '#f06595',
  };

  const statusLabels = {
    offline: 'Offline',
    idle: 'Online',
    working: 'Working',
    thinking: 'Thinking...',
    executing: 'Executing...',
  };

  const roomAgents = selectedRoom
    ? selectedRoom.agent_ids.map((agentId) => agents.find((agent) => agent.id === agentId)).filter(Boolean)
    : [];

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <main className="flex-1 overflow-hidden flex" style={{ background: 'var(--bg-primary)' }}>
          <div className="w-72 border-r flex flex-col shrink-0" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
            <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Chats</h2>
                {sidebarMode === 'rooms' ? (
                  <button className="btn btn-primary !px-3 !py-2 !text-xs" onClick={openCreateRoomModal}>
                    <Plus size={14} />
                    New Room
                  </button>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <button
                  className="px-3 py-2 rounded-xl text-xs font-medium"
                  style={{
                    background: sidebarMode === 'agents' ? 'var(--accent-light)' : 'var(--bg-primary)',
                    color: sidebarMode === 'agents' ? 'var(--accent)' : 'var(--text-secondary)',
                    border: `1px solid ${sidebarMode === 'agents' ? 'var(--accent)' : 'var(--border)'}`,
                  }}
                  onClick={() => setSidebarMode('agents')}
                >
                  Direct
                </button>
                <button
                  className="px-3 py-2 rounded-xl text-xs font-medium"
                  style={{
                    background: sidebarMode === 'rooms' ? 'var(--accent-light)' : 'var(--bg-primary)',
                    color: sidebarMode === 'rooms' ? 'var(--accent)' : 'var(--text-secondary)',
                    border: `1px solid ${sidebarMode === 'rooms' ? 'var(--accent)' : 'var(--border)'}`,
                  }}
                  onClick={() => setSidebarMode('rooms')}
                >
                  Group
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-2 space-y-1">
              {sidebarMode === 'agents' ? (
                agents.length === 0 ? (
                  <p className="text-xs text-center py-8" style={{ color: 'var(--text-tertiary)' }}>
                    No agents hired yet.
                  </p>
                ) : (
                  agents.map((agent) => {
                    const agentUnread = unread[agent.id];
                    const hasUnread = agentUnread && agentUnread.count > 0;
                    const authMode = getAuthModeMeta(agent.auth_type);
                    const AuthIcon = authMode.Icon;
                    return (
                      <button
                        key={agent.id}
                        className="flex items-center gap-3 p-3 rounded-xl w-full text-left transition-colors"
                        style={{
                          background: selectedAgent?.id === agent.id ? 'var(--accent-light)' : 'transparent',
                        }}
                        onClick={() => selectAgent(agent)}
                      >
                        <div className="relative shrink-0">
                          <span className="text-xl">{agent.avatar}</span>
                          <div
                            className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2"
                            style={{
                              background: statusColors[agent.status] || statusColors.idle,
                              borderColor: 'var(--bg-secondary)',
                            }}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={`text-sm truncate ${hasUnread ? 'font-bold' : 'font-medium'}`} style={{ color: 'var(--text-primary)' }}>
                            {agent.name}
                          </p>
                          <p className="text-xs truncate" style={{ color: hasUnread ? 'var(--text-secondary)' : 'var(--text-tertiary)' }}>
                            {hasUnread ? agentUnread.lastMessage : agent.role}
                          </p>
                        </div>
                        <span className="text-[9px] shrink-0 px-1.5 py-0.5 rounded" style={{ background: authMode.bg, color: authMode.color }}>
                          <AuthIcon size={10} />
                        </span>
                      </button>
                    );
                  })
                )
              ) : (
                <>
                  {rooms.length === 0 ? (
                    <div className="text-center py-10 px-4">
                      <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{ background: 'var(--bg-primary)', color: 'var(--text-secondary)' }}>
                        <Users size={20} />
                      </div>
                      <p className="text-sm" style={{ color: 'var(--text-primary)' }}>No group chats yet</p>
                      <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                        Create a room, then mention agents like <span style={{ color: 'var(--accent)' }}>@alex</span>.
                      </p>
                      <button className="btn btn-primary mt-4" onClick={openCreateRoomModal}>
                        <Plus size={14} />
                        Create Room
                      </button>
                    </div>
                  ) : null}

                  {rooms.map((room) => {
                    const handles = formatRoomHandles(room, agents);
                    return (
                      <button
                        key={room.id}
                        className="w-full text-left p-3 rounded-xl border transition-colors"
                        style={{
                          borderColor: selectedRoom?.id === room.id ? 'var(--accent)' : 'transparent',
                          background: selectedRoom?.id === room.id ? 'var(--accent-light)' : 'transparent',
                        }}
                        onClick={() => selectRoom(room)}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--bg-primary)', color: 'var(--accent)' }}>
                            <Users size={18} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{room.name}</p>
                            <p className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
                              {room.agent_ids.length} agents
                              {handles.length ? ` · ${handles.slice(0, 2).map((entry) => `@${entry.handle}`).join(', ')}` : ''}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          </div>

          <div className="flex-1 flex flex-col min-w-0">
            {selectedAgent ? (
              <>
                <div className="flex items-center gap-3 px-5 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
                  <div className="relative">
                    <span className="text-xl">{selectedAgent.avatar}</span>
                    <div
                      className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2"
                      style={{
                        background: statusColors[selectedAgent.status] || statusColors.idle,
                        borderColor: 'var(--bg-primary)',
                      }}
                    />
                  </div>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{selectedAgent.name}</p>
                    <p className="text-xs" style={{ color: statusColors[selectedAgent.status] || statusColors.idle }}>
                      {statusLabels[selectedAgent.status] || 'Online'}
                    </p>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    {searchResults !== null ? (
                      <div className="flex items-center gap-1">
                        <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{searchResults.length} results</span>
                        <button onClick={() => { setSearchResults(null); setSearchQuery(''); }} className="p-1 rounded" style={{ color: 'var(--text-tertiary)' }}>
                          <X size={12} />
                        </button>
                      </div>
                    ) : null}
                    <div className="flex items-center gap-1 px-2 py-1 rounded" style={{ background: 'var(--bg-secondary)' }}>
                      <Search size={12} style={{ color: 'var(--text-tertiary)' }} />
                      <input
                        className="bg-transparent text-[11px] w-24 focus:w-40 transition-all outline-none"
                        style={{ color: 'var(--text-primary)' }}
                        placeholder="Search..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={async (e) => {
                          if (e.key === 'Enter' && searchQuery.trim()) {
                            try {
                              const results = await api.searchMessages(selectedAgent.id, searchQuery.trim());
                              setSearchResults(results);
                            } catch {}
                          }
                        }}
                      />
                    </div>
                    <span className="text-[10px] px-2 py-1 rounded" style={{ background: selectedAuthMode.bg, color: selectedAuthMode.color }}>
                      {selectedAuthMode.label}
                      {selectedAgent.model ? ` · ${selectedAgent.model}` : ''}
                    </span>
                  </div>
                </div>

                <div className="flex-1 overflow-auto p-5 space-y-4">
                  {(searchResults !== null ? searchResults : messages).length === 0 && !isTyping ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center">
                        <span className="text-4xl mb-3 block">{selectedAgent.avatar}</span>
                        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                          Start a conversation with {selectedAgent.name}
                        </p>
                        <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                          {getAuthDescription(selectedAgent)}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <>
                      {(searchResults !== null ? searchResults : messages).map((msg) => (
                        <div
                          key={msg.id}
                          className={`flex gap-3 animate-fade-in ${msg.sender === 'user' ? 'flex-row-reverse' : ''}`}
                        >
                          <div className="shrink-0 mt-1">
                            {msg.sender === 'user' ? (
                              <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'var(--accent)', color: 'white' }}>
                                <User size={16} />
                              </div>
                            ) : (
                              <div className="w-8 h-8 rounded-full flex items-center justify-center text-lg" style={{ background: 'var(--bg-tertiary)' }}>
                                {selectedAgent.avatar}
                              </div>
                            )}
                          </div>
                          <div
                            className="max-w-[70%] px-4 py-2.5 rounded-2xl text-sm"
                            style={{
                              background: msg.sender === 'user' ? 'var(--accent)' : 'var(--bg-secondary)',
                              color: msg.sender === 'user' ? 'white' : 'var(--text-primary)',
                              borderBottomRightRadius: msg.sender === 'user' ? '4px' : undefined,
                              borderBottomLeftRadius: msg.sender !== 'user' ? '4px' : undefined,
                            }}
                          >
                            {msg.sender === 'agent' ? (
                              <MarkdownContent content={msg.content} />
                            ) : (
                              <p className="whitespace-pre-wrap">{msg.content}</p>
                            )}
                            <p className="text-[10px] mt-1 opacity-60">
                              {new Date(msg.created_at).toLocaleTimeString()}
                            </p>
                          </div>
                        </div>
                      ))}

                      {isTyping ? (
                        <div className="flex gap-3 animate-fade-in">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-lg shrink-0" style={{ background: 'var(--bg-tertiary)' }}>
                            {selectedAgent.avatar}
                          </div>
                          <div className="px-4 py-3 rounded-2xl" style={{ background: 'var(--bg-secondary)', borderBottomLeftRadius: '4px' }}>
                            <div className="flex gap-1">
                              {[0, 1, 2].map((i) => (
                                <div
                                  key={i}
                                  className="w-2 h-2 rounded-full animate-pulse-slow"
                                  style={{ background: 'var(--text-tertiary)', animationDelay: `${i * 0.3}s` }}
                                />
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                <div className="p-4 border-t" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex items-end gap-2">
                    <textarea
                      className="input flex-1 resize-none"
                      rows={1}
                      placeholder={`Message ${selectedAgent.name}...`}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      style={{ minHeight: '42px', maxHeight: '120px' }}
                    />
                    <button className="btn btn-primary h-[42px] px-4" onClick={sendMessage} disabled={!input.trim()}>
                      <Send size={16} />
                    </button>
                  </div>
                </div>
              </>
            ) : selectedRoom ? (
              <>
                <div className="flex items-center gap-3 px-5 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: 'var(--accent-light)', color: 'var(--accent)' }}>
                    <Users size={18} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{selectedRoom.name}</p>
                    <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                      {roomAgents.length} agents available in this room
                    </p>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    <button className="btn btn-ghost !px-3 !py-2 !text-xs" onClick={openCreateRoomModal}>
                      <Plus size={14} />
                      New Room
                    </button>
                    <button className="btn btn-ghost !px-3 !py-2 !text-xs" onClick={deleteSelectedRoom}>
                      <Trash2 size={14} />
                      Delete
                    </button>
                  </div>
                </div>

                <div className="px-5 py-3 border-b space-y-3" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    <Hash size={12} />
                    Mention the agents you want to answer. Only mentioned agents will reply.
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedRoomHandles.map((entry) => (
                      <button
                        key={entry.id}
                        className="px-3 py-1.5 rounded-full text-xs font-medium"
                        style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
                        onClick={() => insertMention(entry.handle)}
                      >
                        <span className="mr-1">{entry.avatar}</span>
                        @{entry.handle}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex-1 overflow-auto p-5 space-y-4">
                  {messages.length === 0 && roomTypingAgents.length === 0 ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center max-w-md">
                        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--bg-secondary)', color: 'var(--accent)' }}>
                          <Users size={24} />
                        </div>
                        <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                          Start the room by mentioning someone.
                        </p>
                        <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                          Example: {selectedRoomHandles.slice(0, 2).map((entry) => `@${entry.handle}`).join(' ')} What do you think about this plan?
                        </p>
                      </div>
                    </div>
                  ) : (
                    <>
                      {messages.map((msg) => {
                        const isUser = msg.sender_type === 'user';
                        const messageAgent = !isUser
                          ? agents.find((agent) => agent.id === msg.sender_id) || null
                          : null;
                        return (
                          <div
                            key={msg.id}
                            className={`flex gap-3 animate-fade-in ${isUser ? 'flex-row-reverse' : ''}`}
                          >
                            <div className="shrink-0 mt-1">
                              {isUser ? (
                                <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'var(--accent)', color: 'white' }}>
                                  <User size={16} />
                                </div>
                              ) : (
                                <div className="w-8 h-8 rounded-full flex items-center justify-center text-lg" style={{ background: 'var(--bg-tertiary)' }}>
                                  {messageAgent?.avatar || '🤖'}
                                </div>
                              )}
                            </div>
                            <div
                              className="max-w-[78%] px-4 py-2.5 rounded-2xl text-sm"
                              style={{
                                background: isUser ? 'var(--accent)' : 'var(--bg-secondary)',
                                color: isUser ? 'white' : 'var(--text-primary)',
                                borderBottomRightRadius: isUser ? '4px' : undefined,
                                borderBottomLeftRadius: !isUser ? '4px' : undefined,
                              }}
                            >
                              {!isUser ? (
                                <p className="text-[11px] font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>
                                  {msg.sender_name || messageAgent?.name || 'Agent'}
                                </p>
                              ) : null}
                              {isUser ? (
                                <p className="whitespace-pre-wrap">{msg.content}</p>
                              ) : (
                                <MarkdownContent content={msg.content} />
                              )}
                              <p className="text-[10px] mt-1 opacity-60">
                                {new Date(msg.created_at).toLocaleTimeString()}
                              </p>
                            </div>
                          </div>
                        );
                      })}

                      {roomTypingAgents.map((entry) => {
                        const typingAgent = agents.find((agent) => agent.id === entry.agentId);
                        return (
                          <div key={entry.agentId} className="flex gap-3 animate-fade-in">
                            <div className="w-8 h-8 rounded-full flex items-center justify-center text-lg shrink-0" style={{ background: 'var(--bg-tertiary)' }}>
                              {typingAgent?.avatar || '🤖'}
                            </div>
                            <div className="px-4 py-3 rounded-2xl" style={{ background: 'var(--bg-secondary)', borderBottomLeftRadius: '4px' }}>
                              <p className="text-[11px] font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>
                                {entry.agentName}
                              </p>
                              <div className="flex gap-1">
                                {[0, 1, 2].map((i) => (
                                  <div
                                    key={i}
                                    className="w-2 h-2 rounded-full animate-pulse-slow"
                                    style={{ background: 'var(--text-tertiary)', animationDelay: `${i * 0.3}s` }}
                                  />
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                <div className="p-4 border-t" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex items-end gap-2">
                    <textarea
                      className="input flex-1 resize-none"
                      rows={1}
                      placeholder={selectedRoomHandles.length ? `Message room and mention agents like @${selectedRoomHandles[0].handle}...` : 'Message room...'}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      style={{ minHeight: '42px', maxHeight: '120px' }}
                    />
                    <button className="btn btn-primary h-[42px] px-4" onClick={sendMessage} disabled={!input.trim()}>
                      <Send size={16} />
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center max-w-sm">
                  <Bot size={48} className="mx-auto mb-3" style={{ color: 'var(--text-tertiary)' }} />
                  <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                    {sidebarMode === 'rooms' ? 'Select a group chat or create a new room' : 'Select an agent to start chatting'}
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                    {sidebarMode === 'rooms'
                      ? 'In group chat, only the agents you mention with @handles will reply.'
                      : 'Direct chats work the same as before.'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </main>
        <BottomBar />
      </div>

      {showCreateRoom ? (
        <GroupChatComposer
          agents={agents}
          draft={roomDraft}
          setDraft={setRoomDraft}
          onClose={() => setShowCreateRoom(false)}
          onSubmit={createRoom}
        />
      ) : null}
    </div>
  );
}
