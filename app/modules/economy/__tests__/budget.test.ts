/**
 * Tests del motor de presupuesto (opciones A/B/C/E).
 *
 * Incluye los ejemplos verificables de referencia (AGENTS.md §7):
 *   - presupuesto(B=100, t=0.25, cmax=8, sin_usar=8) = 102
 *   - sin_usar=40 → 108 (tope cmax)
 */
import { describe, expect, it } from "vitest";

import {
  presupuesto,
  presupuestoA,
  presupuestoB,
  presupuestoC,
  presupuestoE,
} from "../budget.js";

const params = { B: 100, t: 0.25, cmax: 8 };
const ctxBase = {
  sinUsarPrevio: 0,
  valorEquipo: 0,
  puntosJugador: 0,
  mediaPuntos: 0,
};

describe("presupuestoE — ejemplos verificables (AGENTS.md §7)", () => {
  it("sin_usar=8 → 102", () => {
    expect(presupuestoE(params, { ...ctxBase, sinUsarPrevio: 8 })).toBeCloseTo(102);
  });

  it("sin_usar=40 → 108 (tope cmax=8)", () => {
    expect(presupuestoE(params, { ...ctxBase, sinUsarPrevio: 40 })).toBeCloseTo(108);
  });

  it("sin_usar=0 → B", () => {
    expect(presupuestoE(params, ctxBase)).toBeCloseTo(100);
  });
});

describe("presupuestoA", () => {
  it("siempre B", () => {
    expect(presupuestoA(params)).toBe(100);
    expect(presupuesto("A", params, { ...ctxBase, sinUsarPrevio: 50 })).toBe(100);
  });
});

describe("presupuestoB (oficial, ratchet)", () => {
  it("cap = valor de mercado + sin usar", () => {
    expect(presupuestoB({ ...ctxBase, valorEquipo: 89, sinUsarPrevio: 14 })).toBeCloseTo(103);
    // Ejemplo verificable de la simulación ficticia: cap 89 vs 103.
  });
});

describe("presupuestoC (dinámico con límites)", () => {
  it("empate con la media → B", () => {
    expect(presupuestoC(params, { ...ctxBase, puntosJugador: 100, mediaPuntos: 100 })).toBeCloseTo(100);
  });

  it("muy por encima de la media → 1.2B (techo)", () => {
    expect(presupuestoC(params, { ...ctxBase, puntosJugador: 200, mediaPuntos: 100 })).toBeCloseTo(120);
  });

  it("muy por debajo de la media → 0.8B (suelo)", () => {
    // rel = (0−100)/100 = −1 → 100·(1−0.2) = 80.
    expect(presupuestoC(params, { ...ctxBase, puntosJugador: 0, mediaPuntos: 100 })).toBeCloseTo(80);
  });

  it("desviación −90% → 0.82B (dentro del rango)", () => {
    expect(presupuestoC(params, { ...ctxBase, puntosJugador: 10, mediaPuntos: 100 })).toBeCloseTo(82);
  });

  it("desviación intermedia: +50% sobre la media → 1.1B", () => {
    expect(presupuestoC(params, { ...ctxBase, puntosJugador: 150, mediaPuntos: 100 })).toBeCloseTo(110);
  });
});
