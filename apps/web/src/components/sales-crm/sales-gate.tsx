'use client';

import { Loader2, Lock } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { EmptyState } from '@/components/domain';
import { fetchSalesContext, type SalesContext } from '@/lib/sales-crm';

/**
 * Loads the session's sales workspace and renders `children` with it, or the
 * server's refusal. The SERVER decides: an agent who opens /sales-crm by URL
 * gets the same "no access" the API gives them, not a broken page and not a
 * screen the API would then refuse to fill.
 */
export function SalesGate({
  children,
}: {
  children: (context: SalesContext, reload: () => Promise<void>) => React.ReactNode;
}): JSX.Element {
  const [context, setContext] = useState<SalesContext | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  const load = useCallback(async () => {
    const result = await fetchSalesContext();
    setContext(result.context);
    setError(result.error);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div className="page-canvas">
        <EmptyState
          size="page"
          icon={Lock}
          headline={
            error.code === 'SALES_WORKSPACE_UNAVAILABLE'
              ? 'There is no Sales CRM here'
              : 'You don’t have access to the Sales CRM'
          }
          body={error.message}
        />
      </div>
    );
  }
  if (!context) {
    return (
      <div className="page-canvas">
        <div className="flex items-center justify-center py-12 text-ink-3">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading the Sales CRM
        </div>
      </div>
    );
  }
  return <>{children(context, load)}</>;
}
