'use client';

/**
 * The quoter, per call.
 *
 * One draft per call, keyed by the softphone's call id, so closing the quoter
 * mid-call and opening it again loses nothing; the quote the agent USED on
 * that call, so the disposition can prefill the application from it; and the
 * drawer's open state, so the softphone's Quote button, the Q shortcut and the
 * auto-open on connect all drive one drawer.
 *
 * A call's entry is cleared once its disposition is saved, or 30 minutes after
 * the call ends, whichever is first.
 *
 * ── Opening on connect ───────────────────────────────────────────────────────
 *
 * When a call connects the drawer opens by itself, once per call, if all of:
 * the agent's own setting (or, unset, the agency's) is on; the agent is not on
 * /call-center (the console has its own Quote tab) or /quote; and the caller's
 * CRM record is not an ACA or B2B one (no record at all still opens). Closing
 * it does not reopen it.
 */

import { usePathname } from 'next/navigation';
import * as React from 'react';

import { usePhone, type CallInfo } from '@/components/phone/phone-provider';
import { fetchCustomerLookup, type CustomerLookupCustomer } from '@/lib/api/leads';
import { fexApi, type FexSelection, type FexSettings } from '@/lib/fex/api';
import type { QuoteDraft } from '@/lib/fex/draft';

export const CALL_ENTRY_TTL_MS = 30 * 60 * 1000;

/** What the softphone already found out about the caller. */
export interface CallContext {
  matchedProspect?: Record<string, unknown> | null;
  /** `undefined` = not looked up yet; `null` = looked up, no record. */
  customer?: CustomerLookupCustomer | null;
}

export interface QuoteSessionValue {
  /** The call the drawer is open for, or null when closed. */
  drawerCallId: string | null;
  openFor: (call: Pick<CallInfo, 'callId'> | null | undefined) => void;
  closeDrawer: () => void;

  getDraft: (callId: string) => QuoteDraft | undefined;
  setDraft: (callId: string, draft: QuoteDraft) => void;

  getSelection: (callId: string) => FexSelection | undefined;
  setSelection: (callId: string, selection: FexSelection | null) => void;

  getContext: (callId: string) => CallContext;
  setContext: (callId: string, patch: CallContext) => void;
  /** The CRM record for a call, looked up once and remembered. */
  lookupCustomer: (callId: string, phone: string) => Promise<CustomerLookupCustomer | null>;

  /** After a disposition is saved: forget the call. */
  clearCall: (callId: string) => void;

  settings: FexSettings | null;
  setSettings: (settings: FexSettings) => void;
  /** Bumps whenever stored drafts/selections change, for consumers that render them. */
  version: number;
}

const QuoteSessionContext = React.createContext<QuoteSessionValue | null>(null);

/** The session, or null outside a provider (the /quote page works without one). */
export function useQuoteSession(): QuoteSessionValue | null {
  return React.useContext(QuoteSessionContext);
}

/** Whether a connected call should open the quoter by itself. Pure, for tests. */
export function shouldAutoOpen(input: {
  agencySetting: boolean;
  mySetting: boolean | null;
  pathname: string | null;
  vertical: string | null | undefined;
}): boolean {
  const on = input.mySetting ?? input.agencySetting;
  if (!on) return false;
  const path = input.pathname ?? '';
  if (path.startsWith('/call-center') || path.startsWith('/quote')) return false;
  const vertical = (input.vertical ?? '').toUpperCase();
  return vertical !== 'ACA' && vertical !== 'B2B';
}

interface Entry {
  draft?: QuoteDraft;
  selection?: FexSelection;
  context: CallContext;
  lookup?: Promise<CustomerLookupCustomer | null>;
}

export function QuoteSessionProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const { currentCall, phoneStatus } = usePhone();
  const pathname = usePathname();

  const entries = React.useRef(new Map<string, Entry>());
  const [version, setVersion] = React.useState(0);
  const bump = React.useCallback(() => setVersion(v => v + 1), []);
  const [drawerCallId, setDrawerCallId] = React.useState<string | null>(null);
  const [settings, setSettings] = React.useState<FexSettings | null>(null);

  const entry = React.useCallback((callId: string): Entry => {
    let e = entries.current.get(callId);
    if (!e) entries.current.set(callId, (e = { context: {} }));
    return e;
  }, []);

  const clearCall = React.useCallback(
    (callId: string) => {
      entries.current.delete(callId);
      setDrawerCallId(open => (open === callId ? null : open));
      bump();
    },
    [bump]
  );

  const lookupCustomer = React.useCallback(
    (callId: string, phone: string): Promise<CustomerLookupCustomer | null> => {
      const e = entry(callId);
      if (e.context.customer !== undefined) return Promise.resolve(e.context.customer);
      const digits = phone.replace(/\D/g, '');
      if (digits.length < 10) {
        e.context.customer = null;
        return Promise.resolve(null);
      }
      e.lookup ??= fetchCustomerLookup(digits)
        .then(result => result?.customer ?? null)
        .catch(() => null)
        .then(customer => {
          e.context.customer = customer;
          bump();
          return customer;
        });
      return e.lookup;
    },
    [entry, bump]
  );

  // The agency's and the agent's settings, once the phone is in use.
  React.useEffect(() => {
    if (phoneStatus === 'disabled' || settings) return;
    let active = true;
    void fexApi.settings().then(result => {
      if (active && result.ok) setSettings(result.data);
    });
    return () => {
      active = false;
    };
  }, [phoneStatus, settings]);

  // Open on connect, once per call.
  const autoOpened = React.useRef(new Set<string>());
  const pathnameRef = React.useRef(pathname);
  pathnameRef.current = pathname;
  const callId = currentCall?.callId;
  const connected = currentCall?.state === 'active';
  const phone = currentCall?.phoneNumber ?? '';
  React.useEffect(() => {
    if (!callId || !connected || !settings) return;
    if (autoOpened.current.has(callId)) return;
    autoOpened.current.add(callId);
    const setting = {
      agencySetting: settings.agency.autoOpenOnCall,
      mySetting: settings.me.autoOpenOnCall,
    };
    // Cheap checks first: no lookup at all when it would not open anyway.
    if (!shouldAutoOpen({ ...setting, pathname: pathnameRef.current, vertical: null })) return;
    void lookupCustomer(callId, phone).then(customer => {
      if (
        shouldAutoOpen({
          ...setting,
          pathname: pathnameRef.current,
          vertical: customer?.vertical ?? null,
        })
      ) {
        setDrawerCallId(callId);
      }
    });
  }, [callId, connected, settings, phone, lookupCustomer]);

  // Forget a call 30 minutes after it ends (its disposition usually clears it sooner).
  const previousCall = React.useRef<string | null>(null);
  const expiry = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const liveCallId = currentCall && currentCall.state !== 'ended' ? currentCall.callId : null;
  React.useEffect(() => {
    const previous = previousCall.current;
    previousCall.current = liveCallId;
    if (!previous || previous === liveCallId || expiry.current.has(previous)) return;
    expiry.current.set(
      previous,
      setTimeout(() => {
        expiry.current.delete(previous);
        clearCall(previous);
      }, CALL_ENTRY_TTL_MS)
    );
  }, [liveCallId, clearCall]);
  React.useEffect(() => {
    const timers = expiry.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  const value = React.useMemo<QuoteSessionValue>(
    () => ({
      drawerCallId,
      openFor: call => {
        if (call?.callId) setDrawerCallId(call.callId);
      },
      closeDrawer: () => setDrawerCallId(null),
      getDraft: id => entries.current.get(id)?.draft,
      setDraft: (id, draft) => {
        entry(id).draft = draft;
      },
      getSelection: id => entries.current.get(id)?.selection,
      setSelection: (id, selection) => {
        entry(id).selection = selection ?? undefined;
        bump();
      },
      getContext: id => entries.current.get(id)?.context ?? {},
      setContext: (id, patch) => {
        const e = entry(id);
        e.context = { ...e.context, ...patch };
      },
      lookupCustomer,
      clearCall,
      settings,
      setSettings,
      version,
    }),
    [drawerCallId, entry, bump, lookupCustomer, clearCall, settings, version]
  );

  return <QuoteSessionContext.Provider value={value}>{children}</QuoteSessionContext.Provider>;
}
