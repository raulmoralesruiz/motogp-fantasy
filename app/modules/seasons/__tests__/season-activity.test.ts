/**
 * Tests de `season-activity.ts` (impeccable P1-1): la selección pura de
 * «¿sobre qué temporada opera la consola del panel?» — regla 1-2-3 y
 * determinismo de empates.
 *
 * Módulo puro (sin I/O, patrón `economy`/`scoring`): la actividad contra
 * la BD la calcula `GpService.seasonActivity` (cubierta en
 * `gp-service.test.ts`); aquí solo se prueba la fórmula.
 */
import { describe, expect, it } from "vitest";

import {
  selectConsoleSeason,
  type SeasonActivity,
} from "../season-activity";

function activity(
  over: Partial<SeasonActivity> & { seasonId: string; name: string; year: number },
): SeasonActivity {
  return { totalGps: 0, openGps: 0, ...over };
}

describe("selectConsoleSeason", () => {
  it("elige la temporada con GPs sin cerrar aunque otra más reciente esté cerrada", () => {
    const older = activity({
      seasonId: "s2026",
      name: "Temporada 2026",
      year: 2026,
      totalGps: 5,
      openGps: 2,
    });
    const newer = activity({
      seasonId: "s2099",
      name: "Temporada 2099",
      year: 2099,
      totalGps: 3,
      openGps: 0,
    });
    expect(selectConsoleSeason([newer, older])).toEqual({
      kind: "open",
      activity: older,
    });
  });

  it("con varias temporadas con GPs sin cerrar, gana la de mayor año", () => {
    const a = activity({
      seasonId: "s2026",
      name: "Temporada 2026",
      year: 2026,
      totalGps: 2,
      openGps: 1,
    });
    const b = activity({
      seasonId: "s2027",
      name: "Temporada 2027",
      year: 2027,
      totalGps: 4,
      openGps: 3,
    });
    expect(selectConsoleSeason([a, b])).toEqual({ kind: "open", activity: b });
  });

  it("empate de años entre temporadas abiertas: gana la primera del conjunto (orden determinista de la BD)", () => {
    const a = activity({
      seasonId: "sA",
      name: "Temporada A",
      year: 2026,
      totalGps: 1,
      openGps: 1,
    });
    const b = activity({
      seasonId: "sB",
      name: "Temporada B",
      year: 2026,
      totalGps: 1,
      openGps: 1,
    });
    expect(selectConsoleSeason([a, b]).kind).toBe("open");
    expect(
      (selectConsoleSeason([a, b]) as { activity: SeasonActivity }).activity
        .seasonId,
    ).toBe("sA");
  });

  it("sin GPs sin cerrar pero con temporadas que tienen GPs: la más reciente con GPs (cerrada)", () => {
    const older = activity({
      seasonId: "s2025",
      name: "Temporada 2025",
      year: 2025,
      totalGps: 12,
      openGps: 0,
    });
    const newer = activity({
      seasonId: "s2026",
      name: "Temporada 2026",
      year: 2026,
      totalGps: 12,
      openGps: 0,
    });
    const empty = activity({
      seasonId: "s2105",
      name: "E2E 2105",
      year: 2105,
      totalGps: 0,
      openGps: 0,
    });
    expect(selectConsoleSeason([empty, newer, older])).toEqual({
      kind: "closed",
      activity: newer,
    });
  });

  it("temporada sin GPs nunca es candidata (ni abierta ni cerrada)", () => {
    const empty2105 = activity({
      seasonId: "s2105",
      name: "E2E 2105",
      year: 2105,
      totalGps: 0,
    });
    const empty2099 = activity({
      seasonId: "s2099",
      name: "E2E 2099",
      year: 2099,
      totalGps: 0,
    });
    expect(selectConsoleSeason([empty2105, empty2099])).toEqual({
      kind: "empty",
    });
  });

  it("sin temporadas: vacío", () => {
    expect(selectConsoleSeason([])).toEqual({ kind: "empty" });
  });
});
