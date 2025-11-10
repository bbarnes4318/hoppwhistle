# Service Level Objectives (SLOs)

## Overview

This document defines Service Level Objectives (SLOs) for Hopwhistle services. SLOs are measurable goals for service reliability and performance.

## SLO Definitions

### Availability SLO

**Target**: 99.9% uptime (8.76 hours downtime/year)

**Measurement**:

- **Method**: Successful health check responses
- **Window**: Rolling 30-day period
- **Formula**: `(total_requests - failed_requests) / total_requests * 100`

**Health Check Endpoints**:

- API: `GET /health` (must return 200 OK)
- Web: `GET /api/health` (must return 200 OK)
- Worker: `GET /health` (must return 200 OK)

**Exclusions**:

- Planned maintenance (announced 48 hours in advance)
- External dependencies (SIP providers, payment processors)
- DDoS attacks exceeding 10x normal traffic

### Transcription Latency SLO

**Target**: 95% of transcriptions complete within 30 seconds

**Measurement**:

- **Method**: Time from call end to transcription available
- **Window**: Rolling 7-day period
- **Percentile**: p95 (95th percentile)

**Formula**: `p95(transcription_completion_time) <= 30 seconds`

**Breakdown by Call Duration**:

- Calls < 1 minute: p95 <= 10 seconds
- Calls 1-5 minutes: p95 <= 20 seconds
- Calls > 5 minutes: p95 <= 30 seconds

### Billing Latency SLO

**Target**: 99% of billing events processed within 5 minutes

**Measurement**:

- **Method**: Time from call end to billing record created
- **Window**: Rolling 7-day period
- **Percentile**: p99 (99th percentile)

**Formula**: `p99(billing_processing_time) <= 5 minutes`

**Billing Events**:

- Call completion
- Recording storage
- Transcription processing
- Number provisioning

### API Latency SLO

**Target**: 95% of API requests complete within 500ms

**Measurement**:

- **Method**: End-to-end request latency
- **Window**: Rolling 7-day period
- **Percentile**: p95 (95th percentile)

**Formula**: `p95(api_request_latency) <= 500ms`

**Breakdown by Endpoint**:

- `GET /api/v1/calls`: p95 <= 200ms
- `POST /api/v1/calls`: p95 <= 500ms
- `GET /api/v1/calls/:id`: p95 <= 150ms
- `GET /api/v1/calls/:id/recording`: p95 <= 1000ms

### Error Rate SLO

**Target**: Error rate < 0.1% (99.9% success rate)

**Measurement**:

- **Method**: HTTP 5xx errors / total requests
- **Window**: Rolling 7-day period
- **Formula**: `(5xx_errors / total_requests) * 100 < 0.1%`

**Exclusions**:

- 4xx errors (client errors)
- Rate limit errors (429)
- Authentication failures (401)

## SLO Monitoring

### Prometheus Queries

```promql
# Availability SLO
sum(rate(http_requests_total{status=~"2..|3.."}[30d]))
/
sum(rate(http_requests_total[30d]))
>= 0.999

# Transcription Latency SLO
histogram_quantile(0.95,
  rate(transcription_duration_seconds_bucket[7d])
) <= 30

# Billing Latency SLO
histogram_quantile(0.99,
  rate(billing_processing_seconds_bucket[7d])
) <= 300

# API Latency SLO
histogram_quantile(0.95,
  rate(http_request_duration_seconds_bucket{job="api"}[7d])
) <= 0.5

# Error Rate SLO
sum(rate(http_requests_total{status=~"5.."}[7d]))
/
sum(rate(http_requests_total[7d]))
< 0.001
```

### Grafana Dashboards

1. **SLO Overview Dashboard**
   - Current SLO status for all services
   - 30-day rolling window
   - Error budget remaining

2. **Availability Dashboard**
   - Uptime percentage
   - Downtime incidents
   - Health check status

3. **Latency Dashboard**
   - p50, p95, p99 latencies
   - Breakdown by endpoint
   - Historical trends

4. **Error Rate Dashboard**
   - Error rate by service
   - Error breakdown by type
   - 5xx vs 4xx errors

## Error Budgets

**Error Budget**: 0.1% of total requests (for 99.9% availability)

**Calculation**:

```
Error Budget = Total Requests * 0.001
Remaining Budget = Error Budget - Actual Errors
```

**Error Budget Policy**:

- **Green** (> 50% remaining): Normal operations
- **Yellow** (25-50% remaining): Review recent changes, increase monitoring
- **Red** (< 25% remaining): Freeze deployments, investigate issues
- **Exhausted** (0% remaining): Emergency response, postmortem required

## SLO Violations

### Severity Levels

| Severity | Availability | Action Required                         |
| -------- | ------------ | --------------------------------------- |
| **P0**   | < 99.0%      | Immediate response, all-hands           |
| **P1**   | < 99.5%      | On-call response, escalation            |
| **P2**   | < 99.7%      | Review during business hours            |
| **P3**   | < 99.9%      | Monitor, investigate if trend continues |

### Response Procedures

1. **Detection**: Automated alerts fire when SLO drops below threshold
2. **Assessment**: On-call engineer assesses severity
3. **Response**: Execute incident response procedures
4. **Postmortem**: Conduct postmortem for P0/P1 violations
5. **Remediation**: Implement fixes to prevent recurrence

## Historical SLO Performance

### Q4 2024

| Service | Availability | Transcription Latency | Billing Latency | API Latency | Error Rate |
| ------- | ------------ | --------------------- | --------------- | ----------- | ---------- |
| API     | 99.92%       | N/A                   | 4.2 min (p99)   | 380ms (p95) | 0.08%      |
| Web     | 99.88%       | N/A                   | N/A             | 250ms (p95) | 0.12%      |
| Worker  | 99.95%       | 28s (p95)             | 3.8 min (p99)   | N/A         | 0.05%      |

### Targets vs Actual

| Metric                | Target      | Q4 2024 Actual | Status      |
| --------------------- | ----------- | -------------- | ----------- |
| Availability          | 99.9%       | 99.92%         | ✅ Exceeded |
| Transcription Latency | 30s (p95)   | 28s (p95)      | ✅ Met      |
| Billing Latency       | 5 min (p99) | 4.2 min (p99)  | ✅ Met      |
| API Latency           | 500ms (p95) | 380ms (p95)    | ✅ Met      |
| Error Rate            | < 0.1%      | 0.08%          | ✅ Met      |

## SLO Review Process

### Quarterly Review

1. **Review Historical Performance**
   - Analyze SLO metrics for past quarter
   - Identify trends and patterns
   - Compare targets vs actuals

2. **Adjust Targets** (if needed)
   - Based on business requirements
   - Based on technical capabilities
   - Based on customer expectations

3. **Update Monitoring**
   - Refine Prometheus queries
   - Update Grafana dashboards
   - Adjust alert thresholds

4. **Document Changes**
   - Update this document
   - Communicate to stakeholders
   - Update runbooks

## Customer-Facing SLAs

**Note**: SLAs (Service Level Agreements) are contractual commitments to customers. SLOs are internal targets that should exceed SLAs.

| SLA Tier       | Availability | Response Time | Support    |
| -------------- | ------------ | ------------- | ---------- |
| **Free**       | 99.5%        | Best effort   | Community  |
| **Pro**        | 99.9%        | < 4 hours     | Email      |
| **Enterprise** | 99.95%       | < 1 hour      | 24/7 Phone |

## References

- [Google SRE Book - SLIs, SLOs, and SLAs](https://sre.google/sre-book/service-level-objectives/)
- [Prometheus SLO Examples](https://prometheus.io/docs/practices/histograms/)
- [Grafana SLO Dashboard](https://grafana.com/docs/grafana/latest/dashboards/)
