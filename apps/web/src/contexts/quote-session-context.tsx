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
 * /call-center (the console has its own Quote tab), /quote, or a customer's
 * own quote workspace (/insurance-leads/:id/quote); and the caller's
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
  if (/^\/insurance-leads\/[^/]+\/quote/.test(path)) return false;
  const vertical = (input.vertical ?? '').toUpperCase();
  return vertical !== 'ACA' && vertical !== 'B2B';
}

interface Entry {
  draft?: QuoteDraft;
  selection?: FexSelection;
  context: CallContext;
  lookup?: Promise<CustomerLookupCustomer | null>;
}

const store = {
  entries: new Map<string, Entry>(),
  drawerCallId: null as string | null,
  settings: null as FexSettings | null,
  mounted: 0,
  version: 0,
  listeners: new Set<() => void>(),
};

function emit(): void {
  store.version += 1;
  store.listeners.forEach(listener => listener());
}

function entry(callId: string): Entry {
  let e = store.entries.get(callId);
  if (!e) store.entries.set(callId, (e = { context: {} }));
  return e;
}

function clearCall(callId: string): void {
  store.entries.delete(callId);
  if (store.drawerCallId === callId) store.drawerCallId = null;
  emit();
}

function lookupCustomer(callId: string, phone: string): Promise<CustomerLookupCustomer | null> {
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
      emit();
      return customer;
    });
  return e.lookup;
}

const actions = {
  openFor: (call: Pick<CallInfo, 'callId'> | null | undefined) => {
    if (!call?.callId) return;
    store.drawerCallId = call.callId;
    emit();
  },
  closeDrawer: () => {
    store.drawerCallId = null;
    emit();
  },
  getDraft: (id: string) => store.entries.get(id)?.draft,
  // Not emitted: the workspace that owns the draft already has it on screen.
  setDraft: (id: string, draft: QuoteDraft) => {
    entry(id).draft = draft;
  },
  getSelection: (id: string) => store.entries.get(id)?.selection,
  setSelection: (id: string, selection: FexSelection | null) => {
    entry(id).selection = selection ?? undefined;
    emit();
  },
  getContext: (id: string) => store.entries.get(id)?.context ?? {},
  setContext: (id: string, patch: CallContext) => {
    const e = entry(id);
    e.context = { ...e.context, ...patch };
    emit();
  },
  lookupCustomer,
  clearCall,
  setSettings: (settings: FexSettings) => {
    store.settings = settings;
    emit();
  },
};

function subscribe(listener: () => void): () => void {
  store.listeners.add(listener);
  return () => store.listeners.delete(listener);
}

const getVersion = () => store.version;

/** The session, or null when no QuoteSessionProvider is mounted. */
export function useQuoteSession(): QuoteSessionValue | null {
  const version = React.useSyncExternalStore(subscribe, getVersion, getVersion);
  return React.useMemo(
    () =>
      store.mounted > 0
        ? { ...actions, drawerCallId: store.drawerCallId, settings: store.settings, version }
        : null,
    [version]
  );
}

/** Tests only: forget everything. */
export function resetQuoteSession(): void {
  store.entries.clear();
  store.drawerCallId = null;
  store.settings = null;
  emit();
}

/**
 * Runs the session for the signed-in shell. Self-closing in the layout;
 * `children`, when given (tests), render as they are.
 */
export function QuoteSessionProvider({ children }: { children?: React.ReactNode }): JSX.Element {
  const { currentCall, phoneStatus } = usePhone();
  const pathname = usePathname();
  const session = useQuoteSession();
  const settings = session?.settings ?? null;

  React.useLayoutEffect(() => {
    store.mounted += 1;
    emit();
    return () => {
      store.mounted -= 1;
      emit();
    };
  }, []);

  // The agency's and the agent's settings, once the phone is in use.
  React.useEffect(() => {
    if (phoneStatus === 'disabled' || store.settings) return;
    let active = true;
    void fexApi.settings().then(result => {
      if (active && result.ok) actions.setSettings(result.data);
    });
    return () => {
      active = false;
    };
  }, [phoneStatus]);

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
        actions.openFor({ callId });
      }
    });
  }, [callId, connected, settings, phone]);

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
  }, [liveCallId]);
  React.useEffect(() => {
    const timers = expiry.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  return <>{children}</>;
}
