'use client';

import { ArrowLeft, Loader2, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/domain';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { EMAIL_PATTERN } from '@/lib/agreements';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';

/**
 * NetEnroll's own details on every agreement: the notice address and email
 * (printed in the MSA and named in every "contact" line), the default
 * signatory, and the internal addresses that receive every executed copy.
 * Sending is refused while either notice field is empty.
 */

interface Settings {
  netenrollNoticeAddress: string | null;
  netenrollNoticeEmail: string | null;
  defaultSignatoryName: string;
  defaultSignatoryTitle: string;
  internalCopyEmails: string[];
  missing: string | null;
}

export default function AgreementSettingsPage(): JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [chip, setChip] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void apiClient
      .get<Envelope<Settings>>('/api/v1/platform/agreements/settings')
      .then(response => {
        setError(response.error ? response.error.message : null);
        setSettings(payload(response) ?? null);
      });
  }, []);

  if (!settings) {
    return (
      <div className="page-canvas">
        <div className="flex items-center justify-center py-12 text-ink-3">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {error ?? 'Loading settings'}
        </div>
      </div>
    );
  }

  function addChip(): void {
    const value = chip.trim().toLowerCase();
    if (!value) return;
    if (!EMAIL_PATTERN.test(value)) {
      setError(`${value} is not an email address.`);
      return;
    }
    setError(null);
    setSettings(s => (s ? { ...s, internalCopyEmails: Array.from(new Set([...s.internalCopyEmails, value])) } : s));
    setChip('');
  }

  async function save(): Promise<void> {
    if (!settings) return;
    setBusy(true);
    setNotice(null);
    const response = await apiClient.put<Envelope<Settings>>('/api/v1/platform/agreements/settings', {
      netenrollNoticeAddress: settings.netenrollNoticeAddress ?? '',
      netenrollNoticeEmail: settings.netenrollNoticeEmail ?? '',
      defaultSignatoryName: settings.defaultSignatoryName,
      defaultSignatoryTitle: settings.defaultSignatoryTitle,
      internalCopyEmails: settings.internalCopyEmails,
    });
    setBusy(false);
    if (response.error) {
      setError(response.error.message);
      return;
    }
    const saved = payload(response);
    if (saved) setSettings(saved);
    setError(null);
    setNotice(saved?.missing ? `Saved. Sending stays blocked: ${saved.missing} is empty.` : 'Saved.');
  }

  return (
    <div className="page-canvas">
      <PageHeader
        title="Agreement settings"
        description="NetEnroll's details as they appear on every agreement, and who receives executed copies."
        actions={
          <Button variant="outline" asChild>
            <Link href="/admin/agreements">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Agreements
            </Link>
          </Button>
        }
      />

      <Panel className="max-w-2xl">
        <PanelHeader>
          <PanelTitle>NetEnroll</PanelTitle>
        </PanelHeader>
        <PanelBody className="space-y-4">
          <div>
            <label className="mb-1 block text-[11px] text-ink-3" htmlFor="notice-address">
              Notice address
            </label>
            <Textarea
              id="notice-address"
              rows={2}
              value={settings.netenrollNoticeAddress ?? ''}
              onChange={e => setSettings({ ...settings, netenrollNoticeAddress: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-ink-3" htmlFor="notice-email">
              Notice email
            </label>
            <Input
              id="notice-email"
              type="email"
              value={settings.netenrollNoticeEmail ?? ''}
              onChange={e => setSettings({ ...settings, netenrollNoticeEmail: e.target.value })}
            />
            <p className="mt-1 text-[11px] text-ink-3">
              Printed in the MSA, used as Reply-To on every email and named in the disclosure.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] text-ink-3" htmlFor="sig-name">
                Default signatory name
              </label>
              <Input
                id="sig-name"
                value={settings.defaultSignatoryName}
                onChange={e => setSettings({ ...settings, defaultSignatoryName: e.target.value })}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-ink-3" htmlFor="sig-title">
                Default signatory title
              </label>
              <Input
                id="sig-title"
                value={settings.defaultSignatoryTitle}
                onChange={e => setSettings({ ...settings, defaultSignatoryTitle: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-ink-3" htmlFor="internal-copy">
              Internal copy emails
            </label>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {settings.internalCopyEmails.map(email => (
                <span key={email} className="inline-flex items-center gap-1 rounded-full bg-sunken px-2.5 py-1 text-xs">
                  {email}
                  <button
                    type="button"
                    aria-label={`Remove ${email}`}
                    onClick={() =>
                      setSettings({
                        ...settings,
                        internalCopyEmails: settings.internalCopyEmails.filter(e => e !== email),
                      })
                    }
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                id="internal-copy"
                type="email"
                value={chip}
                placeholder="name@pvnvoice.com"
                onChange={e => setChip(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    addChip();
                  }
                }}
              />
              <Button variant="outline" type="button" onClick={addChip}>
                Add
              </Button>
            </div>
            <p className="mt-1 text-[11px] text-ink-3">These addresses receive every executed copy.</p>
          </div>

          {error && <p className="text-sm text-dropped-ink">{error}</p>}
          {notice && <p className="text-sm text-ink-2">{notice}</p>}

          <Button disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </PanelBody>
      </Panel>
    </div>
  );
}
