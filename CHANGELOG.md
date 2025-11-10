# Changelog

All notable changes to the Hopwhistle platform will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - [TBD]

### Added

#### Security & Access Control

- **RBAC (Role-Based Access Control)** with roles: OWNER, ADMIN, ANALYST, PUBLISHER, BUYER, READONLY
- **Per-tenant API key scopes** for granular permission control
- **Rate limiting** per API key and per IP address
- **CSRF protection** on web endpoints with HMAC-based tokens
- **Session hardening** with HTTP-only cookies, Secure flag, and Strict SameSite
- **Full audit trail** for entity changes and sensitive reads
- **Secrets management** with dotenv-flow (dev) and placeholder for DO Secrets/KMS (prod)

#### Number Provisioning

- **Unified provisioning service** supporting multiple providers:
  - Local adapter (for development/testing)
  - SignalWire adapter (production-ready)
  - Telnyx adapter (stub)
  - Bandwidth adapter (stub)
- **CLI utilities** for number management:
  - `numbers:import` - Import numbers from CSV
  - `numbers:assign` - Assign numbers to campaigns
  - `numbers:audit` - Audit local vs provider inventory
- **Phone number quota enforcement** integrated with quota system

#### Cost Controls & Quotas

- **Per-tenant quotas** with enforcement:
  - Max concurrent calls
  - Max minutes per day
  - Recording retention days
  - Max phone numbers
- **Budget alerts** via email/Slack webhooks
- **Hard stops** with override tokens and audit trail
- **Admin UI** for quota and budget management

#### Demo Mode & Sample Data

- **Demo seed script** generating 7 days of synthetic data:
  - Calls (5 per hour for 7 days)
  - Buyers and publishers
  - Campaigns and flows
  - Invoices and transcripts
- **UI toggle** to switch between live and demo data
- **Screenshot generator** for exporting dashboard images

#### Data Migration

- **Legacy data import tool** (`migrate.ts`) supporting:
  - CSV and JSON file formats
  - Phone numbers, campaigns, calls, recordings
  - Dry-run mode for validation
  - SignalWire number verification
  - Deduplication via import hashes

#### Performance Testing

- **k6 load tests** for:
  - Call state updates (500 concurrent/sec target)
  - Reporting endpoints (100 QPS, <300ms p95 target)
  - Redis pub/sub throughput
- **Performance baselines** documented in `docs/PERF.md`

#### Infrastructure

- **Docker Compose** files:
  - `docker-compose.dev.yml` - Full development stack
  - `docker-compose.prod.yml` - Production-ready with scaling
- **CI/CD workflows**:
  - PR checks (lint, typecheck, tests, build, SIP tests)
  - Release workflow (version bump, SDK publish, Docker images)
  - Deploy workflow (DigitalOcean Apps, Droplets, Kubernetes)
- **Makefile** targets for common operations

#### Documentation

- **Production hardening** docs:
  - Threat model and OWASP ASVS checklist
  - Backup/restore procedures
  - Blue/green deployment guide
  - Disaster recovery plan
  - Postmortem template
  - SLOs (availability, latency, billing latency)
- **Legal & compliance** templates:
  - Privacy policy
  - Data retention policy
  - Call recording disclosure guide
  - DPA template
  - Terms of service

### Changed

- **Rebranded** from CallFabric to Hopwhistle
- **Updated color scheme** to match Hopwhistle logo:
  - Deep Navy Blue (#1E3A5F) - Main Text/Primary
  - Electric Lime Green (#00D084) - First Accent
  - Bright Orange (#FF6B35) - Second Accent
- **Database schema** updates:
  - Added `importSource` and `importHash` to `phone_numbers`, `calls`, `recordings`
  - Added `externalId` to `calls` for legacy system deduplication
  - Added quota and budget models

### Security

- All authentication endpoints require proper RBAC checks
- API keys validated against database with expiration and scope checks
- Rate limiting prevents abuse
- CSRF protection prevents cross-site attacks
- Audit logging captures all sensitive operations
- Secrets never logged or exposed in error messages

### Fixed

- Fixed syntax error in flow-builder.tsx
- Fixed database connection string handling
- Fixed CORS configuration for development
- Fixed demo mode tenant ID handling in reporting endpoints

### Known Limitations

- **Pricing:** Rate cards are configurable per tenant, but default rates need to be set manually
- **Stripe Integration:** Payment processing is stubbed (Stripe service exists but requires configuration)
- **Email Alerts:** SMTP configuration required for budget alerts
- **Secrets Management:** Production secrets loading from DO Secrets/KMS is placeholder (uses env vars)
- **Multi-region:** DR plan documented but not yet implemented

### Migration Notes

#### Database Migrations

Run migrations before upgrading:

```bash
pnpm db:migrate
```

#### Environment Variables

New environment variables added:

- `SIGNALWIRE_PROJECT_ID`
- `SIGNALWIRE_API_TOKEN`
- `SIGNALWIRE_SPACE_URL`
- `CLICKHOUSE_URL` (optional)
- `CLICKHOUSE_USER` (optional)
- `CLICKHOUSE_PASSWORD` (optional)
- `CLICKHOUSE_DATABASE` (optional)

See `apps/api/env.example` for full list.

#### Breaking Changes

None in v0.1.0 (first release).

---

## [Unreleased]

### Planned for v0.2.0

- [ ] Multi-region deployment
- [ ] Production secrets manager integration (DO Secrets/KMS)
- [ ] Stripe payment processing
- [ ] Email alert delivery
- [ ] Advanced analytics dashboards
- [ ] Webhook retry mechanism
- [ ] Rate card templates

---

[0.1.0]: https://github.com/your-org/hopwhistle/releases/tag/v0.1.0
