/**
 * Test de `assertProvisionalRulesValid` en el CASO DE FALLO (T-24): si
 * `PROVISIONAL_SEASON_RULES` deja de pasar `seasonRulesSchema`, la aserción
 * debe lanzar con los issues (falla rápido en tiempo de ejecución).
 *
 * Se hace en un archivo SEPARADO del test de éxito: `vi.mock` del esquema
 * es por archivo, y romperlo aquí rompería el test de éxito si compartieran
 * archivo.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../validation/season-rules", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../validation/season-rules")>();
  return {
    ...actual,
    seasonRulesSchema: {
      safeParse: () => ({
        success: false,
        error: {
          issues: [{ path: ["economy", "option"], message: "opción inválida (test)" }],
        },
      }),
    },
  };
});

import { assertProvisionalRulesValid } from "../season-rules.js";

describe("assertProvisionalRulesValid — caso de fallo (T-24)", () => {
  it("lanza con los issues si PROVISIONAL_SEASON_RULES no pasa el esquema", () => {
    expect(() => assertProvisionalRulesValid()).toThrowError(
      /PROVISIONAL_SEASON_RULES no pasa seasonRulesSchema: economy\.option: opción inválida \(test\)/,
    );
  });
});
