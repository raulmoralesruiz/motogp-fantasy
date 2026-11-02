# ADR-0034: Disparo automático de jobs de background (T-10) — worker BullMQ + lock por GP en Redis

- **Estado:** Aceptado (2026-11-02)
- **Fecha:** 2026-11-02
- **Relacionado:** T-10 (backlog, CA de lock + rendimiento), US-08/ADR-0015 (fórmula de precios por GP), US-17/ADR-0019 (adapter + job de polling `pollResults`), US-18/ADR-0020 (definitivo + primer recálculo inline) y US-19/ADR-0021 (recálculo auditable), AGENTS.md §6 (recálculo como job con lock por GP) y §8 (idempotencia).

## Problema

Hoy dos trabajos de background **no tienen disparo automático**:

1. **Precios por GP (US-08):** la fórmula (`PriceService.applyFormulaForGp`) solo corre cuando el admin la dispara a mano desde el panel (`market.prices.applyFormula`). Tras marcar un GP definitivo, los precios del siguiente GP deberían actualizarse solos.
2. **Polling de resultados (US-17):** `pollResults` existe como función (importa de la fuente los GPs de la ventana), pero nada la ejecuta periódicamente — el admin importa a mano.

Ambos necesitan además la **garantía de un solo job a la vez por GP** (CA de T-10: "un solo recálculo a la vez por GP … 2 jobs simultáneos → se serializan, sin duplicados") y un **test de rendimiento** (GP de 1000 lineups recalculado en < 30 s).

El **recálculo de puntos** ya es automático e inline (disparado en `markDefinitive` y en las importaciones, US-18/US-19) y se **mantiene inline** (no se convierte en job): lo único que se automatiza es (a) la fórmula de precios y (b) el polling de resultados.

Decisiones a tomar: **mecanismo de cola**, **lock por GP**, **despliegue del worker** y **alcance del disparo automático**.

## Opciones

1. **BullMQ + Redis (elegido):** cola de jobs madura y persistente; reintentos con backoff, jobs repeatables (para el polling), y `Redis` ya está en la infraestructura (dev + prod). El lock por GP se resuelve con `SET key token NX PX ttl` + release condicional (Lua), atómico y multi-proceso.
2. **`setInterval` en el proceso de la web:** sin persistencia (un job se pierde si el proceso se reinicia), sin reintentos, sin lock multi-proceso (dos réplicas de la web duplicarían jobs), y mezcla el ciclo de vida de la web con el de los workers.
3. **Cron del sistema + lock advisory en Postgres (`pg_advisory_lock`):** el lock advisory vive en la conexión (se pierde si la conexión cae; no hay expiración), no hay reintentos/backoff, y el polling no es un "job" encolado (no hay historial ni visibilidad).

Sobre el **despliegue**: worker como **contenedor separado** (`motogp-worker`, misma imagen que la web, otro `CMD`) frente a correrlo dentro del proceso de la web. El contenedor separado es la best practice de BullMQ (escalabilidad, ciclo de vida independiente, no compite con la web por CPU) y reutiliza la imagen ya construida.

## Decisión

**Worker BullMQ separado + lock por GP en Redis**, con estas reglas:

- **Dos colas** (nombres estables en `shared/config/jobs.ts` — no constantes mágicas): `gp-prices` (un job por GP, aplica la fórmula US-08) y `results-poll` (job **repeatable**, cada `PROVISIONAL_RESULTS_POLL.intervalMinutes`).
- **Disparo automático de precios:** `results.markDefinitive` **encola** `gp-prices` tras el commit (solo si `!noop && resultsVersion`), **fire-and-forget** — un fallo de cola no rompe el flujo principal (el admin puede re-disparar a mano con `market.prices.applyFormula`).
- **Polling:** el worker registra el job repeatable al arrancar (`upsertJobScheduler`, **idempotente** — re-arrancar no duplica) y lo consume.
- **Lock por GP (Redis):** `GpLockStore` (contrato inyectado, `jobs/prices.ts`) con **semántica con token** — `acquire` devuelve el token de dueño o `null` (ocupado); `release` solo libera si el token coincide (un proceso no libera el lock de otro si el suyo expiró por TTL). Implementación de producción en `app/server/gp-lock-redis.ts` (`SET key token NX PX ttl` + script Lua de release). Si el lock está ocupado, el worker **reintenta** (BullMQ backoff); la **idempotencia** de `applyFormulaForGp` evita duplicados aunque dos jobs terminen aplicando.
- **Worker = contenedor separado** (`motogp-worker`): misma imagen de la web (añade `worker/`, `app/` y `tsconfig.json` para que `tsx` resuelva los alias `@/*` en runtime), `CMD = npm run worker`. Requiere `DATABASE_URL` + `REDIS_URL`.
- **El recálculo de puntos NO cambia:** sigue inline (US-18/US-19). El lock de T-10 aplica a los jobs de background (precios/polling); la serialización del recálculo ya la garantiza la transacción `FOR UPDATE` del GP (US-18).
- **Parámetros operativos** (reintentos/backoff de BullMQ; la cadencia del polling vive ya en `shared/config/results-poll.ts`): en `shared/config/jobs.ts`, **no** en `season_rules` (AGENTS.md §1.3).

### Cambios de código

- `app/modules/jobs/prices.ts`: `GpLockStore` pasa a **semántica con token** (`acquire → string | null`, `release(gpId, token)`); `applyPricesForGp` usa el token (lo libera siempre, incluso si el servicio lanza).
- `app/server/gp-lock-redis.ts` (nuevo): `redisGpLockStore` — `SET job:gp:lock:<gp> <token> PX <ttl> NX` (CSPRNG de 16 bytes) + release Lua condicional por token.
- `app/shared/config/jobs.ts` (nuevo): `JOBS_QUEUE_GP_PRICES`/`JOBS_QUEUE_RESULTS_POLL`, `jobsConfigSchema` (reintentos/backoff) + `PROVISIONAL_JOBS` + `assertProvisionalJobsValid`.
- `app/server/queues.ts` (nuevo): colas BullMQ (creación **perezosa** — importar el módulo no conecta a Redis), `enqueueGpPrices`, `ensureResultsPollScheduler` (repeatable idempotente) y `enqueueFireAndForget` (encolar sin bloquear + log de fallo).
- `app/server/event-ref-resolver.ts` (nuevo): `createEventRefResolver` extraído del router (el worker lo importa sin arrastrar el módulo de router/tRPC); el router `results` lo re-exporta (tests intactos).
- `app/server/routers/results.ts`: dep opcional `enqueueGpPrices?` (default no-op — tests sin disparo) + hook fire-and-forget en `markDefinitive`; `getDefaultResultsRouter` inyecta `enqueueGpPrices` (producción).
- `worker/index.ts` (nuevo): consume `gp-prices` (con `redisGpLockStore`) y `results-poll` (repeatable); graceful shutdown (SIGINT/SIGTERM); registro del scheduler idempotente.
- `package.json`: script `worker` (`tsx worker/index.ts`) + `test:load` funcional (test de rendimiento).
- `test/integration/global-setup.ts` + `helpers.ts`: contenedor `redis:7` (Testcontainers) + `REDIS_URL_FILE`/`integrationRedisUrl()`; helper `seedHeavyGp` (1000 lineups, `createMany` + IDs pregenerados, lotes de lineups completos para el trigger de composición); `TEST_SEASON_RULES` (extraído de `seedWorld`).
- `Dockerfile` (runner): `COPY worker/ app/ tsconfig.json` (el worker corre con `tsx` desde el fuente).
- `docker-compose.prod.yml`: servicio `worker` (misma imagen, `command: npm run worker`); `deploy.sh` verifica que `motogp-worker` queda `running`.

## Consecuencias y límites

- **Nuevo proceso** en producción (`motogp-worker`): hay que arrancarlo (lo hace `deploy.sh`/compose) y vigilarlo (logs). Si no corre, **no hay disparo automático** (el manual sigue disponible) — documentado en `runbook.md`.
- **Redis pasa a ser fuente de verdad** de los jobs (colas + locks): ya estaba en la infra (sessions, rate-limit); `appendonly: yes` (persistencia) ya estaba fijado en prod.
- **Idempotencia es la red de seguridad** del lock: aunque dos jobs aplicaran (p. ej. por expiración de TTL), `applyFormulaForGp` y el auto-import son idempotentes (invariante 6) → sin duplicados.
- **Rendimiento:** el recálculo de 1000 lineups se mide en < 30 s (test `recalc-perf.test.ts`, `npm run test:load`); el umbral es holgado (medida real ~1,2 s) para que no sea un cuello de botella operable.
- **Alcance:** se automatizan precios + polling. El recálculo de puntos ya era automático (inline) y no se toca. La notificación (US-36) sigue como hoy.

## Validación

- **Concurrencia (CA):** `test/integration/jobs-lock.test.ts` (Redis real) — `acquire` devuelve token / segunda `acquire` → `null`; `release` solo con el token del dueño (un token equivocado no libera); **2 jobs simultáneos → se serializan, sin duplicados** (1 aplica, 1 `locked`).
- **Rendimiento (CA):** `test/integration/recalc-perf.test.ts` (1000 lineups recalculados en < 30 s; puntúa los 1000) — `npm run test:load`.
- **Unit:** `gp-lock-redis.test.ts` (mock de `redis`: clave, `NX`/`PX`, token, release condicional), `queues.test.ts` (encolado, scheduler repeatable, creación perezosa, fire-and-forget éxito/fallo), `jobs.test.ts` (config `PROVISIONAL_JOBS`), `prices.test.ts` (lock con token).
- **Puertas:** lint 0, typecheck, pureza, unit, build, integración, gate de cobertura fusionada ≥ 99.9%.
