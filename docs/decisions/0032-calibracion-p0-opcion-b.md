# ADR-0032: Calibración P0 — Opción B (bajar P0 manteniendo B=100)

- **Estado:** Aceptado (2026-10-31) — implementado y verificado localmente (lint 0, typecheck, pureza, unit 720, UI 475, build); integración en CI (sin Docker local)
- **Fecha:** 2026-10-31
- **Relacionado:** US-07 (P0, ADR-0014), US-08 (fórmula de precios, ADR-0015), D-01/D-02 (calibración B/t/cmax + Pmax, ADR-0030), `economy.md` §4.1/§4.3/§7, `game-rules.md` §2/§3, invariantes 2 y 8 (AGENTS.md §4).

## Problema

El lineup competitivo (mejores 4 riders + mejor constructor + mejor equipo) costaba **~173** con el P0 heurístico original (rango 30→10, ADR-0014 addendum). El presupuesto base es **B=100** (ADR-0030), así que el mejor lineup posible costaba **~1.7× el presupuesto**: inabordable sin carry, y el carry (máx 8, ADR-0030) no llega a compensar. Para probar la app con amigos (y para el uso normal) el lineup competitivo debe **entrar en el presupuesto base**.

## Opciones

1. **Bajar P0 manteniendo B=100 (Opción B, elegida):** re-escalar la heurística de P0 (rango 30→10 → ~17.4→5.8, factor k≈0.58) para que el lineup competitivo cueste ~100. `B`/`t`/`cmax`/`Pmax` y la fórmula de precios (pricing-v1) **no cambian**.
2. **Subir B manteniendo P0:** p. ej. B=170. Pero B es el parámetro de equilibrio calibrado en D-01 (ADR-0030: 36/36 combinaciones del rango razonable pasan T-15; B=100 es la referencia). Subir B rompería esa calibración (Gini, recuperación, diversidad) y alejaría el producto del diseño de `economy.md`.
3. **Mantener el status quo:** el lineup competitivo sigue siendo inabordable; la prueba con amigos y el uso normal se vuelven inviables.

## Decisión

**Opción B** — bajar P0 manteniendo B=100.

- **Rango P0:** 30→10 (original) → **17.4→5.8** (k≈0.58). El lineup competitivo pasa de ~173 a **~100** (justo el presupuesto base).
- **Fuente del rango:** `shared/config` (`PROVISIONAL_MARKET_CONFIG.p0.max`/`min`), no `season_rules` (el P0 es un parámetro de **siembra de mercado**, no una regla de juego versionada por temporada; AGENTS.md §1.3: nunca como constante mágica).
- **Heurística:** `calculateP0FromClassification` (ADR-0014) ahora lee el rango del config: `P0 = p0.max - (posición-1)·((p0.max-p0.min)/(n-1))`. Los P0 de equipos/constructores (media de sus riders, ADR-0014) heredan la misma escala.
- **Recálculo de temporada (nuevo):** `PriceService.recalculateSeasonPrices(seasonId)` re-ejecuta la fórmula (pricing-v1) GP a GP (r=1→N−1) sobre el P0 vigente, para que la serie de precios de una temporada en curso quede **consistente con el P0 recalibrado**. Cada GP con resultados definitivos recalcula el precio del GP siguiente (auditado `price.formula_recompute` por fila, mismo patrón que `applyFormulaForGp`). Expuesto como `market.prices.recalculateSeason` (solo `global_admin`).
- **Sin cambios en:** `B`/`t`/`cmax` (ADR-0030), `Pmax` (30/30, ADR-0030), fórmula de precios (pricing-v1, `economy.md` §4.3), bandas `[0.25·P0, 2·P0]` y `[0.85·prev, 1.15·prev]`.

### Cambios de código

- `app/shared/config/market.ts` (nuevo): `PROVISIONAL_MARKET_CONFIG` (rango P0 17.4→5.8) + esquema Zod + assert; re-exportado en `shared/config/index.ts`.
- `app/modules/market/market-service.ts`: `calculateP0FromClassification` lee el rango del config (antes 30/10 hardcodeados).
- `app/modules/market/price-service.ts`: `recalculateSeasonPrices` (nuevo) + tipos `RecalculateSeasonPricesInput`/`Result`.
- `app/shared/validation/market.ts`: `recalculateSeasonPricesInputSchema` + tipo.
- `app/server/routers/market.ts`: endpoint `market.prices.recalculateSeason` (admin).
- `app/admin/prices-panel.tsx`: sección "Recalcular temporada" (botón + resumen/error) reutilizando el selector de temporada de la sección US-08; texto del P0 automático actualizado al rango del config.
- Tests: `market-service.test.ts` (P0 17.4/11.6/5.8, equipos/constructores 14.5/5.8), `price-service.test.ts` (recalcula GP a GP + NOT_FOUND), `shared/config/market.test.ts` (rango P0), `app/admin/__tests__/prices-panel.test.tsx` (sección "Recalcular temporada": botón, resumen, error, refetch) y `test/integration/market-import.test.ts` (P0 17.4/5.8 vía afiliación).

## Consecuencias

- **El lineup competitivo entra en el presupuesto base** (~100 = B), como diseñó `economy.md` §4.1. Antes costaba ~1.7× el presupuesto.
- **Los precios ya calculados en producción con el P0 viejo (30→10) no se corrigen retroactivamente por defecto** (AGENTS.md §5). Para alinearlos, el admin re-seedea el P0 (`p0Heuristic`) y recalcula la temporada (`recalculateSeason`): cambio **explícito y auditado** (before/after en `audit_log`), no silencioso.
- **La heurística es transparente y reproducible** (posición → precio lineal sobre el rango del config; media de riders para grupos), y queda registrada en el `audit_log` con el actor y el resumen (ADR-0014).
- **El recálculo de temporada es idempotente:** re-ejecutarlo con el mismo P0 no cambia nada (no-op); con un P0 distinto, recalcula la serie (auditado).
- **Coste del recálculo:** N−1 llamadas a `applyFormulaForGp` (una por GP con resultados definitivos), cada una con su transacción y auditoría. Aceptable para una operación de calibración (no es un flujo recurrente).
- **El P0 es una siembra inicial:** el admin puede corregir cualquier P0 después con `setOpeningPrice` (manual, auditado) sin conflicto (ADR-0014).

## Validación

- **Unit:** 720 tests en verde (incl. `market-service` con el nuevo rango P0, `price-service` con `recalculateSeasonPrices` y `shared/config` con el rango P0).
- **UI:** 475 tests en verde (incl. `prices-panel.test.tsx` con la sección "Recalcular temporada").
- **Lint / typecheck / pureza / build:** en verde.
- **Integración (CI, PostgreSQL real):** pendiente (sin Docker local); `market-import.test.ts` actualizado al nuevo rango P0 (17.4/5.8) y la suite de integración existente (`prices-formula.test.ts`) se re-ejecutan en CI.
