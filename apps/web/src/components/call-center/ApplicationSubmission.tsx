'use client';

import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  XCircle,
  RefreshCw,
  Rocket,
  FileCheck,
  Wifi,
} from 'lucide-react';
import React, { useState, useCallback, useRef, useEffect } from 'react';


import { Button } from '@/components/ui/button';
import type { ProspectData } from '@/lib/call-center/types';
import { cn } from '@/lib/utils';

import { getAutomationAuthHeaders, getAutomationAuthQuery } from './automation-auth';

// ============================================================================
// Types for Automation Status
// ============================================================================

interface StatusUpdate {
  jobId: string;
  step: number;
  totalSteps: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  message: string;
  timestamp: Date;
  error?: string;
  applicationNumber?: string;
}

type SubmissionState = 'idle' | 'connecting' | 'running' | 'success' | 'error';

// ============================================================================
// ApplicationSubmission Component
// Triggers RPA automation and displays live status via SSE
// ============================================================================

interface ApplicationSubmissionProps {
  prospectData: Partial<ProspectData>;
  selectedCarrier: string;
  selectedPremium: number;
  selectedCoverage: number;
  selectedPlanType: string;
  disabled?: boolean;
  onSubmissionComplete?: (applicationNumber: string) => void;
  onSubmissionError?: (error: string) => void;
  className?: string;
}

export function ApplicationSubmission({
  prospectData,
  selectedCarrier,
  selectedPremium,
  selectedCoverage,
  selectedPlanType,
  disabled = false,
  onSubmissionComplete,
  onSubmissionError,
  className,
}: ApplicationSubmissionProps) {
  // State
  const [state, setState] = useState<SubmissionState>('idle');
  const [jobId, setJobId] = useState<string | null>(null);
  const [currentStatus, setCurrentStatus] = useState<StatusUpdate | null>(null);
  const [statusHistory, setStatusHistory] = useState<StatusUpdate[]>([]);
  const [applicationNumber, setApplicationNumber] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Refs
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup SSE connection
  const cleanupSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  // Connect to SSE stream
  const connectToStream = useCallback(
    (streamJobId: string) => {
      cleanupSSE();
      setState('running');

      const apiBase =
        typeof window !== 'undefined'
          ? window.location.origin
          : process.env.NEXT_PUBLIC_API_URL || '';
      const streamUrl = `${apiBase}/api/automation/stream/${streamJobId}${getAutomationAuthQuery()}`;

      const eventSource = new EventSource(streamUrl);
      eventSourceRef.current = eventSource;

      eventSource.onmessage = event => {
        try {
          const data = JSON.parse(event.data) as StatusUpdate;
          setCurrentStatus(data);
          setStatusHistory(prev => [...prev, data]);

          // Check for completion
          if (data.status === 'completed') {
            setState('success');
            if (data.applicationNumber) {
              setApplicationNumber(data.applicationNumber);
              onSubmissionComplete?.(data.applicationNumber);
            }
            cleanupSSE();
          }

          // Check for failure
          if (data.status === 'failed') {
            setState('error');
            setErrorMessage(data.error || 'Submission failed');
            onSubmissionError?.(data.error || 'Submission failed');
            cleanupSSE();
          }
        } catch (e) {
          console.error('[ApplicationSubmission] Failed to parse SSE message:', e);
        }
      };

      eventSource.onerror = () => {
        console.error('[ApplicationSubmission] SSE connection error');
        eventSource.close();

        // Attempt reconnect after 3 seconds (if still running)
        if (state === 'running') {
          reconnectTimeoutRef.current = setTimeout(() => {
            connectToStream(streamJobId);
          }, 3000);
        }
      };
    },
    [cleanupSSE, onSubmissionComplete, onSubmissionError, state]
  );

  // Submit application
  const handleSubmit = useCallback(async () => {
    try {
      setState('connecting');
      setErrorMessage(null);
      setApplicationNumber(null);
      setStatusHistory([]);

      // Build payload from prospect data matching CarrierAppData interface
      // Maps ProspectData field names to what the RPA expects
      const payload = {
        // Basic info
        state: prospectData.state || '',
        firstName: prospectData.firstName || '',
        middleName: prospectData.middleName || '',
        lastName: prospectData.lastName || '',
        dob: prospectData.dob || '',
        age:
          typeof prospectData.age === 'number'
            ? prospectData.age
            : parseInt(String(prospectData.age)) || 0,
        gender: prospectData.gender || 'male',
        tobacco: prospectData.tobacco || false,

        // Coverage selection
        selectedCarrier,
        selectedPremium,
        selectedCoverage,
        selectedPlanType,

        // Contact info
        address: prospectData.address || '',
        zip: prospectData.zip || '',
        ssn: prospectData.ssn || '',
        phone: prospectData.phone || '',
        email: '', // Not in ProspectData, but RPA may use it
        birthState: prospectData.stateOfBirth || '',

        // Physical info (height is string like "5'6", need to parse)
        heightFeet: prospectData.height ? parseInt(prospectData.height.split("'")[0]) || 5 : 5,
        heightInches: prospectData.height ? parseInt(prospectData.height.split("'")[1]) || 6 : 6,
        weight:
          typeof prospectData.weight === 'number'
            ? prospectData.weight
            : parseInt(String(prospectData.weight)) || 150,

        // Beneficiary (map primaryBen fields)
        beneficiaryName: prospectData.primaryBenName || '',
        beneficiaryRelation: prospectData.primaryBenRel || '',

        // Banking (map from ProspectData field names)
        accountHolder: prospectData.accountName || '',
        bankName: prospectData.bankName || '',
        bankCityState: prospectData.bankAddress || '',
        ssPaymentSchedule: prospectData.draftSchedule === 'SS' ? true : null,
        draftDay: prospectData.draftDate || '',
        routingNumber: prospectData.routing || '',
        accountNumber: prospectData.accountNum || '',
        accountType: prospectData.accountType === 'savings' ? 'Saving' : 'Checking',
        wantsEmail: null,

        // Doctor info
        doctorName: prospectData.physicianName || '',
        doctorAddress: '',
        doctorPhone: '',

        // Owner/Payor (derive from owner fields)
        ownerIsInsured: !prospectData.ownerName,
        payorIsInsured: !prospectData.ownerName,

        // Existing Insurance
        hasExistingInsurance: prospectData.hasExisting ?? null,
        existingCompanyName: '',
        existingPolicyNumber: '',
        existingCoverageAmount: '',
        willReplaceExisting: prospectData.willReplace ?? null,

        // Health Questions (map q1-q8c to healthQ1-healthQ8c)
        healthQ1: prospectData.q1 ?? false,
        healthQ2: prospectData.q2 ?? false,
        healthQ3: prospectData.q3 ?? false,
        healthQ4: prospectData.q4 ?? false,
        healthQ5: prospectData.q5 ?? false,
        healthQ6: prospectData.q6 ?? false,
        healthQ7a: prospectData.q7a ?? false,
        healthQ7b: prospectData.q7b ?? false,
        healthQ7c: prospectData.q7c ?? false,
        healthQ7d: prospectData.q7d ?? false,
        healthQ8a: prospectData.q8a ?? false,
        healthQ8b: prospectData.q8b ?? false,
        healthQ8c: prospectData.q8c ?? false,
        healthCovid: false, // Not tracked in ProspectData yet

        // Illinois specific
        ilDesigneeChoice: prospectData.ilDesigneeChoice ?? null,
      };

      const apiBase =
        typeof window !== 'undefined'
          ? window.location.origin
          : process.env.NEXT_PUBLIC_API_URL || '';
      const response = await fetch(`${apiBase}/api/automation/run-carrier-app`, {
        method: 'POST',
        headers: getAutomationAuthHeaders(),
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();
      const newJobId = data.jobId;

      if (!newJobId) {
        throw new Error('No job ID returned from server');
      }

      setJobId(newJobId);
      connectToStream(newJobId);
    } catch (error) {
      console.error('[ApplicationSubmission] Submit error:', error);
      setState('error');
      setErrorMessage(error instanceof Error ? error.message : 'Failed to start submission');
      onSubmissionError?.(error instanceof Error ? error.message : 'Failed to start submission');
    }
  }, [
    prospectData,
    selectedCarrier,
    selectedPremium,
    selectedCoverage,
    selectedPlanType,
    connectToStream,
    onSubmissionError,
  ]);

  // Retry submission
  const handleRetry = useCallback(() => {
    setState('idle');
    setJobId(null);
    setCurrentStatus(null);
    setStatusHistory([]);
    setApplicationNumber(null);
    setErrorMessage(null);
    cleanupSSE();
  }, [cleanupSSE]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupSSE();
    };
  }, [cleanupSSE]);

  // Calculate progress percentage
  const progressPercent = currentStatus
    ? Math.round((currentStatus.step / currentStatus.totalSteps) * 100)
    : 0;

  // ============================================================================
  // Required Field Validation
  // ============================================================================

  const requiredFields = [
    { key: 'firstName', label: 'First Name', value: prospectData.firstName },
    { key: 'lastName', label: 'Last Name', value: prospectData.lastName },
    { key: 'dob', label: 'Date of Birth', value: prospectData.dob },
    { key: 'state', label: 'State', value: prospectData.state },
    { key: 'address', label: 'Address', value: prospectData.address },
    { key: 'zip', label: 'ZIP Code', value: prospectData.zip },
    { key: 'phone', label: 'Phone Number', value: prospectData.phone },
    { key: 'ssn', label: 'Social Security Number', value: prospectData.ssn },
    { key: 'height', label: 'Height', value: prospectData.height },
    { key: 'weight', label: 'Weight', value: prospectData.weight },
    { key: 'primaryBenName', label: 'Beneficiary Name', value: prospectData.primaryBenName },
    { key: 'primaryBenRel', label: 'Beneficiary Relationship', value: prospectData.primaryBenRel },
    { key: 'bankName', label: 'Bank Name', value: prospectData.bankName },
    { key: 'routing', label: 'Routing Number', value: prospectData.routing },
    { key: 'accountNum', label: 'Account Number', value: prospectData.accountNum },
    { key: 'selectedCarrier', label: 'Carrier Selection', value: selectedCarrier },
  ];

  const missingFields = requiredFields.filter(f => !f.value || f.value === '');
  const isReadyToSubmit = missingFields.length === 0 && selectedCarrier !== '';

  // Render based on state
  return (
    <div className={cn('space-y-4', className)}>
      {/* Missing Fields Warning */}
      {state === 'idle' && !isReadyToSubmit && missingFields.length > 0 && (
        <div className="bg-ringing-tint border border-ringing rounded-lg p-3">
          <div className="flex items-start gap-2 mb-2">
            <AlertCircle className="w-4 h-4 text-ringing-ink mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-ringing-ink font-medium text-sm">Complete Required Fields</p>
              <p className="text-ringing-ink text-xs">
                The following fields must be completed before submitting:
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1 mt-2">
            {missingFields.slice(0, 8).map(f => (
              <div key={f.key} className="flex items-center gap-1.5 text-xs">
                <div className="w-1.5 h-1.5 rounded-full bg-ringing-tint" />
                <span className="text-ringing-ink">{f.label}</span>
              </div>
            ))}
            {missingFields.length > 8 && (
              <div className="text-xs text-ringing-ink col-span-2">
                +{missingFields.length - 8} more fields required
              </div>
            )}
          </div>
        </div>
      )}

      {/* Status Display */}
      {state !== 'idle' && (
        <div
          className={cn(
            'rounded-card border p-4',
            state === 'connecting' && 'border-money bg-money-tint',
            state === 'running' && 'border-ringing bg-ringing-tint',
            state === 'success' && 'border-live bg-live-tint',
            state === 'error' && 'border-dropped bg-dropped-tint'
          )}
        >
          {/* Header */}
          <div className="flex items-center gap-3 mb-3">
            {state === 'connecting' && (
              <>
                <Wifi className="w-5 h-5 text-money-ink animate-pulse" />
                <span className="text-money-ink font-medium">Connecting to carrier portal...</span>
              </>
            )}
            {state === 'running' && (
              <>
                <Loader2 className="w-5 h-5 text-ringing-ink animate-spin" />
                <span className="text-ringing-ink font-medium">Submitting Application...</span>
              </>
            )}
            {state === 'success' && (
              <>
                <CheckCircle2 className="w-5 h-5 text-live-ink" />
                <span className="text-live-ink font-medium">Application Submitted!</span>
              </>
            )}
            {state === 'error' && (
              <>
                <XCircle className="w-5 h-5 text-dropped-ink" />
                <span className="text-dropped-ink font-medium">Submission Failed</span>
              </>
            )}
          </div>

          {/* Progress Bar (for running state) */}
          {(state === 'running' || state === 'connecting') && (
            <div className="mb-3">
              <div className="flex justify-between text-xs text-ink-2 mb-1">
                <span>
                  Step {currentStatus?.step || 0} of {currentStatus?.totalSteps || 12}
                </span>
                <span>{progressPercent}%</span>
              </div>
              <div className="h-2 bg-sunken rounded-full overflow-hidden">
                <div
                  className="h-full transition-all duration-500"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          )}

          {/* Current Status Message */}
          {currentStatus && (state === 'running' || state === 'connecting') && (
            <p className="text-ink-2 text-sm">{currentStatus.message}</p>
          )}

          {/* Application Number (success) */}
          {state === 'success' && applicationNumber && (
            <div className="bg-live-tint border border-live rounded-lg p-4 mt-3">
              <div className="flex items-center gap-3">
                <FileCheck className="w-8 h-8 text-live-ink" />
                <div>
                  <p className="text-ink-2 text-sm">Application Number</p>
                  <p className="text-live-ink font-bold text-xl tracking-wider">
                    {applicationNumber}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Error Message */}
          {state === 'error' && errorMessage && (
            <div className="bg-dropped-tint border border-dropped rounded-lg p-3 mt-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-dropped-ink mt-0.5 flex-shrink-0" />
                <p className="text-dropped-ink text-sm">{errorMessage}</p>
              </div>
            </div>
          )}

          {/* Job ID (for reference) */}
          {jobId && <p className="text-ink-3 text-xs mt-3">Job ID: {jobId}</p>}
        </div>
      )}

      {/* Status History (collapsible) */}
      {statusHistory.length > 0 && state === 'running' && (
        <details className="text-xs">
          <summary className="cursor-pointer text-ink-3 hover:text-ink">
            View status history ({statusHistory.length} updates)
          </summary>
          <div className="mt-2 max-h-32 overflow-y-auto space-y-1 pl-2 border-l border-rule">
            {statusHistory.map((status, i) => (
              <div key={i} className="text-ink-2">
                <span className="text-ink-3">
                  [{status.step}/{status.totalSteps}]
                </span>{' '}
                {status.message}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Submit Button */}
      {state === 'idle' && (
        <Button
          onClick={handleSubmit}
          disabled={disabled || !isReadyToSubmit}
          className={cn(
            'w-full h-12 font-semibold text-lg transition-all',
            isReadyToSubmit
              ? 'bg-brand text-brand-fg '
              : 'bg-sunken text-ink-2 cursor-not-allowed shadow-none'
          )}
        >
          <Rocket className="w-5 h-5 mr-2" />
          {isReadyToSubmit ? 'Submit Application' : 'Complete Required Fields'}
        </Button>
      )}

      {/* Retry Button */}
      {state === 'error' && (
        <Button onClick={handleRetry} className="w-full h-12 text-ink font-semibold">
          <RefreshCw className="w-5 h-5 mr-2" />
          Retry Submission
        </Button>
      )}

      {/* Success - Start New */}
      {state === 'success' && (
        <Button
          onClick={handleRetry}
          variant="outline"
          className="w-full border-rule hover:bg-sunken text-ink-2"
        >
          Start New Application
        </Button>
      )}

      {/* Carrier Info */}
      {state === 'idle' && selectedCarrier && (
        <div className="text-center text-sm text-ink-2">
          Submitting to <span className="text-ink font-medium">{selectedCarrier}</span> • $
          {selectedCoverage.toLocaleString()} • ${selectedPremium.toFixed(2)}/mo
        </div>
      )}
    </div>
  );
}

export default ApplicationSubmission;
