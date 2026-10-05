'use client';

import { Loader2, MapPin, Pencil } from 'lucide-react';
import * as React from 'react';

import { StatePicker } from '@/components/agents/state-picker';
import {
  Notice,
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
} from '@/components/domain';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/hooks/use-auth';
import { apiClient } from '@/lib/api';
import { jurisdictionName } from '@/lib/licensable-jurisdictions';

/**
 * The states an agent is licensed in, and so the states their calls and leads
 * come from -- kept by the agent, on Account.
 *
 * Routing reads this list on every inbound call (`services/routing.ts` in the
 * API) and the CRM narrows by it on every request, so a save takes effect on
 * the next call: no restart, no cache. It writes
 * `PUT /api/auth/me/licensed-states`, the same route the first-login screen
 * uses, which replaces the list, never empties it, and audits each change.
 *
 * Adding a state is the agent attesting to a license, so a save that adds one
 * asks them to confirm it first. Removing one needs no confirmation: it only
 * narrows what reaches them.
 */
export function LicensedStatesPanel({
  states,
  editable,
  readOnly = false,
}: {
  states: readonly string[];
  /** False for anyone the API would refuse: an owner or admin who also holds AGENT. */
  editable: boolean;
  /** A read-only role preview: the server refuses the write. */
  readOnly?: boolean;
}): JSX.Element {
  const { refetch } = useAuth();
  const current = React.useMemo(() => [...states].sort(), [states]);
  const [editing, setEditing] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set(current));
  const [attested, setAttested] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const added = [...selected].filter(code => !current.includes(code)).sort();
  const removed = current.filter(code => !selected.has(code));
  const changed = added.length > 0 || removed.length > 0;

  function startEditing(): void {
    setSelected(new Set(current));
    setAttested(false);
    setError(null);
    setSaved(false);
    setEditing(true);
  }

  async function save(): Promise<void> {
    if (selected.size === 0) {
      setError('Keep at least one state. To stop calls for now, turn off taking calls instead.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await apiClient.put<{ licensedStates: string[] }>(
        '/api/auth/me/licensed-states',
        { licensedStates: [...selected].sort() }
      );
      if (response.error) {
        setError(response.error.message || 'Your licensed states were not saved.');
        return;
      }
      await refetch();
      setEditing(false);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  const canEdit = editable && !readOnly;

  return (
    <Panel data-licensed-states>
      <PanelHeader
        action={
          canEdit && !editing ? (
            <Button variant="outline" size="sm" onClick={startEditing}>
              <Pencil aria-hidden className="mr-1.5 h-3.5 w-3.5" />
              Edit states
            </Button>
          ) : null
        }
      >
        <PanelTitle className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-ink-3" aria-hidden />
          Licensed states
        </PanelTitle>
        <PanelDescription>
          {editable
            ? 'Calls and leads reach you only from these states. Changes apply from your next call.'
            : 'Calls and leads reach you only from these states.'}
        </PanelDescription>
      </PanelHeader>
      <PanelBody className="grid gap-4">
        {editing ? (
          <>
            <StatePicker selected={selected} onChange={setSelected} listClassName="max-h-80" />

            {changed ? (
              <div className="grid gap-1.5 rounded-card border border-rule bg-paper p-3 text-sm">
                {added.length ? (
                  <p>
                    <span className="font-medium text-live-ink">Adding</span>{' '}
                    <span className="t-data text-ink">{added.join(', ')}</span>
                    <span className="text-ink-3"> — you will start receiving these calls.</span>
                  </p>
                ) : null}
                {removed.length ? (
                  <p>
                    <span className="font-medium text-dropped-ink">Removing</span>{' '}
                    <span className="t-data text-ink">{removed.join(', ')}</span>
                    <span className="text-ink-3"> — these calls will stop reaching you.</span>
                  </p>
                ) : null}
              </div>
            ) : null}

            {added.length ? (
              <label className="flex items-start gap-2.5 text-sm text-ink">
                <Checkbox
                  checked={attested}
                  onCheckedChange={value => setAttested(value === true)}
                  className="mt-0.5"
                  aria-label="I hold an active license in every state I am adding"
                />
                <span>
                  I hold an active insurance license in every state I am adding. Changes are
                  recorded in the agency&rsquo;s audit log.
                </span>
              </label>
            ) : null}

            {error ? <Notice tone="error" title={error} /> : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={() => void save()}
                disabled={
                  saving || !changed || selected.size === 0 || (added.length > 0 && !attested)
                }
              >
                {saving ? (
                  <Loader2 aria-hidden className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : null}
                Save states
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </Button>
              {selected.size === 0 ? (
                <span className="t-meta text-dropped-ink">Select at least one state.</span>
              ) : null}
            </div>
          </>
        ) : (
          <>
            {current.length ? (
              <>
                <p className="t-meta text-ink-3">
                  Licensed in {current.length} {current.length === 1 ? 'state' : 'states'}
                </p>
                <ul className="flex flex-wrap gap-2" aria-label="Licensed states">
                  {current.map(state => (
                    <li
                      key={state}
                      title={jurisdictionName(state)}
                      className="t-data inline-flex h-8 min-w-[2.75rem] items-center justify-center rounded-control border border-rule bg-paper px-2.5 font-medium text-ink"
                    >
                      {state}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="t-body text-ink-3">No licensed states are on file yet.</p>
            )}
            {saved ? (
              <Notice tone="info" title="Saved. Your calls now come from these states." />
            ) : null}
            {!editable ? (
              <p className="t-meta text-ink-3">Your administrator maintains this list.</p>
            ) : readOnly ? (
              <p className="t-meta text-ink-3">Not available in a read-only preview.</p>
            ) : null}
          </>
        )}
      </PanelBody>
    </Panel>
  );
}
