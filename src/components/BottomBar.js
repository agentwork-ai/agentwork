'use client';

import { useStatus } from '@/app/providers';
import { Activity, Cpu, DollarSign, Coins, Wifi, WifiOff } from 'lucide-react';

export default function BottomBar() {
  const status = useStatus();

  return (
    <footer
      className="flex items-center justify-between px-2 md:px-4 h-9 border-t text-xs shrink-0"
      style={{
        background: 'var(--bg-secondary)',
        borderColor: 'var(--border)',
        color: 'var(--text-tertiary)',
      }}
    >
      <div className="flex items-center gap-2 md:gap-4">
        {/* Connection status */}
        <div className="flex items-center gap-1.5">
          {status.connected ? (
            <>
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse-slow" />
              <span style={{ color: 'var(--success)' }}>Connected</span>
            </>
          ) : (
            <>
              <div className="w-2 h-2 rounded-full bg-red-500" />
              <span style={{ color: 'var(--danger)' }}>Disconnected</span>
            </>
          )}
        </div>

        {/* Active agents - hidden on mobile */}
        <div className="hidden md:flex items-center gap-1.5">
          <Cpu size={13} />
          <span>{status.activeAgents || 0} agents active</span>
        </div>

        {/* Active tasks - hidden on mobile */}
        <div className="hidden md:flex items-center gap-1.5">
          <Activity size={13} />
          <span>{status.activeTasks || 0} tasks running</span>
        </div>
      </div>

      <div className="flex items-center gap-2 md:gap-4">
        {/* Token usage - hidden on mobile */}
        <div className="hidden md:flex items-center gap-1.5">
          <Coins size={13} />
          <span>{formatTokens(status.totalTokens || 0)} tokens</span>
        </div>

        {/* Cost - always visible */}
        <div className="flex items-center gap-1.5">
          <DollarSign size={13} />
          <span>${(status.dailySpend || 0).toFixed(4)}</span>
        </div>
      </div>
    </footer>
  );
}

function formatTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
