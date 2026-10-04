'use client';

import { Loader2, MapPin } from 'lucide-react';
import { useState } from 'react';

import { StatePicker } from '@/components/agents/state-picker';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { apiClient } from '@/lib/api';

/**
 * The screen an agent cannot get past until they have said which states they
 * are licensed in.
 *
 * Calls and leads are routed to an agent only inside those states, so an agent
 * with none would receive nothing. It is shown in place of the whole app (the
 * dashboard layout renders it instead of the page) and goes away on its own
 * once the server reports states on file.
 */
export function LicensedStatesGate(): JSX.Element {
  const { refetch } = useAuth();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    const response = await apiClient.put('/api/auth/me/licensed-states', {
      licensedStates: [...selected].sort(),
    });
    if (response.error) {
      setSaving(false);
      setError(response.error.message || 'Your licensed states could not be saved.');
      return;
    }
    await refetch();
    setSaving(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper p-4 text-ink">
      <div className="w-full max-w-2xl space-y-4 rounded-lg border bg-card p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <MapPin className="mt-1 h-5 w-5 shrink-0" />
          <div>
            <h1 className="text-xl font-semibold">Which states are you licensed in?</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              You are only sent calls and leads from the states you select, so choose every state
              you hold a licence in. This is required before you can use the portal. You can change
              it any time from your Account page.
            </p>
          </div>
        </div>

        <StatePicker selected={selected} onChange={setSelected} listClassName="max-h-80" />

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <div className="flex justify-end">
          <Button onClick={() => void save()} disabled={saving || selected.size === 0}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save and continue
          </Button>
        </div>
      </div>
    </div>
  );
}
