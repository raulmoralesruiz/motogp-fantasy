#!/usr/bin/env bash
# Deploy de producción en el TrueNAS (T-02, WP4) — modelo pull.
# GitHub Actions solo valida (CI); el deploy lo inicia el humano.
#
# Flujo: precondiciones → git pull → build de la imagen (tag = commit)
#        → migraciones → up → health-check.
#
# Uso:   ./deploy.sh   (desde /mnt/data-nas/www/motogp)
set -euo pipefail

cd "$(dirname "$0")"

COMPOSE="docker compose -f docker-compose.prod.yml"
IMAGE="motogp-web"

# ── 0. Precondiciones ───────────────────────────────────────────────────────
if [ ! -f .env ]; then
  echo "ERROR: falta el .env. Cópialo de .env.prod.example y rellena los secrets (ver docs/operations/deploy.md §1.4)." >&2
  exit 1
fi
command -v docker >/dev/null 2>&1 || { echo "ERROR: falta docker." >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "ERROR: falta curl." >&2; exit 1; }

# ── 1. Código actualizado ───────────────────────────────────────────────────
echo "==> git pull"
git pull --ff-only
TAG="$(git rev-parse --short HEAD)"

# ── 2. Imagen (etiquetada por commit para poder hacer rollback) ─────────────
echo "==> docker build ($IMAGE:$TAG)"
NEXT_PUBLIC_APP_URL="$(sed -n 's/^NEXT_PUBLIC_APP_URL=//p' .env | tr -d '"')"
docker build \
  --build-arg NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-http://localhost:3000}" \
  -t "$IMAGE:$TAG" -t "$IMAGE:latest" .

# ── 3. Migraciones (con Postgres ya arriba y sano) ──────────────────────────
echo "==> prisma migrate deploy"
$COMPOSE up -d --wait postgres redis
$COMPOSE run --rm web npx prisma migrate deploy

# ── 4. Arranque completo ────────────────────────────────────────────────────
echo "==> docker compose up -d"
$COMPOSE up -d --wait

# ── 5. Health-check por el puerto del host ──────────────────────────────────
echo "==> health-check"
PORT="$(sed -n 's/^WEB_HOST_PORT=//p' .env | tr -d '"')"
PORT="${PORT:-22020}"
for _ in $(seq 1 30); do
  if curl -fsS "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
curl -fsS "http://localhost:$PORT/api/health" >/dev/null 2>&1 \
  || { echo "ERROR: la web no responde tras 60 s. Revisa: $COMPOSE logs web" >&2; exit 1; }
echo "OK: la web responde en http://localhost:$PORT/api/health (imagen $IMAGE:$TAG)."

# ── 6. Worker de background (T-10, ADR-0034): verificar que queda corriendo ─
# El worker no expone un puerto: comprobar que el contenedor está "running"
# (un crash-loop quedaría en "restarting" y fallaría este check).
echo "==> worker (motogp-worker)"
for _ in $(seq 1 15); do
  STATE="$(docker inspect --format '{{.State.Status}}' motogp-worker 2>/dev/null || echo missing)"
  [ "$STATE" = "running" ] && break
  sleep 2
done
STATE="$(docker inspect --format '{{.State.Status}}' motogp-worker 2>/dev/null || echo missing)"
if [ "$STATE" != "running" ]; then
  echo "ERROR: el worker no está corriendo (estado: $STATE). Revisa: $COMPOSE logs worker" >&2
  exit 1
fi
echo "OK: el worker de background está corriendo."
echo "DEPLOY COMPLETO (imagen $IMAGE:$TAG)."
