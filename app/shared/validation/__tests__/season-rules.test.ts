/**
 * Tests de `seasonRulesSchema` (T-18).
 *
 * - Los payloads válidos (defaults PROVISIONAL y variantes mínimas) parsean.
 * - Los payloads malformados se rechazan con motivo en español.
 */
import { describe, expect, it } from "vitest";

import { PROVISIONAL_SEASON_RULES } from "../../config/season-rules.js";
import * as validationBarrel from "../index.js";
import { seasonRulesSchema } from "../season-rules.js";
import { normalizedSeasonCalendarSchema } from "../seasons.js";

/** Devuelve el mensaje de la primera issue si el payload no parsea. */
function firstMessage(payload: unknown): string | undefined {
  const result = seasonRulesSchema.safeParse(payload);
  if (result.success) return undefined;
  return result.error.issues[0]?.message;
}

describe("seasonRulesSchema — payloads válidos", () => {
  it("parsea los defaults PROVISIONAL", () => {
    expect(seasonRulesSchema.safeParse(PROVISIONAL_SEASON_RULES).success).toBe(true);
  });

  it("acepta una variante mínima (opción A, sin transfers)", () => {
    const result = seasonRulesSchema.safeParse({
      rulesVersion: "2026-v1",
      economy: { option: "A", B: 90, t: 0, cmax: 0 },
      pricing: { pmaxRider: 60, pmaxGroup: 30 },
      scoring: {
        q2: { "1": 12 },
        sprint: { "1": 12 },
        mainRace: { "1": 25 },
        winnerBonus: 5,
        fastestLapBonus: 3,
        poleBonus: 2,
        positionsGainedBonus: 1,
        positionsGainedMax: 3,
        extraordinaryBonus: 5,
        dnfPenalty: 5,
        dqPenalty: 10,
        timePenalty: 2,
        goldWeight: 1,
        silverWeight: 0.5,
      },
      limits: { maxPerConstructor: 2, maxPerTeam: 2 },
      transfers: { perGp: 0, injuryExemption: false, wildcardsPerSeason: 0 },
      league: { minMembers: 2, maxMembers: 20 },
    });
    expect(result.success).toBe(true);
  });
});

describe("seasonRulesSchema — payloads malformados", () => {
  it("rechaza rulesVersion vacía", () => {
    const payload = { ...PROVISIONAL_SEASON_RULES, rulesVersion: "" };
    expect(firstMessage(payload)).toContain("versión de reglas");
  });

  it("rechaza opción económica inválida", () => {
    const payload = {
      ...PROVISIONAL_SEASON_RULES,
      economy: { ...PROVISIONAL_SEASON_RULES.economy, option: "F" },
    };
    expect(firstMessage(payload)).toContain("A, B, C o E");
  });

  it("rechaza B <= 0", () => {
    const payload = {
      ...PROVISIONAL_SEASON_RULES,
      economy: { ...PROVISIONAL_SEASON_RULES.economy, B: 0 },
    };
    expect(firstMessage(payload)).toContain("positivo");
  });

  it("rechaza t > 1", () => {
    const payload = {
      ...PROVISIONAL_SEASON_RULES,
      economy: { ...PROVISIONAL_SEASON_RULES.economy, t: 1.5 },
    };
    expect(firstMessage(payload)).toContain("no puede superar 1");
  });

  it("rechaza tabla de puntuación vacía", () => {
    const payload = {
      ...PROVISIONAL_SEASON_RULES,
      scoring: { ...PROVISIONAL_SEASON_RULES.scoring, mainRace: {} },
    };
    expect(firstMessage(payload)).toContain("al menos una posición");
  });

  it("rechaza claves no numéricas en la tabla", () => {
    const payload = {
      ...PROVISIONAL_SEASON_RULES,
      scoring: { ...PROVISIONAL_SEASON_RULES.scoring, q2: { pole: 12 } },
    };
    expect(firstMessage(payload)).toContain("enteros positivos");
  });

  it("rechaza penalización negativa", () => {
    const payload = {
      ...PROVISIONAL_SEASON_RULES,
      scoring: { ...PROVISIONAL_SEASON_RULES.scoring, dnfPenalty: -5 },
    };
    expect(firstMessage(payload)).toContain("no puede ser negativa");
  });

  it("rechaza silverWeight > 1", () => {
    const payload = {
      ...PROVISIONAL_SEASON_RULES,
      scoring: { ...PROVISIONAL_SEASON_RULES.scoring, silverWeight: 1.2 },
    };
    expect(firstMessage(payload)).toContain("no puede superar 1");
  });

  it("rechaza liga con máx < mín", () => {
    const payload = {
      ...PROVISIONAL_SEASON_RULES,
      league: { minMembers: 10, maxMembers: 5 },
    };
    expect(firstMessage(payload)).toContain("no puede ser menor que el mínimo");
  });

  it("rechaza liga con menos de 2 miembros", () => {
    const payload = {
      ...PROVISIONAL_SEASON_RULES,
      league: { minMembers: 1, maxMembers: 50 },
    };
    expect(firstMessage(payload)).toContain("al menos 2 miembros");
  });
});

describe("barrel (validation/index)", () => {
  it("re-exporta season-rules y seasons", () => {
    expect(validationBarrel.seasonRulesSchema).toBe(seasonRulesSchema);
    expect(validationBarrel.normalizedSeasonCalendarSchema).toBe(
      normalizedSeasonCalendarSchema,
    );
  });
});
