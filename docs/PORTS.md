# Port Reference Guide

This document lists all ports used by the Hopwhistle platform.

## Application Ports

| Service        | Port | Protocol | Description                 |
| -------------- | ---- | -------- | --------------------------- |
| API            | 3001 | HTTP     | Fastify API server          |
| Web            | 3000 | HTTP     | Next.js web application     |
| Worker Metrics | 9091 | HTTP     | Prometheus metrics endpoint |

## Database Ports

| Service           | Port | Protocol | Description              |
| ----------------- | ---- | -------- | ------------------------ |
| PostgreSQL        | 5432 | TCP      | Primary database         |
| Redis             | 6379 | TCP      | Cache, sessions, pub/sub |
| ClickHouse HTTP   | 8123 | HTTP     | Analytics queries        |
| ClickHouse Native | 9000 | TCP      | Native protocol          |

## Storage Ports

| Service       | Port | Protocol | Description       |
| ------------- | ---- | -------- | ----------------- |
| MinIO API     | 9000 | HTTP     | S3-compatible API |
| MinIO Console | 9001 | HTTP     | Web UI            |

## SIP/VoIP Ports

| Service              | Port        | Protocol | Description          |
| -------------------- | ----------- | -------- | -------------------- |
| Kamailio SIP UDP/TCP | 5060        | UDP/TCP  | Standard SIP         |
| Kamailio SIP TLS     | 5061        | TCP      | Secure SIP (TLS)     |
| FreeSWITCH SIP       | 5080        | UDP/TCP  | SIP endpoint         |
| FreeSWITCH SIP TLS   | 5081        | TCP      | Secure SIP (TLS)     |
| FreeSWITCH ESL       | 8021        | TCP      | Event Socket Library |
| RTPEngine Control    | 22222       | UDP/TCP  | Control interface    |
| RTPEngine RTP        | 10000-20000 | UDP      | RTP media streams    |

## Observability Ports

| Service     | Port  | Protocol | Description                     |
| ----------- | ----- | -------- | ------------------------------- |
| Prometheus  | 9090  | HTTP     | Metrics collection              |
| Grafana     | 3000  | HTTP     | Dashboards (conflicts with Web) |
| Jaeger HTTP | 14268 | HTTP     | Trace collection                |
| Jaeger UDP  | 6831  | UDP      | Trace collection (thrift)       |
| Jaeger UDP  | 6832  | UDP      | Trace collection (thrift)       |

## Port Conflicts

**Note:** Grafana (3000) conflicts with Web (3000). In Docker Compose, Grafana is typically mapped to a different host port (e.g., 3002).

## Firewall Rules

For production deployments, ensure these ports are accessible:

**Internal (Service-to-Service):**

- All database ports (5432, 6379, 8123, 9000)
- All SIP ports (5060, 5061, 5080, 5081, 8021)
- RTPEngine control (22222)

**External (Public Access):**

- API (3001) - Behind load balancer
- Web (3000) - Behind load balancer
- SIP (5060, 5061) - For SIP trunking
- RTPEngine RTP (10000-20000) - For media streams

**Monitoring (Internal/Admin):**

- Prometheus (9090)
- Grafana (3000/3002)
- Jaeger (14268)

## Docker Compose Port Mapping

In `docker-compose.dev.yml` and `docker-compose.prod.yml`, ports are mapped as:

```yaml
ports:
  - '3001:3001' # API
  - '3000:3000' # Web
  - '5432:5432' # PostgreSQL
  - '6379:6379' # Redis
  - '9000:9000' # MinIO API
  - '9001:9001' # MinIO Console
  - '5060:5060/udp' # Kamailio SIP
  - '5061:5061/tcp' # Kamailio SIP TLS
  - '5080:5080/udp' # FreeSWITCH SIP
  - '8021:8021' # FreeSWITCH ESL
  - '22222:22222/udp' # RTPEngine Control
  - '9090:9090' # Prometheus
  - '3002:3000' # Grafana (mapped to 3002 to avoid conflict)
```

## Security Notes

1. **Never expose database ports (5432, 6379) publicly**
2. **Use firewall rules to restrict access to internal services**
3. **Use TLS for SIP (5061) in production**
4. **Restrict RTPEngine port range (10000-20000) to known IPs**
5. **Use VPN or private networks for observability ports**
