'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Logging an application the agent wrote themselves, on any carrier.
 *
 * ── Why this form exists ─────────────────────────────────────────────────────
 *
 * The agency's price comes off its closing percentage, whose numerator is
 * submitted applications. Until this form, the only way an application could
 * enter that numerator was the American Amicable RPA finishing a run. The quote
 * panel offers eleven carriers; business written with the other ten was never
 * counted, and an understated numerator is a HIGHER price. So this is the path
 * for everything the automation does not write.
 *
 * ── Thirty seconds ───────────────────────────────────────────────────────────
 *
 * An agent fills this in at the end of a call, with the next one already
 * ringing. FIVE fields, one column, no sections, everything the call already
 * knows prefilled:
 *
 *     first name · last name · carrier · annual premium · coverage amount
 *
 * That is the whole list, and it is short on purpose. The application itself is
 * written on the carrier's own portal -- these agents are the agency's, not
 * ours, and they are not going to retype an application into a second system.
 * This records THAT IT HAPPENED and enough to match the row against a carrier
 * statement later. Everything that was once asked for and is not on that list
 * -- plan type, payment mode, date of birth, state, application number -- is
 * gone. No SSN and no banking details, ever.
 *
 * The premium is asked for ANNUALLY, not as a modal premium plus a mode. The
 * agency's production is reported annualised, so asking for the number that is
 * reported removes both the arithmetic and the chance of logging a monthly
 * figure in a box the report reads as yearly.
 *
 * ── One form instance is one application ─────────────────────────────────────
 *
 * `clientRequestId` is generated once, when the form mounts, and reused on
 * every retry. A submit that timed out after the row landed, a double-clicked
 * button and a Retry after a failed response all carry the same key, and the
 * server answers the second one with the row the first one wrote. It is
 * deliberately per FORM INSTANCE rather than per call: a couple insuring
 * together is two applications from one call, and keying on the call would
 * silently drop the second.
 */

/** Monthly first: it is what almost every final-expense policy is written on. */
/**
 * The eleven carriers on the quote panel, in the order `CARRIER_LOGOS` lists
 * them in `IntegratedScriptPanel.tsx`, plus "Other".
 *
 * "Other" is not a courtesy. An agency that writes with a twelfth carrier and
 * finds no way to log it is back to business that is never counted, which is
 * the exact failure this form exists to remove.
 */
export const APPLICATION_CARRIERS = [
  'Aflac',
  'SBLI',
  'CICA',
  'GTL',
  'Corebridge',
  'TransAmerica',
  'American Amicable',
  'AHL',
  'Royal Neighbors',
  'Gerber',
  'Mutual of Omaha',
] as const;

const OTHER_CARRIER = 'Other';

const PAYMENT_MODES = [
  { value: 'MONTHLY', label: 'Monthly', perYear: 12 },
  { value: 'QUARTERLY', label: 'Quarterly', perYear: 4 },
  { value: 'SEMI_ANNUAL', label: 'Semi-annual', perYear: 2 },
  { value: 'ANNUAL', label: 'Annual', perYear: 1 },
] as const;

export type PaymentMode = (typeof PAYMENT_MODES)[number]['value'];

/**
 * The application body, as both the disposition endpoint and
 * `POST /api/v1/applications` take it.
 *
 * `paymentMode` is always `ANNUAL` and `modalPremium` is the annual premium.
 * The server annualises `modalPremium` by `paymentMode`, so sending the annual
 * figure on the annual mode makes the stored annualised premium exactly what
 * the agent typed -- no conversion, nothing to get backwards.
 */
export interface ApplicationLogPayload {
  clientRequestId: string;
  carrier: string;
  faceAmount: number;
  modalPremium: number;
  paymentMode: PaymentMode;
  firstName: string;
  lastName: string;
  phone?: string;
}

/** What the call already knows, so the agent does not retype it. */
export interface ApplicationLogPrefill {
  carrier?: string | null;
  /** Coverage amount. Named for the column it fills. */
  faceAmount?: number | string | null;
  /** The ANNUAL premium. */
  premium?: number | string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  /** Accepted and ignored: the form no longer asks for these. */
  planType?: string | null;
  dob?: string | null;
  state?: string | null;
}

interface ApplicationLogFormProps {
  prefill?: ApplicationLogPrefill;
  /**
   * Called on every edit with the current payload, or null while the form is
   * incomplete. The owning screen holds the Save button, so it needs both the
   * body to send and whether it can be sent.
   */
  onChange: (payload: ApplicationLogPayload | null) => void;
  /** An error from the last submit, rendered inline above the fields. */
  error?: string | null;
  disabled?: boolean;
}

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

/** Digits and one decimal point, so a typed "$1,2 00.5" still parses. */
function numeric(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.]/g, '');
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function prefillString(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

const FIELD =
  'w-full bg-sunken border border-rule rounded px-3 py-2 text-ink text-xs font-mono ' +
  'focus:outline-none focus:border-brand-ink disabled:opacity-60 disabled:cursor-not-allowed';
const LABEL = 'text-[10px] font-mono uppercase tracking-widest text-ink-2 mb-1 block';

/**
 * The mark on a field the save is gated on.
 *
 * Five of these fields decide whether the Save button does anything, and until
 * this mark existed nothing on the form said which. An agent filled it in,
 * found Save disabled, and had no way to see what was missing except to try
 * boxes -- between calls, with the next one ringing.
 */
function Req(): JSX.Element {
  return (
    <span className="ml-1 text-ringing-ink" title="Required">
      *
    </span>
  );
}

export function ApplicationLogForm({
  prefill,
  onChange,
  error,
  disabled = false,
}: ApplicationLogFormProps) {
  /*
   * Generated once, on mount, and never regenerated. `useRef` rather than
   * `useState` so no re-render can produce a second key, and lazily inside the
   * first render's effect-free path so a server render never reaches
   * `crypto.randomUUID`.
   */
  const clientRequestIdRef = useRef<string>('');
  if (!clientRequestIdRef.current) {
    clientRequestIdRef.current =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : // A browser without randomUUID still needs a key. This is not
          // security-sensitive: it is an idempotency token scoped to one
          // agency, and a collision would be refused by the unique index
          // rather than merging two agencies' applications.
          `${Date.now().toString(16)}-0000-4000-8000-${Math.random().toString(16).slice(2, 14)}`;
  }

  const prefilledCarrier = prefill?.carrier ?? '';
  const knownCarrier = (APPLICATION_CARRIERS as readonly string[]).includes(prefilledCarrier);

  const [carrierChoice, setCarrierChoice] = useState(
    knownCarrier ? prefilledCarrier : prefilledCarrier ? OTHER_CARRIER : ''
  );
  const [otherCarrier, setOtherCarrier] = useState(knownCarrier ? '' : prefilledCarrier);

  const [faceAmount, setFaceAmount] = useState(prefillString(prefill?.faceAmount));
  const [premium, setPremium] = useState(prefillString(prefill?.premium));
  const [firstName, setFirstName] = useState(prefillString(prefill?.firstName));
  const [lastName, setLastName] = useState(prefillString(prefill?.lastName));

  const carrier = carrierChoice === OTHER_CARRIER ? otherCarrier.trim() : carrierChoice;
  const faceValue = numeric(faceAmount);
  const premiumValue = numeric(premium);

  /*
   * The premium is entered annually, so the annualised figure IS what the agent
   * typed. Kept as a named value anyway, because it is the number the agency's
   * production is reported in and the form echoes it back under the field --
   * the agent should see the figure their report will show, not infer it.
   */
  const annualized = premiumValue && premiumValue > 0 ? Number(premiumValue.toFixed(2)) : null;

  /*
   * The payload, or null while it is incomplete. The owning screen disables its
   * Save button off this, so "incomplete" and "cannot send" are one fact rather
   * than two that can disagree.
   */
  const payload: ApplicationLogPayload | null = useMemo(() => {
    if (!carrier) return null;
    if (!faceValue || faceValue <= 0) return null;
    if (!premiumValue || premiumValue <= 0) return null;
    /*
     * BOTH names. The first one used to fall back to the last, so an agent who
     * skipped it produced an application reading "Quintero Quintero" -- a row
     * the agency cannot match against a carrier statement, on the screen whose
     * whole job is that reconciliation, and one it has been charged a credit
     * for. A name is two boxes and the agent has the application in front of
     * them.
     */
    if (!firstName.trim()) return null;
    if (!lastName.trim()) return null;

    return {
      clientRequestId: clientRequestIdRef.current,
      carrier,
      faceAmount: Math.round(faceValue),
      /*
       * The annual premium, on the annual mode. The server annualises
       * `modalPremium` by `paymentMode`, so this stores exactly the figure the
       * agent typed -- there is no conversion to get backwards.
       */
      modalPremium: Number(premiumValue.toFixed(2)),
      paymentMode: 'ANNUAL',
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone: prefill?.phone ? String(prefill.phone).replace(/\D/g, '') || undefined : undefined,
    };
  }, [carrier, faceValue, premiumValue, firstName, lastName, prefill?.phone]);

  useEffect(() => {
    onChange(payload);
  }, [payload, onChange]);

  return (
    <div className="bg-surface border border-rule rounded p-4 space-y-3">
      <h4 className="text-xs font-mono uppercase tracking-widest text-ink pb-2 border-b border-rule">
        Application written
      </h4>

      {error && (
        <div
          role="alert"
          className="bg-dropped-tint border border-dropped/40 rounded p-3 text-xs font-mono text-dropped-ink"
        >
          {error}
        </div>
      )}

      <div>
        <label className={LABEL} htmlFor="app-carrier">
          Carrier
          <Req />
        </label>
        <select
          id="app-carrier"
          value={carrierChoice}
          onChange={e => setCarrierChoice(e.target.value)}
          disabled={disabled}
          className={FIELD}
        >
          <option value="">Select carrier…</option>
          {APPLICATION_CARRIERS.map(name => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
          <option value={OTHER_CARRIER}>{OTHER_CARRIER}</option>
        </select>
        {carrierChoice === OTHER_CARRIER && (
          <input
            type="text"
            value={otherCarrier}
            onChange={e => setOtherCarrier(e.target.value)}
            placeholder="Carrier name"
            maxLength={80}
            disabled={disabled}
            aria-label="Other carrier name"
            className={`${FIELD} mt-2`}
          />
        )}
      </div>

      <div>
        <label className={LABEL} htmlFor="app-face-amount">
          Coverage amount
          <Req />
        </label>
        <input
          id="app-face-amount"
          type="text"
          inputMode="decimal"
          value={faceAmount}
          onChange={e => setFaceAmount(e.target.value)}
          placeholder="10000"
          disabled={disabled}
          className={FIELD}
        />
      </div>

      <div>
        <label className={LABEL} htmlFor="app-premium">
          Annual premium
          <Req />
        </label>
        <input
          id="app-premium"
          type="text"
          inputMode="decimal"
          value={premium}
          onChange={e => setPremium(e.target.value)}
          placeholder="628.80"
          disabled={disabled}
          className={FIELD}
        />
        {/*
          Echoed back under the field, so the agent sees the figure their
          production report will show rather than inferring it.
        */}
        <p className="mt-1 text-[10px] font-mono uppercase tracking-widest text-ink-3">
          {annualized === null ? 'Annualized —' : `Annualized ${currency.format(annualized)} / yr`}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL} htmlFor="app-first-name">
            First name
            <Req />
          </label>
          <input
            id="app-first-name"
            type="text"
            value={firstName}
            onChange={e => setFirstName(e.target.value)}
            disabled={disabled}
            className={FIELD}
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="app-last-name">
            Last name
            <Req />
          </label>
          <input
            id="app-last-name"
            type="text"
            value={lastName}
            onChange={e => setLastName(e.target.value)}
            disabled={disabled}
            className={FIELD}
          />
        </div>
      </div>

      {/*
        No notes box here. The disposition the agent is filling in already has
        one, and two note fields on one screen is an agent wondering which the
        supervisor reads.
      */}
    </div>
  );
}
