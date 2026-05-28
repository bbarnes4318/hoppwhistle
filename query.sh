#!/bin/bash
echo "=== DID ROUTES ==="
docker exec hopwhistle-postgres-dev psql -U callfabric -d callfabric -c "SELECT id, did, destination, status FROM did_routes WHERE did LIKE '%8652524607%' OR destination LIKE '%1b419be1-cccd%' OR destination LIKE '%8666132993%';"

echo "=== PHONE NUMBERS ==="
docker exec hopwhistle-postgres-dev psql -U callfabric -d callfabric -c "SELECT id, number, \"userId\", status FROM phone_numbers WHERE number LIKE '%8652524607%' OR number LIKE '%8666132993%';"

echo "=== USERS ==="
docker exec hopwhistle-postgres-dev psql -U callfabric -d callfabric -c "SELECT id, email, metadata FROM users WHERE id = '1b419be1-cccd-40cb-99ae-ca88d696e370';"

echo "=== AUDIT LOGS ==="
docker exec hopwhistle-postgres-dev psql -U callfabric -d callfabric -c "SELECT id, action, \"entityId\", changes, \"createdAt\" FROM audit_logs WHERE \"entityId\" = 'bd53f020-a029-4b85-b971-e8fa44947dff' OR \"entityId\" = '0b731b2b-cd8c-4213-ad4d-8c8fe97a13b3' OR \"entityId\" = '7151a7e7-b197-4ae4-94b5-cbcce6255dcd' ORDER BY \"createdAt\" DESC LIMIT 10;"

