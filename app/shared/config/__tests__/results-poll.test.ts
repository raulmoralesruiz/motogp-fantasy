/**
 * Tests de `PROVISIONAL_RESULTS_POLL` y `assertProvisionalResultsPollValid`
 * (US-17, ADR-0019).
 *
 * - Éxito: los defaults provisionales pasan el esquema.
 * - Fallo: si `PROVISIONAL_RESULTS_POLL` deja de pasar
 *   `resultsPollConfigSchema`, la aserción debe lanzar con los issues
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
  PROVISIONAL_RESULTS_POLL,
  assertProvisionalResultsPollValid,
  resultsPollConfigSchema,
} from "../results-poll.js";

describe("PROVISIONAL_RESULTS_POLL (US-17, ADR-0019)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pasa resultsPollConfigSchema", () => {
    expect(() => assertProvisionalResultsPollValid()).not.toThrow();
  });

  it("valores provisionales: ventana 48 h antes / 24 h después, 5 min, N=3", () => {
    expect(PROVISIONAL_RESULTS_POLL).toEqual({
      windowBeforeHours: 48,
      windowAfterHours: 24,
      intervalMinutes: 5,
      failureAlertThreshold: 3,
    });
  });

  it("lanza con los issues si PROVISIONAL_RESULTS_POLL no pasa el esquema", () => {
    vi.spyOn(resultsPollConfigSchema, "safeParse").mockReturnValue({
      success: false,
      error: new ZodError([
        {
          code: "custom",
          path: ["intervalMinutes"],
          message: "Debe ser un entero (test)",
        },
      ]),
    });

    expect(() => assertProvisionalResultsPollValid()).toThrowError(
      "PROVISIONAL_RESULTS_POLL no pasa resultsPollConfigSchema: intervalMinutes: Debe ser un entero (test)",
    );
  });
});
