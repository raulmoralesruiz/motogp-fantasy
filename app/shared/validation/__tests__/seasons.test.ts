/**
 * Tests de los schemas de entrada del módulo `seasons` (US-04).
 *
 * - Payloads válidos (reglas PROVISIONAL, fechas opcionales) parsean.
 * - Payloads inválidos se rechazan con el motivo en español.
 */
import { describe, expect, it } from "vitest";

import { PROVISIONAL_SEASON_RULES } from "../../config/season-rules.js";
import {
  addRulesVersionInputSchema,
  createSeasonInputSchema,
  seasonIdInputSchema,
} from "../seasons.js";

const SEASON_ID = "123e4567-e89b-42d3-a456-426614174000";

describe("createSeasonInputSchema (US-04)", () => {
  it("acepta una temporada válida con reglas PROVISIONAL", () => {
    const result = createSeasonInputSchema.safeParse({
      name: "Temporada 2026",
      year: 2026,
      rules: PROVISIONAL_SEASON_RULES,
    });
    expect(result.success).toBe(true);
  });

  it("coerce las fechas a Date", () => {
    const result = createSeasonInputSchema.safeParse({
      name: "Temporada 2026",
      year: 2026,
      startDate: "2026-02-28",
      endDate: "2026-11-08",
      rules: PROVISIONAL_SEASON_RULES,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.startDate).toBeInstanceOf(Date);
      expect(result.data.endDate).toBeInstanceOf(Date);
    }
  });

  it("rechaza un nombre vacío", () => {
    const result = createSeasonInputSchema.safeParse({
      name: "",
      year: 2026,
      rules: PROVISIONAL_SEASON_RULES,
    });
    expect(result.success).toBe(false);
  });

  it("rechaza un año no entero o fuera de rango", () => {
    const base = { name: "T", rules: PROVISIONAL_SEASON_RULES };
    expect(createSeasonInputSchema.safeParse({ ...base, year: 2026.5 }).success).toBe(
      false,
    );
    expect(createSeasonInputSchema.safeParse({ ...base, year: 1899 }).success).toBe(
      false,
    );
    expect(createSeasonInputSchema.safeParse({ ...base, year: 2201 }).success).toBe(
      false,
    );
  });

  it("rechaza una fecha de fin anterior a la de inicio (motivo en endDate)", () => {
    const result = createSeasonInputSchema.safeParse({
      name: "T",
      year: 2026,
      startDate: "2026-11-08",
      endDate: "2026-02-28",
      rules: PROVISIONAL_SEASON_RULES,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.path.join(".") === "endDate"),
      ).toBe(true);
    }
  });

  it("rechaza reglas inválidas (el motivo está bajo rules.*)", () => {
    const result = createSeasonInputSchema.safeParse({
      name: "T",
      year: 2026,
      rules: {
        ...PROVISIONAL_SEASON_RULES,
        economy: { ...PROVISIONAL_SEASON_RULES.economy, B: -1 },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === "rules")).toBe(true);
    }
  });
});

describe("addRulesVersionInputSchema (US-04)", () => {
  it("acepta un uuid válido + reglas válidas", () => {
    const result = addRulesVersionInputSchema.safeParse({
      seasonId: SEASON_ID,
      rules: PROVISIONAL_SEASON_RULES,
    });
    expect(result.success).toBe(true);
  });

  it("rechaza un seasonId que no es uuid", () => {
    const result = addRulesVersionInputSchema.safeParse({
      seasonId: "no-uuid",
      rules: PROVISIONAL_SEASON_RULES,
    });
    expect(result.success).toBe(false);
  });

  it("rechaza reglas inválidas", () => {
    const result = addRulesVersionInputSchema.safeParse({
      seasonId: SEASON_ID,
      rules: {
        ...PROVISIONAL_SEASON_RULES,
        league: { minMembers: 10, maxMembers: 5 },
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("seasonIdInputSchema (US-04)", () => {
  it("acepta un uuid y rechaza el resto", () => {
    expect(seasonIdInputSchema.safeParse({ seasonId: SEASON_ID }).success).toBe(true);
    expect(seasonIdInputSchema.safeParse({ seasonId: "abc" }).success).toBe(false);
    expect(seasonIdInputSchema.safeParse({}).success).toBe(false);
  });
});
