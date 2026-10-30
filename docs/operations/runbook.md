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

## 4. Restaurar backup de la BD

### 4.1 Desde snapshot del pool (TrueNAS)

1. Identificar el snapshot: `zfs list -t snapshot | grep motogp-pgdata`.
2. Verificar integridad: `zfs diff <snapshot1> <snapshot2>`.
3. Detener el contenedor de la app:
   ```bash
   docker compose -f docker-compose.prod.yml stop web
   ```
4. Restaurar:
   ```bash
   zfs rollback <snapshot>
   ```
   O copiar desde otro snapshot:
   ```bash
   zfs send <snapshot-antiguo> | zfs receive /mnt/data-nas/motogp/pgdata
   ```
5. Arrancar la app:
   ```bash
   ./deploy.sh
   ```

### 4.2 Desde archivo de dump (pg_dump)

1. Copiar el dump al servidor:
   ```bash
   scp motogp-backup.sql root@192.168.1.3:/tmp/
   ```
2. Detener la app:
   ```bash
   docker compose -f docker-compose.prod.yml stop web
   ```
3. Restaurar:
   ```bash
   docker compose -f docker-compose.prod.yml exec postgres \
     pg_restore -U motogp -d motogp --clean --if-exists /tmp/motogp-backup.sql
   ```
4. Arrancar la app:
   ```bash
   ./deploy.sh
   ```

**Verificar post-restore:**

```bash
curl -s https://motogp.raulmorales.eu/api/health | jq .
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

## 6. Rotación de secrets

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

## 7. Checklist post-deploy

Tras cada `./deploy.sh`:

| Paso | Comando | Esperado |
| ---- | ------- | -------- |
| Health-check | `curl -s https://motogp.raulmorales.eu/api/health` | `{"ok":true}` |
| Páginas públicas | `curl -s -o /dev/null -w "%{http_code}" https://motogp.raulmorales.eu/` | `200` |
| Directorio de ligas | `curl -s -o /dev/null -w "%{http_code}" https://motogp.raulmorales.eu/ligas` | `200` |
| Login | `curl -s -o /dev/null -w "%{http_code}" https://motogp.raulmorales.eu/login` | `200` |
| tRPC health | `curl -s https://motogp.raulmorales.eu/api/trpc/health` | `{"ok":true}` |
| BD migrada | `docker compose -f docker-compose.prod.yml exec postgres psql -U motogp -d motogp -c "SELECT count(*) FROM prisma_migrations;"` | `> 0` |
| Redis vivo | `docker compose -f docker-compose.prod.yml exec redis redis-cli ping` | `PONG` |

---

## 8. Contacto y escalación

| Problema | Primer nivel | Escalado |
| -------- | ------------ | -------- |
| Resultados incorrectos | Admin → corrección manual | Contactar proveedor de datos |
| BD corrupta | Restore de backup (§4) | — |
| Deploy fallido | `./deploy.sh` (reintentar) | Revisar logs → `docker compose logs` |
| Incidente de seguridad | Rotar secrets (§6) | — |
| Rendimiento / latencia | Reiniciar web (`docker compose restart web`) | Verificar recursos del NAS |
