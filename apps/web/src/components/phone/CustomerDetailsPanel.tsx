'use client';

import { ChevronDown, ChevronUp, User, Shield, Heart, CreditCard } from 'lucide-react';
import { useState } from 'react';

import { CustomerIntakeData, maskSSN } from '@/types/customer-intake-types';
import { Button } from '@/components/ui/button';

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
    <div className="border-b border-slate-700">
      {/* Summary Header - Always Visible */}
      <div className="p-3 bg-gradient-to-r from-cyan-900/30 to-emerald-900/30">
        {formData.firstName || formData.lastName ? (
          <>
            <div className="text-lg font-bold text-white">
              {formData.firstName} {formData.lastName}
            </div>
            <div className="text-sm text-slate-300">
              {formData.carrier && formData.policyType ? (
                <>
                  <span className="text-cyan-400">{formData.carrier}</span>
                  <span className="mx-2">•</span>
                  <span className="text-emerald-400">{formData.policyType}</span>
                </>
              ) : (
                <span className="text-slate-500 italic">No policy selected</span>
              )}
            </div>
          </>
        ) : (
          <div className="text-slate-500 italic">No customer data</div>
        )}

        {/* Toggle Button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggle}
          className="mt-2 w-full text-slate-400 hover:text-white"
        >
          {isExpanded ? (
            <>
              <ChevronUp className="h-4 w-4 mr-2" />
              Hide Details
            </>
          ) : (
            <>
              <ChevronDown className="h-4 w-4 mr-2" />
              View Details
            </>
          )}
        </Button>
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="p-3 space-y-4 bg-slate-900/80 max-h-80 overflow-y-auto">
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
      <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 mb-1">
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
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-200 font-medium">{value}</span>
    </div>
  );
}

export default CustomerDetailsPanel;
