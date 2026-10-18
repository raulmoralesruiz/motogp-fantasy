/**
 * Tests de los barrels placeholder de los módulos de Fase 0 (T-03, T-24):
 * `results`, `market`, `lineups`, `leagues` y `jobs` son `export {}` hasta
 * que sus fases los implementen (backlog). Importarlos cubre el barrel y
 * garantiza que, por ahora, no exportan nada.
 */
import { describe, expect, it } from "vitest";

import * as jobs from "../jobs/index.js";
import * as leagues from "../leagues/index.js";
import * as lineups from "../lineups/index.js";
import * as market from "../market/index.js";
import * as results from "../results/index.js";

describe("barrels placeholder de módulos (Fase 0, T-03)", () => {
  it("no exportan nada todavía", () => {
    expect(Object.keys(results)).toHaveLength(0);
    expect(Object.keys(market)).toHaveLength(0);
    expect(Object.keys(lineups)).toHaveLength(0);
    expect(Object.keys(leagues)).toHaveLength(0);
    expect(Object.keys(jobs)).toHaveLength(0);
  });
});
