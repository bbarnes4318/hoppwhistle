import { X } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

import { FOCUS_RING, Kbd, TOUCH_TARGET } from './parts';
import { SHORTCUTS } from './shortcuts';

/**
 * The shortcut list, laid over the open panel. "?" opens it, Esc or the X
 * closes it. Letters do nothing while the cursor is in a text field, and the
 * sheet says so, because that is the first thing anyone wonders.
 */
export function ShortcutsSheet({ onClose }: { onClose: () => void }): JSX.Element {
  const closeRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    closeRef.current?.focus();
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
      className="absolute inset-0 z-20 flex flex-col bg-surface animate-in fade-in-0 duration-150 motion-reduce:animate-none"
    >
      <div className="flex items-center justify-between border-b border-rule px-4 py-3">
        <h3 className="t-section text-ink">Keyboard shortcuts</h3>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close shortcuts"
          className={cn(
            'inline-flex h-8 w-8 items-center justify-center rounded-control text-ink-2 hover:bg-sunken hover:text-ink',
            FOCUS_RING,
            TOUCH_TARGET
          )}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <dl className="flex-1 divide-y divide-rule overflow-y-auto px-4">
        {SHORTCUTS.map(s => (
          <div key={s.label} className="flex items-center gap-3 py-2.5">
            <dt className="flex w-[92px] shrink-0 flex-wrap gap-1">
              {s.keys.map(k => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </dt>
            <dd className="min-w-0 flex-1">
              <p className="text-sm text-ink">{s.label}</p>
              <p className="t-meta text-ink-3">{s.when}</p>
            </dd>
          </div>
        ))}
      </dl>
      <p className="t-meta border-t border-rule bg-sunken px-4 py-3 text-ink-2">
        Shortcuts are off while you are typing in a field, so they never interrupt a note.
      </p>
    </div>
  );
}
