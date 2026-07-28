'use client';

import { ArrowLeft, ClipboardPlus, FileText } from 'lucide-react';
import Link from 'next/link';
import Script from 'next/script';
import { useEffect, useState } from 'react';

import { CustomerIntakeForm } from '@/components/call-center/CustomerIntakeForm';
import { ManualLeadEntryForm } from '@/components/leads/manual-lead-entry-form';

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
    <div className="min-h-screen bg-slate-950">
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

      <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/95 backdrop-blur">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <Link
                href="/insurance-leads"
                className="mt-1 rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
                aria-label="Back to CRM"
              >
                <ArrowLeft className="h-5 w-5" />
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-white">Add Customer</h1>
                <p className="text-sm text-slate-400">
                  Save a lead to the CRM, send it to the buyer, or complete a full application.
                </p>
              </div>
            </div>

            <div className="flex rounded-lg border border-slate-700 bg-slate-900 p-1">
              <button
                type="button"
                onClick={() => setMode('lead')}
                className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  mode === 'lead'
                    ? 'bg-emerald-600 text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
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
                    ? 'bg-cyan-600 text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
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
          <ManualLeadEntryForm />
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/70 px-4 py-3">
              <div>
                <p className="font-medium text-white">Full Final Expense Application</p>
                <p className="text-sm text-slate-400">
                  Use this section for policy and banking information after the lead is ready.
                </p>
              </div>
              <span
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  certUrl
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300'
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
