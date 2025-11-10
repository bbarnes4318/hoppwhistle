#!/usr/bin/env bash
set -e

echo "=== Voice Stack Rollback ==="
echo ""

# Determine compose file location
COMPOSE_FILE="infra/docker/docker-compose.voice.yml"

if [ ! -f "$COMPOSE_FILE" ]; then
    echo "Error: Docker Compose file not found at $COMPOSE_FILE"
    exit 1
fi

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo "Error: Docker is not installed or not in PATH"
    exit 1
fi

echo "Stopping all voice services..."
docker compose -f "$COMPOSE_FILE" down

if [ $? -eq 0 ]; then
    echo "✓ All voice services stopped successfully"
else
    echo "✗ Error stopping services"
    exit 1
fi

echo ""
echo "Verifying containers are stopped..."

CONTAINERS=("sbc-kamailio" "rtpengine" "freeswitch")

for container in "${CONTAINERS[@]}"; do
    if docker ps -a | grep -q "$container"; then
        if docker ps | grep -q "$container"; then
            echo "⚠ Warning: $container is still running"
        else
            echo "✓ $container is stopped"
        fi
    fi
done

echo ""
echo "=== Rollback Complete ==="
echo ""
echo "To restart services:"
echo "  docker compose -f $COMPOSE_FILE up -d"
echo ""
echo "To view logs before restart:"
echo "  docker logs sbc-kamailio"
echo "  docker logs rtpengine"
echo "  docker logs freeswitch"

