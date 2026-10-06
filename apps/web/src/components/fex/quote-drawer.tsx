'use client';

/**
 * The quoter over a live call.
 *
 * Opened by the softphone's Quote button, the Q shortcut, or by itself when a
 * call connects (`QuoteSessionProvider`). It sits above the softphone, full
 * height, with the call's controls pinned at the top so the agent never loses
 * them, and it is prefilled from what the call already knows: the lead the
 * call arrived with, the prospect matched by phone, and the CRM record.
 */

import * as React from 'react';

import { SheetDrawer } from '@/components/domain';
import { usePhone } from '@/components/phone/phone-provider';
import { formatPhoneNumber } from '@/components/phone/softphone/format';
import { Skeleton } from '@/components/ui/skeleton';
import { useQuoteSession } from '@/contexts/quote-session-context';
import { applyPrefill, emptyDraft } from '@/lib/fex/draft';
import { prefillFromProspect } from '@/lib/fex/prefill';

import { CallStrip } from './call-strip';
import { QuoteWorkspace } from './quote-workspace';

/** How long the drawer waits for the CRM lookup before prefilling without it. */
const LOOKUP_WAIT_MS = 1500;

export function QuoteDrawer(): JSX.Element | null {
  const session = useQuoteSession();
  const { currentCall } = usePhone();
  const callId = session?.drawerCallId ?? null;
  const [readyFor, setReadyFor] = React.useState<string | null>(null);

  // The call's phone and prospect, remembered while the drawer is open.
  const callRef = React.useRef(currentCall);
  if (currentCall && currentCall.callId === callId) callRef.current = currentCall;
  const call = callRef.current?.callId === callId ? callRef.current : null;

  React.useEffect(() => {
    if (!session || !callId) return;
    if (session.getDraft(callId)) {
      setReadyFor(callId);
      return;
    }
    let active = true;
    const phone = call?.phoneNumber ?? '';
    const lookup = session.lookupCustomer(callId, phone);
    const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), LOOKUP_WAIT_MS));
    void Promise.race([lookup, timeout]).then(customer => {
      if (!active) return;
      const context = session.getContext(callId);
      const prefill = prefillFromProspect({
        customer: (customer ?? context.customer ?? null) as Record<string, unknown> | null,
        prospectData: (call?.prospectData ?? null) as Record<string, unknown> | null,
        matchedProspect: context.matchedProspect ?? null,
      });
      session.setDraft(callId, applyPrefill(emptyDraft(session.settings?.agency), prefill));
      setReadyFor(callId);
    });
    return () => {
      active = false;
    };
    // Once per opened call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId]);

  if (!session) return null;
  const open = Boolean(callId);
  const context = callId ? session.getContext(callId) : {};
  const customer = context.customer ?? null;
  const prefill = prefillFromProspect({
    customer: customer as Record<string, unknown> | null,
    prospectData: (call?.prospectData ?? null) as Record<string, unknown> | null,
    matchedProspect: context.matchedProspect ?? null,
  });
  const who = prefill.prospectName ?? (formatPhoneNumber(call?.phoneNumber) || 'this call');
  const initial = callId ? session.getDraft(callId) : undefined;

  return (
    <SheetDrawer
      open={open}
      onOpenChange={next => {
        if (!next) session.closeDrawer();
      }}
      title={`Quote — ${who}`}
      description="Every carrier, priced and underwritten, with the reason for each result."
      size="quote"
    >
      <div className="flex h-full flex-col">
        <CallStrip className="shrink-0" />
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {callId && readyFor === callId && initial ? (
            <QuoteWorkspace
              key={callId}
              variant="drawer"
              initialDraft={initial}
              source="SOFTPHONE"
              callId={callId}
              insuranceLeadId={customer?.recordType === 'InsuranceLead' ? customer.id : null}
              prospectName={prefill.prospectName}
              selectedNote="Selected — it will prefill the application when you disposition this call"
            />
          ) : (
            <div className="space-y-3" aria-busy="true" aria-label="Loading the caller's details">
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}
        </div>
      </div>
    </SheetDrawer>
  );
}
