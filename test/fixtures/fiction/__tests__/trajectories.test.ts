/**
 * Golden — dataset ficticio (economy.md §7): trayectorias de presupuesto.
 *
 * Verifica que la simulación (lineups fijos P1–P6, precios exógenos §7.1)
 * reproduce EXACTAMENTE las trayectorias documentadas:
 *
 * - Opción B/OFF (§7.3): cap = valor de mercado del lineup + sin usar.
 * - Opción E/REC (§7.4): presupuesto = B + min(t · sin_usar, cmax).
 *
 * Los valores se comparan redondeados a 2 decimales (la precisión con la
 * que los presenta el documento). Parámetros: B = base del dataset (100),
 * t/cmax = PROVISIONAL_SEASON_RULES (0.25 / 8). Cambiar una regla exige
 * actualizar este golden de forma explícita y revisada (AGENTS.md §7).
 */
import { PROVISIONAL_SEASON_RULES } from "../../../../app/shared/config/season-rules.js";
import type { BudgetParams } from "../../../../app/modules/economy/index.js";
import { describe, expect, it } from "vitest";
import { loadFictionDataset } from "../index.js";
import { simulateFiction } from "../simulate.js";

const round2 = (x: number): number => Math.round(x * 100) / 100;

const ds = loadFictionDataset();
const econ = PROVISIONAL_SEASON_RULES.economy;
const params: BudgetParams = { B: ds.baseBudget, t: econ.t, cmax: econ.cmax };

/** Serie GP1..GPn de un campo (presupuesto o coste) por jugador. */
const series = (
  option: "B" | "E",
  pick: (g: { budget: number; cost: number }) => number,
) =>
  Object.fromEntries(
    simulateFiction(ds, option, params).players.map((p) => [
      p.playerId,
      p.byGp.map((g) => round2(pick(g))),
    ]),
  );

describe("Golden · Dataset ficticio economy.md §7", () => {
  it("usa los parámetros PROVISIONAL del dataset (B=100, t=0.25, cmax=8)", () => {
    expect(ds.baseBudget).toBe(econ.B);
    expect(params).toEqual({ B: 100, t: 0.25, cmax: 8 });
  });

  it("OPCIÓN B/OFF — cap = valor del equipo + sin usar (exacto §7.3)", () => {
    expect(series("B", (g) => g.budget)).toEqual({
      "player-p1": [100, 101, 87, 88, 88, 89],
      "player-p2": [100, 101, 103, 105, 107, 107],
      "player-p3": [100, 101, 104, 109, 113, 116],
      "player-p4": [100, 99, 84, 83, 82, 83],
      "player-p5": [100, 100, 87, 87, 88, 89],
      "player-p6": [100, 99, 101, 101, 103, 103],
    });
  });

  it("OPCIÓN E/REC — base + carry limitado (exacto §7.4)", () => {
    expect(series("E", (g) => g.budget)).toEqual({
      "player-p1": [100, 101.5, 101.63, 105.16, 105.79, 105.95],
      "player-p2": [100, 107, 108, 108, 107.75, 107.19],
      "player-p3": [100, 108, 108, 108, 108, 108],
      "player-p4": [100, 108, 108, 108, 108, 108],
      "player-p5": [100, 107.75, 108, 108, 108, 108],
      "player-p6": [100, 107.75, 108, 108, 108, 108],
    });
  });

  it("costes de los lineups fijos a los precios exógenos (puente precios→presupuesto)", () => {
    expect(series("E", (g) => g.cost)).toEqual({
      "player-p1": [94, 95, 81, 82, 82, 83],
      "player-p2": [72, 73, 75, 77, 79, 79],
      "player-p3": [44, 45, 48, 53, 57, 60],
      "player-p4": [61, 60, 45, 44, 43, 44],
      "player-p5": [69, 69, 56, 56, 57, 58],
      "player-p6": [69, 68, 70, 70, 72, 72],
    });
  });

  it("puntos totales idénticos en B y E (lineups fijos; §7.5)", () => {
    const b = simulateFiction(ds, "B", params);
    const e = simulateFiction(ds, "E", params);
    for (const pb of b.players) {
      const pe = e.players.find((p) => p.playerId === pb.playerId);
      if (!pe) throw new Error(`Falta ${pb.playerId} en la opción E`);
      expect(pe.totalPoints).toBe(pb.totalPoints);
    }
  });
});
