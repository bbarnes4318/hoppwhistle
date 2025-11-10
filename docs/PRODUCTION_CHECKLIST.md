# Production Readiness Checklist

Use this checklist to verify production readiness before launching to paying customers.

## Security

- [ ] Threat model documented and reviewed
- [ ] OWASP ASVS Level 2 checklist completed
- [ ] All secrets stored in secure vault (not in code)
- [ ] TLS/SSL certificates configured and valid
- [ ] CSRF protection enabled
- [ ] Rate limiting configured
- [ ] API keys require scopes
- [ ] Audit logging enabled for all sensitive operations
- [ ] Security headers configured (HSTS, CSP, etc.)
- [ ] Dependencies scanned for vulnerabilities
- [ ] Penetration testing completed

## Infrastructure

- [ ] Database replication configured (primary + standby)
- [ ] Automated backups configured and tested
- [ ] Backup restore procedures tested
- [ ] Object storage replication configured
- [ ] Load balancer configured with health checks
- [ ] DNS configured with low TTL (300s or less)
- [ ] CDN configured (if applicable)
- [ ] Firewall rules configured
- [ ] Network segmentation implemented
- [ ] Resource limits configured (CPU, memory, disk)

## Monitoring & Observability

- [ ] Prometheus metrics configured
- [ ] Grafana dashboards created
- [ ] Alerting rules configured
- [ ] Log aggregation configured (ELK/Loki)
- [ ] Distributed tracing configured (Jaeger)
- [ ] Uptime monitoring configured
- [ ] Error tracking configured (Sentry)
- [ ] SLO monitoring configured
- [ ] On-call rotation configured

## Deployment

- [ ] CI/CD pipeline configured
- [ ] Blue/green deployment tested
- [ ] Rollback procedures tested
- [ ] Database migration strategy defined
- [ ] Feature flags configured
- [ ] Deployment runbooks documented
- [ ] Zero-downtime deployment verified

## Disaster Recovery

- [ ] DR plan documented
- [ ] Secondary region configured (Hetzner)
- [ ] Database replication to secondary tested
- [ ] Object storage replication tested
- [ ] Failover procedures tested
- [ ] Failback procedures tested
- [ ] DR drill completed successfully
- [ ] RTO/RPO targets met

## Data Protection

- [ ] Database encryption at rest enabled
- [ ] Object storage encryption enabled
- [ ] Data in transit encrypted (TLS)
- [ ] Backup encryption enabled
- [ ] PII masking in logs configured
- [ ] Data retention policies defined
- [ ] Data deletion procedures tested
- [ ] GDPR compliance verified (if applicable)

## Performance

- [ ] Load testing completed
- [ ] Performance benchmarks documented
- [ ] Database query optimization completed
- [ ] Caching strategy implemented
- [ ] CDN configured (if applicable)
- [ ] Connection pooling configured
- [ ] Rate limiting tuned
- [ ] SLO targets defined and monitored

## Documentation

- [ ] API documentation complete
- [ ] Runbooks documented
- [ ] Architecture diagrams updated
- [ ] Incident response procedures documented
- [ ] Postmortem template created
- [ ] Onboarding guide for new team members
- [ ] Customer-facing documentation complete

## Compliance

- [ ] SOC 2 Type II audit scheduled/completed
- [ ] GDPR compliance verified (if applicable)
- [ ] PCI DSS compliance verified (if handling payments)
- [ ] STIR/SHAKEN compliance verified
- [ ] TCPA compliance verified
- [ ] Privacy policy published
- [ ] Terms of service published

## Testing

- [ ] Unit test coverage > 80%
- [ ] Integration tests passing
- [ ] E2E tests passing
- [ ] Load tests passing
- [ ] Security tests passing
- [ ] DR tests passing
- [ ] Backup restore tests passing

## Support

- [ ] Support ticketing system configured
- [ ] Escalation procedures defined
- [ ] On-call rotation configured
- [ ] Status page configured
- [ ] Customer communication templates prepared
- [ ] Support documentation complete

## Financial

- [ ] Billing system tested
- [ ] Payment processing tested
- [ ] Invoice generation tested
- [ ] Quota enforcement tested
- [ ] Budget alerts tested
- [ ] Cost monitoring configured

## Sign-off

**Engineering Lead**: ********\_******** Date: **\_\_\_**

**Security Lead**: ********\_******** Date: **\_\_\_**

**Operations Lead**: ********\_******** Date: **\_\_\_**

**Product Lead**: ********\_******** Date: **\_\_\_**

---

## Quick Reference

- **Security Checklist**: [THREAT_MODEL.md](THREAT_MODEL.md)
- **Backup Procedures**: [BACKUP_RESTORE.md](BACKUP_RESTORE.md)
- **Deployment Guide**: [BLUE_GREEN_DEPLOYMENT.md](BLUE_GREEN_DEPLOYMENT.md)
- **DR Plan**: [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md)
- **SLOs**: [SLOS.md](SLOS.md)
