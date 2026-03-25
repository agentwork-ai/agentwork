'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { X, Keyboard } from 'lucide-react';

const ROUTES = ['/', '/projects', '/kanban', '/cron', '/chat', '/meetings', '/office', '/agents', '/settings'];

const SHORTCUT_GROUPS = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['Cmd', 'K'], description: 'Go to Task Board' },
      { keys: ['Cmd', 'J'], description: 'Go to Projects' },
      { keys: ['Cmd', '1'], description: 'Dashboard' },
      { keys: ['Cmd', '2'], description: 'Projects' },
      { keys: ['Cmd', '3'], description: 'Tasks (Kanban)' },
      { keys: ['Cmd', '4'], description: 'Cron' },
      { keys: ['Cmd', '5'], description: 'Chat' },
      { keys: ['Cmd', '6'], description: 'Meetings' },
      { keys: ['Cmd', '7'], description: 'Office' },
      { keys: ['Cmd', '8'], description: 'Agents' },
      { keys: ['Cmd', '9'], description: 'Settings' },
    ],
  },
  {
    title: 'General',
    shortcuts: [
      { keys: ['Cmd', 'B'], description: 'Toggle sidebar' },
      { keys: ['Esc'], description: 'Close modal / dialog' },
      { keys: ['?'], description: 'Show keyboard shortcuts' },
    ],
  },
];

function isInputFocused() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (el.isContentEditable) return true;
  return false;
}

function Kbd({ children }) {
  return (
    <kbd
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: '24px',
        height: '24px',
        padding: '0 6px',
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border)',
        borderRadius: '6px',
        fontSize: '12px',
        fontWeight: 600,
        fontFamily: 'inherit',
        color: 'var(--text-secondary)',
        boxShadow: '0 1px 0 var(--border)',
      }}
    >
      {children}
    </kbd>
  );
}

function HelpOverlay({ onClose }) {
  // Close on Escape or clicking backdrop
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
  const modLabel = isMac ? '\u2318' : 'Ctrl';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(4px)',
        animation: 'fadeIn 0.15s ease',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: '16px',
          boxShadow: 'var(--shadow-lg)',
          width: '100%',
          maxWidth: '480px',
          maxHeight: '80vh',
          overflow: 'auto',
          animation: 'fadeIn 0.15s ease',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Keyboard size={20} style={{ color: 'var(--accent)' }} />
            <h2
              style={{
                fontSize: '16px',
                fontWeight: 600,
                color: 'var(--text-primary)',
                margin: 0,
              }}
            >
              Keyboard Shortcuts
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '6px',
              color: 'var(--text-tertiary)',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 20px' }}>
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title} style={{ marginBottom: '20px' }}>
              <h3
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  color: 'var(--text-tertiary)',
                  marginBottom: '10px',
                }}
              >
                {group.title}
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {group.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.description}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '6px 0',
                    }}
                  >
                    <span
                      style={{
                        fontSize: '13px',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {shortcut.description}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      {shortcut.keys.map((key, i) => (
                        <Kbd key={i}>{key === 'Cmd' ? modLabel : key}</Kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--border)',
            textAlign: 'center',
          }}
        >
          <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
            Press <Kbd>Esc</Kbd> or <Kbd>?</Kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}

export default function KeyboardShortcuts() {
  const router = useRouter();
  const [showHelp, setShowHelp] = useState(false);

  const handleKeyDown = useCallback(
    (e) => {
      const mod = e.metaKey || e.ctrlKey;

      // ? key to toggle help (only when not in an input)
      if (e.key === '?' && !mod && !isInputFocused()) {
        e.preventDefault();
        setShowHelp((prev) => !prev);
        return;
      }

      // Escape: close modals
      if (e.key === 'Escape') {
        if (showHelp) {
          setShowHelp(false);
          return;
        }
        // Dispatch a custom event so other modals can listen
        window.dispatchEvent(new CustomEvent('modal:close'));
        return;
      }

      // All remaining shortcuts require Cmd/Ctrl
      if (!mod) return;

      // Cmd+K -> /kanban
      if (e.key === 'k') {
        e.preventDefault();
        router.push('/kanban');
        return;
      }

      // Cmd+J -> /projects
      if (e.key === 'j') {
        e.preventDefault();
        router.push('/projects');
        return;
      }

      // Cmd+B -> toggle sidebar
      if (e.key === 'b') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('sidebar:toggle'));
        return;
      }

      // Cmd+1 through Cmd+8 -> navigate to routes
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 8) {
        e.preventDefault();
        router.push(ROUTES[num - 1]);
        return;
      }
    },
    [router, showHelp]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return showHelp ? <HelpOverlay onClose={() => setShowHelp(false)} /> : null;
}
