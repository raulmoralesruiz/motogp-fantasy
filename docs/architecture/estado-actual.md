# Estado actual del código — explicado

> **Actualizado: 2026-10-16.** Este documento explica **el código que existe hoy en el repo**, archivo a archivo. `overview.md` describe la arquitectura _diseñada_ (la meta); este documento describe la _realidad_. Si vas a escribir código, lee esto antes que nada.
>
> Convenciones de todo el repo: documentación y mensajes en **español**, identificadores de código en **inglés** (AGENTS.md §2).

## 1. Estado por fase

| Fase                               | Estado                                                                                                                                                                                                                 |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fase 0 — Fundaciones**           | ✅ Cerrada (2026-10-14): bootstrap, CI, estructura de módulos + check de pureza, módulos puros `economy`/`scoring` con tests y golden files, esquema Prisma completo, spike de Testcontainers, deploy pull en TrueNAS. |
| **Fase 1 — Identidad y temporada** | 🚧 En curso: **US-01** (registro/login) y **T-20** (cabeceras de seguridad + CORS) **en producción** (2026-10-15). Pendiente: US-02, US-03, T-08, T-09, US-04…US-08.                                                   |
| **Fase 2 — Lineups y presupuesto** | ⬜ Sin empezar.                                                                                                                                                                                                        |
| **Fase 3 — Resultados**            | ⬜ Sin empezar.                                                                                                                                                                                                        |
| **Fase 4 — Ligas**                 | ⬜ Sin empezar.                                                                                                                                                                                                        |
| **Fase 5 — MVP**                   | ⬜ Sin empezar.                                                                                                                                                                                                        |

**Producción:** TrueNAS (modelo pull, `./deploy.sh`). Imagen `motogp-web:latest` = commit `7613a37` (US-01 + T-20). Accesos: `https://motogp.raulmorales.eu` (público, vía Cloudflare → NPM) y `http://192.168.1.3:22020` (LAN). La BD está limpia (0 usuarios). Detalle operativo en `docs/operations/deploy.md`.

## 2. Mapa del repositorio

```
.
├── app/                        # Monolito Next.js (App Router) + módulos
│   ├── modules/                #   Módulos de negocio (ver §4)
│   ├── server/                 #   Capa tRPC: contexto, routers, singletons (ver §6)
│   ├── shared/                 #   Tipos, config y validación compartidos (ver §5)
│   ├── trpc/client.tsx         #   Cliente tRPC + TanStack Query
│   ├── api/                    #   Handlers HTTP: /api/trpc/[trpc], /api/health
│   ├── page.tsx                #   Pantalla: inicio (estado del sistema + sesión)
│   ├── login/                  #   Pantalla: login
│   └── registro/               #   Pantalla: registro
├── prisma/                     # Esquema + migraciones (ver §3)
├── scripts/
│   ├── check-purity/           # Guardián de pureza de economy/scoring (T-03)
│   ├── seed/fiction-local.ts   # Seed del dataset ficticio (economy.md §7)
│   └── simulate/               # Simulación económica (economy.md §7): fetch, simulate, fiction, viz
├── test/
│   ├── integration/            # Tests de integración (Testcontainers, PG real)
│   └── fixtures/fiction/       # Dataset ficticio canónico + trayectorias
├── data/fixtures/              # Datos de temporadas (2025/2026) para la simulación económica
├── __tests__/cors.test.ts      # Tests de la función pura de CORS (T-20)
├── middleware.ts               # Middleware CORS (solo /api/*)
├── cors.ts                     # Decisión CORS (función pura, testeada)
├── next.config.ts              # CSP + cabeceras de seguridad (T-20) + output standalone
├── .github/workflows/ci.yml    # CI: calidad + docker smoke + gitleaks
├── docker-compose.yml          # Infra local: PostgreSQL 16 + Redis 7
├── deploy.sh                   # Deploy pull en el TrueNAS
└── docs/                       # Fuente de verdad de las reglas (product/, architecture/, decisions/, …)
```

## 3. Base de datos (Prisma)

`prisma/schema.prisma`: **28 modelos + 21 enums**, 2 migraciones:

- `20261014135444_init` — todo el esquema (data-model.md §2–§4).
- `20261014140000_lineup_composition_and_price_history` — lo que Prisma no puede expresar como constraint:
  - **Trigger `lineup_slots_composition`** (función `check_lineup_composition`): garantiza la composición **2 oro + 2 plata + 1 constructor + 1 equipo** en cada lineup (un `CHECK` no puede contar otras filas).
  - **Vista `price_history`**: histórico de precios por activo (derivado de `prices`).
  - **Índice parcial único `prices_asset_opening_unique`**: a lo sumo 1 precio de apertura por activo (`gp_id NULL`).

Invariantes duros como constraints (data-model.md §4):

| Constraint                                        | Dónde                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------- |
| 1 lineup activo por usuario por GP                | `Lineups @@unique([userId, gpId])`                                     |
| Importación idempotente                           | `Result @@unique([gpId, eventId, riderId])`                            |
| 1 precio por activo por GP                        | `Price @@unique([assetType, assetId, gpId])`                           |
| 1 afiliación por piloto por GP                    | `RiderAffiliation @@unique([riderId, gpId])`                           |
| 1 miembro por liga                                | `LeagueMember @@unique([leagueId, userId])`                            |
| Reglas versionadas por temporada                  | `SeasonRule @@unique([seasonId, version])`                             |
| 1 puntuación por lineup por versión de resultados | `Score @@unique([lineupId, resultsVersion])` + índice `[userId, gpId]` |

**Versionado de reglas:** `SeasonRule` guarda `rules` en JSONB validado por `seasonRulesSchema` (Zod, `app/shared/validation/season-rules.ts`). Una fila por (temporada, versión); una versión publicada **nunca se muta** (AGENTS.md §5).

## 4. Módulos (`app/modules/`)

Los 10 módulos del diseño existen como carpetas. **3 están implementados** (`economy`, `scoring`, `identity`); los 7 restantes son _placeholders_ (solo un `index.ts` vacío con su cabecera).

### 4.1 `economy/` — motor de presupuesto y precios (FÓRMULAS PURAS)

Sin I/O. Solo recibe datos y devuelve resultados. Fuente de verdad: `docs/product/economy.md`.

| Archivo      | Contenido                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `budget.ts`  | Motor de presupuesto por opción económica. `presupuestoA/B/C/E` + despachador `presupuesto(opción, params, contexto)`. **E (recomendada):** `B + min(t × sinUsarPrevio, cmax)` — anti-ratchet: el presupuesto **nunca** depende del valor de mercado del equipo.                                                                                                                             |
| `pricing.ts` | Motor de precios **`pricing-v1`**. `perf(puntos, Pmax)`, `computeNextPrice` (media móvil ponderada W = 0.5/0.3/0.2, ajuste del 50% al objetivo, bandas ±15% por GP y [0.25·P0, 2·P0]), `injuryPrice` (lesión: `max(0.25·P0, 0.5·precio)`), `seasonAbsencePrice` (baja: `0.25·P0`), `buildPriceSeries` (serie completa de una temporada). `PMAX_RIDER = 60`, `PMAX_GROUP = 30` (PROVISIONAL). |
| `__tests__/` | `budget.test.ts`, `pricing.test.ts` (incluyen los ejemplos verificables de AGENTS.md §7) y `golden/economy-v1.json` (golden file de la versión de reglas).                                                                                                                                                                                                                                   |

### 4.2 `scoring/` — motor de puntuación (FÓRMULAS PURAS)

Sin I/O. Fuente de verdad: `docs/product/scoring.md`.

| Archivo      | Contenido                                                                                                                                                                                                                                             |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tables.ts`  | Tablas **`scoring-v1`** (PROVISIONAL): `MAIN_RACE_POINTS` (1º: 25 … 15º: 1; 16+ no puntúa), `WINNER_BONUS = 5`, `DNF_PENALTY = 5`, `mainRacePositionPoints()`.                                                                                        |
| `engine.ts`  | `riderMainPoints(status, position)` (FINISHED → posición + bono; DNF → −5; ABSENT → 0), `topTwoAverage` (media de los 2 mejores de un grupo), `groupTopTwoAverage` (constructor/equipo), `lineupPoints(lineup, riderPoints, ctorPoints, teamPoints)`. |
| `__tests__/` | `engine.test.ts` (incluye el lineup de ejemplo de scoring.md §5 → **170.5 puntos**) y `golden/scoring-v1.json`.                                                                                                                                       |

> **Nota de alcance:** el engine consume hoy **solo la carrera principal**. Las tablas de Q2/sprint ya existen en `PROVISIONAL_SEASON_RULES` (`app/shared/config/season-rules.ts`), pero el engine no las consume todavía (pendiente de `scoring.md` / Fase 3).

### 4.3 `identity/` — autenticación (US-01)

No es un módulo puro (usa BD/Redis), pero sigue el patrón del resto: **la lógica de decisión es pura y testeada sin I/O**, y las dependencias se inyectan.

| Archivo           | Contenido                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `password.ts`     | argon2id con parámetros OWASP (19 MiB, t=2, p=1). `hashPassword`, `verifyPassword` (falla a `false`), `getDummyHash` (hash de relleno para igualar tiempos de respuesta y no enumerar usuarios).                                                                                                                                                                                                                                |
| `sessions.ts`     | Sesiones: token opaco (32 bytes hex) en BD + cookie `session` (`HttpOnly + SameSite=Lax`, `Secure` configurable). Piezas puras: `buildSessionCookie` (construcción de la cabecera `Set-Cookie`) y `parseCookieHeader`. I/O: `createSession`, `findActiveSessionUser` (descarta revocadas/vencidas/cuentas anonimizadas), `revokeSession` (idempotente; la usará US-02). `toPublicUser` (proyección sin datos sensibles — GDPR). |
| `rate-limit.ts`   | Anti fuerza bruta (security.md §1.1/§1.6). Pura: `evaluateLoginAttempt` (el bloqueo por cuenta **prima** sobre el rate limit por IP) y `shouldLockAccount`. Frontera de I/O: interfaz `RateLimitStore` (Redis en producción; `InMemoryRateLimitStore` con reloj inyectable en tests).                                                                                                                                           |
| `auth-service.ts` | `AuthService` (DI: `prisma`, `rateLimit`, config). **register:** rechazo explícito de email/username duplicados + creación transaccional de `User` + `Profile` + rol `user` + sesión. **login:** 1) bloqueo por cuenta, 2) rate limit por IP, 3) verificación argon2 (con hash de relleno si el usuario no existe), 4) conteo de fallos → bloqueo.                                                                              |
| `__tests__/`      | `sessions.test.ts`, `rate-limit.test.ts`.                                                                                                                                                                                                                                                                                                                                                                                       |

### 4.4 Módulos pendientes (placeholders)

`seasons/`, `market/`, `lineups/`, `results/`, `leagues/`, `admin/`, `jobs/` — cada uno con solo un `index.ts` vacío. El esquema de BD **ya los modela todos**; falta el código. Su trabajo está en el backlog: E2/E3 (US-04…US-08: temporadas, GPs, mercado, precios, admin), E4 (lineups), E5 (resultados + jobs), E6 (ligas), E7 (endurecimiento/MVP).

## 5. `app/shared/` — compartido cliente/servidor

| Archivo                      | Contenido                                                                                                                                                                                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `types/index.ts`             | Tipos de dominio (activos del mercado, resultados por GP, lineup, …). Es el **único** import permitido a los módulos puros.                                                                                                                                                                       |
| `config/season-rules.ts`     | `PROVISIONAL_SEASON_RULES` (versión `provisional-v1`): B=100, t=0.25, cmax=8, Pmax 60/30, tablas de puntuación, límites de liga, transfers… Defaults tipados para tests/scripts/Fase 0; en producción viven en `season_rules` (JSONB). `assertProvisionalRulesValid` los valida contra el schema. |
| `validation/season-rules.ts` | `seasonRulesSchema` (Zod): el contrato de `season_rules.rules`.                                                                                                                                                                                                                                   |
| `validation/auth.ts`         | Esquemas de registro/login (mensajes en español). El cliente los usa para UX; **el servidor siempre revalida**.                                                                                                                                                                                   |

## 6. Capa servidor (`app/server/`) y UI

| Archivo                        | Contenido                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `env.ts`                       | Validación Zod del entorno con defaults: `SESSION_TTL_DAYS=7`, `AUTH_RATE_LIMIT_MAX=10`/`60 s`, `AUTH_LOCKOUT_THRESHOLD=5`/`900 s`, `SESSION_COOKIE_SECURE` (default `true` en producción). Son parámetros **operativos**, no reglas de juego.                                                                                                                      |
| `prisma.ts` / `redis.ts`       | Singletons perezosos (1 por proceso).                                                                                                                                                                                                                                                                                                                               |
| `rate-limit-redis.ts`          | `RateLimitStore` sobre Redis (producción).                                                                                                                                                                                                                                                                                                                          |
| `trpc.ts`                      | Inicialización tRPC: transformer `superjson`; contexto = `prisma` + `redis` + IP del cliente (`X-Forwarded-For` → `X-Real-IP`) + usuario de sesión + **`pendingCookies`** (los procedimientos registran la cabecera `Set-Cookie` y el handler la monta); formateo de errores con el mensaje del procedimiento en español. `publicProcedure` / `protectedProcedure`. |
| `routers/auth.ts`              | `createAuthRouter` (inyectable para tests) + singleton por defecto. Procedimientos: `register`, `login`, `me`.                                                                                                                                                                                                                                                      |
| `routers/health.ts`            | `check`: estado de app + BD + Redis (timeout de 3 s por dependencia).                                                                                                                                                                                                                                                                                               |
| `routers/_app.ts`              | `appRouter` = `auth` + `health`.                                                                                                                                                                                                                                                                                                                                    |
| `app/api/trpc/[trpc]/route.ts` | Handler tRPC (fetch) + montaje de `Set-Cookie` desde `ctx.pendingCookies`.                                                                                                                                                                                                                                                                                          |
| `app/api/health/route.ts`      | Liveness sin dependencias (lo usa el healthcheck de Docker y `deploy.sh`).                                                                                                                                                                                                                                                                                          |

**UI (App Router):** 3 pantallas — `/` (estado del sistema + sesión activa), `/login`, `/registro` — con cliente tRPC + TanStack Query (`app/trpc/client.tsx`). Nada de negocio en el cliente: el cliente es una vista (AGENTS.md §8).

## 7. Seguridad (T-20, ADR-0008)

- **Cabeceras** (`next.config.ts`, todas las rutas): CSP (`default-src 'self'`, `unsafe-inline` solo por RSC), HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`.
- **CORS** de la API: `middleware.ts` (solo `/api/*`) delega en `evaluateCors` (`cors.ts`), **función pura** testeada en `__tests__/cors.test.ts`. Estrategia: **reflejo de host** — un `Origin` se permite solo si su host coincide exactamente con el `Host` de la petición (cubre `motogp.raulmorales.eu` y `192.168.1.3:22020` sin allow-list). Origen ajeno → 403; preflight → 204 con cabeceras.
- **Cookies de sesión:** `HttpOnly + SameSite=Lax`, `Secure` en producción (ver §6, `env.ts`).
- **Anti fuerza bruta:** rate limit por IP + bloqueo por cuenta (ver §4.3).

## 8. Puertas de calidad

**CI** (`.github/workflows/ci.yml`), en cada PR y push a `main`:

1. `quality`: lint → typecheck → unit **con coverage** → integración (Testcontainers, PostgreSQL real) → **check de pureza** → build.
2. `docker`: build de la imagen + smoke HTTP (cabeceras de seguridad + CORS).
3. `secrets`: gitleaks (T-19).

**Check de pureza** (`scripts/check-purity/`, T-03): scanner AST (API del compilador TypeScript, sin falsos positivos por comentarios) que falla si `economy`/`scoring` importan I/O de Node, infraestructura de la app, resuelven imports fuera del módulo (solo se permite `app/shared/types`) o usan el reloj (`Date.now()`, `new Date()`). Se ejecuta dentro de `npm run build` **y** en CI: un módulo puro que impurea **rompe el build**.

**Cobertura** (vitest, provider v8): **≥90%** en `economy` y `scoring` (líneas/sentencias/funciones); global **39% PROVISIONAL** (D-08; calibrado a la medida real del 2026-10-15).

**Golden files** por versión de reglas: `app/modules/economy/__tests__/golden/economy-v1.json` y `app/modules/scoring/__tests__/golden/scoring-v1.json`. Cambiar una regla exige actualizar el golden de forma **explícita y revisada** (testing.md).

**Distribución de tests:**

| Capa        | Dónde                                                                                                             | Qué                                                                                                                                                                                                                                                                             |
| ----------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | `app/modules/**/__tests__`, `app/shared/**/__tests__`, `__tests__/cors.test.ts`, `scripts/check-purity/__tests__` | Fórmulas puras, validación, CORS, pureza. `npm run test` (no requiere Docker).                                                                                                                                                                                                  |
| Integración | `test/integration/`                                                                                               | `auth` (registro/login contra PG real), `constraints` (invariantes de BD, trigger de composición), `db.smoke`, `fiction-seed` (import idempotente del dataset ficticio). `npm run test:integration` (requiere Docker; 1 contenedor de PG por ejecución, migraciones aplicadas). |
| Fixtures    | `test/fixtures/fiction/`                                                                                          | Dataset ficticio canónico (economy.md §7) + trayectorias. **Nunca PII ni datos reales de usuarios.**                                                                                                                                                                            |

## 9. Dónde vive cada invariante (AGENTS.md §4)

| #   | Invariante                                                    | Dónde se garantiza hoy                                                                                                                                                    |
| --- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 2 oro + 2 plata + 1 constructor + 1 equipo                    | Trigger `lineup_slots_composition` (migración 0002) + test de integración `constraints`. ✅                                                                               |
| 2   | Coste del lineup ≤ presupuesto                                | **Modelado** (`Price`, `BudgetMovement`, `season_rules`); la validación server-side en transacción llega con el módulo `lineups` (Fase 2). ⬜                             |
| 3   | 1 lineup activo por usuario por GP                            | `Lineups @@unique([userId, gpId])`. ✅                                                                                                                                    |
| 4   | Mismos puntos en todas las ligas                              | **Modelado**: `Score` por `(lineup, resultsVersion)` + índice `(userId, gpId)`; rankings por liga en `Ranking`. La garantía llega con `lineups`/`leagues` (Fases 2/4). ⬜ |
| 5   | Constructor ≠ equipo                                          | Modelos y `AssetType` separados; precios y puntuación distintos por diseño. ✅ (modelado)                                                                                 |
| 6   | Importación idempotente                                       | `Result @@unique([gpId, eventId, riderId])` + test `fiction-seed`. ✅                                                                                                     |
| 7   | Versionado de puntuaciones                                    | **Modelado**: `Score.rulesVersion` + `Score.resultsVersion`, `ResultsHistory` (append-only). La garantía llega con `results` (Fase 3). ⬜                                 |
| 8   | Anti-ratchet (presupuesto independiente del valor del equipo) | Fórmula pura `presupuestoE` + golden files + tests. ✅                                                                                                                    |

## 10. Versionado de reglas y resultados

- Cada temporada declara una versión de reglas en `season_rules` (JSONB validado por `seasonRulesSchema`). Cambiar reglas ⇒ **nueva versión**; la anterior nunca se muta; aplicación solo a GPs futuros o recálculo explícito y auditado (AGENTS.md §5).
- Hoy existe `PROVISIONAL_SEASON_RULES` (`provisional-v1`) como defaults tipados; la primera fila real de `season_rules` se creará con US-04 (temporadas).
- Los resultados (cuando lleguen, Fase 3) tendrán estado `provisional → definitive`/`corrected`, cada recálculo generará una nueva `resultsVersion` y conservará el histórico en `ResultsHistory`. **Los resultados no se borran: se corrigen.**

## 11. Lo que NO está implementado todavía

- **Módulos vacíos:** `seasons`, `market`, `lineups`, `results`, `leagues`, `admin`, `jobs` (solo `index.ts`).
- **Fase 1 pendiente:** US-02 (cierre de sesión y recuperación de contraseña), US-03 (perfil: datos, exportación y eliminación de cuenta), T-08 (RBAC por recurso), T-09 (auditoría), US-04 (temporadas + reglas), US-05 (GPs/circuitos/eventos), US-06 (mercado), US-07 (precios P0 + histórico), US-08 (precios por fórmula + ajuste manual).
- **E2E y carga:** `npm run test:e2e` y `npm run test:load` son placeholders sin ID propio en el backlog (las capas e2e y carga de `testing.md` se cubren con las épicas de Fase 5; ver la CA de E7).
- **UI:** solo las 3 pantallas de §6; las ~18 pantallas de `docs/product/user-flows.md` llegan con sus épicas.
- **Importación de resultados:** el contrato `ResultsSource` está diseñado (`docs/architecture/integrations.md`); PulseLive y la entrada manual son las implementaciones previstas (MVP).
