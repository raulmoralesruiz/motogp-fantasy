# ADR-0027: Salir, ser expulsado o cierre de liga — histórico conservado (US-27)

- **Estado:** Aceptado (2026-10-28) — implementado y verificado (servicio + router + UI + tests; todas las puertas en verde: lint 0 issues, typecheck, unit 674, UI 429, pureza, build, integración 402/402 y gate de cobertura ≥99.9%)
- **Fecha:** 2026-10-28
- **Relacionado:** US-27 (backlog E6), ADR-0005 (modelo de ligas), ADR-0021 (recálculo auditable y versionado por corrección — el ranking se publica por append, no se muta), ADR-0022 (rankings por GP y general — `recalculateRankings` solo publica sobre miembros `active`), ADR-0026 (permisos de liga — `kick`/`close` ya marcan `kicked`/`finished` y conservan el histórico; la salida voluntaria y la liberación de lineups se diferían a este US), `leagues.md` §5 (roles y permisos) y §11 (el histórico se conserva), invariantes 3 y 4 (AGENTS.md §4: un lineup por `(user, gp)`; scores por `(user, gp)`, rankings por `(league, user, gp)`), T-09 (auditoría append-only).

## Problema

La CA de US-27: *"al salir/expulsar: el miembro queda marcado `left`/`kicked`, su histórico de puntos **se conserva** en el ranking (marcado 'retirado'/'expulsado') y el ranking de los demás no se recalcula hacia atrás (test); al cerrar la liga, los lineups de los miembros se liberan (pueden seguir en otras ligas)."*

Lo que **ya existía** (US-26/US-28):

- `kickMember` (miembro → `kicked` + `leftAt`, histórico conservado) y `closeLeague` (liga → `finished`).
- El ranking se publica por **append** (ADR-0021/ADR-0022): cada recálculo añade filas nuevas; las anteriores no se mutan. `recalculateRankings` solo publica sobre miembros `active` (US-28: un miembro que sale queda fuera de la nueva publicación y el histórico se conserva).
- Los lineups son por `(user, gp)` y **no por liga** (invariantes 3/4): un lineup no "pertenece" a una liga, así que "se libera" de forma automática al salir/expulsar — sigue valiendo en las otras ligas del miembro.

Lo que **faltaba** (el trabajo real de US-27):

1. **Salida voluntaria** (`leaveLeague`): hoy solo existe `kick` (impuesto por el admin). Falta que un miembro salga por voluntad propia → `left`.
2. **Semántica de la salida del admin:** ¿qué pasa si el único admin intenta salir? (no estaba definido).
3. **Re-entrada:** un miembro `left`/`kicked` que quiere volver a unirse — `joinLeague` hacía `leagueMember.create`, que con la fila previa (unique `(leagueId, userId)`) fallaba con **P2002**. Bug latente que la salida voluntaria hace alcanzable.
4. **Marcador "retirado/expulsado" visible** en el detalle (el estado `left`/`kicked` ya estaba en BD, pero la vista solo mostraba miembros activos).
5. **Tests** de la CA: "el ranking de los demás no se recalcula hacia atrás" y "los lineups se liberan (pueden seguir en otras ligas)".

## Opciones

### 1. Salida del admin (único admin)

1. **Bloquear: transferir primero (elegida):** el admin no puede salir hasta transferir el rol a otro miembro activo. Consistente con US-26 (un solo admin, transferencia explícita — `transferAdmin` ya existe) y con la regla de que el admin gestiona la liga. Mensaje claro en español. No cambia el rol de nadie sin su consentimiento.
2. Auto-promover al miembro más antiguo: cómodo, pero cambia el rol de alguien **sin su consentimiento** (requeriría auditoría y aviso; más complejo y contra el principio de "el admin gestiona").
3. Cerrar la liga al salir el admin: semántica drástica — "salir de la liga" la cerraría para todos (los demás miembros quedarían fuera). Sorpresivo y destructivo; no encaja con "salir" (acción personal).

### 2. Re-entrada tras salir/expulsión

1. **Reactivar la fila previa (elegida):** `joinLeague` pasa de `create` a `upsert`: si ya existe una membresía (`left`/`kicked`), se reactiva (`status=active`, `leftAt=null`, `role=member`); si no, se crea. Respeto de la unique `(leagueId, userId)` (sin P2002) y coherente con la regla pura `evaluateLeagueJoin` (ADR-0025), que **no distingue** `left` de `kicked` (ambos → "no es miembro activo" → se puede unir si la liga acepta entradas). El reingreso es siempre como `member` (un admin no puede salir ni ser expulsado — US-26/esta ADR —, así que nunca se reactiva un admin).
2. Bloquear la re-entrada de un `kicked`: exigiría distinguir `left`/`kicked` en la regla pura de unión (nuevo campo + nuevo motivo) y contradeciría "pública = entrada abierta" (ADR-0024): un expulsado de una pública podría volver a entrar, lo que anularía el `kick`. Más complejo y contra la semántica de entrada abierta.

### 3. Dónde se muestra el marcador "retirado/expulsado"

1. **Lista de miembros del detalle (`formerMembers`) (elegida):** la vista (`toLeagueView`) gana `formerMembers` (miembros `left`/`kicked` con su estado); la UI los muestra en una sección aparte marcados "retirado"/"expulsado". No rompe el contrato de `members` (activos) que fijan los tests de US-23/US-24/US-25/US-26. El histórico de puntos se conserva en el ranking (append-only, US-21/ADR-0022) — el marcador es el **estado de la membresía**, visible en el detalle.
2. Marcar las filas del ranking: exigiría un join con el estado de membresía en la vista de ranking y mutar el concepto de "publicación versionada" (que es inmutable). Más acoplamiento y contra el principio de "el ranking es derivado e inmutable".
3. No mostrar nada (solo el estado en BD): el usuario no vería que alguien salió/expulsado (la CA pide "marcado 'retirado'/'expulsado'", que implica visibilidad).

### 4. Conservación del histórico y lineups

- **Histórico:** no se recalcula hacia atrás — las publicaciones ya existentes **no se modifican** (append-only, ADR-0021/ADR-0022); la nueva publicación excluye al salido/expulsado (solo miembros `active`). Ya garantizado por `recalculateRankings` (US-28); US-27 lo **verifica** con tests (salida y expulsión).
- **Lineups liberados:** verificado por el modelo (lineups por `(user, gp)`, no por liga — invariantes 3/4): al salir/expulsar, el lineup **no se borra** y sigue vivo en las otras ligas del miembro. US-27 lo **verifica** con un test (expulsado de una liga sigue puntuando/rankeando en otra).

## Decisión

### Arquitectura (US-27)

- **Servicio** `LeagueService` (módulo `leagues`, I/O):
  - **`leaveLeague(leagueId, actorId, meta)`**: revalida `leagueIdInputSchema`; carga la liga (inexistente → `NOT_FOUND`); carga la membresía del actor (no es miembro activo → `BAD_REQUEST` "Solo un miembro activo puede salir de la liga."; extraño en privada → `NOT_FOUND`, no revela — ADR-0024); si el actor es **admin** → `BAD_REQUEST` "Transfiere el rol de admin a otro miembro antes de salir de la liga." (ADR-0027, opción 1); transacción: membresía → `status=left` + `leftAt` + auditoría `league.left` (T-09, append-only, atómica). Devuelve `toLeagueView`.
  - **`joinLeague`** (US-25) se corrige: el `leagueMember.create` pasa a **`upsert`** (reactiva una membresía `left`/`kicked` previa en vez de fallar con P2002) — ADR-0027, opción 2.
  - **`toLeagueView`** (US-23/US-24) gana `formerMembers`: carga los miembros `left`/`kicked` (seudónimo + rol + estado, ordenados por `leftAt` desc) y los expone en la vista.
- **Tipos** (`league-service.ts`): `LeagueMemberView` gana `status?: "left" | "kicked"` (solo en `formerMembers`); `LeagueView` gana `formerMembers: LeagueMemberView[]`.
- **Validación** (`shared/validation/leagues.ts`): se reutiliza `leagueIdInputSchema` (la salida solo necesita `leagueId`).
- **Router** `leagues` (BFF): `leave` — `protectedProcedure` (el actor sale del contexto, AGENTS.md §8); el BFF no duplica la regla (la aplica el servicio).
- **UI** (`/ligas/[id]`, `league-detail-page.tsx`):
  - **Sección "Miembros que salieron"** (si hay): lista de `formerMembers` marcados "retirado" (`left`) / "expulsado" (`kicked`).
  - **Sección "Salir de la liga"**: para un miembro no admin → botón "Salir de la liga" (con confirmación `window.confirm`) → `leave`; para el admin → aviso "transfiere primero el rol"; para un no-miembro → no se muestra.
  - Cada mutación muestra el éxito o el motivo del servidor (español) y refresca la vista.
  - **Tras salir de una liga privada** el actor deja de verla (`get` → `NOT_FOUND`, ADR-0024): la UI **vuelve al directorio** (`router.push("/ligas")`) en vez de mostrar "La liga no existe" sobre una acción que sí tuvo éxito. Tras salir de una **pública** la vista se refresca en el sitio (el botón de unión reaparece) y se muestra el mensaje de confirmación.

### Semántica

- **Salir** (`leaveLeague`): solo un **miembro activo** (no admin) puede salir; la membresía pasa a `left` + `leftAt` (soft delete). El **admin no puede salir** (debe transferir primero el rol — `BAD_REQUEST`). Auditoría `league.left`.
- **Expulsar** (`kickMember`, US-26): el admin expulsa a un miembro activo → `kicked` + `leftAt` (ya existía; US-27 añade las garantías de histórico/lineups).
- **Cierre** (`closeLeague`, US-26): la liga pasa a `finished` (ya existía; US-27 añade la garantía de lineups liberados).
- **Histórico:** las publicaciones de ranking ya existentes **no se modifican** (append-only, ADR-0021/ADR-0022); la nueva publicación excluye al salido/expulsado (solo miembros `active`) y el ranking de los demás **no se recalcula hacia atrás**.
- **Lineups liberados:** al salir/expulsar/cerrar, los lineups del miembro (por `(user, gp)`, no por liga) **no se borran** y siguen vivos en sus otras ligas (invariantes 3/4).
- **Re-entrada:** un miembro `left`/`kicked` puede volver a unirse si la liga acepta entradas (pública o con código válido); la membresía se **reactiva** (no se duplica).
- **Orden de rechazo de `leaveLeague`:** inexistente → `NOT_FOUND`; extraño en privada → `NOT_FOUND` (no revela, ADR-0024); no miembro activo → `BAD_REQUEST`; admin → `BAD_REQUEST` (transferir primero).
- **Auditoría (T-09, append-only, misma transacción):** `league.left` (actor, liga, antes/después, IP).

## Consecuencias

- `LeagueView` gana `formerMembers` (y `LeagueMemberView` gana `status?`). Los tests/UI de US-23/US-24/US-25/US-26 que fijan la forma de la vista se actualizan (añaden `formerMembers: []`); el resto de campos es compatible.
- `joinLeague` (US-25) cambia de `create` a `upsert`: corrige el bug latente de P2002 en la re-entrada (antes, un `left`/`kicked` no podía volver a unirse). La semántica observable de una primera unión es idéntica (misma fila, misma auditoría `league.joined`).
- La salida del admin está bloqueada (transferir primero): un admin que quiera irse debe ceder el rol a otro miembro. Si la liga queda sin miembros, el admin puede cerrarla (`close`).
- Un miembro expulsado de una liga pública puede volver a unirse (entrada abierta, ADR-0024): el `kick` sigue siendo efectivo mientras el admin lo mantenga fuera, pero no es una "lista negra" (se difiere si se necesita).
- El marcador "retirado/expulsado" es el estado de la membresía, visible en el detalle; el ranking histórico lo conserva con sus puntos (append-only).

## Validación

- **Integración (CA de US-27):** `test/integration/leagues.test.ts` (bloque US-27):
  - **Salir:** miembro activo → `left` + `leftAt` + auditoría `league.left` + `formerMembers` lo muestra como "retirado"; admin → `BAD_REQUEST` (transferir primero, membresía intacta); extraño en privada → `NOT_FOUND`; ya salido → `BAD_REQUEST`.
  - **Re-entrada:** un `left` vuelve a unirse (se reactiva, sin P2002, una sola fila, `leftAt=null`).
  - **Histórico conservado:** al salir, la publicación anterior no cambia (B y C con sus puntos/posiciones) y la nueva excluye al salido; el otro miembro conserva sus puntos en ambas (no se recalcula hacia atrás).
  - **Lineups liberados:** expulsado de una liga, su lineup no se borra y sigue puntuando/rankeando en la otra (mismos puntos).
  - **Glue BFF:** `leave` (router) — el actor sale del contexto; miembro → `isMember=false` + `formerMembers`.
- **UI:** `app/ligas/[id]/__tests__/league-detail-page.test.tsx` (bloques US-27): miembro no admin ve el botón "Salir de la liga"; el admin no lo ve (aviso "transfiere primero el rol"); un no-miembro no lo ve; clic confirmado → muta con `leagueId`; clic cancelado → no muta; éxito en privada → `router.push("/ligas")`; éxito en pública → mensaje de confirmación; error → motivo del servidor; `formerMembers` marcados "retirado"/"expulsado"; sin salidos → no se muestra la sección.
- **Cobertura:** mantener el gate global fusionado 99.9% (T-24) — medido ≥99.9% (las líneas sin cubrir son ramas defensivas/inalcanzables preexistentes).
