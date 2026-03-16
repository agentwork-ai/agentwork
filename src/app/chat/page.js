'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import Sidebar from '@/components/Sidebar';
import BottomBar from '@/components/BottomBar';
import MarkdownContent from '@/components/MarkdownContent';
import { api } from '@/lib/api';
import { useSocket, useUnread } from '@/app/providers';
import { Send, Bot, User, Key, Terminal, Search, X } from 'lucide-react';

export default function ChatPage() {
  const socket = useSocket();
  const { unread, clearUnread } = useUnread();
  const [agents, setAgents] = useState([]);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const messagesEndRef = useRef(null);

  const loadAgents = useCallback(async () => {
    try {
      const data = await api.getAgents();
      setAgents(data);
    } catch {}
  }, []);

  useEffect(() => { loadAgents(); }, [loadAgents]);

  useEffect(() => {
    if (!socket) return;
    const onMessage = (msg) => {
      if (msg.agent_id === selectedAgent?.id) {
        setMessages((prev) => [...prev, msg]);
        // Agent responded, stop typing indicator
        if (msg.sender === 'agent') {
          setIsTyping(false);
        }
      }
    };
    const onStatusChanged = ({ agentId, status }) => {
      setAgents((prev) => prev.map((a) => (a.id === agentId ? { ...a, status } : a)));
      if (agentId === selectedAgent?.id) {
        setSelectedAgent((prev) => prev ? { ...prev, status } : prev);
        // Show typing when agent is thinking
        if (status === 'thinking') setIsTyping(true);
        else if (status === 'idle' || status === 'offline') setIsTyping(false);
      }
    };

    socket.on('chat:message', onMessage);
    socket.on('agent:status_changed', onStatusChanged);
    return () => {
      socket.off('chat:message', onMessage);
      socket.off('agent:status_changed', onStatusChanged);
    };
  }, [socket, selectedAgent]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const selectAgent = async (agent) => {
    setSelectedAgent(agent);
    setIsTyping(false);
    clearUnread(agent.id);
    try {
      const msgs = await api.getMessages(agent.id);
      setMessages(msgs);
    } catch {
      setMessages([]);
    }
  };

  const sendMessage = () => {
    if (!input.trim() || !selectedAgent || !socket) return;
    socket.emit('chat:send', {
      agentId: selectedAgent.id,
      content: input.trim(),
    });
    setInput('');
    setIsTyping(true); // Expect agent response
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

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

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <main className="flex-1 overflow-hidden flex" style={{ background: 'var(--bg-primary)' }}>
          {/* Agent list */}
          <div className="w-64 border-r flex flex-col shrink-0" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
            <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
              <h2 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>Agents</h2>
            </div>
            <div className="flex-1 overflow-auto p-2 space-y-1">
              {agents.length === 0 ? (
                <p className="text-xs text-center py-8" style={{ color: 'var(--text-tertiary)' }}>
                  No agents hired yet.
                </p>
              ) : (
                agents.map((agent) => {
                  const agentUnread = unread[agent.id];
                  const hasUnread = agentUnread && agentUnread.count > 0;
                  return (
                  <button
                    key={agent.id}
                    className="flex items-center gap-3 p-3 rounded-lg w-full text-left transition-colors"
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
                    <span className="text-[9px] shrink-0 px-1.5 py-0.5 rounded" style={{
                      background: agent.auth_type === 'cli' ? '#20c99715' : 'var(--accent-light)',
                      color: agent.auth_type === 'cli' ? '#20c997' : 'var(--accent)',
                    }}>
                      {agent.auth_type === 'cli' ? <Terminal size={10} /> : <Key size={10} />}
                    </span>
                  </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Chat area */}
          <div className="flex-1 flex flex-col min-w-0">
            {selectedAgent ? (
              <>
                {/* Chat header */}
                <div className="flex items-center gap-3 px-5 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
                  <div className="relative">
                    <span className="text-xl">{selectedAgent.avatar}</span>
                    <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2"
                      style={{
                        background: statusColors[selectedAgent.status] || statusColors.idle,
                        borderColor: 'var(--bg-primary)',
                      }} />
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
                        <button onClick={() => { setSearchResults(null); setSearchQuery(''); }} className="p-1 rounded" style={{ color: 'var(--text-tertiary)' }}><X size={12} /></button>
                      </div>
                    ) : null}
                    <div className="flex items-center gap-1 px-2 py-1 rounded" style={{ background: 'var(--bg-secondary)' }}>
                      <Search size={12} style={{ color: 'var(--text-tertiary)' }} />
                      <input className="bg-transparent text-[11px] w-24 focus:w-40 transition-all outline-none"
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
                    <span className="text-[10px] px-2 py-1 rounded" style={{
                      background: selectedAgent.auth_type === 'cli' ? '#20c99715' : 'var(--accent-light)',
                      color: selectedAgent.auth_type === 'cli' ? '#20c997' : 'var(--accent)',
                    }}>
                      {selectedAgent.auth_type === 'cli' ? 'CLI Mode' : 'API Mode'}
                      {selectedAgent.model ? ` · ${selectedAgent.model}` : ''}
                    </span>
                  </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-auto p-5 space-y-4">
                  {(searchResults !== null ? searchResults : messages).length === 0 && !isTyping ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center">
                        <span className="text-4xl mb-3 block">{selectedAgent.avatar}</span>
                        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                          Start a conversation with {selectedAgent.name}
                        </p>
                        <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                          {selectedAgent.auth_type === 'cli'
                            ? 'This agent uses your local CLI — no API key needed'
                            : 'Make sure your API key is configured in Settings'}
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

                      {/* Typing indicator */}
                      {isTyping && (
                        <div className="flex gap-3 animate-fade-in">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-lg shrink-0" style={{ background: 'var(--bg-tertiary)' }}>
                            {selectedAgent.avatar}
                          </div>
                          <div className="px-4 py-3 rounded-2xl" style={{ background: 'var(--bg-secondary)', borderBottomLeftRadius: '4px' }}>
                            <div className="flex gap-1">
                              {[0, 1, 2].map((i) => (
                                <div key={i} className="w-2 h-2 rounded-full animate-pulse-slow"
                                  style={{ background: 'var(--text-tertiary)', animationDelay: `${i * 0.3}s` }} />
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input */}
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
                    <button
                      className="btn btn-primary h-[42px] px-4"
                      onClick={sendMessage}
                      disabled={!input.trim()}
                    >
                      <Send size={16} />
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <Bot size={48} className="mx-auto mb-3" style={{ color: 'var(--text-tertiary)' }} />
                  <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                    Select an agent to start chatting
                  </p>
                </div>
              </div>
            )}
          </div>
        </main>
        <BottomBar />
      </div>
    </div>
  );
}
