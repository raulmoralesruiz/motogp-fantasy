/**
 * Tests de la contabilidad de cambios — núcleo puro, ADR-0017.
 */
import { describe, expect, it } from "vitest";

import { canUseWildcard, remainingChanges } from "../changes.js";

describe("remainingChanges — cambios restantes del GP", () => {
  it("sin cambios usados ni exenciones → perGp", () => {
    expect(remainingChanges(0, 0, 2)).toBe(2);
  });

  it("cambios agotados y sin exenciones → 0", () => {
    expect(remainingChanges(2, 0, 2)).toBe(0);
  });

  it("cambios agotados con 1 exención sin usar → 1", () => {
    expect(remainingChanges(2, 1, 2)).toBe(1);
  });

  it("1 cambio usado + 1 exención → 2 (1 normal + 1 exención)", () => {
    expect(remainingChanges(1, 1, 2)).toBe(2);
  });

  it("usados > perGp (defensivo) → suelo 0 + exenciones", () => {
    expect(remainingChanges(5, 1, 2)).toBe(1);
  });
});

describe("canUseWildcard — wildcard por temporada", () => {
  it("sin wildcard usada → disponible", () => {
    expect(canUseWildcard(0, 1)).toBe(true);
  });

  it("wildcard ya usada → no disponible", () => {
    expect(canUseWildcard(1, 1)).toBe(false);
  });

  it("0 wildcards por temporada → nunca disponible", () => {
    expect(canUseWildcard(0, 0)).toBe(false);
  });
});
