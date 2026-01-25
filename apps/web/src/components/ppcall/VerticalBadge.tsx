'use client';

/**
 * Project Cortex | Vertical Badge
 *
 * Colored badge for PPCall vertical categories.
 */

import { cn } from '@/lib/utils';
import { getVertical, getVerticalColorClass, VERTICALS } from '@/data/verticals';
import type { Vertical } from '@/types/ppcall';

interface VerticalBadgeProps {
  /** Vertical ID or Vertical object */
  vertical: string | Vertical;
  /** Show icon */
  showIcon?: boolean;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Additional class names */
  className?: string;
}

export function VerticalBadge({
  vertical,
  showIcon = true,
  size = 'md',
  className,
}: VerticalBadgeProps) {
  // Get vertical data
  const verticalData = typeof vertical === 'string' ? getVertical(vertical) : vertical;

  if (!verticalData) {
    return (
      <span className={cn('font-mono text-xs text-text-muted uppercase', className)}>
        {typeof vertical === 'string' ? vertical : 'UNKNOWN'}
      </span>
    );
  }

  const colorClass = getVerticalColorClass(verticalData.color);

  const sizeClasses = {
    sm: 'px-1.5 py-0.5 text-[10px] gap-1',
    md: 'px-2 py-1 text-xs gap-1.5',
    lg: 'px-3 py-1.5 text-sm gap-2',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border font-mono font-semibold uppercase tracking-wider',
        colorClass,
        sizeClasses[size],
        className
      )}
    >
      {showIcon && <span>{verticalData.icon}</span>}
      <span>{verticalData.shortName}</span>
    </span>
  );
}

/**
 * VerticalSelector - Grid of selectable vertical badges
 */
export function VerticalSelector({
  selected,
  onSelect,
  category,
  className,
}: {
  selected?: string[];
  onSelect?: (verticalId: string) => void;
  category?: string;
  className?: string;
}) {
  const verticals = category ? VERTICALS.filter(v => v.category === category) : VERTICALS;

  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {verticals.map(vertical => {
        const isSelected = selected?.includes(vertical.id);
        const colorClass = getVerticalColorClass(vertical.color);

        return (
          <button
            key={vertical.id}
            onClick={() => onSelect?.(vertical.id)}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-mono text-xs uppercase tracking-wider',
              'transition-all duration-200',
              isSelected
                ? cn(colorClass, 'shadow-[0_0_10px_currentColor]')
                : 'border-white/10 text-text-muted hover:border-white/20 hover:text-text-primary'
            )}
          >
            <span>{vertical.icon}</span>
            <span>{vertical.shortName}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * VerticalCategoryTabs - Tabs for vertical categories
 */
export function VerticalCategoryTabs({
  selected,
  onSelect,
  className,
}: {
  selected?: string;
  onSelect?: (category: string) => void;
  className?: string;
}) {
  const categories = [
    { id: 'insurance', label: 'INSURANCE', color: 'text-neon-cyan' },
    { id: 'legal', label: 'LEGAL', color: 'text-neon-violet' },
    { id: 'home_services', label: 'HOME SERVICES', color: 'text-toxic-lime' },
    { id: 'dme', label: 'DME', color: 'text-neon-mint' },
  ];

  return (
    <div
      className={cn(
        'flex items-center gap-1 p-1 rounded-lg bg-panel border border-white/5',
        className
      )}
    >
      {categories.map(cat => (
        <button
          key={cat.id}
          onClick={() => onSelect?.(cat.id)}
          className={cn(
            'px-3 py-1.5 rounded-md font-mono text-xs uppercase tracking-widest transition-all duration-200',
            selected === cat.id
              ? cn(cat.color, 'bg-white/5')
              : 'text-text-muted hover:text-text-primary'
          )}
        >
          {cat.label}
        </button>
      ))}
    </div>
  );
}

export default VerticalBadge;
