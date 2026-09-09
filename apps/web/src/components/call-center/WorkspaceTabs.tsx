import React from 'react';

import type { ActiveCallView } from './types';

interface WorkspaceTabsProps {
  activeCallView: ActiveCallView;
  setActiveCallView: (view: ActiveCallView) => void;
}

export function WorkspaceTabs({ activeCallView, setActiveCallView }: WorkspaceTabsProps) {
  return (
    <div className="flex flex-shrink-0 border-b border-rule mb-3" role="tablist">
      <button
        onClick={() => setActiveCallView('script')}
        className={
          'px-4 py-2 t-label transition-colors border-b-2 -mb-px ' +
          (activeCallView === 'script'
            ? 'border-brand text-brand-ink'
            : 'border-transparent text-ink-3 hover:text-ink')
        }
      >
        Command Script
      </button>
      <button
        onClick={() => setActiveCallView('data')}
        className={
          'px-4 py-2 t-label transition-colors border-b-2 -mb-px ' +
          (activeCallView === 'data'
            ? 'border-brand text-brand-ink'
            : 'border-transparent text-ink-3 hover:text-ink')
        }
      >
        Target Profile
      </button>
      <button
        onClick={() => setActiveCallView('captured_data')}
        className={
          'px-4 py-2 t-label transition-colors border-b-2 -mb-px ' +
          (activeCallView === 'captured_data'
            ? 'border-brand text-brand-ink'
            : 'border-transparent text-ink-3 hover:text-ink')
        }
      >
        Captured Info
      </button>
    </div>
  );
}
