# Hopwhistle Telephony & VOIP Complete Reference Guide

> [!IMPORTANT]
> **LEGACY/STALE NOTE**: References to the Vultr server (IP `45.32.213.201`) in this document are obsolete. AWS (IP `3.214.60.13`) is the single source of truth for database and recordings, and Hetzner is the new target production environment. For active deployment and migration instructions, see [HETZNER_MIGRATION_FROM_AWS.md](file:///C:/Users/jimbo/.gemini/antigravity/worktrees/hopbot/edit-campaign-buyer-fix/HETZNER_MIGRATION_FROM_AWS.md).

**Version:** 2026.01.31  

**Last Updated:** January 31, 2026

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [VOIP Carrier Integrations](#2-voip-carrier-integrations)
3. [FreeSWITCH Engine](#3-freeswitch-engine)
4. [SIP.js WebRTC Client](#4-sipjs-webrtc-client)
5. [Call Routing Service](#5-call-routing-service)
6. [RTB Ping/Post Engine](#6-rtb-pingpost-engine)
7. [Phone Number Provisioning](#7-phone-number-provisioning)
8. [Number Pool Service (Dynamic Cloaking)](#8-number-pool-service-dynamic-cloaking)
9. [Call State Management](#9-call-state-management)
10. [Recording Service](#10-recording-service)
11. [STIR/SHAKEN Compliance](#11-stirshaken-compliance)
12. [CNAM Lookup Service](#12-cnam-lookup-service)
13. [Geo-Routing Intelligence](#13-geo-routing-intelligence)
14. [Flow Engine (Call Processing)](#14-flow-engine-call-processing)
15. [API Endpoints Reference](#15-api-endpoints-reference)
16. [Environment Variables](#16-environment-variables)
17. [Port Assignments](#17-port-assignments)
18. [Troubleshooting Guide](#18-troubleshooting-guide)

---

## 1. Architecture Overview

Hopwhistle implements a **hybrid telephony stack** combining browser-based SIP clients with a server-side FreeSWITCH engine orchestrated via ESL (Event Socket Layer).

### Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (Browser)                             │
│  ┌─────────────────────┐    ┌─────────────────────┐                         │
│  │   Dashboard Dialer  │    │  Call Center Portal │                         │
│  │  (agent-phone-panel)│    │    (/call-center)   │                         │
│  └─────────┬───────────┘    └─────────┬───────────┘                         │
│            │                          │                                     │
│            └──────────┬───────────────┘                                     │
│                       ▼                                                     │
│            ┌─────────────────────┐                                          │
│            │    PhoneProvider    │  ← SIP.js UserAgent                      │
│            │ (phone-provider.tsx)│                                          │
│            └─────────┬───────────┘                                          │
└──────────────────────┼──────────────────────────────────────────────────────┘
                       │ WSS (Port 7443)
                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          TELEPHONY ENGINE (FreeSWITCH)                      │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  mod_sofia (SIP Stack)                                              │    │
│  │  • WS Binding: 8083 (internal)                                      │    │
│  │  • WSS Binding: 7443 (external, SSL)                                │    │
│  │  • SIP UDP: 5060/5080                                               │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  ESL (Event Socket Layer) - Port 8021                               │    │
│  │  • API Commands: uuid_transfer, uuid_kill, conference               │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  RTP Media Engine                                                   │    │
│  │  • Ports: 16384-32768 (UDP)                                         │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           API LAYER (Fastify + Prisma)                      │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐                   │
│  │RoutingService  │ │AuctionService  │ │FreeSwitchSvc   │                   │
│  │ (routing.ts)   │ │(auction-svc.ts)│ │(freeswitch.ts) │                   │
│  └────────────────┘ └────────────────┘ └────────────────┘                   │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐                   │
│  │NumberPoolSvc   │ │RecordingSvc    │ │CallStateSvc    │                   │
│  │(number-pool.ts)│ │(recording.ts)  │ │(call-state.ts) │                   │
│  └────────────────┘ └────────────────┘ └────────────────┘                   │
└─────────────────────────────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           VOIP CARRIERS (External)                          │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐                   │
│  │   SignalWire   │ │     Telnyx     │ │   Bandwidth    │                   │
│  │   (PRIMARY)    │ │   (Adapter)    │ │   (Adapter)    │                   │
│  └────────────────┘ └────────────────┘ └────────────────┘                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Architectural Principles

| Principle            | Implementation                                   |
| -------------------- | ------------------------------------------------ |
| **Multi-Tenant**     | All telephony resources scoped by `tenantId`     |
| **Carrier Agnostic** | Adapter pattern for SignalWire/Telnyx/Bandwidth  |
| **Real-Time State**  | Redis for call state, routing keys, cap tracking |
| **Financial Safety** | Decimal precision for all monetary values        |
| **Compliance First** | STIR/SHAKEN, TCPA, consent tracking              |

---

## 2. VOIP Carrier Integrations

### Provider Architecture

The system uses an **adapter pattern** to abstract carrier-specific implementations:

```typescript
// apps/api/src/services/provisioning/types.ts
export type Provider = 'local' | 'signalwire' | 'telnyx' | 'bandwidth' | 'clec';

export interface ProvisioningAdapter {
  readonly provider: Provider;
  listNumbers(options?: ListNumbersOptions): Promise<ProvisionedNumber[]>;
  purchaseNumber(request: PurchaseNumberRequest): Promise<ProvisionedNumber>;
  releaseNumber(providerId: string): Promise<void>;
  getNumber(providerId: string): Promise<ProvisionedNumber | null>;
  configureNumber(providerId: string, features: NumberFeatures): Promise<void>;
  isConfigured(): boolean;
}
```

### 2.1 SignalWire (Primary Carrier)

**Status:** ✅ Production-Ready

**Location:** `apps/api/src/services/provisioning/adapters/signalwire-adapter.ts`

**Required Environment Variables:**

```env
SIGNALWIRE_PROJECT_ID=your-project-id          # UUID format
SIGNALWIRE_API_TOKEN=PTxxxxxxx                  # Starts with "PT"
SIGNALWIRE_SPACE_URL=your-space.signalwire.com  # Space domain
```

> ⚠️ **Important:** Use the API Token (starts with `PT`) for REST API calls, NOT the signing key (starts with `PSK_`). The signing key is only for webhook signature verification.

**API Endpoints Used:**

| Method | Endpoint                             | Purpose            |
| ------ | ------------------------------------ | ------------------ |
| GET    | `/api/relay/rest/phone_numbers`      | List owned numbers |
| POST   | `/api/relay/rest/phone_numbers`      | Purchase number    |
| DELETE | `/api/relay/rest/phone_numbers/{id}` | Release number     |
| GET    | `/api/relay/rest/phone_numbers/{id}` | Get number details |
| PATCH  | `/api/relay/rest/phone_numbers/{id}` | Configure features |

**Capabilities Supported:**

- ✅ Voice
- ✅ SMS
- ✅ MMS
- ✅ Fax

### 2.2 Telnyx (Secondary)

**Status:** 🔧 Adapter Implemented (Placeholder)

**Location:** `apps/api/src/services/provisioning/adapters/telnyx-adapter.ts`

**Required Environment Variables:**

```env
TELNYX_API_KEY=your-api-key
```

### 2.3 Bandwidth (Tertiary)

**Status:** 🔧 Adapter Implemented (Placeholder)

**Location:** `apps/api/src/services/provisioning/adapters/bandwidth-adapter.ts`

**Required Environment Variables:**

```env
BANDWIDTH_ACCOUNT_ID=your-account-id
BANDWIDTH_USERNAME=your-username
BANDWIDTH_PASSWORD=your-password
BANDWIDTH_SITE_ID=your-site-id
```

### 2.4 Local Adapter (Development)

**Status:** ✅ Active for Development/Testing

Generates mock phone numbers for testing without hitting external APIs.

---

## 3. FreeSWITCH Engine

### Overview

FreeSWITCH serves as the core telephony engine, handling SIP signaling, media processing, and call control.

**Container:** `hopwhistle-freeswitch-dev`

### 3.1 ESL Service

**Location:** `apps/api/src/services/freeswitch-service.ts`

The ESL (Event Socket Layer) service enables programmatic control of FreeSWITCH from the API layer.

```typescript
export class FreeSwitchService {
  // Execute any FreeSWITCH API command
  async executeApi(command: string, args: string): Promise<string>;

  // Resolve SIP Call-ID to internal FreeSWITCH UUID
  async resolveUuid(sipCallId: string): Promise<string | null>;

  // Merge two calls into a conference (3-way calling)
  async mergeCalls(activeSipCallId: string, heldSipCallId: string): Promise<void>;
}
```

**Environment Variables:**

```env
FREESWITCH_HOST=freeswitch           # Docker service name
FREESWITCH_ESL_PORT=8021             # ESL port
FREESWITCH_ESL_PASSWORD=ClueCon      # Default ESL password
```

### 3.2 3-Way Call Merging

The merge process transfers call legs into a server-side conference:

1. **Resolve UUIDs:** Map SIP Call-IDs to FreeSWITCH UUIDs via `show channels as json`
2. **Transfer Held Remote Leg:** `uuid_transfer ${heldUuid} -bleg conference:${confName} inline`
3. **Transfer Active Remote Leg:** `uuid_transfer ${activeUuid} -bleg conference:${confName} inline`
4. **Transfer Agent:** `uuid_transfer ${activeUuid} conference:${confName} inline`
5. **Kill Redundant Leg:** `uuid_kill ${heldUuid}`

### 3.3 Configuration Files

| Path                                        | Purpose                              |
| ------------------------------------------- | ------------------------------------ |
| `/etc/freeswitch/vars.xml`                  | Global variables (passwords, domain) |
| `/etc/freeswitch/sip_profiles/internal.xml` | SIP profile bindings                 |
| `/etc/freeswitch/directory/default/`        | User extensions (1000-1019)          |

### 3.4 WebSocket Configuration

FreeSWITCH handles WebRTC via `mod_sofia`:

```xml
<!-- internal.xml -->
<param name="ws-binding" value=":8083"/>   <!-- Plain WS -->
<param name="wss-binding" value=":7443"/>  <!-- Secure WSS -->
<param name="tls-cert-dir" value="/etc/freeswitch/letsencrypt"/>
<param name="tls-version" value="tlsv1.2"/>
```

### 3.5 Diagnostics

```bash
# Check active registrations
docker exec hopwhistle-freeswitch-dev fs_cli -x "show registrations"

# Enable SIP trace
docker exec hopwhistle-freeswitch-dev fs_cli -x "sofia profile internal siptrace on"

# Verify global variables
docker exec hopwhistle-freeswitch-dev fs_cli -x "global_getvar domain"
docker exec hopwhistle-freeswitch-dev fs_cli -x "global_getvar default_password"

# List active channels
docker exec hopwhistle-freeswitch-dev fs_cli -x "show channels"
```

---

## 4. SIP.js WebRTC Client

### Overview

The frontend implements a SIP.js-based WebRTC client that connects to FreeSWITCH via WebSockets.

**Location:** `apps/web/src/components/phone/phone-provider.tsx`

### 4.1 Initialization

```typescript
const sipUser = '1000'; // Extension (1000-1019 pre-provisioned)
const sipPass = '1234'; // Default password
const sipDomain = process.env.NEXT_PUBLIC_IP || '45.32.213.201';

const wsHost = window.location.hostname;
const isSecure = window.location.protocol === 'https:';

// Port 7443: FreeSWITCH Native WSS (Production)
// Port 8083: Direct WS (Development)
const sipWsUrl = isSecure ? `wss://${wsHost}:7443` : `ws://${sipDomain}:8083`;

const options: UserAgentOptions = {
  uri: UserAgent.makeURI(`sip:${sipUser}@${sipDomain}`),
  transportOptions: { server: sipWsUrl },
  authorizationUsername: sipUser,
  authorizationPassword: sipPass,
};
```

### 4.2 Client Interfaces

| Interface          | Location                | Purpose                               |
| ------------------ | ----------------------- | ------------------------------------- |
| Dashboard Dialer   | `agent-phone-panel.tsx` | Pop-up utility for quick dialing      |
| Call Center Portal | `/call-center`          | Full cockpit with scripting & quoting |

### 4.3 State Management

```typescript
interface CallInfo {
  callId: string;
  direction: 'inbound' | 'outbound';
  state: 'ringing' | 'connecting' | 'active' | 'completed' | 'failed';
  phoneNumber: string;
  callerName?: string;
  startTime?: Date;
  answerTime?: Date;
  endTime?: Date;
  duration: number;
  isMuted: boolean;
  isOnHold: boolean;
  recordingEnabled: boolean;
  prospectData?: ProspectData;
}
```

### 4.4 Context API

```typescript
interface PhoneContextType {
  agentStatus: 'offline' | 'available' | 'busy' | 'away';
  currentCall: CallInfo | null;
  callHistory: CallInfo[];

  // Actions
  makeCall: (phoneNumber: string) => Promise<void>;
  answerCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
  toggleHold: () => void;
  transferCall: (destination: string) => void;
  mergeCalls: () => Promise<void>;

  // Audio
  setAudioInput: (deviceId: string) => void;
  setAudioOutput: (deviceId: string) => void;
}
```

### 4.5 Troubleshooting SIP Registration

| Symptom              | Cause                          | Solution                              |
| -------------------- | ------------------------------ | ------------------------------------- |
| 408 Timeout          | Domain/Realm mismatch          | Use IP (`45.32.213.201`) not hostname |
| 403 Forbidden        | Invalid extension              | Use numeric extension (1000-1019)     |
| WebSocket Error 1006 | SSL/TLS issue                  | Verify WSS certificates               |
| Silent REGISTER      | Missing `global_getvar domain` | Set domain in `vars.xml`              |

---

## 5. Call Routing Service

### Overview

The `RoutingService` selects optimal buyers for live voice calls based on performance, priority, and geo-routing.

**Location:** `apps/api/src/services/routing.ts`

### 5.1 Selection Workflow

```
┌─────────────────┐
│  Incoming Call  │
└────────┬────────┘
         ▼
┌─────────────────┐
│ Get Eligible    │──→ Fetch active BuyerEndpoints
│ Endpoints       │
└────────┬────────┘
         ▼
┌─────────────────┐
│ Geo-Routing     │──→ Filter by acceptedStates[]
│ Filter          │
└────────┬────────┘
         ▼
┌─────────────────┐
│ Cap/Concurrency │──→ Check frequency limits
│ Filter          │
└────────┬────────┘
         ▼
┌─────────────────┐
│ Two-Tier Sort   │
│ • Tier 1: Score │──→ Performance-based (high volume)
│ • Tier 2: Name  │──→ Fallback (new buyers)
└────────┬────────┘
         ▼
┌─────────────────┐
│ Select Best     │──→ Return buyerId + endpoint
│ Buyer           │
└─────────────────┘
```

### 5.2 Data Types

```typescript
interface CallData {
  callerId?: string | null;
  callerAreaCode?: string | null;
  callerState?: string | null;
  callerZipCode?: string | null;
}

interface EligibleEndpoint {
  buyerId: string;
  buyerName: string;
  endpointId: string;
  destination: string;
  priority: number;
  acceptedStates: string[];
  isNational: boolean;
}
```

---

## 6. RTB Ping/Post Engine

### Overview

The RTB (Real-Time Bidding) system enables publishers to submit leads for real-time valuation and buyer auctions.

### 6.1 Ping Engine (Phase 1)

**Location:** `apps/api/src/services/auction-service.ts`

#### Workflow

1. **Discovery:** Fetch all active `BuyerEndpoints` for publisher
2. **Parallel Filtering:**
   - Geo-Filtering (validate state)
   - Operating Hours (split-shift support)
   - Cap Check (SQL + Redis thundering herd protection)
3. **Pricing:** Apply structured JSON pricing rules
4. **Win Selection:** Sort by price, assign signed JWT token

#### API: `POST /api/v1/ping`

**Request:**

```json
{
  "request_id": "unique-id-for-idempotency",
  "vertical": "final_expense",
  "caller": {
    "state": "FL",
    "zip": "33301",
    "age": 65
  },
  "source": "facebook",
  "min_bid": 10.0
}
```

**Response:**

```json
{
  "ping_id": "ping_abc123",
  "bid": 25.5,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "expires_at": "2026-01-31T19:30:00Z"
}
```

#### Pricing Rules (Safe Evaluation)

```typescript
interface PricingRule {
  field: string; // "age", "state"
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';
  val: string | number | (string | number)[];
  adjustment: string; // Decimal string
}
```

Example rules stored in `BuyerEndpoint.pricingRules`:

```json
[
  { "field": "age", "op": "gte", "val": 65, "adjustment": "5.00" },
  { "field": "state", "op": "in", "val": ["FL", "TX", "CA"], "adjustment": "2.50" }
]
```

### 6.2 Post Engine (Phase 2)

**Location:** `apps/api/src/services/post-service.ts`

Converts winning bid tokens into live calls with dynamic number cloaking.

#### API: `POST /api/v1/post`

**Request:**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "caller_number": "+18655551234"
}
```

**Response:**

```json
{
  "status": "success",
  "accepted": true,
  "transfer_number": "+18655550100"
}
```

#### Dynamic Number Cloaking

See [Section 8: Number Pool Service](#8-number-pool-service-dynamic-cloaking).

### 6.3 Architectural Constraints

| Constraint          | Implementation                           |
| ------------------- | ---------------------------------------- |
| **Money Safety**    | Decimal (Prisma) for all monetary values |
| **Thundering Herd** | Redis-based cap reservation              |
| **Signed Tokens**   | HS256 JWT with 5-minute TTL              |
| **Idempotency**     | Redis cache for request_id               |

---

## 7. Phone Number Provisioning

### Overview

Unified service for managing phone numbers across multiple carriers.

**Location:** `apps/api/src/services/provisioning/provisioning-service.ts`

### 7.1 Service API

```typescript
class ProvisioningService {
  // Purchase from preferred provider
  purchaseNumber(
    provider: Provider | undefined,
    request: PurchaseNumberRequest,
    context: { tenantId; userId; ipAddress; requestId }
  ): Promise<ProvisionedNumber>;

  // Release back to provider
  releaseNumber(numberId: string, context): Promise<void>;

  // Assign to campaign
  assignNumberToCampaign(request: AssignNumberRequest, context): Promise<ProvisionedNumber>;

  // Audit local vs provider inventory
  auditInventory(provider: Provider, tenantId?: string): Promise<AuditResult>;
}
```

### 7.2 Provider Selection Logic

```
1. Tenant preference (metadata.defaultProvider)
2. Environment variable (DEFAULT_PROVIDER)
3. Development fallback (local)
4. Configured adapter order (SignalWire → Telnyx → Bandwidth)
```

### 7.3 Database Schema

```prisma
model PhoneNumber {
  id            String   @id @default(uuid())
  tenantId      String
  number        String                    // E.164 format (+15551234567)
  campaignId    String?
  provider      String?                   // signalwire | telnyx | bandwidth | local
  status        PhoneNumberStatus

  // RTB Pool fields
  poolType      PhoneNumberPoolType?      // POOL | STATIC | BUYER
  poolStatus    PhoneNumberPoolStatus?    // AVAILABLE | ASSIGNED | RESERVED
  lastAssignedAt DateTime?

  // Capabilities
  capabilities  Json?                     // { voice, sms, mms, fax }
  metadata      Json?

  purchasedAt   DateTime?
  releasedAt    DateTime?
}
```

### 7.4 CLI Commands

```bash
# Import from CSV
pnpm exec numbers:import --file=numbers.csv

# Assign to campaign
pnpm exec numbers:assign --tenant=t_123 --campaign=c_abc --number=+15551234567

# Audit inventory
pnpm exec numbers:audit --provider=signalwire --tenant=t_123
```

---

## 8. Number Pool Service (Dynamic Cloaking)

### Overview

Manages the DID number pool for dynamic number assignment (cloaking) in the RTB Post flow.

**Location:** `apps/api/src/services/number-pool-service.ts`

### 8.1 Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Publisher     │────▶│   POST /post    │────▶│ NumberPoolSvc   │
│ (with JWT Token)│     │                 │     │                 │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                                    ┌────────────────────┼────────────────────┐
                                    ▼                    ▼                    ▼
                             ┌──────────┐        ┌──────────────┐      ┌──────────┐
                             │ Database │        │    Redis     │      │Telephony │
                             │PhoneNumber│       │Routing Keys  │      │  Engine  │
                             └──────────┘        └──────────────┘      └──────────┘
```

### 8.2 Lease Workflow

1. **Find Available:** Query `PhoneNumber` where `poolType=POOL` and `poolStatus=AVAILABLE`
2. **Atomic Lock:** Redis-based lock to prevent double-assignment
3. **Update DB:** Set `poolStatus=ASSIGNED`, record `lastAssignedAt`
4. **Set Redis Routing:** `route:did:{e164}` → `{buyer_destination, ping_id, buyer_id}`
5. **Return DID:** Publisher receives transfer number for call

### 8.3 Redis Keys

| Key Pattern           | TTL           | Purpose                                |
| --------------------- | ------------- | -------------------------------------- |
| `route:did:{e164}`    | 900s (15 min) | Telephony routing info                 |
| `lock:number:{e164}`  | 10s           | Race condition prevention              |
| `ping:lease:{pingId}` | 900s          | Idempotency (same token → same number) |

### 8.4 The Reaper (Zombie Cleanup)

Scheduled job to reclaim expired leases:

```typescript
async reclaimExpiredLeases(): Promise<{ reclaimed: number }> {
  // Find zombies: ASSIGNED in DB but Redis TTL expired
  // Selection: poolStatus=ASSIGNED AND lastAssignedAt < (NOW - 20 min)
  // Double-check: Verify Redis key is gone before reclaiming
  // Action: Set poolStatus=AVAILABLE, clear lastAssignedAt
}
```

**Trigger:** `POST /internal/reclaim-numbers`

### 8.5 Pool Statistics

```bash
# Get pool stats
curl -H "x-internal-key: internal-reclaim-key" \
  http://localhost:3001/internal/pool-stats
```

Response:

```json
{
  "pool": {
    "available": 45,
    "assigned": 12,
    "total": 57
  }
}
```

---

## 9. Call State Management

### Overview

Real-time call state tracking using Redis with 24-hour TTL.

**Location:** `apps/api/src/services/call-state.ts`

### 9.1 Data Model

```typescript
interface CallState {
  id: string;
  tenantId: string;
  status: 'initiated' | 'ringing' | 'answered' | 'completed' | 'failed';
  current_node?: string; // Flow engine node
  participants: CallParticipant[];
  timers: CallTimer[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface CallParticipant {
  id: string;
  number: string;
  role: 'caller' | 'callee' | 'agent';
  status: 'ringing' | 'answered' | 'completed' | 'failed';
  joinedAt?: string;
  leftAt?: string;
}

interface CallTimer {
  id: string;
  name: string; // "ringTime", "talkTime", "queueTime"
  startedAt: string;
  duration?: number;
  completedAt?: string;
}
```

### 9.2 Redis Storage

- **Key:** `call:{callId}`
- **TTL:** 86400 seconds (24 hours)
- **Format:** JSON serialized `CallState`

### 9.3 Service API

```typescript
class CallStateService {
  getCallState(callId: string): Promise<CallState | null>;
  setCallState(callState: CallState): Promise<void>;
  updateCallState(callId: string, updates: Partial<CallState>): Promise<CallState | null>;
  addParticipant(callId: string, participant: CallParticipant): Promise<CallState | null>;
  updateParticipant(callId: string, participantId: string, updates): Promise<CallState | null>;
  addTimer(callId: string, timer: CallTimer): Promise<CallState | null>;
  updateTimer(callId: string, timerId: string, updates): Promise<CallState | null>;
  updateCurrentNode(callId: string, nodeId: string): Promise<CallState | null>;
  deleteCallState(callId: string): Promise<void>;
}
```

---

## 10. Recording Service

### Overview

Handles call recording upload, storage, and playback with S3-compatible storage.

**Location:** `apps/api/src/services/recording-service.ts`

### 10.1 Upload Flow

1. **FreeSWITCH Callback:** Recording completed, sends file to API
2. **S3 Upload:** `StorageService.uploadRecording()` with metadata
3. **Database Record:** Create `Recording` entry with storage key
4. **Event Emission:** `recording.ready` event for transcription pipeline

### 10.2 Service API

```typescript
class RecordingService {
  // Upload from FreeSWITCH callback
  uploadRecording(data: RecordingUploadData): Promise<{
    id: string;
    storageKey: string;
    size: bigint;
    checksum: string;
  }>;

  // Generate signed URL for playback
  getSignedUrl(recordingId: string, expiresIn?: number): Promise<string>;

  // Get streaming URL (24-hour expiry)
  getStreamUrl(recordingId: string): Promise<string>;

  // Backfill missing metadata
  backfillMetadata(recordingId: string): Promise<void>;
  backfillAllMetadata(limit?: number): Promise<number>;
}
```

### 10.3 Data Model

```typescript
interface RecordingUploadData {
  callId: string;
  legId?: string; // Multiple recordings per call (per leg)
  format?: string; // wav, mp3
  file: Buffer | Readable;
  duration?: number;
  metadata?: Record<string, unknown>;
}
```

---

## 11. STIR/SHAKEN Compliance

### Overview

Caller ID attestation tracking for regulatory compliance.

**Location:** `apps/api/src/services/stir-shaken-service.ts`

### 11.1 Attestation Levels

| Level    | Description                                          |
| -------- | ---------------------------------------------------- |
| **A**    | Full attestation - Carrier knows caller              |
| **B**    | Partial attestation - Customer relationship verified |
| **C**    | Gateway attestation - Minimal verification           |
| **NONE** | No attestation present                               |

### 11.2 Service API

```typescript
class StirShakenService {
  // Store attestation for a call
  storeAttestation(
    callId: string,
    tenantId: string,
    phoneNumber: string,
    attestation: 'A' | 'B' | 'C' | 'NONE',
    options?: {
      headers?: StirShakenHeaders;
      verifiedBy?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<string>;

  // Get attestation for a call
  getAttestation(callId: string): Promise<StirShakenAttestation | null>;

  // Admin override
  overrideAttestation(
    callId: string,
    attestation: 'A' | 'B' | 'C' | 'NONE',
    reason: string,
    userId: string
  ): Promise<void>;

  // Lookup by phone number
  getAttestationByPhoneNumber(
    tenantId: string,
    phoneNumber: string
  ): Promise<StirShakenAttestation | null>;
}
```

### 11.3 Headers Captured

```typescript
interface StirShakenHeaders {
  identity?: string; // Identity header
  origId?: string; // Originating Identity header
  passthru?: string; // Passport header
}
```

---

## 12. CNAM Lookup Service

### Overview

Caller Name (CNAM) lookup with caching and multi-provider support.

**Location:** `apps/api/src/services/cnam-service.ts`

### 12.1 Provider Architecture

```typescript
interface CnamProvider {
  name: string;
  lookup(phoneNumber: string): Promise<{
    callerName: string | null;
    metadata?: Record<string, unknown>;
  }>;
}
```

**Available Providers:**

| Provider | Status     | Notes                          |
| -------- | ---------- | ------------------------------ |
| `mock`   | ✅ Default | Area code-based fake names     |
| `twilio` | ✅ Ready   | Requires TWILIO_API_KEY/SECRET |

### 12.2 Caching

- **Storage:** PostgreSQL `CnamLookup` table
- **Default TTL:** 86400 seconds (24 hours)
- **Composite Key:** `tenantId + phoneNumber`

### 12.3 Service API

```typescript
class CnamService {
  lookup(
    tenantId: string,
    phoneNumber: string,
    options?: {
      provider?: string;
      useCache?: boolean;
      cacheTtl?: number;
    }
  ): Promise<CnamResult>;

  overrideCallerName(
    tenantId: string,
    phoneNumber: string,
    callerName: string | null,
    reason: string
  ): Promise<void>;
}
```

---

## 13. Geo-Routing Intelligence

### Overview

Maps caller phone numbers to geographic states for routing decisions.

**Location:** `apps/api/src/lib/geo.ts`

### 13.1 NANP Area Code Mapping

Complete US state mapping for 300+ area codes:

```typescript
const AREA_CODE_TO_STATE: Record<string, string> = {
  '212': 'NY',
  '213': 'CA',
  '214': 'TX',
  '305': 'FL',
  '310': 'CA',
  '312': 'IL',
  // ... 300+ more mappings
};
```

### 13.2 Utility Functions

```typescript
// Extract area code from phone number
extractAreaCode(phoneNumber: string): string | null;

// Get state from area code
getStateFromAreaCode(areaCode: string): string | null;

// Get state from phone number
getStateFromPhoneNumber(phoneNumber: string): string | null;

// Check if caller's state is accepted by buyer
isCallerStateAccepted(
  callerState: string | null | undefined,
  acceptedStates: string[]
): boolean;

// Validate US state code
isValidStateCode(stateCode: string): boolean;
```

### 13.3 Non-Geographic Codes

Toll-free and special area codes are excluded from state mapping:

```typescript
const NON_GEOGRAPHIC_CODES = new Set([
  '800',
  '833',
  '844',
  '855',
  '866',
  '877',
  '888', // Toll-free
  '900', // Premium rate
  '456',
  '500',
  '700', // Special services
]);
```

---

## 14. Flow Engine (Call Processing)

### Overview

Programmable call flow engine for IVR, routing, and compliance checks.

**Location:** `apps/api/src/services/flow-engine.ts`

### 14.1 Architecture

The Flow Engine executes `ExecutionPlan` documents (from `@hopwhistle/routing-dsl`) that define call handling logic.

```typescript
class FlowEngine {
  constructor(options: {
    callId: string;
    tenantId: string;
    plan: ExecutionPlan;
    initialVariables?: Record<string, unknown>;
  });

  // Start flow execution
  start(): Promise<void>;

  // Process telephony event
  processEvent(event: TelephonyEvent): Promise<void>;

  // Execute next node
  executeNext(event?: TelephonyEvent): Promise<void>;

  // Stop execution
  stop(): void;
}
```

### 14.2 Context Enrichment

Before routing decisions, the engine enriches context with:

- **STIR/SHAKEN:** Caller attestation level
- **CNAM:** Caller name lookup
- **Carrier Data:** Line type, prepaid status

```typescript
async enrichContextWithLookups(): Promise<void> {
  // STIR/SHAKEN lookup
  const stirShaken = await stirShakenService.getAttestation(this.callId);

  // CNAM lookup
  const cnam = await cnamService.lookup(tenantId, callerId);

  // Set context variables
  this.context.variables.stirShaken = stirShaken?.attestation;
  this.context.variables.callerName = cnam?.callerName;
}
```

### 14.3 Compliance Checks

The engine enforces compliance before buyer routing:

```typescript
async checkComplianceBeforeBuyerRoute(buyerParams: {
  buyerId?: string;
  destination?: string;
}): Promise<ComplianceCheckResult>;

async handleComplianceBlock(result: ComplianceCheckResult): Promise<void>;
```

---

## 15. API Endpoints Reference

### 15.1 Agent/Call Endpoints

| Method | Endpoint                          | Purpose                     |
| ------ | --------------------------------- | --------------------------- |
| POST   | `/api/v1/agent/call/originate`    | Initiate outbound call      |
| POST   | `/api/v1/agent/call/merge`        | Merge active and held calls |
| GET    | `/api/v1/calls`                   | List calls (with filters)   |
| GET    | `/api/v1/calls/:callId`           | Get call details            |
| GET    | `/api/v1/calls/:callId/recording` | Get recording URL           |

### 15.2 RTB Endpoints

| Method | Endpoint       | Purpose                     |
| ------ | -------------- | --------------------------- |
| POST   | `/api/v1/ping` | Submit lead for auction     |
| POST   | `/api/v1/post` | Convert winning bid to call |

### 15.3 Number Management

| Method | Endpoint              | Purpose                        |
| ------ | --------------------- | ------------------------------ |
| GET    | `/api/v1/numbers`     | List phone numbers             |
| POST   | `/api/v1/numbers`     | Purchase number                |
| PATCH  | `/api/v1/numbers/:id` | Update number (campaign, pool) |
| DELETE | `/api/v1/numbers/:id` | Release number                 |

### 15.4 Internal Endpoints

Protected by `x-internal-key` header or localhost access.

| Method | Endpoint                    | Purpose              |
| ------ | --------------------------- | -------------------- |
| POST   | `/internal/reclaim-numbers` | Trigger Reaper job   |
| GET    | `/internal/pool-stats`      | Get pool statistics  |
| GET    | `/internal/route/:e164`     | Debug routing lookup |

---

## 16. Environment Variables

### Core Telephony

```env
# FreeSWITCH
FREESWITCH_HOST=freeswitch
FREESWITCH_ESL_PORT=8021
FREESWITCH_ESL_PASSWORD=ClueCon

# Public IP (for SIP realm)
NEXT_PUBLIC_IP=45.32.213.201
```

### Carrier Credentials

```env
# SignalWire (Primary)
SIGNALWIRE_PROJECT_ID=your-project-id
SIGNALWIRE_API_TOKEN=PTxxxxxxx
SIGNALWIRE_SPACE_URL=your-space.signalwire.com

# Telnyx
TELNYX_API_KEY=your-api-key

# Bandwidth
BANDWIDTH_ACCOUNT_ID=your-account-id
BANDWIDTH_USERNAME=your-username
BANDWIDTH_PASSWORD=your-password
BANDWIDTH_SITE_ID=your-site-id

# Default Provider
DEFAULT_PROVIDER=signalwire
```

### RTB Engine

```env
JWT_SECRET=your-jwt-secret                # For bid tokens
PING_TOKEN_SECRET=your-ping-secret        # Fallback
INTERNAL_API_KEY=internal-reclaim-key     # Internal endpoints
```

### CNAM

```env
TWILIO_API_KEY=your-api-key
TWILIO_API_SECRET=your-api-secret
```

### Storage

```env
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
AWS_S3_BUCKET=hopwhistle-recordings
AWS_REGION=us-east-1
```

---

## 17. Port Assignments

| Port        | Protocol | Service        | Notes                 |
| ----------- | -------- | -------------- | --------------------- |
| 5060        | UDP/TCP  | SIP Signaling  | Standard SIP          |
| 5080        | UDP/TCP  | SIP Signaling  | Alternative           |
| 7443        | TCP/WSS  | FreeSWITCH WSS | **Production WebRTC** |
| 8021        | TCP      | ESL            | Internal only         |
| 8083        | TCP/WS   | FreeSWITCH WS  | Development only      |
| 16384-32768 | UDP      | RTP Media      | Dynamic range         |

### Port Selection Strategy

```
Production (HTTPS):  Browser → WSS:7443 → FreeSWITCH (Direct SSL)
Development (HTTP):  Browser → WS:8083  → FreeSWITCH (Plain WS)
```

> ⚠️ **Critical:** Port 7443 (native FreeSWITCH WSS) is required for production to match the `Via: SIP/2.0/WSS` header from SIP.js. Using Nginx proxy on 7444 causes transport mismatch errors.

---

## 18. Troubleshooting Guide

### 18.1 SIP Registration Failures

| Error            | Cause               | Fix                                  |
| ---------------- | ------------------- | ------------------------------------ |
| 408 Timeout      | Domain mismatch     | Use IP as realm, not hostname        |
| 403 Forbidden    | Invalid credentials | Verify extension exists (1000-1019)  |
| 401 Unauthorized | Wrong password      | Check `default_password` in vars.xml |

**Diagnostic Commands:**

```bash
# Check global domain
docker exec hopwhistle-freeswitch-dev fs_cli -x "global_getvar domain"

# Check default password
docker exec hopwhistle-freeswitch-dev fs_cli -x "global_getvar default_password"

# Enable SIP trace
docker exec hopwhistle-freeswitch-dev fs_cli -x "sofia profile internal siptrace on"

# Watch logs
docker logs -f hopwhistle-freeswitch-dev | grep -i "sip"
```

### 18.2 No Audio / One-Way Audio

1. **Check RTP ports:** Ensure UDP 16384-32768 is open
2. **NAT issues:** Verify `ext-sip-ip` in FreeSWITCH config
3. **Codec mismatch:** Check `sipClient` negotiated codecs

### 18.3 ESL Connection Failures

```bash
# Test ESL connectivity from API container
docker exec hopwhistle-api nc -vz freeswitch 8021

# Check ESL ACLs allow Docker bridge network
# /etc/freeswitch/autoload_configs/acl.conf.xml
```

### 18.4 WebSocket Error 1006

1. **SSL Certificate:** Verify `wss.pem` exists in FreeSWITCH
2. **Nginx conflict:** Remove duplicate `Sec-WebSocket-Protocol` headers
3. **Port mismatch:** Ensure client connects to 7443, not 8083

### 18.5 Pool Exhaustion ("No Capacity")

```bash
# Check pool stats
curl -H "x-internal-key: internal-reclaim-key" \
  http://localhost:3001/internal/pool-stats

# Manually trigger reaper
curl -X POST -H "x-internal-key: internal-reclaim-key" \
  http://localhost:3001/internal/reclaim-numbers
```

### 18.6 Deployment Cache Issues

Next.js bakes `NEXT_PUBLIC_*` variables at build time:

```bash
# Force clean rebuild
cd /opt/hopwhistle/infra/docker
docker compose build --no-cache web
docker compose up -d web

# Browser hard refresh
# Windows: Ctrl + Shift + R
# Mac: Cmd + Shift + R
```

---

## Appendix A: Database Models (Quick Reference)

```prisma
// Core models involved in telephony

model PhoneNumber {
  id, number, tenantId, campaignId, provider, status
  poolType, poolStatus, lastAssignedAt
  capabilities, metadata, purchasedAt
}

model Call {
  id, tenantId, callerId, calledNumber, direction
  status, startTime, answerTime, endTime, duration
  targetId, sourceId, recordingUrl
}

model Recording {
  id, callId, legId, url, storageKey
  format, size, checksum, duration, status
}

model PingRequest {
  id, publisherId, requestId, vertical, payload
  status, winningBidId, minBidAmount, expiresAt
  postedAt, assignedPhoneNumberId, callerNumber
}

model BuyerBid {
  id, pingRequestId, buyerEndpointId, buyerId
  amount, status, rejectionReason
}

model BuyerEndpoint {
  id, buyerId, destination, status, priority
  basePrice, pricingRules, acceptedStates
  hoursOfOperation, timezone, maxCap, capPeriod
}

model StirShakenStatus {
  id, callId, tenantId, phoneNumber, attestation
  identity, origId, passthru, verifiedAt, verifiedBy
  override, overrideReason, overrideUserId
}

model CnamLookup {
  id, tenantId, phoneNumber, callerName, provider
  cached, cachedUntil, metadata
}
```

---

## Appendix B: Service Dependencies

```
                    ┌─────────────────┐
                    │    FlowEngine   │
                    └────────┬────────┘
                             │
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
   │RoutingService│  │StirShakenSvc│   │  CnamService│
   └──────┬──────┘   └─────────────┘   └─────────────┘
          │
          ▼
   ┌─────────────┐
   │ AuctionSvc  │
   └──────┬──────┘
          │
          ▼
   ┌─────────────┐   ┌─────────────┐
   │NumberPoolSvc│──▶│   Redis     │
   └─────────────┘   └─────────────┘
          │
          ▼
   ┌─────────────┐
   │ Provisioning│
   │   Service   │
   └──────┬──────┘
          │
    ┌─────┼─────┐
    ▼     ▼     ▼
 ┌────┐┌────┐┌────┐
 │ SW ││Tel ││ BW │
 └────┘└────┘└────┘
```

---

_Document generated: January 31, 2026_  
_Platform Version: Hopwhistle v2.x_
