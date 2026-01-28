'use client';

import { User, ChevronDown, Check } from 'lucide-react';
import React, { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { JOB_ROLES, type JobRole, getScriptAccessForRole } from '@/lib/call-center/types';
import { cn } from '@/lib/utils';

// ============================================================================
// ROLE BADGE COLORS
// ============================================================================

const ROLE_COLORS: Record<JobRole, string> = {
  [JOB_ROLES.LEAD_DEVELOPMENT]: 'bg-slate-500',
  [JOB_ROLES.QA_SPECIALIST]: 'bg-slate-500',
  [JOB_ROLES.JUNIOR_ENROLLMENT_COORDINATOR]: 'bg-slate-500',
  [JOB_ROLES.SENIOR_ENROLLMENT_COORDINATOR]: 'bg-slate-500',
  [JOB_ROLES.STATE_LICENSED_UNDERWRITER]: 'bg-blue-500',
  [JOB_ROLES.CLIENT_SUCCESS_MANAGER]: 'bg-purple-500',
  [JOB_ROLES.PLACEMENT_SPECIALIST]: 'bg-purple-500',
  [JOB_ROLES.PLACEMENT_MANAGER]: 'bg-purple-500',
  [JOB_ROLES.SALES_MANAGER]: 'bg-emerald-500',
  [JOB_ROLES.PARTNER]: 'bg-amber-500',
};

// ============================================================================
// ROLE SELECTOR (Dialog-based)
// ============================================================================

interface RoleSelectorProps {
  className?: string;
}

export function RoleSelector({ className }: RoleSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [userRole, setUserRoleState] = useState<JobRole>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('hopwhistle_user_role') as JobRole | null;
      if (saved && Object.values(JOB_ROLES).includes(saved)) {
        return saved;
      }
    }
    return JOB_ROLES.STATE_LICENSED_UNDERWRITER;
  });

  const setUserRole = (role: JobRole) => {
    setUserRoleState(role);
    if (typeof window !== 'undefined') {
      localStorage.setItem('hopwhistle_user_role', role);
    }
  };

  const access = getScriptAccessForRole(userRole);
  const scriptBadge =
    access.scripts.length === 0
      ? 'No Scripts'
      : access.scripts.length === 2
        ? 'All Scripts'
        : access.scripts[0] === 'underwriter'
          ? 'Underwriter'
          : 'Placement';

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className={cn('gap-2 h-8', className)}>
          <div className={cn('h-2 w-2 rounded-full', ROLE_COLORS[userRole])} />
          <span className="hidden sm:inline text-xs">{userRole}</span>
          <span className="text-xs text-muted-foreground">({scriptBadge})</span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Select Your Role</DialogTitle>
          <DialogDescription>
            Your role determines which scripts you can access in the Call Center.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-4 max-h-[400px] overflow-y-auto">
          {Object.values(JOB_ROLES).map(role => {
            const roleAccess = getScriptAccessForRole(role);
            const isActive = role === userRole;
            return (
              <button
                key={role}
                onClick={() => {
                  setUserRole(role);
                  setIsOpen(false);
                }}
                className={cn(
                  'flex items-center justify-between rounded-lg border p-3 text-left transition-colors',
                  isActive
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50 hover:bg-muted'
                )}
              >
                <div className="flex items-center gap-3">
                  <div className={cn('h-3 w-3 rounded-full', ROLE_COLORS[role])} />
                  <span className="font-medium text-sm">{role}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {roleAccess.scripts.length === 0
                      ? 'No scripts'
                      : roleAccess.scripts.length === 2
                        ? 'All scripts'
                        : roleAccess.scripts[0] === 'underwriter'
                          ? 'Script A'
                          : 'Script B'}
                  </span>
                  {isActive && <Check className="h-4 w-4 text-primary" />}
                </div>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// SCRIPT TOGGLE (for Manager/Partner roles)
// ============================================================================

interface ScriptToggleProps {
  className?: string;
  activeScript: 'underwriter' | 'placement';
  onScriptChange: (script: 'underwriter' | 'placement') => void;
  canToggle: boolean;
}

export function ScriptToggle({
  className,
  activeScript,
  onScriptChange,
  canToggle,
}: ScriptToggleProps) {
  // Only show for roles that can toggle
  if (!canToggle) {
    return null;
  }

  return (
    <div className={cn('flex items-center gap-1 rounded-lg bg-muted p-1', className)}>
      <button
        onClick={() => onScriptChange('underwriter')}
        className={cn(
          'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
          activeScript === 'underwriter'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        Underwriter (A)
      </button>
      <button
        onClick={() => onScriptChange('placement')}
        className={cn(
          'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
          activeScript === 'placement'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        Placement (B)
      </button>
    </div>
  );
}

// ============================================================================
// USER SETTINGS PANEL (for Settings page)
// ============================================================================

export function UserRoleSettings() {
  const [userRole, setUserRoleState] = useState<JobRole>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('hopwhistle_user_role') as JobRole | null;
      if (saved && Object.values(JOB_ROLES).includes(saved)) {
        return saved;
      }
    }
    return JOB_ROLES.STATE_LICENSED_UNDERWRITER;
  });

  const setUserRole = (role: JobRole) => {
    setUserRoleState(role);
    if (typeof window !== 'undefined') {
      localStorage.setItem('hopwhistle_user_role', role);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium">Job Role</h3>
        <p className="text-sm text-muted-foreground">
          Select your role to access the appropriate scripts in the Call Center.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {Object.values(JOB_ROLES).map(role => {
          const access = getScriptAccessForRole(role);
          const isActive = role === userRole;

          return (
            <button
              key={role}
              onClick={() => setUserRole(role)}
              className={cn(
                'flex items-center gap-3 rounded-lg border p-4 text-left transition-all',
                isActive
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border hover:border-primary/50'
              )}
            >
              <div className={cn('h-4 w-4 rounded-full', ROLE_COLORS[role])} />
              <div className="flex-1">
                <div className="font-medium">{role}</div>
                <div className="text-xs text-muted-foreground">
                  {access.scripts.length === 0
                    ? 'No script access'
                    : access.scripts.length === 2
                      ? 'All scripts (toggle)'
                      : access.scripts[0] === 'underwriter'
                        ? 'Underwriter script'
                        : 'Placement script'}
                </div>
              </div>
              {isActive && <Check className="h-5 w-5 text-primary" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
