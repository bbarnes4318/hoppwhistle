# Docker Compose Setup

One-command local development and production deployment for Hopwhistle.

## Quick Start

### Development Mode

```bash
# Start all services
make up

# Or manually:
docker-compose -f docker-compose.dev.yml up -d
```

### Production Mode

```bash
# Start in production mode (with scaling and resource limits)
ENV=prod make up

# Or manually:
docker-compose -f docker-compose.dev.yml -f docker-compose.prod.yml up -d
```

## Available Commands

See all available commands:

```bash
make help
```

### Common Commands

- `make up` - Start all services
- `make down` - Stop all services
- `make restart` - Restart all services
- `make logs` - View logs from all services
- `make seed` - Seed the database
- `make migrate` - Run database migrations
- `make ps` - Show running services
- `make health` - Check service health

### Service-Specific Logs

- `make logs-api` - View API logs
- `make logs-web` - View Web logs
- `make logs-worker` - View Worker logs
- `make logs-freeswitch` - View FreeSWITCH logs

### Shell Access

- `make shell-api` - Open shell in API container
- `make shell-postgres` - Open PostgreSQL shell
- `make shell-redis` - Open Redis CLI

## Services

### Development Stack (`docker-compose.dev.yml`)

| Service        | Port               | Description              |
| -------------- | ------------------ | ------------------------ |
| **PostgreSQL** | 5432               | Primary database         |
| **Redis**      | 6379               | Cache and session store  |
| **MinIO**      | 9000, 9001         | S3-compatible storage    |
| **ClickHouse** | 8123, 9000         | Analytics database       |
| **API**        | 3001               | Backend API service      |
| **Web**        | 3000               | Next.js frontend         |
| **Worker**     | 9091               | Background job processor |
| **FreeSWITCH** | 5060, 5080, 8021   | SIP server               |
| **Kamailio**   | 5060, 5061         | SIP proxy                |
| **RTPEngine**  | 22222, 10000-20000 | RTP media proxy          |
| **Prometheus** | 9090               | Metrics collection       |
| **Grafana**    | 3002               | Metrics visualization    |

### Production Stack (`docker-compose.prod.yml`)

Production mode adds:

- **Scaling**: API (3 replicas), Web (2), Worker (5), FreeSWITCH (2), Kamailio (2), RTPEngine (2)
- **Resource Limits**: CPU and memory limits per service
- **Distinct Networks**: Frontend, backend, telephony, observability
- **Restart Policies**: Automatic restart on failure
- **Health Checks**: Enhanced health monitoring

## Configuration

### Environment Variables

Create a `.env` file in `infra/docker/` or set environment variables:

```bash
# Database
POSTGRES_USER=callfabric
POSTGRES_PASSWORD=your-secure-password
POSTGRES_DB=callfabric

# Redis
REDIS_PASSWORD=your-redis-password

# API
JWT_SECRET=your-jwt-secret
API_KEY=your-api-key

# FreeSWITCH
FREESWITCH_ESL_PASSWORD=ClueCon

# MinIO
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin

# Grafana
GRAFANA_USER=admin
GRAFANA_PASSWORD=admin
```

### Service Dependencies

Services start in this order:

1. **Infrastructure**: PostgreSQL, Redis, MinIO, ClickHouse
2. **Application**: API, Worker
3. **Frontend**: Web
4. **Telephony**: FreeSWITCH, RTPEngine, Kamailio
5. **Observability**: Prometheus, Grafana

## Development Workflow

### First Time Setup

```bash
# 1. Start services
make up

# 2. Wait for services to be ready (check health)
make health

# 3. Run migrations
make migrate

# 4. Seed database
make seed

# 5. Access services
# - Web: http://localhost:3000
# - API: http://localhost:3001
# - Grafana: http://localhost:3002
# - Prometheus: http://localhost:9090
```

### Daily Development

```bash
# Start services
make up

# View logs
make logs

# Stop services
make down
```

### Database Management

```bash
# Run migrations
make migrate

# Seed database
make seed

# Access PostgreSQL shell
make shell-postgres

# Access Redis CLI
make shell-redis
```

## Production Deployment

### Prerequisites

1. Set all environment variables securely
2. Configure resource limits based on your infrastructure
3. Set up volume backups
4. Configure monitoring and alerting

### Deploy

```bash
# Start production stack
ENV=prod make up

# View production logs
ENV=prod make logs

# Check production health
ENV=prod make health
```

### Scaling

Production compose file includes scaling:

- API: 3 replicas
- Web: 2 replicas
- Worker: 5 replicas
- FreeSWITCH: 2 replicas
- Kamailio: 2 replicas
- RTPEngine: 2 replicas

Adjust replicas in `docker-compose.prod.yml`:

```yaml
api:
  deploy:
    replicas: 5 # Increase API replicas
```

## Troubleshooting

### Services Won't Start

```bash
# Check logs
make logs

# Check service status
make ps

# Check health
make health
```

### Database Connection Issues

```bash
# Verify PostgreSQL is running
docker-compose -f docker-compose.dev.yml ps postgres

# Check PostgreSQL logs
docker-compose -f docker-compose.dev.yml logs postgres

# Test connection
make shell-postgres
```

### Port Conflicts

If ports are already in use, modify ports in `docker-compose.dev.yml`:

```yaml
api:
  ports:
    - '3002:3001' # Change external port
```

### Clean Slate

```bash
# Remove all containers, volumes, and networks
make clean

# Start fresh
make up
```

## Volumes

Data is persisted in Docker volumes:

- `postgres_data` - PostgreSQL data
- `redis_data` - Redis data
- `minio_data` - MinIO storage
- `clickhouse_data` - ClickHouse data
- `freeswitch_recordings` - Call recordings
- `prometheus_data` - Metrics data
- `grafana_data` - Grafana dashboards

### Backup Volumes

```bash
# Backup PostgreSQL
docker run --rm -v hopwhistle_postgres_data:/data -v $(pwd):/backup \
  alpine tar czf /backup/postgres_backup.tar.gz -C /data .

# Backup Redis
docker run --rm -v hopwhistle_redis_data:/data -v $(pwd):/backup \
  alpine tar czf /backup/redis_backup.tar.gz -C /data .
```

## Networks

### Development

- Single network: `hopwhistle-network`

### Production

- `frontend-network` - Web services
- `backend-network` - API, Worker, databases
- `telephony-network` - SIP infrastructure
- `observability-network` - Monitoring

## Resource Limits

Production mode includes resource limits. Adjust in `docker-compose.prod.yml`:

```yaml
api:
  deploy:
    resources:
      limits:
        cpus: '2' # Max CPUs
        memory: 2G # Max memory
      reservations:
        cpus: '1' # Reserved CPUs
        memory: 1G # Reserved memory
```

## Monitoring

### Prometheus

Access at: http://localhost:9090

Metrics endpoints:

- API: http://api:3001/metrics
- Worker: http://worker:9091/metrics

### Grafana

Access at: http://localhost:3002

- Username: `admin`
- Password: `admin` (change in production!)

Pre-configured dashboards:

- API Metrics
- Call Metrics
- System Metrics
- Worker Metrics

## Security Notes

⚠️ **Development Mode**: Uses default passwords and insecure settings.

✅ **Production Mode**:

- Change all default passwords
- Use secrets management (Docker Secrets, Vault, etc.)
- Enable TLS for all services
- Configure firewall rules
- Use private networks
- Enable authentication for all services

## Support

For issues or questions:

1. Check logs: `make logs`
2. Check health: `make health`
3. Review service status: `make ps`
4. Check documentation in each service directory
