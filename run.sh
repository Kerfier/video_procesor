#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

echo "==> Building images..."
docker compose -f "$COMPOSE_FILE" build

echo "==> Starting services..."
docker compose -f "$COMPOSE_FILE" up -d

cat <<EOF

On first run the processor downloads YOLO models (~30 MB). This may take 1-2 minutes.

EOF
echo -n "Waiting for server to become ready"

until docker compose -f "$COMPOSE_FILE" exec -T server wget -qO- http://localhost:3000/health >/dev/null 2>&1; do
    printf "."
    sleep 3
done

cat <<EOF


==> Ready! Open http://localhost:3000 in your browser.

Useful commands:
  docker compose logs -f            # stream logs from all services
  docker compose logs -f processor  # processor logs only
  docker compose down               # stop (volumes preserved)
  docker compose down -v            # stop and delete volumes
  docker compose build              # rebuild images after code changes
EOF
