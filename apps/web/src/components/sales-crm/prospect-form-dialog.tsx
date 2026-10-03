'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { apiClient, payload, type Envelope } from '@/lib/api';
import {
  PROSPECT_TYPES,
  SELECT_CLASS,
  TYPE_LABELS,
  fromLocalInput,
  personName,
  toLocalInput,
  type Prospect,
  type ProspectType,
  type SalesMember,
} from '@/lib/sales-crm';

interface FormState {
  type: ProspectType;
  companyName: string;
  primaryContactName: string;
  email: string;
  phone: string;
  website: string;
  state: string;
  address: string;
  source: string;
  assignedUserId: string;
  nextFollowUpAt: string;
  tags: string;
  summary: string;
}

function initial(prospect: Prospect | null): FormState {
  return {
    type: prospect?.type ?? 'INSURANCE_AGENCY',
    companyName: prospect?.companyName ?? '',
    primaryContactName:
      prospect?.primaryContactName ??
      ([prospect?.firstName, prospect?.lastName].filter(Boolean).join(' ') || ''),
    email: prospect?.email ?? '',
    phone: prospect?.phone ?? '',
    website: prospect?.website ?? '',
    state: prospect?.state ?? '',
    address: prospect?.address ?? '',
    source: prospect?.source ?? '',
    assignedUserId: prospect?.assignedUserId ?? '',
    nextFollowUpAt: toLocalInput(prospect?.nextFollowUpAt ?? null),
    tags: (prospect?.tags ?? []).join(', '),
    summary: prospect?.summary ?? '',
  };
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[11px] text-ink-3">
        {label}
      </label>
      {children}
    </div>
  );
}

/** Create a prospect, or edit one. The API places it in the session's workspace. */
export function ProspectFormDialog({
  open,
  onOpenChange,
  prospect,
  members,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prospect: Prospect | null;
  members: SalesMember[];
  onSaved: (prospect: Prospect) => void;
}): JSX.Element {
  const [form, setForm] = useState<FormState>(initial(prospect));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(initial(prospect));
      setError(null);
    }
  }, [open, prospect]);

  const set = (key: keyof FormState) => (e: { target: { value: string } }) =>
    setForm(f => ({ ...f, [key]: e.target.value }));

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    const body = {
      type: form.type,
      companyName: form.companyName,
      primaryContactName: form.primaryContactName,
      email: form.email,
      phone: form.phone,
      website: form.website,
      state: form.state,
      address: form.address,
      source: form.source,
      assignedUserId: form.assignedUserId || null,
      nextFollowUpAt: fromLocalInput(form.nextFollowUpAt),
      tags: form.tags
        .split(',')
        .map(t => t.trim())
        .filter(Boolean),
      summary: form.summary,
    };
    const response = prospect
      ? await apiClient.patch<Envelope<Prospect>>(`/api/v1/sales/prospects/${prospect.id}`, body)
      : await apiClient.post<Envelope<Prospect>>('/api/v1/sales/prospects', body);
    setBusy(false);
    const saved = payload(response);
    if (!saved) {
      setError(response.error?.message ?? 'The prospect could not be saved.');
      return;
    }
    onSaved(saved);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{prospect ? 'Edit prospect' : 'New prospect'}</DialogTitle>
          <DialogDescription>
            An agency, licensed agent, IMO/FMO or call center you are selling to.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field id="p-type" label="Type">
            <select
              id="p-type"
              className={`${SELECT_CLASS} w-full`}
              value={form.type}
              onChange={set('type')}
            >
              {PROSPECT_TYPES.map(t => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field id="p-company" label="Company / agency name">
            <Input id="p-company" value={form.companyName} onChange={set('companyName')} />
          </Field>
          <Field id="p-contact" label="Primary contact">
            <Input
              id="p-contact"
              value={form.primaryContactName}
              onChange={set('primaryContactName')}
            />
          </Field>
          <Field id="p-email" label="Email">
            <Input id="p-email" type="email" value={form.email} onChange={set('email')} />
          </Field>
          <Field id="p-phone" label="Phone">
            <Input id="p-phone" value={form.phone} onChange={set('phone')} />
          </Field>
          <Field id="p-website" label="Website">
            <Input id="p-website" value={form.website} onChange={set('website')} />
          </Field>
          <Field id="p-state" label="State">
            <Input id="p-state" value={form.state} onChange={set('state')} />
          </Field>
          <Field id="p-source" label="Source">
            <Input
              id="p-source"
              value={form.source}
              placeholder="Referral, conference, inbound…"
              onChange={set('source')}
            />
          </Field>
          <Field id="p-address" label="Address">
            <Input id="p-address" value={form.address} onChange={set('address')} />
          </Field>
          <Field id="p-owner" label="Assigned to">
            <select
              id="p-owner"
              className={`${SELECT_CLASS} w-full`}
              value={form.assignedUserId}
              onChange={set('assignedUserId')}
            >
              <option value="">Unassigned</option>
              {members.map(m => (
                <option key={m.id} value={m.id}>
                  {personName(m)}
                </option>
              ))}
            </select>
          </Field>
          <Field id="p-follow" label="Next follow-up">
            <Input
              id="p-follow"
              type="datetime-local"
              value={form.nextFollowUpAt}
              onChange={set('nextFollowUpAt')}
            />
          </Field>
          <Field id="p-tags" label="Tags (comma separated)">
            <Input id="p-tags" value={form.tags} onChange={set('tags')} />
          </Field>
          <div className="md:col-span-2">
            <Field id="p-summary" label="Summary">
              <Textarea id="p-summary" rows={3} value={form.summary} onChange={set('summary')} />
            </Field>
          </div>
        </div>
        {error && <p className="text-sm text-dropped-ink">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void save()}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {prospect ? 'Save' : 'Create prospect'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
