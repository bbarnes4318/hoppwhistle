'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import * as React from 'react';

import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogPortal,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

import { useThemeScope } from './theme-scope';

/**
 * SheetDrawer — right-side detail panel, replacing full-page navigation.
 *
 * Opening a call should not cost you the list you found it in. The drawer keeps
 * the table on screen and keeps your scroll position, so reviewing twenty calls
 * is twenty glances instead of twenty round trips.
 *
 * Built on the same @radix-ui/react-dialog primitive as ui/dialog.tsx, reusing
 * its Dialog / Portal / Title / Description / Close. It does NOT reuse
 * DialogContent: that component hardcodes a centred modal (left-50% top-50%
 * with a zoom-in animation) and turning it into an edge-anchored panel would
 * mean overriding a dozen classes and hoping tailwind-merge resolves each one.
 * This is the same reason shadcn ships sheet.tsx separately from dialog.tsx.
 */

export interface SheetDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Required: the drawer's accessible name. */
  title: React.ReactNode;
  /** Optional line under the title — a call ID, a timestamp. */
  description?: React.ReactNode;
  /** Pinned to the bottom, outside the scroll area. */
  footer?: React.ReactNode;
  children: React.ReactNode;
  side?: 'right' | 'left';
  size?: 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZE_CLASS = {
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  xl: 'sm:max-w-2xl',
} as const;

export function SheetDrawer({
  open,
  onOpenChange,
  title,
  description,
  footer,
  children,
  side = 'right',
  size = 'lg',
  className,
}: SheetDrawerProps) {
  // The drawer is portalled to document.body, outside any data-theme subtree,
  // so it has to carry the scope itself. See theme-scope.tsx.
  const theme = useThemeScope();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogPrimitive.Overlay
          data-theme={theme}
          className={cn(
            'fixed inset-0 z-50 bg-ink/20',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0'
          )}
        />
        <DialogPrimitive.Content
          data-theme={theme}
          className={cn(
            'fixed inset-y-0 z-50 flex w-full flex-col border-rule bg-surface',
            // Full width on a phone, a panel from the edge above that.
            SIZE_CLASS[size],
            side === 'right' ? 'right-0 border-l' : 'left-0 border-r',
            'data-[state=open]:animate-in data-[state=closed]:animate-out duration-200',
            side === 'right'
              ? 'data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right'
              : 'data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left',
            className
          )}
        >
          <header className="flex items-start justify-between gap-3 border-b border-rule px-4 py-3">
            <div className="min-w-0">
              <DialogTitle className="t-section truncate text-ink">{title}</DialogTitle>
              {description ? (
                <DialogDescription className="t-meta mt-0.5 truncate text-ink-3">
                  {description}
                </DialogDescription>
              ) : (
                // Radix warns without a description; this satisfies it silently
                // when the caller has nothing meaningful to say.
                <DialogDescription className="sr-only">Detail panel</DialogDescription>
              )}
            </div>

            <DialogClose
              className={cn(
                'shrink-0 rounded-control p-1 text-ink-3',
                'hover:bg-sunken hover:text-ink focus-visible:outline-none'
              )}
              aria-label="Close panel"
            >
              <X aria-hidden className="h-4 w-4" />
            </DialogClose>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>

          {footer ? <footer className="border-t border-rule px-4 py-3">{footer}</footer> : null}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

/** Labelled row for drawer bodies — the shape most detail content takes. */
export function DrawerField({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid grid-cols-[minmax(96px,34%)_1fr] gap-3 py-1.5', className)}>
      <dt className="t-meta text-ink-3">{label}</dt>
      <dd className="t-body min-w-0 break-words text-ink">{children}</dd>
    </div>
  );
}

export function DrawerSection({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('border-b border-rule px-4 py-3 last:border-0', className)}>
      <h3 className="t-label mb-2 text-ink-3">{title}</h3>
      <dl>{children}</dl>
    </section>
  );
}
