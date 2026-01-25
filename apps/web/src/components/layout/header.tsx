'use client';

/**
 * Project Cortex | Protocol Status Bar Header
 *
 * Replaces generic "Welcome" with system telemetry display.
 * Uses JetBrains Mono for data readouts.
 */

import { motion } from 'framer-motion';
import { Bell, Search, User, Wifi, WifiOff, Activity } from 'lucide-react';
import { useState, useEffect } from 'react';

import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LiveCallOrb } from '@/components/ui/neural-orb';
import { cn } from '@/lib/utils';

interface StatusMetric {
  label: string;
  value: string;
  status: 'online' | 'warning' | 'error' | 'neutral';
}

function useSystemStatus(): StatusMetric[] {
  const [latency, setLatency] = useState(12);
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    // Simulate latency fluctuation
    const interval = setInterval(() => {
      setLatency(Math.floor(Math.random() * 20) + 8);
    }, 5000);

    // Monitor online status
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      clearInterval(interval);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return [
    {
      label: 'SYSTEM',
      value: isOnline ? 'ONLINE' : 'OFFLINE',
      status: isOnline ? 'online' : 'error',
    },
    {
      label: 'LATENCY',
      value: `${latency}ms`,
      status: latency < 50 ? 'online' : latency < 100 ? 'warning' : 'error',
    },
    {
      label: 'UPTIME',
      value: '99.97%',
      status: 'online',
    },
  ];
}

function StatusIndicator({ metric }: { metric: StatusMetric }) {
  const statusColors = {
    online: 'text-neon-cyan',
    warning: 'text-toxic-lime',
    error: 'text-status-error',
    neutral: 'text-text-muted',
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-text-muted font-mono text-xs">{metric.label}:</span>
      <span className={cn('font-mono text-xs font-medium', statusColors[metric.status])}>
        {metric.value}
      </span>
    </div>
  );
}

export function Header() {
  const systemStatus = useSystemStatus();
  const isOnline = systemStatus[0].value === 'ONLINE';

  return (
    <header className="flex h-14 items-center justify-between border-b border-white/5 bg-panel px-6">
      {/* Left: Protocol Status Bar */}
      <div className="flex items-center gap-6">
        {/* Connection Indicator */}
        <div className="flex items-center gap-2">
          <motion.div
            className={cn('w-2 h-2 rounded-full', isOnline ? 'bg-neon-cyan' : 'bg-status-error')}
            animate={isOnline ? { scale: [1, 1.2, 1] } : {}}
            transition={{ duration: 2, repeat: Infinity }}
          />
          {isOnline ? (
            <Wifi className="h-4 w-4 text-neon-cyan" />
          ) : (
            <WifiOff className="h-4 w-4 text-status-error" />
          )}
        </div>

        {/* Status Metrics */}
        <div className="hidden md:flex items-center gap-4">
          {systemStatus.map((metric, index) => (
            <div key={metric.label} className="flex items-center gap-4">
              <StatusIndicator metric={metric} />
              {index < systemStatus.length - 1 && (
                <span className="text-white/10 font-mono">//</span>
              )}
            </div>
          ))}
        </div>

        {/* Mobile: Compact Status */}
        <div className="md:hidden flex items-center gap-2">
          <Activity className="h-4 w-4 text-neon-cyan" />
          <span className="font-mono text-xs text-neon-cyan">{systemStatus[1].value}</span>
        </div>
      </div>

      {/* Center: Search */}
      <div className="hidden lg:flex flex-1 max-w-md mx-8">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <Input
            type="search"
            id="global-search"
            name="global-search"
            placeholder="Vectoring... search calls, numbers, campaigns"
            className={cn(
              'pl-10 bg-void border-white/10',
              'placeholder:text-text-muted/50 placeholder:font-mono placeholder:text-xs',
              'focus:border-neon-cyan focus:ring-neon-cyan/20'
            )}
          />
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-3">
        {/* LiveCallOrb - Pulses Toxic Lime when calls active */}
        <LiveCallOrb activeCalls={23} />

        {/* Notifications */}
        <Button
          variant="ghost"
          size="icon"
          className="text-text-secondary hover:text-neon-cyan hover:bg-white/5"
        >
          <Bell className="h-5 w-5" />
        </Button>

        {/* Theme Toggle */}
        <ThemeToggle />

        {/* User */}
        <Button
          variant="ghost"
          size="icon"
          className="text-text-secondary hover:text-neon-cyan hover:bg-white/5"
        >
          <User className="h-5 w-5" />
        </Button>
      </div>
    </header>
  );
}
