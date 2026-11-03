# ADR-0037: Backups diarios de PostgreSQL + prueba de restore verificada (T-13, D-11)

- **Estado:** Aceptado (2026-11-03)
- **Fecha:** 2026-11-03
- **Relacionado:** T-13 (backlog: "backups automáticos de PostgreSQL (diarios; retención PROVISIONAL 30 días diarios + 12 meses mensuales) + un restore real desde backup ejecutado y documentado"), `security.md` §1.10 (backup y restore), `deploy.md` §6, runbook §4, ADR-0016 (anonimización: los dumps contienen email anonimizado, no PII de cuenta eliminada), T-14/ADR-0036 (alertas: el backup es la última línea ante un incidente lógico).

## Problema

La única protección de datos de producción era implícita: el pool `data-nas` (raidz1, tolera 1 disco) protege contra un fallo físico, pero **no hay protección frente a incidentes lógicos** — borrado accidental, migración rota, restore mal ejecutado, bug que trunca datos. Sin backups ni prueba de restore, un incidente así es pérdida definitiva:

1. **No había backups automatizados:** ni cron, ni dumps, ni retención (CA de T-13 pendiente).
2. **El restore del runbook era solo teórico:** §4.1 hablaba de snapshots ZFS que no existen (no hay dataset dedicado `motogp-pgdata`; pgdata es un directorio en el pool), y §4.2 describía un restore manual sin verificación de integridad.
3. **Un backup sin probar no es un backup:** el riesgo clásico es descubrir en el restore que el dump era ilegible (corrupto, incompleto, con la BD equivocada).

## Opciones

| Opción | Descripción | Contras |
|---|---|---|
| A. Snapshot ZFS del directorio `pgdata` | `zfs snapshot` del mount del pool | **Peligroso para PostgreSQL:** snapshot de pgdata con la BD en vivo no es consistente (WAL fuera de orden); exige un dataset dedicado + `pg_backup` o stop de la BD. Fuera de alcance del MVP; se documenta como mejora futura |
| B. `pg_dump` personalizado + retención + prueba de restore | Dump lógico consistente (`pg_dump -Fc`), verificado al crear y al restaurar | Ventana de recuperación = 24 h (suficiente para un proyecto con pocos usuarios); el restore no es instantáneo (la BD es pequeña: ~300 KB, segundos) |
| C. Replicación streaming / PITR | Segundo nodo de Postgres + WAL shipping | Complejidad de operación desproporcionada (un nodo extra, monitorización de lag, failover) para el alcance actual |

**Decisión: opción B.** Coherente con `security.md` §1.10 ("backups automáticos + prueba de restore periódica + retención definida") y con el tamaño real de la BD (~300 KB): un dump diario lógico es barato, consistente por construcción y trivial de restaurar.

## Decisión

### 1. `backup.sh` (diario, en el NAS)

- **`pg_dump -Fc`** (formato custom, compresión + TOC) de la BD `motogp` desde el contenedor `motogp-postgres`, stream directo al fichero (sin `docker cp` intermedio). Funciona sobre la BD en vivo sin detener nada (dump lógico consistente de Postgres).
- **Verificación al crear (fallo temprano):** tamaño mínimo (> 1 KB) + `pg_restore --list` ≥ 30 tablas `TABLE DATA`. Un dump corrupto o incompleto **falla en el momento del backup**, no en el restore.
- **Retención (D-11, PROVISIONAL):** `30 días diarios` en `backups/daily/` + `12 meses mensuales` en `backups/monthly/` (promoción automática del dump del día si el mes aún no tiene). Parámetros por entorno: `MOTOGP_BACKUP_ROOT`, `MOTOGP_DAILY_KEEP` (30), `MOTOGP_MONTHLY_KEEP` (12).
- **Una sola vez a la vez:** `flock` sobre `backups/.lock` (si un backup se alarga, cron no lo encima).
- **Log auditable:** una línea por backup en `backups/backup.log` (fichero, tamaño, sha256, nº de tablas, status) — visible para el admin y para un auditor.
- **Ubicación:** `backup.sh` en la raíz del repo (convención de `deploy.sh`), se copia a `/mnt/data-nas/www/motogp/` en el deploy. Cron: **03:17 UTC** (fuera de horas punta, minuto fijo aleatorio).

### 2. `restore-check.sh` (prueba de restore verificada — CA de T-13)

- **Restaura el dump (por defecto el más reciente de `daily/`) en una BD SCRATCH `motogp_restore_check`** — la BD de producción `motogp` **no se toca en ningún momento**.
- **Fingerprint por tabla** contra la BD en vivo: `nº de filas + md5` de `to_jsonb` de cada fila **ordenada** (determinista, independiente del orden físico de inserción). Las 35 tablas de `motogp` deben coincidir.
- **Tablas volátiles** (`sessions`, `audit_log`, `password_reset_tokens`, `source_state`): cambian con el uso normal mientras corre la prueba — se reportan como "OK (volátil)" si difieren; el resto DEBEN ser idénticas.
- `pg_restore -e --single-transaction`: el restore es atómico y el primer error detiene.
- Salida: tabla de estado por tabla + `RESTORE-OK` / `RESTORE-FAIL` (código de salida no cero).
- **Verificado en producción (2026-11-03):** `RESTORE-OK` — 35/35 tablas, 29 usuarios, 244 resultados, 2179 afiliaciones… únicas diferencia: `source_state` (OK volátil, el worker la actualiza cada ciclo).

### 3. Qué protege (y qué no)

| Amenaza | Protegido? | Por qué |
|---|---|---|
| Borrar/tabla equivocada, migración rota, restore mal ejecutado, bug que trunca datos | ✅ | Dump diario previo + restore verificado |
| Un disco del pool falla | ✅ | raidz1 (1 disco) |
| Ransomware **lógico** que borra la BD | ✅ | El dump es un fichero aparte |
| Ransomware que borra **también el dump** (misma pool) | ⚠️ residual | **Misma pool que los datos** — un ataque que borre `backups/` borra también los dumps. Mitigación futura (out of scope del MVP): copia off-site de 1 dump semanal |
| Pérdida total del NAS (pool data-nas destruido) | ⚠️ residual | Los dumps viven en la misma pool |
| Incidente en las últimas 24 h | ⚠️ | Ventana de recuperación = 24 h (diario) |

El riesgo residual se documenta (no se oculta): es aceptable para el alcance actual (pocos usuarios, BD pequeña, pool raidz1 sano) y la copia off-site queda como mejora natural.

## Consecuencias

- **2 scripts en el repo** (`backup.sh`, `restore-check.sh`) + `backup.log` auditable en el NAS.
- **Cron de raul** (usuario no-root, sin sudo): 1 línea de crontab (ver runbook §4.1).
- **Runbook §4** reescrito: §4.1 backup automático (cómo funciona + cron + cómo verificar que corre), §4.2 prueba de restore (`restore-check.sh`), §4.3 restore real de emergencia (dump → BD de producción, paso a paso + verificación post-restore).
- **`deploy.md` §6** actualizado (apunta a los scripts; retira la recomendación de snapshots ZFS implícitas).
- **D-11 cerrada:** retención definida y operativa (30 días + 12 meses, PROVISIONAL — se revisa cuando haya usuarios suficientes).
- **GDPR:** los dumps contienen los mismos datos que la BD (email anonimizado de cuentas eliminadas por ADR-0016, no PII de cuenta activa). El log de backup no contiene datos de usuarios (solo metadatos del dump).

## Reversibilidad

Alta. Retirar el backup = borrar la línea de cron + los scripts. Los datos de la BD no se ven afectados en ningún momento (el backup es solo lectura; la prueba de restore usa una BD scratch que se borra al terminar). Si se quiere PITR o una copia off-site, es un ADR posterior (ADR-00XX) — esta decisión no lo impide.
