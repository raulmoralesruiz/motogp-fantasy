/**
 * Reglas PROVISIONAL de temporada — T-18.
 *
 * Valores de partida (AGENTS.md §1.3) tomados de `docs/product/economy.md`
 * §4, `docs/product/scoring.md` y `docs/product/game-rules.md`. Se calibran
 * en las tareas `D-xx` del backlog antes del MVP.
 *
 * En producción estos valores viven en `season_rules` (JSONB versionado, una
 * fila por temporada y versión); aquí viven como defaults tipados para tests,
 * scripts y la Fase 0. Validados contra `seasonRulesSchema`.
 */

import { seasonRulesSchema, type SeasonRules } from "../validation/season-rules.js";

export const PROVISIONAL_SEASON_RULES: SeasonRules = {
  rulesVersion: "provisional-v1",
  economy: {
    option: "E",
    B: 100,
    t: 0.25,
    cmax: 8,
  },
  pricing: {
    pmaxRider: 60,
    pmaxGroup: 30,
  },
  scoring: {
    // scoring.md §2.1 (Q2): 1:12 · 2–3:8 · 4–6:5 · 7–12:3 · 13–20:1
    q2: {
      "1": 12,
      "2": 8,
      "3": 8,
      "4": 5,
      "5": 5,
      "6": 5,
      "7": 3,
      "8": 3,
      "9": 3,
      "10": 3,
      "11": 3,
      "12": 3,
      "13": 1,
      "14": 1,
      "15": 1,
      "16": 1,
      "17": 1,
      "18": 1,
      "19": 1,
      "20": 1,
    },
    // scoring.md §2.2 (sprint): 1:12 · 2:9 · 3:7 · 4:6 · 5:5 · 6:4 · 7:3 · 8:2 · 9:1
    sprint: {
      "1": 12,
      "2": 9,
      "3": 7,
      "4": 6,
      "5": 5,
      "6": 4,
      "7": 3,
      "8": 2,
      "9": 1,
    },
    // scoring.md §2.3 (carrera principal): 1:25 … 15:1
    mainRace: {
      "1": 25,
      "2": 20,
      "3": 16,
      "4": 13,
      "5": 11,
      "6": 10,
      "7": 9,
      "8": 8,
      "9": 7,
      "10": 6,
      "11": 5,
      "12": 4,
      "13": 3,
      "14": 2,
      "15": 1,
    },
    // scoring.md §2.4 (bonos)
    winnerBonus: 5,
    fastestLapBonus: 3,
    poleBonus: 2,
    positionsGainedBonus: 1,
    positionsGainedMax: 3,
    extraordinaryBonus: 5,
    // scoring.md §2.5 (penalizaciones)
    dnfPenalty: 5,
    dqPenalty: 10,
    timePenalty: 2,
    // scoring.md §4 (pesos)
    goldWeight: 1.0,
    silverWeight: 0.5,
  },
  // game-rules.md (límites PROVISIONAL, también usados en la simulación)
  limits: {
    maxPerConstructor: 2,
    maxPerTeam: 2,
  },
  // game-rules.md (transfers PROVISIONAL: 2 cambios + exención + 1 wildcard)
  transfers: {
    perGp: 2,
    injuryExemption: true,
    wildcardsPerSeason: 1,
  },
  // leagues.md (liga PROVISIONAL: 2–50 miembros)
  league: {
    minMembers: 2,
    maxMembers: 50,
  },
};

/**
 * Comprueba que los defaults provisionales siguen siendo válidos contra el
 * esquema (falla en tiempo de ejecución si se desincronizan).
 */
export function assertProvisionalRulesValid(): void {
  const result = seasonRulesSchema.safeParse(PROVISIONAL_SEASON_RULES);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`PROVISIONAL_SEASON_RULES no pasa seasonRulesSchema: ${issues}`);
  }
}
