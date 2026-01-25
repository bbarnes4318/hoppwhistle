'use client';

/**
 * Project Cortex | Glass Panel Component
 *
 * Frosted glass container with optional left accent bar.
 * Used for Node Flow interface sections.
 */

import { cn } from '@/lib/utils';

export interface GlassPanelProps {
  /** Shows glowing left accent bar */
  active?: boolean;
  /** Accent color for the left bar */
  accentColor?: 'cyan' | 'violet' | 'lime';
  /** Panel title */
  title?: string;
  /** Panel subtitle/description */
  subtitle?: string;
  /** Icon component */
  icon?: React.ReactNode;
  /** Additional class names */
  className?: string;
  /** Children */
  children: React.ReactNode;
}

const accentColors = {
  cyan: {
    bar: 'bg-neon-cyan',
    glow: 'shadow-[0_0_12px_rgba(0,229,255,0.5)]',
    text: 'text-neon-cyan',
  },
  violet: {
    bar: 'bg-neon-violet',
    glow: 'shadow-[0_0_12px_rgba(156,74,255,0.5)]',
    text: 'text-neon-violet',
  },
  lime: {
    bar: 'bg-toxic-lime',
    glow: 'shadow-[0_0_12px_rgba(204,255,0,0.5)]',
    text: 'text-toxic-lime',
  },
};

export function GlassPanel({
  active = false,
  accentColor = 'violet',
  title,
  subtitle,
  icon,
  className,
  children,
}: GlassPanelProps) {
  const accent = accentColors[accentColor];

  return (
    <div
      className={cn(
        'relative rounded-xl overflow-hidden',
        'bg-panel/60 backdrop-blur-xl',
        'border border-white/5',
        'transition-all duration-300',
        className
      )}
    >
      {/* Active Accent Bar */}
      {active && (
        <div className={cn('absolute left-0 top-0 h-full w-1', accent.bar, accent.glow)} />
      )}

      {/* Header */}
      {(title || subtitle) && (
        <div className={cn('px-6 pt-6 pb-4', active && 'pl-8')}>
          <div className="flex items-center gap-3">
            {icon && (
              <div className={cn('shrink-0', active ? accent.text : 'text-text-muted')}>{icon}</div>
            )}
            <div>
              {title && (
                <h3
                  className={cn(
                    'font-display text-sm font-semibold uppercase tracking-widest',
                    active ? accent.text : 'text-text-primary'
                  )}
                >
                  {title}
                </h3>
              )}
              {subtitle && <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>}
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className={cn('px-6 pb-6', active && 'pl-8', !title && 'pt-6')}>{children}</div>
    </div>
  );
}

/**
 * Node Connector - Vertical line between nodes
 */
export function NodeConnector({ className }: { className?: string }) {
  return (
    <div className={cn('flex justify-center py-3', className)}>
      <div className="w-0.5 h-8 bg-[#273140] rounded-full" />
    </div>
  );
}

export default GlassPanel;
