#!/bin/bash
echo "=== DID ROUTES ==="
docker exec hopwhistle-postgres-dev psql -U callfabric -d callfabric -c "SELECT id, did, destination, status FROM did_routes WHERE did LIKE '%8652524607%' OR destination LIKE '%1b419be1-cccd%' OR destination LIKE '%8666132993%';"

echo "=== PHONE NUMBERS ==="
docker exec hopwhistle-postgres-dev psql -U callfabric -d callfabric -c "SELECT id, number, \"userId\", status FROM phone_numbers WHERE number LIKE '%8652524607%' OR number LIKE '%8666132993%';"

echo "=== USERS ==="
docker exec hopwhistle-postgres-dev psql -U callfabric -d callfabric -c "SELECT id, email, metadata FROM users WHERE id = '1b419be1-cccd-40cb-99ae-ca88d696e370';"
