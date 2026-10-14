/**
 * Golden file del módulo economy (economy-v1).
 *
 * Carga `golden/economy-v1.json` y verifica que el módulo reproduce las
 * salidas esperadas. Si una regla cambia, el golden se actualiza de forma
 * explícita y revisada — AGENTS.md §7.
 */
import { describe, expect, it } from "vitest";

import goldenRaw from "./golden/economy-v1.json";
import {
  buildPriceSeries,
  computeNextPrice,
  injuryPrice,
  presupuesto,
  presupuestoA,
  presupuestoB,
  presupuestoC,
  presupuestoE,
  seasonAbsencePrice,
  type BudgetContext,
  type BudgetOption,
  type BudgetParams,
  type NextPriceArgs,
} from "../index.js";

interface GoldenCase {
  id: string;
  fn: string;
  args: Record<string, unknown>;
  expected: number | number[];
}

const golden = goldenRaw as {
  rulesVersion: string;
  description: string;
  cases: GoldenCase[];
};

function runCase(c: GoldenCase): number | number[] {
  const a = c.args;
  switch (c.fn) {
    case "presupuestoA":
      return presupuestoA(a.params as BudgetParams);
    case "presupuestoE":
      return presupuestoE(a.params as BudgetParams, a.ctx as BudgetContext);
    case "presupuestoB":
      return presupuestoB(a.ctx as BudgetContext);
    case "presupuestoC":
      return presupuestoC(a.params as BudgetParams, a.ctx as BudgetContext);
    case "presupuesto":
      return presupuesto(
        a.opcion as BudgetOption,
        a.params as BudgetParams,
        a.ctx as BudgetContext,
      );
    case "computeNextPrice":
      return computeNextPrice(a as unknown as NextPriceArgs);
    case "injuryPrice":
      return injuryPrice(a.prevPrice as number, a.P0 as number);
    case "seasonAbsencePrice":
      return seasonAbsencePrice(a.P0 as number);
    case "buildPriceSeries":
      return buildPriceSeries(
        a.P0 as number,
        a.perfByGp as number[],
        a.outByGp as boolean[],
      );
    default:
      throw new Error(`Golden economy: función desconocida "${c.fn}"`);
  }
}

describe(`Golden economy (${golden.rulesVersion})`, () => {
  it("declara la versión economy-v1", () => {
    expect(golden.rulesVersion).toBe("economy-v1");
  });

  for (const c of golden.cases) {
    it(c.id, () => {
      const result = runCase(c);
      if (Array.isArray(result) || Array.isArray(c.expected)) {
        expect(result).toEqual(c.expected);
      } else {
        expect(result).toBeCloseTo(c.expected as number, 6);
      }
    });
  }
});
