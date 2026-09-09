'use client';

import * as React from 'react';

import { LiveStrip } from '@/components/domain';

import { useLiveMetrics } from './use-live-metrics';

/**
 * Mounts the LiveStrip under the topbar, scoped to the signed-in person.
 *
 * Renders nothing when not a single figure has a real value. A full-width row
 * of em dashes on every page would read as a broken product rather than as a
 * pending integration, and it would push every page down to say nothing. It is
 * also what a principal sees for the second before the first poll answers, and
 * a strip that appears rather than filling in is the honest shape of that.
 *
 * See `useLiveMetrics` for which figures each reading gets, why the two rates
 * are labelled apart, and the rule for not repeating a figure the page below
 * already renders as its hero.
 */
export function LiveStripMount() {
  const { metrics, connection, lastUpdated, empty, note, asOf, scope, slots } = useLiveMetrics();

  if (empty || metrics.length === 0) return null;

  return (
    <LiveStrip
      metrics={metrics.map((m, i) => ({
        ...m,
        title: slots[i]?.unavailableReason,
        // A figure with no source renders muted rather than in its own tone.
        unavailable: slots[i]?.value === null,
      }))}
      connection={connection}
      lastUpdated={lastUpdated}
      note={note}
      asOf={asOf}
      scope={scope}
    />
  );
}
