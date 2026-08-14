# Hopwhistle Platform - Comprehensive Technical Reference

> [!IMPORTANT]
> **LEGACY/STALE NOTE**: References to the Vultr server (IP `45.32.213.201`) in this document are obsolete. AWS (IP `3.214.60.13`) is the single source of truth for database and recordings, and Hetzner is the new target production environment. For active deployment and migration instructions, see [HETZNER_MIGRATION_FROM_AWS.md](file:///C:/Users/jimbo/.gemini/antigravity/worktrees/hopbot/edit-campaign-buyer-fix/HETZNER_MIGRATION_FROM_AWS.md).

> **Last Updated:** January 31, 2026  
> **Platform Version:** 0.1.0  
> **Production Server:** 45.32.213.201 (Vultr - STALE/LEGACY ONLY)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Platform Architecture](#2-platform-architecture)
3. [Technology Stack](#3-technology-stack)
4. [Monorepo Structure](#4-monorepo-structure)
5. [API Application (apps/api)](#5-api-application-appsapi)
6. [Web Application (apps/web)](#6-web-application-appsweb)
7. [FreeSWITCH Telephony (apps/freeswitch)](#7-freeswitch-telephony-appsfreeswitch)
8. [Database Schema](#8-database-schema)
9. [Services Layer](#9-services-layer)
10. [API Routes & Endpoints](#10-api-routes--endpoints)
11. [Authentication & Authorization](#11-authentication--authorization)
12. [Telephony & VoIP System](#12-telephony--voip-system)
13. [Carrier Provisioning](#13-carrier-provisioning)
14. [RTB Auction System](#14-rtb-auction-system)
15. [Call Center Portal](#15-call-center-portal)
16. [Buyer/Publisher Management](#16-buyerpublisher-management)
17. [Billing & Financial Systems](#17-billing--financial-systems)
18. [Compliance & Security](#18-compliance--security)
19. [Infrastructure & Deployment](#19-infrastructure--deployment)
20. [Environment Variables](#20-environment-variables)
21. [Troubleshooting Guide](#21-troubleshooting-guide)

---

## 1. Executive Summary

**Hopwhistle** is a production-grade, multi-tenant call tracking and telephony platform designed for performance marketing, insurance lead generation, and real-time bidding (RTB) call distribution. The platform combines:

- **Inbound/Outbound Call Tracking** with comprehensive CDR and analytics
- **Real-Time Bidding (RTB)** for lead monetization via Ping/Post system
- **Multi-Carrier Provisioning** (Anveo Direct, SignalWire, Telnyx, Bandwidth)
- **WebRTC Browser-Based Dialing** for call center agents
- **Insurance Quoting Engine** for Final Expense sales
- **STIR/SHAKEN Compliance** with attestation header injection
- **Flow-Based Call Routing** with visual DSL editor

### Key Metrics & Capabilities

| Capability             | Description                                                               |
| ---------------------- | ------------------------------------------------------------------------- |
| **Multi-Tenancy**      | Full tenant isolation with per-tenant quotas, budgets, and configurations |
| **Concurrent Calls**   | Configurable limits per tenant (default: 50)                              |
| **Recording Storage**  | S3-compatible with hot/warm/cold tiered lifecycle                         |
| **Carriers Supported** | Anveo Direct (Primary), SignalWire, Telnyx, Bandwidth, CLEC               |
| **Protocols**          | SIP/UDP, SIP/TLS, WebRTC (WSS), SRTP                                      |

---

## 2. Platform Architecture

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
│  - 50+ tables                 │  - Rate limiting                            │
└───────────────────────────────┴─────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          EXTERNAL SERVICES                                   │
├───────────────────────────────┬─────────────────────────────────────────────┤
│  Carrier APIs                 │  Third-Party Integrations                   │
│  - Anveo Direct               │  - Deepgram (Transcription)                 │
│  - SignalWire                 │  - DeepSeek (AI Analysis)                   │
│  - Telnyx                     │  - TrustedForm/Jornaya (Consent)            │
│  - Bandwidth                  │  - Google OAuth                             │
└───────────────────────────────┴─────────────────────────────────────────────┘
```

---

## 3. Technology Stack

### Backend

| Component           | Technology | Version |
| ------------------- | ---------- | ------- |
| **Runtime**         | Node.js    | ≥18.0.0 |
| **API Framework**   | Fastify    | 4.x     |
| **ORM**             | Prisma     | 6.19.0  |
| **Database**        | PostgreSQL | 15      |
| **Cache/Pub-Sub**   | Redis      | 7       |
| **Telephony**       | FreeSWITCH | 1.10    |
| **Package Manager** | pnpm       | 8.15.0  |
| **Language**        | TypeScript | 5.3.x   |

### Frontend

| Component            | Technology          | Version           |
| -------------------- | ------------------- | ----------------- |
| **Framework**        | Next.js             | 14.x (App Router) |
| **UI Components**    | Radix UI            | Latest            |
| **Styling**          | Tailwind CSS        | 3.x               |
| **State Management** | React Context + SWR | -                 |
| **SIP Client**       | SIP.js              | 0.21.x            |
| **Charts**           | Recharts            | 2.x               |

### Infrastructure

| Component            | Technology                      |
| -------------------- | ------------------------------- |
| **Containerization** | Docker + Docker Compose         |
| **Server**           | Vultr VPS (Ubuntu)              |
| **SSL**              | Let's Encrypt (Certbot)         |
| **Monitoring**       | Prometheus + Grafana (optional) |
| **CI/CD**            | Manual deployment via SSH       |

---

## 4. Monorepo Structure

```
hopwhistle/
├── apps/
│   ├── api/                    # Fastify REST API (Port 3001)
│   │   ├── prisma/             # Database schema & migrations
│   │   ├── src/
│   │   │   ├── cli/            # CLI tools (seed, migrate, etc.)
│   │   │   ├── lib/            # Shared libraries (logger, prisma, redis)
│   │   │   ├── middleware/     # Auth, RBAC, rate limiting, logging
│   │   │   ├── routes/         # API endpoint handlers (25 files)
│   │   │   ├── services/       # Business logic layer (40+ services)
│   │   │   └── types/          # TypeScript type definitions
│   │   └── package.json
│   │
│   ├── web/                    # Next.js Frontend (Port 3000)
│   │   ├── src/
│   │   │   ├── app/            # Next.js App Router pages
│   │   │   │   ├── (dashboard)/ # Protected dashboard routes
│   │   │   │   ├── login/       # Authentication pages
│   │   │   │   └── legal/       # Legal/compliance pages
│   │   │   ├── components/     # React components (80+)
│   │   │   │   ├── call-center/ # Agent dialer & scripting
│   │   │   │   ├── dashboard/   # KPI cards, grids
│   │   │   │   ├── flows/       # Visual flow editor
│   │   │   │   ├── phone/       # SIP.js integration
│   │   │   │   └── ui/          # Radix-based primitives
│   │   │   ├── hooks/          # Custom React hooks
│   │   │   └── lib/            # Client-side utilities
│   │   └── package.json
│   │
│   ├── freeswitch/             # FreeSWITCH configuration
│   │   ├── autoload_configs/   # Module configurations
│   │   ├── dialplan/           # Call routing rules
│   │   │   ├── default/        # Internal dialplan
│   │   │   └── public/         # Inbound from carriers
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
│   ├── sip/                    # SIP protocol tests
│   └── k6/                     # Load testing scripts
│
├── .agent/                     # Antigravity agent workflows
│   └── workflows/
│       └── deploy.md           # Deployment workflow
│
└── package.json                # Root monorepo config
```

---

## 5. API Application (apps/api)

### Entry Point: `src/index.ts`

The API server is built with Fastify and includes:

```typescript
// Key Fastify plugins registered:
- @fastify/swagger        // OpenAPI documentation
- @fastify/swagger-ui     // Swagger UI at /docs
- @fastify/cors           // CORS handling
- @fastify/jwt            // JWT authentication
- @fastify/rate-limit     // Request rate limiting
- @fastify/websocket      // WebSocket support
```

### Route Registration

Routes are registered in `buildServer()`:

| Route Module               | Path Prefix           | Description                |
| -------------------------- | --------------------- | -------------------------- |
| `registerNumberRoutes`     | `/api/v1/numbers`     | Phone number management    |
| `registerCampaignRoutes`   | `/api/v1/campaigns`   | Campaign CRUD              |
| `registerFlowRoutes`       | `/api/v1/flows`       | Flow routing configuration |
| `registerPublisherRoutes`  | `/api/v1/publishers`  | Publisher management       |
| `registerCallRoutes`       | `/api/v1/calls`       | Call records & CDRs        |
| `registerRecordingRoutes`  | `/api/v1/recordings`  | Recording access           |
| `registerWebhookRoutes`    | `/api/v1/webhooks`    | Webhook configuration      |
| `registerUserRoutes`       | `/api/v1/users`       | User management            |
| `registerReportingRoutes`  | `/api/v1/reporting`   | Analytics & reports        |
| `registerBillingRoutes`    | `/api/v1/billing`     | Billing accounts           |
| `registerAuthRoutes`       | `/api/v1/auth`        | Authentication             |
| `registerBotRoutes`        | `/api/v1/bot`         | AI bot integration         |
| `registerQuotaRoutes`      | `/api/v1/quotas`      | Quota management           |
| `registerPayrollRoutes`    | `/api/v1/payroll`     | Time tracking & payroll    |
| `registerPingRoutes`       | `/api/v1/ping`        | RTB Ping endpoint          |
| `registerPostRoutes`       | `/api/v1/post`        | RTB Post endpoint          |
| `registerLeadInjectRoutes` | `/api/v1/leads`       | Lead injection (SSE)       |
| `registerAgentPhoneRoutes` | `/api/v1/agent-phone` | Agent dialer API           |
| `registerComplianceRoutes` | `/api/v1/compliance`  | DNC & consent              |
| `registerRetentionRoutes`  | `/api/v1/retention`   | Policy retention           |

---

## 6. Web Application (apps/web)

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

| Component               | Location                   | Description                  |
| ----------------------- | -------------------------- | ---------------------------- |
| `PhoneProvider`         | `/components/phone/`       | SIP.js WebRTC client context |
| `IntegratedScriptPanel` | `/components/call-center/` | Sales scripting tool         |
| `CallEventSubscriber`   | `/components/`             | Real-time call state via SSE |
| `ServiceStatCards`      | `/components/dashboard/`   | KPI metric cards             |
| `CallLogGrid`           | `/components/dashboard/`   | Call history DataGrid        |
| `FlowEditor`            | `/components/flows/`       | Visual DSL flow builder      |
| `BuyerTable`            | `/components/dashboard/`   | High-density buyer grid      |

---

## 7. FreeSWITCH Telephony (apps/freeswitch)

### Container Configuration

FreeSWITCH runs in Docker with the following port mappings:

| Port        | Protocol | Purpose                  |
| ----------- | -------- | ------------------------ |
| 5060        | UDP/TCP  | Internal SIP             |
| 5080        | UDP/TCP  | External SIP (carriers)  |
| 7443        | WSS      | Verto WebSocket          |
| 8021        | TCP      | Event Socket Layer (ESL) |
| 8082        | TCP      | Verto signaling          |
| 16384-32768 | UDP      | RTP media range          |

### Directory Structure

```
freeswitch/
├── vars.xml                   # Global variables
│   - external_sip_ip
│   - external_rtp_ip
│   - global_codec_prefs (PCMU,PCMA,G729)
│
├── autoload_configs/
│   ├── acl.conf.xml           # Access control lists
│   │   - anveo_direct (Anveo signaling IPs)
│   │   - domains (Docker networks)
│   ├── sofia.conf.xml         # SIP UA configuration
│   ├── verto.conf.xml         # WebRTC configuration
│   └── event_socket.conf.xml  # ESL configuration
│
├── sip_profiles/
│   └── external/
│       ├── anveo.xml          # Anveo Direct gateway
│       ├── signalwire.xml     # SignalWire gateway
│       ├── telnyx.xml         # Telnyx gateway
│       └── wholesale.xml      # Generic SIP trunk
│
└── dialplan/
    ├── default/
    │   └── 01_anveo_outbound.xml  # US outbound via Anveo + STIR/SHAKEN
    │
    └── public/
        └── anveo_inbound.xml      # Inbound from Anveo ACL
```

### Current Carrier: Anveo Direct

**Gateway Configuration (`anveo.xml`):**

```xml
<include>
  <gateway name="anveo">
    <param name="proxy" value="sbc.anveo.com"/>
    <param name="register" value="false"/>  <!-- IP-based auth -->
    <param name="caller-id-in-from" value="true"/>
  </gateway>
</include>
```

**ACL (`acl.conf.xml`):**

```xml
<list name="anveo_direct" default="deny">
  <node type="allow" cidr="169.48.232.158/32"/>
  <node type="allow" cidr="204.216.109.55/32"/>
  <node type="allow" cidr="176.9.39.206/32"/>
  <node type="allow" cidr="72.9.149.25/32"/>
</list>
```

**Outbound Dialplan with STIR/SHAKEN:**

```xml
<extension name="anveo_outbound_us">
  <condition field="destination_number" expression="^1?(\d{10})$">
    <action application="set" data="sip_h_P-Attestation-Indicator=A"/>
    <action application="bridge" data="sofia/gateway/anveo/1$1"/>
  </condition>
</extension>
```

---

## 8. Database Schema

### Overview

The database uses PostgreSQL with Prisma ORM. The schema (`schema.prisma`) contains **~60 models** organized into logical sections:

### Core Multi-Tenant Models

| Model          | Description                                                    |
| -------------- | -------------------------------------------------------------- |
| `Tenant`       | Root tenant entity with metadata, quotas, budgets              |
| `TenantQuota`  | Concurrent call limits, phone number limits                    |
| `TenantBudget` | Monthly budget tracking with alerts                            |
| `User`         | Platform users with OAuth support                              |
| `Role`         | RBAC roles (OWNER, ADMIN, ANALYST, PUBLISHER, BUYER, READONLY) |
| `UserRole`     | Many-to-many user-role assignments                             |
| `ApiKey`       | Tenant API keys with scopes and rate limits                    |

### Telephony Infrastructure

| Model          | Description                                         |
| -------------- | --------------------------------------------------- |
| `PhoneNumber`  | DIDs with carrier, pool status, campaign assignment |
| `Carrier`      | Carrier definitions (Anveo, SignalWire, etc.)       |
| `Trunk`        | SIP trunk configurations                            |
| `CallerIdPool` | Caller ID rotation pools                            |

### Campaign & Distribution

| Model              | Description                                 |
| ------------------ | ------------------------------------------- |
| `Campaign`         | Marketing campaigns with routing mode       |
| `Publisher`        | Traffic sources (affiliates)                |
| `Buyer`            | Call buyers with billing type               |
| `BuyerEndpoint`    | Buyer targets with caps, geo-routing, hours |
| `BuyerStats`       | Pre-aggregated buyer performance metrics    |
| `BuyerTransaction` | Lead credit/debit ledger                    |

### Call Tracking

| Model           | Description                         |
| --------------- | ----------------------------------- |
| `Call`          | Primary call record with 50+ fields |
| `CallLeg`       | Individual legs (inbound, outbound) |
| `Cdr`           | Carrier-level CDR data              |
| `Recording`     | Recording files with storage tier   |
| `Transcription` | Speech-to-text output               |

### Flow Routing

| Model         | Description                                  |
| ------------- | -------------------------------------------- |
| `Flow`        | Named flow container                         |
| `FlowVersion` | Versioned flow definitions                   |
| `Node`        | Flow nodes (IVR, QUEUE, BUYER_FORWARD, etc.) |
| `Edge`        | Connections between nodes with conditions    |

### Billing

| Model            | Description                          |
| ---------------- | ------------------------------------ |
| `BillingAccount` | Billing entity per tenant            |
| `RateCard`       | Rate structures with effective dates |
| `Invoice`        | Generated invoices                   |
| `InvoiceLine`    | Line items on invoices               |
| `AccrualLedger`  | Real-time revenue accrual            |
| `Payout`         | Publisher payouts                    |

### Compliance & Security

| Model                | Description                         |
| -------------------- | ----------------------------------- |
| `DncList`            | Do-Not-Call lists                   |
| `DncListEntry`       | Individual DNC numbers              |
| `ConsentToken`       | TrustedForm/Jornaya consent tokens  |
| `CompliancePolicy`   | Tenant compliance rules             |
| `ComplianceOverride` | DNC/consent overrides with approval |
| `StirShakenStatus`   | STIR/SHAKEN attestation per call    |
| `CnamLookup`         | Caller name lookups                 |
| `CarrierLookup`      | Phone carrier identification        |

### CRM & Lead Management

| Model             | Description                          |
| ----------------- | ------------------------------------ |
| `Lead`            | Customer/lead records for screen pop |
| `LeadCall`        | Lead-to-call associations            |
| `RetentionPolicy` | Insurance policy retention tracking  |
| `RetentionNote`   | Notes on retention policies          |

### Payroll & Time Tracking

| Model            | Description                   |
| ---------------- | ----------------------------- |
| `TimeEntry`      | Contractor work hours         |
| `UserFinancials` | Encrypted banking information |
| `PayrollPayout`  | Finalized payouts             |

### RTB Auction

| Model         | Description                         |
| ------------- | ----------------------------------- |
| `PingRequest` | Incoming lead pings from publishers |
| `BuyerBid`    | Bids generated per ping             |

---

## 9. Services Layer

The `apps/api/src/services/` directory contains the business logic:

### Core Services

| Service        | File            | Purpose                            |
| -------------- | --------------- | ---------------------------------- |
| **Analytics**  | `analytics.ts`  | Reporting aggregations             |
| **Audit**      | `audit.ts`      | Audit log creation                 |
| **Event Bus**  | `event-bus.ts`  | Redis pub/sub for real-time events |
| **Call State** | `call-state.ts` | Redis-based call state management  |
| **Redis**      | `redis.ts`      | Redis client singleton             |
| **Secrets**    | `secrets.ts`    | Environment variable management    |
| **Logger**     | `logger.ts`     | Pino-based structured logging      |

### Telephony Services

| Service                 | File                     | Purpose                 |
| ----------------------- | ------------------------ | ----------------------- |
| **FreeSWITCH**          | `freeswitch-service.ts`  | ESL integration         |
| **Routing**             | `routing.ts`             | Call routing logic      |
| **Flow Engine**         | `flow-engine.ts`         | DSL flow execution      |
| **Flow Store**          | `flow-store.ts`          | Flow persistence        |
| **Recording**           | `recording-service.ts`   | Recording management    |
| **Recording Lifecycle** | `recording-lifecycle.ts` | Storage tier management |
| **STIR/SHAKEN**         | `stir-shaken-service.ts` | Attestation handling    |
| **CNAM**                | `cnam-service.ts`        | Caller name lookups     |
| **Carrier**             | `carrier-service.ts`     | Carrier management      |

### Provisioning Services

| Service                  | File                                          | Purpose                     |
| ------------------------ | --------------------------------------------- | --------------------------- |
| **Provisioning Service** | `provisioning/provisioning-service.ts`        | Multi-carrier orchestration |
| **Anveo Adapter**        | `provisioning/adapters/anveo-adapter.ts`      | Anveo Direct API            |
| **SignalWire Adapter**   | `provisioning/adapters/signalwire-adapter.ts` | SignalWire API              |
| **Telnyx Adapter**       | `provisioning/adapters/telnyx-adapter.ts`     | Telnyx API                  |
| **Bandwidth Adapter**    | `provisioning/adapters/bandwidth-adapter.ts`  | Bandwidth API               |
| **Number Pool**          | `number-pool-service.ts`                      | RTB number pool management  |

### RTB Services

| Service             | File                 | Purpose                    |
| ------------------- | -------------------- | -------------------------- |
| **Auction Service** | `auction-service.ts` | RTB auction logic          |
| **Post Service**    | `post-service.ts`    | POST handling for won bids |

### Billing Services

| Service                  | File                           | Purpose                  |
| ------------------------ | ------------------------------ | ------------------------ |
| **Buyer Billing**        | `buyer-billing-service.ts`     | Lead credit/debit        |
| **Buyer Billing Events** | `buyer-billing-events.ts`      | Billing event emission   |
| **Buyer Stats**          | `buyer-stats-service.ts`       | Stats aggregation        |
| **Buyer Live Status**    | `buyer-live-status-service.ts` | Real-time cap tracking   |
| **Budget Alert**         | `budget-alert-service.ts`      | Budget threshold alerts  |
| **Quota**                | `quota-service.ts`             | Tenant quota enforcement |

### Other Services

| Service              | File                          | Purpose                         |
| -------------------- | ----------------------------- | ------------------------------- |
| **Lead**             | `lead-service.ts`             | CRM lead management             |
| **Compliance**       | `compliance-service.ts`       | DNC/consent checks              |
| **Consent Provider** | `consent-provider-service.ts` | TrustedForm integration         |
| **Google Auth**      | `google-auth.ts`              | OAuth token verification        |
| **Storage**          | `storage.ts`                  | S3-compatible storage           |
| **Time Tracking**    | `time-tracking-service.ts`    | Payroll time entries            |
| **Fronter Bot**      | `fronter-bot.ts`              | AI call fronting                |
| **Publisher Email**  | `publisher-email.ts`          | Publisher notifications         |
| **ClickHouse**       | `clickhouse.ts`               | ClickHouse analytics (optional) |

---

## 10. API Routes & Endpoints

### Authentication

| Method | Endpoint               | Description          |
| ------ | ---------------------- | -------------------- |
| POST   | `/api/v1/auth/login`   | Email/password login |
| POST   | `/api/v1/auth/google`  | Google OAuth login   |
| POST   | `/api/v1/auth/logout`  | Session logout       |
| GET    | `/api/v1/auth/me`      | Current user info    |
| POST   | `/api/v1/auth/refresh` | Refresh JWT          |

### Phone Numbers

| Method | Endpoint                 | Description              |
| ------ | ------------------------ | ------------------------ |
| GET    | `/api/v1/numbers`        | List phone numbers       |
| POST   | `/api/v1/numbers`        | Provision new number     |
| GET    | `/api/v1/numbers/:id`    | Get number details       |
| PATCH  | `/api/v1/numbers/:id`    | Update number            |
| DELETE | `/api/v1/numbers/:id`    | Release number           |
| POST   | `/api/v1/numbers/search` | Search available numbers |

### Campaigns

| Method | Endpoint                      | Description         |
| ------ | ----------------------------- | ------------------- |
| GET    | `/api/v1/campaigns`           | List campaigns      |
| POST   | `/api/v1/campaigns`           | Create campaign     |
| GET    | `/api/v1/campaigns/:id`       | Get campaign        |
| PATCH  | `/api/v1/campaigns/:id`       | Update campaign     |
| DELETE | `/api/v1/campaigns/:id`       | Delete campaign     |
| GET    | `/api/v1/campaigns/:id/stats` | Campaign statistics |

### Buyers

| Method | Endpoint                       | Description          |
| ------ | ------------------------------ | -------------------- |
| GET    | `/api/v1/buyers`               | List buyers          |
| POST   | `/api/v1/buyers`               | Create buyer         |
| GET    | `/api/v1/buyers/:id`           | Get buyer            |
| PATCH  | `/api/v1/buyers/:id`           | Update buyer         |
| DELETE | `/api/v1/buyers/:id`           | Delete buyer         |
| GET    | `/api/v1/buyers/:id/endpoints` | List buyer endpoints |
| POST   | `/api/v1/buyers/:id/endpoints` | Create endpoint      |
| POST   | `/api/v1/buyers/:id/credits`   | Add lead credits     |

### Calls

| Method | Endpoint                       | Description            |
| ------ | ------------------------------ | ---------------------- |
| GET    | `/api/v1/calls`                | List calls (paginated) |
| GET    | `/api/v1/calls/:id`            | Get call details       |
| GET    | `/api/v1/calls/:id/recording`  | Get recording URL      |
| GET    | `/api/v1/calls/:id/transcript` | Get transcription      |

### RTB Ping/Post

| Method | Endpoint           | Description           |
| ------ | ------------------ | --------------------- |
| POST   | `/api/v1/ping`     | Submit ping request   |
| POST   | `/api/v1/post`     | Submit POST (won bid) |
| GET    | `/api/v1/ping/:id` | Check ping status     |

### Agent Phone

| Method | Endpoint                        | Description         |
| ------ | ------------------------------- | ------------------- |
| POST   | `/api/v1/agent-phone/originate` | Start outbound call |
| POST   | `/api/v1/agent-phone/hangup`    | End call            |
| POST   | `/api/v1/agent-phone/hold`      | Toggle hold         |
| POST   | `/api/v1/agent-phone/transfer`  | Transfer call       |
| GET    | `/api/v1/agent-phone/status`    | Agent status        |

### Reporting

| Method | Endpoint                         | Description           |
| ------ | -------------------------------- | --------------------- |
| GET    | `/api/v1/reporting/summary`      | Call summary stats    |
| GET    | `/api/v1/reporting/hourly`       | Hourly breakdown      |
| GET    | `/api/v1/reporting/by-publisher` | Publisher performance |
| GET    | `/api/v1/reporting/by-buyer`     | Buyer performance     |

### Lead Injection (SSE)

| Method | Endpoint               | Description           |
| ------ | ---------------------- | --------------------- |
| GET    | `/api/v1/leads/stream` | SSE event stream      |
| POST   | `/api/v1/leads/inject` | Inject lead for agent |
| POST   | `/api/v1/leads/pop`    | Screen pop lookup     |

---

## 11. Authentication & Authorization

### Authentication Methods

1. **JWT (Primary)**
   - Issued on login/OAuth
   - Stored in httpOnly cookie
   - 24-hour expiry with refresh

2. **API Key**
   - Header: `X-API-Key: <key>`
   - Hashed storage (SHA-256)
   - Scoped permissions

3. **Google OAuth**
   - via `@fastify/oauth2`
   - Automatic user provisioning

### RBAC Roles

| Role        | Description    | Permissions          |
| ----------- | -------------- | -------------------- |
| `OWNER`     | Tenant owner   | Full access          |
| `ADMIN`     | Administrator  | All except billing   |
| `ANALYST`   | Reporting user | Read-only reports    |
| `PUBLISHER` | Traffic source | Own campaigns, calls |
| `BUYER`     | Call buyer     | Own endpoints, calls |
| `READONLY`  | Observer       | Read-only all        |

### Middleware Chain

```typescript
// Request flow:
1. logger           // Request logging
2. rateLimit        // Rate limiting
3. csrf             // CSRF protection
4. auth             // JWT/API Key verification
5. rbac             // Permission check
6. handler          // Route handler
```

---

## 12. Telephony & VoIP System

### Call Flow

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

1. Agent → WebRTC (SIP.js) → WSS → Verto → FreeSWITCH
2. API: POST /api/v1/agent-phone/originate
3. FreeSWITCH: Create A-leg to agent
4. FreeSWITCH: Create B-leg via gateway
5. Dialplan: Set STIR/SHAKEN header
6. Bridge to Anveo gateway
7. Call Completion → CDR
```

### WebRTC Configuration

**SIP.js Client Settings:**

```typescript
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

### ESL (Event Socket Layer)

The API connects to FreeSWITCH via ESL for:

- Originating calls
- Transferring calls
- Monitoring call state
- Real-time CDR updates

```typescript
// ESL connection config
{
  host: process.env.FREESWITCH_HOST || 'freeswitch',
  port: parseInt(process.env.FREESWITCH_ESL_PORT || '8021'),
  password: process.env.FREESWITCH_ESL_PASSWORD || 'ClueCon'
}
```

---

## 13. Carrier Provisioning

### Provider Priority Order

```typescript
const DEFAULT_PROVIDER_ORDER = ['anveo', 'signalwire', 'telnyx', 'bandwidth'];
```

### Anveo Direct Adapter

**Configuration:**

```typescript
// Environment variable
ANVEO_API_KEY=0b7603639cc8e908e8ff16e53f0470d4fc398ede

// API endpoint
https://www.anveo.com/api/v1/...
```

**Key Methods:**

- `listNumbers(options)` - Search available DIDs
- `purchaseNumber(request)` - Order DID
- `releaseNumber(providerId)` - Release DID
- `getNumber(providerId)` - Get DID details
- `configureNumber(providerId, features)` - Set DID routing

**DID Routing Configuration:**
When a number is purchased or configured, it's automatically set to route to:

```
SIP/{E164_NUMBER}@45.32.213.201:5080
```

### SignalWire Adapter

```typescript
SIGNALWIRE_PROJECT_ID=<project-id>
SIGNALWIRE_API_TOKEN=<token>
SIGNALWIRE_SPACE=<space>.signalwire.com
```

### Telnyx Adapter

```typescript
TELNYX_API_KEY=<key>
```

### Bandwidth Adapter

```typescript
BANDWIDTH_ACCOUNT_ID=<account>
BANDWIDTH_USERNAME=<user>
BANDWIDTH_PASSWORD=<pass>
BANDWIDTH_SITE_ID=<site>
```

---

## 14. RTB Auction System

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
3. **Operating Hours**: `hoursOfOperation` schedule check
4. **Cap Check**: `capConsumedToday < maxCap`
5. **Concurrency**: Active calls < `maxConcurrency`
6. **Wallet Balance**: For UPFRONT billing, `leadsRemaining > 0`

### Bid Calculation

```typescript
basePrice + sum(pricingRules where condition matches)
```

Example pricing rules:

```json
[
  { "field": "age", "op": "gt", "val": 65, "adjustment": "5.00" },
  { "field": "state", "op": "in", "val": ["CA", "NY"], "adjustment": "2.50" }
]
```

---

## 15. Call Center Portal

### Overview

The Call Center module (`/call-center`) provides a browser-based agent dialer with:

- **Integrated Dialer**: WebRTC-based calling via SIP.js
- **Screen Pop**: Lead data display on call connect
- **Sales Script**: Step-by-step guided selling
- **Quote Calculator**: Final Expense insurance quotes
- **SSE Lead Injection**: Real-time lead push to agents

### Components

| Component               | Purpose                             |
| ----------------------- | ----------------------------------- |
| `AgentDialer`           | Main dialer interface               |
| `IntegratedScriptPanel` | Sales script with quote integration |
| `PhoneProvider`         | SIP.js context wrapper              |
| `CallEventSubscriber`   | SSE event listener                  |
| `LeadDisplay`           | Screen pop information              |

### Script System

Two script modes:

1. **Final Expense Sales** (default)
2. **Retention** (for policy follow-ups)

Admins can toggle between scripts via dropdown.

### Quote Engine

The quote calculator integrates with carrier rate tables:

- Age-based premium calculation
- Coverage amount selection
- Multi-carrier comparison
- Real-time premium display

---

## 16. Buyer/Publisher Management

### Publisher Model

Publishers represent traffic sources (affiliates):

| Field                | Type    | Description                 |
| -------------------- | ------- | --------------------------- |
| `code`               | String  | 32-char hex identifier      |
| `email`              | String  | Contact email               |
| `accessToRecordings` | Boolean | Recording access permission |
| `status`             | Enum    | ACTIVE, INACTIVE            |

### Buyer Model

Buyers purchase calls/leads:

| Field              | Type    | Description                         |
| ------------------ | ------- | ----------------------------------- |
| `billingType`      | Enum    | TERMS (post-pay), UPFRONT (pre-pay) |
| `leadsRemaining`   | Int     | Pre-paid lead balance               |
| `billableDuration` | Int     | Seconds threshold for billing       |
| `canPauseTargets`  | Boolean | Self-service cap control            |

### Buyer Endpoint (Target)

Each buyer can have multiple endpoints:

| Field              | Type     | Description             |
| ------------------ | -------- | ----------------------- |
| `type`             | Enum     | SIP, PSTN, WEBRTC       |
| `destination`      | String   | SIP URI or phone number |
| `maxCap`           | Int      | Calls per period        |
| `capPeriod`        | Enum     | HOUR, DAY, MONTH        |
| `maxConcurrency`   | Int      | Simultaneous calls      |
| `acceptedStates`   | String[] | Geo filter              |
| `hoursOfOperation` | JSON     | Schedule per day        |
| `basePrice`        | Decimal  | Static bid price        |
| `pricingRules`     | JSON     | Dynamic adjustments     |

---

## 17. Billing & Financial Systems

### Buyer Billing Types

**TERMS (Post-Pay):**

- No upfront payment required
- Invoiced at end of period
- Uses `BillingAccount` and `Invoice` models

**UPFRONT (Pre-Pay):**

- Credits purchased in advance
- `leadsRemaining` decremented on each billable call
- Uses `BuyerTransaction` ledger

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

### Accrual Ledger

Real-time revenue tracking:

| Type                   | Description            |
| ---------------------- | ---------------------- |
| `CALL_MINUTE_INBOUND`  | Inbound call charges   |
| `CALL_MINUTE_OUTBOUND` | Outbound call charges  |
| `CONNECTION_FEE`       | Per-connection fees    |
| `RECORDING_FEE`        | Recording storage fees |
| `CPA_CONVERSION`       | Conversion bonuses     |

---

## 18. Compliance & Security

### DNC (Do Not Call) Management

Three list types:

1. **GLOBAL**: Platform-wide DNC
2. **CAMPAIGN**: Campaign-specific
3. **CUSTOM**: Tenant-defined

Entries include:

- Phone number (E.164)
- Reason
- Source
- Timestamp

### Consent Token Verification

Supports:

- **TrustedForm**: Certificate URL validation
- **Jornaya**: LeadID tokens

```typescript
// ConsentToken fields
{
  token: 'https://cert.trustedform.com/...',
  tokenHash: '<sha256>',
  provider: 'TRUSTEDFORM',
  status: 'VERIFIED',
  verifiedAt: '2026-01-31T...'
}
```

### STIR/SHAKEN

Attestation levels:

- **A**: Full attestation (authorized caller)
- **B**: Partial attestation (known customer)
- **C**: Gateway attestation (passed through)
- **NONE**: No attestation

Header injection via FreeSWITCH dialplan:

```xml
<action application="set" data="sip_h_P-Attestation-Indicator=A"/>
```

### Security Measures

1. **JWT Tokens**: httpOnly cookies, 24h expiry
2. **API Keys**: SHA-256 hashed, scoped permissions
3. **Rate Limiting**: Per IP and per API key
4. **CSRF Protection**: Double-submit cookie pattern
5. **Encrypted Secrets**: Banking data uses AES-256-GCM
6. **Audit Logging**: All mutations logged

---

## 19. Infrastructure & Deployment

### Production Server

| Setting          | Value                    |
| ---------------- | ------------------------ |
| **Provider**     | Vultr VPS                |
| **IP Address**   | 45.32.213.201            |
| **SSH Access**   | `ssh root@45.32.213.201` |
| **Project Path** | `/opt/hopwhistle`        |
| **Domain**       | hopwhistle.com           |

### Docker Containers

| Container                   | Image                 | Ports                  |
| --------------------------- | --------------------- | ---------------------- |
| `docker-api-1`              | docker-api:latest     | 3001                   |
| `hopwhistle-web-1`          | hopwhistle-web:latest | 3000                   |
| `hopwhistle-postgres-dev`   | postgres:15           | 5432                   |
| `hopwhistle-redis-1`        | redis:7               | 6379                   |
| `hopwhistle-freeswitch-dev` | freeswitch:1.10       | 5060, 5080, 7443, 8021 |

### Network Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    docker_default network                    │
├─────────────────────────────────────────────────────────────┤
│  docker-api-1                                               │
│  hopwhistle-web-1                                           │
│  hopwhistle-postgres-dev (alias: postgres)                  │
│  hopwhistle-redis-1 (alias: redis)                          │
│  hopwhistle-freeswitch-dev (alias: freeswitch)              │
└─────────────────────────────────────────────────────────────┘
```

### Deployment Workflow

See `/.agent/workflows/deploy.md` for full details.

**Quick Commands:**

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
# Refuses any change that would destroy data. A refusal means stop and find out
# what it wants to drop -- it is NOT a reason to add --accept-data-loss.
docker exec -it docker-api-1 npx prisma db push

# Reload FreeSWITCH
docker exec hopwhistle-freeswitch-dev fs_cli -x 'reloadxml'
```

---

## 20. Environment Variables

### Core Configuration

| Variable          | Description                  | Example                                                                          |
| ----------------- | ---------------------------- | -------------------------------------------------------------------------------- |
| `DATABASE_URL`    | PostgreSQL connection string | `postgresql://callfabric:callfabric_dev@hopwhistle-postgres-dev:5432/callfabric` |
| `REDIS_URL`       | Redis connection string      | `redis://hopwhistle-redis-1:6379`                                                |
| `API_BASE_URL`    | API base URL                 | `http://api:3001`                                                                |
| `API_ADMIN_TOKEN` | Admin authentication token   | `PTe87f4727416...`                                                               |

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

## 21. Troubleshooting Guide

### Common Issues

#### "ENOTFOUND redis" Error

```bash
docker network connect --alias redis docker_default hopwhistle-redis-1
docker restart docker-api-1
```

#### "ENOTFOUND hopwhistle-postgres-dev" Error

```bash
docker network connect docker_default hopwhistle-postgres-dev
docker restart docker-api-1
```

#### Port 3001 Already Allocated

```bash
docker stop $(docker ps -q --filter "publish=3001")
docker rm $(docker ps -aq --filter "name=api")
```

#### Column Does Not Exist

```bash
docker exec -it docker-api-1 npx prisma db push
```

#### FreeSWITCH Gateway Invalid

```bash
# Check gateway status
docker exec hopwhistle-freeswitch-dev fs_cli -x 'sofia status gateway anveo'

# Reload configuration
docker exec hopwhistle-freeswitch-dev fs_cli -x 'reloadxml'
docker exec hopwhistle-freeswitch-dev fs_cli -x 'sofia profile external restart'
```

#### API Container Won't Start

```bash
# Check logs
docker logs docker-api-1 --tail 100

# Common fixes:
# 1. Check DATABASE_URL in .env
# 2. Ensure postgres is running
# 3. Check for port conflicts
```

### Log Locations

| Log             | Command                                                                    |
| --------------- | -------------------------------------------------------------------------- |
| API logs        | `docker logs docker-api-1`                                                 |
| Web logs        | `docker logs hopwhistle-web-1`                                             |
| FreeSWITCH logs | `docker exec hopwhistle-freeswitch-dev fs_cli -x 'console loglevel debug'` |
| PostgreSQL logs | `docker logs hopwhistle-postgres-dev`                                      |

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

---

## Appendix A: Key File Locations

| File                                                             | Purpose                                 |
| ---------------------------------------------------------------- | --------------------------------------- |
| `/opt/hopwhistle/apps/api/.env`                                  | API environment variables               |
| `/opt/hopwhistle/infra/docker/.env`                              | Docker environment variables            |
| `/opt/hopwhistle/apps/api/prisma/schema.prisma`                  | Database schema                         |
| `/etc/freeswitch/`                                               | FreeSWITCH configuration (in container) |
| `/var/lib/docker/volumes/hopwhistle_freeswitch_recordings/_data` | Recordings                              |

---

## Appendix B: Quick Reference

### Database Connection (Production)

```
Host: hopwhistle-postgres-dev (internal)
Database: callfabric
Username: callfabric
Password: callfabric_dev
```

### API Endpoints (Most Common)

```
GET  /health                     - Health check
GET  /api/v1/calls               - List calls
POST /api/v1/agent-phone/originate - Originate call
POST /api/v1/ping                - RTB ping
POST /api/v1/post                - RTB post
GET  /api/v1/leads/stream        - SSE lead stream
```

### FreeSWITCH CLI Commands

```bash
# Status
fs_cli -x 'status'
fs_cli -x 'sofia status'
fs_cli -x 'sofia status gateway anveo'

# Configuration
fs_cli -x 'reloadxml'
fs_cli -x 'reloadacl'

# Debug
fs_cli -x 'console loglevel debug'
fs_cli -x 'show channels'
fs_cli -x 'show calls'
```

---

_This document is auto-generated and maintained by the development team. For questions, contact the platform administrators._
