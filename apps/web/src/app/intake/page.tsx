'use client';

import { ArrowLeft, ClipboardPlus, FileText } from 'lucide-react';
import Link from 'next/link';
import Script from 'next/script';
import { useEffect, useState } from 'react';

import { CustomerIntakeForm } from '@/components/call-center/CustomerIntakeForm';
import { ManualLeadEntryFormV2 } from '@/components/leads/manual-lead-entry-form-v2';

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
  const [mode, setMode] = useState<IntakeMode>('lead');
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

      <header className="sticky top-0 z-10 border-b border-rule bg-surface/95 backdrop-blur">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <Link
                href="/insurance-leads"
                className="mt-1 rounded-md p-2 text-ink-3 transition-colors hover:bg-sunken hover:text-ink"
                aria-label="Back to CRM"
              >
                <ArrowLeft className="h-5 w-5" />
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-ink">Add Customer</h1>
                <p className="text-sm text-ink-3">
                  Save a lead to the CRM, send it to the buyer, or complete a full application.
                </p>
              </div>
            </div>

            <div className="flex rounded-lg border border-rule bg-sunken p-1">
              <button
                type="button"
                onClick={() => setMode('lead')}
                className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  mode === 'lead' ? 'bg-brand text-brand-fg' : 'text-ink-3 hover:bg-rule hover:text-ink'
                }`}
              >
                <ClipboardPlus className="h-4 w-4" />
                CRM Lead Entry
              </button>
              <button
                type="button"
                onClick={() => setMode('application')}
                className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  mode === 'application'
                    ? 'bg-brand text-brand-fg'
                    : 'text-ink-3 hover:bg-rule hover:text-ink'
                }`}
              >
                <FileText className="h-4 w-4" />
                Full Application
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
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
