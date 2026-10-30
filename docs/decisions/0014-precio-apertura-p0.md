# ADR-0014: Precio de apertura (P0) y su histórico (US-07)

- **Estado:** Aceptado (implementado en US-07, 2026-10-19)
- **Fecha:** 2026-10-19
- **Relacionado:** US-07, US-08 (fórmula de precios), US-14 (mercado público), ADR-0002 (modelo de economía — motor de precios), `data-model.md` §precios (tabla `prices` y vista `price_history`, migración 0002).

## Problema

US-07 debe permitir al admin fijar el **precio de apertura (P0)** de cada activo (piloto, constructor, equipo) y consultar el **histórico de precios** de un activo (P0 + una fila por GP). Preguntas de diseño:

1. ¿Dónde vive el P0 en el modelo de datos?
2. ¿Qué pasa si el admin fija el P0 dos veces (mismo valor u otro)?
3. ¿Cuándo puede fijarse o cambiarse el P0?

## Opciones

1. **Campo separado en la tabla del activo** (p. ej. `rider.opening_price`): lectura directa, pero rompe el modelo unificado de precios — el P0 quedaría fuera de `prices`/`price_history`, sin histórico de cambios ni auditoría como movimiento de precio, y exigiría migraciones nuevas en contra de `data-model.md` (ya definido).
2. **Fila de precio con `gp_id = NULL`** (elegida): el P0 es una fila más de `prices` (unique `(asset_type, asset_id, gp_id)`; el índice parcial único `prices_asset_opening_unique` garantiza a lo sumo una fila de P0 por activo). Sin migraciones: la tabla, el índice y la vista `price_history` ya existen (migración 0002).
3. **P0 inmutable tras la creación** (solo se fija una vez): protege contra cambios tardíos, pero impide corregir un error antes de empezar la temporada sin intervención manual en BD; el requisito de US-07 es que el admin pueda fijarlo "cuando quiera" (auditado).

### Pros/Contras

- 1: lectura trivial; pero pierde el histórico y la auditoría del P0, fragmenta el modelo de precios y contradice `data-model.md`.
- 2: un único modelo de precios (P0 + filas por GP en la misma vista), cambios del P0 auditados con before/after, cero migraciones.
- 3: simple, pero rígido; el gate de lockout (la restricción real de cambios) se aplica a los precios por GP en US-08, no al P0.

## Decisión

Opción 2. `setOpeningPrice({ assetType, assetId, price })` (solo `global_admin`, en transacción):

- El activo debe existir (NOT_FOUND con mensaje por tipo: "El piloto no existe." / "El constructor no existe." / "El equipo no existe.").
- **Upsert auditado** (acción `price.opening_set`, entidad `price`, `entityId` = fila de precio):
  - No existe → crea la fila (`gpId = null`, `reason = manual`, `createdBy = actor`, `rulesVersion = null`) y audita con `before = null`.
  - Existe con el **mismo valor** → **no-op sin auditar** (no es un cambio; mismo criterio que las afiliaciones de US-06).
  - Existe con **otro valor** → actualiza (`price`, `reason = manual`, `createdBy = actor`) y audita con before/after.
- Creación concurrente (P2002 sobre el índice parcial único) → se re-ejecuta el flujo, que reevalúa (sustituye o no-op).
- El P0 se puede fijar o cambiar **en cualquier momento** (auditado); la restricción de lockout para precios por GP es US-08.
- `listAssetPrices({ assetType })`: activos del tipo con su P0 actual (null si no está fijado), ordenados por nombre (panel admin; cualquier usuario autenticado).
- `getPriceHistory({ assetType, assetId })`: P0 + una fila por GP, **orden P0 → ronda** (lectura pública dentro de la app: cualquier usuario autenticado).
- La fila de P0 usa `reason = manual` y `rulesVersion = null` (no la produce una fórmula); US-08 usará `reason = formula` + `rulesVersion = pricing-v1` en sus filas por GP.

## Consecuencias

- **Cero migraciones**: tabla `prices`, índice parcial único y vista `price_history` ya existen (migración 0002).
- Los cambios del P0 quedan visibles: la fila muestra el valor actual y el `audit_log` conserva el histórico completo (before/after, actor, IP).
- La semántica "mismo valor = no-op sin auditar" es consistente con US-05/US-06 (idempotencia sin ruido de auditoría).
- US-08 se apoya en este modelo: la fórmula produce filas por GP (unique `(asset, gp)`) y el ajuste manual reutiliza el mismo patrón de auditoría.
- US-14 (mercado público) reutiliza `getPriceHistory` sin cambios.

## Addendum (2026-10-30): P0 heurística desde la clasificación del campeonato

**Contexto.** Para probar la app con amigos antes de la carrera sprint, el admin necesita fijar el P0 de todos los activos (pilotos, equipos, constructores) sin hacerlo uno a uno. Se añade una **heurística de siembra** que calcula los P0 a partir de la clasificación del campeonato (la temporada está casi al final y se conocen los resultados de casi todas las carreras).

**Decisión.** `MarketService.calculateP0FromClassification(seasonId, standings, meta)` (solo `global_admin`, en transacción):

- El router obtiene la clasificación vía `MarketSource.fetchStandings(year)` (nuevo método del contrato `MarketSource`; `PulseLiveMarketSource` lo implementa contra `/results/standings`) y la pasa al servicio (mismo patrón que `importMarket`: el router hace el I/O de la fuente, el servicio escribe en BD).
- **Mapeo posición → precio (lineal, 30 → 10):** `P0 = 30 - (posición - 1) * (20 / (n - 1))`, donde `n` = nº de riders en la clasificación. Cada posición tiene un **precio único** (ningún piloto comparte posición; requisito del usuario). Pos 1 → 30, pos `n` → 10.
- **P0 de equipos/constructores:** media de los P0 de sus riders, agrupados por su **afiliación en BD** (`riderAffiliation`), no por el nombre de la fuente (los nombres de equipo difieren entre `/riders` y `/results/standings`, p. ej. "Honda LCR" vs "Castrol Honda LCR"/"Pro Honda LCR"). Un rider sin afiliación fija su P0 pero no cuenta para su equipo/constructor.
- **Upsert** de cada P0 (fila `gpId = null`): no existe → crea; existe con otro valor → actualiza. `reason = formula` (lo produce una heurística determinística, no una entrada manual), `createdBy = actor`, `rulesVersion = null`.
- **Idempotente:** re-ejecutarla actualiza los P0 (no duplica filas; el índice parcial único garantiza ≤1 fila de P0 por activo).
- **Auditoría:** una única entrada `price.p0_heuristic` (entidad `price`, `entityId` = `seasonId`) con resumen `{ ridersPriced, teamsPriced, constructorsPriced, maxPrice, minPrice }`.
- **Requisito previo:** el mercado (activos + afiliaciones) debe estar importado antes (los P0 de equipos/constructores dependen de las afiliaciones).

**Consecuencias.**

- Cero migraciones: reutiliza la tabla `prices` y el índice parcial único de P0.
- El P0 heurístico es una **siembra inicial**: el admin puede corregir cualquier P0 después con `setOpeningPrice` (manual, auditado) sin conflicto.
- La heurística es transparente y reproducible (posición → precio lineal; media de riders para grupos), y queda registrada en el `audit_log` con el actor y el resumen.
