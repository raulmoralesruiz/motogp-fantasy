/**
 * Tests de los barrels de los módulos (Fase 0, T-03, T-24; Fase 2,
 * ADR-0017; Fase 3, ADR-0018/ADR-0019): `leagues` es `export {}` hasta
 * que su fase lo implemente (backlog). `lineups` implementa el núcleo
 * puro (Fase 2, unidad 1) y exporta sus fórmulas (valores; el resto son
 * tipos). `jobs` implementa los jobs de precios (US-08, ADR-0015) y de
 * resultados (US-17, ADR-0019), `market` implementa US-06/US-07/US-08 y
 * exporta `MarketService` y `PriceService` (valores exportados; el resto
 * son tipos) y `results` implementa el núcleo puro, `ResultsService`
 * (Fase 3, US-16, ADR-0018) y el adapter de la fuente PulseLive (US-17,
 * ADR-0019) y exporta sus fórmulas, el servicio y el adapter (clases y
 * funciones de normalización). Importarlos cubre el barrel y garantiza el
 * estado de cada uno.
 */
import { describe, expect, it } from "vitest";

import * as jobs from "../jobs/index.js";
import * as leagues from "../leagues/index.js";
import * as lineups from "../lineups/index.js";
import * as market from "../market/index.js";
import * as results from "../results/index.js";

describe("barrels de módulos (Fase 0, T-03)", () => {
  it("leagues no exporta nada todavía", () => {
    expect(Object.keys(leagues)).toHaveLength(0);
  });

  it("lineups exporta el núcleo puro y LineupService (Fase 2, ADR-0017)", () => {
    expect(Object.keys(lineups).sort()).toEqual([
      "LineupService",
      "balanceFromMovements",
      "budgetBreakdown",
      "canUseWildcard",
      "changeSpendMovement",
      "diffSlots",
      "firstSaveBudget",
      "firstSaveMovements",
      "lineupCost",
      "remainingChanges",
      "round2",
      "validateLineup",
    ]);
  });

  it("jobs exporta los jobs de precios y de resultados (US-08/US-17)", () => {
    expect(Object.keys(jobs).sort()).toEqual([
      "PRICE_JOB_LOCK_TTL_SEC",
      "applyPricesForGp",
      "pollResults",
    ]);
  });

  it("market exporta MarketService y PriceService (US-06/US-07)", () => {
    expect(Object.keys(market).sort()).toEqual(["MarketService", "PriceService"]);
  });

  it("results exporta el núcleo puro, ResultsService y el adapter de la fuente (Fase 3, US-16/US-17)", () => {
    expect(Object.keys(results).sort()).toEqual([
      "BONUS_CODES_BY_EVENT",
      "PENALTY_CODES_BY_EVENT",
      "PulseLiveResultsSource",
      "PulseLiveSourceError",
      "ResultsNormalizationError",
      "ResultsService",
      "SourceNotLinkedError",
      "SourceSessionNotFinishedError",
      "deriveStatus",
      "diffResults",
      "nextResultsVersion",
      "normalizePulseLiveClassification",
      "parseResultsVersion",
      "resultEventLabel",
      "sameResultValues",
      "selectPulseLiveSession",
      "validateEntryForEvent",
    ]);
  });
});
