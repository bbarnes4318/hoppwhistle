'use client';

import { AlertTriangle, CheckCircle2, Loader2, RotateCcw, Save, Send } from 'lucide-react';
import Link from 'next/link';
import { FormEvent, useMemo, useState } from 'react';

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
  notes: string;
}

interface ManualLeadResponse {
  success: boolean;
  prospectId: string;
  insuranceLeadId?: string;
  submissionId?: string;
  validationStatus?: 'VALID' | 'INVALID';
  postStatus?: string;
  postMode?: 'TEST' | 'LIVE';
  sentToBuyer?: boolean;
  buyerStatus?: string | null;
  buyerError?: string | null;
  validationErrors?: Array<{ path: string; message: string }> | null;
  message: string;
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

export function ManualLeadEntryForm(): JSX.Element {
  const [form, setForm] = useState<ManualLeadFormState>(INITIAL_STATE);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ManualLeadResponse | null>(null);

  const sendToBuyer = form.deliveryChoice === 'SEND_NOW';

  const buyerRequirementsMissing = useMemo(() => {
    if (!sendToBuyer) return [];

    const missing: string[] = [];
    if (!form.email.trim()) missing.push('email');
    if (!form.address.trim()) missing.push('address');
    if (!form.city.trim()) missing.push('city');
    if (!/^\d{5}$/.test(digitsOnly(form.zipCode))) missing.push('5-digit ZIP code');
    if (!form.birthDate) missing.push('date of birth');

    if (form.vertical === 'FE' && !form.gender) missing.push('gender');
    if (form.vertical === 'ACA') {
      if (!form.heightFeet) missing.push('height in feet');
      if (form.heightInches === '') missing.push('height in inches');
      if (!form.weight) missing.push('weight');
    }

    return missing;
  }, [form, sendToBuyer]);

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
    if (sendToBuyer && buyerRequirementsMissing.length > 0) {
      setError(`Complete the buyer-required fields: ${buyerRequirementsMissing.join(', ')}.`);
      return;
    }

    setSubmitting(true);
    try {
      const response = await apiClient.post<ManualLeadResponse>('/api/v1/prospects/intake', {
        vertical: form.vertical,
        sendToBuyer,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        phone,
        email: form.email.trim() || undefined,
        dob: form.birthDate || undefined,
        gender: form.gender || undefined,
        street: form.address.trim() || undefined,
        city: form.city.trim() || undefined,
        state: form.state,
        zip: digitsOnly(form.zipCode, 5) || undefined,
        smoker: form.smoker || undefined,
        heightFeet: form.heightFeet ? Number(form.heightFeet) : undefined,
        heightInches: form.heightInches === '' ? undefined : Number(form.heightInches),
        weight: form.weight ? Number(form.weight) : undefined,
        notes: form.notes.trim() || undefined,
        source: 'manual_crm_entry',
        landingPage: 'https://hopwhistle.com/intake',
      });

      if (response.error) {
        setError(response.error.message);
        return;
      }

      const data = response.data;
      if (!data) {
        setError('The server returned an empty response.');
        return;
      }

      setResult(data);
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
            Enter the lead once, then decide whether it stays in the CRM or is sent immediately.
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
                  Store the lead for follow-up. Nothing is sent to the buyer.
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
                  Save the lead and immediately submit it using the server’s current TEST or LIVE mode.
                </p>
              </div>
            </div>
          </label>
        </div>

        {sendToBuyer && (
          <div className="mt-4 flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              This selection performs an immediate buyer submission. Confirm the information before
              clicking the final button.
            </p>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-700 bg-slate-900/70 p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="vertical" className="text-slate-300">
              Lead Type
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
              First Name <span className="text-red-400">*</span>
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
              Last Name <span className="text-red-400">*</span>
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
              Phone <span className="text-red-400">*</span>
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
              Email {sendToBuyer && <span className="text-red-400">*</span>}
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
              Street Address {sendToBuyer && <span className="text-red-400">*</span>}
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
              City {sendToBuyer && <span className="text-red-400">*</span>}
            </Label>
            <Input
              id="city"
              value={form.city}
              onChange={event => update('city', event.target.value)}
              className="border-slate-600 bg-slate-800 text-white"
            />
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="state" className="text-slate-300">
              State <span className="text-red-400">*</span>
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
              ZIP Code {sendToBuyer && <span className="text-red-400">*</span>}
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
              Date of Birth {sendToBuyer && <span className="text-red-400">*</span>}
            </Label>
            <Input
              id="birthDate"
              type="date"
              value={form.birthDate}
              onChange={event => update('birthDate', event.target.value)}
              className="border-slate-600 bg-slate-800 text-white"
            />
          </div>

          {form.vertical === 'FE' ? (
            <div className="space-y-1.5">
              <Label htmlFor="gender" className="text-slate-300">
                Gender {sendToBuyer && <span className="text-red-400">*</span>}
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
                Weight (lb) {sendToBuyer && <span className="text-red-400">*</span>}
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
                  Height Feet {sendToBuyer && <span className="text-red-400">*</span>}
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
                  Height Inches {sendToBuyer && <span className="text-red-400">*</span>}
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

        <div className="mt-4 space-y-1.5">
          <Label htmlFor="notes" className="text-slate-300">
            Notes
          </Label>
          <textarea
            id="notes"
            value={form.notes}
            onChange={event => update('notes', event.target.value)}
            rows={3}
            className="w-full rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500"
          />
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
                <p>CRM status: {result.validationStatus || 'Saved'}</p>
                <p>Buyer delivery: {result.sentToBuyer ? result.buyerStatus || result.postStatus : 'Not sent'}</p>
                {result.postMode && <p>Delivery mode: {result.postMode}</p>}
                {result.buyerError && <p>Buyer response: {result.buyerError}</p>}
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
