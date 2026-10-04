'use client';

import { ArrowLeft, ClipboardPlus, FileText } from 'lucide-react';
import Link from 'next/link';
import Script from 'next/script';
import { useEffect, useState } from 'react';

import { CustomerIntakeForm } from '@/components/call-center/CustomerIntakeForm';
import { Segmented, SegmentedItem } from '@/components/domain';
import { ManualLeadEntryFormV2 } from '@/components/leads/manual-lead-entry-form-v2';
import { useWhiteLabelView } from '@/hooks/use-white-label-view';

declare global {
  interface Window {
    TrustedForm?: {
      getCertUrl?: () => string;
      ping?: () => void;
    };
  }
}

type IntakeMode = 'lead' | 'application';

export default function IntakePage(): JSX.Element {
  // Manual CRM Lead Entry (buyer submission + compliance data) is not part of
  // the white-label platform; those viewers get the intake form only.
  const whiteLabelView = useWhiteLabelView();
  const [selectedMode, setMode] = useState<IntakeMode>('lead');
  const mode: IntakeMode = whiteLabelView ? 'application' : selectedMode;
  const [certUrl, setCertUrl] = useState<string | null>(null);

  useEffect(() => {
    const checkForCert = () => {
      const hiddenInput = document.querySelector<HTMLInputElement>(
        'input[name="xxTrustedFormCertUrl"]'
      );
      if (hiddenInput?.value) {
        setCertUrl(hiddenInput.value);
        return true;
      }

      if (window.TrustedForm?.getCertUrl) {
        const url = window.TrustedForm.getCertUrl();
        if (url) {
          setCertUrl(url);
          return true;
        }
      }

      return false;
    };

    if (checkForCert()) return;

    let attempts = 0;
    const interval = window.setInterval(() => {
      attempts += 1;
      if (checkForCert() || attempts > 40) window.clearInterval(interval);
    }, 500);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-paper">
      <Script
        id="trustedform-script"
        strategy="afterInteractive"
        src="https://api.trustedform.com/trustedform.js?field=xxTrustedFormCertUrl&use_tagged_consent=true&provide_referrer=true"
      />

      <form
        id="trustedform-container"
        aria-hidden="true"
        className="pointer-events-none absolute -left-[9999px] h-px w-px overflow-hidden"
      />

      <header className="sticky top-0 z-10 border-b border-rule bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/insurance-leads"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-ink-2 transition-colors hover:bg-sunken hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Back to CRM"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="min-w-0">
              <nav aria-label="Breadcrumb" className="t-meta text-ink-3">
                <Link href="/insurance-leads" className="hover:text-ink hover:underline">
                  CRM
                </Link>
                <span aria-hidden className="mx-1.5">
                  /
                </span>
                <span>Add customer</span>
              </nav>
              <h1 className="t-title truncate text-ink">Add customer</h1>
            </div>
          </div>

          {whiteLabelView ? null : (
            <Segmented aria-label="What to add">
              <SegmentedItem
                active={mode === 'lead'}
                aria-pressed={mode === 'lead'}
                onClick={() => setMode('lead')}
              >
                <ClipboardPlus className="h-3.5 w-3.5" aria-hidden />
                CRM lead
              </SegmentedItem>
              <SegmentedItem
                active={mode === 'application'}
                aria-pressed={mode === 'application'}
                onClick={() => setMode('application')}
              >
                <FileText className="h-3.5 w-3.5" aria-hidden />
                Full application
              </SegmentedItem>
            </Segmented>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {mode === 'lead' ? (
          <ManualLeadEntryFormV2 />
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-rule bg-sunken px-4 py-3">
              <div>
                <p className="font-medium text-ink">Full Final Expense Application</p>
                <p className="text-sm text-ink-3">
                  Use this section for policy and banking information after the lead is ready.
                </p>
              </div>
              <span
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  certUrl
                    ? 'border-live/40 bg-live-tint text-live-ink'
                    : 'border-ringing/40 bg-ringing-tint text-ringing-ink'
                }`}
              >
                {certUrl ? 'TrustedForm Active' : 'TrustedForm Loading'}
              </span>
            </div>
            <CustomerIntakeForm />
          </div>
        )}
      </main>
    </div>
  );
}
