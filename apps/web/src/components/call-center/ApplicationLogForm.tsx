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
 * ringing. One column, no sections, every field that can be prefilled from the
 * quote and the call data already filled, and nothing asked for that is not
 * needed to count and reconcile the application. In particular: no SSN and no
 * banking details. The business is already written at the carrier; this records
 * that it happened.
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

const PLAN_TYPES = [
  { value: 'LEVEL', label: 'Level' },
  { value: 'GRADED', label: 'Graded' },
  { value: 'ROP', label: 'Return of Premium' },
  { value: 'GUARANTEED_ISSUE', label: 'Guaranteed Issue' },
] as const;

/** Monthly first: it is what almost every final-expense policy is written on. */
const PAYMENT_MODES = [
  { value: 'MONTHLY', label: 'Monthly', perYear: 12 },
  { value: 'QUARTERLY', label: 'Quarterly', perYear: 4 },
  { value: 'SEMI_ANNUAL', label: 'Semi-annual', perYear: 2 },
  { value: 'ANNUAL', label: 'Annual', perYear: 1 },
] as const;

export type PaymentMode = (typeof PAYMENT_MODES)[number]['value'];

/** The body `POST /api/v1/applications` takes. */
export interface ApplicationLogPayload {
  clientRequestId: string;
  carrier: string;
  product?: string;
  planType?: string;
  faceAmount: number;
  modalPremium: number;
  paymentMode: PaymentMode;
  carrierApplicationNumber?: string;
  firstName: string;
  lastName: string;
  dob?: string;
  state?: string;
  phone?: string;
  notes?: string;
}

/** What the call already knows, so the agent does not retype it. */
export interface ApplicationLogPrefill {
  carrier?: string | null;
  planType?: string | null;
  faceAmount?: number | string | null;
  premium?: number | string | null;
  firstName?: string | null;
  lastName?: string | null;
  dob?: string | null;
  state?: string | null;
  phone?: string | null;
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

/** The annualisation rule, the same one the server stores. */
function annualize(modalPremium: number, mode: PaymentMode): number {
  const perYear = PAYMENT_MODES.find(m => m.value === mode)?.perYear ?? 12;
  return Math.round(modalPremium * perYear * 100) / 100;
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
  const [planType, setPlanType] = useState(() => {
    const raw = (prefill?.planType ?? '').toString().toUpperCase().replace(/\s+/g, '_');
    return (PLAN_TYPES as readonly { value: string }[]).some(p => p.value === raw) ? raw : '';
  });
  const [faceAmount, setFaceAmount] = useState(prefillString(prefill?.faceAmount));
  const [premium, setPremium] = useState(prefillString(prefill?.premium));
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('MONTHLY');
  const [firstName, setFirstName] = useState(prefillString(prefill?.firstName));
  const [lastName, setLastName] = useState(prefillString(prefill?.lastName));
  const [dob, setDob] = useState(prefillString(prefill?.dob));
  const [state, setState] = useState(prefillString(prefill?.state));
  const [applicationNumber, setApplicationNumber] = useState('');
  const [notes, setNotes] = useState('');

  const carrier = carrierChoice === OTHER_CARRIER ? otherCarrier.trim() : carrierChoice;
  const faceValue = numeric(faceAmount);
  const premiumValue = numeric(premium);

  const annualized = useMemo(
    () => (premiumValue && premiumValue > 0 ? annualize(premiumValue, paymentMode) : null),
    [premiumValue, paymentMode]
  );

  /*
   * The payload, or null while it is incomplete. The owning screen disables its
   * Save button off this, so "incomplete" and "cannot send" are one fact rather
   * than two that can disagree.
   */
  const payload: ApplicationLogPayload | null = useMemo(() => {
    if (!carrier) return null;
    if (!faceValue || faceValue <= 0) return null;
    if (!premiumValue || premiumValue <= 0) return null;
    if (!lastName.trim()) return null;

    return {
      clientRequestId: clientRequestIdRef.current,
      carrier,
      planType: planType || undefined,
      faceAmount: Math.round(faceValue),
      modalPremium: Number(premiumValue.toFixed(2)),
      paymentMode,
      carrierApplicationNumber: applicationNumber.trim() || undefined,
      // An application needs a name on it, and an agent who has the last name
      // may not have caught the first. The server takes a first name, so a
      // blank one is sent as the last name rather than refusing the whole
      // application over it.
      firstName: firstName.trim() || lastName.trim(),
      lastName: lastName.trim(),
      dob: /^\d{2}\/\d{2}\/\d{4}$/.test(dob.trim()) ? dob.trim() : undefined,
      state: state.trim() || undefined,
      phone: prefill?.phone ? String(prefill.phone).replace(/\D/g, '') || undefined : undefined,
      notes: notes.trim() || undefined,
    };
  }, [
    carrier,
    faceValue,
    premiumValue,
    paymentMode,
    planType,
    applicationNumber,
    firstName,
    lastName,
    dob,
    state,
    notes,
    prefill?.phone,
  ]);

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
        <label className={LABEL} htmlFor="app-plan-type">
          Plan type
        </label>
        <select
          id="app-plan-type"
          value={planType}
          onChange={e => setPlanType(e.target.value)}
          disabled={disabled}
          className={FIELD}
        >
          <option value="">Not recorded</option>
          {PLAN_TYPES.map(plan => (
            <option key={plan.value} value={plan.value}>
              {plan.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={LABEL} htmlFor="app-face-amount">
          Face amount
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
          Premium
        </label>
        <input
          id="app-premium"
          type="text"
          inputMode="decimal"
          value={premium}
          onChange={e => setPremium(e.target.value)}
          placeholder="52.40"
          disabled={disabled}
          className={FIELD}
        />
        {/*
          The annualised figure, live, under the field the agent just typed in.
          It is what the agency's production is reported in, so the agent sees
          the number they actually logged rather than finding out on a report
          that they logged an annual premium in the monthly box.
        */}
        <p className="mt-1 text-[10px] font-mono uppercase tracking-widest text-ink-3">
          {annualized === null ? 'Annualized —' : `Annualized ${currency.format(annualized)} / yr`}
        </p>
      </div>

      <div>
        <label className={LABEL} htmlFor="app-payment-mode">
          Paid
        </label>
        <select
          id="app-payment-mode"
          value={paymentMode}
          onChange={e => setPaymentMode(e.target.value as PaymentMode)}
          disabled={disabled}
          className={FIELD}
        >
          {PAYMENT_MODES.map(mode => (
            <option key={mode.value} value={mode.value}>
              {mode.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL} htmlFor="app-first-name">
            First name
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

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL} htmlFor="app-dob">
            Date of birth
          </label>
          <input
            id="app-dob"
            type="text"
            value={dob}
            onChange={e => setDob(e.target.value)}
            placeholder="MM/DD/YYYY"
            disabled={disabled}
            className={FIELD}
          />
        </div>
        <div>
          <label className={LABEL} htmlFor="app-state">
            State
          </label>
          <input
            id="app-state"
            type="text"
            value={state}
            onChange={e => setState(e.target.value)}
            disabled={disabled}
            className={FIELD}
          />
        </div>
      </div>

      <div>
        <label className={LABEL} htmlFor="app-number">
          Application no.
        </label>
        <input
          id="app-number"
          type="text"
          value={applicationNumber}
          onChange={e => setApplicationNumber(e.target.value)}
          placeholder="Optional"
          disabled={disabled}
          className={FIELD}
        />
      </div>

      <div>
        <label className={LABEL} htmlFor="app-notes">
          Notes
        </label>
        <textarea
          id="app-notes"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          placeholder="Optional"
          disabled={disabled}
          className={`${FIELD} resize-none`}
        />
      </div>
    </div>
  );
}
