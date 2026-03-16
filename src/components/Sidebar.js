'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme, useUnread } from '@/app/providers';
import {
  LayoutDashboard,
  FolderKanban,
  Columns3,
  MessageSquare,
  Building2,
  BarChart3,
  Users,
  Settings,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  Zap,
  Menu,
  X,
  GitBranch,
} from 'lucide-react';

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/kanban', label: 'Tasks', icon: Columns3 },
  { href: '/chat', label: 'Chat', icon: MessageSquare },
  { href: '/office', label: 'Office', icon: Building2 },
  { href: '/pipelines', label: 'Pipelines', icon: GitBranch },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/agents', label: 'Agents', icon: Users },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const { unread } = useUnread();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Listen for keyboard shortcut toggle event
  useEffect(() => {
    const handler = () => setCollapsed((prev) => !prev);
    window.addEventListener('sidebar:toggle', handler);
    return () => window.removeEventListener('sidebar:toggle', handler);
  }, []);

  // Prevent body scroll when mobile sidebar is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  const totalUnread = Object.values(unread).reduce((sum, v) => sum + (v.count || 0), 0);

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 h-14 border-b" style={{ borderColor: 'var(--border)' }}>
        <div
          className="flex items-center justify-center w-8 h-8 rounded-lg"
          style={{ background: 'var(--accent)' }}
        >
          <Zap size={18} className="text-white" />
        </div>
        {!collapsed && (
          <span className="font-semibold text-base" style={{ color: 'var(--text-primary)' }}>
            AgentWork
          </span>
        )}
        {/* Close button on mobile */}
        <button
          onClick={closeMobile}
          className="md:hidden ml-auto flex items-center justify-center w-8 h-8 rounded-lg"
          style={{ color: 'var(--text-secondary)' }}
          aria-label="Close sidebar"
        >
          <X size={20} />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-2 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                collapsed ? 'md:justify-center' : ''
              }`}
              style={{
                background: isActive ? 'var(--accent-light)' : 'transparent',
                color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
              }}
              title={collapsed ? item.label : undefined}
            >
              <div className="relative">
                <Icon size={20} />
                {item.href === '/chat' && totalUnread > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 text-[10px] font-bold text-white bg-red-500 rounded-full flex items-center justify-center">
                    {totalUnread > 9 ? '9+' : totalUnread}
                  </span>
                )}
              </div>
              {/* On mobile, always show label. On desktop, respect collapsed state. */}
              <span className={collapsed ? 'md:hidden' : ''}>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Bottom actions */}
      <div className="p-2 border-t space-y-1" style={{ borderColor: 'var(--border)' }}>
        <button
          onClick={toggleTheme}
          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm w-full transition-colors ${
            collapsed ? 'md:justify-center' : ''
          }`}
          style={{ color: 'var(--text-secondary)' }}
        >
          {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          <span className={collapsed ? 'md:hidden' : ''}>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
        </button>

        <button
          onClick={() => setCollapsed(!collapsed)}
          className={`hidden md:flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm w-full transition-colors ${
            collapsed ? 'justify-center' : ''
          }`}
          style={{ color: 'var(--text-tertiary)' }}
        >
          {collapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile hamburger button - fixed in top-left */}
      <button
        onClick={() => setMobileOpen(true)}
        className="md:hidden fixed top-3 left-3 z-50 flex items-center justify-center w-10 h-10 rounded-lg"
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          color: 'var(--text-primary)',
          boxShadow: 'var(--shadow-md)',
        }}
        aria-label="Open menu"
      >
        <Menu size={20} />
      </button>

      {/* Mobile overlay backdrop */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-50"
          style={{ background: 'rgba(0, 0, 0, 0.5)' }}
          onClick={closeMobile}
        />
      )}

      {/* Sidebar - desktop: static in flex layout; mobile: fixed overlay */}
      <aside
        className={`
          flex flex-col border-r transition-all duration-200 shrink-0
          max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:w-[260px]
          ${mobileOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full'}
          ${collapsed ? 'md:w-[68px]' : 'md:w-[220px]'}
        `}
        style={{
          background: 'var(--bg-secondary)',
          borderColor: 'var(--border)',
          zIndex: 30,
          position: 'relative',
        }}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
