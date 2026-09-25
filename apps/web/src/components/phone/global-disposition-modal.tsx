'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApplicationLogForm } from '@/components/call-center/ApplicationLogForm';
import type { ApplicationLogPayload } from '@/components/call-center/ApplicationLogForm';
import { apiClient } from '@/lib/api';

import { usePhone } from './phone-provider';
import { knownCallerName } from './softphone/format';
import { WrapUpView } from './softphone/wrap-up-view';

/**
 * Global Disposition Modal — renders as a fixed overlay when a softphone call
 * ends OUTSIDE of the Call Center Portal. Uses pendingDispositionCall from
 * PhoneProvider (not currentCall, which is cleared immediately on call end).
 *
 * This component owns the wrap-up: its fields, what is required, and the one
 * save request. WrapUpView only draws them.
 */
export function GlobalDispositionModal() {
  const pathname = usePathname();
  const { pendingDispositionCall, clearPendingDispositionCall } = usePhone();

  const [open, setOpen] = useState(false);
  const [selectedDisposition, setSelectedDisposition] = useState('');
  const [notes, setNotes] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpTime, setFollowUpTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  /*
   * The application the agent wrote, when the disposition says they wrote one.
   *
   * The same two posts as the Call Center Portal, in the same order and with
   * the same failure handling: an agent who dispositions a call from anywhere
   * else in the app must be able to record the business, or it is written and
   * never counted -- which understates the agency's closing percentage and
   * raises its price.
   */
  const [application, setApplication] = useState<ApplicationLogPayload | null>(null);
  const [applicationError, setApplicationError] = useState<string | null>(null);

  // Track the last handled call to prevent duplicate prompts
  const handledCallIdsRef = useRef<Set<string>>(new Set());
  /*
   * The `Call` row the disposition post resolved to, remembered across retries.
   *
   * The softphone's own call id may name no row, in which case the disposition
   * endpoint creates one; a retry sending the softphone id again would create a
   * second record for the same call.
   */
  const dispositionCallIdRef = useRef<string | null>(null);

  const resetAndClose = useCallback(() => {
    setOpen(false);
    setSelectedDisposition('');
    setNotes('');
    setFollowUpDate('');
    setFollowUpTime('');
    setSaved(false);
    setSaving(false);
    setSaveError(null);
    setApplication(null);
    setApplicationError(null);
    dispositionCallIdRef.current = null;
    clearPendingDispositionCall();
  }, [clearPendingDispositionCall]);

  // Detect pending disposition → show modal if not on Call Center Portal
  useEffect(() => {
    const isOnCallCenter = pathname?.includes('/call-center');
    if (
      pendingDispositionCall &&
      !isOnCallCenter &&
      !handledCallIdsRef.current.has(pendingDispositionCall.callId)
    ) {
      setOpen(true);
    }
  }, [pendingDispositionCall, pathname]);

  const handleSave = useCallback(async () => {
    if (!selectedDisposition || !pendingDispositionCall) return;

    const wroteApplication = selectedDisposition === 'APPLICATION_SUBMITTED';
    if (wroteApplication && !application) {
      setApplicationError(
        'Record the carrier, coverage amount, annual premium, first name and last name first.'
      );
      return;
    }

    setSaving(true);
    setSaveError(null);
    setApplicationError(null);

    let followUpAt: string | undefined;
    if (followUpDate && followUpTime) {
      followUpAt = new Date(`${followUpDate}T${followUpTime}`).toISOString();
    } else if (followUpDate) {
      followUpAt = new Date(`${followUpDate}T09:00:00`).toISOString();
    }

    /*
     * One request, carrying the application when there is one.
     *
     * It used to be two -- the disposition, then the application with the call
     * id that came back -- because `pendingDispositionCall.callId` is the
     * softphone's own session id, not a `Call` row, and only the server can
     * resolve it. That ordering meant anything failing in between left a call
     * marked as a sale with no sale behind it: nothing in the agency's
     * numerator, no credit spent, and this modal showing "saved".
     *
     * The server now resolves the call, records the application against it,
     * and only then writes the disposition. Either both land or neither does,
     * and a refusal comes back here as one error instead of a half-saved call.
     *
     * Retry reuses the same `clientRequestId`, so a save that landed before the
     * network gave up comes back as the row it wrote rather than as a second
     * application the agency is charged for.
     */
    try {
      const response = await apiClient.post<{ id?: string }>('/api/v1/calls/disposition', {
        callId: dispositionCallIdRef.current ?? pendingDispositionCall.callId,
        disposition: selectedDisposition,
        notes,
        duration: pendingDispositionCall.duration || 0,
        callerNumber: pendingDispositionCall.phoneNumber,
        direction: pendingDispositionCall.direction?.toUpperCase(),
        callSource: 'SOFTPHONE',
        followUpAt,
        ...(wroteApplication && application ? { application } : {}),
      });

      if (response.error) {
        throw new Error(response.error.message || 'Save failed');
      }
      const savedCallId = response.data?.id ?? null;
      if (savedCallId) dispositionCallIdRef.current = savedCallId;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save disposition';
      /*
       * Shown against the form when an application was riding along, because
       * that is where the agent has to act. Nothing is cleared and the modal
       * stays open: the call is not marked saved, and the business the agent
       * typed is still on screen.
       */
      if (wroteApplication) {
        setApplicationError(`${message} Nothing has been recorded — try again.`);
      } else {
        setSaveError(message);
      }
      setSaving(false);
      return;
    }

    // Mark as handled so it doesn't re-prompt
    handledCallIdsRef.current.add(pendingDispositionCall.callId);

    setSaving(false);
    setSaved(true);
    setTimeout(() => {
      resetAndClose();
    }, 1500);
  }, [
    selectedDisposition,
    notes,
    followUpDate,
    followUpTime,
    pendingDispositionCall,
    application,
    resetAndClose,
  ]);

  const handleSkip = useCallback(() => {
    if (pendingDispositionCall) {
      handledCallIdsRef.current.add(pendingDispositionCall.callId);
    }
    resetAndClose();
  }, [pendingDispositionCall, resetAndClose]);

  if (!open || !pendingDispositionCall) return null;

  const isRequired = selectedDisposition === 'SET_CALLBACK' || selectedDisposition === 'FOLLOW_UP';
  const wroteApplication = selectedDisposition === 'APPLICATION_SUBMITTED';
  const canSave =
    !!selectedDisposition &&
    (!isRequired || (!!followUpDate && !!followUpTime)) &&
    (!wroteApplication || !!application);

  return (
    <WrapUpView
      call={{
        phoneNumber: pendingDispositionCall.phoneNumber,
        callerName: knownCallerName(pendingDispositionCall.callerName),
        direction: pendingDispositionCall.direction,
        duration: pendingDispositionCall.duration || 0,
      }}
      selected={selectedDisposition}
      onSelect={setSelectedDisposition}
      notes={notes}
      onNotesChange={setNotes}
      followUpDate={followUpDate}
      followUpTime={followUpTime}
      onFollowUpDateChange={setFollowUpDate}
      onFollowUpTimeChange={setFollowUpTime}
      canSave={canSave}
      saving={saving}
      saved={saved}
      saveError={saveError}
      retry={Boolean(applicationError)}
      onSave={() => {
        void handleSave();
      }}
      onSkip={handleSkip}
      applicationSlot={
        /* The application the agent wrote, on any carrier. */
        <ApplicationLogForm
          prefill={{ phone: pendingDispositionCall.phoneNumber }}
          onChange={setApplication}
          error={applicationError}
          disabled={saving}
        />
      }
    />
  );
}
