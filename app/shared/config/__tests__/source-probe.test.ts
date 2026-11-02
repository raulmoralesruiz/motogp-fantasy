/**
 * Tests de `PROVISIONAL_SOURCE_PROBE` y `assertProvisionalSourceProbeValid`
 * (T-14, ADR-0036).
 *
 * - Éxito: los defaults provisionales pasan el esquema.
 * - Valores: timeout 5 s + umbral de alerta 3 (coherente con el polling).
 * - Fallo: si `PROVISIONAL_SOURCE_PROBE` deja de pasar
 *   `sourceProbeConfigSchema`, la aserción debe lanzar con los issues.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import {
  PROVISIONAL_SOURCE_PROBE,
  assertProvisionalSourceProbeValid,
  sourceProbeConfigSchema,
} from "../source-probe.js";

describe("PROVISIONAL_SOURCE_PROBE (T-14, ADR-0036)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pasa sourceProbeConfigSchema", () => {
    expect(() => assertProvisionalSourceProbeValid()).not.toThrow();
  });

  it("valores provisionales: timeout 5000 ms, umbral de alerta 3", () => {
    expect(PROVISIONAL_SOURCE_PROBE).toEqual({
      timeoutMs: 5000,
      failureAlertThreshold: 3,
    });
  });

  it("lanza con los issues si PROVISIONAL_SOURCE_PROBE no pasa el esquema", () => {
    vi.spyOn(sourceProbeConfigSchema, "safeParse").mockReturnValue({
      success: false,
      error: new ZodError([
        {
          code: "custom",
          path: ["timeoutMs"],
          message: "Debe ser positivo (test)",
        },
      ]),
    });

    expect(() => assertProvisionalSourceProbeValid()).toThrowError(
      /timeoutMs: Debe ser positivo \(test\)/,
    );
  });
});
