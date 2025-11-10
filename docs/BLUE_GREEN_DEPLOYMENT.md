# Blue/Green Deployment Guide

## Overview

Blue/Green deployment is a technique that reduces downtime and risk by running two identical production environments called Blue and Green. At any time, only one of the environments is live, serving all production traffic.

## Architecture

```
                    Load Balancer
                         |
        ┌----------------┴----------------┐
        |                                 |
    [Blue]                            [Green]
   (Active)                         (Standby)
        |                                 |
   ┌────┴────┐                      ┌────┴────┐
   │  API    │                      │  API    │
   │  Web    │                      │  Web    │
   │ Worker  │                      │ Worker  │
   └────┬────┘                      └────┬────┘
        |                                 |
   ┌────┴────┐                      ┌────┴────┐
   │   DB    │                      │   DB    │
   │  Redis  │                      │  Redis  │
   └─────────┘                      └─────────┘
```

## Prerequisites

- Load balancer with health checks
- Database replication or shared database
- Redis replication or shared Redis
- Shared object storage (MinIO/S3)
- DNS with low TTL (300 seconds or less)

## Deployment Process

### Step 1: Prepare Green Environment

```bash
#!/bin/bash
# scripts/prepare-green.sh

set -e

VERSION="$1"
GREEN_ENV="green"

if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version>"
  exit 1
fi

echo "🚀 Preparing Green environment for version $VERSION"

# 1. Pull new Docker images
docker pull ghcr.io/hopwhistle/hopwhistle/api:$VERSION
docker pull ghcr.io/hopwhistle/hopwhistle/web:$VERSION
docker pull ghcr.io/hopwhistle/hopwhistle/worker:$VERSION

# 2. Update docker-compose for green environment
cat > /opt/hopwhistle/green/docker-compose.yml <<EOF
version: '3.8'
services:
  api:
    image: ghcr.io/hopwhistle/hopwhistle/api:$VERSION
    environment:
      - NODE_ENV=production
      - DATABASE_URL=\${DATABASE_URL}
      - REDIS_URL=\${REDIS_URL}
    networks:
      - green-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  web:
    image: ghcr.io/hopwhistle/hopwhistle/web:$VERSION
    environment:
      - NODE_ENV=production
      - NEXT_PUBLIC_API_URL=\${API_URL}
    networks:
      - green-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 10s
      timeout: 5s
      retries: 3

  worker:
    image: ghcr.io/hopwhistle/hopwhistle/worker:$VERSION
    environment:
      - NODE_ENV=production
      - DATABASE_URL=\${DATABASE_URL}
      - REDIS_URL=\${REDIS_URL}
    networks:
      - green-network
EOF

# 3. Start green environment
cd /opt/hopwhistle/green
docker-compose up -d

echo "✅ Green environment prepared"
```

### Step 2: Run Database Migrations

```bash
#!/bin/bash
# scripts/migrate-green.sh

set -e

echo "📊 Running database migrations on Green environment"

# Run migrations in green environment
docker-compose -f /opt/hopwhistle/green/docker-compose.yml \
  exec -T api pnpm db:migrate:deploy

# Verify migrations
docker-compose -f /opt/hopwhistle/green/docker-compose.yml \
  exec -T api pnpm db:generate

echo "✅ Migrations completed"
```

### Step 3: Health Check Green Environment

```bash
#!/bin/bash
# scripts/health-check-green.sh

set -e

MAX_RETRIES=30
RETRY_INTERVAL=10

echo "🏥 Health checking Green environment"

for i in $(seq 1 $MAX_RETRIES); do
  echo "Attempt $i/$MAX_RETRIES..."

  # Check API health
  API_HEALTH=$(curl -sf http://green-api.hopwhistle.com/health || echo "FAIL")
  if [ "$API_HEALTH" = "FAIL" ]; then
    echo "❌ API health check failed"
    sleep $RETRY_INTERVAL
    continue
  fi

  # Check Web health
  WEB_HEALTH=$(curl -sf http://green-web.hopwhistle.com/api/health || echo "FAIL")
  if [ "$WEB_HEALTH" = "FAIL" ]; then
    echo "❌ Web health check failed"
    sleep $RETRY_INTERVAL
    continue
  fi

  # Check critical endpoints
  API_RESPONSE=$(curl -sf http://green-api.hopwhistle.com/api/v1/health || echo "FAIL")
  if [ "$API_RESPONSE" = "FAIL" ]; then
    echo "❌ API endpoint check failed"
    sleep $RETRY_INTERVAL
    continue
  fi

  echo "✅ All health checks passed"
  exit 0
done

echo "❌ Health checks failed after $MAX_RETRIES attempts"
exit 1
```

### Step 4: Smoke Tests

```bash
#!/bin/bash
# scripts/smoke-test-green.sh

set -e

echo "🧪 Running smoke tests on Green environment"

GREEN_API="http://green-api.hopwhistle.com"
TEST_TENANT_ID="test-tenant-$(date +%s)"

# 1. Test authentication
echo "1. Testing authentication..."
AUTH_RESPONSE=$(curl -s -X POST "$GREEN_API/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123"}')

if echo "$AUTH_RESPONSE" | grep -q "error"; then
  echo "❌ Authentication test failed"
  exit 1
fi
echo "✅ Authentication test passed"

# 2. Test API key creation
echo "2. Testing API key creation..."
API_KEY_RESPONSE=$(curl -s -X POST "$GREEN_API/admin/api/v1/api-keys" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"smoke-test","scopes":["calls:read"]}')

if echo "$API_KEY_RESPONSE" | grep -q "error"; then
  echo "❌ API key creation test failed"
  exit 1
fi
echo "✅ API key creation test passed"

# 3. Test call creation (with quota check)
echo "3. Testing call creation..."
CALL_RESPONSE=$(curl -s -X POST "$GREEN_API/api/v1/calls" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"toNumber":"+15551234567","estimatedMinutes":1}')

if echo "$CALL_RESPONSE" | grep -q "error"; then
  echo "❌ Call creation test failed"
  exit 1
fi
echo "✅ Call creation test passed"

# 4. Test web frontend
echo "4. Testing web frontend..."
WEB_RESPONSE=$(curl -s http://green-web.hopwhistle.com/ | head -20)

if echo "$WEB_RESPONSE" | grep -q "Hopwhistle"; then
  echo "✅ Web frontend test passed"
else
  echo "❌ Web frontend test failed"
  exit 1
fi

echo "✅ All smoke tests passed"
```

### Step 5: Switch Traffic to Green

```bash
#!/bin/bash
# scripts/switch-to-green.sh

set -e

echo "🔄 Switching traffic to Green environment"

# 1. Update load balancer backend pool
# DigitalOcean Load Balancer
doctl compute load-balancer update $LB_ID \
  --forwarding-rules entry_protocol:http,entry_port:80,target_protocol:http,target_port:3000,entry_protocol:https,entry_port:443,target_protocol:https,target_port:3000 \
  --health-check protocol:http,port:3000,path:/api/health,check_interval_seconds:10,response_timeout_seconds:5,healthy_threshold:3,unhealthy_threshold:5 \
  --sticky-sessions type:cookies,cookie_name:DO-LB-Session

# Or using Nginx/HAProxy config
cat > /etc/nginx/conf.d/hopwhistle.conf <<EOF
upstream hopwhistle_api {
    least_conn;
    server green-api.hopwhistle.com:3001 max_fails=3 fail_timeout=30s;
    server blue-api.hopwhistle.com:3001 backup;
}

upstream hopwhistle_web {
    least_conn;
    server green-web.hopwhistle.com:3000 max_fails=3 fail_timeout=30s;
    server blue-web.hopwhistle.com:3000 backup;
}

server {
    listen 80;
    server_name api.hopwhistle.com;

    location / {
        proxy_pass http://hopwhistle_api;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}

server {
    listen 80;
    server_name hopwhistle.com www.hopwhistle.com;

    location / {
        proxy_pass http://hopwhistle_web;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

# Reload Nginx
nginx -t && systemctl reload nginx

# 2. Update DNS (gradual traffic shift)
# Start with 10% traffic to green
# Gradually increase: 25% -> 50% -> 75% -> 100%

echo "✅ Traffic switched to Green"
```

### Step 6: Monitor Green Environment

```bash
#!/bin/bash
# scripts/monitor-green.sh

set -e

DURATION="${1:-300}"  # Monitor for 5 minutes by default

echo "📊 Monitoring Green environment for $DURATION seconds"

START_TIME=$(date +%s)
END_TIME=$((START_TIME + DURATION))

while [ $(date +%s) -lt $END_TIME ]; do
  # Check error rates
  ERROR_RATE=$(curl -s http://green-api.hopwhistle.com/metrics | \
    grep 'http_requests_total{status="5.."}' | \
    awk '{print $2}' | head -1)

  if [ -n "$ERROR_RATE" ] && [ "$ERROR_RATE" -gt 10 ]; then
    echo "⚠️  High error rate detected: $ERROR_RATE"
    # Optionally rollback
    # ./scripts/rollback-to-blue.sh
  fi

  # Check response times
  RESPONSE_TIME=$(curl -o /dev/null -s -w '%{time_total}' \
    http://green-api.hopwhistle.com/health)

  if (( $(echo "$RESPONSE_TIME > 1.0" | bc -l) )); then
    echo "⚠️  High response time: ${RESPONSE_TIME}s"
  fi

  sleep 10
done

echo "✅ Monitoring completed"
```

### Step 7: Rollback (if needed)

```bash
#!/bin/bash
# scripts/rollback-to-blue.sh

set -e

echo "⏪ Rolling back to Blue environment"

# 1. Switch load balancer back to Blue
doctl compute load-balancer update $LB_ID \
  --forwarding-rules entry_protocol:http,entry_port:80,target_protocol:http,target_port:3000 \
  --health-check protocol:http,port:3000,path:/api/health \
  --sticky-sessions type:cookies,cookie_name:DO-LB-Session

# Or update Nginx config
sed -i 's/green-api/blue-api/g' /etc/nginx/conf.d/hopwhistle.conf
sed -i 's/green-web/blue-web/g' /etc/nginx/conf.d/hopwhistle.conf
nginx -t && systemctl reload nginx

# 2. Stop Green environment
cd /opt/hopwhistle/green
docker-compose down

# 3. Investigate issues
echo "🔍 Investigate issues in Green environment logs:"
docker-compose logs --tail=100

echo "✅ Rollback completed"
```

## Complete Deployment Script

```bash
#!/bin/bash
# scripts/blue-green-deploy.sh

set -e

VERSION="$1"

if [ -z "$VERSION" ]; then
  echo "Usage: $0 <version>"
  exit 1
fi

echo "🚀 Starting Blue/Green deployment for version $VERSION"

# Step 1: Prepare Green
./scripts/prepare-green.sh "$VERSION"

# Step 2: Run migrations
./scripts/migrate-green.sh

# Step 3: Health check
./scripts/health-check-green.sh || {
  echo "❌ Health checks failed, aborting deployment"
  exit 1
}

# Step 4: Smoke tests
./scripts/smoke-test-green.sh || {
  echo "❌ Smoke tests failed, aborting deployment"
  exit 1
}

# Step 5: Switch traffic (gradual)
echo "Switching 10% traffic to Green..."
./scripts/switch-to-green.sh --percentage=10
sleep 60

echo "Switching 50% traffic to Green..."
./scripts/switch-to-green.sh --percentage=50
sleep 120

echo "Switching 100% traffic to Green..."
./scripts/switch-to-green.sh --percentage=100

# Step 6: Monitor
./scripts/monitor-green.sh 300

# Step 7: Cleanup Blue (after successful deployment)
read -p "Deployment successful. Cleanup Blue environment? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  cd /opt/hopwhistle/blue
  docker-compose down
  echo "✅ Blue environment stopped"
fi

echo "✅ Blue/Green deployment completed"
```

## Database Considerations

### Option 1: Shared Database (Recommended)

Both Blue and Green connect to the same database. Migrations must be backward compatible.

**Pros:**

- Simpler setup
- No data synchronization needed
- Lower cost

**Cons:**

- Migrations must be backward compatible
- Both environments see same data

### Option 2: Database Replication

Green has its own database with replication from Blue.

**Pros:**

- Complete isolation
- Can test migrations independently

**Cons:**

- More complex setup
- Data synchronization overhead
- Higher cost

## Redis Considerations

### Option 1: Shared Redis (Recommended)

Both environments share Redis. Session data is compatible.

**Pros:**

- Simpler setup
- Sessions persist across switch

**Cons:**

- Both environments share cache
- Potential cache conflicts

### Option 2: Separate Redis

Each environment has its own Redis.

**Pros:**

- Complete isolation

**Cons:**

- Sessions lost on switch
- More complex setup

## Object Storage

Always use shared object storage (MinIO/S3) so both environments can access recordings and files.

## Rollback Strategy

1. **Immediate Rollback**: Switch load balancer back to Blue
2. **Database Rollback**: Run down migrations if needed
3. **Investigation**: Review logs and metrics
4. **Fix**: Address issues in Green before next deployment

## Best Practices

1. **Always test migrations** on staging first
2. **Use feature flags** for gradual feature rollout
3. **Monitor metrics** during and after switch
4. **Keep Blue running** for at least 24 hours after switch
5. **Document issues** encountered during deployment
6. **Automate as much as possible** to reduce human error

## Monitoring During Deployment

- Error rates (should be < 0.1%)
- Response times (p95 < 500ms)
- Database connection pool usage
- Redis memory usage
- Worker queue depth
- Active call counts

## References

- [Blue-Green Deployment Pattern](https://martinfowler.com/bliki/BlueGreenDeployment.html)
- [DigitalOcean Load Balancer Guide](https://docs.digitalocean.com/products/networking/load-balancers/)
- [Nginx Load Balancing](https://nginx.org/en/docs/http/load_balancing.html)
