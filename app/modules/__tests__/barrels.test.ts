/**
 * Tests de los barrels de los módulos (Fase 0, T-03, T-24; Fase 2,
 * ADR-0017 + US-15; Fase 3, ADR-0018/ADR-0019/US-21; Fase 4,
 * US-23/US-24/US-25/US-26/US-30/US-31):
 * `leagues` exporta `LeagueService` (US-15, dashboard: ligas activas +
 * rankings), la fórmula pura de ranking/desempates (US-21, leagues.md §8),
 * la generación del código de invitación (US-23, leagues.md §4), la regla
 * de visibilidad (US-24, leagues.md §9), la regla de unión (US-25,
 * leagues.md §6), los permisos admin/miembro (US-26, leagues.md §5), la
 * elegibilidad temporal de la membresía (US-30, leagues.md §7) y el alta de
 * membresía transaccional (US-31).
 * `lineups` implementa el núcleo puro (Fase 2, unidad 1) y exporta sus
 * fórmulas (valores; el resto son tipos). `jobs` implementa los jobs de
 * precios (US-08, ADR-0015) y de resultados (US-17, ADR-0019), `market`
 * implementa US-06/US-07/US-08 y exporta `MarketService` y `PriceService`
 * (valores exportados; el resto son tipos) y `results` implementa el
 * núcleo puro, `ResultsService` (Fase 3, US-16, ADR-0018) y el adapter de
 * la fuente PulseLive (US-17, ADR-0019) y exporta sus fórmulas, el
 * servicio y el adapter (clases y funciones de normalización).
 * Importarlos cubre el barrel y garantiza el estado de cada uno.
 */
import { describe, expect, it } from "vitest";

import * as jobs from "../jobs/index.js";
import * as leagues from "../leagues/index.js";
import * as lineups from "../lineups/index.js";
import * as market from "../market/index.js";
import * as results from "../results/index.js";

describe("barrels de módulos (Fase 0, T-03)", () => {
  it("leagues exporta LeagueService, la fórmula pura de ranking, el código de invitación, la visibilidad, la regla de unión, los permisos, la elegibilidad temporal y el alta de membresía (US-15/US-21/US-23/US-24/US-25/US-26/US-30/US-31)", () => {
    expect(Object.keys(leagues).sort()).toEqual([
      "INVITE_CODE_ALPHABET",
      "INVITE_CODE_DEFAULT_LENGTH",
      "INVITE_CODE_MIN_LENGTH",
      "LeagueService",
      "addLeagueMemberInTransaction",
      "canInvite",
      "canManageLeague",
      "canViewLeague",
      "evaluateLeagueJoin",
      "generateLeagueCode",
      "isMemberEligibleForGp",
      "latestMembershipJoinedAt",
      "shouldLockLeagueJoin",
      "sortRanking",
    ]);
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
