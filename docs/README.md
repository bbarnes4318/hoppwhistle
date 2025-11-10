# Documentation

This directory contains documentation for the Hopwhistle platform.

## Production Hardening & Operations

### Security & Compliance

- **[Threat Model & Security Checklist](THREAT_MODEL.md)** - OWASP ASVS-based security checklist and threat model
- **[Security Documentation](SECURITY.md)** - Security features and implementation details
- **[Production Readiness Checklist](PRODUCTION_CHECKLIST.md)** - Comprehensive checklist for production launch

### Operations & Reliability

- **[Backup & Restore Procedures](BACKUP_RESTORE.md)** - Database, MinIO, and configuration backup/restore
- **[Blue/Green Deployment Guide](BLUE_GREEN_DEPLOYMENT.md)** - Zero-downtime deployment procedures
- **[Disaster Recovery Plan](DISASTER_RECOVERY.md)** - Multi-region DR procedures (DO + Hetzner)
- **[Postmortem Template](POSTMORTEM_TEMPLATE.md)** - Incident postmortem template and examples
- **[Service Level Objectives (SLOs)](SLOS.md)** - Availability, latency, and error rate SLOs

### Infrastructure

- **[Database Setup](DATABASE_SETUP.md)** - PostgreSQL setup and configuration
- **[Observability](OBSERVABILITY.md)** - Monitoring, logging, and tracing setup
- **[ClickHouse Setup](CLICKHOUSE_SETUP.md)** - Analytics database configuration

### Features

- **[Quotas & Budgets](QUOTAS.md)** - Cost controls and quota management
- **[Pricing Configuration](PRICING.md)** - Rate card setup and pricing guide
- **[Performance & Load Testing](PERF.md)** - Performance baselines and k6 load test results
- **[Release Checklist](release-checklist.md)** - v0.1.0 release checklist
- **[Port Reference](PORTS.md)** - All ports used by the platform
- **[API Documentation](api/openapi.yaml)** - OpenAPI specification

## Structure

- `architecture/` - System architecture diagrams
- `adr/` - Architecture Decision Records
- `api/` - OpenAPI/Swagger specifications
- `runbooks/` - Operational runbooks

## ADR Template

When creating a new ADR, use the following format:

```markdown
# ADR-000: Title

## Status

[Proposed | Accepted | Rejected | Deprecated | Superseded]

## Context

[Describe the issue motivating this decision]

## Decision

[Describe the change that we're proposing or have agreed to implement]

## Consequences

[Describe the consequences of this decision]
```

## API Documentation

API documentation should be maintained in OpenAPI 3.0 format in the `api/` directory.
