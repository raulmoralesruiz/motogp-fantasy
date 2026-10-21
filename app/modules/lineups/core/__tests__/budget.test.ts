/**
 * Tests del presupuesto derivado de movimientos — núcleo puro, ADR-0017.
 *
 * Incluye los ejemplos verificables de referencia (AGENTS.md §7):
 *   - presupuesto(B=100, t=0.25, cmax=8, sin_usar=8) = 102
 *   - sin_usar=40 → 108 (tope cmax)
 * Aquí se expresan como movimientos: base + carry + spend.
 */
import { describe, expect, it } from "vitest";

import {
  balanceFromMovements,
  budgetBreakdown,
  changeSpendMovement,
  firstSaveBudget,
  firstSaveMovements,
} from "../budget.js";

const params = { B: 100, t: 0.25, cmax: 8 };

describe("firstSaveMovements — primer save del GP n (opción E)", () => {
  it("sin_usar=8 → base 100 + carry 2 + spend (presupuesto 102)", () => {
    const ms = firstSaveMovements(params, 8, 95);
    expect(ms).toEqual([
      { type: "base", amount: 100 },
      { type: "carry", amount: 2 },
      { type: "spend", amount: -95 },
    ]);
    // Saldo resultante: 102 − 95 = 7.
    expect(balanceFromMovements(ms)).toBeCloseTo(7, 10);
  });

  it("sin_usar=40 → carry limitado a cmax=8 (presupuesto 108)", () => {
    const ms = firstSaveMovements(params, 40, 95);
    expect(ms).toEqual([
      { type: "base", amount: 100 },
      { type: "carry", amount: 8 },
      { type: "spend", amount: -95 },
    ]);
    expect(balanceFromMovements(ms)).toBeCloseTo(13, 10);
  });

  it("primer GP de la temporada (saldo previo 0) → carry 0", () => {
    const ms = firstSaveMovements(params, 0, 95);
    expect(ms).toEqual([
      { type: "base", amount: 100 },
      { type: "carry", amount: 0 },
      { type: "spend", amount: -95 },
    ]);
  });

  it("saldo previo negativo (defensivo) → carry 0", () => {
    const ms = firstSaveMovements(params, -5, 95);
    expect(ms[1]).toEqual({ type: "carry", amount: 0 });
  });
});

describe("firstSaveBudget — presupuesto del primer save (US-10)", () => {
  it("sin_usar=8 → 102 (ejemplo de referencia)", () => {
    expect(firstSaveBudget(params, 8)).toBeCloseTo(102, 10);
  });

  it("sin_usar=40 → 108 (tope cmax)", () => {
    expect(firstSaveBudget(params, 40)).toBeCloseTo(108, 10);
  });

  it("primer GP (saldo previo 0) → B", () => {
    expect(firstSaveBudget(params, 0)).toBeCloseTo(100, 10);
  });

  it("saldo previo negativo (defensivo) → B", () => {
    expect(firstSaveBudget(params, -5)).toBeCloseTo(100, 10);
  });

  it("redondea al céntimo", () => {
    // 0.25 · (1/3) = 0.0833… → 100.08.
    expect(firstSaveBudget(params, 1 / 3)).toBeCloseTo(100.08, 10);
  });
});

describe("budgetBreakdown — desglose base + carry (US-10)", () => {
  it("sin movimientos → 0/0/0", () => {
    expect(budgetBreakdown([])).toEqual({ base: 0, carry: 0, total: 0 });
  });

  it("desglosa base + carry e ignora el spend", () => {
    expect(
      budgetBreakdown([
        { type: "base", amount: 100 },
        { type: "carry", amount: 5 },
        { type: "spend", amount: -80 },
      ]),
    ).toEqual({ base: 100, carry: 5, total: 105 });
  });

  it("redondea al céntimo", () => {
    expect(
      budgetBreakdown([
        { type: "base", amount: 100 },
        { type: "carry", amount: 0.1 },
      ]),
    ).toEqual({ base: 100, carry: 0.1, total: 100.1 });
  });
});

describe("changeSpendMovement — cambios posteriores", () => {
  it("el coste baja → devolución (importe positivo)", () => {
    expect(changeSpendMovement(95, 90)).toEqual({ type: "spend", amount: 5 });
  });

  it("el coste sube → gasto (importe negativo)", () => {
    expect(changeSpendMovement(90, 95)).toEqual({ type: "spend", amount: -5 });
  });

  it("coste igual → movimiento 0", () => {
    expect(changeSpendMovement(95, 95)).toEqual({ type: "spend", amount: 0 });
  });
});

describe("balanceFromMovements — saldo derivado", () => {
  it("sin movimientos → 0", () => {
    expect(balanceFromMovements([])).toBeCloseTo(0, 10);
  });

  it("suma los movimientos (base + carry + spend)", () => {
    expect(
      balanceFromMovements([
        { type: "base", amount: 100 },
        { type: "carry", amount: 2 },
        { type: "spend", amount: -95 },
      ]),
    ).toBeCloseTo(7, 10);
  });

  it("redondea al céntimo", () => {
    expect(
      balanceFromMovements([
        { type: "base", amount: 100 },
        { type: "carry", amount: 0.1 },
        { type: "spend", amount: -100.2 },
      ]),
    ).toBeCloseTo(-0.1, 10);
  });
});
