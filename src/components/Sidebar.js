'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from '@/app/providers';
import {
  LayoutDashboard,
  FolderKanban,
  Columns3,
  MessageSquare,
  Building2,
  Users,
  Settings,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  Zap,
} from 'lucide-react';

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/kanban', label: 'Tasks', icon: Columns3 },
  { href: '/chat', label: 'Chat', icon: MessageSquare },
  { href: '/office', label: 'Office', icon: Building2 },
  { href: '/agents', label: 'Agents', icon: Users },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [notifications, setNotifications] = useState(0);

  return (
    <aside
      className={`flex flex-col border-r transition-all duration-200 ${
        collapsed ? 'w-[68px]' : 'w-[220px]'
      }`}
      style={{
        background: 'var(--bg-secondary)',
        borderColor: 'var(--border)',
      }}
    >
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
            AgentHub
          </span>
        )}
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
                collapsed ? 'justify-center' : ''
              }`}
              style={{
                background: isActive ? 'var(--accent-light)' : 'transparent',
                color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
              }}
              title={collapsed ? item.label : undefined}
            >
              <div className="relative">
                <Icon size={20} />
                {item.href === '/chat' && notifications > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 text-[10px] font-bold text-white bg-red-500 rounded-full flex items-center justify-center">
                    {notifications}
                  </span>
                )}
              </div>
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Bottom actions */}
      <div className="p-2 border-t space-y-1" style={{ borderColor: 'var(--border)' }}>
        <button
          onClick={toggleTheme}
          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm w-full transition-colors ${
            collapsed ? 'justify-center' : ''
          }`}
          style={{ color: 'var(--text-secondary)' }}
        >
          {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          {!collapsed && <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>}
        </button>

        <button
          onClick={() => setCollapsed(!collapsed)}
          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm w-full transition-colors ${
            collapsed ? 'justify-center' : ''
          }`}
          style={{ color: 'var(--text-tertiary)' }}
        >
          {collapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
