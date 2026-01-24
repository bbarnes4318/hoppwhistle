'use client';

/**
 * Project Cortex | Command Grid Component
 *
 * Grid layout container with glassmorphism panels.
 * The structural backbone of the Neuro-Luminescent UI.
 */

import { motion, type Variants } from 'framer-motion';
import { type ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface CommandGridProps {
  children: ReactNode;
  /** Grid columns (responsive) */
  columns?: 1 | 2 | 3 | 4 | 'auto';
  /** Gap between panels */
  gap?: 'sm' | 'md' | 'lg';
  /** Additional classes */
  className?: string;
}

interface CommandPanelProps {
  children: ReactNode;
  /** Panel title */
  title?: string;
  /** Telemetry label (top-right) */
  telemetry?: string;
  /** Panel variant */
  variant?: 'default' | 'accent' | 'highlight';
  /** Span columns */
  span?: 1 | 2 | 3 | 4 | 'full';
  /** Loading state */
  isLoading?: boolean;
  /** Additional classes */
  className?: string;
}

const gapClasses = {
  sm: 'gap-2',
  md: 'gap-4',
  lg: 'gap-6',
};

const columnClasses = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 md:grid-cols-2',
  3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4',
  auto: 'grid-cols-[repeat(auto-fit,minmax(280px,1fr))]',
};

const spanClasses = {
  1: 'col-span-1',
  2: 'col-span-1 md:col-span-2',
  3: 'col-span-1 md:col-span-2 lg:col-span-3',
  4: 'col-span-1 md:col-span-2 lg:col-span-4',
  full: 'col-span-full',
};

const panelVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

const variantStyles = {
  default: 'glass-panel',
  accent: 'glass-panel-cyan',
  highlight: 'glass-panel border-brand-cyan/30',
};

/**
 * Command Grid - Main layout container
 */
export function CommandGrid({
  children,
  columns = 'auto',
  gap = 'md',
  className,
}: CommandGridProps) {
  return (
    <div className={cn('grid', columnClasses[columns], gapClasses[gap], className)}>{children}</div>
  );
}

/**
 * Command Panel - Individual grid cell with glassmorphism
 */
export function CommandPanel({
  children,
  title,
  telemetry,
  variant = 'default',
  span = 1,
  isLoading = false,
  className,
}: CommandPanelProps) {
  return (
    <motion.div
      className={cn(
        'relative rounded-lg p-4',
        variantStyles[variant],
        spanClasses[span],
        'overflow-hidden',
        className
      )}
      variants={panelVariants}
      initial="hidden"
      animate="visible"
      transition={{ duration: 0.3 }}
    >
      {/* Header */}
      {(title || telemetry) && (
        <div className="flex items-center justify-between mb-4">
          {title && (
            <h3 className="font-display text-sm font-semibold text-text-primary uppercase tracking-wide">
              {title}
            </h3>
          )}
          {telemetry && <span className="telemetry-label">{telemetry}</span>}
        </div>
      )}

      {/* Content */}
      <div className={cn('relative', isLoading && 'opacity-50')}>{children}</div>

      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.div
            className="w-8 h-8 border-2 border-brand-cyan border-t-transparent rounded-full"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          />
        </div>
      )}

      {/* Scan Line Effect (optional, for accent panels) */}
      {variant === 'accent' && (
        <motion.div
          className="absolute inset-0 pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.1, 0] }}
          transition={{ duration: 3, repeat: Infinity }}
          style={{
            background:
              'linear-gradient(to bottom, transparent, rgba(0, 229, 255, 0.1), transparent)',
          }}
        />
      )}
    </motion.div>
  );
}

/**
 * Command Header - Page header with grid styling
 */
export function CommandHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6',
        className
      )}
    >
      <div>
        <h1 className="font-display text-2xl md:text-3xl font-bold text-text-primary text-gradient-iridescent">
          {title}
        </h1>
        {subtitle && <p className="telemetry-label mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}

/**
 * Command Divider - Horizontal rule with grid styling
 */
export function CommandDivider({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'h-px bg-gradient-to-r from-transparent via-grid-line to-transparent my-4',
        className
      )}
    />
  );
}

/**
 * Command Footer - Panel footer with telemetry
 */
export function CommandFooter({
  left,
  right,
  className,
}: {
  left?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between pt-4 mt-4 border-t border-grid-line',
        className
      )}
    >
      <div className="telemetry-label">{left}</div>
      <div className="telemetry-label">{right}</div>
    </div>
  );
}

export default CommandGrid;
