# US-32 · Criterios de aceptación del MVP

> Criterios de `product/mvp.md` §5 verificados uno a uno.

## 1. Registro → primer lineup en <2 min

**Estado:** ✅ Cerrado (US-01 + US-09)

**Verificación:**
- `test/integration/auth.test.ts` — registro + login (flujo completo)
- `test/integration/lineups.test.ts` — composición, presupuesto, primer save
- `app/modules/identity/__tests__/auth-service.test.ts` — registro con bootstrap admin
- `app/modules/lineups/core/__tests__/validation.test.ts` — validación de lineup

**Ruta crítica:** `register → login → getBudgetForGp → builder → save` (transacción `LineupService.save`).
El primer save no consume cambio (auditado como `base`/`carry`/`spend`).

---

## 2. Dos usuarios en la misma liga compiten por GP y temporada

**Estado:** ✅ Cerrado (US-21 + US-22)

**Verificación:**
- `test/integration/my-score.test.ts` — `myScore` con desglose (170.5 pts golden)
- `test/integration/my-results.test.ts` — resultados por GP + ranking por liga
- `test/integration/rankings.test.ts` — rankings por GP y general
- `app/modules/results/__tests__/results-service.test.ts` — recálculo + Score

**Criterio:** `leagueRanking(leagueId, gpId)` y `leagueRanking(leagueId, null)` devuelven posiciones correctas para cada usuario.

---

## 3. Presupuesto nunca ratchet; verificado por tests

**Estado:** ✅ Cerrado (invariante 8 + tests)

**Verificación:**
- `app/modules/lineups/core/__tests__/budget.test.ts` — `firstSaveBudget`, `budgetBreakdown`
- `test/integration/lineups.test.ts` — presupuesto excedido → rechazado; mismo `sin_usar` → presupuesto idéntico aunque cambien precios (anti-ratchet)
- `app/modules/economy/__tests__/budget.test.ts` — fórmula pura `B + min(t·sin_usar, cmax)`

**Criterio:** `presupuesto(gp) = B + min(t·sin_usar_previo, cmax)` — nunca depende del valor de mercado.

---

## 4. Resultado importado dos veces no duplica puntos (idempotencia)

**Estado:** ✅ Cerrado (US-16 + US-19)

**Verificación:**
- `test/integration/results-definitive.test.ts` — `markDefinitive` idempotente; re-importar no duplica
- `test/integration/results-source.test.ts` — auto-import idempotente; manual gana a auto
- `test/integration/constraints.test.ts` — unique `(gp, event, rider)` en BD

**Criterio:** unique `(gpId, resultsEventId, riderId)` + diff mínimo (crear/corrige/no-op).

---

## 5. Resultado corregido recalcula GP conservando histórico

**Estado:** ✅ Cerrado (US-19, ADR-0021)

**Verificación:**
- `test/integration/results-definitive.test.ts` — corrección sobre GP definitivo → rv-2 + `results_history` anterior→nuevo + auditoría `results.recalculated`
- `app/modules/results/__tests__/results-service.test.ts` — recálculo inline + `results_version` nueva

**Criterio:** cada corrección genera nueva `results_version`; `results_history` conserva antes→nuevo; auditado.

---

## 6. Lockout impide cambios server-side durante fin de semana

**Estado:** ✅ Cerrado (US-13, ADR-0017)

**Verificación:**
- `test/integration/lineups.test.ts` — lockout gate dentro de transacción; GP `locked` → PRECONDITION_FAILED
- `app/modules/lineups/core/__tests__/validation.test.ts` — lockout server-side
- `app/modules/seasons/gp-status.ts` — transición `scheduled → locked → finished/cancelled`

**Criterio:** `status = locked ∨ now ≥ lockoutAt` → rechazo sin tocar BD; evaluado dentro de la transacción.

---

## 7. Usuario en 2+ ligas con mismo lineup y puntos

**Estado:** ✅ Cerrado (US-21, ADR-0022)

**Verificación:**
- `test/integration/my-results.test.ts` — multi-liga: mismo `(user, gp)` → mismos puntos en todas las ligas
- `test/integration/my-score.test.ts` — `myScore` sobre lineup único, ranking por `(league, user, gp)`
- `app/modules/results/results-service.ts` — `recalculateRankings` con `FOR UPDATE` por liga

**Criterio:** `scores` por `(user, gp)`; `rankings` por `(league, user, gp)`. Multi-liga sin duplicar puntos.

---

## 8. Admin crea temporada, importa resultados, fuerza recálculo

**Estado:** ✅ Cerrado (US-04 + US-16 + US-19)

**Verificación:**
- `test/integration/seasons.test.ts` — `createSeasonWithRules`, `addRulesVersion`, RBAC + auditoría
- `test/integration/gps.test.ts` — circuitos, GPs, eventos, import calendario
- `test/integration/results-definitive.test.ts` — `markDefinitive`, recálculo inline
- `test/integration/results-source.test.ts` — auto-import + corrección

**Criterio:** `SeasonService.createSeasonWithRules` → `GpService.importCalendar` → `ResultsService.importEvent` → `ResultsService.markDefinitive` → `ResultsService.recalculateGp`.

---

## 9. Gini de presupuesto entre jugadores < 0.05 en simulación

**Estado:** ✅ Cerrado (T-15, ADR-0030)

**Verificación:**
- `scripts/simulate/simulate.ts` — simulación sobre temporada 2026 real (17 GPs, 22 pilotos, 40 jugadores, opción E)
- `scripts/simulate/metrics.ts` — métricas Gini, recuperación, diversidad, espiral
- `docs/product/simulacion-2026.md` — informe con resultados

**Resultado:** Gini **0.001** (< 0.05), recuperación 1.08 (> 0.95), diversidad 87% (> 70%), espiral 0/40.

---

## 10. App usable en móvil (constructor de lineup en una mano)

**Estado:** ✅ Cerrado (T-16, 2026-10-30)

**Verificación:**
- `test/e2e/responsive.test.ts` — Playwright en 3 viewports (iPhone SE 375px, Pixel 5 390px, Galaxy S21 430px)
- Criterios E2E:
  - No overflow horizontal en lineup, ligas, resultados, puntuación, mercado, login, registro
  - Touch targets ≥ 44px en todos los campos del builder
  - Botón "Guardar lineup" presente en el DOM en los 3 viewports

**Criterio:** constructor de lineup usable en una mano (todas las acciones alcanzables sin zoom) + dashboard/ranking legibles.

---

## Resumen

| # | Criterio | Estado | Referencia |
|---|----------|--------|------------|
| 1 | Registro → lineup <2 min | ✅ Cerrado | US-01 + US-09 |
| 2 | Dos usuarios compiten en liga | ✅ Cerrado | US-21 + US-22 |
| 3 | Presupuesto nunca ratchet | ✅ Cerrado | invariante 8 + tests |
| 4 | Idempotencia importación | ✅ Cerrado | US-16 + US-19 |
| 5 | Corrección con histórico | ✅ Cerrado | US-19 + ADR-0021 |
| 6 | Lockout server-side | ✅ Cerrado | US-13 + ADR-0017 |
| 7 | Multi-liga | ✅ Cerrado | US-21 + ADR-0022 |
| 8 | Admin crea/importa/recalcula | ✅ Cerrado | US-04 + US-16 + US-19 |
| 9 | Gini < 0.05 | ✅ Cerrado | T-15 (0.001) |
| 10 | Móvil usable | ✅ Cerrado | T-16 (Playwright 375/390/430px) |

**10/10 cerrados.** MVP completado.
