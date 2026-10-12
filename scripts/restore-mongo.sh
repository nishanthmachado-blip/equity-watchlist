#!/bin/sh
# Restore a backup made by backup-mongo.sh:  sh scripts/restore-mongo.sh backups/equity-watchlist-....archive.gz
# Replaces the current data. Stop the app first:  docker compose stop app
set -e
[ -f "$1" ] || { echo "Usage: sh scripts/restore-mongo.sh <backup file>"; exit 1; }
set -a; [ -f .env ] && . ./.env; set +a
docker compose exec -T mongo mongorestore --quiet --archive --gzip --drop -u "${MONGO_USER:-ewadmin}" -p "$MONGO_PASSWORD" --authenticationDatabase admin < "$1"
echo "Restored $1. Start the app again:  docker compose start app"
