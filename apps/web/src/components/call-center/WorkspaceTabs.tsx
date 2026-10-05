import React from 'react';

import type { ActiveCallView } from './types';

interface WorkspaceTabsProps {
  activeCallView: ActiveCallView;
  setActiveCallView: (view: ActiveCallView) => void;
}

const TABS: ReadonlyArray<{ view: ActiveCallView; label: string }> = [
  { view: 'script', label: 'Command Script' },
  { view: 'data', label: 'Target Profile' },
  { view: 'captured_data', label: 'Captured Info' },
  // The final expense quoter, on the live caller.
  { view: 'quote', label: 'Quote' },
];

export function WorkspaceTabs({ activeCallView, setActiveCallView }: WorkspaceTabsProps) {
  return (
    <div className="flex flex-shrink-0 border-b border-rule mb-3 overflow-x-auto" role="tablist">
      {TABS.map(({ view, label }) => (
        <button
          key={view}
          type="button"
          role="tab"
          aria-selected={activeCallView === view}
          onClick={() => setActiveCallView(view)}
          className={
            'px-4 py-2 t-label whitespace-nowrap transition-colors border-b-2 -mb-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
            (activeCallView === view
              ? 'border-brand text-brand-ink'
              : 'border-transparent text-ink-3 hover:text-ink')
          }
        >
          {label}
        </button>
      ))}
    </div>
  );
}
