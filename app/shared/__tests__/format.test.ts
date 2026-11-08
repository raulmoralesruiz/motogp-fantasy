/**
 * Tests de `app/shared/format.ts`: formato de números para la UI (es-ES).
 * Única fuente de formato — la convención española (coma decimal) se
 * verifica aquí una sola vez; los componentes delegan en `formatNumber`.
 */
import { describe, expect, it } from "vitest";

import { formatNumber } from "../format";

describe("formatNumber", () => {
  it("usa coma decimal en es-ES", () => {
    expect(formatNumber(17.4)).toBe("17,4");
    expect(formatNumber(170.5)).toBe("170,5");
    expect(formatNumber(0.5)).toBe("0,5");
    expect(formatNumber(9999.99)).toBe("9999,99");
  });

  it("no añade ceros sobrantes a enteros", () => {
    expect(formatNumber(38)).toBe("38");
    expect(formatNumber(100)).toBe("100");
    expect(formatNumber(2)).toBe("2");
  });

  it("redondea a 2 decimales como máximo", () => {
    expect(formatNumber(1.234)).toBe("1,23");
    expect(formatNumber(2.5)).toBe("2,5");
  });

  it("conserva el signo negativo", () => {
    expect(formatNumber(-2)).toBe("-2");
    expect(formatNumber(-1.5)).toBe("-1,5");
  });
});
