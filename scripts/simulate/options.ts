/**
 * Options — orquesta la simulación GP a GP para cada opción económica.
 *
 * Cronología por GP (los precios son EXÓGENOS: la misma serie para todas
 * las opciones; solo difiere la mecánica de presupuesto):
 *
 *   1. presupuesto(gp): GP1 = B; después, según la opción (módulo `economy`).
 *   2. El jugador compone su lineup a los precios congelados de gp
 *      (`buildLineup`, capa de población).
 *   3. coste = Σ precios de los 6 activos; sinUsar = presupuesto − coste.
 *   4. puntos = `lineupPoints` (módulo `scoring`) sobre los resultados reales.
 *   5. Valor de mercado del lineup a los precios NUEVOS (gp+1) → alimenta el
 *      presupuesto del siguiente GP (opción B).
 *
 * Simplificaciones documentadas en `docs/product/simulacion-2026.md`:
 *   - El lineup se reconstruye cada GP (no se modelan transfers/lockout).
 *   - Opción B: "valor del equipo" = valor del lineup a los precios nuevos
 *     (los publicados tras la carrera, i.e. los del GP siguiente).
 */
import type { Lineup } from "../../app/shared/types/index.js";
import {
  presupuesto,
  type BudgetContext,
  type BudgetOption,
  type BudgetParams,
} from "../../app/modules/economy/index.js";
import { lineupPoints } from "../../app/modules/scoring/index.js";
import type { Market } from "./dataset.js";
import { buildLineup, type Player } from "./population.js";

export interface PlayerGpRecord {
  gpIdx: number;
  /** Presupuesto disponible en este GP. */
  budget: number;
  lineup: Lineup;
  /** Coste del lineup a los precios de este GP. */
  cost: number;
  /** Dinero sin usar (presupuesto − coste). */
  sinUsar: number;
  /** Puntos de fantasy del lineup en este GP. */
  points: number;
  /** Valor de mercado del lineup a los precios de este GP. */
  marketValue: number;
}

export interface PlayerRecord {
  player: Player;
  byGp: PlayerGpRecord[];
  totalPoints: number;
  /** Presupuesto mínimo alcanzado en la temporada. */
  minBudget: number;
  /** Presupuesto del último GP. */
  finalBudget: number;
}

export interface OptionResult {
  option: BudgetOption;
  players: PlayerRecord[];
}

/** Valor de mercado de un lineup a los precios del GP `gpIdx`. */
export function valueOfLineup(lineup: Lineup, market: Market, gpIdx: number): number {
  let v = 0;
  for (const id of [...lineup.gold, ...lineup.silver]) {
    const r = market.riderById.get(id);
    if (r) v += r.price[gpIdx] ?? 0;
  }
  const ctor = market.ctorByName.get(lineup.constructor);
  if (ctor) v += ctor.price[gpIdx] ?? 0;
  const team = market.teamByName.get(lineup.team);
  if (team) v += team.price[gpIdx] ?? 0;
  return v;
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

/**
 * Simula la temporada completa para una opción económica.
 * Determinista: misma entrada → mismo resultado.
 */
export function runOption(
  option: BudgetOption,
  players: Player[],
  market: Market,
  params: BudgetParams,
): OptionResult {
  const nGps = market.nGps;
  const records: PlayerRecord[] = players.map((p) => ({
    player: p,
    byGp: [],
    totalPoints: 0,
    minBudget: Infinity,
    finalBudget: params.B,
  }));

  // Estado del GP anterior (para el presupuesto del siguiente).
  let prevSinUsar: number[] = [];
  let prevValue: number[] = []; // valor del lineup anterior a precios nuevos
  let prevPoints: number[] = [];

  for (let i = 0; i < nGps; i++) {
    // 1. Presupuesto de este GP.
    const budgets = records.map((_, pi) => {
      if (i === 0) return params.B;
      const ctx: BudgetContext = {
        sinUsarPrevio: prevSinUsar[pi] ?? 0,
        valorEquipo: prevValue[pi] ?? 0,
        puntosJugador: prevPoints[pi] ?? 0,
        mediaPuntos: avg(prevPoints),
      };
      return presupuesto(option, params, ctx);
    });

    // 2–4. Lineup, coste, puntos.
    const gpData = market.byGp[i];
    if (!gpData) throw new Error(`byGp[${i}] no disponible`);
    const newRecords: PlayerGpRecord[] = records.map((rec, pi) => {
      const budget = budgets[pi] ?? params.B;
      const built = buildLineup(rec.player, market, i, budget);
      const points = lineupPoints(
        built.lineup,
        gpData.riderPoints,
        gpData.ctorPoints,
        gpData.teamPoints,
      );
      return {
        gpIdx: i,
        budget,
        lineup: built.lineup,
        cost: built.cost,
        sinUsar: budget - built.cost,
        points,
        marketValue: built.cost,
      };
    });

    records.forEach((rec, pi) => {
      const g = newRecords[pi];
      if (!g) return;
      rec.byGp.push(g);
      rec.totalPoints += g.points;
      rec.minBudget = Math.min(rec.minBudget, g.budget);
      rec.finalBudget = g.budget;
    });

    // 5. Estado para el siguiente GP: valor del lineup a los precios nuevos.
    const nextPriceIdx = Math.min(i + 1, nGps - 1);
    prevSinUsar = newRecords.map((g) => g.sinUsar);
    prevValue = newRecords.map((g) => valueOfLineup(g.lineup, market, nextPriceIdx));
    prevPoints = newRecords.map((g) => g.points);
  }

  return { option, players: records };
}
