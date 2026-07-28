'use client';

import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  RotateCcw,
  Save,
  Send,
  Shield,
} from 'lucide-react';
import Link from 'next/link';
import { type FormEvent, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiClient } from '@/lib/api';
import { US_STATES } from '@/lib/us-states';

type Vertical = 'FE' | 'ACA';
type DeliveryChoice = 'CRM_ONLY' | 'SEND_NOW';

interface ManualLeadFormState {
  vertical: Vertical;
  deliveryChoice: DeliveryChoice;
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
  deliveryChoice: 'CRM_ONLY',
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

function RequiredMark({ show = true }: { show?: boolean }): JSX.Element | null {
  return show ? <span className="text-red-400">*</span> : null;
}

export function ManualLeadEntryFormV2(): JSX.Element {
  const [form, setForm] = useState<ManualLeadFormState>(INITIAL_STATE);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SubmissionResult | null>(null);

  const sendToBuyer = form.deliveryChoice === 'SEND_NOW';
  const calculatedAge = useMemo(() => calculateAge(form.birthDate), [form.birthDate]);

  const buyerRequirementsMissing = useMemo(() => {
    if (!sendToBuyer) return [];

    const missing: string[] = [];
    if (!form.firstName.trim()) missing.push('first name');
    if (!form.lastName.trim()) missing.push('last name');
    if (digitsOnly(form.phone).length !== 10) missing.push('10-digit phone');
    if (!form.email.trim()) missing.push('email');
    if (!form.address.trim()) missing.push('street address');
    if (!form.city.trim()) missing.push('city');
    if (!form.state) missing.push('state');
    if (!/^\d{5}$/.test(digitsOnly(form.zipCode))) missing.push('5-digit ZIP code');
    if (!form.birthDate || calculatedAge === null) missing.push('date of birth');
    if (!form.leadIpAddress.trim()) missing.push('original lead IP address');
    if (!form.landingPage.trim()) missing.push('original landing page');
    if (!form.trustedFormUrl.trim()) missing.push('TrustedForm URL');

    if (form.vertical === 'FE' && !form.gender) missing.push('gender');
    if (form.vertical === 'ACA') {
      if (!form.heightFeet) missing.push('height in feet');
      if (form.heightInches === '') missing.push('height in inches');
      if (!form.weight) missing.push('weight');
    }

    return missing;
  }, [calculatedAge, form, sendToBuyer]);

  const update = <K extends keyof ManualLeadFormState>(
    key: K,
    value: ManualLeadFormState[K]
  ) => {
    setForm(previous => ({ ...previous, [key]: value }));
    setError('');
    setResult(null);
  };

  const reset = () => {
    setForm(INITIAL_STATE);
    setError('');
    setResult(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setResult(null);

    const phone = digitsOnly(form.phone);
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setError('First name and last name are required.');
      return;
    }
    if (phone.length !== 10) {
      setError('Enter a valid 10-digit phone number.');
      return;
    }
    if (!form.state) {
      setError('Select the lead’s state.');
      return;
    }

    if (sendToBuyer) {
      if (buyerRequirementsMissing.length > 0) {
        setError(`Complete the buyer-required fields: ${buyerRequirementsMissing.join(', ')}.`);
        return;
      }
      if (!isHttpUrl(form.trustedFormUrl.trim())) {
        setError('Enter a valid TrustedForm URL beginning with http:// or https://.');
        return;
      }
      if (!isHttpUrl(form.landingPage.trim())) {
        setError('Enter a valid original landing-page URL beginning with http:// or https://.');
        return;
      }
      if (!isValidIpAddress(form.leadIpAddress)) {
        setError('Enter the original lead IP address in valid IPv4 or IPv6 format.');
        return;
      }
      if (form.recordingUrl.trim() && !isHttpUrl(form.recordingUrl.trim())) {
        setError('Enter a valid recording URL beginning with http:// or https://.');
        return;
      }
    }

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

    setSubmitting(true);
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
              ? 'Lead was saved to the CRM, but the buyer returned an error.'
              : `Lead was saved and submitted to the buyer with status ${data.ameriquoteStatus || data.postStatus || 'Unknown'}.`,
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
          message: 'Lead saved to the CRM. Nothing was sent to the buyer.',
          validationStatus: 'VALID',
          postStatus: 'HOLD',
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <section className="rounded-xl border border-slate-700 bg-slate-900/70 p-5">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-white">Manual CRM Lead Entry</h2>
          <p className="mt-1 text-sm text-slate-400">
            Enter the lead once, then explicitly choose whether it stays in the CRM or is submitted.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label
            className={`cursor-pointer rounded-lg border p-4 transition-colors ${
              form.deliveryChoice === 'CRM_ONLY'
                ? 'border-emerald-500 bg-emerald-500/10'
                : 'border-slate-700 bg-slate-950/40 hover:border-slate-500'
            }`}
          >
            <div className="flex items-start gap-3">
              <input
                type="radio"
                name="deliveryChoice"
                value="CRM_ONLY"
                checked={form.deliveryChoice === 'CRM_ONLY'}
                onChange={() => update('deliveryChoice', 'CRM_ONLY')}
                className="mt-1"
              />
              <div>
                <div className="flex items-center gap-2 font-semibold text-white">
                  <Save className="h-4 w-4 text-emerald-400" />
                  Save to CRM Only
                </div>
                <p className="mt-1 text-sm text-slate-400">
                  Store the lead with HOLD status. No buyer request is made.
                </p>
              </div>
            </div>
          </label>

          <label
            className={`cursor-pointer rounded-lg border p-4 transition-colors ${
              form.deliveryChoice === 'SEND_NOW'
                ? 'border-amber-500 bg-amber-500/10'
                : 'border-slate-700 bg-slate-950/40 hover:border-slate-500'
            }`}
          >
            <div className="flex items-start gap-3">
              <input
                type="radio"
                name="deliveryChoice"
                value="SEND_NOW"
                checked={form.deliveryChoice === 'SEND_NOW'}
                onChange={() => update('deliveryChoice', 'SEND_NOW')}
                className="mt-1"
              />
              <div>
                <div className="flex items-center gap-2 font-semibold text-white">
                  <Send className="h-4 w-4 text-amber-400" />
                  Save &amp; Send to Buyer
                </div>
                <p className="mt-1 text-sm text-slate-400">
                  Save the lead and immediately submit the complete buyer payload.
                </p>
              </div>
            </div>
          </label>
        </div>

        {sendToBuyer && (
          <div className="mt-4 flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              This performs an immediate buyer submission. Every field marked with an asterisk must
              contain the original lead data.
            </p>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-700 bg-slate-900/70 p-5">
        <div className="mb-4 flex items-center gap-2">
          <Info className="h-5 w-5 text-cyan-400" />
          <h3 className="font-semibold text-white">Lead Information</h3>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="vertical" className="text-slate-300">
              Lead Type <RequiredMark />
            </Label>
            <select
              id="vertical"
              value={form.vertical}
              onChange={event => update('vertical', event.target.value as Vertical)}
              className="h-10 w-full rounded-md border border-slate-600 bg-slate-800 px-3 text-sm text-white"
            >
              <option value="FE">Final Expense</option>
              <option value="ACA">ACA</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="firstName" className="text-slate-300">
              First Name <RequiredMark />
            </Label>
            <Input
              id="firstName"
              value={form.firstName}
              onChange={event => update('firstName', event.target.value)}
              className="border-slate-600 bg-slate-800 text-white"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="lastName" className="text-slate-300">
              Last Name <RequiredMark />
            </Label>
            <Input
              id="lastName"
              value={form.lastName}
              onChange={event => update('lastName', event.target.value)}
              className="border-slate-600 bg-slate-800 text-white"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="phone" className="text-slate-300">
              Phone <RequiredMark />
            </Label>
            <Input
              id="phone"
              value={form.phone}
              onChange={event => update('phone', formatPhone(event.target.value))}
              className="border-slate-600 bg-slate-800 text-white"
              placeholder="(555) 123-4567"
            />
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-slate-300">
              Email <RequiredMark show={sendToBuyer} />
            </Label>
            <Input
              id="email"
              type="email"
              value={form.email}
              onChange={event => update('email', event.target.value)}
              className="border-slate-600 bg-slate-800 text-white"
            />
          </div>

          <div className="space-y-1.5 lg:col-span-2">
            <Label htmlFor="address" className="text-slate-300">
              Street Address <RequiredMark show={sendToBuyer} />
            </Label>
            <Input
              id="address"
              value={form.address}
              onChange={event => update('address', event.target.value)}
              className="border-slate-600 bg-slate-800 text-white"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="city" className="text-slate-300">
              City <RequiredMark show={sendToBuyer} />
            </Label>
            <Input
              id="city"
              value={form.city}
              onChange={event => update('city', event.target.value)}
              className="border-slate-600 bg-slate-800 text-white"
            />
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1.5">
            <Label htmlFor="state" className="text-slate-300">
              State <RequiredMark />
            </Label>
            <select
              id="state"
              value={form.state}
              onChange={event => update('state', event.target.value)}
              className="h-10 w-full rounded-md border border-slate-600 bg-slate-800 px-3 text-sm text-white"
            >
              <option value="">Select state</option>
              {US_STATES.map(state => (
                <option key={state.value} value={state.value}>
                  {state.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="zipCode" className="text-slate-300">
              ZIP Code <RequiredMark show={sendToBuyer} />
            </Label>
            <Input
              id="zipCode"
              inputMode="numeric"
              value={form.zipCode}
              onChange={event => update('zipCode', digitsOnly(event.target.value, 5))}
              className="border-slate-600 bg-slate-800 text-white"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="birthDate" className="text-slate-300">
              Date of Birth <RequiredMark show={sendToBuyer} />
            </Label>
            <Input
              id="birthDate"
              type="date"
              value={form.birthDate}
              onChange={event => update('birthDate', event.target.value)}
              className="border-slate-600 bg-slate-800 text-white"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="age" className="text-slate-300">
              Age {sendToBuyer && <span className="text-xs text-slate-500">(required)</span>}
            </Label>
            <Input
              id="age"
              value={calculatedAge ?? ''}
              readOnly
              className="border-slate-600 bg-slate-950 text-slate-300"
              placeholder="Calculated from DOB"
            />
          </div>

          {form.vertical === 'FE' ? (
            <div className="space-y-1.5">
              <Label htmlFor="gender" className="text-slate-300">
                Gender <RequiredMark show={sendToBuyer} />
              </Label>
              <select
                id="gender"
                value={form.gender}
                onChange={event => update('gender', event.target.value)}
                className="h-10 w-full rounded-md border border-slate-600 bg-slate-800 px-3 text-sm text-white"
              >
                <option value="">Select</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Non-binary">Non-binary</option>
              </select>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="weight" className="text-slate-300">
                Weight (lb) <RequiredMark show={sendToBuyer} />
              </Label>
              <Input
                id="weight"
                type="number"
                min="1"
                value={form.weight}
                onChange={event => update('weight', event.target.value)}
                className="border-slate-600 bg-slate-800 text-white"
              />
            </div>
          )}
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="smoker" className="text-slate-300">
              Tobacco Use
            </Label>
            <select
              id="smoker"
              value={form.smoker}
              onChange={event => update('smoker', event.target.value)}
              className="h-10 w-full rounded-md border border-slate-600 bg-slate-800 px-3 text-sm text-white"
            >
              <option value="">Unknown</option>
              <option value="No">No</option>
              <option value="Yes">Yes</option>
            </select>
          </div>

          {form.vertical === 'ACA' && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="heightFeet" className="text-slate-300">
                  Height Feet <RequiredMark show={sendToBuyer} />
                </Label>
                <Input
                  id="heightFeet"
                  type="number"
                  min="1"
                  max="8"
                  value={form.heightFeet}
                  onChange={event => update('heightFeet', event.target.value)}
                  className="border-slate-600 bg-slate-800 text-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="heightInches" className="text-slate-300">
                  Height Inches <RequiredMark show={sendToBuyer} />
                </Label>
                <Input
                  id="heightInches"
                  type="number"
                  min="0"
                  max="11"
                  value={form.heightInches}
                  onChange={event => update('heightInches', event.target.value)}
                  className="border-slate-600 bg-slate-800 text-white"
                />
              </div>
            </>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-slate-700 bg-slate-900/70 p-5">
        <div className="mb-4 flex items-center gap-2">
          <Shield className="h-5 w-5 text-emerald-400" />
          <div>
            <h3 className="font-semibold text-white">Compliance &amp; Original Source Data</h3>
            <p className="text-sm text-slate-400">
              Use the values captured when the lead originally opted in—not the operator’s current IP
              or the Hopwhistle CRM page.
            </p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-1.5 lg:col-span-2">
            <Label htmlFor="trustedFormUrl" className="text-slate-300">
              TrustedForm Certificate URL <RequiredMark show={sendToBuyer} />
            </Label>
            <Input
              id="trustedFormUrl"
              type="url"
              value={form.trustedFormUrl}
              onChange={event => update('trustedFormUrl', event.target.value)}
              className="border-slate-600 bg-slate-800 text-white"
              placeholder="https://cert.trustedform.com/..."
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="leadIpAddress" className="text-slate-300">
              Original Lead IP Address <RequiredMark show={sendToBuyer} />
            </Label>
            <Input
              id="leadIpAddress"
              value={form.leadIpAddress}
              onChange={event => update('leadIpAddress', event.target.value)}
              className="border-slate-600 bg-slate-800 text-white"
              placeholder="75.2.92.149"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="landingPage" className="text-slate-300">
              Original Landing Page <RequiredMark show={sendToBuyer} />
            </Label>
            <Input
              id="landingPage"
              type="url"
              value={form.landingPage}
              onChange={event => update('landingPage', event.target.value)}
              className="border-slate-600 bg-slate-800 text-white"
              placeholder="https://example.com/final-expense"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="leadidToken" className="text-slate-300">
              Jornaya LeadID Token
            </Label>
            <Input
              id="leadidToken"
              value={form.leadidToken}
              onChange={event => update('leadidToken', event.target.value)}
              className="border-slate-600 bg-slate-800 text-white"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="recordingUrl" className="text-slate-300">
              Recording URL
            </Label>
            <Input
              id="recordingUrl"
              type="url"
              value={form.recordingUrl}
              onChange={event => update('recordingUrl', event.target.value)}
              className="border-slate-600 bg-slate-800 text-white"
            />
          </div>

          <div className="space-y-1.5 lg:col-span-2">
            <Label htmlFor="consentLanguage" className="text-slate-300">
              Consent Language
            </Label>
            <textarea
              id="consentLanguage"
              value={form.consentLanguage}
              onChange={event => update('consentLanguage', event.target.value)}
              rows={3}
              className="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
              placeholder="Paste the exact consent disclosure associated with the lead."
            />
          </div>

          <div className="space-y-1.5 lg:col-span-2">
            <Label htmlFor="notes" className="text-slate-300">
              Internal Notes
            </Label>
            <textarea
              id="notes"
              value={form.notes}
              onChange={event => update('notes', event.target.value)}
              rows={3}
              className="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
            />
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {result && (
        <div
          className={`rounded-lg border p-4 ${
            result.sentToBuyer && result.postStatus === 'ERROR'
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
          }`}
        >
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">{result.message}</p>
              <div className="mt-2 space-y-1 text-sm opacity-90">
                <p>CRM validation: {result.validationStatus || 'Saved'}</p>
                <p>Buyer delivery: {result.sentToBuyer ? result.buyerStatus || result.postStatus : 'Not sent'}</p>
                {result.postMode && <p>Delivery mode: {result.postMode}</p>}
                {result.buyerError && <p>Buyer response: {result.buyerError}</p>}
                {result.insuranceLeadId && <p>CRM lead ID: {result.insuranceLeadId}</p>}
                {result.submissionId && <p>Submission ID: {result.submissionId}</p>}
              </div>
              <div className="mt-3 flex gap-2">
                <Button type="button" variant="outline" onClick={reset}>
                  Add Another Lead
                </Button>
                <Button asChild type="button">
                  <Link href="/insurance-leads">Return to CRM</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="outline" onClick={reset} disabled={submitting}>
          <RotateCcw className="mr-2 h-4 w-4" />
          Clear
        </Button>
        <Button
          type="submit"
          disabled={submitting}
          className={sendToBuyer ? 'bg-amber-600 text-white hover:bg-amber-700' : ''}
        >
          {submitting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : sendToBuyer ? (
            <Send className="mr-2 h-4 w-4" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          {submitting
            ? sendToBuyer
              ? 'Saving & Sending…'
              : 'Saving…'
            : sendToBuyer
              ? 'Save & Send to Buyer'
              : 'Save Lead to CRM'}
        </Button>
      </div>
    </form>
  );
}
