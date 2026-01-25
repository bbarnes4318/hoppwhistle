'use client';

/**
 * Project Cortex | Node Label Component
 *
 * Monospace uppercase label for Node Flow interface.
 */

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface NodeLabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  /** Optional icon */
  icon?: React.ReactNode;
  /** Required indicator */
  required?: boolean;
}

const NodeLabel = React.forwardRef<HTMLLabelElement, NodeLabelProps>(
  ({ className, children, icon, required, ...props }, ref) => {
    return (
      <label
        ref={ref}
        className={cn(
          'flex items-center gap-2 mb-2',
          'text-xs font-mono font-semibold',
          'text-neon-cyan uppercase tracking-widest',
          className
        )}
        {...props}
      >
        {icon && <span className="text-neon-cyan">{icon}</span>}
        {children}
        {required && <span className="text-status-error">*</span>}
      </label>
    );
  }
);
NodeLabel.displayName = 'NodeLabel';

/**
 * Node Field - Combined label + input wrapper
 */
export function NodeField({
  label,
  icon,
  required,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  icon?: React.ReactNode;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-2', className)}>
      <NodeLabel icon={icon} required={required}>
        {label}
      </NodeLabel>
      {children}
      {hint && !error && <p className="text-xs text-text-muted font-mono">{hint}</p>}
      {error && <p className="text-xs text-status-error font-mono">{error}</p>}
    </div>
  );
}

export { NodeLabel };
