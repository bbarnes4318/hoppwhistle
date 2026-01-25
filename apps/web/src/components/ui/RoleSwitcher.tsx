'use client';

/**
 * Project Cortex | Role Switcher
 *
 * Dev tool for switching between user roles.
 * Only visible in development mode.
 */

import { User, ShieldCheck, Rss } from 'lucide-react';
import { useUser, UserRole } from '@/contexts/UserContext';
import { cn } from '@/lib/utils';

const roles: { role: UserRole; label: string; icon: typeof User }[] = [
  { role: 'operator', label: 'OPERATOR', icon: User },
  { role: 'publisher', label: 'PUBLISHER', icon: Rss },
  { role: 'admin', label: 'ADMIN', icon: ShieldCheck },
];

export function RoleSwitcher({ className }: { className?: string }) {
  const { user, switchRole } = useUser();

  return (
    <div
      className={cn(
        'flex items-center gap-1 p-1 rounded-lg bg-panel/50 border border-white/5',
        className
      )}
    >
      {roles.map(({ role, label, icon: Icon }) => (
        <button
          key={role}
          onClick={() => switchRole(role)}
          className={cn(
            'flex items-center gap-1.5 px-2 py-1 rounded-md transition-all',
            'font-mono text-[9px] uppercase tracking-wider',
            user?.role === role
              ? 'bg-neon-cyan text-void'
              : 'text-text-muted hover:text-text-primary hover:bg-white/5'
          )}
        >
          <Icon className="h-3 w-3" />
          {label}
        </button>
      ))}
    </div>
  );
}

export default RoleSwitcher;
