#!/usr/bin/env bash
# Prueba de restore de un backup + verificación de integridad (T-13, CA).
#
# Qué hace:
#   1. Restaura el dump (default: el más reciente de `daily/`) en una BD
#      SCRATCH `motogp_restore_check` — la BD de producción `motogp` no se
#      toca en ningún momento.
#   2. Compara un fingerprint por tabla entre la BD de producción y la
#      scratch: **nº de filas + md5 de las filas ordenadas** (determinista,
#      independiente del orden físico de las filas).
#   3. Tablas volátiles (cambian con uso normal mientras se ejecuta la
#      prueba): `sessions`, `audit_log`, `password_reset_tokens`,
#      `source_state` — se reportan como "OK (volátil)" si difieren; el
#      resto DEBEN ser idénticas.
#   4. Borra la BD scratch. Cualquier diferencia en una tabla estable ⇒
#      código de salida no cero (la prueba falla).
#
# Uso (en el NAS, desde /mnt/data-nas/www/motogp):
#   ./restore-check.sh                 # dump más reciente de daily/
#   ./restore-check.sh <ruta-dump>     # un dump concreto (p. ej. mensual)
#
# Salida: tabla de estado por tabla + RESTORE-OK / RESTORE-FAIL.
set -euo pipefail

cd "$(dirname "$0")"

# `-p motogp`: proyecto fijo (los contenedores se llaman motogp-*), para que
# el script funcione desde cualquier directorio.
COMPOSE="docker compose -p motogp -f docker-compose.prod.yml"
DB="motogp"
SCRATCH="motogp_restore_check"
BACKUP_ROOT="${MOTOGP_BACKUP_ROOT:-/mnt/data-nas/motogp/backups}"
VOLATILE=" sessions audit_log password_reset_tokens source_state "

# ── 0. Dump a probar ────────────────────────────────────────────────────────
if [ "${1:-}" != "" ]; then
  DUMP="$1"
else
  DUMP="$(find "$BACKUP_ROOT/daily" -maxdepth 1 -name 'motogp-*.dump' -printf '%T@ %P\n' 2>/dev/null \
    | sort -rn | head -1 | cut -d' ' -f2-)"
  [ -n "$DUMP" ] || { echo "ERROR: no hay dumps en $BACKUP_ROOT/daily (ejecuta ./backup.sh)." >&2; exit 1; }
  DUMP="$BACKUP_ROOT/daily/$DUMP"
fi
[ -f "$DUMP" ] || { echo "ERROR: no existe el dump: $DUMP" >&2; exit 1; }

# ── 1. BD scratch limpia ────────────────────────────────────────────────────
echo "==> restore de $DUMP en $SCRATCH (la BD $DB no se toca)"
cleanup() {
  $COMPOSE exec postgres dropdb --if-exists -U motogp "$SCRATCH" >/dev/null 2>&1 || true
}
trap cleanup EXIT
$COMPOSE exec postgres dropdb --if-exists -U motogp "$SCRATCH"
$COMPOSE exec postgres createdb -U motogp -O motogp "$SCRATCH"
# El stream del dump va directo a pg_restore (sin docker cp).
# -e/--exit-on-error: el primer error detiene; --single-transaction: el
# restore es atómico (la BD scratch queda completa o no queda).
$COMPOSE exec -T -i postgres pg_restore -v -e --single-transaction -U motogp -d "$SCRATCH" < "$DUMP"

# ── 2. Fingerprint por tabla (filas + md5 de filas ordenadas) ──────────────
fp() {
  # $1 = BD, $2 = tabla. Devuelve "nfilas|md5" (una sola línea).
  $COMPOSE exec -T postgres psql -U motogp -d "$1" -Atc \
    "SELECT count(*) || '|' || md5(coalesce(string_agg(x, '' ORDER BY x))) \
     FROM (SELECT to_jsonb(r)::text AS x FROM \"$2\" r) s"
}

TABLES="$($COMPOSE exec -T postgres psql -U motogp -d "$DB" -Atc \
  'SELECT tablename FROM pg_tables WHERE schemaname = '\''public'\'' ORDER BY 1')"
[ -n "$TABLES" ] || { echo "ERROR: la BD $DB no tiene tablas (¿dump correcto?)." >&2; exit 1; }

echo
printf '%-24s %8s %8s   %s\n' "TABLA" "LIVE" "REST" "ESTADO"
printf '%-24s %8s %8s   %s\n' "-----" "----" "----" "------"
FAIL=0
for t in $TABLES; do
  LIVE="$(fp "$DB" "$t")"
  REST="$(fp "$SCRATCH" "$t")"
  NROWS="${LIVE%%|*}"
  if [ "$LIVE" = "$REST" ]; then
    S="OK"
  elif [ "${VOLATILE#* $t }" != "$VOLATILE" ]; then
    S="OK (volátil)"
  else
    S="DIFERENTE"; FAIL=1
  fi
  printf '%-24s %8s %8s   %s\n' "$t" "$NROWS" "${REST%%|*}" "$S"
done
echo

if [ "$FAIL" -eq 0 ]; then
  echo "RESTORE-OK: $DUMP restaurado íntegro en $SCRATCH (comprobado contra $DB)."
else
  echo "RESTORE-FAIL: diferencias en tablas estables (ver tabla arriba)." >&2
  exit 1
fi
