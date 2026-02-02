#!/bin/bash
docker exec hopwhistle-postgres-dev psql -U postgres -d callfabric -t -c "SELECT id FROM users LIMIT 1"
