import { useCallback, useState } from 'react';

import { useLivePoll } from '@/hooks/use-live-poll';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';
import { fetchCrmPipeline } from '@/lib/api/leads';

/** What the console's row of figures shows. Every field is the server's. */
export interface ConsoleFigures {
  callsTaken: number;
  applications: number;
  closingPct: number | null;
  /** Null when the CRM could not be read: unknown, not zero. */
  followUpsDue: number | null;
}

interface SelfView {
  callsTaken: number;
  applications: number;
  closingPct: number | null;
}

/** The console sits open all shift; this keeps it honest without hammering the API. */
const REFRESH_MS = 30_000;

/**
 * Today's figures for the signed-in agent: the same `/delivery/me` the live
 * strip and My day read, plus the CRM's follow-ups due.
 *
 * The two reads are independent. If the CRM is unreachable the calls and
 * applications still show, and the follow-ups figure is a dash. If
 * `/delivery/me` fails there is no row at all (null), which the strip renders
 * as dashes: an agent who cannot be read is not an agent with nothing.
 */
export function useConsoleFigures(): { figures: ConsoleFigures | null; refresh: () => void } {
  const [figures, setFigures] = useState<ConsoleFigures | null>(null);

  const load = useCallback(async () => {
    const [me, crm] = await Promise.all([
      apiClient.get<Envelope<SelfView>>('/api/v1/delivery/me'),
      fetchCrmPipeline().catch(() => null),
    ]);
    const view = me.error ? null : payload(me);
    if (!view) return 'failed' as const;
    setFigures({
      callsTaken: view.callsTaken,
      applications: view.applications,
      closingPct: view.closingPct,
      followUpsDue: crm ? crm.followUpsDue : null,
    });
    return 'ok' as const;
  }, []);

  const { refresh } = useLivePoll(load, { intervalMs: REFRESH_MS });
  return { figures, refresh };
}
