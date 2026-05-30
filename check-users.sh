#!/bin/bash
docker exec kawamonn_db psql -U kawamonn -d kawamonn_storage -c 'SELECT id, account_name, email, role, status FROM "User";'
echo "---"
docker exec kawamonn_db psql -U kawamonn -d kawamonn_storage -c 'SELECT count(*) as total_users FROM "User";'
