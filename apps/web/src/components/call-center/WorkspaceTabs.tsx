import React from 'react';
import type { ActiveCallView } from './types';

interface WorkspaceTabsProps {
  activeCallView: ActiveCallView;
  setActiveCallView: (view: ActiveCallView) => void;
}

export function WorkspaceTabs({ activeCallView, setActiveCallView }: WorkspaceTabsProps) {
  return (
    <div className="flex flex-shrink-0 border-b border-border mb-4">
      <button
        onClick={() => setActiveCallView('script')}
        className={
          'px-6 py-3 font-mono text-xs uppercase tracking-widest transition-all border-b-2 ' +
          (activeCallView === 'script'
            ? 'border-primary text-primary bg-primary/5'
            : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50')
        }
      >
        Command Script
      </button>
      <button
        onClick={() => setActiveCallView('data')}
        className={
          'px-6 py-3 font-mono text-xs uppercase tracking-widest transition-all border-b-2 ' +
          (activeCallView === 'data'
            ? 'border-primary text-primary bg-primary/5'
            : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50')
        }
      >
        Target Profile
      </button>
      <button
        onClick={() => setActiveCallView('captured_data')}
        className={
          'px-6 py-3 font-mono text-xs uppercase tracking-widest transition-all border-b-2 ' +
          (activeCallView === 'captured_data'
            ? 'border-primary text-primary bg-primary/5'
            : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50')
        }
      >
        Captured Info
      </button>
    </div>
  );
}
