/**
 * Tests de `PROVISIONAL_SEASON_RULES` (T-18).
 *
 * Los defaults provisionales deben (a) pasar el esquema y (b) coincidir con
 * los valores documentados (AGENTS.md §1.3, `economy.md` §4, `scoring.md`,
 * `game-rules.md`). Si un valor cambia, este test y el documento se
 * actualizan juntos.
 */
import { describe, expect, it } from "vitest";

import * as configBarrel from "../index.js";
import {
  PROVISIONAL_SEASON_RULES,
  assertProvisionalRulesValid,
} from "../season-rules.js";

describe("PROVISIONAL_SEASON_RULES", () => {
  it("pasa seasonRulesSchema", () => {
    expect(() => assertProvisionalRulesValid()).not.toThrow();
  });

  it("economía: opción E, B=100, t=0.25, cmax=8 (AGENTS.md §1.3)", () => {
    expect(PROVISIONAL_SEASON_RULES.economy).toEqual({
      option: "E",
      B: 100,
      t: 0.25,
      cmax: 8,
    });
  });

  it("precios: Pmax 60 piloto / 30 grupo (economy.md §4.3)", () => {
    expect(PROVISIONAL_SEASON_RULES.pricing).toEqual({ pmaxRider: 60, pmaxGroup: 30 });
  });

  it("puntuación: tabla carrera principal según scoring.md §2.3", () => {
    expect(PROVISIONAL_SEASON_RULES.scoring.mainRace).toEqual({
      "1": 25,
      "2": 20,
      "3": 16,
      "4": 13,
      "5": 11,
      "6": 10,
      "7": 9,
      "8": 8,
      "9": 7,
      "10": 6,
      "11": 5,
      "12": 4,
      "13": 3,
      "14": 2,
      "15": 1,
    });
  });

  it("puntuación: tabla Q2 según scoring.md §2.1 (expandida a 1–20)", () => {
    const q2 = PROVISIONAL_SEASON_RULES.scoring.q2;
    expect(Object.keys(q2)).toHaveLength(20);
    expect(q2["1"]).toBe(12);
    expect(q2["2"]).toBe(8);
    expect(q2["3"]).toBe(8);
    expect(q2["4"]).toBe(5);
    expect(q2["6"]).toBe(5);
    expect(q2["7"]).toBe(3);
    expect(q2["12"]).toBe(3);
    expect(q2["13"]).toBe(1);
    expect(q2["20"]).toBe(1);
  });

  it("puntuación: tabla sprint según scoring.md §2.2", () => {
    expect(PROVISIONAL_SEASON_RULES.scoring.sprint).toEqual({
      "1": 12,
      "2": 9,
      "3": 7,
      "4": 6,
      "5": 5,
      "6": 4,
      "7": 3,
      "8": 2,
      "9": 1,
    });
  });

  it("puntuación: bonos y penalizaciones según scoring.md §2.4–2.5", () => {
    expect(PROVISIONAL_SEASON_RULES.scoring).toMatchObject({
      winnerBonus: 5,
      fastestLapBonus: 3,
      poleBonus: 2,
      positionsGainedBonus: 1,
      positionsGainedMax: 3,
      extraordinaryBonus: 5,
      dnfPenalty: 5,
      dqPenalty: 10,
      timePenalty: 2,
      goldWeight: 1.0,
      silverWeight: 0.5,
    });
  });

  it("límites: máx 2 por constructor y por equipo (PROVISIONAL)", () => {
    expect(PROVISIONAL_SEASON_RULES.limits).toEqual({
      maxPerConstructor: 2,
      maxPerTeam: 2,
    });
  });

  it("transfers: 2 por GP + exención por lesión + 1 wildcard (PROVISIONAL)", () => {
    expect(PROVISIONAL_SEASON_RULES.transfers).toEqual({
      perGp: 2,
      injuryExemption: true,
      wildcardsPerSeason: 1,
    });
  });

  it("liga: 2–50 miembros (PROVISIONAL)", () => {
    expect(PROVISIONAL_SEASON_RULES.league).toEqual({ minMembers: 2, maxMembers: 50 });
  });
});

describe("barrel (config/index)", () => {
  it("re-exporta season-rules", () => {
    expect(configBarrel.PROVISIONAL_SEASON_RULES).toBe(PROVISIONAL_SEASON_RULES);
    expect(configBarrel.assertProvisionalRulesValid).toBe(assertProvisionalRulesValid);
  });
});
