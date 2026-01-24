# SAFETY_PROTOCOL.md — Iron Dome Quarantine

> **Project Cortex | B.L.A.S.T. Protocol | Architect of Noise**

---

## 🛡️ PRIME DIRECTIVE

**The Telephony Engine is STRICTLY OFF-LIMITS.**

This document defines the READ-ONLY quarantine zone. Any file listed here must NOT be modified, refactored, or deleted during the redesign. These files represent the core SIP signaling, call routing, and backend voice APIs.

---

## 🔒 QUARANTINED DIRECTORIES (Iron Dome)

### Tier 1: Telephony Core (ABSOLUTE LOCKDOWN)

```
apps/freeswitch/            # FreeSWITCH SIP engine (entire directory)
apps/kamailio/              # Kamailio SIP proxy (entire directory)
apps/rtpengine/             # RTPEngine media relay (entire directory)
apps/media/                 # FFmpeg/transcription (entire directory)
packages/routing-dsl/       # Custom call routing DSL (entire directory)
```

### Tier 2: Backend API Controllers & Services

```
apps/api/src/routes/agent-phone.ts        # SIP phone API endpoints
apps/api/src/routes/websocket.ts          # WebSocket event routes
apps/api/src/routes/stir-shaken.ts        # STIR/SHAKEN compliance
apps/api/src/routes/flows.ts              # Call flow routing
apps/api/src/routes/recordings.ts         # Recording management
apps/api/src/routes/transcripts.ts        # Transcription endpoints

apps/api/src/services/freeswitch-service.ts   # FreeSWITCH communication
apps/api/src/services/carrier-service.ts      # Carrier integrations
apps/api/src/services/flow-engine.ts          # Call flow execution
apps/api/src/services/flow-store.ts           # Flow state persistence
apps/api/src/services/routing.ts              # Call routing logic
apps/api/src/services/event-bus.ts            # Real-time event distribution
apps/api/src/services/call-state.ts           # Call state management
apps/api/src/services/stir-shaken-service.ts  # Attestation services
apps/api/src/services/recording-service.ts    # Recording operations
apps/api/src/services/recording-lifecycle.ts  # Recording state machine
```

### Tier 3: Worker Processes (Background Jobs)

```
apps/worker/src/services/dialer-worker.ts       # Outbound dialer logic
apps/worker/src/services/autodialer.ts          # Auto-dial campaigns
apps/worker/src/services/recording-analysis-worker.ts  # Transcription jobs
```

### Tier 4: Frontend SIP Integration (READ-ONLY for Data Hooks)

```
apps/web/src/components/phone/phone-provider.tsx  # SIP.js UserAgent (771 lines)
apps/web/src/components/hooks/use-websocket.ts    # WebSocket data stream
apps/web/src/components/CallEventSubscriber.tsx   # Event subscription
apps/web/src/components/dashboard/live-stats.tsx  # Real-time stats
apps/web/src/lib/backend-check.ts                 # Backend availability
```

---

## ✅ SAFE DATA-FETCHING STRATEGY (Read-Only Hooks)

Instead of modifying the quarantined files, we will create **Adapter Hooks** that safely consume data from the existing infrastructure.

### Proposed Read-Only Hook Architecture

| Hook Name          | Source                       | Purpose                          |
| ------------------ | ---------------------------- | -------------------------------- |
| `useCallState()`   | `phone-provider.tsx` context | Read current call info           |
| `useAgentStatus()` | `phone-provider.tsx` context | Read agent availability          |
| `useLiveStats()`   | `use-websocket.ts` stream    | Read real-time telemetry         |
| `useCallHistory()` | API `/api/calls`             | Fetch call records (no mutation) |

### Implementation Pattern

```typescript
// apps/web/src/hooks/adapters/use-call-state.ts
'use client';

import { usePhone } from '@/components/phone/phone-provider';

/**
 * READ-ONLY adapter hook for call state.
 * Consumes data from PhoneProvider without modifying SIP logic.
 */
export function useCallState() {
  const { currentCall, agentStatus, callHistory } = usePhone();

  return {
    // Transformed for UI consumption
    isActive: currentCall !== null,
    callId: currentCall?.callId ?? null,
    direction: currentCall?.direction ?? null,
    duration: currentCall?.duration ?? 0,
    agentStatus,
    recentCalls: callHistory.slice(0, 10),
  };
}
```

---

## 🚫 DO NOT RULES (Behavioral Constraints)

1. **DO NOT** modify, refactor, or delete any file in Tier 1-3.
2. **DO NOT** alter SIP.js `UserAgent`, `Registerer`, or `Session` logic.
3. **DO NOT** change WebSocket message types or payloads.
4. **DO NOT** modify Prisma models affecting call/recording schemas.
5. **DO NOT** touch `.env` variables prefixed with `FREESWITCH_`, `KAMAILIO_`, or `RTPENGINE_`.

---

## ✅ SAFE ZONES (Writable)

The following are APPROVED for modification:

```
apps/web/src/app/              # Page layouts and routes
apps/web/src/components/ui/    # UI components (non-phone)
apps/web/src/components/dashboard/  # Dashboard widgets (except live-stats.tsx)
apps/web/tailwind.config.ts    # Tailwind theme tokens
apps/web/src/app/globals.css   # Global styles
apps/web/src/hooks/            # New hooks (adapters only)
```

---

## 📋 VERIFICATION CHECKLIST

Before any commit to `feature/project-cortex`:

- [ ] No files from Tier 1-4 appear in `git diff --name-only`
- [ ] Backend routes return identical responses (regression test)
- [ ] WebSocket message format unchanged
- [ ] SIP registration still succeeds on port 7443

---

## STATUS

| Item             | Status        |
| ---------------- | ------------- |
| Forensic Scan    | ✅ Complete   |
| Quarantine List  | ✅ Defined    |
| Adapter Strategy | ✅ Documented |
| User Approval    | 🔶 PENDING    |

**Awaiting approval to proceed to Phase 1: Blueprint (Implementation Plan).**
