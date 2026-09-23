import * as React from 'react';

/**
 * One header for all six buyer pages.
 *
 * The purpose line is the page's job in a sentence — the thing the buyer came
 * here to find out. Keeping it on the page (rather than only in a nav label) is
 * what makes each screen answer one question instead of being a pile of panels.
 *
 * ── It does not carry the title ──────────────────────────────────────────────
 *
 * It did, and so does the topbar, from `pageTitleFor(pathname)`. Both rendered
 * `<h1 className="t-title text-ink">` with the same words, one directly above
 * the other, on all six of these pages — "Spend" over "Spend". This is the
 * buyer portal's copy of the duplication `CompactPageHeader` carried on the
 * agency side, and it is removed the same way and for the same two reasons: the
 * page name twice is sloppy to read, and two `<h1>`s in one document leave a
 * screen reader announcing the heading twice with no single root to the
 * outline.
 *
 * The purpose line stays. It was never the title — it is the sentence under it.
 */
export function PageHeader({ purpose, action }: { purpose: string; action?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-rule pb-4">
      <p className="t-body min-w-0 max-w-2xl text-ink-2">{purpose}</p>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
