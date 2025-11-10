# Runbooks

This directory contains operational runbooks for common incidents and procedures.

## Table of Contents

- [High API Error Rate](#high-api-error-rate)
- [Database Connection Issues](#database-connection-issues)
- [High Call Failure Rate](#high-call-failure-rate)
- [SIP Registration Failures](#sip-registration-failures)
- [RTP Media Issues](#rtp-media-issues)
- [Worker Job Failures](#worker-job-failures)
- [ClickHouse ETL Lag](#clickhouse-etl-lag)

## High API Error Rate

### Symptoms

- `http_request_errors_total` metric increasing rapidly
- High 5xx error rate in Grafana dashboard
- Users reporting API failures

### Investigation Steps

1. **Check Error Logs**

   ```bash
   # Filter logs by error level
   kubectl logs -f deployment/callfabric-api | grep '"level":"error"'

   # Or with Docker
   docker logs callfabric-api 2>&1 | grep ERROR
   ```

2. **Check Metrics**
   - Open Grafana dashboard: "CallFabric API Metrics"
   - Check "HTTP Error Rate" panel
   - Identify error types (server_error vs client_error)
   - Check which routes are failing

3. **Check Database Health**

   ```bash
   curl http://localhost:3001/health/ready
   ```

   Look for database latency or errors

4. **Check Resource Usage**

   ```bash
   # CPU/Memory
   docker stats callfabric-api

   # Or check Prometheus metrics
   # node_cpu_seconds_total
   # node_memory_MemAvailable_bytes
   ```

### Resolution Steps

1. **If Database Issues**
   - Check connection pool: `db_connections_active`
   - Restart database if needed
   - Check for slow queries

2. **If Memory Issues**
   - Check for memory leaks
   - Increase container memory limits
   - Restart service

3. **If Code Issues**
   - Check recent deployments
   - Review error logs for stack traces
   - Rollback if recent deployment

### Prevention

- Set up alerts for `rate(http_request_errors_total[5m]) > 10`
- Monitor database connection pool
- Set up resource limits

---

## Database Connection Issues

### Symptoms

- `/health/ready` shows database status as "error"
- High `db_query_duration_seconds`
- API requests timing out

### Investigation Steps

1. **Check Database Status**

   ```bash
   docker exec postgres pg_isready -U callfabric
   ```

2. **Check Connection Pool**

   ```bash
   # In Grafana, check db_connections_active metric
   # Or query directly:
   curl http://localhost:3001/metrics | grep db_connections
   ```

3. **Check Database Logs**

   ```bash
   docker logs postgres | tail -100
   ```

4. **Test Connection**
   ```bash
   docker exec -it postgres psql -U callfabric -d callfabric -c "SELECT 1"
   ```

### Resolution Steps

1. **If Database Down**

   ```bash
   docker restart postgres
   # Wait for health check to pass
   ```

2. **If Connection Pool Exhausted**
   - Check for connection leaks
   - Increase pool size in Prisma config
   - Restart API service

3. **If Slow Queries**
   - Check for missing indexes
   - Analyze slow query log
   - Optimize queries

### Prevention

- Set up alerts for `db_connections_active > 80`
- Monitor query duration p95
- Regular database maintenance

---

## High Call Failure Rate

### Symptoms

- High `calls_total{status="FAILED"}` rate
- Low ASR (Answer Seizure Ratio)
- Users reporting call failures

### Investigation Steps

1. **Check Call Metrics**

   ```bash
   # In Grafana, check:
   # - calls_total by status
   # - calls_duration_seconds
   # - ASR calculation: answered_calls / total_calls
   ```

2. **Check SIP Logs**

   ```bash
   docker logs kamailio | grep -i "failed\|error\|reject"
   docker logs freeswitch | grep -i "failed\|error"
   ```

3. **Check Carrier Status**
   - Verify carrier trunks are registered
   - Check carrier API status
   - Review rate limits

4. **Check Compliance**
   - Verify DNC lists are loaded
   - Check STIR/SHAKEN status
   - Review compliance service logs

### Resolution Steps

1. **If Carrier Issues**
   - Check carrier API status
   - Verify credentials
   - Contact carrier support

2. **If SIP Issues**
   - Check SIP registration status
   - Verify network connectivity
   - Check firewall rules

3. **If Compliance Issues**
   - Review compliance service logs
   - Check DNC list updates
   - Verify STIR/SHAKEN certificates

### Prevention

- Set up alerts for `rate(calls_total{status="FAILED"}[5m]) > 0.1`
- Monitor ASR trends
- Regular carrier health checks

---

## SIP Registration Failures

### Symptoms

- SIP trunks not registering
- Calls failing with "403 Forbidden"
- Kamailio/Freeswitch logs show registration failures

### Investigation Steps

1. **Check SIP Registration Status**

   ```bash
   docker exec kamailio kamctl ul show
   docker exec freeswitch fs_cli -x "sofia status"
   ```

2. **Check Network Connectivity**

   ```bash
   # Test SIP port
   telnet carrier-sip.example.com 5060

   # Check DNS resolution
   nslookup carrier-sip.example.com
   ```

3. **Check Authentication**
   - Verify SIP credentials in database
   - Check for credential rotation
   - Review authentication logs

### Resolution Steps

1. **If Network Issues**
   - Check firewall rules
   - Verify DNS resolution
   - Test network connectivity

2. **If Authentication Issues**
   - Verify credentials in database
   - Check credential format
   - Re-register trunks

3. **If Service Issues**
   ```bash
   docker restart kamailio
   docker restart freeswitch
   ```

### Prevention

- Set up alerts for SIP registration status
- Monitor SIP message rates
- Regular credential rotation

---

## RTP Media Issues

### Symptoms

- One-way audio
- Audio quality issues
- High packet loss

### Investigation Steps

1. **Check RTP Metrics**

   ```bash
   # In Grafana, check:
   # - rtp_packets_lost_total
   # - rtp_jitter_seconds
   # - rtp_packets_total
   ```

2. **Check RTPEngine Status**

   ```bash
   docker exec rtpengine rtpengine-ctl -t 127.0.0.1:9900 list
   ```

3. **Check Network**

   ```bash
   # Check UDP port range
   netstat -ulnp | grep 10000-20000

   # Check RTPEngine logs
   docker logs rtpengine | tail -100
   ```

### Resolution Steps

1. **If Port Issues**
   - Verify UDP port range is open
   - Check firewall rules
   - Restart RTPEngine

2. **If Network Issues**
   - Check network latency
   - Verify NAT traversal
   - Check STUN/TURN configuration

3. **If RTPEngine Issues**
   ```bash
   docker restart rtpengine
   ```

### Prevention

- Monitor RTP packet loss rate
- Set up alerts for high jitter
- Regular network health checks

---

## Worker Job Failures

### Symptoms

- High `worker_jobs_total{status="failed"}` rate
- Jobs stuck in queue
- ETL lag increasing

### Investigation Steps

1. **Check Worker Metrics**

   ```bash
   # In Grafana, check:
   # - worker_jobs_total by status
   # - worker_job_duration_seconds
   # - worker_jobs_active
   ```

2. **Check Worker Logs**

   ```bash
   docker logs callfabric-worker | grep -i "error\|failed"
   ```

3. **Check Job Queue**
   - Check Redis for stuck jobs
   - Verify worker is processing
   - Check job retry count

### Resolution Steps

1. **If Job Processing Issues**
   - Check worker resource usage
   - Verify dependencies (DB, Redis)
   - Restart worker service

2. **If ETL Issues**
   - Check ClickHouse connectivity
   - Verify ETL batch size
   - Check for data format issues

3. **If Resource Issues**
   - Increase worker resources
   - Scale worker instances
   - Optimize job processing

### Prevention

- Set up alerts for `rate(worker_jobs_total{status="failed"}[5m]) > 0.1`
- Monitor job duration
- Regular worker health checks

---

## ClickHouse ETL Lag

### Symptoms

- Analytics data is stale
- ETL processing duration increasing
- High `etl_processing_duration_seconds`

### Investigation Steps

1. **Check ETL Metrics**

   ```bash
   # In Grafana, check:
   # - etl_records_processed_total
   # - etl_processing_duration_seconds
   # - Compare with Postgres record count
   ```

2. **Check ClickHouse Status**

   ```bash
   curl http://localhost:8123/ping
   docker logs clickhouse | tail -100
   ```

3. **Check Postgres Load**
   ```bash
   # Check for slow queries
   docker exec postgres psql -U callfabric -c "
     SELECT pid, now() - query_start AS duration, query
     FROM pg_stat_activity
     WHERE state = 'active' AND query NOT LIKE '%pg_stat_activity%'
     ORDER BY duration DESC;
   "
   ```

### Resolution Steps

1. **If ClickHouse Issues**
   - Check ClickHouse disk space
   - Verify network connectivity
   - Restart ClickHouse if needed

2. **If Postgres Issues**
   - Optimize queries
   - Add indexes if needed
   - Increase ETL batch interval

3. **If Processing Lag**
   - Increase ETL batch size
   - Scale ETL workers
   - Optimize data transformation

### Prevention

- Set up alerts for ETL lag > 1 hour
- Monitor processing duration
- Regular ClickHouse maintenance

---

## General Troubleshooting Commands

### View Logs

```bash
# API
docker logs -f callfabric-api

# Worker
docker logs -f callfabric-worker

# All services
docker-compose logs -f
```

### Check Health

```bash
# API
curl http://localhost:3001/health/ready

# Worker (if exposing health endpoint)
curl http://localhost:9091/health
```

### View Metrics

```bash
# Prometheus
open http://localhost:9090

# Grafana
open http://localhost:3000 (admin/admin)

# Jaeger
open http://localhost:16686
```

### Database Queries

```bash
# Connect to Postgres
docker exec -it postgres psql -U callfabric -d callfabric

# Check recent errors
SELECT * FROM events WHERE type LIKE '%error%' ORDER BY created_at DESC LIMIT 10;
```
