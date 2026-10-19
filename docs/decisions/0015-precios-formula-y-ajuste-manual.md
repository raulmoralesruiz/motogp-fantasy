# ADR-0015: Precios por GP — fórmula v1, ajuste manual y gate de lockout (US-08)

- **Estado:** Aceptado (implementado en US-08, 2026-10-19)
- **Fecha:** 2026-10-19
- **Relacionado:** US-08, US-07 (P0, ADR-0014), ADR-0002 (motor de precios — `economy/pricing.ts`), ADR-0013 (afiliaciones por GP), invariante 5 (constructor ≠ equipo), `data-model.md` §precios (tabla `prices`, migración 0002).

## Problema

US-08 debe: (1) tras cada GP **definitivo**, aplicar la fórmula v1 y registrar cada movimiento de precio (motivo `formula`); (2) permitir al admin fijar un precio manual para un GP concreto (motivo `manual` + actor, auditado); (3) garantizar que **los precios no cambian durante el lockout** del GP (test: intentar actualizar en lockout no modifica la BD). Preguntas de diseño:

1. ¿Cómo se dispara la fórmula: job automático (cola + lock distribuido), acción manual, o ambos?
2. ¿Dónde se evalúa el gate de lockout?
3. ¿Qué fuente de datos alimenta el `puntos(r)` de la fórmula?
4. ¿A qué activos se aplica la fórmula: todos los de la BD o solo los del GP objetivo?

## Opciones

1. **Job automático completo** (BullMQ + lock Redis, disparo desde el pipeline de resultados al pasar a definitivo): es el diseño final, pero la fase de resultados (US-16…US-20) aún no existe y la suite de integración no tiene Redis real; bloquea US-08 en una dependencia que no está lista.
2. **Solo acción manual** (el admin pulsa "aplicar fórmula" en el panel): simple y testable de inmediato, pero incumple el CA "tras cada GP definitivo, **el job** aplica la fórmula".
3. **Job preparado + acción manual** (elegida): se implementa el job `applyPricesForGp` con lock inyectable (DI) — lista para cablearse a BullMQ/Redis cuando llegue la fase de resultados — y se expone además la acción de admin, que llama al **mismo servicio** directamente.

### Pros/Contras

- 1: diseño final, pero no implementable hoy (sin pipeline de resultados ni Redis en tests).
- 2: no cumple el CA del job.
- 3: el job existe y está testeado (lock incluido) y el admin puede operar ya; el disparo automático se añade en la fase de resultados **sin reescribir** el job (solo se inyectan las dependencias reales).

## Decisión

Opción 3.

**Fuente de `puntos(r)`** (solo resultados **definitivos** de la carrera principal, `race`):

- Piloto: `mainRacePositionPoints(position)` + `WINNER_BONUS` (5) si posición 1; posición `null` (DNF) → ausente del mapa (perf 0).
- Constructor/equipo: `groupTopTwoAverage` de sus pilotos **afiliados en ese GP** (ADR-0013); constructor y equipo se agrupan por separado (invariante 5).
- `perf` topado a [0, 100] (`perf(pts, pmax)` con `PMAX_RIDER`/`PMAX_GROUP`).
- La fórmula usa los 3 últimos GPs fuente (r, r−1, r−2; los que existan) con `computeNextPrice` de `economy/pricing.ts` (fórmula pura, versionada `pricing-v1`); `prevPrice` = fila del GP r si existe, si no P0; resultado con `round2`.

**Alcance de activos**: la fórmula solo fija precios a los activos del **grid del GP objetivo** — pilotos afiliados a ese GP (`RiderAffiliation`, ADR-0013) y sus constructores/equipos. Los activos son globales (no hay `seasonId` en `riders`/`constructors`/`teams`), así que "todos los activos de la BD" incluiría pilotos de otras temporadas que no corren en ese GP (y contaminaría los precios ajenos). Sin grid en el GP objetivo → no-op con contadores a cero: el admin fija el grid y re-ejecuta (la fórmula es idempotente).

**Job** (`app/modules/jobs/prices.ts`): `applyPricesForGp(gpId, deps)` con `GpLockStore` inyectable (`acquire(gpId, ttlSec)` + `release(gpId)`, TTL 120 s): si no se adquiere el lock → `{ applied: false, locked: true }` sin tocar la BD; si se adquiere → aplica y libera en `finally`. **Sin BullMQ, sin lock Redis y sin disparo automático**: el cableado automático llega con la fase de resultados (US-16…US-20), inyectando las dependencias reales.

**Servicio** (`price-service.ts`, todo en `$transaction`):

- `applyFormulaForGp(input)` — actor sistema (`actorId: null`). Orden de checks: GP no existe → `NOT_FOUND`; sin siguiente GP → no-op `{ targetGpId: null, … }`; siguiente GP `locked` → `skippedLocked: true` **sin tocar la BD** (gate de lockout); sin resultados definitivos en la `race` → `PRECONDITION_FAILED`. Activos: solo el **grid del GP objetivo** (afiliaciones de ese GP; sin grid → no-op). Por activo: sin P0 → `skippedNoOpening`; valor igual al existente → no-op (`unchanged`); distinto → update + auditoría `price.formula_recompute` (actor `null`, before/after); no existe → create con `reason: formula`, `rulesVersion: pricing-v1`, `createdBy: null` (sin auditoría: es la creación del precio, no un cambio).
- `setManualPrice(input, meta)` — `reason: manual`, `createdBy: actor`, `rulesVersion: null`; gate de lockout dentro de la transacción (GP `locked` → `PRECONDITION_FAILED` sin tocar la BD); upsert con retry `P2002`; auditoría `price.manual_set` (before/after + IP); devuelve `{ price, status: "created" | "updated" | "unchanged" }`.

**Router** (`market.prices`, solo `global_admin`): `applyFormula({ gpId })` llama al servicio directamente (no vía job): el admin es baja concurrencia y el gate de lockout ya protege la BD; `setManual({ assetType, assetId, gpId, price })` como arriba.

**UI** (`/admin`, panel de precios): sección "Precios por GP (fórmula v1 y ajuste manual)" con selector de temporada + GPs (con estado: programado/cerrado (lockout)/finalizado/cancelado), ajuste manual del activo elegido para un GP y aplicación de la fórmula con resumen (creados/actualizados/sin cambios/sin P0/lockout).

## Consecuencias

- **Idempotencia:** re-aplicar la fórmula con los mismos resultados no crea ni cambia nada (`unchanged`); si los resultados definitivos cambian, el recálculo corrige las filas existentes (update + auditoría) — los precios se **corrigen**, no se borran.
- **Lockout inviolable:** ni el job ni el ajuste manual tocan precios de un GP `locked`; el check se evalúa dentro de la transacción (misma garantía que el lockout de lineups).
- **Auditoría completa:** cada cambio de precio por fórmula o manual queda en `audit_log` con before/after y actor (sistema = `null`); las creaciones de primera vez no auditan (no hay valor previo).
- **Diferido explícito:** BullMQ + lock Redis + disparo automático al pasar a definitivo se implementan en la fase de resultados, inyectando las dependencias reales en `applyPricesForGp` sin cambiar su contrato.
