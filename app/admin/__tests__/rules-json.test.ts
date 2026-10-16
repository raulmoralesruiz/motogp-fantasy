/**
 * Tests de `parseRulesJson` (US-04, UI admin): validación pura en cliente
 * del JSON de reglas (el servidor revalida — AGENTS.md §8).
 */
import { describe, expect, it } from "vitest";

import { PROVISIONAL_SEASON_RULES } from "../../shared/config/season-rules";
import { parseRulesJson } from "../rules-json";

describe("parseRulesJson (US-04, UI admin)", () => {
  it("acepta el JSON de PROVISIONAL_SEASON_RULES", () => {
    const result = parseRulesJson(JSON.stringify(PROVISIONAL_SEASON_RULES));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rules).toEqual(PROVISIONAL_SEASON_RULES);
    }
  });

  it("rechaza un JSON malformado", () => {
    const result = parseRulesJson("{no es json");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("JSON");
    }
  });

  it("rechaza un JSON válido pero con reglas inválidas (con el motivo)", () => {
    const bad = {
      ...PROVISIONAL_SEASON_RULES,
      economy: { ...PROVISIONAL_SEASON_RULES.economy, B: -1 },
    };
    const result = parseRulesJson(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("economy.B");
    }
  });
});
