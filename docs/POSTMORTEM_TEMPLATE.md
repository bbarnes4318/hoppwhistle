# Postmortem Template

## Incident Information

**Incident ID**: `INC-YYYY-MMDD-HHMM`  
**Date**: YYYY-MM-DD  
**Time**: HH:MM UTC  
**Duration**: X hours Y minutes  
**Severity**: [P0/P1/P2/P3]  
**Status**: [Resolved/Investigating/Mitigated]

## Summary

**What happened?** (2-3 sentence summary)

**Impact**:

- **Users Affected**: X% of users / X customers
- **Service Degradation**: [Full outage / Partial outage / Degraded performance]
- **Revenue Impact**: $X (if applicable)
- **SLO Impact**: [Availability / Latency / Error Rate]

## Timeline

| Time (UTC) | Event                 | Action Taken                  |
| ---------- | --------------------- | ----------------------------- |
| HH:MM      | Initial detection     | Alert fired, on-call paged    |
| HH:MM      | Investigation started | Team assembled, logs reviewed |
| HH:MM      | Root cause identified | [Description]                 |
| HH:MM      | Mitigation applied    | [Description]                 |
| HH:MM      | Service restored      | Health checks passing         |
| HH:MM      | Post-incident review  | Team debrief                  |

## Root Cause

**Primary Cause**: [Detailed explanation]

**Contributing Factors**:

1. [Factor 1]
2. [Factor 2]
3. [Factor 3]

**Why did it happen?**

- [Technical reason]
- [Process reason]
- [Human factor]

## Detection

**How was the incident detected?**

- [ ] Automated alerting (Prometheus/Grafana)
- [ ] User reports
- [ ] Monitoring dashboard
- [ ] Manual testing
- [ ] Other: [specify]

**Detection Time**: X minutes after incident start

**Why wasn't it detected earlier?**

- [Explanation]

## Impact Analysis

### Availability Impact

| Service | Normal Uptime | Incident Uptime | Impact |
| ------- | ------------- | --------------- | ------ |
| API     | 99.9%         | 95.2%           | -4.7%  |
| Web     | 99.9%         | 98.1%           | -1.8%  |
| Worker  | 99.9%         | 99.5%           | -0.4%  |

### Latency Impact

| Endpoint           | Normal p95 | Incident p95 | Increase |
| ------------------ | ---------- | ------------ | -------- |
| POST /api/v1/calls | 200ms      | 5000ms       | 25x      |
| GET /api/v1/calls  | 150ms      | 800ms        | 5.3x     |

### Error Rate Impact

| Service | Normal Error Rate | Incident Error Rate |
| ------- | ----------------- | ------------------- |
| API     | 0.01%             | 15.3%               |
| Web     | 0.05%             | 2.1%                |

## Resolution

**What was done to resolve the incident?**

1. **Immediate Actions**:
   - [Action 1]
   - [Action 2]

2. **Long-term Fixes**:
   - [Fix 1]
   - [Fix 2]

**Time to Resolution**: X hours Y minutes

## Lessons Learned

### What Went Well

- [Positive aspect 1]
- [Positive aspect 2]
- [Positive aspect 3]

### What Went Wrong

- [Issue 1]
- [Issue 2]
- [Issue 3]

### What We Learned

- [Learning 1]
- [Learning 2]
- [Learning 3]

## Action Items

| ID     | Action Item          | Owner   | Priority   | Due Date   | Status                  |
| ------ | -------------------- | ------- | ---------- | ---------- | ----------------------- |
| AI-001 | [Action description] | [Owner] | [P0/P1/P2] | YYYY-MM-DD | [Open/In Progress/Done] |
| AI-002 | [Action description] | [Owner] | [P0/P1/P2] | YYYY-MM-DD | [Open/In Progress/Done] |

### High Priority (P0)

- [ ] [Action item 1]
- [ ] [Action item 2]

### Medium Priority (P1)

- [ ] [Action item 1]
- [ ] [Action item 2]

### Low Priority (P2)

- [ ] [Action item 1]
- [ ] [Action item 2]

## Prevention

**How can we prevent this from happening again?**

1. **Technical Improvements**:
   - [Improvement 1]
   - [Improvement 2]

2. **Process Improvements**:
   - [Improvement 1]
   - [Improvement 2]

3. **Monitoring Improvements**:
   - [Improvement 1]
   - [Improvement 2]

## Metrics & Data

### Graphs & Charts

- [Link to Grafana dashboard]
- [Link to error logs]
- [Link to performance metrics]

### Key Metrics

```json
{
  "incident_start": "2024-01-15T14:30:00Z",
  "incident_end": "2024-01-15T16:45:00Z",
  "duration_minutes": 135,
  "calls_failed": 1234,
  "calls_succeeded": 5678,
  "error_rate_peak": 15.3,
  "p95_latency_peak_ms": 5000,
  "database_connections_peak": 150,
  "cpu_utilization_peak": 95
}
```

## Related Incidents

- [INC-YYYY-MMDD-XXXX] - Similar issue on [date]
- [INC-YYYY-MMDD-XXXX] - Related root cause

## Sign-off

**Incident Commander**: [Name]  
**Technical Lead**: [Name]  
**Postmortem Author**: [Name]  
**Review Date**: YYYY-MM-DD

---

## Example: Database Connection Pool Exhaustion

### Incident Information

**Incident ID**: `INC-2024-0115-1430`  
**Date**: 2024-01-15  
**Time**: 14:30 UTC  
**Duration**: 2 hours 15 minutes  
**Severity**: P1  
**Status**: Resolved

### Summary

During peak traffic, the API service exhausted its database connection pool, causing 15% of API requests to fail with 503 errors. The issue was caused by a slow query that held connections longer than expected, combined with insufficient connection pool sizing.

**Impact**:

- **Users Affected**: ~15% of API requests failed
- **Service Degradation**: Partial outage
- **SLO Impact**: Availability dropped from 99.9% to 95.2%

### Timeline

| Time (UTC) | Event                    | Action Taken                                   |
| ---------- | ------------------------ | ---------------------------------------------- |
| 14:30      | High error rate detected | Alert fired, on-call paged                     |
| 14:35      | Investigation started    | Team assembled, logs reviewed                  |
| 14:45      | Root cause identified    | Slow query in call routing logic               |
| 15:00      | Mitigation applied       | Increased connection pool, killed slow queries |
| 15:15      | Service restored         | Health checks passing                          |
| 16:45      | Post-incident review     | Team debrief                                   |

### Root Cause

**Primary Cause**: A complex JOIN query in the call routing logic was taking 5-10 seconds to execute, holding database connections. During peak traffic (100 req/s), the 20-connection pool was exhausted.

**Contributing Factors**:

1. Missing database index on `campaigns.tenant_id`
2. Connection pool size too small (20 connections)
3. No query timeout configured
4. No alerting on connection pool usage

### Resolution

1. **Immediate Actions**:
   - Increased connection pool from 20 to 50
   - Killed slow-running queries
   - Added query timeout (5 seconds)

2. **Long-term Fixes**:
   - Added database index on `campaigns.tenant_id`
   - Optimized JOIN query
   - Added connection pool monitoring
   - Implemented query timeout globally

### Action Items

| ID     | Action Item                      | Owner         | Priority | Due Date   | Status      |
| ------ | -------------------------------- | ------------- | -------- | ---------- | ----------- |
| AI-001 | Add index on campaigns.tenant_id | DB Team       | P0       | 2024-01-16 | Done        |
| AI-002 | Optimize call routing query      | API Team      | P0       | 2024-01-17 | Done        |
| AI-003 | Add connection pool monitoring   | Platform Team | P1       | 2024-01-20 | In Progress |
| AI-004 | Review all slow queries          | DB Team       | P1       | 2024-01-25 | Open        |
