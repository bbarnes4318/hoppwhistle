'use client';

/**
 * One saved quote, as it was quoted.
 *
 * Opened from History and from a customer's quotes. Everything here is the
 * stored snapshot: the applicant as it was answered and the ranked results as
 * the engine returned them that day. Nothing is re-run to show it -- a quote
 * from last month says last month's prices, and says so -- and Requote, when a
 * host offers it, is a NEW quote rather than a refresh of this one.
 *
 * The host adds what fits where it is opened: the customer page passes
 * Requote, Use for application and a note when the record has changed since.
 */

import { BENEFIT_LABEL } from '@hopwhistle/fex-engine/catalog';
import { History } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';

import { CarrierLogo, DrawerField, DrawerSection, Notice, SheetDrawer } from '@/components/domain';
import { useAuth } from '@/hooks/use-auth';
import { useFexCatalog } from '@/hooks/use-fex-quote';
import {
  fexApi,
  MODE_SHORT,
  money,
  QUOTE_SOURCE_LABEL,
  wholeDollars,
  type FexQuoteDetail,
  type QuoteSource,
} from '@/lib/fex/api';

import { ResultRow } from '../result-row';

export const quoteDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

const quoteDay = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export interface SavedQuoteDrawerProps {
  id: string | null;
  onClose: () => void;
  /** Pinned under the snapshot: what the host lets the agent do with it. */
  actions?: (detail: FexQuoteDetail) => React.ReactNode;
  /** Above the snapshot: anything the host knows that the quote does not. */
  notice?: (detail: FexQuoteDetail) => React.ReactNode;
  /** Already on the customer's page: no link back to it. */
  inCustomer?: boolean;
}

export function SavedQuoteDrawer({
  id,
  onClose,
  actions,
  notice,
  inCustomer = false,
}: SavedQuoteDrawerProps): JSX.Element {
  const { isPlatformAdmin } = useAuth();
  const { catalog } = useFexCatalog();
  const [detail, setDetail] = React.useState<FexQuoteDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<string | null>(null);

  React.useEffect(() => {
    setDetail(null);
    setError(null);
    setExpanded(null);
    if (!id) return;
    let active = true;
    void fexApi.read(id).then(result => {
      if (!active) return;
      if (result.ok) setDetail(result.data);
      else setError(result.message);
    });
    return () => {
      active = false;
    };
  }, [id]);

  const label = (code: string) => catalog?.conditions.find(c => c.code === code)?.label ?? code;
  const a = detail?.applicant;
  const footer = detail && actions ? actions(detail) : null;

  return (
    <SheetDrawer
      open={Boolean(id)}
      onOpenChange={open => !open && onClose()}
      title={detail?.prospectName ? `Quote — ${detail.prospectName}` : 'Saved quote'}
      description={
        detail
          ? `${quoteDateTime(detail.createdAt)} · ${detail.createdBy.name} · ${
              QUOTE_SOURCE_LABEL[detail.source as QuoteSource] ?? detail.source
            }`
          : undefined
      }
      size="xl"
      footer={footer}
    >
      {error ? (
        <Notice tone="error" className="m-4">
          {error}
        </Notice>
      ) : null}
      {a && detail ? (
        <>
          <div className="space-y-2 border-b border-rule px-4 py-3">
            <p className="flex items-start gap-2 text-[12.5px] leading-[18px] text-ink-2">
              <History className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden />
              <span>
                <span className="font-semibold text-ink">
                  Historical quote · {quoteDay(detail.createdAt)}
                </span>{' '}
                — prices and eligibility exactly as quoted that day (rates {detail.engineVersion}).
                Nothing here is recalculated.
              </span>
            </p>
            {notice?.(detail)}
          </div>
          <DrawerSection title="Applicant">
            <DrawerField label="State">{a.state}</DrawerField>
            <DrawerField label="Age">
              {detail.age ?? '—'}
              {a.dob ? <span className="text-ink-3"> · born {a.dob}</span> : null}
            </DrawerField>
            <DrawerField label="Sex">{a.sex === 'F' ? 'Female' : 'Male'}</DrawerField>
            <DrawerField label="Tobacco">{a.tobacco ? 'Yes' : 'No'}</DrawerField>
            {a.heightIn ? (
              <DrawerField label="Build">
                {Math.floor(a.heightIn / 12)}&apos;{a.heightIn % 12}&quot; · {a.weightLb} lb
              </DrawerField>
            ) : null}
            <DrawerField label="Coverage">
              {a.face ? wholeDollars(a.face) : `${money(a.budget)} budget`} · {a.mode}
            </DrawerField>
            <DrawerField label="Conditions">
              {a.conditions.length ? a.conditions.map(c => label(c.code)).join(', ') : 'None'}
            </DrawerField>
            <DrawerField label="Medications">
              {a.meds.length ? a.meds.map(m => m.name ?? m.drugId).join(', ') : 'None'}
            </DrawerField>
            {detail.selectedCarrier ? (
              <DrawerField label="Used">
                <CarrierLogo
                  names={[detail.selectedCarrier, detail.selectedProductId]}
                  size="md"
                  className="mb-1.5 flex"
                />
                {detail.selectedCarrier} · {detail.selectedProduct} · {detail.selectedClass} (
                {BENEFIT_LABEL[detail.selectedBenefit ?? ''] ?? detail.selectedBenefit}) ·{' '}
                {wholeDollars(detail.selectedFace)} ·{' '}
                <span className="font-semibold tabular-nums">
                  {money(detail.selectedPremium)}/{MODE_SHORT[detail.paymentMode]}
                </span>
              </DrawerField>
            ) : null}
            {detail.insuranceLeadId && !inCustomer ? (
              <DrawerField label="Customer">
                <Link
                  href={`/insurance-leads/${encodeURIComponent(detail.insuranceLeadId)}`}
                  className="font-medium text-brand-ink hover:underline"
                >
                  Open customer record
                </Link>
              </DrawerField>
            ) : null}
          </DrawerSection>
          <section className="px-4 py-3">
            <h3 className="t-label mb-2 text-ink-3">Results as quoted</h3>
            <ul className="rounded-card border border-rule">
              {detail.results.map(r => (
                <ResultRow
                  key={r.productId}
                  result={r}
                  expanded={expanded === r.productId}
                  onToggle={() => setExpanded(e => (e === r.productId ? null : r.productId))}
                  isStaff={isPlatformAdmin}
                  priceOnly={r.eligible && !r.uwLoaded}
                  selected={r.productId === detail.selectedProductId}
                />
              ))}
            </ul>
          </section>
        </>
      ) : !error && id ? (
        <p className="t-meta p-4 text-ink-3" aria-busy="true">
          Loading the saved quote…
        </p>
      ) : null}
    </SheetDrawer>
  );
}
