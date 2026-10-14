/**
 * Metrics — métricas de igualdad, recuperación, divergencia y diversidad.
 *
 * Definiciones (ver también `docs/architecture/testing.md` y la puerta T-15):
 *
 * - **Gini del presupuesto**: Gini de `budget(gp)` entre los 40 jugadores,
 *   por GP. Mide la desigualdad del recurso operativo (lo que cada jugador
 *   puede gastar en ese GP). Objetivo T-15: < 0.05.
 * - **Recuperación (recovery)**: para cada jugador, media de los
 *   presupuestos de los 3 últimos GPs / B. `recoveryWorst` = el peor
 *   jugador; `recoveryMalArranque` = media de los casos "mal arranque".
 *   Objetivo T-15: > 0.95.
 * - **Divergencia P5–P6**: |presupuesto(S1) − presupuesto(S2)|. Mide cuánto
 *   amplifica la opción las diferencias de decisión entre dos jugadores con
 *   el mismo inicio.
 * - **Espiral de la muerte**: jugadores cuyo presupuesto mínimo cae por
 *   debajo de 0.9·B (no recuperan el nivel base).
 * - **Diversidad**: % medio de lineups únicos por GP (objetivo > 70%).
 * - **Concentración**: % de lineups con ≥2 pilotos del mismo constructor
 *   (límite de diseño: máx 2 por constructor).
 */
import type { Lineup } from "../../app/shared/types/index.js";
import type { BudgetOption, BudgetParams } from "../../app/modules/economy/index.js";
import type { Market } from "./dataset.js";
import type { OptionResult, PlayerRecord } from "./options.js";

export interface OptionMetrics {
  option: BudgetOption;
  /** Gini del presupuesto por GP (índice 0-based). */
  giniByGp: number[];
  giniFinal: number;
  giniAvg: number;
  /** Peor recuperación (jugador más desfavorecido). */
  recoveryWorst: number;
  /** Jugador con peor recuperación. */
  recoveryWorstPlayer: string;
  /** Recuperación media de los casos "mal arranque". */
  recoveryMalArranque: number;
  /** |presupuesto final S1 − S2|. */
  p5p6FinalDivergence: number;
  /** Máximo de |presupuesto S1 − S2| a lo largo de la temporada. */
  p5p6MaxDivergence: number;
  /** Jugadores con presupuesto mínimo < 0.9·B. */
  deathSpiralPlayers: string[];
  /** Jugadores con presupuesto final < 0.9·B. */
  finalBelowBase: string[];
  /** % medio de lineups únicos por GP. */
  diversityAvg: number;
  /** % de lineups con ≥2 pilotos del mismo constructor. */
  concentrationPct: number;
  /** Puntos totales del campo (contexto). */
  totalPoints: number;
  /** Puntos medios por jugador (contexto). */
  avgPoints: number;
  /** Presupuesto medio por GP (contexto). */
  avgBudgetByGp: number[];
  /** Presupuesto mínimo del campo por GP (contexto). */
  minBudgetByGp: number[];
}

/**
 * Coeficiente de Gini para valores no negativos.
 * 0 = igualdad perfecta, 1 = toda la masa en un solo jugador.
 */
export function gini(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 0;
  const sum = sorted.reduce((s, v) => s + v, 0);
  if (sum === 0) return 0;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (i + 1) * (sorted[i] ?? 0);
  return (2 * cum) / (n * sum) - (n + 1) / n;
}

function lineupKey(l: Lineup): string {
  return [[...l.gold, ...l.silver].sort().join(","), l.constructor, l.team].join("|");
}

export function computeMetrics(
  option: BudgetOption,
  result: OptionResult,
  market: Market,
  params: BudgetParams,
): OptionMetrics {
  const nGps = market.nGps;
  const nPlayers = result.players.length;
  const B = params.B;

  // --- Gini del presupuesto por GP -----------------------------------------
  const giniByGp: number[] = [];
  const avgBudgetByGp: number[] = [];
  const minBudgetByGp: number[] = [];
  for (let i = 0; i < nGps; i++) {
    const budgets = result.players.map((p) => p.byGp[i]?.budget ?? 0);
    giniByGp.push(gini(budgets));
    avgBudgetByGp.push(budgets.reduce((s, v) => s + v, 0) / nPlayers);
    minBudgetByGp.push(Math.min(...budgets));
  }
  const giniFinal = giniByGp[nGps - 1] ?? 0;
  const giniAvg = giniByGp.reduce((s, v) => s + v, 0) / nGps;

  // --- Recuperación ---------------------------------------------------------
  const last3 = Math.min(3, nGps);
  const recoveryOf = (rec: PlayerRecord): number => {
    let s = 0;
    for (let i = nGps - last3; i < nGps; i++) s += rec.byGp[i]?.budget ?? 0;
    return s / last3 / B;
  };
  let recoveryWorst = Infinity;
  let recoveryWorstPlayer = "";
  for (const rec of result.players) {
    const r = recoveryOf(rec);
    if (r < recoveryWorst) {
      recoveryWorst = r;
      recoveryWorstPlayer = rec.player.id;
    }
  }
  const malArranque = result.players.filter((p) => p.player.archetype === "malArranque");
  const recoveryMalArranque = malArranque.length
    ? malArranque.reduce((s, p) => s + recoveryOf(p), 0) / malArranque.length
    : NaN;

  // --- Divergencia P5–P6 ----------------------------------------------------
  const s1 = result.players.find((p) => p.player.id === "S1");
  const s2 = result.players.find((p) => p.player.id === "S2");
  let p5p6FinalDivergence = 0;
  let p5p6MaxDivergence = 0;
  if (s1 && s2) {
    p5p6FinalDivergence = Math.abs(s1.finalBudget - s2.finalBudget);
    for (let i = 0; i < nGps; i++) {
      p5p6MaxDivergence = Math.max(
        p5p6MaxDivergence,
        Math.abs((s1.byGp[i]?.budget ?? 0) - (s2.byGp[i]?.budget ?? 0)),
      );
    }
  }

  // --- Espiral de la muerte -------------------------------------------------
  const deathSpiralPlayers = result.players
    .filter((p) => p.minBudget < 0.9 * B)
    .map((p) => p.player.id);
  const finalBelowBase = result.players
    .filter((p) => p.finalBudget < 0.9 * B)
    .map((p) => p.player.id);

  // --- Diversidad y concentración -------------------------------------------
  let diversitySum = 0;
  let concentrationHits = 0;
  let totalLineups = 0;
  for (let i = 0; i < nGps; i++) {
    const keys = new Set<string>();
    for (const rec of result.players) {
      const l = rec.byGp[i]?.lineup;
      if (!l) continue;
      keys.add(lineupKey(l));
      const ctorCount = new Map<string, number>();
      for (const id of [...l.gold, ...l.silver]) {
        const r = market.riderById.get(id);
        if (r) ctorCount.set(r.constructor, (ctorCount.get(r.constructor) ?? 0) + 1);
      }
      if ([...ctorCount.values()].some((c) => c >= 2)) concentrationHits++;
      totalLineups++;
    }
    diversitySum += keys.size / nPlayers;
  }
  const diversityAvg = diversitySum / nGps;
  const concentrationPct = totalLineups ? concentrationHits / totalLineups : 0;

  // --- Puntos (contexto) ------------------------------------------------------
  const totalPoints = result.players.reduce((s, p) => s + p.totalPoints, 0);
  const avgPoints = totalPoints / nPlayers;

  return {
    option,
    giniByGp,
    giniFinal,
    giniAvg,
    recoveryWorst,
    recoveryWorstPlayer,
    recoveryMalArranque,
    p5p6FinalDivergence,
    p5p6MaxDivergence,
    deathSpiralPlayers,
    finalBelowBase,
    diversityAvg,
    concentrationPct,
    totalPoints,
    avgPoints,
    avgBudgetByGp,
    minBudgetByGp,
  };
}
