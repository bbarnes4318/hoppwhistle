'use client';

import { Building2, Loader2, UserRound } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EMAIL_PATTERN, type PartyDetails } from '@/lib/agreements';
import { cn } from '@/lib/utils';

/**
 * The agency's own details, entered by the signer before reviewing.
 *
 * A business gives its entity, its principal and who signs for it. An
 * individual licensed agent gives only what applies to a person signing for
 * themselves: no entity type, no principal, no separate signer or title. The
 * API (`partyDetailsSchema`) validates the same fields.
 */

type Kind = PartyDetails['kind'];

interface Fields {
  legalName: string;
  dbaName: string;
  state: string;
  entityType: string;
  noticeAddress: string;
  principalName: string;
  principalTitle: string;
  noticeEmail: string;
  noticePhone: string;
  billingSame: boolean;
  billingEmail: string;
  billingPhone: string;
  signerIsPrincipal: boolean;
  signerName: string;
  signerTitle: string;
}

const ENTITY_TYPES = [
  'Limited Liability Company',
  'Corporation',
  'S Corporation',
  'Partnership',
  'Limited Partnership',
  'Sole Proprietorship',
];

function initialFields(
  prefill: PartyDetails | null,
  signerName: string,
  organization: string | null,
  email: string
): Fields {
  const base: Fields = {
    legalName: organization ?? '',
    dbaName: '',
    state: '',
    entityType: '',
    noticeAddress: '',
    principalName: '',
    principalTitle: '',
    noticeEmail: email,
    noticePhone: '',
    billingSame: true,
    billingEmail: '',
    billingPhone: '',
    signerIsPrincipal: true,
    signerName,
    signerTitle: '',
  };
  if (!prefill) return base;
  const billingSame =
    prefill.billingEmail === prefill.noticeEmail && prefill.billingPhone === prefill.noticePhone;
  const shared = {
    ...base,
    legalName: prefill.legalName,
    dbaName: prefill.dbaName ?? '',
    noticeAddress: prefill.noticeAddress,
    noticeEmail: prefill.noticeEmail,
    noticePhone: prefill.noticePhone,
    billingSame,
    billingEmail: billingSame ? '' : prefill.billingEmail,
    billingPhone: billingSame ? '' : prefill.billingPhone,
  };
  if (prefill.kind === 'INDIVIDUAL') return { ...shared, state: prefill.stateOfResidence };
  return {
    ...shared,
    state: prefill.stateOfFormation,
    entityType: prefill.entityType,
    principalName: prefill.principalName,
    principalTitle: prefill.principalTitle,
    signerIsPrincipal: false,
  };
}

function Field({
  id,
  label,
  hint,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div className={className}>
      <label className="t-meta mb-1 block font-medium text-ink-2" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-ink-3">{hint}</p>}
    </div>
  );
}

function KindChoice({
  active,
  icon,
  title,
  description,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        'flex items-start gap-3 rounded-control border p-3 text-left',
        active ? 'border-brand-ink bg-sunken ring-1 ring-brand-ink' : 'border-rule-strong'
      )}
    >
      <span className="mt-0.5 text-brand-ink">{icon}</span>
      <span>
        <span className="block text-sm font-medium text-ink">{title}</span>
        <span className="block text-xs text-ink-3">{description}</span>
      </span>
    </button>
  );
}

export function PartyDetailsForm({
  prefill,
  signerName,
  signerEmail,
  organization,
  busy,
  onSubmit,
}: {
  prefill: PartyDetails | null;
  signerName: string;
  signerEmail: string;
  organization: string | null;
  busy: boolean;
  onSubmit: (party: PartyDetails) => void;
}): JSX.Element {
  const [kind, setKind] = useState<Kind | null>(prefill?.kind ?? null);
  const [f, setF] = useState<Fields>(() =>
    initialFields(prefill, signerName, organization, signerEmail)
  );
  const [problem, setProblem] = useState<string | null>(null);

  const set = <K extends keyof Fields>(key: K, value: Fields[K]) =>
    setF(prev => ({ ...prev, [key]: value }));

  function build(): PartyDetails | string {
    const req = (value: string, label: string) => (value.trim() ? null : `Enter ${label}.`);
    const phone = (value: string, label: string) =>
      value.replace(/\D/g, '').length >= 10 ? null : `Enter ${label} with area code.`;
    const email = (value: string, label: string) =>
      EMAIL_PATTERN.test(value.trim()) ? null : `Enter a valid ${label}.`;
    const billingEmail = f.billingSame ? f.noticeEmail : f.billingEmail;
    const billingPhone = f.billingSame ? f.noticePhone : f.billingPhone;
    const common = [
      req(f.noticeAddress, 'the notice address'),
      email(f.noticeEmail, 'notice email'),
      phone(f.noticePhone, 'the notice phone'),
      email(billingEmail, 'billing email'),
      phone(billingPhone, 'the billing phone'),
    ];
    if (kind === 'INDIVIDUAL') {
      const issue = [
        f.legalName.trim().length >= 2 ? null : 'Enter your full legal name.',
        req(f.state, 'your state of residence'),
        ...common,
      ].find(Boolean);
      if (issue) return issue;
      return {
        kind: 'INDIVIDUAL',
        legalName: f.legalName.trim(),
        dbaName: f.dbaName.trim() || null,
        stateOfResidence: f.state.trim(),
        noticeAddress: f.noticeAddress.trim(),
        noticeEmail: f.noticeEmail.trim(),
        noticePhone: f.noticePhone.trim(),
        billingEmail: billingEmail.trim(),
        billingPhone: billingPhone.trim(),
      };
    }
    const signer = f.signerIsPrincipal
      ? { name: f.principalName, title: f.principalTitle }
      : { name: f.signerName, title: f.signerTitle };
    const issue = [
      req(f.legalName, "the business's legal name"),
      req(f.state, 'the state of formation'),
      req(f.entityType, 'the entity type'),
      req(f.principalName, "the principal's name"),
      req(f.principalTitle, "the principal's title"),
      ...common,
      signer.name.trim().length >= 2 ? null : "Enter the signer's full name.",
      req(signer.title, "the signer's title"),
    ].find(Boolean);
    if (issue) return issue;
    return {
      kind: 'BUSINESS',
      legalName: f.legalName.trim(),
      dbaName: f.dbaName.trim() || null,
      stateOfFormation: f.state.trim(),
      entityType: f.entityType.trim(),
      noticeAddress: f.noticeAddress.trim(),
      principalName: f.principalName.trim(),
      principalTitle: f.principalTitle.trim(),
      noticeEmail: f.noticeEmail.trim(),
      noticePhone: f.noticePhone.trim(),
      billingEmail: billingEmail.trim(),
      billingPhone: billingPhone.trim(),
      signerName: signer.name.trim(),
      signerTitle: signer.title.trim(),
    };
  }

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    const result = build();
    if (typeof result === 'string') {
      setProblem(result);
      return;
    }
    setProblem(null);
    onSubmit(result);
  }

  const individual = kind === 'INDIVIDUAL';

  return (
    <form onSubmit={submit} noValidate>
      <h2 className="t-title text-ink">Your details</h2>
      <p className="t-body mt-1 text-ink-2">
        These go into the agreements exactly as you enter them. You will review the completed
        agreements before signing.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup">
        <KindChoice
          active={kind === 'BUSINESS'}
          icon={<Building2 className="h-4 w-4" />}
          title="A business"
          description="An agency, LLC, corporation or partnership. You sign on its behalf."
          onClick={() => setKind('BUSINESS')}
        />
        <KindChoice
          active={individual}
          icon={<UserRound className="h-4 w-4" />}
          title="An individual licensed agent"
          description="You contract in your own name and sign for yourself."
          onClick={() => setKind('INDIVIDUAL')}
        />
      </div>

      {kind && (
        <div className="mt-5 space-y-5">
          <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-2">
              {individual ? 'About you' : 'The business'}
            </legend>
            <Field
              id="party-legal-name"
              label={individual ? 'Full legal name' : 'Legal name'}
              hint={
                individual
                  ? 'As it appears on your insurance license. You will sign with this name.'
                  : 'Exactly as registered with the state.'
              }
            >
              <Input
                id="party-legal-name"
                value={f.legalName}
                autoComplete={individual ? 'name' : 'organization'}
                onChange={e => set('legalName', e.target.value)}
              />
            </Field>
            <Field id="party-dba" label="Doing business as (optional)">
              <Input
                id="party-dba"
                value={f.dbaName}
                onChange={e => set('dbaName', e.target.value)}
              />
            </Field>
            <Field
              id="party-state"
              label={individual ? 'State of residence' : 'State of formation'}
            >
              <Input
                id="party-state"
                value={f.state}
                placeholder="Florida"
                onChange={e => set('state', e.target.value)}
              />
            </Field>
            {!individual && (
              <Field id="party-entity" label="Entity type">
                <Input
                  id="party-entity"
                  list="party-entity-types"
                  value={f.entityType}
                  placeholder="Limited Liability Company"
                  onChange={e => set('entityType', e.target.value)}
                />
                <datalist id="party-entity-types">
                  {ENTITY_TYPES.map(t => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </Field>
            )}
            <Field
              id="party-address"
              label={individual ? 'Mailing address' : 'Business address'}
              hint="Formal notices under the agreements are sent here."
              className="sm:col-span-2"
            >
              <Input
                id="party-address"
                value={f.noticeAddress}
                autoComplete="street-address"
                placeholder="Street, City, State ZIP"
                onChange={e => set('noticeAddress', e.target.value)}
              />
            </Field>
          </fieldset>

          {!individual && (
            <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-2">
                Principal
              </legend>
              <Field id="party-principal-name" label="Principal name">
                <Input
                  id="party-principal-name"
                  value={f.principalName}
                  onChange={e => set('principalName', e.target.value)}
                />
              </Field>
              <Field id="party-principal-title" label="Principal title">
                <Input
                  id="party-principal-title"
                  value={f.principalTitle}
                  placeholder="Owner, Managing Member, President…"
                  onChange={e => set('principalTitle', e.target.value)}
                />
              </Field>
            </fieldset>
          )}

          <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-2">
              Contact
            </legend>
            <Field id="party-email" label="Email">
              <Input
                id="party-email"
                type="email"
                value={f.noticeEmail}
                autoComplete="email"
                onChange={e => set('noticeEmail', e.target.value)}
              />
            </Field>
            <Field id="party-phone" label="Phone">
              <Input
                id="party-phone"
                type="tel"
                value={f.noticePhone}
                autoComplete="tel"
                onChange={e => set('noticePhone', e.target.value)}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm text-ink sm:col-span-2">
              <input
                type="checkbox"
                checked={f.billingSame}
                onChange={e => set('billingSame', e.target.checked)}
              />
              Send invoices to the same email and phone
            </label>
            {!f.billingSame && (
              <>
                <Field id="party-billing-email" label="Billing email">
                  <Input
                    id="party-billing-email"
                    type="email"
                    value={f.billingEmail}
                    onChange={e => set('billingEmail', e.target.value)}
                  />
                </Field>
                <Field id="party-billing-phone" label="Billing phone">
                  <Input
                    id="party-billing-phone"
                    type="tel"
                    value={f.billingPhone}
                    onChange={e => set('billingPhone', e.target.value)}
                  />
                </Field>
              </>
            )}
          </fieldset>

          <fieldset className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-2">
              {individual ? 'Signing' : 'Who signs'}
            </legend>
            {individual ? (
              <p className="t-body text-ink-2 sm:col-span-2">
                You sign for yourself, as <strong>{f.legalName.trim() || 'your legal name'}</strong>
                . Signing email: <strong>{signerEmail}</strong>.
              </p>
            ) : (
              <>
                <label className="flex items-center gap-2 text-sm text-ink sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={f.signerIsPrincipal}
                    onChange={e => set('signerIsPrincipal', e.target.checked)}
                  />
                  The principal is signing
                </label>
                {!f.signerIsPrincipal && (
                  <>
                    <Field id="party-signer-name" label="Signer full name">
                      <Input
                        id="party-signer-name"
                        value={f.signerName}
                        autoComplete="name"
                        onChange={e => set('signerName', e.target.value)}
                      />
                    </Field>
                    <Field id="party-signer-title" label="Signer title">
                      <Input
                        id="party-signer-title"
                        value={f.signerTitle}
                        onChange={e => set('signerTitle', e.target.value)}
                      />
                    </Field>
                  </>
                )}
                <Field
                  id="party-signer-email"
                  label="Signer email"
                  hint="The address this link was sent to and where the verification code went. It cannot be changed here."
                  className="sm:col-span-2"
                >
                  <Input id="party-signer-email" value={signerEmail} readOnly disabled />
                </Field>
              </>
            )}
          </fieldset>

          {problem && (
            <p role="alert" className="text-sm text-dropped-ink">
              {problem}
            </p>
          )}
          <Button type="submit" disabled={busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Complete the agreements with these details
          </Button>
          <p className="text-[11px] text-ink-3">
            Once saved, these details cannot be changed on this link. If something is wrong after
            you review, use Request changes.
          </p>
        </div>
      )}
    </form>
  );
}
