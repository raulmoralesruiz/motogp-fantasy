# ADR-0026: Permisos de liga — admin/miembro (US-26)

- **Estado:** Aceptado (2026-10-27) — implementado y verificado (núcleo puro + servicio + router + UI + tests; todas las puertas en verde: lint 0 issues, typecheck, unit 674, UI 419, pureza 27 archivos, build, integración 392/392 y gate de cobertura 99.92% ≥ 99.9%)
- **Fecha:** 2026-10-27
- **Relacionado:** US-26 (backlog E6), ADR-0005 (modelo de ligas), ADR-0023 (creación de liga — el rol `admin` del creador y la rotación de código), ADR-0024 (liga pública — visibilidad y no-revelación a extraños, T-12 IDOR), ADR-0025 (unirse — el permiso de "invitar" se difiere a este US), `leagues.md` §5 (roles y permisos — fuente de verdad), `security.md` §1.6 (RBAC + autorización por recurso), T-08 (RBAC + autorización por recurso: una sola fuente de la regla), T-09 (auditoría append-only).

## Problema

`leagues.md` §5 define la tabla de permisos de la liga:

| Acción                                   | Admin de liga | Miembro                         |
| ---------------------------------------- | ------------- | ------------------------------- |
| Ver ranking y miembros                   | ✅            | ✅                              |
| Colocar/cambiar lineup                   | ✅            | ✅                              |
| Invitar usuarios (si el modo lo permite) | ✅            | ⚠️ solo si el admin lo habilita |
| Expulsar miembro                         | ✅            | ❌                              |
| Cambiar nombre/descripción/visibilidad   | ✅            | ❌                              |
| Revocar código / generar nuevo           | ✅            | ❌                              |
| Cerrar la liga                           | ✅            | ❌                              |
| Transferir admin                         | ✅            | ❌                              |

> - **Admin vs miembro:** el admin gestiona la liga; el miembro solo juega.
> - **Creador** puede ceder el rol de admin.

La CA de US-26: *"solo el admin expulsa, cambia configuración, revoca código,
cierra la liga o transfiere el rol (tests de integración: un miembro intenta
cada acción → 403); invitar solo si el admin lo habilita."*

Falta definir:

1. ¿Dónde vive la regla de permiso (pura y testable) para que el servicio y el
   router no la dupliquen (T-08: una sola fuente)?
2. ¿Qué hace exactamente cada acción de gestión (semántica de estado) y en qué
   orden se rechazan (permiso vs existencia vs estado)?
3. ¿Cómo se modela "invitar solo si el admin lo habilita" (hoy no hay campo
   que lo represente en BD)?
4. ¿Cómo se evita que un miembro (o un extraño) acceda a la gestión de una
   liga privada sin revelar su existencia (T-12 IDOR, ADR-0024)?
5. ¿Qué se audita (T-09) y cómo se conserva el histórico (no borrar)?

## Opciones

### 1. Dónde vive la regla de permiso

1. **Núcleo puro `canManageLeague(role, action)` + `canInvite(role, cfg)` en
   `leagues/core/permissions.ts` (elegida):** una función pura (sin I/O,
   auditada por el check de pureza T-03) que recibe el rol del actor y la
   acción (o la configuración de la liga) y devuelve `true`/`false`. El
   servicio (I/O) resuelve el rol de la BD y consume la regla; el router no la
   duplica (T-08: una sola fuente). Mismo contrato que `canViewLeague`
   (US-24), `evaluateLeagueJoin` (US-25) y `evaluateLoginAttempt` (US-01).
   La regla es un mapa `ACTION_ROLES: Record<action, roles[]>`, así que si una
   acción futura admite al miembro (p. ej. "invitar") basta con añadirlo aquí
   sin tocar el servicio.
2. Duplicar el check `role === "admin"` en cada método del servicio: cinco
   sitios que pueden divergir (el bug que T-08 persigue) y sin test de la
   regla aislado.
3. Decorador/middleware tRPC por endpoint: acopla la regla al router (BFF) y
   la saca del módulo (la dirección de dependencias es `UI → tRPC → modules`);
   además el router no conoce el rol (lo resuelve la BD), así que terminaría
   consultando la BD en el BFF.

### 2. Orden de rechazo (permiso vs existencia vs estado)

1. **Existencia → no-revelación → permiso (elegida):**
   1. Liga inexistente → `NOT_FOUND`.
   2. Extraño (no miembro activo) en una liga **privada** → `NOT_FOUND`
      idéntico al inexistente (no se revela la existencia — ADR-0024, T-12
      IDOR).
   3. Miembro activo no admin (o extraño en pública) → `403 FORBIDDEN`
      (CA de US-26: "un miembro intenta cada acción → 403").
   El orden importa: un extraño en una privada debe recibir `NOT_FOUND` (no
   `FORBIDDEN`, que revelaría que la liga existe y que él no es admin); un
   miembro no admin recibe `FORBIDDEN` (la liga existe para él, pero no puede
   gestionar).
2. Permiso primero (consultar el rol antes de la existencia): un extraño en
   una privada recibiría `FORBIDDEN` — revela la existencia (T-12).
3. Solo `FORBIDDEN` para todo: revela la existencia de la privada al extraño.

### 3. Semántica de cada acción

1. **Acciones idempotentes de estado + auditoría en la misma transacción
   (elegida):**
   - **`update`** (nombre/descripción/visibilidad): actualización **parcial**
     (al menos un campo), revalidada server-side; se mantiene la consistencia
     tipo/visibilidad (leagues.md §2: `public` ⇒ visibilidad pública;
     `private` ⇒ no pública). Auditoría `league.updated` (antes/después).
   - **`transfer_admin`**: el destino debe ser **miembro activo**; el admin
     transferente pasa a `member` (queda un solo admin — la integridad la
     garantiza la transacción). Rechazo a sí mismo. Auditoría
     `league.admin_transferred` (anterior → nuevo).
   - **`kick`**: el destino debe ser **miembro activo** (no a sí mismo: la
     salida voluntaria del admin es US-27); el miembro queda `kicked` (soft
     delete — el histórico de puntos se conserva; la liberación de lineups la
     completa US-27). Auditoría `league.member_kicked`.
   - **`close`**: la liga pasa a `finished` (no se borra — el histórico se
     conserva, leagues.md §11; la liberación de lineups la completa US-27).
     Auditoría `league.closed`.
   - **`set_member_invites`**: activa/desactiva
     `leagues.allow_member_invites`; la visibilidad del código para el miembro
     la decide la regla pura `canInvite`. Auditoría
     `league.member_invites_changed`.
   Cada acción revalida el permiso con `assertCanManage` (regla pura) ANTES de
   mutar, y audita en la misma transacción que la mutación (T-09: append-only,
   atómico con el cambio).
2. Borrar filas al expulsar/cerrar: destruye el histórico de puntos y el
   ranking (contradice leagues.md §6/§11: "el histórico se conserva").
3. Acciones sin auditoría: viola T-09 (las acciones sensibles de liga son
   auditables).

### 4. "Invitar solo si el admin lo habilita"

1. **Nuevo campo `leagues.allow_member_invites` (Boolean, default `false`) +
   regla pura `canInvite(role, {allowMemberInvites})` (elegida):** el admin
   siempre ve/comparte el código (si el modo lo permite); el miembro solo si
   el admin lo habilita. La vista (`toLeagueView`) aplica `canInvite` para
   decidir si `code` sale en la respuesta (el servidor manda — AGENTS.md §8:
   el cliente es una vista y no se le envía el código si no puede verlo).
   `default false` = "cerrado por defecto" (principio de mínimo privilegio):
   el miembro no invita hasta que el admin lo habilite explícitamente.
2. Reutilizar `entryMode`: no encaja — `entryMode` gobierna CÓMO se entra
   (código/invitación/abierta), no QUIÉN puede ver el código. Mezclar ambos
   acopla dos conceptos distintos.
3. Sin campo (el miembro nunca ve el código): contradice la tabla de
   `leagues.md` §5 (miembro ⚠️ "solo si el admin lo habilita") y la CA de
   US-26 ("invitar solo si el admin lo habilita" — implica que a veces sí).

### 5. Alcance de "gestión" y límites

1. **Las 5 acciones de la tabla de `leagues.md` §5 + el toggle de invitación
   (elegida):** `update`, `rotate_code` (ya existía, US-23 — se refactorea a
   la regla pura), `kick`, `close`, `transfer_admin`, y `set_member_invites`
   (el "⚠️ solo si el admin lo habilita" de la tabla). La **salida voluntaria**
   del admin/miembro y la **liberación de lineups** al cerrar/expulsar se
   difieren a US-27 (depende de US-26, backlog E6) — aquí el `kick`/`close`
   solo marcan el estado (`kicked`/`finished`) y conservan el histórico.
2. Implementar también la salida y la liberación de lineups ahora: dobla el
   alcance del US sin que la CA lo exija (US-27 lo cubre con su propio CA de
   "histórico conservado + lineups liberados").

## Decisión

### Arquitectura (US-26)

- **Núcleo puro** `canManageLeague(role, action)` + `canInvite(role, cfg)` en
  `leagues/core/permissions.ts` (sin I/O; auditado por el check de pureza
  T-03): `canManageLeague` consulta el mapa `ACTION_ROLES` (hoy las 5 acciones
  son exclusivas del admin); `canInvite` → `admin` siempre, `member` solo si
  `allowMemberInvites`. Tipos `LeagueMemberRole`/`LeagueAdminAction`
  definidos localmente (sin `@prisma/client`, check de pureza T-03).
- **Servicio** `LeagueService` (módulo `leagues`, I/O):
  - **`assertCanManage(leagueId, actorId, action)`** (privado): resuelve la
    liga + la membresía del actor y aplica `canManageLeague`. Orden de
    rechazo: inexistente → `NOT_FOUND`; extraño en privada → `NOT_FOUND` (no
    revela, ADR-0024); miembro no admin / extraño en pública → `403 FORBIDDEN`
    ("Solo el admin de la liga puede hacer esta acción."). Devuelve la liga
    (para no recargarla en el método).
  - **`updateLeague(leagueId, input, actorId, meta)`**: revalida
    `updateLeagueInputSchema` (parcial: `name`/`description`/`visibility`, al
    menos uno); `assertCanManage("update")`; consistencia tipo/visibilidad
    (leagues.md §2); transacción: `league.update` + auditoría `league.updated`
    (antes/después).
  - **`transferAdmin(leagueId, targetUserId, actorId, meta)`**:
    `assertCanManage("transfer_admin")`; destino ≠ actor (a sí mismo →
    `BAD_REQUEST`); destino debe ser miembro activo; transacción: destino →
    `admin`, actor → `member` + auditoría `league.admin_transferred`.
  - **`kickMember(leagueId, targetUserId, actorId, meta)`**:
    `assertCanManage("kick")`; destino ≠ actor; destino miembro activo;
    transacción: destino → `status=kicked` + `leftAt` + auditoría
    `league.member_kicked`.
  - **`closeLeague(leagueId, actorId, meta)`**: `assertCanManage("close")`;
    liga debe estar `active` (si no → `BAD_REQUEST`); transacción:
    `status=finished` + auditoría `league.closed`.
  - **`setMemberInvites(leagueId, enabled, actorId, meta)`**:
    `assertCanManage("update")`; transacción:
    `allow_member_invites=enabled` + auditoría `league.member_invites_changed`.
  - **`rotateCode`** (US-23) y **`toLeagueView`** (US-23/US-24) se refactorean
    sobre las reglas puras: `rotateCode` pasa a `assertCanManage("rotate_code")`
    (antes era un check inline) y `toLeagueView` aplica `canInvite` para
    decidir si `code` sale en la vista (antes era `isAdmin ? code : null`).
- **BD:** nueva columna `leagues.allow_member_invites` (Boolean, default
  `false`) — migración `20261027120000_league_allow_member_invites`.
- **Validación** (`shared/validation/leagues.ts`): `updateLeagueInputSchema`
  (parcial, al menos un campo), `transferAdminInputSchema`,
  `kickMemberInputSchema` (ambos `leagueId` + `targetUserId`),
  `setMemberInvitesInputSchema` (`leagueId` + `enabled`).
- **Router** `leagues` (BFF): `update`, `transferAdmin`, `kick`, `close`,
  `setMemberInvites` — todos `protectedProcedure` (el actor sale del contexto,
  AGENTS.md §8); el BFF no duplica la regla de permiso (la aplica el servicio
  vía `canManageLeague`).
- **UI** (`/ligas/[id]`, `league-detail-page.tsx`): **panel de admin** visible
  solo si `isAdmin` — formulario de configuración (nombre/descripción/
  visibilidad) → `update`; toggle "Los miembros pueden ver/compartir el código
  de invitación" → `setMemberInvites`; por cada miembro (excepto el propio
  actor): "Hacer admin" → `transferAdmin` y "Expulsar" → `kick`; "Cerrar la
  liga" → `close`. El código de invitación se muestra según `canInvite`
  (admin siempre; miembro si `allowMemberInvites`). Cada mutación muestra el
  éxito o el motivo del servidor (español) y refresca la vista.

### Semántica

- **Permisos:** las 5 acciones de gestión (`update`, `rotate_code`, `kick`,
  `close`, `transfer_admin`) son **exclusivas del admin** (regla pura
  `canManageLeague`); un miembro que intente cualquiera → `403 FORBIDDEN` (CA
  de US-26). El miembro solo juega (ver ranking/miembros, colocar/cambiar
  lineup).
- **Invitar:** el admin siempre ve/comparte el código (si el modo lo permite);
  el miembro solo si el admin lo habilita (`allow_member_invites`, default
  `false` — cerrado por defecto). El servidor decide si `code` sale en la
  vista (regla pura `canInvite`); el cliente es una vista.
- **Orden de rechazo:** inexistente → `NOT_FOUND`; extraño en privada →
  `NOT_FOUND` (no revela, ADR-0024/T-12); miembro no admin → `403 FORBIDDEN`.
- **Estados:** `kick` → miembro `kicked` (soft delete, histórico conservado);
  `close` → liga `finished` (histórico conservado); `transfer_admin` → un solo
  admin (el transferente pasa a `member`). La liberación de lineups y la
  salida voluntaria las completa US-27.
- **Auditoría (T-09, append-only, misma transacción que la mutación):**
  `league.updated`, `league.admin_transferred`, `league.member_kicked`,
  `league.closed`, `league.member_invites_changed` (actor, liga, antes/después,
  IP). El código NUNCA se registra (secreto, ADR-0023).

## Consecuencias

- `LeagueView` gana `allowMemberInvites` y `members[].userId` (el admin necesita
  el ID de usuario para apuntar `kick`/`transferAdmin`; es un UUID opaco, no
  PII — el seudónimo sigue siendo `username`/`displayName`). Los tests/UI de
  US-23/US-24/US-25 que fijan la forma de la vista se actualizan (el resto de
  campos es compatible).
- `rotateCode` (US-23) y `toLeagueView` (US-23/US-24) se refactorean sobre las
  reglas puras (misma semántica observable: solo admin rota; el código sale
  para el admin siempre y para el miembro si `allowMemberInvites`).
- Nueva columna `leagues.allow_member_invites` (default `false`) — sin romper
  despliegues existentes (las ligas creadas antes quedan "cerradas" por
  defecto, que es el comportamiento seguro).
- US-27 (salir/expulsar/cerrar con histórico conservado y lineups liberados)
  construye sobre estos estados: el `kick`/`close` ya marcan `kicked`/
  `finished` y conservan el histórico; US-27 añade la liberación de lineups y
  la salida voluntaria.
- La regla de permiso es pura y testable (T-08): si una acción futura admite al
  miembro (p. ej. "invitar" sin toggle), basta con actualizar `ACTION_ROLES` /
  `canInvite` sin tocar el servicio ni el router.

## Validación

- **Unit (regla pura):** `canManageLeague` (admin → las 5 acciones; miembro →
  ninguna; mapa exhaustivo) y `canInvite` (admin siempre; miembro según
  `allowMemberInvites`) — `leagues/core/__tests__/permissions.test.ts`.
- **Integración (CA de US-26: "un miembro intenta cada acción → 403"):** para
  cada acción (`update`, `transferAdmin`, `kick`, `close`, `setMemberInvites`)
  un miembro no admin → `FORBIDDEN`; un extraño en una privada → `NOT_FOUND`
  (no revela); el admin ejecuta cada acción con el efecto esperado (estado +
  auditoría `league.*`); casos límite (destino no miembro → `BAD_REQUEST`;
  auto-kick/auto-transfer → `BAD_REQUEST`; liga no activa → `BAD_REQUEST`;
  visibilidad inconsistente con el tipo → `BAD_REQUEST`) —
  `test/integration/leagues.test.ts` (bloque US-26 + glue de router).
- **UI:** panel de admin solo si `isAdmin` (oculto para el miembro); cada
  mutación muestra el éxito o el motivo del servidor; el código se muestra
  según `canInvite` — `app/ligas/[id]/__tests__/league-detail-page.test.tsx`.
- **Cobertura:** mantener el gate global fusionado 99.9% (T-24) — medido
  99.92% (las 10 líneas sin cubrir son ramas defensivas/inalcanzables
  preexistentes: throw de `buildPriceSeries`, guard de race de `joinLeague` y
  los `continue` "Inalcanzable" del pipeline de resultados).
