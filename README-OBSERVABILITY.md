# Observability Quick Start

## Start Observability Stack

```bash
cd infra/docker
docker-compose -f docker-compose.observability.yml up -d
```

## Access Dashboards

- **Grafana**: http://localhost:3000 (admin/admin)
- **Prometheus**: http://localhost:9090
- **Jaeger**: http://localhost:16686

## Verify Setup

```bash
# Check API health
curl http://localhost:3001/health/ready

# Check metrics
curl http://localhost:3001/metrics

# Check worker metrics
curl http://localhost:9091/metrics
```

## Documentation

- Full observability guide: [docs/OBSERVABILITY.md](docs/OBSERVABILITY.md)
- Runbooks: [docs/runbooks/README.md](docs/runbooks/README.md)
