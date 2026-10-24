/**
 * Golden file del módulo scoring (scoring-v1).
 *
 * Carga `golden/scoring-v1.json` y verifica que el módulo reproduce las
 * salidas esperadas. Si una regla cambia, el golden se actualiza de forma
 * explícita y revisada — AGENTS.md §7.
 */
import { describe, expect, it } from "vitest";

import { PROVISIONAL_SEASON_RULES } from "../../../shared/config/season-rules.js";
import type { GpStatus, Lineup } from "../../../shared/types/index.js";
import {
  lineupPoints,
  mainRacePositionPoints,
  riderMainPoints,
  scoreRiderWeekend,
  topTwoAverage,
  type RiderPointsBreakdown,
  type RiderScoringContext,
  type RiderWeekend,
} from "../index.js";
import goldenRaw from "./golden/scoring-v1.json";

type GoldenResult = number | number[] | RiderPointsBreakdown;

interface GoldenCase {
  id: string;
  fn: string;
  args: Record<string, unknown>;
  expected: GoldenResult;
}

const golden = goldenRaw as {
  rulesVersion: string;
  description: string;
  cases: GoldenCase[];
};

function toMap(obj: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(obj));
}

function runCase(c: GoldenCase): GoldenResult {
  const a = c.args;
  switch (c.fn) {
    case "lineupPoints":
      return lineupPoints(
        a.lineup as Lineup,
        toMap(a.riderPoints as Record<string, number>),
        toMap(a.ctorPoints as Record<string, number>),
        toMap(a.teamPoints as Record<string, number>),
      );
    case "mainRacePositionPoints":
      return (a.positions as number[]).map((p) => mainRacePositionPoints(p));
    case "riderMainPoints":
      return riderMainPoints(a.status as GpStatus, a.position as number | null);
    case "topTwoAverage":
      return topTwoAverage(a.values as number[]);
    case "scoreRiderWeekend": {
      const ctx = a.ctx as {
        q2Grid: Record<string, number>;
        teamOf: Record<string, string>;
        priceOf: Record<string, number>;
      };
      const riderCtx: RiderScoringContext = {
        q2Grid: new Map(Object.entries(ctx.q2Grid)),
        teamOf: new Map(Object.entries(ctx.teamOf)),
        priceOf: new Map(Object.entries(ctx.priceOf)),
      };
      return scoreRiderWeekend(
        a.riderId as string,
        a.weekend as RiderWeekend,
        PROVISIONAL_SEASON_RULES.scoring,
        riderCtx,
      );
    }
    default:
      throw new Error(`Golden scoring: función desconocida "${c.fn}"`);
  }
}

describe(`Golden scoring (${golden.rulesVersion})`, () => {
  it("declara la versión scoring-v1", () => {
    expect(golden.rulesVersion).toBe("scoring-v1");
  });

  for (const c of golden.cases) {
    it(c.id, () => {
      const result = runCase(c);
      if (
        Array.isArray(result) ||
        Array.isArray(c.expected) ||
        (typeof result === "object" && result !== null)
      ) {
        expect(result).toEqual(c.expected);
      } else {
        expect(result).toBeCloseTo(c.expected as number, 6);
      }
    });
  }
});
