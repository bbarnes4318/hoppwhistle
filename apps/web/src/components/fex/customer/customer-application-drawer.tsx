'use client';

/**
 * Write the application for a customer, from the quote they chose.
 *
 * The last step of customer -> quote -> application, opened from the
 * customer's quote workspace (the quote just selected), from a saved quote in
 * their history, or from the customer page's Write application. The form is
 * the one every other door uses (`ApplicationLogForm`), prefilled with what is
 * already known -- the customer's name and phone from the record, and the
 * carrier, plan, coverage, annual premium and quote link from the quote -- so
 * the agent types nothing twice. It posts to the customer's own application
 * endpoint, which checks the customer is theirs and links the quote.
 */

import { FileCheck2, Loader2 } from 'lucide-react';
import * as React from 'react';

import {
  ApplicationLogForm,
  type ApplicationLogPayload,
  type ApplicationLogPrefill,
} from '@/components/call-center/ApplicationLogForm';
import { Notice, SheetDrawer } from '@/components/domain';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { markLeadApplication, type InsuranceLeadDetail } from '@/lib/api/leads';
import type { FexQuoteDetail, FexSelection } from '@/lib/fex/api';
import { annualPremium, customerName } from '@/lib/fex/customer';

/** The quote an application is written from, whichever door it came through. */
export interface QuoteForApplication {
  fexQuoteId: string;
  /** The carrier name the application form logs it under. */
  carrier: string;
  product: string;
  planType: string | null;
  face: number | null;
  annualPremium: number | null;
  classLabel: string | null;
}

/** A quote just selected in the workspace. */
export function applicationFromSelection(selection: FexSelection): QuoteForApplication {
  return {
    fexQuoteId: selection.fexQuoteId,
    carrier: selection.application.carrier,
    product: selection.application.product,
    planType: selection.application.planType,
    face: selection.face,
    annualPremium:
      selection.application.annualizedPremium ?? annualPremium(selection.premium, selection.mode),
    classLabel: selection.classLabel,
  };
}

/** A saved quote, as stored -- its own premium, never today's. Null when nothing was chosen. */
export function applicationFromQuote(detail: FexQuoteDetail): QuoteForApplication | null {
  if (!detail.selectedCarrier) return null;
  const hint = detail.selectedApplication;
  return {
    fexQuoteId: detail.id,
    carrier: hint?.carrier ?? detail.selectedCarrier,
    product: hint?.product ?? detail.selectedProduct ?? '',
    planType: hint?.planType ?? null,
    face: detail.selectedFace,
    annualPremium:
      hint?.annualizedPremium ?? annualPremium(detail.selectedPremium, detail.paymentMode),
    classLabel: detail.selectedClass,
  };
}

/** Whether this customer already has an application on record (the server refuses a second). */
export function hasLiveApplication(lead: InsuranceLeadDetail): boolean {
  return (lead.applications ?? []).some(app => !app.voidedAt);
}

export function CustomerApplicationDrawer({
  lead,
  quote,
  open,
  onOpenChange,
  onRecorded,
}: {
  lead: InsuranceLeadDetail;
  /** The quote it is written from; none, and the agent fills the plan in. */
  quote: QuoteForApplication | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecorded: () => void;
}): JSX.Element {
  const [application, setApplication] = React.useState<ApplicationLogPayload | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const name = customerName(lead);
  const already = hasLiveApplication(lead);

  React.useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const prefill: ApplicationLogPrefill = {
    firstName: lead.firstName,
    lastName: lead.lastName,
    phone: lead.phone,
    ...(quote
      ? {
          carrier: quote.carrier,
          product: quote.product,
          planType: quote.planType,
          faceAmount: quote.face,
          premium: quote.annualPremium?.toFixed(2) ?? null,
          fexQuoteId: quote.fexQuoteId,
          quoteClass: quote.classLabel,
        }
      : {
          carrier: lead.carrier,
          faceAmount: lead.faceAmount || lead.coverageAmount,
        }),
  };

  const save = async () => {
    if (!application) return;
    setSaving(true);
    setError(null);
    try {
      await markLeadApplication(lead.id, { ...application });
      toast({
        title: `Application recorded for ${name}`,
        description: quote ? `${quote.carrier} ${quote.product}, linked to the quote.` : undefined,
      });
      onOpenChange(false);
      onRecorded();
    } catch (err) {
      // Nothing is cleared: a retry reuses the form's idempotency key, so a
      // save that landed before the network gave up is not recorded twice.
      setError(err instanceof Error ? err.message : 'The application could not be recorded.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SheetDrawer
      open={open}
      onOpenChange={next => !saving && onOpenChange(next)}
      title={`Write application — ${name}`}
      description="Records the application you wrote on the carrier's portal, on this customer."
      size="lg"
      footer={
        already ? null : (
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={!application || saving}>
              {saving ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <FileCheck2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              )}
              {saving ? 'Saving…' : 'Save application'}
            </Button>
          </div>
        )
      }
    >
      <div className="p-4">
        {already ? (
          <Notice tone="info" title="An application is already on record">
            {name} already has an application. Open it from the customer&apos;s Applications rather
            than recording the same business twice.
          </Notice>
        ) : (
          // Keyed by the quote: a different quote is a different application form.
          <ApplicationLogForm
            key={quote?.fexQuoteId ?? 'no-quote'}
            prefill={prefill}
            onChange={setApplication}
            error={error}
            disabled={saving}
          />
        )}
      </div>
    </SheetDrawer>
  );
}
