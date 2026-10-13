/**
 * Tests del motor de puntuación (scoring-v1).
 *
 * Incluye los ejemplos verificables de referencia (AGENTS.md §7):
 *   - Lineup de ejemplo de `scoring.md` §5 → 170.5 puntos.
 */
import { describe, expect, it } from "vitest";

import type { Lineup } from "../../../shared/types/index.js";
import {
  groupTopTwoAverage,
  lineupPoints,
  riderMainPoints,
  topTwoAverage,
} from "../engine.js";

describe("riderMainPoints", () => {
  it("aplica la tabla principal (1º=25+5, 2º=20, …, 15º=1, 16+=0)", () => {
    expect(riderMainPoints("FINISHED", 1)).toBe(30); // 25 + bono ganador
    expect(riderMainPoints("FINISHED", 2)).toBe(20);
    expect(riderMainPoints("FINISHED", 3)).toBe(16);
    expect(riderMainPoints("FINISHED", 4)).toBe(13);
    expect(riderMainPoints("FINISHED", 10)).toBe(6);
    expect(riderMainPoints("FINISHED", 15)).toBe(1);
    expect(riderMainPoints("FINISHED", 16)).toBe(0);
    expect(riderMainPoints("FINISHED", 25)).toBe(0);
  });

  it("DNF = −5 (penalización única por GP) y ABSENT = 0 sin penalización", () => {
    expect(riderMainPoints("DNF", null)).toBe(-5);
    expect(riderMainPoints("ABSENT", null)).toBe(0);
  });
});

describe("topTwoAverage", () => {
  it("media de los 2 mejores", () => {
    expect(topTwoAverage([56, 20, 6])).toBeCloseTo(38);
    expect(topTwoAverage([10, 4])).toBeCloseTo(7);
    expect(topTwoAverage([10])).toBeCloseTo(10);
    expect(topTwoAverage([])).toBe(0);
  });
});

describe("groupTopTwoAverage", () => {
  it("media de los 2 mejores pilotos por grupo (campo completo)", () => {
    const riderPoints = [
      { riderId: "a1", points: 30 },
      { riderId: "a2", points: 20 },
      { riderId: "a3", points: 16 },
      { riderId: "b1", points: 13 },
      { riderId: "b2", points: -5 },
    ];
    const groupOf = (id: string) => (id.startsWith("a") ? "Aprilia" : "Ducati");
    const out = groupTopTwoAverage(riderPoints, groupOf);
    expect(out.get("Aprilia")).toBeCloseTo(25); // (30+20)/2
    expect(out.get("Ducati")).toBeCloseTo(4); // (13+−5)/2
  });
});

describe("lineupPoints — ejemplo verificable scoring.md §5", () => {
  it("reproduce el ejemplo del documento (170.5 puntos)", () => {
    // scoring.md §5: oro A=56, C=32 · plata E=17, H=−4 · ctor X=38 · equipo X=38
    const lineup: Lineup = {
      gold: ["A", "C"],
      silver: ["E", "H"],
      constructor: "X",
      team: "X-team",
    };
    const riderPoints = new Map([
      ["A", 56],
      ["C", 32],
      ["E", 17],
      ["H", -4],
    ]);
    const ctorPoints = new Map([["X", 38]]);
    const teamPoints = new Map([["X-team", 38]]);
    // 56 + 32 + 0.5×17 + 0.5×(−4) + 38 + 38 = 170.5
    expect(lineupPoints(lineup, riderPoints, ctorPoints, teamPoints)).toBeCloseTo(170.5);
  });

  it("oro 100% / plata 50% y activos ausentes puntúan 0", () => {
    const lineup: Lineup = {
      gold: ["A", "B"],
      silver: ["C", "D"],
      constructor: "X",
      team: "Y",
    };
    const riderPoints = new Map([["A", 25]]); // B, C, D ausentes
    expect(lineupPoints(lineup, riderPoints, new Map(), new Map())).toBeCloseTo(25);
  });
});
