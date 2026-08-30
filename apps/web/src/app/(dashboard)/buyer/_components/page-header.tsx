import * as React from 'react';

/**
 * One header for all six buyer pages.
 *
 * The subtitle is the page's job in a sentence — the thing the buyer came here
 * to find out. Keeping it on the page (rather than only in a nav label) is what
 * makes each screen answer one question instead of being a pile of panels.
 */
export function PageHeader({
  title,
  purpose,
  action,
}: {
  title: string;
  purpose: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-rule pb-4">
      <div className="min-w-0">
        <h1 className="t-title text-ink">{title}</h1>
        <p className="t-body mt-1 max-w-2xl text-ink-2">{purpose}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
