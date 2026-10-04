'use client';

import { ChevronDown, ChevronUp, User, Shield, Heart, CreditCard } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { CustomerIntakeData, maskSSN } from '@/types/customer-intake-types';

import type { CustomerRecordSection } from './softphone/customer-record';

/**
 * The intake form as record sections, for the on-call customer record. The
 * same facts the expandable panel below shows, minus the toggle: on a call
 * the agent should not have to click to see them.
 */
export function intakeSections(formData: CustomerIntakeData): CustomerRecordSection[] {
  const cityLine = [formData.city, formData.state].filter(Boolean).join(', ');
  const address = [formData.address, [cityLine, formData.zip].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join('\n');
  // Coverage defaults to $10,000 on a blank form, so it is not evidence the
  // agent has quoted anything; these three are.
  const hasPolicy = Boolean(formData.carrier || formData.policyType || formData.monthlyPremium);

  return [
    {
      id: 'intake-client',
      title: 'Client',
      icon: User,
      rows: [
        { label: 'Name', value: [formData.firstName, formData.lastName].filter(Boolean).join(' ') },
        { label: 'Phone', value: formData.phone, mono: true },
        { label: 'Email', value: formData.email, mono: true },
        { label: 'Date of birth', value: formData.dateOfBirth, mono: true },
        { label: 'Address', value: address, wide: true },
      ],
    },
    {
      id: 'intake-policy',
      title: 'Policy',
      icon: Shield,
      rows: [
        { label: 'Carrier', value: formData.carrier },
        { label: 'Product', value: formData.policyType },
        {
          label: 'Coverage',
          value: hasPolicy && formData.coverage ? `$${formData.coverage.toLocaleString()}` : '',
          mono: true,
        },
        {
          label: 'Premium',
          value: formData.monthlyPremium ? `$${formData.monthlyPremium}/mo` : '',
          mono: true,
        },
        // "No" on an empty form would read as a recorded answer.
        { label: 'Tobacco', value: hasPolicy ? (formData.tobaccoUser ? 'Yes' : 'No') : '' },
      ],
    },
    {
      id: 'intake-beneficiaries',
      title: 'Beneficiaries',
      icon: Heart,
      rows: [
        ...formData.primaryBeneficiaries.map((b, i) => ({
          label: `Primary ${i + 1}`,
          value: b.name ? `${b.name}${b.relationship ? ` (${b.relationship})` : ''}` : '',
        })),
        {
          label: 'Secondary',
          value: formData.secondaryBeneficiaryName
            ? `${formData.secondaryBeneficiaryName}${
                formData.secondaryBeneficiaryRelationship
                  ? ` (${formData.secondaryBeneficiaryRelationship})`
                  : ''
              }`
            : '',
        },
      ],
    },
    {
      id: 'intake-banking',
      title: 'Banking',
      icon: CreditCard,
      rows: [
        { label: 'Bank', value: formData.bankName },
        { label: 'Account type', value: formData.accountType },
        { label: 'SSN', value: formData.ssn ? maskSSN(formData.ssn) : '', mono: true },
      ],
    },
  ];
}

// ============================================================================
// CustomerDetailsPanel - Expandable details view in Phone component
// ============================================================================

interface CustomerDetailsPanelProps {
  formData: CustomerIntakeData;
  isExpanded: boolean;
  onToggle: () => void;
}

export function CustomerDetailsPanel({
  formData,
  isExpanded,
  onToggle,
}: CustomerDetailsPanelProps): JSX.Element {
  return (
    <div className="border-b border-rule">
      {/* Summary Header - Always Visible */}
      <div className="px-4 py-3">
        {formData.firstName || formData.lastName ? (
          <>
            <div className="t-section text-ink">
              {formData.firstName} {formData.lastName}
            </div>
            <div className="text-sm text-ink-2">
              {formData.carrier && formData.policyType ? (
                <>
                  <span className="text-brand-ink">{formData.carrier}</span>
                  <span className="mx-2" aria-hidden>
                    ·
                  </span>
                  <span className="text-ink-2">{formData.policyType}</span>
                </>
              ) : (
                <span className="text-ink-3 italic">No policy selected</span>
              )}
            </div>
          </>
        ) : (
          <div className="text-sm text-ink-3">No customer details yet</div>
        )}

        {/* Toggle Button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggle}
          aria-expanded={isExpanded}
          className="mt-2 w-full text-ink-2 hover:text-ink [@media(pointer:coarse)]:min-h-[44px]"
        >
          {isExpanded ? (
            <>
              <ChevronUp className="h-4 w-4 mr-2" />
              Hide details
            </>
          ) : (
            <>
              <ChevronDown className="h-4 w-4 mr-2" />
              View details
            </>
          )}
        </Button>
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="p-3 space-y-4 bg-sunken max-h-80 overflow-y-auto">
          {/* Client Info */}
          <DetailSection icon={<User className="h-4 w-4" />} title="Client Info">
            <DetailRow label="Phone" value={formData.phone} />
            <DetailRow label="Email" value={formData.email} />
            <DetailRow label="DOB" value={formData.dateOfBirth} />
            <DetailRow
              label="Address"
              value={
                formData.address
                  ? `${formData.address}, ${formData.city}, ${formData.state} ${formData.zip}`
                  : ''
              }
            />
          </DetailSection>

          {/* Policy Details */}
          <DetailSection icon={<Shield className="h-4 w-4" />} title="Policy">
            <DetailRow
              label="Coverage"
              value={formData.coverage ? `$${formData.coverage.toLocaleString()}` : ''}
            />
            <DetailRow
              label="Premium"
              value={formData.monthlyPremium ? `$${formData.monthlyPremium}/mo` : ''}
            />
            <DetailRow label="Tobacco" value={formData.tobaccoUser ? 'Yes' : 'No'} />
          </DetailSection>

          {/* Beneficiaries */}
          {(formData.primaryBeneficiaries.length > 0 || formData.secondaryBeneficiaryName) && (
            <DetailSection icon={<Heart className="h-4 w-4" />} title="Beneficiaries">
              {formData.primaryBeneficiaries.map((b, i) => (
                <DetailRow
                  key={b.id}
                  label={`Primary ${i + 1}`}
                  value={`${b.name} (${b.relationship})`}
                />
              ))}
              {formData.secondaryBeneficiaryName && (
                <DetailRow
                  label="Secondary"
                  value={`${formData.secondaryBeneficiaryName} (${formData.secondaryBeneficiaryRelationship})`}
                />
              )}
            </DetailSection>
          )}

          {/* Banking */}
          {(formData.bankName || formData.accountNumber) && (
            <DetailSection icon={<CreditCard className="h-4 w-4" />} title="Banking">
              <DetailRow label="Bank" value={formData.bankName} />
              <DetailRow label="Account" value={formData.accountType} />
              <DetailRow label="SSN" value={maskSSN(formData.ssn)} />
            </DetailSection>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Components
// ─────────────────────────────────────────────────────────────────────────────

function DetailSection({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div>
      <div className="flex items-center gap-2 text-xs font-semibold text-ink-3 mb-1">
        {icon}
        {title}
      </div>
      <div className="space-y-1 pl-6">{children}</div>
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string | undefined;
}): JSX.Element | null {
  if (!value) return null;
  return (
    <div className="flex justify-between text-xs">
      <span className="text-ink-3">{label}</span>
      <span className="text-ink-2 font-medium">{value}</span>
    </div>
  );
}

export default CustomerDetailsPanel;
