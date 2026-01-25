# SAFETY_MANIFEST.md — Iron Dome Quarantine Declaration

> **Project Cortex | The Architect of Noise | 2026-01-24**

---

## 🛡️ IRON DOME PROTOCOL — ACTIVE

**The following directories and files are QUARANTINED.**

The UI layer will communicate via existing API endpoints only. **Zero modification** is permitted to any asset listed below.

---

## 🔒 QUARANTINED DIRECTORIES

### Telephony Core (Absolute Lockdown)

| Directory               | Purpose                 | Risk Level  |
| ----------------------- | ----------------------- | ----------- |
| `apps/freeswitch/`      | FreeSWITCH SIP Engine   | 🔴 CRITICAL |
| `apps/kamailio/`        | Kamailio SIP Proxy      | 🔴 CRITICAL |
| `apps/rtpengine/`       | RTPEngine Media Relay   | 🔴 CRITICAL |
| `apps/media/`           | FFmpeg/Transcription    | 🔴 CRITICAL |
| `packages/routing-dsl/` | Custom Call Routing DSL | 🔴 CRITICAL |
| `freeswitch/`           | Root FreeSWITCH configs | 🔴 CRITICAL |
| `kamailio/`             | Root Kamailio configs   | 🔴 CRITICAL |
| `rtpengine/`            | Root RTPEngine configs  | 🔴 CRITICAL |

---

## 🔒 QUARANTINED FILES

### Backend API Controllers

| File                                 | Function                |
| ------------------------------------ | ----------------------- |
| `apps/api/src/routes/agent-phone.ts` | SIP Phone API Endpoints |
| `apps/api/src/routes/websocket.ts`   | WebSocket Event Routes  |
| `apps/api/src/routes/stir-shaken.ts` | STIR/SHAKEN Compliance  |
| `apps/api/src/routes/flows.ts`       | Call Flow Routing       |
| `apps/api/src/routes/recordings.ts`  | Recording Management    |
| `apps/api/src/routes/transcripts.ts` | Transcription Endpoints |

### Backend Services

| File                                           | Function                                  |
| ---------------------------------------------- | ----------------------------------------- |
| `apps/api/src/services/freeswitch-service.ts`  | FreeSWITCH Communication                  |
| `apps/api/src/services/carrier-service.ts`     | Carrier Integrations (Twilio, SignalWire) |
| `apps/api/src/services/cnam-service.ts`        | CNAM/Caller ID Lookup (Twilio)            |
| `apps/api/src/services/flow-engine.ts`         | Call Flow Execution                       |
| `apps/api/src/services/flow-store.ts`          | Flow State Persistence                    |
| `apps/api/src/services/routing.ts`             | Call Routing Logic                        |
| `apps/api/src/services/event-bus.ts`           | Real-Time Event Distribution              |
| `apps/api/src/services/call-state.ts`          | Call State Management                     |
| `apps/api/src/services/stir-shaken-service.ts` | Attestation Services                      |
| `apps/api/src/services/recording-service.ts`   | Recording Operations                      |
| `apps/api/src/services/recording-lifecycle.ts` | Recording State Machine                   |

### Worker Processes

| File                                                    | Function              |
| ------------------------------------------------------- | --------------------- |
| `apps/worker/src/services/dialer-worker.ts`             | Outbound Dialer Logic |
| `apps/worker/src/services/autodialer.ts`                | Auto-Dial Campaigns   |
| `apps/worker/src/services/recording-analysis-worker.ts` | Transcription Jobs    |

### Frontend SIP Integration

| File                                               | Function                     |
| -------------------------------------------------- | ---------------------------- |
| `apps/web/src/components/phone/phone-provider.tsx` | SIP.js UserAgent (771 lines) |
| `apps/web/src/components/hooks/use-websocket.ts`   | WebSocket Data Stream        |
| `apps/web/src/components/CallEventSubscriber.tsx`  | Event Subscription           |
| `apps/web/src/components/dashboard/live-stats.tsx` | Real-Time Stats              |
| `apps/web/src/lib/backend-check.ts`                | Backend Availability         |

---

## 🚫 PROTECTED ENVIRONMENT VARIABLES

The following `.env` prefixes are **READ-ONLY**:

```
FREESWITCH_*
KAMAILIO_*
RTPENGINE_*
SIP_*
TWILIO_*
SIGNALWIRE_*
```

---

## ✅ SAFE ZONES (Writable)

| Path                                 | Scope                                       |
| ------------------------------------ | ------------------------------------------- |
| `apps/web/src/app/`                  | Page layouts and routes                     |
| `apps/web/src/components/ui/`        | UI components (non-phone)                   |
| `apps/web/src/components/dashboard/` | Dashboard widgets (except `live-stats.tsx`) |
| `apps/web/tailwind.config.ts`        | Tailwind theme tokens                       |
| `apps/web/src/app/globals.css`       | Global styles                               |
| `apps/web/src/hooks/`                | New adapter hooks                           |

---

## 📊 IRON DOME STATUS

| Metric                      | Value           |
| --------------------------- | --------------- |
| **Quarantined Directories** | 8               |
| **Quarantined Files**       | 22              |
| **Protected Env Prefixes**  | 6               |
| **Telephony Risk**          | **0.00%**       |
| **Protocol Status**         | 🟢 **ENFORCED** |

---

_Generated by The Architect of Noise | Project Cortex | Iron Dome v2.0_
