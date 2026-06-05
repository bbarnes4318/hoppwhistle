'use client';

import React from 'react';
import { ShieldCheck, HelpCircle, X, Check, Ticket, ShoppingBag, Sparkles, Clock, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── 1. PageHeader Component
interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  actions?: React.ReactNode;
  badge?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  icon: Icon,
  actions,
  badge,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        'pb-8 border-b border-[var(--m-border-2)] mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4',
        className
      )}
    >
      <div className="space-y-1.5">
        <div className="flex items-center gap-3">
          {Icon && <Icon className="h-8 w-8 text-[var(--m-accent)] shrink-0" />}
          <h1 className="text-3xl lg:text-4xl font-black tracking-tight text-[var(--m-text)] leading-tight">{title}</h1>
          {badge}
        </div>
        {description && <p className="text-sm lg:text-base text-[var(--m-muted)] font-medium max-w-3xl leading-relaxed">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-3 shrink-0">{actions}</div>}
    </header>
  );
}

// ── 2. MetricCard Component
interface MetricCardProps {
  label: string;
  value: string | number;
  change?: number;
  changeType?: 'increase' | 'decrease' | 'neutral';
  subtext?: string;
  icon?: React.ComponentType<{ className?: string }>;
  tag?: string;
  trendType?: 'positive-is-good' | 'negative-is-good' | 'neutral';
}

export function MetricCard({
  label,
  value,
  change,
  changeType,
  subtext,
  icon: Icon,
  tag,
  trendType = 'positive-is-good',
}: MetricCardProps) {
  let isGood = false;
  let isBad = false;

  if (trendType !== 'neutral') {
    const isIncrease = changeType === 'increase' || (change !== undefined && change > 0);
    const isDecrease = changeType === 'decrease' || (change !== undefined && change < 0);

    if (trendType === 'positive-is-good') {
      isGood = isIncrease;
      isBad = isDecrease;
    } else if (trendType === 'negative-is-good') {
      isGood = isDecrease;
      isBad = isIncrease;
    }
  }

  return (
    <div className="relative bg-[var(--m-surface)] border border-[var(--m-border)] rounded-xl p-6 flex flex-col justify-between min-h-[140px] shadow-[0_1px_3px_rgba(9,9,11,0.01)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--m-dim)] hover:shadow-[0_8px_24px_rgba(9,9,11,0.04)] group">
      {Icon && (
        <div className="absolute top-5 right-5 p-2 rounded-lg bg-gradient-to-br from-[var(--m-surface-2)] to-[var(--m-surface-3)] border border-[var(--m-border)] text-[var(--m-muted)] group-hover:text-[var(--m-accent)] group-hover:border-[var(--m-accent)]/20 transition-all duration-200">
          <Icon className="h-4.5 w-4.5" />
        </div>
      )}
      <div className="space-y-1">
        {tag && (
          <div className="text-[9px] font-black tracking-widest text-[var(--m-muted)] uppercase">
            {tag}
          </div>
        )}
        <div className="text-xs font-bold text-[var(--m-text-2)] uppercase tracking-wider">{label}</div>
      </div>
      <div className="mt-4 flex items-baseline justify-between gap-2">
        <div className="text-3xl lg:text-4xl font-extrabold font-mono tracking-tight text-[var(--m-text)]">{value}</div>
        {change !== undefined && (
          <span
            className={cn(
              'text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border',
              isGood
                ? 'text-[#10B981] bg-[#10B981]/10 border-[#10B981]/20'
                : isBad
                  ? 'text-[#EF4444] bg-[#EF4444]/10 border-[#EF4444]/20'
                  : 'text-zinc-500 bg-zinc-500/10 border-zinc-500/20'
            )}
          >
            {isGood ? '↑' : isBad ? '↓' : ''} {Math.abs(change)}%
          </span>
        )}
      </div>
      {subtext && (
        <div className="text-[10px] text-[var(--m-muted)] mt-3 pt-2.5 border-t border-[var(--m-border-2)] font-medium">
          {subtext}
        </div>
      )}
    </div>
  );
}

// ── 3. PremiumCard Component
interface PremiumCardProps {
  children: React.ReactNode;
  className?: string;
  variant?: 'stone' | 'obsidian' | 'interactive';
}

export function PremiumCard({ children, className, variant = 'stone' }: PremiumCardProps) {
  return (
    <div
      className={cn(
        'm-card p-6',
        variant === 'obsidian' && 'm-dark-mode bg-[var(--m-surface)]',
        variant === 'interactive' &&
          'hover:border-[var(--m-border)] hover:shadow-md cursor-pointer transition-all duration-200',
        className
      )}
    >
      {children}
    </div>
  );
}

// ── 4. StatusBadge Component
interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const norm = status.toLowerCase().replace(/_/g, ' ');
  let modifier = 'm-badge--neutral';

  if (norm === 'active' || norm === 'dialing' || norm === 'running') {
    modifier = 'm-badge--active';
  } else if (norm === 'paused' || norm === 'hold') {
    modifier = 'm-badge--paused';
  } else if (norm === 'completed' || norm === 'ended') {
    modifier = 'm-badge--completed';
  } else if (norm === 'draft') {
    modifier = 'm-badge--draft';
  }

  return (
    <span className={cn('m-badge px-2 py-0.5', modifier, className)}>
      {(norm === 'active' || norm === 'dialing') && (
        <span className="m-pulse-dot mr-1" style={{ width: '6px', height: '6px' }} />
      )}
      {status.toUpperCase()}
    </span>
  );
}

// ── 5. ProofBadge Component
interface ProofBadgeProps {
  outcome: string;
  verified?: boolean;
  className?: string;
}

export function ProofBadge({ outcome, verified = true, className }: ProofBadgeProps) {
  const norm = outcome.toLowerCase().replace(/_/g, ' ');
  
  // Custom styling per outcome: Solid background fills with high-contrast text
  let outcomeIcon = <HelpCircle className="h-3.5 w-3.5 text-white" />;
  let pillColorClass = "bg-zinc-700 text-white border-zinc-600";
  
  if (norm === 'pre saved' || norm === 'pre_saved') {
    outcomeIcon = <Check className="h-3.5 w-3.5 text-white" />;
    pillColorClass = "bg-emerald-600 text-white border-emerald-500 shadow-[0_2px_6px_rgba(16,185,129,0.3)]";
  } else if (norm === 'ticket intent') {
    outcomeIcon = <Ticket className="h-3.5 w-3.5 text-white" />;
    pillColorClass = "bg-cyan-600 text-white border-cyan-500 shadow-[0_2px_6px_rgba(6,182,212,0.3)]";
  } else if (norm === 'merch intent') {
    outcomeIcon = <ShoppingBag className="h-3.5 w-3.5 text-white" />;
    pillColorClass = "bg-amber-600 text-white border-amber-500 shadow-[0_2px_6px_rgba(245,158,11,0.3)]";
  } else if (norm === 'vip interest') {
    outcomeIcon = <Sparkles className="h-3.5 w-3.5 text-white" />;
    pillColorClass = "bg-purple-600 text-white border-purple-500 shadow-[0_2px_6px_rgba(139,92,246,0.3)]";
  } else if (norm === 'needs follow up') {
    outcomeIcon = <Clock className="h-3.5 w-3.5 text-white" />;
    pillColorClass = "bg-rose-600 text-white border-rose-500 shadow-[0_2px_6px_rgba(244,63,94,0.3)]";
  } else if (norm === 'no action') {
    outcomeIcon = <AlertCircle className="h-3.5 w-3.5 text-white" />;
    pillColorClass = "bg-zinc-700 text-white border-zinc-600";
  }

  return (
    <span
      className={cn(
        'm-badge px-3 py-1 flex items-center gap-1.5 border rounded-full font-mono text-[9px] uppercase tracking-wider font-extrabold shadow-sm',
        pillColorClass,
        className
      )}
    >
      {outcomeIcon}
      <span>{norm.toUpperCase()}</span>
      {verified && (
        <span title="Verified Action" className="ml-1 flex items-center text-white">
          <ShieldCheck className="h-3 w-3 fill-white/20" />
        </span>
      )}
    </span>
  );
}

// ── 6. SegmentBadge Component
interface SegmentBadgeProps {
  segment: string;
  className?: string;
}

export function SegmentBadge({ segment, className }: SegmentBadgeProps) {
  const label = segment.replace(/_/g, ' ').replace(/-/g, ' ');
  return (
    <span
      className={cn(
        'px-2 py-0.5 bg-zinc-950 border border-zinc-800 rounded text-[9px] font-mono font-black text-zinc-300 uppercase tracking-widest',
        className
      )}
    >
      {label}
    </span>
  );
}

// ── 7. FilterToolbar Component
interface FilterToolbarProps {
  children: React.ReactNode;
  className?: string;
}

export function FilterToolbar({ children, className }: FilterToolbarProps) {
  return (
    <div
      className={cn(
        'flex flex-col sm:flex-row gap-4 justify-between items-center bg-[var(--m-surface-2)] p-4 border border-[var(--m-border-2)] rounded-lg',
        className
      )}
    >
      {children}
    </div>
  );
}

// ── 8. PremiumDataTable Component
interface PremiumDataTableProps {
  headers: string[];
  children: React.ReactNode;
  className?: string;
}

export function PremiumDataTable({ headers, children, className }: PremiumDataTableProps) {
  return (
    <div className={cn('m-card overflow-hidden w-full', className)}>
      <div className="overflow-x-auto">
        <table className="m-table w-full text-left">
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--m-border-2)]">{children}</tbody>
        </table>
      </div>
    </div>
  );
}

// ── 9. ActionButton Component
interface ActionButtonProps {
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  className?: string;
  disabled?: boolean;
  type?: 'button' | 'submit';
}

export function ActionButton({
  children,
  onClick,
  variant = 'secondary',
  className,
  disabled,
  type = 'button',
}: ActionButtonProps) {
  let btnClass = 'm-btn--secondary';
  if (variant === 'primary') btnClass = 'm-btn--primary';
  else if (variant === 'ghost') btnClass = 'm-btn--ghost';
  else if (variant === 'danger') btnClass = 'm-btn--danger';

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn('m-btn', btnClass, className)}
    >
      {children}
    </button>
  );
}

// ── 10. EmptyState Component
interface EmptyStateProps {
  title: string;
  description: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
}

export function EmptyState({ title, description, icon: Icon, action }: EmptyStateProps) {
  return (
    <div className="m-card p-12 text-center flex flex-col items-center justify-center space-y-4 max-w-lg mx-auto border-dashed">
      {Icon && <Icon className="h-10 w-10 m-text-dim" />}
      <div className="space-y-1">
        <h3 className="text-base font-bold m-text-text">{title}</h3>
        <p className="text-sm m-text-muted leading-relaxed">{description}</p>
      </div>
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}

// ── 11. DetailDrawer Component
interface DetailDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  variant?: 'stone' | 'obsidian';
}

export function DetailDrawer({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  className,
  variant = 'stone',
}: DetailDrawerProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={cn(
          'w-full max-w-lg h-full overflow-y-auto flex flex-col shadow-2xl border-l border-[var(--m-border-2)]',
          variant === 'obsidian' ? 'm-dark-mode bg-[var(--m-bg)]' : 'bg-[var(--m-surface)]',
          className
        )}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[var(--m-border-2)] bg-[var(--m-surface-2)]">
          <div>
            <h2 className="text-lg font-bold m-text-text">{title}</h2>
            {subtitle && <p className="text-xs m-text-dim mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-[var(--m-surface-3)] rounded-full transition-colors"
          >
            <X className="h-5 w-5 m-text-muted" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 p-6 space-y-6">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="p-4 border-t border-[var(--m-border-2)] bg-[var(--m-surface-2)] shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
