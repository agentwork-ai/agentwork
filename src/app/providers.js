'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { Toaster, toast } from 'react-hot-toast';

// Socket context
const SocketContext = createContext(null);
export const useSocket = () => useContext(SocketContext);

// Theme context
const ThemeContext = createContext({ theme: 'dark', toggleTheme: () => {} });
export const useTheme = () => useContext(ThemeContext);

// System status context
const StatusContext = createContext({});
export const useStatus = () => useContext(StatusContext);

export default function Providers({ children }) {
  const [socket, setSocket] = useState(null);
  const [theme, setTheme] = useState('dark');
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
    const saved = localStorage.getItem('agenthub-theme') || 'dark';
    setTheme(saved);
    document.documentElement.classList.toggle('dark', saved === 'dark');
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem('agenthub-theme', next);
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
      toast(data.message, {
        icon: '🔔',
        duration: 5000,
        style: {
          background: 'var(--bg-elevated)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border)',
        },
      });
    });

    s.on('budget:update', () => {
      s.emit('system:get_status');
    });

    setSocket(s);

    return () => s.disconnect();
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      <SocketContext.Provider value={socket}>
        <StatusContext.Provider value={systemStatus}>
          {children}
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
        </StatusContext.Provider>
      </SocketContext.Provider>
    </ThemeContext.Provider>
  );
}
