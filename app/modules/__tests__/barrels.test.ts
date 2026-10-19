/**
 * Tests de los barrels de los módulos de Fase 0 (T-03, T-24):
 * `results`, `lineups`, `leagues` y `jobs` son `export {}` hasta que sus
 * fases los implementen (backlog). `market` ya implementa US-06 y US-07 y
 * exporta `MarketService` y `PriceService` (valores exportados; el resto
 * son tipos). Importarlos cubre el barrel y garantiza el estado de cada uno.
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
    expect(Object.keys(lineups)).toHaveLength(0);
    expect(Object.keys(leagues)).toHaveLength(0);
    expect(Object.keys(jobs)).toHaveLength(0);
  });

  it("market exporta MarketService y PriceService (US-06/US-07)", () => {
    expect(Object.keys(market).sort()).toEqual(["MarketService", "PriceService"]);
  });
});
