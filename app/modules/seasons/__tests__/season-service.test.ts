/**
 * Tests de `SeasonService` (US-04, T-24): la revalidación server-side de
 * las reglas (`validateRules`) — el payload debe pasar `seasonRulesSchema`
 * completo antes de cualquier escritura (AGENTS.md §8).
 *
 * `prisma` se inyecta (DI) como objeto falso: en estos tests la validación
 * falla ANTES de tocar BD, así que se aserta que no se consultó nada.
 */
import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import { PROVISIONAL_SEASON_RULES } from "@/shared/config/season-rules";
import type { SeasonRules } from "@/shared/validation/season-rules";

import { SeasonService, type AuditMeta } from "../season-service";

const meta: AuditMeta = { actorId: "admin-1", ip: "127.0.0.1" };

/** Reglas con una opción económica inválida (el esquema exige A/B/C/E). */
const invalidRules = {
  ...PROVISIONAL_SEASON_RULES,
  economy: { ...PROVISIONAL_SEASON_RULES.economy, option: "Z" },
} as unknown as SeasonRules;

describe("SeasonService — validación de reglas (T-24)", () => {
  it("addRulesVersion: reglas inválidas → BAD_REQUEST sin tocar BD", async () => {
    const season = { findUnique: vi.fn() };
    const prisma = { season } as unknown as PrismaClient;
    const service = new SeasonService({ prisma });

    await expect(
      service.addRulesVersion({ seasonId: "s1", rules: invalidRules }, meta),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/Reglas de temporada inválidas/),
    });
    expect(season.findUnique).not.toHaveBeenCalled();
  });

  it("createSeasonWithRules: reglas inválidas → BAD_REQUEST sin transacción", async () => {
    const $transaction = vi.fn();
    const prisma = { $transaction } as unknown as PrismaClient;
    const service = new SeasonService({ prisma });

    await expect(
      service.createSeasonWithRules(
        { name: "Temporada 2026", year: 2026, rules: invalidRules },
        meta,
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/Reglas de temporada inválidas/),
    });
    expect($transaction).not.toHaveBeenCalled();
  });
});
