import React from 'react';

import { count, pct } from '@/components/delivery/ledger';
import { StatTile } from '@/components/domain';

import type { ConsoleFigures } from './use-console-figures';

/**
 * The console's row of figures: today's, from the server.
 *
 * ── Why these are not counted here ───────────────────────────────────────────
 *
 * This row used to keep its own tallies in the browser's localStorage,
 * incremented as calls ended and never reset. It said "Total calls 0" beside a
 * strip that said 4, kept a different count on every machine an agent sat at,
 * and its "Follow-ups" counted every disposition that was not an application,
 * "not interested" included. It now shows what the rest of the agent's portal
 * shows -- `/delivery/me` and the CRM -- so the console, the strip and My day
 * cannot disagree.
 *
 * Absent is not zero: until the first answer, and when a read fails, a figure
 * is an em dash.
 */
export function StatsStrip({ figures }: { figures: ConsoleFigures | null }) {
  const dash = '—';
  return (
    <div
      className="grid flex-shrink-0 grid-cols-2 gap-3 md:grid-cols-4"
      data-testid="console-figures"
    >
      <StatTile
        label="Calls answered"
        data-figure-label="Calls answered"
        data-figure-value={figures ? count(figures.callsTaken) : dash}
        figure={figures ? count(figures.callsTaken) : dash}
        sub="today"
      />
      <StatTile
        label="Applications"
        data-figure-label="Applications"
        data-figure-value={figures ? count(figures.applications) : dash}
        figure={figures ? count(figures.applications) : dash}
        sub="submitted today"
      />
      <StatTile
        label="Closing"
        data-figure-label="Closing"
        data-figure-value={figures ? pct(figures.closingPct) : dash}
        figure={figures ? pct(figures.closingPct) : dash}
        sub="applications ÷ calls answered"
      />
      <StatTile
        label="Follow-ups due"
        data-figure-label="Follow-ups due"
        data-figure-value={figures?.followUpsDue != null ? count(figures.followUpsDue) : dash}
        figure={figures?.followUpsDue != null ? count(figures.followUpsDue) : dash}
        sub="today or overdue"
      />
    </div>
  );
}
