/**
 * Golden file del núcleo puro de lineups (lineups-v1).
 *
 * Carga `golden/lineups-v1.json` y verifica que el núcleo reproduce las
 * salidas esperadas. Si una regla cambia, el golden se actualiza de forma
 * explícita y revisada — AGENTS.md §7.
 *
 * Los args de un caso pueden referenciar fixtures compartidas del propio
 * archivo con la sintaxis `"@nombre"` (p. ej. `"@affiliations"`).
 */
import { describe, expect, it } from "vitest";

import goldenRaw from "./golden/lineups-v1.json";
import {
  balanceFromMovements,
  changeSpendMovement,
  firstSaveMovements,
  lineupCost,
  validateLineup,
  type BudgetMovement,
  type BudgetMovementType,
  type ConcentrationLimits,
  type GpPrice,
  type LineupSlots,
  type RiderAffiliation,
} from "../index.js";

interface GoldenCase {
  id: string;
  fn: string;
  args: Record<string, unknown>;
  expected: unknown;
}

const golden = goldenRaw as {
  rulesVersion: string;
  description: string;
  fixtures: Record<string, unknown>;
  cases: GoldenCase[];
};

/** Resuelve referencias "@fixture" contra las fixtures del archivo. */
function resolve(value: unknown): unknown {
  if (typeof value === "string" && value.startsWith("@")) {
    const name = value.slice(1);
    if (!(name in golden.fixtures)) {
      throw new Error(`Golden lineups: fixture desconocida "${name}"`);
    }
    return golden.fixtures[name];
  }
  return value;
}

function movementsFromPairs(pairs: [BudgetMovementType, number][]): BudgetMovement[] {
  return pairs.map(([type, amount]) => ({ type, amount }));
}

function runCase(c: GoldenCase): unknown {
  const a = c.args;
  switch (c.fn) {
    case "validateLineup":
      return validateLineup(
        resolve(a.slots) as LineupSlots,
        (resolve(a.affiliations) ?? []) as RiderAffiliation[],
        resolve(a.limits) as ConcentrationLimits,
      );
    case "lineupCost":
      return lineupCost(
        resolve(a.slots) as LineupSlots,
        (resolve(a.prices) ?? []) as GpPrice[],
      );
    case "firstSaveMovements":
      return firstSaveMovements(
        resolve(a.params) as { B: number; t: number; cmax: number },
        a.prevBalance as number,
        a.cost as number,
      );
    case "changeSpendMovement":
      return changeSpendMovement(a.costBefore as number, a.costAfter as number);
    case "balanceFromMovements":
      return balanceFromMovements(
        movementsFromPairs(a.movements as [BudgetMovementType, number][]),
      );
    default:
      throw new Error(`Golden lineups: función desconocida "${c.fn}"`);
  }
}

/** Normaliza el resultado a una forma comparable con `expected`. */
function normalize(result: unknown): unknown {
  if (result && typeof result === "object" && "ok" in result) {
    const r = result as {
      ok: boolean;
      reasons?: string[];
      missing?: unknown[];
      cost?: number;
    };
    if (r.ok) return "cost" in r ? r.cost : true;
    if ("reasons" in r) return r.reasons;
    if ("missing" in r) return r.missing;
  }
  if (Array.isArray(result)) {
    return result.map((m) => [
      (m as BudgetMovement).type,
      (m as BudgetMovement).amount,
    ]);
  }
  if (result && typeof result === "object" && "type" in result && "amount" in result) {
    const m = result as BudgetMovement;
    return [m.type, m.amount];
  }
  return result;
}

describe(`golden lineups (${golden.rulesVersion})`, () => {
  it("el archivo declara la versión de reglas lineups-v1", () => {
    expect(golden.rulesVersion).toBe("lineups-v1");
  });

  it("tiene casos", () => {
    expect(golden.cases.length).toBeGreaterThan(0);
  });

  for (const c of golden.cases) {
    it(c.id, () => {
      const actual = normalize(runCase(c));
      if (typeof c.expected === "number") {
        expect(actual as number).toBeCloseTo(c.expected, 6);
      } else {
        expect(actual).toEqual(c.expected);
      }
    });
  }
});
