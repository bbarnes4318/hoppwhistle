'use client';

import * as React from 'react';

import { LiveStrip } from '@/components/domain';

import { useLiveMetrics } from './use-live-metrics';

/**
 * Mounts the LiveStrip under the topbar, scoped to the signed-in role.
 *
 * Renders nothing when not a single metric has a real value. A full-width row
 * of em dashes on every page would read as a broken product rather than as a
 * pending integration, and it would push every page down by 40px to say
 * nothing. The moment the metrics endpoint exists the strip appears with no
 * change here — see useLiveMetrics for the contract it needs.
 */
export function LiveStripMount() {
  const { metrics, connection, lastUpdated, empty, note, slots } = useLiveMetrics();

  if (empty || metrics.length === 0) return null;

  return (
    <LiveStrip
      metrics={metrics.map((m, i) => ({
        ...m,
        title: slots[i]?.unavailableReason,
        // A metric with no source renders muted rather than in its own tone.
        unavailable: slots[i]?.value === null,
      }))}
      connection={connection}
      lastUpdated={lastUpdated}
      note={note}
    />
  );
}
