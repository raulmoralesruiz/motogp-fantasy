#!/usr/bin/env bash
# Backup automático diario de la BD de producción (T-13, ADR-0037).
#
# Qué hace:
#   1. `pg_dump` en formato custom (`-Fc`) de la BD `motogp` desde el
#      contenedor postgres (sin tocar pgdata).
#   2. Verifica la integridad del dump al momento de crearlo
#      (`pg_restore --list`: un dump corrupto se detecta en el backup,
#      no en el restore).
#   3. Retención (D-11, PROVISIONAL): **30 días diarios + 12 meses
#      mensuales**. El 1º de cada mes se promociona el dump del día a
#      `monthly/motogp-<YYYY-MM>.dump` (solo si el mes aún no tiene).
#   4. Log: una línea por backup en `$BACKUP_ROOT/backup.log`
#      (archivo, tamaño, sha256, nº de tablas).
#
# Uso (en el NAS, desde /mnt/data-nas/www/motogp):
#   ./backup.sh
#
# Cron (usuario raul, ver runbook §4.1):
#   17 3 * * * /mnt/data-nas/www/motogp/backup.sh >> /mnt/data-nas/motogp/backups/cron.log 2>&1
#
# El backup queda en /mnt/data-nas/motogp/backups/ (pool data-nas raidz1,
# tolera 1 disco). Protege contra incidentes lógicos de la BD (borrado,
# migración rota, mal restore, ransomware lógico); NO es protección contra
# la pérdida total del NAS (residual — ver ADR-0037 §5).
set -euo pipefail

cd "$(dirname "$0")"

# `-p motogp`: proyecto fijo (los contenedores se llaman motogp-*), para que
# el script funcione desde cualquier directorio.
COMPOSE="docker compose -p motogp -f docker-compose.prod.yml"
DB="motogp"
PG_CONTAINER="motogp-postgres"

BACKUP_ROOT="${MOTOGP_BACKUP_ROOT:-/mnt/data-nas/motogp/backups}"
DAILY_KEEP="${MOTOGP_DAILY_KEEP:-30}"
MONTHLY_KEEP="${MOTOGP_MONTHLY_KEEP:-12}"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

# ── 0. Precondiciones ──────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || { echo "ERROR: falta docker." >&2; exit 1; }
STATE="$(docker inspect --format '{{.State.Status}}' "$PG_CONTAINER" 2>/dev/null || echo missing)"
[ "$STATE" = "running" ] \
  || { echo "ERROR: $PG_CONTAINER no está corriendo (estado: $STATE)." >&2; exit 1; }
mkdir -p "$BACKUP_ROOT/daily" "$BACKUP_ROOT/monthly"

# Un solo backup a la vez (cron no debe encimarse si uno se alarga).
exec 9>"$BACKUP_ROOT/.lock"
flock -n 9 || { echo "ERROR: ya hay un backup en curso (lock)." >&2; exit 1; }

# ── 1. pg_dump (custom format) ─────────────────────────────────────────────
TS="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$BACKUP_ROOT/daily/motogp-$TS.dump"
log "==> pg_dump -Fc ($DB → $FILE)"
# `-U motogp` por socket local: mismo patrón que `deploy.sh`/runbook §9.
# El stream va directo al fichero del host (sin docker cp intermedio).
$COMPOSE exec -T postgres pg_dump -U motogp -d "$DB" -Fc > "$FILE"
SIZE="$(stat -c%s "$FILE" 2>/dev/null || stat -f%z "$FILE")"
[ "$SIZE" -gt 1024 ] || { echo "ERROR: dump sospechosamente pequeño ($SIZE bytes)." >&2; exit 1; }

# ── 2. Integridad (el TOC debe listar las tablas de la BD) ─────────────────
log "==> integridad (pg_restore --list)"
docker cp "$FILE" "$PG_CONTAINER:/tmp/motogp-verify.dump"
trap 'docker exec "$PG_CONTAINER" rm -f /tmp/motogp-verify.dump 2>/dev/null || true' EXIT
# El TOC lista "TABLE DATA" por tabla. `|| true`: con pipefail, un grep sin
# coincidencias abortaría antes del mensaje de error claro.
NTAB="$($COMPOSE exec -T postgres pg_restore --list /tmp/motogp-verify.dump \
  | { grep -c 'TABLE DATA' || true; })"
[ "$NTAB" -ge 30 ] \
  || { echo "ERROR: TOC incompleto del dump ($NTAB tablas; esperadas ≥ 30)." >&2; exit 1; }

# Mantener solo los N más recientes de un directorio (find: siempre exit 0,
# compatible con set -euo pipefail; sort por mtime descendente).
keep_n_most_recent() {
  local dir="$1" n="$2"
  (
    cd "$dir"
    find . -maxdepth 1 -name 'motogp-*.dump' -printf '%T@ %P\n' \
      | sort -rn | tail -n +$((n + 1)) | cut -d' ' -f2- \
      | xargs -r rm -f --
  )
}

# ── 3. Retención diaria: los 30 más recientes ──────────────────────────────
log "==> retención diaria (mantiene los $DAILY_KEEP más recientes)"
keep_n_most_recent "$BACKUP_ROOT/daily" "$DAILY_KEEP"

# ── 4. Mensual: el 1º del mes (o si falta el del mes), promociona hoy ──────
MONTH_TAG="$(date -u +%Y-%m)"
MONTHLY="$BACKUP_ROOT/monthly/motogp-$MONTH_TAG.dump"
if [ ! -f "$MONTHLY" ]; then
  log "==> mensual: promoción del dump de hoy a $MONTHLY"
  cp -f "$FILE" "$MONTHLY"
fi
log "==> retención mensual (mantiene los $MONTHLY_KEEP más recientes)"
keep_n_most_recent "$BACKUP_ROOT/monthly" "$MONTHLY_KEEP"

# ── 5. Log ─────────────────────────────────────────────────────────────────
SHA="$(sha256sum "$FILE" | cut -d' ' -f1)"
log "OK: $FILE ($SIZE bytes, sha256=$SHA, $NTAB tablas)"
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) file=$FILE size=$SIZE sha256=$SHA tables=$NTAB status=OK" \
  >> "$BACKUP_ROOT/backup.log"
