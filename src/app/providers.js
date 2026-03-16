'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { Toaster, toast } from 'react-hot-toast';
import { X } from 'lucide-react';
import KeyboardShortcuts from '@/components/KeyboardShortcuts';

// Socket context
const SocketContext = createContext(null);
export const useSocket = () => useContext(SocketContext);

// Theme context
const ThemeContext = createContext({ theme: 'dark', toggleTheme: () => {} });
export const useTheme = () => useContext(ThemeContext);

// System status context
const StatusContext = createContext({});
export const useStatus = () => useContext(StatusContext);

// Unread messages context: { [agentId]: { count, lastMessage } }
const UnreadContext = createContext({ unread: {}, clearUnread: () => {} });
export const useUnread = () => useContext(UnreadContext);

export default function Providers({ children }) {
  const [socket, setSocket] = useState(null);
  const [theme, setTheme] = useState('dark');
  const [unread, setUnread] = useState({});
  const [systemStatus, setSystemStatus] = useState({
    connected: false,
    activeAgents: 0,
    activeTasks: 0,
    totalTasks: 0,
    dailySpend: 0,
    monthlySpend: 0,
    totalTokens: 0,
  });

  // Initialize theme
  useEffect(() => {
    const saved = localStorage.getItem('agentwork-theme') || 'dark';
    setTheme(saved);
    document.documentElement.classList.toggle('dark', saved === 'dark');
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem('agentwork-theme', next);
      document.documentElement.classList.toggle('dark', next === 'dark');
      return next;
    });
  }, []);

  // Initialize socket
  useEffect(() => {
    const s = io(window.location.origin, {
      transports: ['websocket', 'polling'],
    });

    s.on('connect', () => {
      setSystemStatus((prev) => ({ ...prev, connected: true }));
      s.emit('system:get_status');
    });

    s.on('disconnect', () => {
      setSystemStatus((prev) => ({ ...prev, connected: false }));
    });

    s.on('system:status', (status) => {
      setSystemStatus(status);
    });

    s.on('system:status_update', () => {
      s.emit('system:get_status');
    });

    s.on('notification', (data) => {
      // Track unread per agent
      if (data.agentId) {
        setUnread((prev) => ({
          ...prev,
          [data.agentId]: {
            count: (prev[data.agentId]?.count || 0) + 1,
            lastMessage: data.message,
          },
        }));
      }

      // Show dismissable toast
      toast(
        (t) => (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', width: '100%' }}>
            <span style={{ fontSize: '16px', flexShrink: 0 }}>🔔</span>
            <span style={{ flex: 1, fontSize: '13px', lineHeight: '1.4' }}>{data.message}</span>
            <button
              onClick={() => toast.dismiss(t.id)}
              style={{
                flexShrink: 0,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '0 2px',
                color: 'var(--text-tertiary)',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <X size={14} />
            </button>
          </div>
        ),
        {
          duration: 6000,
          style: {
            background: 'var(--bg-elevated)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
            padding: '10px 12px',
          },
        }
      );
    });

    s.on('budget:update', () => {
      s.emit('system:get_status');
    });

    setSocket(s);

    return () => s.disconnect();
  }, []);

  const clearUnread = useCallback((agentId) => {
    setUnread((prev) => {
      const next = { ...prev };
      delete next[agentId];
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      <SocketContext.Provider value={socket}>
        <StatusContext.Provider value={systemStatus}>
          <UnreadContext.Provider value={{ unread, clearUnread }}>
          {children}
          <KeyboardShortcuts />
          <Toaster
            position="top-right"
            toastOptions={{
              style: {
                background: 'var(--bg-elevated)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                fontSize: '14px',
              },
            }}
          />
          </UnreadContext.Provider>
        </StatusContext.Provider>
      </SocketContext.Provider>
    </ThemeContext.Provider>
  );
}
