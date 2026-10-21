/**
 * Tests de los barrels de los módulos (Fase 0, T-03, T-24; Fase 2,
 * ADR-0017): `results` y `leagues` son `export {}` hasta que sus fases los
 * implementen (backlog). `lineups` implementa el núcleo puro (Fase 2,
 * unidad 1) y exporta sus fórmulas (valores; el resto son tipos). `jobs`
 * implementa el job de precios (US-08, ADR-0015) y `market` implementa
 * US-06/US-07/US-08 y exporta `MarketService` y `PriceService` (valores
 * exportados; el resto son tipos). Importarlos cubre el barrel y garantiza
 * el estado de cada uno.
 */
import { describe, expect, it } from "vitest";

import * as jobs from "../jobs/index.js";
import * as leagues from "../leagues/index.js";
import * as lineups from "../lineups/index.js";
import * as market from "../market/index.js";
import * as results from "../results/index.js";

describe("barrels de módulos (Fase 0, T-03)", () => {
  it("los módulos sin implementar no exportan nada todavía", () => {
    expect(Object.keys(results)).toHaveLength(0);
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

  it("jobs exporta el job de precios (US-08)", () => {
    expect(Object.keys(jobs).sort()).toEqual([
      "PRICE_JOB_LOCK_TTL_SEC",
      "applyPricesForGp",
    ]);
  });

  it("market exporta MarketService y PriceService (US-06/US-07)", () => {
    expect(Object.keys(market).sort()).toEqual(["MarketService", "PriceService"]);
  });
});
