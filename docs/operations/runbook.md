# Runbook de operaciones — Fantasy MotoGP Independiente

> Cómo operar el día a día: importar resultados, recálculos, restores e incidentes.
>
> **Despliegue y rollback:** véase `deploy.md`.
> **Rotación de secrets:** véase `deploy.md` §6.

## 1. Importar resultados

### 1.1 Importación automática (PulseLive)

El job de polling (`jobs/polling-results.ts`) detecta nuevos resultados cada
~5 min cuando el GP está activo. No requiere intervención humana salvo para
verificar que los datos son correctos.

**Verificar que el job corre:**

```bash
docker compose -f docker-compose.prod.yml exec web node --eval "
const { BullMQAdapter } = require('./app/modules/jobs/bullmq-adapter');
const { ResultsPollingJob } = require('./app/modules/jobs/results-polling-job');
const adapter = new BullMQAdapter(process.env.REDIS_URL);
const job = new ResultsPollingJob(adapter);
job.status().then(s => console.log(JSON.stringify(s, null, 2)));
"
```

O consulta Portainer → motogp-web → Logs → busca `results-polling`.

**Si el job no avanza:**

1. Verificar Redis: `docker compose -f docker-compose.prod.yml exec redis redis-cli ping` → `PONG`.
2. Reiniciar el job: `docker compose -f docker-compose.prod.yml restart web`.
3. Si persiste: revisar logs de `motogp-web` y `redis`.

### 1.2 Importación manual (siempre disponible)

Acceso admin al panel → **Resultados → Importar resultado**.

1. Seleccionar GP y evento (q2/sprint/race).
2. Introducir posición y puntos (o subir CSV).
3. Guardar → estado `provisional`.

**Validación server-side:**
- unique `(gp, event, rider)` → re-importar no duplica (idempotente).
- El coste del lineup y el presupuesto se recalculan en el servidor (invariante 2).

---

## 2. Marcar resultado como definitivo

Acceso admin al panel → **Resultados → [GP] → Marcar definitivo**.

Qué hace:

1. Transición de estado: `provisional → definitive`.
2. Dispara recálculo inline del GP (ver §3).
3. Registra en `audit_log` la acción (`results.mark_definitive`).
4. Genera nueva `results_version` si hay cambios.
5. **Notifica por email** a los miembros activos de las ligas con ranking en el GP (US-36; ver §6). Un fallo de envío no revierte ninguna de las acciones anteriores.

**Verificar:**

```bash
# Desde el health-check (si está activo):
curl -s http://localhost:22020/api/health | jq .
```

O consulta Portainer → motogp-web → Logs → buscar `markDefinitive`.

---

## 3. Forzar recálculo de un GP

Acceso admin al panel → **Resultados → [GP] → Forzar recálculo**.

También vía tRPC (admin): `results.recalculateGp({ gpId })`.

Qué hace:

1. Evalúa el diff mínimo entre los resultados actuales y los anteriores.
2. Genera nueva `results_version`.
3. Registra en `results_history` la transición anterior → nuevo.
4. Registra en `audit_log` la acción (`results.recalculated`).
5. Recalcula rankings de todas las ligas afectadas (con lock por liga).

**Nota:** El recálculo corre con lock por GP (un solo recálculo a la vez por GP).
Si otro recálculo está en curso, se enqueuea y espera.

**Verificar el resultado:**

```bash
# Comparar rankings antes/después:
curl https://motogp.raulmorales.eu/api/trpc/leagues.ranking \
  -H "Cookie: $(cookie)" \
  -d '{"seasonId":"...","gpId":"..."}' | jq .
```

---

## 4. Backups y restore de la BD (T-13, ADR-0037)

### 4.1 Backup automático (diario, 03:17 UTC)

`backup.sh` (raíz del repo, desplegado en `/mnt/data-nas/www/motogp/`):

- `pg_dump -Fc` de la BD `motogp` (dump lógico consistente; la app no se detiene).
- Verificación al crear: tamaño mínimo + `pg_restore --list` ≥ 30 tablas (un dump corrupto **falla en el backup**, no en el restore).
- Retención (D-11, PROVISIONAL): **30 días** en `backups/daily/` + **12 meses** en `backups/monthly/` (promoción automática del 1º del mes).
- `flock`: nunca dos backups a la vez. Log: una línea por backup en `backups/backup.log` (fichero, tamaño, sha256, nº de tablas, status).

**Instalación (una vez, usuario `raul`, sin sudo):**

```bash
mkdir -p /mnt/data-nas/backups/motogp    # ANTES del cron (la redirección de log necesita el directorio)
chmod +x /mnt/data-nas/www/motogp/backup.sh
(crontab -l 2>/dev/null; echo '17 3 * * * /mnt/data-nas/www/motogp/backup.sh >> /mnt/data-nas/backups/motogp/cron.log 2>&1') | crontab -
```

Verificar la instalación: `crontab -l | grep backup.sh`.
Verificar que corre (última línea = la fecha de hoy o ayer): `tail -1 /mnt/data-nas/backups/motogp/backup.log`.

### 4.2 Prueba de restore (verificada, no destructiva)

`restore-check.sh` restaura el dump (por defecto el más reciente de `daily/`) en una **BD scratch** `motogp_restore_check` — la BD de producción no se toca — y compara por tabla contra la BD en vivo: nº de filas + `md5` de las filas ordenadas. Tablas volátiles (`sessions`, `audit_log`, `password_reset_tokens`, `source_state`) pueden diferir por uso normal ("OK (volátil)"); el resto DEBEN ser idénticas. Sale `RESTORE-OK` (exit 0) o `RESTORE-FAIL` (exit ≠ 0).

```bash
./restore-check.sh                    # dump más reciente de daily/
./restore-check.sh <ruta-a-un-dump>   # p. ej. uno mensual
```

**Última ejecución verificada en producción (2026-11-03):** `RESTORE-OK` — 35/35 tablas (29 usuarios, 244 resultados, 2179 afiliaciones, 350 eventos…); única diferencia: `source_state` (OK volátil, el worker la actualiza cada ciclo).

### 4.3 Restore real de emergencia (dump → BD de producción)

Solo tras un incidente (borrado accidental, migración rota, bug de truncado). **Hace reemplazar la BD de producción** — los datos creados entre el backup y ahora se pierden (ventana de recuperación ≈ 24 h con backup diario).

1. **Elegir el dump:** `ls -lt /mnt/data-nas/backups/motogp/daily/ | head` (o `monthly/` si es más antiguo).
2. **Probar ANTES el restore** (scratch, no destructivo): `./restore-check.sh /mnt/data-nas/backups/motogp/daily/<dump>`. Si no sale `RESTORE-OK`, no continuar.
3. **Detener la app** (evita escrituras durante el restore):
   ```bash
   docker compose -p motogp -f docker-compose.prod.yml stop web worker
   ```
4. **Restaurar sobre `motogp`:**
   ```bash
   docker exec -i motogp-postgres pg_restore -v -e --single-transaction \
     -U motogp -d motogp --clean --if-exists < /mnt/data-nas/backups/motogp/daily/<dump>
   ```
5. **Arrancar la app:**
   ```bash
   docker compose -p motogp -f docker-compose.prod.yml start web worker
   ```
6. **Verificar post-restore:**
   ```bash
   curl -s https://motogp.raulmorales.eu/api/health | jq .
   docker exec motogp-postgres psql -U motogp -d motogp -Atc \
     'SELECT count(*) FROM users'   # coherente con el pre-incidente
   ```

---

## 5. Incidente de datos: resultado incorrecto

### 5.1 Síntoma detectado por un usuario

1. **Verificar el resultado en la fuente original** (PulseLive o la fuente de datos).
2. Si la fuente es errónea → contactar al proveedor.
3. Si la fuente es correcta y el sistema no la reflejó → **error del sistema**.

### 5.2 Corrección (flujo normal)

1. Admin verifica el error.
2. Admin corrige el resultado en el panel (o re-importa el evento con datos correctos).
3. El sistema genera automáticamente:
   - Nueva `results_version`.
   - Entrada en `results_history` (anterior → nuevo, motivo, actor).
   - Entrada en `audit_log` (`results.recalculated`).
4. Rankings se recalculan automáticamente.

### 5.3 Corrección de un GP ya definitivo

1. Admin va al panel → **Resultados → [GP] → Corregir**.
2. Modificar el resultado incorrecto.
3. Guardar → el sistema:
   - Cambia el estado a `corrected` (si era `definitive`).
   - Genera nueva `results_version`.
   - Recalcula el GP y todas las ligas afectadas.
4. Notificar a los afectados (si el impacto es significativo).

### 5.4 Corrección mayor (varios GPs)

Si el error afecta a múltiples GPs:

1. Corregir los resultados en orden cronológico.
2. Forzar recálculo tras cada corrección.
3. Documentar el incidente en `docs/incidents/` (si el impacto es > 10% de las ligas).

---

## 6. Notificaciones por email (US-36, ADR-0033)

**Qué se notifica:** publicación de resultados definitivos de un GP (`definitive_published`) y aplicación de un recálculo (`recalculation_applied`). **A quién:** miembros activos de las ligas que tienen ranking en ese GP y con email habilitado (opt-out desde `/perfil`; los usuarios anonimizados quedan excluidos).

**Proveedor:** Resend (API REST, sin dependencias). Configuración por env (ver `.env.prod.example`):

| Env | Para qué |
| --- | -------- |
| `RESEND_API_KEY` | API key de Resend (`re_…`). **Secreto.** Vacía ⇒ modo provisional: la notificación se loguea en el servidor (ver abajo). |
| `EMAIL_FROM` | Remitente verificado en Resend (producción: `no-reply@motogp.raulmorales.eu`, verificado 2026-11-02). Con `onboarding@resend.dev` solo se envía al dueño de la cuenta (403 al resto). |

**Alta inicial (una vez):** dashboard de Resend → crear cuenta → añadir el dominio `raulmorales.eu` (verificación DNS) → crear una API key → fijar `RESEND_API_KEY` y `EMAIL_FROM` en el `.env` → reiniciar el contenedor web.

**Verificar que se envían:**

```bash
# Auditoría: una entrada por envío (destinatarios, enviados, fallos).
docker compose -f docker-compose.prod.yml exec postgres psql -U motogp -d motogp \
  -c "SELECT ts, actor_id, entity_id, after_data FROM audit_log WHERE action = 'notification.sent' ORDER BY ts DESC LIMIT 5;"

# Modo provisional (RESEND_API_KEY vacía): los emails quedan en los logs.
docker logs motogp-web --since 1h | grep '\[notification\]'
```

**Si fallan los envíos:**

1. El flujo principal (definitivo/recálculo) **no** se ve afectado: los fallos se loguean y quedan en `audit_log` (`failed`, `failedEmails`).
2. Comprueba `RESEND_API_KEY` (¿revocada? ¿límite excedido?) y `EMAIL_FROM` (¿dominio verificado?) en el dashboard de Resend.
3. Límites del plan gratuito: **100 emails/día y 3000/mes**. Con varias ligas activas, un GP definitivo puede notificar a decenas de destinatarios: vigila el contador de uso en el dashboard.

---

## 7. Worker de background (T-10, ADR-0034)

**Qué hace:** el contenedor `motogp-worker` (misma imagen que la web, otro CMD) consume las colas BullMQ de Redis:

| Cola | Job | Cuándo |
| --- | --- | --- |
| `gp-prices` | `apply-formula` — aplica la fórmula de precios del GP (US-08) | Al publicarse el definitivo (`results.markDefinitive` encola; fire-and-forget — un fallo de cola **no** rompe el flujo) |
| `results-poll` | Polling de resultados de PulseLive (US-17) | Job repeatable, cada 5 min (`PROVISIONAL_RESULTS_POLL` en `shared/config`) |

El **recálculo de puntos no pasa por el worker** (se mantiene inline en el definitivo y en las correcciones — US-18/US-19).

**Verificar que está corriendo:**

```bash
docker inspect --format '{{.State.Status}}' motogp-worker   # esperado: running
docker logs motogp-worker --since 1h | tail -20             # arranque + scheduler
```

**Si el worker NO corre (crash-loop / parado):**

1. Síntoma: **no hay disparo automático** de precios ni polling (la app sigue funcionando; los flujos manuales siguen disponibles).
2. `docker compose -f docker-compose.prod.yml logs worker` → busca el error (candidatos: `REDIS_URL` no alcanzable, `DATABASE_URL` inválida, imagen antigua sin `worker/`).
3. Reiniciar: `docker compose -f docker-compose.prod.yml restart worker` → volver a comprobar `running`.
4. `deploy.sh` verifica el worker tras cada despliegue: si falló, el deploy **no** se da por bueno (revisar logs y `up -d` de nuevo).

**Disparo manual de precios (fallback del job):** panel de admin → Precios por GP → "Aplicar fórmula" (o tRPC `market.prices.applyFormula`). El job y la acción manual usan el **mismo** servicio (`applyPricesForGp`): es idempotente — aplicar dos veces no duplica nada (la red de seguridad del lock).

**Lock por GP:** `job:gp:lock:<gpId>` en Redis (TTL 120 s, semántica token — solo lo libera quien lo adquirió). Si un job encuentra el lock ocupado, el worker reintenta con backoff (3 intentos). Inspección: `docker compose -f docker-compose.prod.yml exec redis redis-cli KEYS 'job:gp:lock:*'`.

**Rendimiento (CA de T-10):** GP completo con 1000 lineups recalculado en < 30 s (medida real ~1,2 s — `npm run test:load`).

---

## 8. Monitoreo y alertas (T-14, ADR-0036)

**Qué se monitoriza** (tres superficies, todas opcionales por env — sin nada fijado, la app funciona igual):

| Superficie | Qué | Dónde va |
| --- | --- | --- |
| **Errores (Sentry)** | Excepciones de la web (servidor + cliente), tRPC `INTERNAL_SERVER_ERROR` (los rechazos esperados `FORBIDDEN`/`NOT_FOUND`/`BAD_REQUEST` **no** se capturan), worker — con contexto (ruta tRPC, cola, GP) | Sentry (self-hosted en TrueNAS o sentry.io). **Desactivado** si `NEXT_PUBLIC_SENTRY_DSN` está vacío |
| **Fallos (alertas)** | Fallo final de job (tras agotar 3 reintentos), auto-import que supera 3 fallos consecutivos, health-check de PulseLive (probe cada 5 min, **también fuera de ventana de GP**) que supera 3 fallos consecutivos, y su **recuperación** | Email a `OPS_ALERT_EMAIL` + Sentry + log. Sin destinatario ⇒ Sentry + log (el sink nunca lanza) |
| **Estado puntual (panel)** | Counts de colas BullMQ + último fallo, alertas activas, probe de la fuente, estado de Sentry | Sección "Jobs y fuentes" de `/admin` (solo `global_admin`) |

**Política anti-spam (núcleo puro `modules/jobs/alerts.ts`):** se alerta **solo en transición**: al cruzar el umbral (3 fallos consecutivos) y al recuperar. Mientras el fallo persiste **no se repite** (un ciclo de 5 min no produce un email por hora durante horas). El fallo final de job produce **un** email (no uno por reintento).

### 8.1 Activar Sentry

1. Instalar Sentry (infra, fuera del código — opciones completas en `deploy.md` §8): self-hosted en TrueNAS (opción principal; stack pesado, ~6–10 GB de RAM) o free tier de sentry.io (alternativa ligera).
2. Crear el proyecto y copiar su **DSN**.
3. En el `.env` del servidor: `NEXT_PUBLIC_SENTRY_DSN="https://key@sentry.mi-dominio/1"` (la DSN es una clave pública del proyecto, no un secreto).
4. **Rebuild**: `./deploy.sh` — la DSN se inlinde en el SDK de cliente en el build y la CSP `connect-src` se amplía **solo** con el host del DSN.
5. Verificar: panel `/admin` → "Jobs y fuentes" → "Sentry (errores)" debe mostrar **Activo**; provocar un error (o esperar uno real) y ver la issue en Sentry con sus tags (`trpc.path`, `alert.kind`, …).

**GDPR (ADR-0036):** `dataCollection` cerrada — sin `userInfo`, sin cookies, sin headers, sin query params, sin bodies. Lo que viaja es el stack trace + los tags operativos.

### 8.2 Configurar el email de alertas

1. En el `.env` del servidor: `OPS_ALERT_EMAIL="ops@mi-dominio.eu"` (cualquier buzón; reutiliza Resend de US-36 — si `RESEND_API_KEY` está vacía, el "email" se loguea en el servidor: `docker logs motogp-worker | grep "\[alert\]"`).
2. `docker compose -f docker-compose.prod.yml up -d worker web`.
3. Vacío ⇒ sin canal de email (Sentry + log solo); nunca rompe el ciclo que dispara la alerta.

**Asuntos (estables, filtrables en el buzón):** `[alerta motogp] source-poll-failure — …`, `source-poll-recovered`, `source-probe-failure`, `source-probe-recovered`, `job-failed`. Cada cuerpo lleva el dato clave (GP, evento, nº de fallos, motivo, cola) y una referencia al panel "Jobs y fuentes".

### 8.3 Panel "Jobs y fuentes" (`/admin`)

| Bloque | Qué muestra |
| --- | --- |
| Colas de jobs (BullMQ) | En espera / activos / diferidos (reintento) / completados / fallidos por cola + último job fallido (motivo, momento, intentos) |
| Fuente de datos (PulseLive) | Última comprobación (momento + latencia), fallos consecutivos, último éxito, último error + **alertas activas** (auto-import sobre umbral) + botón **"Comprobar fuente ahora"** (probe a demanda, sin tocar el probe automático) |
| Sentry (errores) | **Activo** (DSN fijado) / **Desactivado** (con la instrucción de activarlo) |

Refresco automático cada 30 s. Los endpoints `admin.jobsStatus` (query) y `admin.sourceHealth` (mutation) son solo `global_admin` (403 `FORBIDDEN` a cualquier otro rol, 401 sin sesión).

### 8.4 Ante una alerta

| Alerta | Qué significa | Primeras acciones |
| --- | --- | --- |
| `source-poll-failure` | Auto-import de un GP/evento fallando 3 ciclos seguidos (≈ 15 min) | Panel "Jobs y fuentes" → "Comprobar fuente ahora"; si responde, esperar (llega la alerta de recuperación sola); si no, comprobar red desde el NAS: `curl -sS https://api.motogp.pulselive.com` |
| `source-probe-failure` | PulseLive inalcanzable 3 probes seguidos (también fuera de ventana de GP) | Mismos pasos: probe manual + red; si hace falta, importar resultados **a mano** (§1) |
| `job-failed` | Un job BullMQ agotó 3 reintentos | `docker compose -f docker-compose.prod.yml logs worker` → repetir la acción a mano: precios = panel "Aplicar fórmula" (§7); poll = esperar al siguiente ciclo |
| `source-poll-recovered` / `source-probe-recovered` | La fuente volvió | Sin acción; comprobar que el GP pendiente se importó (panel Resultados) |

**Alertas en los logs** (sin buzón configurado, o el sink falló): `docker logs motogp-worker --since 1h | grep "\[alert\]"`.

**Sentry desactivado por defecto:** mientras `NEXT_PUBLIC_SENTRY_DSN` esté vacío, los errores solo van a los logs del contenedor (`motogp-web` / `motogp-worker`) y no se capturan issues. Las alertas de email + el panel funcionan igual (no dependen de Sentry).

---

## 9. Rotación de secrets

> **Completo en `deploy.md` §6.** Resumen:

### SESSION_SECRET

1. Generar nuevo: `openssl rand -hex 32`.
2. Editar `.env` en el servidor.
3. `docker compose -f docker-compose.prod.yml up -d web`.
4. **Efecto:** invalida todas las sesiones activas (los usuarios deben volver a loguearse).

### POSTGRES_PASSWORD

1. Generar nuevo: `openssl rand -hex 32`.
2. Editar `.env` en el servidor.
3. Conectar a la BD y actualizar:
   ```bash
   docker compose -f docker-compose.prod.yml exec postgres psql -U motogp -d motogp \
     -c "ALTER USER motogp WITH PASSWORD 'nuevo-password';"
   ```
4. `docker compose -f docker-compose.prod.yml up -d web`.

### Clave SSH de deploy

1. Generar nueva: `ssh-keygen -t ed25519 -f ~/.ssh/motogp_deploy -N ""`.
2. Actualizar el deploy key en GitHub.
3. Actualizar `~/.ssh/config` en el servidor.
4. Verificar: `git ls-remote git@github-motogp:raulmoralesruiz/motogp-fantasy.git`.

---

## 10. Checklist post-deploy

Tras cada `./deploy.sh`:

| Paso | Comando | Esperado |
| ---- | ------- | -------- |
| Health-check | `curl -s https://motogp.raulmorales.eu/api/health` | `{"ok":true}` |
| Páginas públicas | `curl -s -o /dev/null -w "%{http_code}" https://motogp.raulmorales.eu/` | `200` |
| Directorio de ligas | `curl -s -o /dev/null -w "%{http_code}" https://motogp.raulmorales.eu/ligas` | `200` |
| Login | `curl -s -o /dev/null -w "%{http_code}" https://motogp.raulmorales.eu/login` | `200` |
| tRPC health | `curl -s https://motogp.raulmorales.eu/api/trpc/health.check` | `{"status":"ok"}` (database.ok + redis.ok) |
| BD migrada | `docker compose -f docker-compose.prod.yml exec postgres psql -U motogp -d motogp -c "SELECT count(*) FROM _prisma_migrations;"` | `> 0` |
| Redis vivo | `docker compose -f docker-compose.prod.yml exec redis redis-cli ping` | `PONG` |
| Worker corriendo (T-10) | `docker inspect --format '{{.State.Status}}' motogp-worker` | `running` |
| Monitoreo (T-14) | Panel `/admin` → "Jobs y fuentes" | Colas con counts; estado de Sentry coherente con `NEXT_PUBLIC_SENTRY_DSN` (DSN vacía ⇒ "Desactivado") |

---

## 11. Contacto y escalación

| Problema | Primer nivel | Escalado |
| -------- | ------------ | -------- |
| Resultados incorrectos | Admin → corrección manual | Contactar proveedor de datos |
| BD corrupta | Restore de backup (§4) | — |
| Deploy fallido | `./deploy.sh` (reintentar) | Revisar logs → `docker compose logs` |
| Incidente de seguridad | Rotar secrets (§9) | — |
| Rendimiento / latencia | Reiniciar web (`docker compose restart web`) | Verificar recursos del NAS |
