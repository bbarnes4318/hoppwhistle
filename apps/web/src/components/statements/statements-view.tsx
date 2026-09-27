'use client';

import { FileText } from 'lucide-react';
import * as React from 'react';

import { SheetDrawer } from '@/components/domain';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiClient } from '@/lib/api';

import { StatementsPanel, type StatementPartyType } from './statements-panel';

/**
 * Revenue → Statements, for an agency owner: the agency's own statement, and
 * any one of its buyers' or publishers' -- the same statement that party
 * downloads from its own portal.
 */

interface NamedParty {
  id: string;
  name: string;
}

function namesFrom(body: unknown): NamedParty[] {
  const rows = (body as { data?: unknown })?.data;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(
      (row): row is NamedParty => typeof row?.id === 'string' && typeof row?.name === 'string'
    )
    .map(row => ({ id: row.id, name: row.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** `BUYER:<id>` / `PUBLISHER:<id>`, the picker's value, to a party. */
export function partyFromPick(
  value: string
): { partyType: StatementPartyType; partyId: string } | null {
  const [type, id] = value.split(':');
  if ((type === 'BUYER' || type === 'PUBLISHER') && id) return { partyType: type, partyId: id };
  return null;
}

export function StatementsView(): JSX.Element {
  const [buyers, setBuyers] = React.useState<NamedParty[]>([]);
  const [publishers, setPublishers] = React.useState<NamedParty[]>([]);
  const [pick, setPick] = React.useState('');

  React.useEffect(() => {
    void apiClient.get('/api/v1/buyers?limit=500').then(r => setBuyers(namesFrom(r.data)));
    void apiClient.get('/api/v1/publishers?limit=500').then(r => setPublishers(namesFrom(r.data)));
  }, []);

  const picked = partyFromPick(pick);
  const pickedName =
    picked?.partyType === 'BUYER'
      ? buyers.find(b => b.id === picked.partyId)?.name
      : publishers.find(p => p.id === picked?.partyId)?.name;

  return (
    <div className="page-canvas">
      <StatementsPanel
        partyType="AGENCY"
        title="Your agency's statements"
        description="Calls, revenue, payouts, returns, applications and number charges, month by month."
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <span className="t-label text-ink-3">A buyer&rsquo;s or publisher&rsquo;s statement</span>
        <Select value={pick} onValueChange={setPick}>
          <SelectTrigger className="h-8 w-full sm:w-72" aria-label="Buyer or publisher">
            <SelectValue placeholder="Choose a buyer or publisher" />
          </SelectTrigger>
          <SelectContent>
            {buyers.length > 0 ? (
              <SelectGroup>
                <SelectLabel>Buyers</SelectLabel>
                {buyers.map(b => (
                  <SelectItem key={b.id} value={`BUYER:${b.id}`}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            ) : null}
            {publishers.length > 0 ? (
              <SelectGroup>
                <SelectLabel>Publishers</SelectLabel>
                {publishers.map(p => (
                  <SelectItem key={p.id} value={`PUBLISHER:${p.id}`}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            ) : null}
          </SelectContent>
        </Select>
      </div>

      {picked ? (
        <StatementsPanel
          key={pick}
          partyType={picked.partyType}
          partyId={picked.partyId}
          title={`${pickedName ?? (picked.partyType === 'BUYER' ? 'Buyer' : 'Publisher')}'s statements`}
          description={
            picked.partyType === 'BUYER'
              ? 'What this buyer was billed, its returns and, when it prepays, its wallet.'
              : 'What this publisher earned, was paid and had deducted.'
          }
        />
      ) : null}
    </div>
  );
}

/** A child agency's row action: its statements in a drawer. */
export function ChildStatementButton({
  tenantId,
  name,
}: {
  tenantId: string;
  name: string;
}): JSX.Element {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <FileText className="mr-1.5 h-3.5 w-3.5" />
        Statement
      </Button>
      <SheetDrawer open={open} onOpenChange={setOpen} title={`${name}: statements`} size="lg">
        {open ? (
          <StatementsPanel
            partyType="CHILD_AGENCY"
            partyId={tenantId}
            description="Its calls, applications, agents and the number charges billed to you for it."
          />
        ) : null}
      </SheetDrawer>
    </>
  );
}
