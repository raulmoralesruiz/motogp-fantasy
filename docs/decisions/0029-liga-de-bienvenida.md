# ADR-0029: Liga de bienvenida al registrarse (US-31)

- **Estado:** Aceptado (2026-10-29) — implementado y verificado (servicio + router + env + tests; todas las puertas en verde: lint 0 issues, typecheck, pureza, unit 680, UI 434, build, integración 413/413 y gate de cobertura fusionada 99.9% ≥ 99.9%)
- **Fecha:** 2026-10-29
- **Relacionado:** US-31 (backlog E6), ADR-0005 (modelo de ligas), ADR-0024 (liga pública y directorio — la bienvenida es una **pública** visible), ADR-0025 (unirse a una liga — `addLeagueMemberInTransaction` reutiliza el alta de membresía bajo lock), ADR-0010 (bootstrap de admin por env — el mismo patrón de "configuración operativa por env"), `leagues.md` §2 (tipos de liga) y §6 (unirse), invariantes 3 y 4 (AGENTS.md §4), T-09 (auditoría append-only), AGENTS.md §8 (el servidor manda; nunca confiar en valores del cliente).

## Problema

La CA de US-31: *"al registrarse, el usuario queda en una liga pública de bienvenida (creada/operada por el admin) para no empezar solo."*

Lo que **ya existía**:

- El alta de membresía transaccional bajo lock de liga: `addLeagueMemberInTransaction` (US-25/US-27) — revalida la plaza con `FOR UPDATE`, reactiva una membresía previa (upsert) y audita `league.joined` en la **misma** transacción.
- El registro (US-01, `AuthService.register`): crea el usuario + rol `user` (+ `global_admin` si es el bootstrap, ADR-0010) en **una transacción**, y solo entonces crea la sesión.
- La validación del entorno por Zod (`app/server/env.ts`) con parámetros operativos (T-08, ADR-0010: `BOOTSTRAP_ADMIN_EMAIL`).

Lo que **faltaba** (el trabajo real de US-31):

1. **Alta automática en la liga de bienvenida** al registrarse, **atómica** con la creación del usuario (si la bienvenida falla, el registro falla y no queda usuario colgado).
2. **La liga la configura el servidor** (UUID por env), **nunca** el cliente (AGENTS.md §8: no confiar en valores del cliente).
3. **Reutilizar el alta de membresía existente** (plaza, lock, auditoría) sin duplicar la lógica.
4. **No romper la arquitectura de módulos** (`identity` no debe importar `leagues`).

## Opciones

### 1. Dónde se añade la bienvenida

1. **Hook `onRegistered` inyectado en `AuthService`, dentro de la transacción de registro (elegida):** el BFF (`createAuthRouter`) inyecta un callback que añade la membresía **en la misma transacción** que el usuario. `identity` no importa `leagues` (el callback viene de fuera, inyección de dependencias); la atomicidad es total (si la bienvenida falla, revierte el usuario y la sesión no se crea). El bootstrap de admin (ADR-0010) y la bienvenida comparten la misma transacción (si una falla, revierte la otra).
2. Añadir la membresía **después** de registrar (dos transacciones): si la segunda falla, queda un usuario sin bienvenida (o hay que reventar el registro). No atómico; más complejo.
3. Que `identity` importe `leagues` y llame directamente: rompe la dirección de dependencias (AGENTS.md §3) y acopla los módulos.

### 2. Cómo se configura la liga de bienvenida

1. **UUID por env (`WELCOME_LEAGUE_ID`), validado por `env.ts` (elegida):** el servidor fija el UUID de una liga **pública, visible y activa** (creada/operada por el admin, US-23/US-24). Vacío/ausente = bienvenida desactivada (registro normal). Mismo patrón que `BOOTSTRAP_ADMIN_EMAIL` (ADR-0010): configuración operativa por env, no por cliente. El UUID se valida (Zod) en `env.ts`.
2. Por ID de liga en el payload del registro: el cliente podría apuntar a cualquier liga (contra AGENTS.md §8: no confiar en el cliente). Rechazado.
3. Por nombre/etiqueta de liga: ambiguo (varias ligas pueden tener el mismo nombre) y el cliente podría manipularlo. Rechazado.

### 3. Qué pasa si la bienvenida no está disponible

1. **El registro falla y hace rollback del usuario (elegida):** si la liga no existe, no es pública/visible/activa, o está **llena**, el registro **rechaza** (`BAD_REQUEST` con motivo en español) y **revierte** el usuario (no queda usuario colgado, no se crea sesión). La bienvenida es parte del contrato del registro; si no se puede cumplir, el registro no se completa.
2. El registro sigue y el usuario queda **sin** bienvenida (aviso): deja usuarios "a medias" (registrados pero fuera de la liga de bienvenida), contra la CA ("el usuario **queda** en una liga pública de bienvenida").
3. Crear la liga de bienvenida al vuelo si no existe: el servidor no debería crear ligas (acción de admin, US-23) ni decidir su configuración (nombre, límites, modo) en el camino del registro.

## Decisión

### Arquitectura (US-31)

- **`AuthService`** (módulo `identity`, I/O):
  - Gana el hook opcional **`onRegistered?: (tx, user, meta) => Promise<void>`** en `deps`. En `register`, **dentro de la transacción** (tras crear el usuario + el bootstrap de admin), llama a `onRegistered?.(tx, { id: created.id }, meta)`. Si lanza, la transacción revierte (usuario, bootstrap y membresía) y la sesión **no** se crea.
  - El refactoring del bootstrap de admin (ADR-0010) evita el `return` temprano: el bootstrap y la bienvenida comparten la transacción y el orden de revocación es coherente.
- **`addLeagueMemberInTransaction`** (módulo `leagues`, `league-membership.ts`): reutiliza el alta de membresía bajo lock (US-25/US-27) con `via: "welcome"` — revalida la plaza (`FOR UPDATE`), la reactiva si existe (upsert) y audita `league.joined` con `afterData.via = "welcome"` (distingue el canal de la unión voluntaria `code`/`open`). Para `via = "welcome"` exige además que la liga sea **pública, visible y activa** (la bienvenida no puede apuntar a una privada/inactiva).
- **`createAuthRouter`** (BFF, `app/server/routers/auth.ts`):
  - Gana el dep opcional **`welcomeLeagueId?: string`**. Si está presente, inyecta `onRegistered = (tx, user, meta) => addLeagueMemberInTransaction(tx, { leagueId: welcomeLeagueId, userId: user.id, actorId: user.id, ip: meta.ip, via: "welcome" })`. Si no, `onRegistered` es `undefined` (registro sin bienvenida).
  - **`welcomeLeagueId` es opcional** (no rompe los muchos callers existentes de `createAuthRouter`).
  - El router por defecto (producción) lo toma de `env.WELCOME_LEAGUE_ID || undefined`.
- **`env.ts`** (`app/server/env.ts`): gana **`WELCOME_LEAGUE_ID`** (vacío por defecto; si se fija, debe ser un **UUID** — validado por Zod). Parámetro **operativo** (no regla de juego), coherente con `BOOTSTRAP_ADMIN_EMAIL` (ADR-0010).
- **`.env.example` / `.env.prod.example` / `docker-compose.prod.yml`:** documentan `WELCOME_LEAGUE_ID` (vacío = bienvenida desactivada).
- **Router `auth` (BFF):** sin cambios de procedimientos (la bienvenida viaja por `register`, ya existente; el UUID sale del **servidor**, nunca del payload).
- **UI:** sin cambios (el usuario no ve la configuración de la bienvenida; es transparente en el registro).

### Semántica

- **Al registrarse**, si `WELCOME_LEAGUE_ID` está configurado, el usuario **queda como miembro activo** (`role = member`) de esa liga, **en la misma transacción** que su creación (y su bootstrap de admin, si aplica). Recibe su sesión normal.
- **La liga la configura el servidor** (UUID por env). El cliente **nunca** envía el ID de la liga de bienvenida (AGENTS.md §8).
- **Si la bienvenida no está disponible** (liga inexistente, no pública/visible/activa, o **llena**), el registro **rechaza** (`BAD_REQUEST` con motivo en español) y **revierte** el usuario (no queda usuario colgado, no se crea sesión).
- **Concurrencia:** dos registros concurrentes por la **última plaza** no pueden confirmar ambas (la plaza se revalida con `FOR UPDATE`, US-25); solo uno confirma la membresía y el otro revierte.
- **Auditoría (T-09, append-only, misma transacción):** `league.joined` con `afterData.via = "welcome"` (distingue el canal de la unión voluntaria).
- **Sin `WELCOME_LEAGUE_ID`:** el registro es como antes (sin alta automática).

## Consecuencias

- `AuthService` gana el hook `onRegistered` (inyección de dependencias): `identity` **no** importa `leagues` (la dirección de dependencias se mantiene, AGENTS.md §3). El BFF es quien conecta ambos módulos.
- `createAuthRouter` gana el dep opcional `welcomeLeagueId` (no rompe los callers existentes).
- El registro ahora puede **fallar** por la disponibilidad de la bienvenida (liga llena/inexistente/no pública): es un `BAD_REQUEST` nuevo en el camino del registro (antes solo fallaba por duplicados/términos/validación). Los tests de US-01 que registran sin `WELCOME_LEAGUE_ID` no se ven afectados.
- `env.ts` gana `WELCOME_LEAGUE_ID` (UUID o vacío); los tests de `env` se actualizan (presencia + validación de UUID).
- La bienvenida reutiliza `addLeagueMemberInTransaction` (US-25/US-27): la plaza, el lock y la auditoría son los mismos que en la unión voluntaria (una sola fuente de la lógica de membresía).
- El bootstrap de admin (ADR-0010) y la bienvenida comparten transacción: si una falla, revierte la otra (el bootstrap no queda "a medias" con una bienvenida fallida).
- La liga de bienvenida es una **liga pública normal** (US-23/US-24): el admin la crea y la opera como cualquier otra (puede llenarse, cerrarse, etc.). El sistema no la crea ni la gestiona; solo apunta a su UUID.

## Validación

- **Integración (CA de US-31):** `test/integration/auth.test.ts` (bloque "US-31 · liga de bienvenida", 6 casos):
  - **Alta:** el usuario queda como miembro activo de la bienvenida + recibe sesión + auditoría `league.joined` con `via = "welcome"`.
  - **Sin bienvenida configurada:** el registro no crea membresías (comportamiento anterior).
  - **Bienvenida llena:** el registro falla (`La liga está llena.`) y **no deja** usuario, sesión ni membresía (rollback).
  - **Bienvenida privada o inactiva:** el registro falla (`La liga de bienvenida no está disponible.`) y hace **rollback** del usuario (privada e inactiva).
  - **Concurrencia por la última plaza:** solo un registro confirma la membresía (el otro revierte; una sola cuenta creada).
  - **Bootstrap de admin + bienvenida:** conserva el rol `global_admin` **y** añade la membresía (misma transacción).
- **Env:** `app/server/__tests__/env.test.ts` — `WELCOME_LEAGUE_ID` vacío por defecto; si se fija, debe ser un **UUID** (lanza si no lo es).
- **Cobertura:** mantener el gate global fusionado 99.9% (T-24) — medido ≥99.9% (1527 tests, 131 archivos).
