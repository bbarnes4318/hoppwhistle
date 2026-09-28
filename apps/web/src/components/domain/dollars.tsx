import { cn } from '@/lib/utils';

/**
 * Dollars in a table cell: cents always (tables are what gets added up), a
 * zero in ink-3, and an em dash in ink-3 for no value -- never a coloured
 * $0.00, and never a blank that could be mistaken for a missing column.
 */
export function Dollars({
  value,
  className,
}: {
  value: number | null | undefined;
  className?: string;
}): JSX.Element {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return <span className={cn('tabular-nums text-ink-3', className)}>—</span>;
  }
  const text = `${value < 0 ? '−' : ''}$${Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  return (
    <span className={cn('tabular-nums whitespace-nowrap', value === 0 && 'text-ink-3', className)}>
      {text}
    </span>
  );
}
