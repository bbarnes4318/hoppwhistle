'use client';

/**
 * Project Cortex | Node Input Component
 *
 * Dark cyberpunk-styled input with neon focus states.
 * NO WHITE INPUTS - all dark backgrounds.
 */

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface NodeInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Show error state */
  error?: boolean;
}

const NodeInput = React.forwardRef<HTMLInputElement, NodeInputProps>(
  ({ className, type, error, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // Base styles - dark background
          'flex h-10 w-full rounded-lg px-4 py-2',
          'bg-panel border border-white/10',
          'text-text-primary font-mono text-sm',
          // Placeholder
          'placeholder:text-text-muted/50 placeholder:font-mono',
          // Focus states - neon cyan glow
          'focus:outline-none focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30',
          'focus:shadow-[0_0_8px_rgba(0,229,255,0.15)]',
          // Transitions
          'transition-all duration-200',
          // Disabled
          'disabled:cursor-not-allowed disabled:opacity-50',
          // Error state
          error && 'border-status-error focus:border-status-error focus:ring-status-error/30',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
NodeInput.displayName = 'NodeInput';

/**
 * Node Textarea - Dark cyberpunk-styled textarea
 */
export interface NodeTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Show error state */
  error?: boolean;
}

const NodeTextarea = React.forwardRef<HTMLTextAreaElement, NodeTextareaProps>(
  ({ className, error, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          // Base styles - dark background
          'flex min-h-[120px] w-full rounded-lg px-4 py-3',
          'bg-panel border border-white/10',
          'text-text-primary font-mono text-sm leading-relaxed',
          // Placeholder
          'placeholder:text-text-muted/50 placeholder:font-mono',
          // Focus states - neon cyan glow
          'focus:outline-none focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30',
          'focus:shadow-[0_0_8px_rgba(0,229,255,0.15)]',
          // Transitions
          'transition-all duration-200',
          // Resize
          'resize-none',
          // Disabled
          'disabled:cursor-not-allowed disabled:opacity-50',
          // Error state
          error && 'border-status-error focus:border-status-error focus:ring-status-error/30',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
NodeTextarea.displayName = 'NodeTextarea';

export { NodeInput, NodeTextarea };
