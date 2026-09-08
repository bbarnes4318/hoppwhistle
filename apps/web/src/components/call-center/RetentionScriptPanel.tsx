'use client';

// ============================================================================
// RetentionScriptPanel.tsx - Global Retention Script for Retention Specialists
// Displayed when Job Title contains "Retention"
// ============================================================================

import { FileText, AlertCircle, Phone, User } from 'lucide-react';
import React from 'react';

import { useScriptAccess } from '@/hooks/useUserRoles';

// ============================================================================
// TYPES
// ============================================================================
interface ProspectData {
  first_name?: string;
  last_name?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  caller_id?: string;
  email?: string;
  city?: string;
  state?: string;
  dob?: string;
  age?: number;
  gender?: string;
  coverage_amount?: number;
  carrier?: string;
  [key: string]: unknown;
}

interface RetentionScriptPanelProps {
  prospectData?: ProspectData | null;
  onDataUpdate?: (data: Record<string, unknown>) => void;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================
const RetentionScriptPanel = ({ prospectData, onDataUpdate }: RetentionScriptPanelProps) => {
  const { customScripts } = useScriptAccess();
  // Extract customer name for personalization
  const customerName = prospectData?.first_name || prospectData?.firstName || 'Customer';
  const customerPhone = prospectData?.phone || prospectData?.caller_id || '';

  // Suppress unused var warning
  void onDataUpdate;

  const replaceVars = (text: string) => {
    if (!text) return '';
    return text
      .replace(/{customerName}/g, `<span class="text-brand-ink font-medium">${customerName}</span>`)
      .replace(/{first_name}/g, `<span class="text-brand-ink font-medium">${customerName}</span>`)
      .replace(/{firstName}/g, `<span class="text-brand-ink font-medium">${customerName}</span>`);
  };

  return (
    <div className="h-full flex flex-col overflow-auto bg-surface">
      {/* Header Banner */}
      <div className="bg-sunken border-b border-brand p-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-brand-tint rounded-card flex items-center justify-center">
            <FileText className="w-5 h-5 text-brand-ink" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-brand-ink">🎯 Global Retention Script</h2>
            <p className="text-xs text-ink-2">
              Retention-specific call script for customer retention specialists
            </p>
          </div>
        </div>
      </div>

      {/* Customer Info Bar */}
      {prospectData && (
        <div className="bg-surface border-b border-rule p-3 flex items-center gap-4 flex-shrink-0">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-brand-ink" />
            <span className="text-sm text-ink font-medium">{customerName}</span>
          </div>
          {customerPhone && (
            <div className="flex items-center gap-2">
              <Phone className="w-4 h-4 text-live-ink" />
              <span className="text-sm text-ink-2">{customerPhone}</span>
            </div>
          )}
        </div>
      )}

      {/* Script Content */}
      <div className="flex-1 p-6 overflow-auto">
        {/* Placeholder Notice */}
        <div className="bg-ringing-tint border border-ringing rounded-card p-4 mb-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-ringing-ink flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-ringing-ink font-medium">Script Content Placeholder</p>
              <p className="text-xs text-ringing-ink mt-1">
                Global Retention Script: [Insert Script Content Here]
              </p>
            </div>
          </div>
        </div>

        {/* Script Steps */}
        <div className="space-y-4">
          <div className="bg-sunken rounded-card p-5 border border-rule">
            <h3 className="text-sm font-bold text-brand-ink uppercase tracking-wide mb-4">
              Retention Call Flow
            </h3>

            <div className="space-y-4">
              {/* Step 1 */}
              <div className="flex gap-3">
                <div className="w-8 h-8 bg-brand-tint rounded-lg flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold text-brand-ink">1</span>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-ink mb-1">Greet the Customer</p>
                  <p
                    className="text-sm text-ink-2 whitespace-pre-wrap"
                    dangerouslySetInnerHTML={{
                      __html: replaceVars(
                        customScripts?.['retention_step1'] ||
                          "Hello {customerName}, this is [Your Name] from the retention team. I understand you're considering some changes to your policy..."
                      ),
                    }}
                  />
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex gap-3">
                <div className="w-8 h-8 bg-brand-tint rounded-lg flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold text-brand-ink">2</span>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-ink mb-1">Acknowledge Concerns</p>
                  <p className="text-sm text-ink-2 whitespace-pre-wrap">
                    {customScripts?.['retention_step2'] ||
                      "Listen actively to the customer's concerns. Validate their feelings and show empathy."}
                  </p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex gap-3">
                <div className="w-8 h-8 bg-brand-tint rounded-lg flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold text-brand-ink">3</span>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-ink mb-1">Present Retention Offers</p>
                  <p className="text-sm text-ink-2 whitespace-pre-wrap">
                    {customScripts?.['retention_step3'] ||
                      'Based on their concerns, present available retention offers, discounts, or plan adjustments.'}
                  </p>
                </div>
              </div>

              {/* Step 4 */}
              <div className="flex gap-3">
                <div className="w-8 h-8 bg-brand-tint rounded-lg flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold text-brand-ink">4</span>
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-ink mb-1">Document Outcome</p>
                  <p className="text-sm text-ink-2 whitespace-pre-wrap">
                    {customScripts?.['retention_step4'] ||
                      'Record the call outcome, any offers made, and next steps in the CRM.'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="bg-sunken rounded-card p-5 border border-rule">
            <h3 className="text-sm font-bold text-ink-2 uppercase tracking-wide mb-4">
              Quick Actions
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <button className="px-4 py-3 bg-brand-tint hover:bg-brand-tint border border-brand rounded-lg text-sm text-brand-ink font-medium transition-colors">
                Apply Discount
              </button>
              <button className="px-4 py-3 bg-brand-tint hover:bg-brand-tint border border-brand rounded-lg text-sm text-brand-ink font-medium transition-colors">
                Schedule Callback
              </button>
              <button className="px-4 py-3 bg-live-tint hover:bg-brand hover:text-ink border border-live rounded-lg text-sm text-live-ink font-medium transition-colors">
                Transfer to Supervisor
              </button>
              <button className="px-4 py-3 bg-ringing-tint hover:bg-ringing-tint border border-ringing rounded-lg text-sm text-ringing-ink font-medium transition-colors">
                Escalate Case
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RetentionScriptPanel;
