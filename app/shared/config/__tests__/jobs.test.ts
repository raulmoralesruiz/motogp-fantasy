/**
 * Tests de `PROVISIONAL_JOBS` y `assertProvisionalJobsValid` (T-10, ADR-0034).
 *
 * - Éxito: los defaults provisionales pasan el esquema.
 * - Valores: nombres de cola estables + reintentos/backoff.
 * - Fallo: si `PROVISIONAL_JOBS` deja de pasar `jobsConfigSchema`, la
 *   aserción debe lanzar con los issues (falla rápido en tiempo de ejecución).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import {
  JOBS_QUEUE_GP_PRICES,
  JOBS_QUEUE_RESULTS_POLL,
  PROVISIONAL_JOBS,
  assertProvisionalJobsValid,
  jobsConfigSchema,
} from "../jobs.js";

describe("PROVISIONAL_JOBS (T-10, ADR-0034)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pasa jobsConfigSchema", () => {
    expect(() => assertProvisionalJobsValid()).not.toThrow();
  });

  it("valores provisionales: 3 reintentos, backoff 1000 ms", () => {
    expect(PROVISIONAL_JOBS).toEqual({ attempts: 3, backoffMs: 1000 });
  });

  it("nombres de cola estables (el worker y la web los acuerdan)", () => {
    expect(JOBS_QUEUE_GP_PRICES).toBe("gp-prices");
    expect(JOBS_QUEUE_RESULTS_POLL).toBe("results-poll");
  });

  it("lanza con los issues si PROVISIONAL_JOBS no pasa el esquema", () => {
    vi.spyOn(jobsConfigSchema, "safeParse").mockReturnValue({
      success: false,
      error: new ZodError([
        {
          code: "custom",
          path: ["attempts"],
          message: "Debe ser ≥ 1 (test)",
        },
      ]),
    });

    expect(() => assertProvisionalJobsValid()).toThrowError(
      "PROVISIONAL_JOBS no pasa jobsConfigSchema: attempts: Debe ser ≥ 1 (test)",
    );
  });
});
