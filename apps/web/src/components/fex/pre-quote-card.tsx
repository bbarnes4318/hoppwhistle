'use client';

/**
 * A first look at the market before the agent has said hello.
 *
 * On a ringing or connected call whose lead already gives state, sex and age
 * (or date of birth), this runs ONE quote at the agency's default face, with
 * no health answers, and says how many carriers qualify and from what. It is
 * labelled for what it is -- before health questions -- and the button opens
 * the full quoter. Without enough data it is just the button.
 */

import { Calculator } from 'lucide-react';
import * as React from 'react';

import { CarrierLogo } from '@/components/domain';
import { usePhone } from '@/components/phone/phone-provider';
import { Button } from '@/components/ui/button';
import { useQuoteSession } from '@/contexts/quote-session-context';
import { fexApi, MODE_SHORT, money, wholeDollars } from '@/lib/fex/api';
import { applyPrefill, emptyDraft, toApplicant } from '@/lib/fex/draft';
import { prefillFromProspect } from '@/lib/fex/prefill';

export function PreQuoteCard(): JSX.Element | null {
  const session = useQuoteSession();
  const { currentCall } = usePhone();
  const callId = currentCall?.callId ?? null;
  const [summary, setSummary] = React.useState<{
    families: string[];
    count: number;
    lowest: number | null;
    face: number;
  } | null>(null);
  const [customerVersion, setCustomerVersion] = React.useState(0);

  // The CRM record for the caller, once per call.
  React.useEffect(() => {
    if (!session || !callId || !currentCall) return;
    let active = true;
    void session.lookupCustomer(callId, currentCall.phoneNumber).then(() => {
      if (active) setCustomerVersion(v => v + 1);
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId]);

  const context = session && callId ? session.getContext(callId) : {};
  const prefill = prefillFromProspect({
    customer: (context.customer ?? null) as Record<string, unknown> | null,
    prospectData: (currentCall?.prospectData ?? null) as Record<string, unknown> | null,
    matchedProspect: context.matchedProspect ?? null,
  });
  const enough =
    prefill.fields.has('state') &&
    prefill.fields.has('sex') &&
    (prefill.fields.has('age') || prefill.fields.has('dob'));
  const draft = applyPrefill(emptyDraft(session?.settings?.agency), prefill);
  const applicant = enough ? toApplicant(draft) : null;
  const key = applicant ? JSON.stringify(applicant) : null;

  React.useEffect(() => {
    setSummary(null);
    if (!key) return;
    const controller = new AbortController();
    const body = JSON.parse(key) as NonNullable<typeof applicant>;
    void fexApi.quote(body, controller.signal).then(result => {
      if (controller.signal.aborted || !result.ok) return;
      const qualifies = result.data.results.filter(r => r.eligible && r.uwLoaded && r.appointed);
      const premiums = qualifies.map(r => r.best?.premium).filter((p): p is number => p != null);
      const byPrice = [...qualifies].sort(
        (a, b) => (a.best?.premium ?? Infinity) - (b.best?.premium ?? Infinity)
      );
      setSummary({
        families: [...new Set(byPrice.map(r => r.family))].slice(0, 4),
        count: qualifies.length,
        lowest: premiums.length ? Math.min(...premiums) : null,
        face: body.face ?? 0,
      });
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, customerVersion]);

  if (!session || !currentCall || !callId) return null;

  return (
    <section
      aria-label="Quote"
      className="rounded-card border border-rule bg-surface p-3 shadow-card"
    >
      {summary ? (
        <div className="mb-2">
          <p className="t-label text-ink-3">Before health questions</p>
          <p className="t-num text-sm tabular-nums text-ink">
            <span className="font-semibold">
              {summary.count} {summary.count === 1 ? 'carrier qualifies' : 'carriers qualify'}
            </span>
            {summary.lowest !== null ? (
              <>
                {' '}
                · from {money(summary.lowest)}/{MODE_SHORT[draft.paymentMode]} for{' '}
                {wholeDollars(summary.face)}
              </>
            ) : null}
          </p>
          {summary.families.length ? (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Lowest-priced carriers">
              {summary.families.map(f => (
                <li key={f} title={f}>
                  <CarrierLogo names={[f]} size="xs" />
                  <span className="sr-only">{f}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <Button
        size="sm"
        variant="outline"
        className="w-full"
        onClick={() => session.openFor(currentCall)}
      >
        <Calculator className="mr-1.5 h-4 w-4" aria-hidden />
        Open quoter
      </Button>
    </section>
  );
}
