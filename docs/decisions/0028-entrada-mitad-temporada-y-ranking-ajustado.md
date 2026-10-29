# ADR-0028: Entrada a mitad de temporada y ranking ajustado (US-30, D-10)

- **Estado:** Aceptado (2026-10-29) — implementado y verificado (núcleo puro + servicio + validación + router + UI + tests; todas las puertas en verde: lint 0 issues, typecheck, pureza, unit 680, UI 434, build, integración 413/413 y gate de cobertura fusionada 99.9% ≥ 99.9%)
- **Fecha:** 2026-10-29
- **Relacionado:** US-30 (backlog E6), D-10 (backlog §D), ADR-0005 (modelo de ligas), ADR-0022 (rankings por GP y general — `recalculateRankings` + `sortRanking`), ADR-0025 (unirse por código/entrada abierta — `joinLeague`), ADR-0027 (salir/expulsar — re-entrada `upsert`), `leagues.md` §7 (entrada a mitad de temporada) y §8 (rankings y desempates), invariantes 3 y 4 (AGENTS.md §4: un lineup por `(user, gp)`; scores por `(user, gp)`, rankings por `(league, user, gp)`).

## Problema

La CA de US-30: *"empieza con 0 puntos desde su primer GP activo en esa liga; no hereda puntos de GPs previos; opción 'ranking ajustado' (solo GPs desde la última entrada) configurable por liga, desactivado por defecto (`D-10`)."*

Lo que **ya existía**:

- `league_members.joined_at` (la fecha de entrada de cada miembro) y la re-entrada por `upsert` (ADR-0027).
- `recalculateRankings` (US-21, ADR-0022): publicaba el ranking **por GP y general** sobre **todos los miembros activos** y **todos los GPs de la temporada**, sin distinguir cuándo entró cada uno. Un miembro que se unía a mitad de temporada **heredaba** en el ranking general los puntos de GPs que no jugó (si tenía `scores` por `(user, gp)` de otra liga, invariante 4), y aparecía en el ranking por GP de GPs previos a su entrada.
- `sortRanking` (fórmula pura, ADR-0022): los desempates (GPs ganados, último GP, coste total, antigüedad) se calculaban sobre **todos** los GPs de la temporada.

Lo que **faltaba** (el trabajo real de US-30):

1. **Elegibilidad temporal por GP:** un miembro solo cuenta en los GPs cuyo inicio efectivo es posterior a su entrada.
2. **Re-entrada sin herencia:** al reingresar, el miembro no recupera los GPs jugados mientras estaba fuera (la re-entrada abre un periodo nuevo).
3. **Ranking ajustado (opción por liga, off por defecto):** el general cuenta solo los GPs desde la entrada del **último** miembro (para ligas que quieren igualdad).
4. **Desempates coherentes:** los desempates (GPs ganados, último GP, coste total) deben salir del **mismo** conjunto de GPs elegibles, para que un recién llegado no herede ventaja por victorias/último GP/coste de GPs previos.
5. **D-10:** decidir si el ranking ajustado se activa por defecto en algún tipo de liga.

## Opciones

### 1. Corte de elegibilidad por GP

1. **Inicio efectivo del GP (`lockoutAt ?? date`) estrictamente posterior a `joinedAt` (elegida):** un GP "cuenta" para la membresía solo si su inicio efectivo (el lockout, o la fecha del GP si no hay lockout) es **estrictamente posterior** a la entrada del miembro. Entrar exactamente en el cierre ya no da acceso a ese GP. Usa datos de la BD (fecha/lockout del GP), **nunca el reloj actual** (coherente con el check de pureza: el núcleo no usa `new Date()`). Determinista y reproducible en tests.
2. Fecha del GP (`date`) sin lockout: más simple, pero un GP con lockout fijado permitiría heredar puntos de un GP cuyo cierre ya pasó. Menos preciso.
3. "Primer GP con score tras la entrada": depende de los datos de score (derivado), no de la membresía; acopla la elegibilidad a la puntuación y es menos predecible.

### 2. Re-entrada y herencia

1. **La re-entrada abre un periodo nuevo: `joinLeague` (upsert, ADR-0027) **resetea `joinedAt`** (elegida):** al reingresar, `joinedAt` se actualiza a la fecha de reingreso. Así el miembro **no recupera** los GPs jugados mientras estaba `left`/`kicked` (coherente con "no hay herencia de puntos" y con "su ranking se calcula sobre los GPs en los que estuvo activo"). La re-entrada ya reactiva la fila (ADR-0027); US-30 añade el reset de `joinedAt`.
2. Conservar el `joinedAt` original en la re-entrada: el miembro recuperaría GPs previos (herencia), contra la CA de US-30.

### 3. Ranking ajustado (opción por liga)

1. **Columna `leagues.adjusted_ranking_enabled` (default `false`), solo afecta al ranking **general** (elegida):** cuando está activo, el general usa un **corte común** = la entrada más reciente entre los miembros activos (`latestMembershipJoinedAt`); todos cuentan solo los GPs desde ese corte. El ranking **por GP no se ajusta** (cada miembro sigue siendo elegible por su propia entrada). La opción es por liga (no global), configurable por el admin (US-26) y **desactivada por defecto** (D-10).
2. Afectar también al ranking por GP: rompería la semántica de "por GP = quién sumó más en ese GP entre los que estaban activos en él" y complicaría la elegibilidad por GP.
3. Fijarlo por tipo de liga (p. ej. siempre activo en "temporales"): menos flexible; el admin de una liga concreta no podría elegirlo. Se difiere (D-10 lo permite decidirlo por defecto, pero la opción por liga es más general).

### 4. D-10 — ¿activado por defecto en algún tipo de liga?

1. **Desactivado por defecto en **todos** los tipos de liga (elegida):** el comportamiento por defecto es el "ranking normal" (cada miembro cuenta desde su propia entrada). El ranking ajustado es una **opción** que el admin activa explícitamente por liga. Principio de mínimo sorpresas: el comportamiento por defecto es el más predecible y el que la mayoría de ligas quiere (respetar la entrada real de cada uno). La CA de US-30 lo exige explícitamente ("desactivado por defecto").
2. Activado por defecto en algún tipo (p. ej. "temporales"): impondría una semántica que no todas las ligas de ese tipo quieren y obligaría a desactivarlo caso a caso.

## Decisión

### Arquitectura (US-30)

- **Núcleo puro** `core/eligibility.ts` (sin I/O, auditado por el check de pureza T-03):
  - `isMemberEligibleForGp(joinedAt, { date, lockoutAt })` — ¿cuenta este GP para la membresía? (inicio efectivo `lockoutAt ?? date` estrictamente posterior a `joinedAt`).
  - `latestMembershipJoinedAt(joinedAt[])` — la entrada más reciente (o `null` si no hay miembros). Calcula el corte; **el servicio decide si lo aplica** (la opción está off por defecto).
- **Servicio** `LeagueService` (módulo `leagues`, I/O):
  - **`recalculateRankings`** (US-21) se extiende: calcula el **conjunto de GPs elegibles por miembro** (normal: su propio `joinedAt`; ajustado: el corte común) y **todos los puntos y desempates salen del mismo conjunto** (`buildStats`). El ranking por GP solo incluye miembros elegibles en ese GP; el general ajustado (si la liga lo tiene activo) usa el corte común. Publica por append (ADR-0021/ADR-0022) — las versiones anteriores no se mutan.
  - **`createLeague`** (US-23) acepta `adjustedRankingEnabled` (default `false`) y lo persiste + lo registra en la auditoría `league.created`.
  - **`updateLeague`** (US-26) acepta `adjustedRankingEnabled` (parcial, solo admin vía `assertCanManage`) y lo registra en la auditoría `league.updated` (antes/después).
  - **`toLeagueView`** expone `adjustedRankingEnabled` en la vista.
- **Validación** (`shared/validation/leagues.ts`): `createLeagueInputSchema` gana `adjustedRankingEnabled: z.boolean().default(false)`; `updateLeagueInputSchema` gana `adjustedRankingEnabled: z.boolean().optional()` (y el refine "al menos un campo" lo admite).
- **Router** `leagues` (BFF): sin cambios de procedimientos (el campo viaja por `create`/`update`, ya existentes). El actor y el permiso salen del contexto (AGENTS.md §8).
- **UI:**
  - **Creación** (`/ligas`, `ligas-page.tsx`): checkbox "Ranking ajustado" (off por defecto) + texto explicativo; lo envía en el payload de `create`.
  - **Detalle** (`/ligas/[id]`, `league-detail-page.tsx`): el panel de admin (US-26) gana el checkbox (lo envía en `update`); la cabecera muestra el estado ("Ranking ajustado activo/desactivado: …") para todos los viewers.
- **Migración** `20261028120000_league_adjusted_ranking` — `leagues.adjusted_ranking_enabled BOOLEAN NOT NULL DEFAULT false`.

### Semántica

- **Elegibilidad por GP:** un miembro cuenta en un GP solo si el **inicio efectivo** del GP (`lockoutAt ?? date`) es **estrictamente posterior** a su `joinedAt`. Entrar en el cierre ya no da acceso a ese GP.
- **Re-entrada:** al reingresar (`joinLeague`, upsert de ADR-0027), `joinedAt` se **resetea** a la fecha de reingreso → el miembro **no recupera** los GPs jugados mientras estaba fuera (no hay herencia).
- **Ranking normal (por defecto):** cada miembro cuenta desde su **propia** entrada (por GP y general).
- **Ranking ajustado (opción por liga, off por defecto):** el **general** cuenta solo los GPs desde la **entrada más reciente** (corte común); el ranking por GP **no se ajusta**.
- **Desempates:** GPs ganados, último GP y coste total se calculan sobre el **mismo** conjunto de GPs elegibles (un recién llegado no hereda ventaja por GPs previos).
- **D-10:** el ranking ajustado queda **desactivado por defecto en todos los tipos de liga** (opción que el admin activa explícitamente por liga).

## Consecuencias

- `recalculateRankings` cambia de semántica: antes publicaba sobre **todos** los GPs de la temporada; ahora filtra por **elegibilidad** (por GP y general). Las publicaciones **anteriores** no se mutan (append-only, ADR-0021/ADR-0022); solo las **nuevas** publicaciones reflejan la elegibilidad. No hay cambio retroactivo silencioso (AGENTS.md §5).
- `LeagueView` gana `adjustedRankingEnabled`; los tests/UI de US-23/US-24/US-25/US-26/US-27 que fijan la forma de la vista se actualizan (añaden el campo).
- `createLeagueInputSchema`/`updateLeagueInputSchema` ganan el campo; los payloads de UI y los tests de payload se actualizan.
- La re-entrada (ADR-0027) ahora **resetea `joinedAt`**: un miembro que sale y vuelve no recupera GPs previos. La semántica de "reactivar la fila" no cambia (misma fila, `leftAt=null`); solo se actualiza la fecha de entrada.
- El ranking ajustado es **por liga** y **off por defecto** (D-10): el comportamiento por defecto no cambia para las ligas existentes; solo las que el admin active lo usan el corte común.
- El núcleo no usa el reloj (pureza): la elegibilidad se decide con datos de la BD (fecha/lockout del GP + `joinedAt`), no con `new Date()`.

## Validación

- **Unit (núcleo puro):** `core/__tests__/eligibility.test.ts` (5 casos): `isMemberEligibleForGp` — posterior/igual/anterior, con y sin `lockoutAt` (el corte es `lockoutAt ?? date`); `latestMembershipJoinedAt` — máxima de varias, una sola, vacía → `null`.
- **Integración:**
  - `test/integration/rankings.test.ts` (+2 casos, US-30): **recién llegado no hereda GPs previos** (GP1 solo el veterano; GP2 ambos; general normal — el recién llegado solo desde su entrada; general ajustado — ambos desde la última entrada) + **desempates no heredan GPs previos** (coste de GP1 no cuenta para el recién llegado; desempate por antigüedad).
  - `test/integration/leagues.test.ts` (+3 casos, US-30): el admin **activa/desactiva** el ranking ajustado + auditoría `league.updated` (antes/después); un **miembro no puede** activarlo (FORBIDDEN); `createLeague` con `adjustedRankingEnabled: true` lo persiste.
  - `test/integration/leagues.test.ts` (re-entrada, US-27/US-30): al reingresar, `joinedAt` se **resetea** (posterior al original) — no recupera GPs previos.
- **UI:**
  - `app/ligas/__tests__/ligas-page.test.tsx`: checkbox "Ranking ajustado" **desactivado por defecto** + texto explicativo; si el admin lo marca, el payload de `create` incluye `adjustedRankingEnabled: true`.
  - `app/ligas/[id]/__tests__/league-detail-page.test.tsx`: el detalle muestra el estado (activo/desactivado); el panel de admin muestra el checkbox; activarlo envía `adjustedRankingEnabled: true` en `update`; el payload de `update` incluye el campo.
- **Cobertura:** mantener el gate global fusionado 99.9% (T-24) — medido ≥99.9% (1527 tests, 131 archivos).
