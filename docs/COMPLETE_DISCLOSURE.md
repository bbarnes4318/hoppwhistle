# Hopwhistle Platform - Complete Disclosure Document

> [!IMPORTANT]
> **LEGACY/STALE NOTE**: References to the Vultr server (IP `45.32.213.201`) in this document are obsolete. AWS (IP `3.214.60.13`) is the single source of truth for database and recordings, and Hetzner is the new target production environment. For active deployment and migration instructions, see [HETZNER_MIGRATION_FROM_AWS.md](file:///C:/Users/jimbo/.gemini/antigravity/worktrees/hopbot/edit-campaign-buyer-fix/HETZNER_MIGRATION_FROM_AWS.md).

> **Classification:** Full Disclosure for Sale/Due Diligence  
> **Date:** February 1, 2026  
> **Platform Version:** 0.1.1  
> **Production URL:** https://hopwhistle.com  
> **Server IP:** 45.32.213.201 (Vultr VPS - STALE/LEGACY ONLY)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Business Overview](#2-business-overview)
3. [Platform Architecture](#3-platform-architecture)
4. [Technology Stack](#4-technology-stack)
5. [Monorepo Structure](#5-monorepo-structure)
6. [Database Schema](#6-database-schema)
7. [Authentication & Authorization](#7-authentication--authorization)
8. [API Layer](#8-api-layer)
9. [Frontend Application](#9-frontend-application)
10. [Telephony & VoIP System](#10-telephony--voip-system)
11. [Carrier Provisioning](#11-carrier-provisioning)
12. [RTB Auction System](#12-rtb-auction-system)
13. [Campaign Management](#13-campaign-management)
14. [Buyer Management](#14-buyer-management)
15. [Publisher Management](#15-publisher-management)
16. [Call Center Portal](#16-call-center-portal)
17. [Billing & Financial Systems](#17-billing--financial-systems)
18. [Payroll Module](#18-payroll-module)
19. [Compliance & Security](#19-compliance--security)
20. [Design System](#20-design-system)
21. [Infrastructure & Deployment](#21-infrastructure--deployment)
22. [Environment Variables & Secrets](#22-environment-variables--secrets)
23. [Third-Party Integrations](#23-third-party-integrations)
24. [Feature Maturity Matrix](#24-feature-maturity-matrix)
25. [Known Gaps & Technical Debt](#25-known-gaps--technical-debt)
26. [Production Architecture Standards](#26-production-architecture-standards)
27. [Deployment Procedures](#27-deployment-procedures)
28. [Troubleshooting Guide](#28-troubleshooting-guide)

---

## 1. Executive Summary

**Hopwhistle** is a production-grade, multi-tenant call tracking and telephony platform designed for:

- **Performance Marketing**: Track, route, and monetize inbound/outbound calls
- **Insurance Lead Generation**: Final Expense sales with integrated quoting
- **Real-Time Bidding (RTB)**: Ping/Post lead distribution system
- **Call Center Operations**: Browser-based WebRTC dialer with sales scripting

### Core Capabilities

| Capability         | Description                                                               |
| ------------------ | ------------------------------------------------------------------------- |
| Multi-Tenancy      | Full tenant isolation with per-tenant quotas, budgets, and configurations |
| Concurrent Calls   | Configurable limits per tenant (default: 50)                              |
| Recording Storage  | S3-compatible with hot/warm/cold tiered lifecycle                         |
| Carriers Supported | Anveo Direct (Primary), SignalWire, Telnyx, Bandwidth, CLEC               |
| Protocols          | SIP/UDP, SIP/TLS, WebRTC (WSS), SRTP                                      |

### Key Metrics

- **Database**: ~60 Prisma models in PostgreSQL (`callfabric` database)
- **API Routes**: 25+ registered route modules
- **Services**: 40+ backend service files
- **Components**: 80+ React components
- **Active Carriers**: Anveo Direct (production default)

---

## 2. Business Overview

### Target Markets

1. **Insurance Industry**: Final Expense, Medicare Advantage, ACA Health leads
2. **Performance Marketing**: Pay-per-call networks and affiliate traffic
3. **Call Centers**: Outbound dialer operations with scripting tools
4. **Lead Aggregators**: RTB marketplace for call/lead distribution

### Revenue Model

1. **Per-Lead Fees**: Buyers pay per qualified lead/call
2. **Per-Minute Charges**: Usage-based telephony billing
3. **Subscription/Platform Fees**: Tenant access fees
4. **RTB Margins**: Spread between buyer bids and publisher payouts

### User Roles

| Role      | Description    | Access Level                           |
| --------- | -------------- | -------------------------------------- |
| OWNER     | Tenant owner   | Full access to all features            |
| ADMIN     | Administrator  | All except billing                     |
| ANALYST   | Reporting user | Read-only reports                      |
| PUBLISHER | Traffic source | Own campaigns, calls                   |
| BUYER     | Call buyer     | Own endpoints, calls (separate portal) |
| AGENT     | Dialer agent   | Call center script only                |
| READONLY  | Observer       | Read-only all                          |

---

## 3. Platform Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENTS                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│  Browser (Next.js)  │  SIP Phones  │  API Consumers  │  Publisher Webhooks  │
└─────────────┬───────┴──────┬───────┴────────┬────────┴──────────┬───────────┘
              │ HTTPS        │ WSS/SIP        │ HTTPS             │ HTTPS
              ▼              ▼                ▼                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           LOAD BALANCER / NGINX                              │
│  - SSL Termination (Let's Encrypt)                                          │
│  - Reverse proxy to API (3001) and Web (3000)                               │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        ▼                          ▼                          ▼
┌───────────────────┐  ┌───────────────────┐  ┌───────────────────────────┐
│   WEB (Next.js)   │  │   API (Fastify)   │  │   FreeSWITCH (Docker)     │
│   Port: 3000      │  │   Port: 3001      │  │   SIP: 5060/5080          │
│                   │  │                   │  │   WSS: 7443               │
│ - Dashboard       │  │ - REST Endpoints  │  │   Verto: 8082             │
│ - Call Center     │  │ - WebSocket       │  │   ESL: 8021               │
│ - Campaigns       │  │ - SSE Events      │  │                           │
│ - Buyers/Pubs     │  │ - Auth/RBAC       │  │ - Sofia SIP Stack         │
└─────────┬─────────┘  └─────────┬─────────┘  │ - Verto WebRTC            │
          │                      │             │ - mod_dialplan_xml        │
          └──────────┬───────────┘             └─────────────┬─────────────┘
                     │                                       │
                     ▼                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DATA LAYER                                      │
├───────────────────────────────┬─────────────────────────────────────────────┤
│  PostgreSQL (callfabric)      │  Redis                                      │
│  - Primary database           │  - Session/call state                       │
│  - Prisma ORM                 │  - Pub/Sub for real-time events             │
│  - 60+ tables                 │  - Rate limiting                            │
└───────────────────────────────┴─────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          EXTERNAL SERVICES                                   │
├───────────────────────────────┬─────────────────────────────────────────────┤
│  Carrier APIs                 │  Third-Party Integrations                   │
│  - Anveo Direct (Primary)     │  - Deepgram (Transcription)                 │
│  - SignalWire                 │  - DeepSeek (AI Analysis)                   │
│  - Telnyx                     │  - TrustedForm/Jornaya (Consent)            │
│  - Bandwidth                  │  - Google OAuth                             │
└───────────────────────────────┴─────────────────────────────────────────────┘
```

---

## 4. Technology Stack

### Backend

| Component       | Technology | Version |
| --------------- | ---------- | ------- |
| Runtime         | Node.js    | ≥18.0.0 |
| API Framework   | Fastify    | 4.x     |
| ORM             | Prisma     | 6.19.0  |
| Database        | PostgreSQL | 15      |
| Cache/Pub-Sub   | Redis      | 7       |
| Telephony       | FreeSWITCH | 1.10    |
| Package Manager | pnpm       | 8.15.0  |
| Language        | TypeScript | 5.3.x   |

### Frontend

| Component        | Technology          | Version           |
| ---------------- | ------------------- | ----------------- |
| Framework        | Next.js             | 14.x (App Router) |
| UI Components    | Radix UI            | Latest            |
| Styling          | Tailwind CSS        | 3.x               |
| State Management | React Context + SWR | -                 |
| SIP Client       | SIP.js              | 0.21.x            |
| Charts           | Recharts            | 2.x               |
| Command Palette  | cmdk                | Latest            |

### Infrastructure

| Component        | Technology                      |
| ---------------- | ------------------------------- |
| Containerization | Docker + Docker Compose         |
| Server           | Vultr VPS (Ubuntu)              |
| SSL              | Let's Encrypt (Certbot)         |
| Monitoring       | Prometheus + Grafana (optional) |
| CI/CD            | Manual deployment via SSH       |

---

## 5. Monorepo Structure

```
hopwhistle/
├── apps/
│   ├── api/                    # Fastify REST API (Port 3001)
│   │   ├── prisma/             # Database schema & migrations
│   │   │   ├── schema.prisma   # 60+ model definitions
│   │   │   └── migrations/     # Version-controlled schema changes
│   │   ├── src/
│   │   │   ├── cli/            # CLI tools (seed, migrate, etc.)
│   │   │   ├── lib/            # Shared libraries (logger, prisma, redis)
│   │   │   ├── middleware/     # Auth, RBAC, rate limiting, logging
│   │   │   ├── routes/         # API endpoint handlers (25+ files)
│   │   │   ├── services/       # Business logic layer (40+ services)
│   │   │   └── types/          # TypeScript type definitions
│   │   └── package.json
│   │
│   ├── web/                    # Next.js Frontend (Port 3000)
│   │   ├── src/
│   │   │   ├── app/            # Next.js App Router pages
│   │   │   │   ├── (dashboard)/ # Protected dashboard routes
│   │   │   │   ├── buyer/       # External Buyer Portal routes
│   │   │   │   ├── login/       # Authentication pages
│   │   │   │   └── legal/       # Legal/compliance pages
│   │   │   ├── components/     # React components (80+)
│   │   │   ├── hooks/          # Custom React hooks
│   │   │   └── lib/            # Client-side utilities
│   │   └── package.json
│   │
│   ├── freeswitch/             # FreeSWITCH configuration
│   │   ├── autoload_configs/   # Module configurations
│   │   ├── dialplan/           # Call routing rules
│   │   ├── sip_profiles/       # SIP gateway definitions
│   │   └── vars.xml            # Global variables
│   │
│   ├── worker/                 # Background job processor
│   ├── media/                  # Media server (placeholder)
│   ├── kamailio/               # SIP proxy (placeholder)
│   └── rtpengine/              # RTP relay (placeholder)
│
├── packages/
│   ├── routing-dsl/            # Flow DSL parser & executor
│   ├── sdk/                    # Client SDK
│   └── shared/                 # Shared utilities
│
├── infra/
│   ├── docker/                 # Docker Compose configurations
│   │   ├── docker-compose.yml  # Production compose
│   │   ├── docker-compose.dev.yml
│   │   └── .env                # Environment variables
│   ├── k8s/                    # Kubernetes manifests (future)
│   └── terraform/              # Infrastructure as code (future)
│
├── docs/                       # Documentation
├── tests/                      # E2E and performance tests
├── .agent/                     # Antigravity agent workflows
│   └── workflows/
│       └── deploy.md           # Deployment workflow
│
└── package.json                # Root monorepo config
```

---

## 6. Database Schema

### Overview

- **Database Name**: `callfabric` (PostgreSQL)
- **ORM**: Prisma 6.19.0
- **Connection String**: `postgresql://callfabric:callfabric_dev@hopwhistle-postgres-dev:5432/callfabric`

> [!IMPORTANT]
> Physical table names are lowercase (e.g., `users`, `roles`), but column names follow CamelCase (e.g., `createdAt`, `updatedAt`) and must be double-quoted in raw SQL.

### Schema Groups (~60 Models)

#### 1. Multi-Tenant Core

| Model          | Description                                                    |
| -------------- | -------------------------------------------------------------- |
| `Tenant`       | Root tenant entity with metadata, quotas, budgets              |
| `TenantQuota`  | Concurrent call limits, phone number limits                    |
| `TenantBudget` | Monthly budget tracking with alerts                            |
| `User`         | Platform users with OAuth support                              |
| `Role`         | RBAC roles (OWNER, ADMIN, ANALYST, PUBLISHER, BUYER, READONLY) |
| `UserRole`     | Many-to-many user-role assignments                             |
| `ApiKey`       | Tenant API keys with scopes and rate limits                    |

#### 2. Telephony Infrastructure

| Model          | Description                                         |
| -------------- | --------------------------------------------------- |
| `PhoneNumber`  | DIDs with carrier, pool status, campaign assignment |
| `Carrier`      | Carrier definitions (Anveo, SignalWire, etc.)       |
| `Trunk`        | SIP trunk configurations                            |
| `CallerIdPool` | Caller ID rotation pools                            |

#### 3. Campaign & Distribution

| Model              | Description                                           |
| ------------------ | ----------------------------------------------------- |
| `Campaign`         | Marketing campaigns with routing mode, offer, country |
| `Publisher`        | Traffic sources (affiliates) with 32-char hex code    |
| `Buyer`            | Call buyers with billing type (TERMS/UPFRONT)         |
| `BuyerEndpoint`    | Buyer targets with caps, geo-routing, hours           |
| `BuyerStats`       | Pre-aggregated buyer performance metrics              |
| `BuyerTransaction` | Lead credit/debit ledger (immutable)                  |

#### 4. Call Tracking

| Model             | Description                         |
| ----------------- | ----------------------------------- |
| `Call`            | Primary call record with 50+ fields |
| `CallLeg`         | Individual legs (inbound, outbound) |
| `Cdr`             | Carrier-level CDR data              |
| `Recording`       | Recording files with storage tier   |
| `Transcription`   | Speech-to-text output               |
| `Tag` / `CallTag` | Labeling and categorization         |

#### 5. Flow Routing

| Model         | Description                                  |
| ------------- | -------------------------------------------- |
| `Flow`        | Named flow container                         |
| `FlowVersion` | Versioned flow definitions                   |
| `Node`        | Flow nodes (IVR, QUEUE, BUYER_FORWARD, etc.) |
| `Edge`        | Connections between nodes with conditions    |

#### 6. Billing

| Model            | Description                          |
| ---------------- | ------------------------------------ |
| `BillingAccount` | Billing entity per tenant            |
| `RateCard`       | Rate structures with effective dates |
| `Invoice`        | Generated invoices                   |
| `InvoiceLine`    | Line items on invoices               |
| `AccrualLedger`  | Real-time revenue accrual            |
| `Payout`         | Publisher payouts                    |

#### 7. Compliance & Security

| Model              | Description                                  |
| ------------------ | -------------------------------------------- |
| `DncList`          | Do-Not-Call lists (GLOBAL, CAMPAIGN, CUSTOM) |
| `DncListEntry`     | Individual DNC numbers                       |
| `ConsentToken`     | TrustedForm/Jornaya consent tokens           |
| `CompliancePolicy` | Tenant compliance rules                      |
| `StirShakenStatus` | STIR/SHAKEN attestation per call             |
| `CnamLookup`       | Caller name lookups                          |
| `CarrierLookup`    | Phone carrier identification                 |

#### 8. CRM & Lead Management

| Model             | Description                          |
| ----------------- | ------------------------------------ |
| `Lead`            | Customer/lead records for screen pop |
| `LeadCall`        | Lead-to-call associations            |
| `RetentionPolicy` | Insurance policy retention tracking  |
| `RetentionNote`   | Notes on retention policies          |

#### 9. Payroll & Time Tracking

| Model            | Description                                 |
| ---------------- | ------------------------------------------- |
| `TimeEntry`      | Contractor work hours                       |
| `UserFinancials` | Encrypted banking information (AES-256-GCM) |
| `PayrollPayout`  | Finalized payouts                           |

#### 10. RTB Auction

| Model         | Description                                |
| ------------- | ------------------------------------------ |
| `PingRequest` | Incoming lead pings from publishers        |
| `BuyerBid`    | Bids generated per ping with signed tokens |

### Migration History

- **2025.11**: Initial schema established
- **2025.12**: `recording_analysis` - budgets, quotas, AI analysis
- **2026.01**: Enterprise Call Tracking - 35+ fields on `Call` model
- **2026.01**: Real-Time Buyer Billing - wallet-based billing, `BuyerTransaction` ledger
- **2026.01**: Campaign Model Expansion - `offerName`, `country`, `recordingEnabled`
- **2026.01**: Buyer Targets & Stats - `BuyerStats` summary table
- **2026.01**: Employee Payroll - `TimeEntry`, `UserFinancials`, `PayrollPayout`
- **2026.01**: RTB Ping/Post - Number pool management, `PingRequest` lifecycle

---

## 7. Authentication & Authorization

### Authentication Methods

| Method           | Implementation     | Details                                                 |
| ---------------- | ------------------ | ------------------------------------------------------- |
| **JWT**          | Primary            | httpOnly cookie, 24-hour expiry with refresh            |
| **API Key**      | Machine-to-machine | Header: `X-API-Key`, SHA-256 hashed, scoped permissions |
| **Google OAuth** | User login         | via `@fastify/oauth2`, automatic user provisioning      |

### Key Files

- **Identity Gateway**: `apps/api/src/routes/auth.ts`
- **Google Oracle**: `apps/api/src/services/google-auth.ts`
- **Login Page**: `apps/web/src/app/login/page.tsx`

### RBAC System

Real-Time Role-Based Access Control - roles are fetched from database on each request via `/api/auth/me`:

```typescript
// Middleware chain:
1. logger           // Request logging
2. rateLimit        // Rate limiting
3. csrf             // CSRF protection
4. auth             // JWT/API Key verification
5. rbac             // Permission check
6. handler          // Route handler
```

### Admin Priority Logic

- **`isBuyerOnly`**: User has ONLY the BUYER role
- **`hasFullAccess`**: User has OWNER, ADMIN, or internal roles
- Buyers are redirected to restricted views with filtered sidebar

---

## 8. API Layer

### Route Registration (apps/api/src/index.ts)

| Route Module               | Path Prefix           | Description                    |
| -------------------------- | --------------------- | ------------------------------ |
| `registerNumberRoutes`     | `/api/v1/numbers`     | Phone number management        |
| `registerCampaignRoutes`   | `/api/v1/campaigns`   | Campaign CRUD                  |
| `registerFlowRoutes`       | `/api/v1/flows`       | Flow routing configuration     |
| `registerPublisherRoutes`  | `/api/v1/publishers`  | Publisher management           |
| `registerCallRoutes`       | `/api/v1/calls`       | Call records & CDRs            |
| `registerRecordingRoutes`  | `/api/v1/recordings`  | Recording access               |
| `registerWebhookRoutes`    | `/api/v1/webhooks`    | Webhook configuration          |
| `registerUserRoutes`       | `/api/v1/users`       | User management                |
| `registerReportingRoutes`  | `/api/v1/reporting`   | Analytics & reports            |
| `registerBillingRoutes`    | `/api/v1/billing`     | Billing accounts               |
| `registerAuthRoutes`       | `/api/auth`           | Authentication (Non-versioned) |
| `registerBotRoutes`        | `/api/v1/bot`         | AI bot integration             |
| `registerQuotaRoutes`      | `/api/v1/quotas`      | Quota management               |
| `registerPayrollRoutes`    | `/api/v1/payroll`     | Time tracking & payroll        |
| `registerPingRoutes`       | `/api/v1/ping`        | RTB Ping endpoint              |
| `registerPostRoutes`       | `/api/v1/post`        | RTB Post endpoint              |
| `registerLeadInjectRoutes` | `/api/v1/leads`       | Lead injection (SSE)           |
| `registerAgentPhoneRoutes` | `/api/v1/agent-phone` | Agent dialer API               |
| `registerComplianceRoutes` | `/api/v1/compliance`  | DNC & consent                  |
| `registerRetentionRoutes`  | `/api/v1/retention`   | Policy retention               |

### Key Endpoints

#### Authentication

| Method | Endpoint            | Description          |
| ------ | ------------------- | -------------------- |
| POST   | `/api/auth/login`   | Email/password login |
| POST   | `/api/auth/google`  | Google OAuth login   |
| POST   | `/api/auth/logout`  | Session logout       |
| GET    | `/api/auth/me`      | Current user info    |
| POST   | `/api/auth/refresh` | Refresh JWT          |

#### Phone Numbers

| Method | Endpoint                 | Description              |
| ------ | ------------------------ | ------------------------ |
| GET    | `/api/v1/numbers`        | List phone numbers       |
| POST   | `/api/v1/numbers`        | Provision new number     |
| POST   | `/api/v1/numbers/search` | Search available numbers |
| DELETE | `/api/v1/numbers/:id`    | Release number           |

#### Campaigns

| Method | Endpoint                      | Description         |
| ------ | ----------------------------- | ------------------- |
| GET    | `/api/v1/campaigns`           | List campaigns      |
| POST   | `/api/v1/campaigns`           | Create campaign     |
| GET    | `/api/v1/campaigns/:id/stats` | Campaign statistics |

#### Buyers

| Method | Endpoint                       | Description          |
| ------ | ------------------------------ | -------------------- |
| GET    | `/api/v1/buyers`               | List buyers          |
| POST   | `/api/v1/buyers`               | Create buyer         |
| GET    | `/api/v1/buyers/:id/endpoints` | List buyer endpoints |
| POST   | `/api/v1/buyers/:id/credits`   | Add lead credits     |

#### RTB Ping/Post

| Method | Endpoint       | Description           |
| ------ | -------------- | --------------------- |
| POST   | `/api/v1/ping` | Submit ping request   |
| POST   | `/api/v1/post` | Submit POST (won bid) |

#### Agent Phone

| Method | Endpoint                        | Description         |
| ------ | ------------------------------- | ------------------- |
| POST   | `/api/v1/agent-phone/originate` | Start outbound call |
| POST   | `/api/v1/agent-phone/hangup`    | End call            |
| POST   | `/api/v1/agent-phone/transfer`  | Transfer call       |

#### Lead Injection (SSE)

| Method | Endpoint               | Description           |
| ------ | ---------------------- | --------------------- |
| GET    | `/api/v1/leads/stream` | SSE event stream      |
| POST   | `/api/v1/leads/inject` | Inject lead for agent |

---

## 9. Frontend Application

### Next.js App Router Structure

```
src/app/
├── (dashboard)/              # Protected routes (requires auth)
│   ├── layout.tsx            # Dashboard shell with sidebar
│   ├── dashboard/            # Main dashboard view
│   ├── calls/                # Call logs & details
│   ├── campaigns/            # Campaign management
│   ├── buyers/               # Buyer management
│   ├── publishers/           # Publisher management
│   ├── numbers/              # Phone number inventory
│   ├── flows/                # Visual flow editor
│   ├── call-center/          # Agent dialer portal
│   ├── payroll/              # Time tracking & payouts
│   ├── retention/            # Policy retention module
│   ├── billing/              # Billing dashboard
│   ├── bot/                  # AI fronter bot
│   ├── settings/             # Tenant settings
│   │   ├── general/
│   │   ├── users/
│   │   ├── api-keys/
│   │   └── webhooks/
│   └── tools/                # Recording analyzer
│
├── buyer/                    # External Buyer Portal (deprecated Feb 2026)
│   └── (redirects to unified dashboard with RBAC filtering)
│
├── login/                    # Authentication pages
│   └── page.tsx              # Google OAuth login
│
├── legal/                    # Legal pages
│   ├── privacy/
│   ├── terms/
│   └── ccpa/
│
├── layout.tsx                # Root layout
├── page.tsx                  # Landing/redirect
└── globals.css               # Global styles
```

### Key Components

| Component               | Location                   | Description                        |
| ----------------------- | -------------------------- | ---------------------------------- |
| `PhoneProvider`         | `/components/phone/`       | SIP.js WebRTC client context       |
| `IntegratedScriptPanel` | `/components/call-center/` | Sales scripting tool (1775+ lines) |
| `CallEventSubscriber`   | `/components/`             | Real-time call state via SSE       |
| `ServiceStatCards`      | `/components/dashboard/`   | KPI metric cards                   |
| `CallLogGrid`           | `/components/dashboard/`   | Call history DataGrid              |
| `FlowEditor`            | `/components/flows/`       | Visual DSL flow builder            |
| `BuyerTable`            | `/components/dashboard/`   | High-density buyer grid            |
| `ScheduleEditor`        | `/components/campaigns/`   | Split-shift operating hours        |
| `StateSelector`         | `/components/campaigns/`   | Geo-routing state picker           |
| `PricingRulesEditor`    | `/components/campaigns/`   | Dynamic bid adjustments            |

---

## 10. Telephony & VoIP System

### Core Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         INBOUND CALL FLOW                                │
└─────────────────────────────────────────────────────────────────────────┘

1. Carrier SIP INVITE → FreeSWITCH External Profile (5080)
2. ACL Check (anveo_direct list)
3. Public Dialplan → Transfer to default context
4. API Lookup (Campaign, Flow, Buyer routing)
5. Flow Engine Execution
6. Buyer Forward / IVR / Queue
7. Call Completion → CDR → Recording → Transcription
```

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        OUTBOUND CALL FLOW                                │
└─────────────────────────────────────────────────────────────────────────┘

1. Agent → WebRTC (SIP.js) → WSS (7443) → Verto → FreeSWITCH
2. API: POST /api/v1/agent-phone/originate
3. FreeSWITCH: Create A-leg to agent
4. FreeSWITCH: Create B-leg via Anveo gateway
5. Dialplan: Set STIR/SHAKEN header (P-Attestation-Indicator=A)
6. Bridge to Anveo gateway
7. Call Completion → CDR
```

### Port Assignments

| Port        | Protocol | Purpose                  |
| ----------- | -------- | ------------------------ |
| 5060        | UDP/TCP  | Internal SIP             |
| 5080        | UDP/TCP  | External SIP (carriers)  |
| 7443        | WSS      | Verto WebSocket (WebRTC) |
| 8021        | TCP      | Event Socket Layer (ESL) |
| 8082        | TCP      | Verto signaling          |
| 16384-32768 | UDP      | RTP media range          |

### FreeSWITCH Configuration Files

```
apps/freeswitch/
├── vars.xml                   # Global variables (external_sip_ip, codecs)
├── autoload_configs/
│   ├── acl.conf.xml           # Access control lists (Anveo IPs)
│   ├── sofia.conf.xml         # SIP UA configuration
│   ├── verto.conf.xml         # WebRTC configuration
│   └── event_socket.conf.xml  # ESL configuration
├── sip_profiles/
│   └── external/
│       ├── anveo.xml          # Anveo Direct gateway
│       ├── signalwire.xml     # SignalWire gateway
│       ├── telnyx.xml         # Telnyx gateway
│       └── wholesale.xml      # Generic SIP trunk
└── dialplan/
    ├── default/
    │   └── 01_anveo_outbound.xml  # US outbound via Anveo + STIR/SHAKEN
    └── public/
        └── anveo_inbound.xml      # Inbound from Anveo ACL
```

### WebRTC Client (SIP.js)

```typescript
// Configuration in PhoneProvider
{
  uri: 'sip:agent@hopwhistle.com',
  transportOptions: {
    server: 'wss://hopwhistle.com:7443'
  },
  authorizationUsername: 'agent',
  authorizationPassword: '<generated>',
  sessionDescriptionHandlerFactoryOptions: {
    peerConnectionConfiguration: {
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    }
  }
}
```

### ESL Connection

```typescript
{
  host: process.env.FREESWITCH_HOST || 'freeswitch',
  port: parseInt(process.env.FREESWITCH_ESL_PORT || '8021'),
  password: process.env.FREESWITCH_ESL_PASSWORD || 'ClueCon'
}
```

---

## 11. Carrier Provisioning

### Provider Priority Order

```typescript
const DEFAULT_PROVIDER_ORDER = ['anveo', 'signalwire', 'telnyx', 'bandwidth'];
```

### Anveo Direct (Primary Provider)

**Configuration:**

```
API Key: ANVEO_API_KEY=0b7603639cc8e908e8ff16e53f0470d4fc398ede
Endpoint: https://www.anveo.com/api/v1/...
```

**Gateway Configuration (anveo.xml):**

```xml
<include>
  <gateway name="anveo">
    <param name="proxy" value="sbc.anveo.com"/>
    <param name="register" value="false"/>  <!-- IP-based auth -->
    <param name="caller-id-in-from" value="true"/>
  </gateway>
</include>
```

**ACL (acl.conf.xml):**

```xml
<list name="anveo_direct" default="deny">
  <node type="allow" cidr="169.48.232.158/32"/>
  <node type="allow" cidr="204.216.109.55/32"/>
  <node type="allow" cidr="176.9.39.206/32"/>
  <node type="allow" cidr="72.9.149.25/32"/>
</list>
```

**DID Routing:** Numbers route to `SIP/{E164_NUMBER}@45.32.213.201:5080`

### Adapter Methods

- `listNumbers(options)` - Search available DIDs
- `purchaseNumber(request)` - Order DID
- `releaseNumber(providerId)` - Release DID
- `getNumber(providerId)` - Get DID details
- `configureNumber(providerId, features)` - Set DID routing

### Other Carriers

| Carrier    | Environment Variables                                                                   |
| ---------- | --------------------------------------------------------------------------------------- |
| SignalWire | `SIGNALWIRE_PROJECT_ID`, `SIGNALWIRE_API_TOKEN`, `SIGNALWIRE_SPACE`                     |
| Telnyx     | `TELNYX_API_KEY`                                                                        |
| Bandwidth  | `BANDWIDTH_ACCOUNT_ID`, `BANDWIDTH_USERNAME`, `BANDWIDTH_PASSWORD`, `BANDWIDTH_SITE_ID` |

---

## 12. RTB Auction System

### Ping/Post Flow

```
Publisher                     Platform                      Buyers
    │                            │                            │
    │  POST /api/v1/ping         │                            │
    │  {zip, state, age, ...}    │                            │
    │ ─────────────────────────▶ │                            │
    │                            │  Filter eligible endpoints │
    │                            │  ─────────────────────────▶│
    │                            │                            │
    │                            │  Generate bids             │
    │                            │ ◀─────────────────────────│
    │                            │                            │
    │  {bid_id, price, ttl}      │                            │
    │ ◀───────────────────────── │                            │
    │                            │                            │
    │  POST /api/v1/post         │                            │
    │  {bid_id, caller_phone}    │                            │
    │ ─────────────────────────▶ │                            │
    │                            │  Assign pool number        │
    │  {tracking_number}         │  Create PingRequest        │
    │ ◀───────────────────────── │                            │
    │                            │                            │
    └────────────────────────────┼────────────────────────────┘
                                 │
                         Caller dials tracking_number
                                 │
                         FreeSWITCH routes to
                         winning buyer endpoint
```

### Buyer Filtering Criteria

1. **Status Check**: Endpoint must be ACTIVE
2. **Geo-Routing**: `acceptedStates` array match (empty = national)
3. **Operating Hours**: `hoursOfOperation` schedule check (split-shift support)
4. **Cap Check**: `capConsumedToday < maxCap`
5. **Concurrency**: Active calls < `maxConcurrency`
6. **Wallet Balance**: For UPFRONT billing, `leadsRemaining > 0`

### Bid Calculation

```typescript
basePrice + sum(pricingRules where condition matches)
```

**Example Pricing Rules:**

```json
[
  { "field": "age", "op": "gt", "val": 65, "adjustment": "5.00" },
  { "field": "state", "op": "in", "val": ["CA", "NY"], "adjustment": "2.50" }
]
```

### Number Pool System

- **Pool Types**: RTB, STATIC
- **Pool Status**: AVAILABLE, LEASED, EXPIRED
- **Reaper Job**: Automated reclamation of expired leases
- **Redis Routing**: Sub-100ms lookups for incoming calls

---

## 13. Campaign Management

### Core Concept

Campaigns connect **Publishers** (traffic sources) to **Buyers** (destinations) using **Flows** (IVR/Routing logic).

### Status States

| Status | Color  | Description                          |
| ------ | ------ | ------------------------------------ |
| Live   | Green  | Active and accepting calls           |
| Paused | Orange | Temporarily suspended                |
| Setup  | Gray   | Preliminary state (no numbers/flows) |

### Data Model Fields

| Field              | Type    | Description                 |
| ------------------ | ------- | --------------------------- |
| `name`             | String  | Campaign name               |
| `publisherId`      | String  | Associated publisher        |
| `flowId`           | String  | Routing flow                |
| `offerName`        | String  | First-class reporting field |
| `country`          | String  | Geographic targeting        |
| `recordingEnabled` | Boolean | Call recording toggle       |
| `status`           | Enum    | LIVE, PAUSED, SETUP         |

### Features

- **High-Density Grid**: Ringba-inspired 11-column table
- **3-Step Wizard**: Campaign creation flow
- **Real-Time Stats**: `/api/v1/campaigns/stats` endpoint
- **Rapid Replication**: Deep clone with " - Copy" suffix
- **Advanced Controls**: `ScheduleEditor`, `StateSelector` integration

---

## 14. Buyer Management

### Buyer Model

| Field                   | Type    | Description                         |
| ----------------------- | ------- | ----------------------------------- |
| `name`                  | String  | Company name                        |
| `subId`                 | String  | External sub-identifier             |
| `billingType`           | Enum    | TERMS (post-pay), UPFRONT (pre-pay) |
| `leadsRemaining`        | Int     | Pre-paid lead balance               |
| `billableDuration`      | Int     | Seconds threshold for billing       |
| `canPauseTargets`       | Boolean | Self-service cap control            |
| `canSetCaps`            | Boolean | Self-service cap configuration      |
| `canDisputeConversions` | Boolean | Dispute permission                  |

### Buyer Endpoint (Target)

| Field              | Type     | Description                            |
| ------------------ | -------- | -------------------------------------- |
| `name`             | String   | Target name (e.g., "Call Center A")    |
| `type`             | Enum     | SIP, PSTN, WEBRTC                      |
| `destination`      | String   | SIP URI or phone number                |
| `maxCap`           | Int      | Calls per period                       |
| `capPeriod`        | Enum     | HOUR, DAY, MONTH                       |
| `maxConcurrency`   | Int      | Simultaneous calls                     |
| `acceptedStates`   | String[] | Geo filter                             |
| `hoursOfOperation` | JSON     | Schedule per day (split-shift support) |
| `basePrice`        | Decimal  | Static bid price                       |
| `pricingRules`     | JSON     | Dynamic adjustments                    |

### Architecture

- **Contextual Management**: Targets managed as child view of Buyer
- **Pre-Aggregated Stats**: `BuyerStats` table (Aggregate on Write)
- **Real-Time Status**: `buyer-live-status-service.ts` for concurrency
- **Immutable Ledger**: `BuyerTransaction` for financial audit trail

---

## 15. Publisher Management

### Publisher Model

| Field                | Type    | Description                           |
| -------------------- | ------- | ------------------------------------- |
| `name`               | String  | Publisher name                        |
| `code`               | String  | 32-char hex identifier (Ringba-style) |
| `email`              | String  | Contact email (unique, nullable)      |
| `accessToRecordings` | Boolean | Recording access permission           |
| `status`             | Enum    | ACTIVE, INACTIVE                      |

### Status Indicators

- **Active**: Green dot - traffic accepted
- **Paused**: Orange dot - traffic restricted

### Lifecycle

1. **Provisioning**: Admin creates with Name/Email, code auto-generated
2. **Onboarding**: Welcome email notification
3. **Monitoring**: Real-time performance tables at `/publishers`
4. **Maintenance**: CRUD operations via modals

---

## 16. Call Center Portal

### Overview

Browser-based agent dialer at `/call-center` with:

- **Integrated Dialer**: WebRTC calling via SIP.js
- **Screen Pop**: Lead data display on call connect
- **Sales Script**: Step-by-step guided selling (60+ nodes)
- **Quote Calculator**: Final Expense insurance integration
- **SSE Lead Injection**: Real-time lead push to agents

### Components

| Component               | Purpose                                           |
| ----------------------- | ------------------------------------------------- |
| `AgentDialer`           | Main dialer interface                             |
| `IntegratedScriptPanel` | Sales script with quote integration (1775+ lines) |
| `PhoneProvider`         | SIP.js context wrapper                            |
| `CallEventSubscriber`   | SSE event listener                                |
| `LeadDisplay`           | Screen pop information                            |
| `RetentionScriptPanel`  | Policy retention scripting                        |

### Script Modes

1. **Final Expense Sales** (default) - Insurance sales flow
2. **Retention** - Policy follow-up flow

Admins can toggle between scripts via dropdown selector.

### Quote Engine

- Age-based premium calculation
- Coverage amount selection ($5K - $50K)
- Multi-carrier comparison
- Real-time premium display

### Current Status (Feb 2026)

- **Phase 1-6**: COMPLETE
- **Status**: PRODUCTION STABILIZED
- **Key Features**:
  - Ref-based session tracking
  - Quote engine inline data entry
  - SSE lead injection
  - Dynamic script node rendering
  - Stateful script selection
  - **Screen Pop** (Feb 2, 2026) - Customer data display on inbound calls

---

## 16.5. Screen Pop Feature

### Overview

**Screen Pop** displays customer/prospect information to agents when an inbound call arrives. This allows agents to see caller context before answering, enabling personalized greetings and informed conversations.

**Implementation Date**: February 2, 2026

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           INBOUND CALL FLOW                                  │
└─────────────────────────────────────────────────────────────────────────────┘

1. SIP INVITE arrives at FreeSWITCH
2. API receives call event with caller number
3. API looks up prospect/lead data by phone number
4. Prospect data attached to call event payload
5. WebSocket pushes event to agent's browser
6. PhoneProvider receives event → sets currentCall with prospectData
7. ScreenPop component renders customer information
```

### Key Components

| Component           | File                                        | Purpose                                                   |
| ------------------- | ------------------------------------------- | --------------------------------------------------------- |
| `PhoneProvider`     | `/components/phone/phone-provider.tsx`      | Context managing call state, includes `ProspectData` type |
| `ScreenPop`         | `/components/phone/screen-pop.tsx`          | Renders prospect information panel                        |
| `ScreenPopSettings` | `/components/phone/screen-pop-settings.tsx` | Admin configuration for displayed fields                  |
| `IncomingCallModal` | `/components/phone/incoming-call-modal.tsx` | Full-screen modal with Screen Pop on ring                 |
| `AgentPhonePanel`   | `/components/phone/agent-phone-panel.tsx`   | In-call panel shows Screen Pop data                       |

### ProspectData Type

```typescript
export interface ProspectData {
  id?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  phoneNumber?: string;
  email?: string;
  company?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  leadSource?: string;
  campaignName?: string;
  customFields?: Record<string, string | number | boolean>;
  notes?: string;
  [key: string]: unknown;
}
```

### Configurable Fields

| Field        | Default Enabled | Icon      |
| ------------ | --------------- | --------- |
| Full Name    | ✅ Yes          | User      |
| Phone Number | ✅ Yes          | Phone     |
| Email        | ✅ Yes          | Mail      |
| Company      | ✅ Yes          | Building2 |
| Address      | ❌ No           | MapPin    |
| City         | ❌ No           | MapPin    |
| State        | ❌ No           | MapPin    |
| Zip Code     | ❌ No           | MapPin    |
| Lead Source  | ✅ Yes          | Tag       |
| Campaign     | ✅ Yes          | Tag       |
| Notes        | ❌ No           | FileText  |

### User Configuration

Agents/Admins can customize Screen Pop fields via **Settings** in the Agent Phone Panel:

- Toggle fields on/off
- Drag-and-drop to reorder
- Settings persisted to `localStorage`

### Display Modes

| Mode    | Context               | Max Visible Fields |
| ------- | --------------------- | ------------------ |
| `modal` | Incoming call ringing | 5 (expandable)     |
| `panel` | Active call sidebar   | 3 (expandable)     |

### Integration Points

1. **Call Event Enrichment**: API attaches `prospectData` or `screenPopData` to WebSocket events
2. **Lead Injection (SSE)**: `/api/v1/leads/stream` pushes prospect data to agents
3. **CRM Lookup**: Backend queries `Lead` table by caller phone number

### Data Flow

```typescript
// WebSocket event structure
{
  type: 'event',
  channel: 'agent.call.incoming',
  payload: {
    callId: 'call_123',
    callerNumber: '+14155551234',
    callerName: 'John Smith',
    prospectData: {
      fullName: 'John Smith',
      email: 'john@example.com',
      company: 'Acme Corp',
      leadSource: 'Google Ads',
      campaignName: 'Q1 Final Expense'
    }
  }
}
```

### Key Files

| File                      | Lines | Purpose                                       |
| ------------------------- | ----- | --------------------------------------------- |
| `phone-provider.tsx`      | 776   | Full SIP.js integration with Screen Pop types |
| `screen-pop.tsx`          | 220   | Screen Pop display component                  |
| `screen-pop-settings.tsx` | ~200  | Drag-and-drop field configuration             |
| `incoming-call-modal.tsx` | ~150  | Ring modal with embedded Screen Pop           |

---

## 17. Billing & Financial Systems

### Buyer Billing Types

| Type        | Description                           |
| ----------- | ------------------------------------- |
| **TERMS**   | Post-pay: Invoiced at end of period   |
| **UPFRONT** | Pre-pay: Credits purchased in advance |

### Transaction Ledger

```typescript
// Credit transaction (admin adds leads)
{
  type: 'CREDIT',
  amount: 100,
  description: 'Purchased 100 leads'
}

// Debit transaction (call completed)
{
  type: 'DEBIT',
  amount: -1,
  description: 'Call ID #abc123',
  callId: 'abc123'
}
```

### Accrual Ledger Types

| Type                   | Description            |
| ---------------------- | ---------------------- |
| `CALL_MINUTE_INBOUND`  | Inbound call charges   |
| `CALL_MINUTE_OUTBOUND` | Outbound call charges  |
| `CONNECTION_FEE`       | Per-connection fees    |
| `RECORDING_FEE`        | Recording storage fees |
| `CPA_CONVERSION`       | Conversion bonuses     |

### Key Services

- `buyerBillingService` - Lead credit/debit management
- `buyerBillingEvents` - Billing event emission
- `buyerStatsService` - Stats aggregation
- `buyerLiveStatusService` - Real-time cap tracking
- `budgetAlertService` - Budget threshold alerts
- `quotaService` - Tenant quota enforcement

---

## 18. Payroll Module

### Functional Requirements

#### For Standard Users (Employees)

- **Time Logging**: Manually log hours worked for specific dates
- **Compensation View**: Real-time calculation (Hours × Pay Rate)
- **Banking Info**: Securely manage bank details (encrypted)
- **History**: View personal log history and payout status

#### For Administrators

- **Rate Management**: Set/update hourly pay rates
- **Payroll Reporting**: Global dashboard of hours worked
- **Liability Tracking**: Calculate total payout liability
- **Security Control**: Restrict access to financial data

### Data Models

| Model            | Description                                      |
| ---------------- | ------------------------------------------------ |
| `TimeEntry`      | Contractor work hours (multiple per day allowed) |
| `UserFinancials` | Encrypted banking info (AES-256-GCM)             |
| `PayrollPayout`  | Finalized payment records (immutable)            |

### Constraints

- **Multi-Shift Support**: Multiple entries per day
- **Entry Locking**: Immutable once linked to payout
- **Post-Validation**: Payout requires non-zero rate + complete banking info

### Status (Feb 2026)

**Fully Operational** - Commit `3dc9f3d` verified in production

---

## 19. Compliance & Security

### DNC (Do Not Call) Management

| List Type | Description       |
| --------- | ----------------- |
| GLOBAL    | Platform-wide DNC |
| CAMPAIGN  | Campaign-specific |
| CUSTOM    | Tenant-defined    |

### Consent Token Verification

| Provider    | Description                |
| ----------- | -------------------------- |
| TrustedForm | Certificate URL validation |
| Jornaya     | LeadID tokens              |

### STIR/SHAKEN Attestation

| Level | Description                          |
| ----- | ------------------------------------ |
| A     | Full attestation (authorized caller) |
| B     | Partial attestation (known customer) |
| C     | Gateway attestation (passed through) |
| NONE  | No attestation                       |

### Security Measures

1. **JWT Tokens**: httpOnly cookies, 24h expiry
2. **API Keys**: SHA-256 hashed, scoped permissions
3. **Rate Limiting**: Per IP and per API key
4. **CSRF Protection**: Double-submit cookie pattern
5. **Encrypted Secrets**: Banking data uses AES-256-GCM
6. **Audit Logging**: All mutations logged

---

## 20. Design System

### Project Cortex (V2) - Active

**Identity**: "Neuro-Luminescent Command Grid"

| Element            | Value                      |
| ------------------ | -------------------------- |
| Primary Background | Void Charcoal (#0a0a0a)    |
| Accent Color       | Electric Cyan (#00d4ff)    |
| Typography         | Inter, system-ui           |
| Layout             | High-density vertical rail |

### Key Primitives

- **Neural Orb**: Animated status indicators
- **Neon Stream**: Data flow visualizations
- **Cockpit Mode**: Full-viewport agent interface
- **Toast System**: Radix-based async notifications

### UI Component Library

- **Radix UI**: Accessible component primitives
- **cmdk**: Command palette functionality
- **Recharts**: Data visualization

### Legacy V1 (Deprecated)

- Indigo & Teal color scheme
- Ringba-hybrid structure

---

## 21. Infrastructure & Deployment

### Production Server

| Setting      | Value                    |
| ------------ | ------------------------ |
| Provider     | Vultr VPS                |
| IP Address   | 45.32.213.201            |
| SSH Access   | `ssh root@45.32.213.201` |
| Project Path | `/opt/hopwhistle`        |
| Domain       | hopwhistle.com           |

### Docker Containers

| Container                   | Image                 | Ports                  |
| --------------------------- | --------------------- | ---------------------- |
| `docker-api-1`              | docker-api:latest     | 3001                   |
| `hopwhistle-web-1`          | hopwhistle-web:latest | 3000                   |
| `hopwhistle-postgres-dev`   | postgres:15           | 5432                   |
| `hopwhistle-redis-1`        | redis:7               | 6379                   |
| `hopwhistle-freeswitch-dev` | freeswitch:1.10       | 5060, 5080, 7443, 8021 |

### Network Architecture

All containers share `docker_default` network with aliases:

- `postgres` → `hopwhistle-postgres-dev`
- `redis` → `hopwhistle-redis-1`
- `freeswitch` → `hopwhistle-freeswitch-dev`

---

## 22. Environment Variables & Secrets

### Core Configuration

| Variable          | Description           | Example                                                                          |
| ----------------- | --------------------- | -------------------------------------------------------------------------------- |
| `DATABASE_URL`    | PostgreSQL connection | `postgresql://callfabric:callfabric_dev@hopwhistle-postgres-dev:5432/callfabric` |
| `REDIS_URL`       | Redis connection      | `redis://hopwhistle-redis-1:6379`                                                |
| `API_BASE_URL`    | API base URL          | `http://api:3001`                                                                |
| `API_ADMIN_TOKEN` | Admin auth token      | `PTe87f4727416...`                                                               |

### FreeSWITCH

| Variable                  | Description      | Default          |
| ------------------------- | ---------------- | ---------------- |
| `FREESWITCH_HOST`         | ESL host         | `freeswitch`     |
| `FREESWITCH_ESL_PORT`     | ESL port         | `8021`           |
| `FREESWITCH_ESL_PASSWORD` | ESL password     | `ClueCon`        |
| `PUBLIC_IP`               | Server public IP | `45.32.213.201`  |
| `MEDIA_DOMAIN`            | Media domain     | `hopwhistle.com` |

### Carrier APIs

| Variable                | Description          |
| ----------------------- | -------------------- |
| `ANVEO_API_KEY`         | Anveo Direct API key |
| `SIGNALWIRE_PROJECT_ID` | SignalWire project   |
| `SIGNALWIRE_API_TOKEN`  | SignalWire token     |
| `TELNYX_API_KEY`        | Telnyx API key       |
| `BANDWIDTH_ACCOUNT_ID`  | Bandwidth account    |

### Third-Party Services

| Variable               | Description    |
| ---------------------- | -------------- |
| `DEEPGRAM_API_KEY`     | Speech-to-text |
| `DEEPSEEK_API_KEY`     | AI analysis    |
| `GOOGLE_CLIENT_ID`     | OAuth client   |
| `GOOGLE_CLIENT_SECRET` | OAuth secret   |

---

## 23. Third-Party Integrations

| Service           | Purpose              | Status     |
| ----------------- | -------------------- | ---------- |
| **Anveo Direct**  | Primary SIP carrier  | Production |
| **SignalWire**    | Backup carrier       | Configured |
| **Telnyx**        | Backup carrier       | Configured |
| **Bandwidth**     | Backup carrier       | Configured |
| **Deepgram**      | Call transcription   | Production |
| **DeepSeek**      | AI call analysis     | Production |
| **TrustedForm**   | Consent verification | Production |
| **Jornaya**       | LeadID verification  | Production |
| **Google OAuth**  | User authentication  | Production |
| **Let's Encrypt** | SSL certificates     | Production |

---

## 24. Feature Maturity Matrix

| Feature               | Status      | Notes                                    |
| --------------------- | ----------- | ---------------------------------------- |
| IVR Builder           | Matured     | Backend `flow-engine.ts`                 |
| Simultaneous Ring     | **Missing** | Single "Best Buyer" only                 |
| Round Robin           | Implemented | `round-robin`, `weighted`, `least-calls` |
| Skill/Geo Routing     | Implemented | NANP mapping, `acceptedStates`           |
| Capping & Concurrency | Implemented | Real-time tracking                       |
| Dynamic RTB Bidding   | Implemented | `AuctionService`                         |
| Ping/Post API         | Implemented | Redis idempotency                        |
| Number Pool/Cloaking  | Implemented | Reaper job                               |
| DNI JS Snippet        | **Missing** | No generator                             |
| Session Stitching     | Rudimentary | Fields exist, logic missing              |
| Ledger System         | Implemented | `AccrualLedger`                          |
| Wallet/Credit Mgmt    | Implemented | `BuyerTransaction`                       |
| Invoicing Module      | Partial     | Models exist, no automation              |
| TCPA/DNC Scrubbing    | Matured     | Full `DncList` model                     |
| Recording Redaction   | Partial     | No PII masking                           |
| TrustedForm/Jornaya   | Implemented | `ConsentToken` model                     |

---

## 25. Known Gaps & Technical Debt

### Critical Gaps

1. **Simultaneous Ring Logic**: Update `RoutingService` to ring multiple targets
2. **DNI Script Generator**: JavaScript snippet for dynamic number swapping
3. **Recording Redaction**: Add PII masking to transcription analytics
4. **Session Stitching**: Web session ID to call association

### Technical Debt

1. **Lead Injection Storage**: Currently in-memory, needs Redis/DB persistence
2. **Invoice Automation**: Manual generation, needs scheduled jobs
3. **Kubernetes Migration**: Placeholder directories only
4. **SIP Proxy (Kamailio)**: Placeholder, not implemented
5. **RTP Engine**: Placeholder, not implemented
6. **ClickHouse Analytics**: Optional, not fully integrated

---

## 26. Production Architecture Standards

### The Six Core Rules

#### 1. Separation of State & Config

Never mix volatile data into configuration tables. Use Redis or separate `TelemetryState` tables.

#### 2. Aggregate on Write

Never run `SUM()` or `COUNT()` on transaction tables. Use summary tables (`BuyerStats`).

#### 3. Async UI

Never block UI loading for analytics. Use skeleton loaders and parallel fetches.

#### 4. Strict Type & Async Safety

All code must pass ESLint. Use `void` for fire-and-forget async. Wrap functions in `useCallback`.

#### 5. Standardized Repository Hygiene

Conventional commits, pre-commit hooks, immediate pushes to main.

#### 6. Real-Time Authority

Authorization driven by live backend roles, not mutable local state.

---

## 27. Deployment Procedures

### Quick Commands

```bash
# SSH and pull
ssh root@45.32.213.201
cd /opt/hopwhistle && git pull origin main

# Rebuild API
cd infra/docker
docker stop docker-api-1; docker rm docker-api-1
docker compose build api --no-cache
docker compose up -d api --no-deps

# Fix networks
docker network connect docker_default hopwhistle-postgres-dev
docker network connect --alias redis docker_default hopwhistle-redis-1
docker restart docker-api-1

# Apply schema
docker exec -it docker-api-1 npx prisma db push --accept-data-loss

# Reload FreeSWITCH
docker exec hopwhistle-freeswitch-dev fs_cli -x 'reloadxml'
```

### Critical Rules

1. **Mandatory `--no-cache`**: Docker caching causes staleness
2. **Server-Side Prisma**: DB port not globally exposed
3. **Network Grafting**: Re-bridge containers after recreation

---

## 28. Troubleshooting Guide

### Common Issues

| Issue                               | Solution                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `ENOTFOUND redis`                   | `docker network connect --alias redis docker_default hopwhistle-redis-1` |
| `ENOTFOUND hopwhistle-postgres-dev` | `docker network connect docker_default hopwhistle-postgres-dev`          |
| Port 3001 Already Allocated         | `docker stop $(docker ps -q --filter "publish=3001")`                    |
| Column Does Not Exist               | `docker exec -it docker-api-1 npx prisma db push --accept-data-loss`     |
| FreeSWITCH Gateway Invalid          | `docker exec hopwhistle-freeswitch-dev fs_cli -x 'reloadxml'`            |

### Health Checks

```bash
# API health
curl -s http://localhost:3001/health

# FreeSWITCH status
docker exec hopwhistle-freeswitch-dev fs_cli -x 'status'

# PostgreSQL
docker exec hopwhistle-postgres-dev pg_isready

# Redis
docker exec hopwhistle-redis-1 redis-cli ping
```

### Log Locations

| Log             | Command                                                                    |
| --------------- | -------------------------------------------------------------------------- |
| API logs        | `docker logs docker-api-1`                                                 |
| Web logs        | `docker logs hopwhistle-web-1`                                             |
| FreeSWITCH logs | `docker exec hopwhistle-freeswitch-dev fs_cli -x 'console loglevel debug'` |
| PostgreSQL logs | `docker logs hopwhistle-postgres-dev`                                      |

---

## Document Certification

This document represents a complete and accurate disclosure of all systems, components, configurations, and technical details of the Hopwhistle platform as of February 1, 2026.

**Document Generated:** February 1, 2026  
**Platform Version:** 0.1.1  
**Last Production Deployment:** February 1, 2026 (Commit `5707d3b`)

---

_End of Complete Disclosure Document_
