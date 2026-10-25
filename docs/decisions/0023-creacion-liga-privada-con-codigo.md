# ADR-0023: Creación de liga privada con código (US-23)

- **Estado:** Aceptado (2026-10-25) — implementado y verificado (migración + núcleo puro + servicio + router + UI + tests; todas las puertas en verde: lint, typecheck, unit, UI, pureza, build, integración 320/320 y gate de cobertura 99.91% ≥ 99.9%)
- **Fecha:** 2026-10-25
- **Relacionado:** US-23 (backlog E6), ADR-0005 (modelo de ligas — `leagues`/`league_members`/`league_invites`), `leagues.md` §3–§5 (creación, código, permisos; fuente de verdad), `security.md` §1.6 (rate-limiting: "creación de ligas"), T-08 (RBAC por recurso), T-09 (auditoría append-only), `data-model.md` §3 (`league_invites` = invitaciones/códigos).

## Problema

`leagues.md` §3 define la creación de liga ("el creador define nombre,
descripción, tipo, visibilidad, min/máx miembros, modo de entrada, duración;
el creador es admin; se genera un código de invitación si el modo lo
requiere") y §4 fija las propiedades del código (≥8 caracteres de alta
entropía, sin 0/O/1/I, revocable: "generar nuevo código invalida el
anterior"). El esquema ya tenía las tablas (T-06: `leagues`,
`league_members`, `league_invites`), pero faltaban las semánticas concretas
que US-23 debe implementar:

1. ¿Dónde vive la generación del código y cómo se garantiza la entropía sin
   romper la pureza del núcleo?
2. ¿Qué significa "revocable" a nivel de datos (¿un campo en `leagues` o
   filas en `league_invites`)?
3. ¿En qué estado queda la liga al crearse (`planned` vs `active`)?
4. ¿Qué modos de entrada generan código?
5. ¿Dónde se validan los límites PROVISIONAL de miembros (2–50)?
6. ¿Cómo se aplica el rate-limiting de "creación de ligas" (security.md
   §1.6) sin romper la dirección de dependencias?
7. ¿Qué se registra en auditoría (el código es un secreto)?

## Opciones

### 1. Generación del código

1. **Fórmula pura en `leagues/core` con fuente de aleatoriedad inyectable
   (elegida):** `generateLeagueCode(length, random)` — pura (sin I/O: la
   aleatoriedad entra como parámetro; la fuente por defecto es el CSPRNG de
   Node). Mismo contrato que `economy`/`scoring`/`lineups/core`: testable
   determinista, auditada por el check de pureza T-03 (añadido
   `leagues/core` a las raíces auditadas).
2. Generar el código en el servicio con `crypto.randomUUID()` o
   `Math.random()`: `Math.random()` no es CSPRNG (insuficiente entropía para
   un secreto anti fuerza bruta); `randomUUID` no permite el alfabeto sin
   0/O/1/I ni la longitud ≥8 exigida.
3. Generarlo en la UI y enviarlo al servidor: el cliente nunca genera
   secretos (AGENTS.md §8: el servidor manda).

### 2. "Revocable" a nivel de datos

1. **Filas en `league_invites` (elegida):** el código vive en
   `league_invites.code` (unique); rotar = revocar las filas `active`
   (status → `revoked`) + crear una nueva. Preserva el histórico (se puede
   auditar cuántos códigos hubo), coherente con `data-model.md` §3
   ("`league_invites` — invitaciones/códigos … estado: active/revoked") y
   con la invariante de no borrar histórico.
2. Un campo `leagues.code` que se sobreescribe: pierde el histórico del
   código anterior (no se puede auditar la rotación) y mezcla la entidad
   liga con el secreto.

### 3. Estado de la liga al crearse

1. **`active` (elegida):** la liga queda operativa al crearse: el creador es
   admin y puede unirse a miembros de inmediato con el código. `leagues.md`
   §3 no define un estado "planificado" por defecto; los estados
   `finished`/`archived` son posteriores (cierre, US-27).
2. `planned` hasta que haya 2 miembros: introduce un estado intermedio no
   pedido por la CA y bloquea la unión (US-25) justo cuando el creador quiere
   invitar.

### 4. Modos de entrada que generan código

1. **`code` y `mixed` generan código; `invite` no (elegida):** `leagues.md`
   §3: "se genera un código de invitación (si el modo lo requiere)". El modo
   `invite` (solo invitación directa) no lo requiere.
2. Siempre generar código: un modo "solo invitación" con código visible
   contradice el modo.

### 5. Límites PROVISIONAL de miembros (2–50)

1. **Inyectados en el servicio, por defecto `PROVISIONAL_SEASON_RULES.league`
   (elegida):** AGENTS.md §1.3: los valores PROVISIONAL "viven en
   `season_rules` (tabla versionada, JSONB) y en `shared/config`" — nunca
   hardcodeados. El servicio valida `minMembers ≥ 2` y `maxMembers ≤ 50`
   contra el límite inyectado (tests pueden sobreescribirlo).
2. Hardcodear 2/50 en el schema Zod o en el servicio: viola AGENTS.md §1.3
   y §11 (no hardcodear parámetros de reglas).

### 6. Rate-limiting de creación

1. **Método `recordLeagueCreation(userId, windowSec)` en `RateLimitStore`
   (elegida):** patrón establecido por `recordAttempt`/`recordResetRequest`/
   `recordUserDeletion` (US-01/02/03): el store (Redis en producción,
   `InMemoryRateLimitStore` en tests) expone el contador de ventana y el
   servicio decide. Clave por USUARIO (`rl:league:create:user:*`): la
   creación es una acción de cuenta, no de IP.
2. Rate-limit por IP: penaliza a usuarios legítimos detrás del mismo NAT y
   no protege a un usuario que crea ligas en masa (el abuso real).
3. Sin rate-limit: viola security.md §1.6 (lista explícita: "creación de
   ligas").

### 7. Auditoría

1. **`league.created` y `league.code_rotated` sin el código (elegida):** el
   código es un secreto (como una contraseña): se registran los IDs de
   invitación y metadatos (nombre, tipo, visibilidad, modo, min/máx,
   `codeGenerated: true/false`), nunca el valor. Coherente con US-02 (token
   de recuperación: solo su SHA-256 en BD) y T-09.
2. Registrar el código en `afterData`: expone el secreto en el histórico de
   auditoría (accesible a quien pueda leer `audit_log`).

## Decisión

### Arquitectura (US-23)

- **Fórmula pura** `generateLeagueCode(length, random)` en
  `leagues/core/invite-code.ts` (sin I/O): alfabeto de 32 caracteres (24
  letras sin I/O + 8 dígitos sin 0/1), longitud ≥8 (por defecto 10 → 32^10
  ≈ 1,15 × 10^15 combinaciones). Fuente por defecto: CSPRNG de Node
  (`randomBytes`); 256 es múltiplo de 32, así que `byte % 32` es uniforme
  (sin sesgo de módulo). `random` es inyectable para tests deterministas.
- **Servicio** `LeagueService` (módulo `leagues`, I/O):
  - `createLeague(input, meta)`: valida server-side (formato + límites
    2–50 + consistencia tipo/visibilidad), aplica el rate-limit por usuario,
    genera el código (si el modo lo requiere) y escribe en una transacción:
    `League` (status `active`) + `LeagueMember` (creador, rol `admin`) +
    `LeagueInvite` (código, si aplica) + auditoría `league.created`.
  - `rotateCode(leagueId, actorId, meta)`: solo el admin (revalida por
    recurso, T-08); transacción: revoca los códigos activos + crea uno nuevo
    + auditoría `league.code_rotated` (IDs, no el código). Devuelve el nuevo
    código.
  - `getLeague(leagueId, userId)`: solo miembros activos (extraños →
    NOT_FOUND, no se revela la existencia — leagues.md §9, US-24 CA); el
    código solo lo devuelve el admin (leagues.md §5).
  - `myLeagues(userId)`: ligas activas del usuario (detalle + código si es
    admin).
- **Router** `leagues` (BFF): `create` (cualquier usuario autenticado; el
  `userId` sale del contexto, nunca del input), `rotateCode`/`get`
  (autorización por recurso en el servicio), `myLeagues`.
- **Rate limit:** `recordLeagueCreation` en `RateLimitStore` (Redis +
  InMemory) + env `LEAGUE_CREATE_RATE_LIMIT_MAX` (5) /
  `LEAGUE_CREATE_RATE_LIMIT_WINDOW_SEC` (3600). Parámetro operativo, no
  regla de juego (no vive en `season_rules`).
- **UI** `/ligas`: formulario de creación (nombre, descripción, tipo,
  visibilidad, min/máx, modo de entrada, duración) + lista de mis ligas con
  código (solo admin) + botón "Rotar código".

### Semántica

- **Creador = admin:** `LeagueMember` con `role = admin`, `status = active`
  (leagues.md §3: "el creador es admin de la liga por defecto").
- **Código:** ≥8 caracteres del alfabeto sin 0/O/1/I (leagues.md §4); se
  genera cuando `entryMode ∈ {code, mixed}` (opción 4.1).
- **Rotación:** revoca todos los códigos activos de la liga y crea uno nuevo
  (leagues.md §4: "generar nuevo código invalida el anterior"); un solo
  código activo por liga en todo momento.
- **Acceso:** `getLeague` solo para miembros activos; el código solo lo ve
  el admin (leagues.md §5). La accesibilidad de ligas públicas a no miembros
  la añade US-24 (directorio).
- **Estado:** la liga queda `active` al crearse (opción 3.1).
- **Límites:** `minMembers ≥ 2` y `maxMembers ≤ 50` (PROVISIONAL,
  `shared/config`; opción 5.1); `minMembers ≤ maxMembers`; `endDate ≥
  startDate`; `type = private ⇒ visibility ≠ public`; `type = public ⇒
  visibility = public`.

### Migración

- **`20261025120000_league_description`:** añade `leagues.description TEXT`
  (la CA exige "nombre/descripción/…" y el modelo no la tenía). El resto del
  esquema ya existía (T-06).

## Consecuencias

- US-24 (liga pública + directorio), US-25 (unirse por código), US-26
  (permisos de liga) y US-28 (ranking por liga) construyen sobre esta base:
  el código ya existe y es rotado; la membresía del creador ya es admin.
- El núcleo `leagues/core` pasa a ser auditado por el check de pureza T-03
  (se añade a las raíces; `ranking.ts` y `invite-code.ts` lo pasan).
- `RateLimitStore` gana `recordLeagueCreation` (interfaz extendida;
  implementaciones Redis + InMemory).
- El código de liga es un secreto: no se registra en auditoría ni se expone
  a no-admins.
- La creación de ligas queda rate-limitada por usuario (security.md §1.6).

## Validación

- **Unit (fórmula pura):** `generateLeagueCode` (longitud por defecto y
  pedida, alfabeto sin 0/O/1/I sin duplicados, rechazo de longitudes <8 y no
  enteras, determinismo con fuente inyectada, secuencia de la fuente,
  CSPRNG por defecto sin colisiones) — `leagues/core/__tests__/invite-code.test.ts`.
- **Integración:** `createLeague` (creador = admin, liga activa, código
  válido, modo `invite` sin código, auditoría `league.created` sin el
  código, límites 2–50, min ≤ máx, consistencia tipo/visibilidad, fechas),
  `rotateCode` (anterior revocado + nuevo activo y distinto, solo admin,
  NOT_FOUND, auditoría `league.code_rotated`), `getLeague` (miembro ve la
  liga, código solo admin, extraño → NOT_FOUND), `myLeagues` (solo ligas
  activas), rate limit (N+1 → la última se rechaza) —
  `test/integration/leagues.test.ts`.
- **UI:** formulario de creación (payload correcto), éxito con código / sin
  código, error del servidor, rotación de código —
  `app/ligas/__tests__/ligas-page.test.tsx`.
- **Cobertura:** mantener el gate global fusionado 99.9% (T-24).
