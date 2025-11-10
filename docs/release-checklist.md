# Release Checklist - v0.1.0

**Release Date:** [TBD]  
**Release Manager:** [TBD]  
**Status:** 🟡 In Progress

---

## Pre-Release Preparation

### Versioning & Documentation

- [ ] **Version Bump**
  - [ ] Update `package.json` version to `0.1.0`
  - [ ] Update `packages/sdk/package.json` version to `0.1.0`
  - [ ] Update all app `package.json` versions if needed
  - [ ] Verify version consistency across monorepo

- [ ] **Changelog**
  - [ ] Create/update `CHANGELOG.md` with v0.1.0 entries
  - [ ] Document breaking changes (if any)
  - [ ] Document new features:
    - [ ] RBAC with roles (OWNER, ADMIN, ANALYST, PUBLISHER, BUYER, READONLY)
    - [ ] Per-tenant API key scopes
    - [ ] Rate limiting per API key and IP
    - [ ] CSRF protection and session hardening
    - [ ] Full audit trail for entity changes
    - [ ] Number provisioning abstraction (Local, SignalWire, Telnyx, Bandwidth)
    - [ ] Cost controls and quotas
    - [ ] Demo mode with synthetic data
    - [ ] Legacy data migration tool
    - [ ] k6 performance tests
  - [ ] Document bug fixes
  - [ ] Document known limitations

- [ ] **Migration Notes**
  - [ ] Document database migrations required
  - [ ] Document environment variable changes
  - [ ] Document breaking API changes (if any)
  - [ ] Create migration guide for existing deployments

### Security Review

- [ ] **Security Audit**
  - [ ] Review OWASP ASVS checklist (`docs/THREAT_MODEL.md`)
  - [ ] Verify RBAC implementation
  - [ ] Verify API key scopes enforcement
  - [ ] Verify rate limiting is active
  - [ ] Verify CSRF protection is enabled
  - [ ] Verify session security (HTTP-only, Secure, SameSite)
  - [ ] Verify audit logging is comprehensive
  - [ ] Review SQL injection prevention (Prisma parameterization)
  - [ ] Review XSS prevention (input sanitization)
  - [ ] Verify secrets are not hardcoded

- [ ] **Secrets Management**
  - [ ] Rotate all development secrets
  - [ ] Verify production secrets are in DO Secrets Manager / KMS (placeholder)
  - [ ] Document secret rotation procedure
  - [ ] Verify `.env` files are in `.gitignore`
  - [ ] Verify no secrets in commit history (use `git-secrets` or similar)
  - [ ] Update `env.example` files with placeholders only

- [ ] **Dependencies**
  - [ ] Run `pnpm audit` and fix critical vulnerabilities
  - [ ] Update dependencies to latest stable versions
  - [ ] Document any security-related dependency updates

### Observability & Monitoring

- [ ] **Dashboards Ready**
  - [ ] Grafana dashboards configured:
    - [ ] API metrics (request rate, latency, error rate)
    - [ ] Database metrics (query time, connections, slow queries)
    - [ ] Redis metrics (memory, connections, pub/sub rate)
    - [ ] System metrics (CPU, memory, disk, network)
  - [ ] Prometheus targets configured
  - [ ] Alert rules defined:
    - [ ] High error rate (>5%)
    - [ ] High latency (p95 >500ms)
    - [ ] Database connection pool exhaustion
    - [ ] Redis memory usage >80%
    - [ ] Disk usage >85%

- [ ] **Logging**
  - [ ] Structured logging configured (Pino)
  - [ ] Log levels appropriate for production
  - [ ] Log aggregation configured (if applicable)
  - [ ] Sensitive data not logged (PII, secrets)

- [ ] **Tracing**
  - [ ] OpenTelemetry configured
  - [ ] Jaeger endpoint configured
  - [ ] Trace sampling rate set appropriately

### Demo & Testing

- [ ] **Demo Tenant Seeded**
  - [ ] Run `pnpm db:seed:demo` successfully
  - [ ] Verify demo data includes:
    - [ ] 7 days of synthetic calls
    - [ ] Buyers and publishers
    - [ ] Campaigns and flows
    - [ ] Invoices and transcripts
  - [ ] Verify demo mode toggle works in UI
  - [ ] Verify demo data displays correctly in dashboards

- [ ] **End-to-End Testing**
  - [ ] API health check passes
  - [ ] Web UI loads and displays data
  - [ ] Authentication flow works
  - [ ] API key authentication works
  - [ ] Demo mode toggle works
  - [ ] Screenshot export works
  - [ ] Number provisioning works (local adapter)
  - [ ] Quota enforcement works
  - [ ] Audit logging captures events

- [ ] **Performance Tests**
  - [ ] k6 tests run successfully
  - [ ] Baseline results documented in `docs/PERF.md`
  - [ ] No performance regressions

### Pricing & Billing

- [ ] **Pricing Toggles Stubbed**
  - [ ] Rate card API endpoints functional
  - [ ] Rate card UI allows configuration
  - [ ] Billing calculation logic works
  - [ ] Invoice generation works
  - [ ] Pricing is configurable (not hardcoded)
  - [ ] Document that rates are set per tenant via rate cards

### Infrastructure

- [ ] **Docker Images**
  - [ ] Dockerfiles build successfully
  - [ ] Images tagged with `v0.1.0`
  - [ ] Images pushed to GHCR
  - [ ] `docker-compose.dev.yml` works locally
  - [ ] `docker-compose.prod.yml` configured for production

- [ ] **CI/CD**
  - [ ] PR workflow passes
  - [ ] Release workflow configured
  - [ ] Docker images build in CI
  - [ ] Tests pass in CI

- [ ] **Documentation**
  - [ ] README updated
  - [ ] API documentation updated
  - [ ] Architecture diagrams updated
  - [ ] Runbooks complete (`docs/BACKUP_RESTORE.md`, `docs/BLUE_GREEN_DEPLOYMENT.md`, etc.)

---

## Release Process

### Tagging & Building

- [ ] **Create Release Tag**

  ```bash
  git tag -a v0.1.0 -m "Release v0.1.0"
  git push origin v0.1.0
  ```

- [ ] **Trigger Release Workflow**
  - [ ] Verify GitHub Actions release workflow runs
  - [ ] Verify Docker images are built and pushed
  - [ ] Verify SDK is published to npm (if applicable)

- [ ] **Verify Artifacts**
  - [ ] Docker images available in GHCR
  - [ ] Release notes created on GitHub
  - [ ] Assets attached to release

### Deployment

- [ ] **Pre-Deployment Checks**
  - [ ] Database migrations tested
  - [ ] Backup created
  - [ ] Rollback plan documented

- [ ] **Deploy to Staging** (if applicable)
  - [ ] Deploy using `docker-compose.prod.yml`
  - [ ] Run smoke tests
  - [ ] Verify observability dashboards

- [ ] **Deploy to Production**
  - [ ] Follow blue/green deployment guide (`docs/BLUE_GREEN_DEPLOYMENT.md`)
  - [ ] Monitor metrics during deployment
  - [ ] Verify health checks pass
  - [ ] Run smoke tests

### Post-Release

- [ ] **Verification**
  - [ ] Demo tenant accessible
  - [ ] Demo mode works end-to-end
  - [ ] API endpoints respond correctly
  - [ ] Web UI loads correctly
  - [ ] Observability dashboards show data

- [ ] **Communication**
  - [ ] Announce release internally
  - [ ] Update changelog publicly
  - [ ] Document any known issues

- [ ] **Monitoring**
  - [ ] Monitor error rates for 24 hours
  - [ ] Monitor performance metrics
  - [ ] Review audit logs for anomalies

---

## Success Criteria

✅ **v0.1.0 Release is Successful When:**

1. ✅ v0.1.0 tag created and pushed
2. ✅ Docker images built and pushed to GHCR
3. ✅ Demo tenant seeded with 7 days of data
4. ✅ Demo mode works end-to-end:
   - [ ] Toggle switches between live/demo data
   - [ ] Dashboard displays demo data
   - [ ] Screenshot export works
5. ✅ All security checks pass
6. ✅ Observability dashboards show metrics
7. ✅ Performance baselines documented
8. ✅ Documentation complete

---

## Rollback Plan

If critical issues are discovered post-release:

1. **Immediate Actions:**
   - [ ] Identify issue severity
   - [ ] Notify team
   - [ ] Document issue

2. **Rollback Steps:**
   - [ ] Revert to previous version tag
   - [ ] Restore database backup (if needed)
   - [ ] Redeploy previous Docker images
   - [ ] Verify rollback successful

3. **Post-Rollback:**
   - [ ] Document root cause
   - [ ] Create postmortem (`docs/POSTMORTEM_TEMPLATE.md`)
   - [ ] Plan fix for next release

---

## Notes

- **Pricing:** Rate cards are fully configurable per tenant. No hardcoded pricing.
- **Multi-tenancy:** All features are tenant-aware with proper isolation.
- **Auditability:** All entity changes are logged to `audit_logs` table.
- **Secrets:** Production secrets should be loaded from DO Secrets Manager / KMS (placeholder implemented).

---

**Last Updated:** [Date]  
**Next Review:** [Date]
