#!/bin/sh
# Back up the whole database to ./backups/equity-watchlist-<date>.archive.gz (run from the app folder).
set -e
mkdir -p backups
set -a; [ -f .env ] && . ./.env; set +a
f="backups/equity-watchlist-$(date +%Y%m%d-%H%M%S).archive.gz"
docker compose exec -T mongo mongodump --quiet --archive --gzip -u "${MONGO_USER:-ewadmin}" -p "$MONGO_PASSWORD" --authenticationDatabase admin --db "${MONGO_DB:-equity_watchlist}" > "$f"
echo "Saved $f"
