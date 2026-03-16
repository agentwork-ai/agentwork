'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { Toaster, toast } from 'react-hot-toast';
import { X, Lock, Eye, EyeOff } from 'lucide-react';
import KeyboardShortcuts from '@/components/KeyboardShortcuts';
import { api } from '@/lib/api';

// Socket context
const SocketContext = createContext(null);
export const useSocket = () => useContext(SocketContext);

// Theme context
const ThemeContext = createContext({ theme: 'dark', toggleTheme: () => {} });
export const useTheme = () => useContext(ThemeContext);

// System status context
const StatusContext = createContext({});
export const useStatus = () => useContext(StatusContext);

// Auth context
const AuthContext = createContext({ authenticated: true, logout: () => {} });
export const useAuth = () => useContext(AuthContext);

// Unread messages context: { [agentId]: { count, lastMessage } }
const UnreadContext = createContext({ unread: {}, clearUnread: () => {} });
export const useUnread = () => useContext(UnreadContext);

function LoginScreen({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await api.login(password);
      if (result.success && result.token) {
        localStorage.setItem('agentwork-auth-token', result.token);
        onLogin();
      } else if (result.error) {
        setError(result.error);
      } else {
        // No password required
        onLogin();
      }
    } catch (err) {
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <div className="w-full max-w-sm p-8 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
        <div className="flex flex-col items-center mb-6">
          <div className="w-12 h-12 rounded-full flex items-center justify-center mb-3" style={{ background: 'var(--accent)', color: 'white' }}>
            <Lock size={24} />
          </div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>AgentWork</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-tertiary)' }}>Enter your dashboard password</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <div className="flex gap-2">
              <input
                className="input flex-1"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoFocus
              />
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {error && (
              <p className="text-xs mt-2" style={{ color: 'var(--error, #ef4444)' }}>{error}</p>
            )}
          </div>
          <button
            type="submit"
            className="btn btn-primary w-full"
            disabled={loading || !password}
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function Providers({ children }) {
  const [socket, setSocket] = useState(null);
  const [theme, setTheme] = useState('dark');
  const [unread, setUnread] = useState({});
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(true);
  const [systemStatus, setSystemStatus] = useState({
    connected: false,
    activeAgents: 0,
    activeTasks: 0,
    totalTasks: 0,
    dailySpend: 0,
    monthlySpend: 0,
    totalTokens: 0,
  });

  // Accent color presets
  const ACCENT_PRESETS = {
    blue: { accent: '#4c6ef5', hover: '#4263eb', light: '#dbe4ff', darkAccent: '#5c7cfa', darkHover: '#748ffc', darkLight: '#1a2350' },
    purple: { accent: '#7950f2', hover: '#7048e8', light: '#e5dbff', darkAccent: '#845ef7', darkHover: '#9775fa', darkLight: '#2b1a50' },
    green: { accent: '#40c057', hover: '#37b24d', light: '#d3f9d8', darkAccent: '#51cf66', darkHover: '#69db7c', darkLight: '#1a3d20' },
    orange: { accent: '#fd7e14', hover: '#f76707', light: '#ffe8cc', darkAccent: '#ff922b', darkHover: '#ffa94d', darkLight: '#3d2a0a' },
    pink: { accent: '#e64980', hover: '#d6336c', light: '#ffdeeb', darkAccent: '#f06595', darkHover: '#f783ac', darkLight: '#3d1028' },
    teal: { accent: '#20c997', hover: '#12b886', light: '#c3fae8', darkAccent: '#38d9a9', darkHover: '#63e6be', darkLight: '#0a3d2c' },
  };

  function applyAccentColor(colorName) {
    const preset = ACCENT_PRESETS[colorName] || ACCENT_PRESETS.blue;
    const isDark = document.documentElement.classList.contains('dark');
    document.documentElement.style.setProperty('--accent', isDark ? preset.darkAccent : preset.accent);
    document.documentElement.style.setProperty('--accent-hover', isDark ? preset.darkHover : preset.hover);
    document.documentElement.style.setProperty('--accent-light', isDark ? preset.darkLight : preset.light);
  }

  // Register service worker
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('Service worker registration failed:', err);
      });
    }
  }, []);

  // Initialize theme
  useEffect(() => {
    const saved = localStorage.getItem('agentwork-theme') || 'dark';
    setTheme(saved);
    document.documentElement.classList.toggle('dark', saved === 'dark');
    const accentColor = localStorage.getItem('agentwork-accent') || 'blue';
    applyAccentColor(accentColor);
  }, []);

  // Check authentication on mount
  useEffect(() => {
    api.checkAuth().then((result) => {
      if (!result.required) {
        setAuthenticated(true);
      } else {
        setAuthenticated(result.valid);
      }
      setAuthChecked(true);
    }).catch(() => {
      setAuthChecked(true);
      setAuthenticated(true); // If check fails, allow through
    });

    // Listen for 401 events from API layer
    const handleAuthRequired = () => {
      setAuthenticated(false);
    };
    window.addEventListener('agentwork:auth-required', handleAuthRequired);
    return () => window.removeEventListener('agentwork:auth-required', handleAuthRequired);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('agentwork-auth-token');
    setAuthenticated(false);
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

  const handleLogin = useCallback(() => {
    setAuthenticated(true);
  }, []);

  // Show nothing until auth check completes
  if (!authChecked) {
    return (
      <ThemeContext.Provider value={{ theme, toggleTheme }}>
        <div className="flex items-center justify-center min-h-screen" style={{ background: 'var(--bg-primary)' }}>
          <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading...</div>
        </div>
      </ThemeContext.Provider>
    );
  }

  // Show login if auth is required but not authenticated
  if (!authenticated) {
    return (
      <ThemeContext.Provider value={{ theme, toggleTheme }}>
        <LoginScreen onLogin={handleLogin} />
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
      </ThemeContext.Provider>
    );
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      <AuthContext.Provider value={{ authenticated, logout }}>
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
      </AuthContext.Provider>
    </ThemeContext.Provider>
  );
}
