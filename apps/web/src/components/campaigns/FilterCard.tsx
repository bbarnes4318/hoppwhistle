'use client';

/**
 * Project Cortex | Filter Card
 *
 * Individual filter toggle card for Logic Gate column.
 * Glassmorphism styling with toggle switch.
 */

import { motion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';

interface FilterCardProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  children?: React.ReactNode;
  className?: string;
}

export function FilterCard({
  icon: Icon,
  title,
  description,
  enabled,
  onToggle,
  children,
  className,
}: FilterCardProps) {
  return (
    <motion.div
      layout
      className={cn(
        'rounded-xl overflow-hidden transition-all duration-300',
        'bg-panel/40 backdrop-blur-md border',
        enabled ? 'border-neon-cyan/30 shadow-[0_0_15px_rgba(0,229,255,0.1)]' : 'border-white/5',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-white/5">
        <div className="flex items-center gap-2">
          <Icon
            className={cn(
              'h-4 w-4 transition-colors',
              enabled ? 'text-neon-cyan' : 'text-text-muted'
            )}
          />
          <span
            className={cn(
              'font-mono text-xs uppercase tracking-widest transition-colors',
              enabled ? 'text-text-primary' : 'text-text-muted'
            )}
          >
            {title}
          </span>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={onToggle}
          className="data-[state=checked]:bg-neon-cyan"
        />
      </div>

      {/* Content (only shown when enabled) */}
      {enabled && children && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="p-3"
        >
          {description && (
            <p className="font-mono text-[10px] text-text-muted mb-2">{description}</p>
          )}
          {children}
        </motion.div>
      )}
    </motion.div>
  );
}

export default FilterCard;
