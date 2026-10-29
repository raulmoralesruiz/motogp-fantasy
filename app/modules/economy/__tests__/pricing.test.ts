/**
 * Tests del motor de precios (pricing-v1).
 *
 * Incluye los ejemplos verificables de referencia (AGENTS.md §7):
 *   - P0=20, prev=20, W=50 → 20
 *   - Lesión P0=20, prev=20 → 10
 */
import { describe, expect, it } from "vitest";

import {
  buildPriceSeries,
  computeNextPrice,
  injuryPrice,
  perf,
  seasonAbsencePrice,
} from "../pricing.js";

describe("perf", () => {
  it("clamp a [0, 100]", () => {
    expect(perf(60, 60)).toBe(100);
    expect(perf(30, 60)).toBeCloseTo(50);
    expect(perf(120, 60)).toBe(100);
    expect(perf(-5, 60)).toBe(0); // DNF: puntos negativos → perf 0
  });

  it("calibración D-02: Pmax=30 (máx carrera principal 25+5)", () => {
    // El motor de precios puntúa solo la carrera principal (ADR-0015), máx 30.
    // Con PMAX_RIDER=30: victoria → perf 100, podio → perf 50 (neutro).
    expect(perf(30, 30)).toBe(100); // 1º (25+5 bono) → perf 100
    expect(perf(15, 30)).toBeCloseTo(50); // 15 pts (entre 3º=16 y 4º=13) → perf 50 (neutro)
    expect(perf(11, 30)).toBeCloseTo(36.67, 1); // 5º (11 pts) → perf ~36.7
    expect(perf(0, 30)).toBe(0); // DNF/ausente → perf 0
  });
});

describe("computeNextPrice — ejemplos verificables (AGENTS.md §7)", () => {
  it("P0=20, prev=20, W=50 → 20", () => {
    // W = 0.5·100 + 0.3·0 + 0.2·0 = 50 → objetivo = 20·(0.75+0.25) = 20
    expect(
      computeNextPrice({
        prevPrice: 20,
        P0: 20,
        perfCurrent: 100,
        perfPrev1: 0,
        perfPrev2: 0,
      }),
    ).toBeCloseTo(20);
  });

  it("rendimiento sostenido al 100% → objetivo 1.25·P0, acotado a 1.15·prev por paso", () => {
    // W=100 → objetivo = 1.25·P0 = 25. Suavizado = 20 + 0.5·5 = 22.5.
    // Acotado a [0.85·20, 1.15·20] = [17, 23] → 22.5.
    expect(
      computeNextPrice({
        prevPrice: 20,
        P0: 20,
        perfCurrent: 100,
        perfPrev1: 100,
        perfPrev2: 100,
      }),
    ).toBeCloseTo(22.5);
  });

  it("acotación inferior: no puede caer más de 15% por paso", () => {
    // W=0 → objetivo = 0.75·P0 = 15. Suavizado = 20 + 0.5·(−5) = 17.5.
    // Acotado a [17, 23] → 17.5 (dentro). Con prev=20 y objetivo 15 el paso da 17.5.
    expect(
      computeNextPrice({
        prevPrice: 20,
        P0: 20,
        perfCurrent: 0,
        perfPrev1: 0,
        perfPrev2: 0,
      }),
    ).toBeCloseTo(17.5);
  });

  it("el precio nunca cae por debajo de 0.25·P0 (suelo absoluto)", () => {
    // Con perf 0 siempre, objetivo = 0.75·P0 = 15. La serie converge a 15
    // desde arriba y nunca toca el suelo 0.25·P0 = 5 (el suelo es red de
    // seguridad; en la fórmula normal, prev ≥ 0.25·P0 ⇒ suavizado ≥ 0.25·P0).
    const serie = buildPriceSeries(20, new Array(20).fill(0), new Array(20).fill(false));
    for (const p of serie) expect(p).toBeGreaterThanOrEqual(5 - 1e-9);
    expect(serie[19]).toBeCloseTo(15, 4);
  });
});

describe("injuryPrice / seasonAbsencePrice — ejemplos verificables", () => {
  it("lesión P0=20, prev=20 → 10", () => {
    expect(injuryPrice(20, 20)).toBeCloseTo(10);
  });

  it("lesión con prev muy bajo → suelo 0.25·P0", () => {
    expect(injuryPrice(6, 20)).toBeCloseTo(5); // max(5, 3) = 5
  });

  it("baja por temporada → 0.25·P0", () => {
    expect(seasonAbsencePrice(20)).toBeCloseTo(5);
  });
});

describe("buildPriceSeries", () => {
  it("precio[0] = P0 y serie estable con rendimiento 0", () => {
    // Con perf 0 siempre: objetivo = 0.75·P0; el precio converge hacia 0.75·P0
    // con pasos de −15% como máximo.
    const serie = buildPriceSeries(20, [0, 0, 0, 0], [false, false, false, false]);
    expect(serie[0]).toBe(20);
    expect(serie[1]).toBeCloseTo(17.5); // 20 → 20+0.5·(15−20)
    expect(serie[2]).toBeCloseTo(16.25); // 17.5 → 17.5+0.5·(15−17.5)
    expect(serie[3]).toBeCloseTo(15.625); // 16.25 → 16.25+0.5·(15−16.25)
  });

  it("lesión en el GP 3 → precio[2] = max(0.25·P0, 0.5·prev)", () => {
    const serie = buildPriceSeries(20, [100, 0, 0], [false, false, true]);
    // GP1: P0=20. GP2: W=50 → objetivo 20 → precio 20. GP3: fuera → 0.5·20 = 10.
    expect(serie[2]).toBeCloseTo(10);
  });

  it("recupera tras la lesión con la fórmula normal", () => {
    // GP1: perf 100. GP2: perf 0. GP3: FUERA (lesión). GP4: vuelve, perf 0.
    const serie = buildPriceSeries(20, [100, 0, 0, 0], [false, false, true, false]);
    // GP2: W=50 → objetivo 20 → precio 20. GP3: fuera → 0.5·20 = 10.
    // GP4: prev=10. W = 0.5·0 + 0.3·0 + 0.2·100 = 20 (GP1 pesa 0.2).
    // objetivo = 20·(0.75+0.1) = 17. suavizado = 10 + 0.5·7 = 13.5.
    // Acotado a [0.85·10, 1.15·10] = [8.5, 11.5] → 11.5.
    expect(serie[2]).toBeCloseTo(10);
    expect(serie[3]).toBeCloseTo(11.5);
  });
});
