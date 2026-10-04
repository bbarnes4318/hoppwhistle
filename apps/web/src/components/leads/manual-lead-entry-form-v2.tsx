'use client';

import {
  CheckCircle2,
  ChevronDown,
  FileSignature,
  HeartPulse,
  Loader2,
  MapPin,
  Plus,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { useMemo, useState } from 'react';

import {
  Notice,
  Panel,
  PanelBody,
  PanelHeader,
  PanelTitle,
  Segmented,
  SegmentedItem,
} from '@/components/domain';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAgentView } from '@/hooks/use-agent-view';
import { apiClient } from '@/lib/api';
import { CARRIERS, US_STATES } from '@/lib/us-states';
import { cn } from '@/lib/utils';

type Vertical = 'FE' | 'ACA';
type DeliveryChoice = 'CRM_ONLY' | 'SEND_NOW';

interface ManualLeadFormState {
  vertical: Vertical;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  birthDate: string;
  gender: string;
  smoker: string;
  carrier: string;
  annualPremium: string;
  heightFeet: string;
  heightInches: string;
  weight: string;
  trustedFormUrl: string;
  leadIpAddress: string;
  landingPage: string;
  leadidToken: string;
  consentLanguage: string;
  recordingUrl: string;
  notes: string;
}

interface BuyerSubmissionResponse {
  success?: boolean;
  insuranceLeadId?: string;
  submissionId?: string;
  validationStatus?: 'VALID' | 'INVALID';
  postStatus?: string;
  postMode?: 'TEST' | 'LIVE';
  ameriquoteStatus?: string | null;
  ameriquoteLeadId?: string | null;
  ameriquotePrice?: string | null;
  deliveryError?: string | null;
  errors?: Array<{ path: string; message: string }> | null;
}

interface ImportResponse {
  total: number;
  successCount: number;
  failCount: number;
  details: Array<{
    success: boolean;
    phone: string;
    name: string;
    errors: Array<{ path: string; message: string }> | null;
  }>;
}

interface SubmissionResult {
  sentToBuyer: boolean;
  message: string;
  validationStatus?: string;
  postStatus?: string;
  postMode?: string;
  buyerStatus?: string | null;
  buyerError?: string | null;
  insuranceLeadId?: string;
  submissionId?: string;
}

const INITIAL_STATE: ManualLeadFormState = {
  vertical: 'FE',
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  address: '',
  city: '',
  state: '',
  zipCode: '',
  birthDate: '',
  gender: '',
  smoker: '',
  carrier: '',
  annualPremium: '',
  heightFeet: '',
  heightInches: '',
  weight: '',
  trustedFormUrl: '',
  leadIpAddress: '',
  landingPage: '',
  leadidToken: '',
  consentLanguage: '',
  recordingUrl: '',
  notes: '',
};

function digitsOnly(value: string, maxLength?: number): string {
  const digits = value.replace(/\D/g, '');
  return typeof maxLength === 'number' ? digits.slice(0, maxLength) : digits;
}

function formatPhone(value: string): string {
  const digits = digitsOnly(value, 10);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function calculateAge(birthDate: string): number | null {
  if (!birthDate) return null;
  const dob = new Date(`${birthDate}T00:00:00`);
  if (Number.isNaN(dob.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDifference = today.getMonth() - dob.getMonth();
  if (monthDifference < 0 || (monthDifference === 0 && today.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidIpAddress(value: string): boolean {
  const trimmed = value.trim();
  const ipv4Parts = trimmed.split('.');
  if (
    ipv4Parts.length === 4 &&
    ipv4Parts.every(part => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255)
  ) {
    return true;
  }

  return trimmed.includes(':') && /^[0-9a-f:]+$/i.test(trimmed);
}

type FieldKey = keyof ManualLeadFormState;

/** A field a buyer submission needs, and the input that holds it. */
interface Requirement {
  key: FieldKey;
  label: string;
}

/** Fields kept in the collapsed opt-in section, so it opens when one is missing. */
const OPT_IN_FIELDS: ReadonlySet<FieldKey> = new Set([
  'trustedFormUrl',
  'leadIpAddress',
  'landingPage',
  'leadidToken',
  'recordingUrl',
  'consentLanguage',
]);

const CONTROL =
  'flex h-9 w-full rounded-control border border-rule-strong bg-surface px-3 text-sm text-ink shadow-card transition-[border-color,box-shadow] duration-150 ease-out hover:border-ink-3 focus-visible:border-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-dropped aria-[invalid=true]:ring-1 aria-[invalid=true]:ring-dropped [@media(pointer:coarse)]:min-h-[40px]';

function Field({
  id,
  label,
  required = false,
  hint,
  className,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className={cn('grid content-start gap-1.5', className)}>
      <Label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
        {required ? (
          <span className="ml-0.5 text-dropped-ink" aria-hidden>
            *
          </span>
        ) : null}
      </Label>
      {children}
      {hint ? <p className="t-meta text-ink-3">{hint}</p> : null}
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  action,
  children,
}: {
  icon: React.ElementType;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <Panel>
      <PanelHeader action={action} className="py-3.5">
        <PanelTitle className="flex items-center gap-2 text-[15px]">
          <Icon aria-hidden className="h-4 w-4 text-ink-3" />
          {title}
        </PanelTitle>
      </PanelHeader>
      <PanelBody className="grid gap-4">{children}</PanelBody>
    </Panel>
  );
}

/**
 * Add a lead to the CRM by hand.
 *
 * One form, two ways out: "Save lead" stores it in the CRM with HOLD status and
 * makes no buyer request; "Save & send to buyer" (owners and administrators
 * only -- the API refuses an agent) saves it and posts the full buyer payload
 * at once. A buyer needs more than the CRM does, so those extra fields are
 * checked only when that button is pressed, and any that are missing are
 * outlined and listed rather than nagged about up front.
 *
 * The opt-in record (TrustedForm, original IP and landing page, consent) is
 * what the buyer is sent as proof of consent. It must be the values captured
 * when the lead opted in, so it sits in its own section, collapsed until it is
 * wanted.
 */
export function ManualLeadEntryFormV2(): JSX.Element {
  const [form, setForm] = useState<ManualLeadFormState>(INITIAL_STATE);
  const [submitting, setSubmitting] = useState<DeliveryChoice | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SubmissionResult | null>(null);
  const [invalid, setInvalid] = useState<ReadonlySet<FieldKey>>(new Set());
  const [optInOpen, setOptInOpen] = useState(false);

  // Sending to a buyer is the agency owner's or an administrator's action; the
  // API refuses it for an agent, so an agent is not offered it.
  const agentView = useAgentView();
  const calculatedAge = useMemo(() => calculateAge(form.birthDate), [form.birthDate]);

  const buyerRequirements = useMemo<Requirement[]>(() => {
    const required: Requirement[] = [
      { key: 'firstName', label: 'first name' },
      { key: 'lastName', label: 'last name' },
      { key: 'phone', label: '10-digit phone' },
      { key: 'email', label: 'email' },
      { key: 'address', label: 'street address' },
      { key: 'city', label: 'city' },
      { key: 'state', label: 'state' },
      { key: 'zipCode', label: '5-digit ZIP code' },
      { key: 'birthDate', label: 'date of birth' },
      { key: 'leadIpAddress', label: 'original lead IP address' },
      { key: 'landingPage', label: 'original landing page' },
      { key: 'trustedFormUrl', label: 'TrustedForm URL' },
    ];
    if (form.vertical === 'FE') required.push({ key: 'gender', label: 'gender' });
    if (form.vertical === 'ACA') {
      required.push(
        { key: 'heightFeet', label: 'height in feet' },
        { key: 'heightInches', label: 'height in inches' },
        { key: 'weight', label: 'weight' }
      );
    }
    return required;
  }, [form.vertical]);

  const isFilled = (key: FieldKey): boolean => {
    switch (key) {
      case 'phone':
        return digitsOnly(form.phone).length === 10;
      case 'zipCode':
        return /^\d{5}$/.test(digitsOnly(form.zipCode));
      case 'birthDate':
        return Boolean(form.birthDate) && calculatedAge !== null;
      case 'heightInches':
        return form.heightInches !== '';
      default:
        return String(form[key]).trim() !== '';
    }
  };

  const buyerMissing = buyerRequirements.filter(requirement => !isFilled(requirement.key));
  const buyerReady = buyerRequirements.length - buyerMissing.length;
  const crmReady =
    Boolean(form.firstName.trim()) &&
    Boolean(form.lastName.trim()) &&
    digitsOnly(form.phone).length === 10 &&
    Boolean(form.state);
  const optInFilled = [...OPT_IN_FIELDS].filter(key => String(form[key]).trim() !== '').length;

  const update = <K extends keyof ManualLeadFormState>(key: K, value: ManualLeadFormState[K]) => {
    setForm(previous => ({ ...previous, [key]: value }));
    setError('');
    setResult(null);
    if (invalid.has(key)) {
      setInvalid(previous => {
        const next = new Set(previous);
        next.delete(key);
        return next;
      });
    }
  };

  const reset = () => {
    setForm(INITIAL_STATE);
    setError('');
    setResult(null);
    setInvalid(new Set());
  };

  /** Mark fields invalid, open the opt-in section if one is there, and say why. */
  const refuse = (keys: FieldKey[], message: string) => {
    setInvalid(new Set(keys));
    if (keys.some(key => OPT_IN_FIELDS.has(key))) setOptInOpen(true);
    setError(message);
  };

  const submit = async (choice: DeliveryChoice) => {
    setError('');
    setResult(null);
    const sendToBuyer = choice === 'SEND_NOW' && !agentView;

    const phone = digitsOnly(form.phone);
    const basics: FieldKey[] = [];
    if (!form.firstName.trim()) basics.push('firstName');
    if (!form.lastName.trim()) basics.push('lastName');
    if (phone.length !== 10) basics.push('phone');
    if (!form.state) basics.push('state');
    if (basics.length > 0) {
      refuse(basics, 'Enter the first and last name, a 10-digit phone number and the state.');
      return;
    }

    if (sendToBuyer) {
      if (buyerMissing.length > 0) {
        refuse(
          buyerMissing.map(requirement => requirement.key),
          `To send to the buyer, complete: ${buyerMissing.map(r => r.label).join(', ')}.`
        );
        return;
      }
      if (!isHttpUrl(form.trustedFormUrl.trim())) {
        refuse(
          ['trustedFormUrl'],
          'Enter a valid TrustedForm URL beginning with http:// or https://.'
        );
        return;
      }
      if (!isHttpUrl(form.landingPage.trim())) {
        refuse(
          ['landingPage'],
          'Enter a valid original landing-page URL beginning with http:// or https://.'
        );
        return;
      }
      if (!isValidIpAddress(form.leadIpAddress)) {
        refuse(
          ['leadIpAddress'],
          'Enter the original lead IP address in valid IPv4 or IPv6 format.'
        );
        return;
      }
      if (form.recordingUrl.trim() && !isHttpUrl(form.recordingUrl.trim())) {
        refuse(['recordingUrl'], 'Enter a valid recording URL beginning with http:// or https://.');
        return;
      }
    }
    setInvalid(new Set());

    const payload: Record<string, unknown> = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      phone,
      email: form.email.trim() || undefined,
      address: form.address.trim() || undefined,
      city: form.city.trim() || undefined,
      state: form.state,
      zipCode: digitsOnly(form.zipCode, 5) || undefined,
      birthDate: form.birthDate || undefined,
      age: calculatedAge ?? undefined,
      gender: form.gender || undefined,
      smoker: form.smoker || undefined,
      carrier: form.carrier || undefined,
      // The CRM stores a monthly premium; agents enter it annually.
      monthlyPremium:
        Number(form.annualPremium) > 0
          ? (Math.round((Number(form.annualPremium) / 12) * 100) / 100).toFixed(2)
          : undefined,
      heightFeet: form.heightFeet ? Number(form.heightFeet) : undefined,
      heightInches: form.heightInches === '' ? undefined : Number(form.heightInches),
      weight: form.weight ? Number(form.weight) : undefined,
      trustedFormUrl: form.trustedFormUrl.trim() || undefined,
      ipAddress: form.leadIpAddress.trim() || undefined,
      landingPage: form.landingPage.trim() || undefined,
      leadidToken: form.leadidToken.trim() || undefined,
      consentLanguage: form.consentLanguage.trim() || undefined,
      recordingUrl: form.recordingUrl.trim() || undefined,
      source: 'manual_crm_entry',
      notes: form.notes.trim() || undefined,
    };

    setSubmitting(choice);
    try {
      if (sendToBuyer) {
        const response = await apiClient.post<BuyerSubmissionResponse>(
          `/api/v1/insurance-leads/inbound/${form.vertical.toLowerCase()}`,
          payload
        );

        if (response.error) {
          setError(response.error.message);
          return;
        }

        const data = response.data;
        if (!data) {
          setError('The server returned an empty response.');
          return;
        }

        const buyerError =
          data.deliveryError ||
          data.errors?.map(item => `${item.path}: ${item.message}`).join('; ') ||
          null;

        setResult({
          sentToBuyer: true,
          message:
            data.postStatus === 'ERROR'
              ? 'Saved to the CRM, but the buyer returned an error.'
              : `Saved and sent to the buyer: ${data.ameriquoteStatus || data.postStatus || 'Unknown'}.`,
          validationStatus: data.validationStatus,
          postStatus: data.postStatus,
          postMode: data.postMode,
          buyerStatus: data.ameriquoteStatus,
          buyerError,
          insuranceLeadId: data.insuranceLeadId,
          submissionId: data.submissionId,
        });
      } else {
        const response = await apiClient.post<ImportResponse>('/api/v1/insurance-leads/import', {
          vertical: form.vertical,
          listName: 'Manual CRM Entries',
          leads: [payload],
        });

        if (response.error) {
          setError(response.error.message);
          return;
        }

        const data = response.data;
        if (!data || data.successCount !== 1) {
          const details = data?.details?.[0]?.errors
            ?.map(item => `${item.path}: ${item.message}`)
            .join('; ');
          setError(details || 'The lead could not be saved to the CRM.');
          return;
        }

        setResult({
          sentToBuyer: false,
          message: 'Lead saved to the CRM.',
          validationStatus: 'VALID',
          postStatus: 'HOLD',
        });
      }
    } finally {
      setSubmitting(null);
    }
  };

  const bad = (key: FieldKey) => (invalid.has(key) ? true : undefined);
  const name = [form.firstName.trim(), form.lastName.trim()].filter(Boolean).join(' ');
  const initials =
    [form.firstName.trim()[0], form.lastName.trim()[0]].filter(Boolean).join('').toUpperCase() ||
    null;
  const place = [form.city.trim(), [form.state, digitsOnly(form.zipCode)].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  const busy = submitting !== null;

  return (
    <form
      onSubmit={event => {
        event.preventDefault();
        void submit('CRM_ONLY');
      }}
      noValidate
      className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]"
    >
      <div className="grid min-w-0 gap-6">
        <Section
          icon={UserRound}
          title="Contact"
          action={
            <Segmented aria-label="Lead type">
              <SegmentedItem
                active={form.vertical === 'FE'}
                aria-pressed={form.vertical === 'FE'}
                onClick={() => update('vertical', 'FE')}
              >
                Final Expense
              </SegmentedItem>
              <SegmentedItem
                active={form.vertical === 'ACA'}
                aria-pressed={form.vertical === 'ACA'}
                onClick={() => update('vertical', 'ACA')}
              >
                ACA
              </SegmentedItem>
            </Segmented>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="firstName" label="First name" required>
              <Input
                id="firstName"
                autoComplete="off"
                value={form.firstName}
                onChange={event => update('firstName', event.target.value)}
                aria-invalid={bad('firstName')}
                className={CONTROL}
              />
            </Field>
            <Field id="lastName" label="Last name" required>
              <Input
                id="lastName"
                autoComplete="off"
                value={form.lastName}
                onChange={event => update('lastName', event.target.value)}
                aria-invalid={bad('lastName')}
                className={CONTROL}
              />
            </Field>
            <Field id="phone" label="Phone" required>
              <Input
                id="phone"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                value={form.phone}
                onChange={event => update('phone', formatPhone(event.target.value))}
                aria-invalid={bad('phone')}
                className={cn(CONTROL, 't-data')}
                placeholder="(555) 123-4567"
              />
            </Field>
            <Field id="email" label="Email">
              <Input
                id="email"
                type="email"
                autoComplete="off"
                value={form.email}
                onChange={event => update('email', event.target.value)}
                aria-invalid={bad('email')}
                className={CONTROL}
                placeholder="name@example.com"
              />
            </Field>
          </div>
        </Section>

        <Section icon={MapPin} title="Address">
          <div className="grid gap-4 sm:grid-cols-6">
            <Field id="address" label="Street address" className="sm:col-span-6">
              <Input
                id="address"
                autoComplete="off"
                value={form.address}
                onChange={event => update('address', event.target.value)}
                aria-invalid={bad('address')}
                className={CONTROL}
              />
            </Field>
            <Field id="city" label="City" className="sm:col-span-3">
              <Input
                id="city"
                autoComplete="off"
                value={form.city}
                onChange={event => update('city', event.target.value)}
                aria-invalid={bad('city')}
                className={CONTROL}
              />
            </Field>
            <Field id="state" label="State" required className="sm:col-span-2">
              <select
                id="state"
                value={form.state}
                onChange={event => update('state', event.target.value)}
                aria-invalid={bad('state')}
                className={CONTROL}
              >
                <option value="">Select</option>
                {US_STATES.map(state => (
                  <option key={state.value} value={state.value}>
                    {state.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="zipCode" label="ZIP" className="sm:col-span-1">
              <Input
                id="zipCode"
                inputMode="numeric"
                autoComplete="off"
                value={form.zipCode}
                onChange={event => update('zipCode', digitsOnly(event.target.value, 5))}
                aria-invalid={bad('zipCode')}
                className={cn(CONTROL, 't-data')}
              />
            </Field>
          </div>
        </Section>

        <Section icon={HeartPulse} title="Profile">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field
              id="birthDate"
              label="Date of birth"
              hint={calculatedAge !== null ? `Age ${calculatedAge}` : undefined}
            >
              <Input
                id="birthDate"
                type="date"
                value={form.birthDate}
                onChange={event => update('birthDate', event.target.value)}
                aria-invalid={bad('birthDate')}
                className={CONTROL}
              />
            </Field>
            {form.vertical === 'FE' ? (
              <Field id="gender" label="Gender">
                <select
                  id="gender"
                  value={form.gender}
                  onChange={event => update('gender', event.target.value)}
                  aria-invalid={bad('gender')}
                  className={CONTROL}
                >
                  <option value="">Select</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Non-binary">Non-binary</option>
                </select>
              </Field>
            ) : (
              <Field id="weight" label="Weight (lb)">
                <Input
                  id="weight"
                  type="number"
                  min="1"
                  value={form.weight}
                  onChange={event => update('weight', event.target.value)}
                  aria-invalid={bad('weight')}
                  className={CONTROL}
                />
              </Field>
            )}
            <Field id="smoker" label="Tobacco use">
              <select
                id="smoker"
                value={form.smoker}
                onChange={event => update('smoker', event.target.value)}
                className={CONTROL}
              >
                <option value="">Unknown</option>
                <option value="No">No</option>
                <option value="Yes">Yes</option>
              </select>
            </Field>
            {form.vertical === 'ACA' ? (
              <div className="grid grid-cols-2 gap-2">
                <Field id="heightFeet" label="Height (ft)">
                  <Input
                    id="heightFeet"
                    type="number"
                    min="1"
                    max="8"
                    value={form.heightFeet}
                    onChange={event => update('heightFeet', event.target.value)}
                    aria-invalid={bad('heightFeet')}
                    className={CONTROL}
                  />
                </Field>
                <Field id="heightInches" label="(in)">
                  <Input
                    id="heightInches"
                    type="number"
                    min="0"
                    max="11"
                    value={form.heightInches}
                    onChange={event => update('heightInches', event.target.value)}
                    aria-invalid={bad('heightInches')}
                    className={CONTROL}
                  />
                </Field>
              </div>
            ) : null}
          </div>
        </Section>

        <Section icon={FileSignature} title="Policy & notes">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="carrier" label="Carrier">
              <select
                id="carrier"
                value={form.carrier}
                onChange={event => update('carrier', event.target.value)}
                className={CONTROL}
              >
                <option value="">Select carrier</option>
                {CARRIERS.map(carrier => (
                  <option key={carrier.value} value={carrier.value}>
                    {carrier.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="annualPremium" label="Annual premium">
              <div className="relative">
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-ink-3"
                >
                  $
                </span>
                <Input
                  id="annualPremium"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.annualPremium}
                  onChange={event => update('annualPremium', event.target.value)}
                  className={cn(CONTROL, 'pl-6 tabular-nums')}
                  placeholder="0.00"
                />
              </div>
            </Field>
            <Field id="notes" label="Internal notes" className="sm:col-span-2">
              <textarea
                id="notes"
                value={form.notes}
                onChange={event => update('notes', event.target.value)}
                rows={3}
                className={cn(CONTROL, 'h-auto min-h-[84px] py-2')}
                placeholder="Visible to your team only."
              />
            </Field>
          </div>
        </Section>

        <Panel data-opt-in-record>
          <button
            type="button"
            onClick={() => setOptInOpen(open => !open)}
            aria-expanded={optInOpen}
            aria-controls="opt-in-record"
            className="flex w-full items-center justify-between gap-3 rounded-card px-5 py-3.5 text-left transition-colors hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring min-[1440px]:px-6"
          >
            <span className="flex min-w-0 items-center gap-2">
              <ShieldCheck aria-hidden className="h-4 w-4 shrink-0 text-ink-3" />
              <span className="t-section shrink-0 text-[15px] text-ink">Opt-in record</span>
              <span className="t-meta hidden truncate text-ink-3 sm:inline">
                TrustedForm, IP, landing page, consent
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {optInFilled > 0 ? <Badge variant="secondary">{optInFilled} added</Badge> : null}
              <ChevronDown
                aria-hidden
                className={cn(
                  'h-4 w-4 text-ink-3 transition-transform duration-150',
                  optInOpen && 'rotate-180'
                )}
              />
            </span>
          </button>
          {optInOpen ? (
            <div
              id="opt-in-record"
              className="grid gap-4 border-t border-rule p-5 sm:grid-cols-2 min-[1440px]:p-6"
            >
              <Field
                id="trustedFormUrl"
                label="TrustedForm certificate URL"
                className="sm:col-span-2"
              >
                <Input
                  id="trustedFormUrl"
                  type="url"
                  value={form.trustedFormUrl}
                  onChange={event => update('trustedFormUrl', event.target.value)}
                  aria-invalid={bad('trustedFormUrl')}
                  className={CONTROL}
                  placeholder="https://cert.trustedform.com/…"
                />
              </Field>
              <Field id="leadIpAddress" label="Original IP address">
                <Input
                  id="leadIpAddress"
                  value={form.leadIpAddress}
                  onChange={event => update('leadIpAddress', event.target.value)}
                  aria-invalid={bad('leadIpAddress')}
                  className={cn(CONTROL, 't-data')}
                  placeholder="75.2.92.149"
                />
              </Field>
              <Field id="landingPage" label="Original landing page">
                <Input
                  id="landingPage"
                  type="url"
                  value={form.landingPage}
                  onChange={event => update('landingPage', event.target.value)}
                  aria-invalid={bad('landingPage')}
                  className={CONTROL}
                  placeholder="https://example.com/final-expense"
                />
              </Field>
              <Field id="leadidToken" label="Jornaya LeadID token">
                <Input
                  id="leadidToken"
                  value={form.leadidToken}
                  onChange={event => update('leadidToken', event.target.value)}
                  className={cn(CONTROL, 't-data')}
                />
              </Field>
              <Field id="recordingUrl" label="Recording URL">
                <Input
                  id="recordingUrl"
                  type="url"
                  value={form.recordingUrl}
                  onChange={event => update('recordingUrl', event.target.value)}
                  aria-invalid={bad('recordingUrl')}
                  className={CONTROL}
                />
              </Field>
              <Field id="consentLanguage" label="Consent language" className="sm:col-span-2">
                <textarea
                  id="consentLanguage"
                  value={form.consentLanguage}
                  onChange={event => update('consentLanguage', event.target.value)}
                  rows={3}
                  className={cn(CONTROL, 'h-auto min-h-[84px] py-2')}
                  placeholder="The exact consent disclosure the lead agreed to."
                />
              </Field>
            </div>
          ) : null}
        </Panel>
      </div>

      <aside className="grid gap-4 lg:sticky lg:top-6" aria-label="Lead summary">
        <Panel>
          <PanelBody className="grid gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-tint text-sm font-semibold text-brand-ink"
              >
                {initials ?? <UserRound className="h-5 w-5" />}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{name || 'New lead'}</p>
                <p className="t-meta truncate text-ink-3">
                  {form.vertical === 'FE' ? 'Final Expense' : 'ACA'}
                  {calculatedAge !== null ? ` · Age ${calculatedAge}` : ''}
                </p>
              </div>
            </div>

            <dl className="grid gap-2 border-t border-rule pt-4 text-sm">
              <SummaryRow label="Phone" value={form.phone} mono />
              <SummaryRow label="Location" value={place} />
              <SummaryRow label="Email" value={form.email.trim()} />
            </dl>

            {!agentView ? (
              <div className="grid gap-1.5 border-t border-rule pt-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-ink">Buyer-ready</span>
                  <span className="t-num text-ink-2">
                    {buyerReady}/{buyerRequirements.length}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
                  <div
                    className={cn(
                      'h-full rounded-full transition-[width] duration-300',
                      buyerMissing.length === 0 ? 'bg-live' : 'bg-brand'
                    )}
                    style={{ width: `${(buyerReady / buyerRequirements.length) * 100}%` }}
                  />
                </div>
                <p className="t-meta text-ink-3">
                  {buyerMissing.length === 0
                    ? 'Everything a buyer needs is filled in.'
                    : 'Fields a buyer needs before it can be sent.'}
                </p>
              </div>
            ) : null}

            {error ? <Notice tone="error" title={error} /> : null}

            {result ? (
              <Notice
                tone={result.sentToBuyer && result.postStatus === 'ERROR' ? 'warning' : 'info'}
                icon={CheckCircle2}
                title={result.message}
              >
                <span className="grid gap-0.5">
                  {!result.sentToBuyer ? (
                    <span>Status HOLD. Nothing was sent to a buyer.</span>
                  ) : null}
                  {result.postMode ? <span>Delivery mode: {result.postMode}</span> : null}
                  {result.buyerError ? <span>Buyer response: {result.buyerError}</span> : null}
                  {result.insuranceLeadId ? (
                    <span>CRM lead ID: {result.insuranceLeadId}</span>
                  ) : null}
                  {result.submissionId ? <span>Submission ID: {result.submissionId}</span> : null}
                </span>
              </Notice>
            ) : null}

            {result ? (
              <div className="grid gap-2">
                <Button type="button" onClick={reset}>
                  <Plus aria-hidden className="mr-2 h-4 w-4" />
                  Add another lead
                </Button>
                <Button asChild type="button" variant="outline">
                  <Link href="/insurance-leads">Return to CRM</Link>
                </Button>
              </div>
            ) : (
              <div className="grid gap-2">
                <Button type="submit" disabled={busy}>
                  {submitting === 'CRM_ONLY' ? (
                    <Loader2 aria-hidden className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save aria-hidden className="mr-2 h-4 w-4" />
                  )}
                  {submitting === 'CRM_ONLY' ? 'Saving…' : 'Save lead'}
                </Button>
                {!agentView ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void submit('SEND_NOW')}
                  >
                    {submitting === 'SEND_NOW' ? (
                      <Loader2 aria-hidden className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Send aria-hidden className="mr-2 h-4 w-4" />
                    )}
                    {submitting === 'SEND_NOW' ? 'Saving & sending…' : 'Save & send to buyer'}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={reset}
                  disabled={busy}
                  className="justify-self-center"
                >
                  <RotateCcw aria-hidden className="mr-1.5 h-3.5 w-3.5" />
                  Clear form
                </Button>
                <p className="t-meta text-center text-ink-3">
                  {crmReady ? 'Ready to save.' : 'Name, phone and state are needed to save.'}
                </p>
              </div>
            )}
          </PanelBody>
        </Panel>
      </aside>
    </form>
  );
}

function SummaryRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="t-meta shrink-0 text-ink-3">{label}</dt>
      <dd
        className={cn(
          'min-w-0 truncate text-right',
          value ? 'text-ink' : 'text-ink-3',
          mono && value && 't-data'
        )}
      >
        {value || '—'}
      </dd>
    </div>
  );
}
