/**
 * Tests de `PROVISIONAL_MARKET_CONFIG` y `assertProvisionalMarketConfigValid`
 * (calibración P0, ADR-0032).
 *
 * - Éxito: los defaults provisionales pasan el esquema.
 * - Valores: rango P0 17.4→5.8 (Opción B, k≈0.58).
 * - Fallo: si `PROVISIONAL_MARKET_CONFIG` deja de pasar
 *   `marketConfigSchema`, la aserción debe lanzar con los issues
 *   (falla rápido en tiempo de ejecución).
 *
 * El esquema vive en el MISMO módulo que la aserción (a diferencia de
 * `season-rules`, donde el esquema está en `shared/validation` y el test de
 * fallo usa `vi.mock`): `vi.mock` no afecta al binding interno del módulo,
 * así que el caso de fallo espía `safeParse` sobre la misma instancia del
 * esquema.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import {
  PROVISIONAL_MARKET_CONFIG,
  assertProvisionalMarketConfigValid,
  marketConfigSchema,
} from "../market.js";

describe("PROVISIONAL_MARKET_CONFIG (calibración P0, ADR-0032)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pasa marketConfigSchema", () => {
    expect(() => assertProvisionalMarketConfigValid()).not.toThrow();
  });

  it("valores provisionales: rango P0 17.4→5.8 (Opción B)", () => {
    expect(PROVISIONAL_MARKET_CONFIG).toEqual({
      p0: {
        max: 17.4,
        min: 5.8,
      },
    });
  });

  it("rechaza un P0 mínimo mayor que el máximo", () => {
    const result = marketConfigSchema.safeParse({ p0: { max: 5, min: 10 } });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "El P0 mínimo no puede superar al máximo",
      );
    }
  });

  it("lanza con los issues si PROVISIONAL_MARKET_CONFIG no pasa el esquema", () => {
    vi.spyOn(marketConfigSchema, "safeParse").mockReturnValue({
      success: false,
      error: new ZodError([
        {
          code: "custom",
          path: ["p0", "max"],
          message: "El P0 máximo debe ser positivo (test)",
        },
      ]),
    });

    expect(() => assertProvisionalMarketConfigValid()).toThrowError(
      "PROVISIONAL_MARKET_CONFIG no pasa marketConfigSchema: p0.max: El P0 máximo debe ser positivo (test)",
    );
  });
});
