/**
 * Simulación del dataset ficticio (economy.md §7) — núcleo PURO (sin I/O).
 *
 * Lineups FIJOS por jugador (sin transfers/lockout) para aislar el efecto
 * económico: la única diferencia entre opciones es la mecánica de
 * presupuesto.
 *
 * - Opción B (OFF): cap = valor de mercado del lineup a los precios nuevos +
 *   dinero sin usar del GP anterior (ratchet).
 * - Opción E (REC): presupuesto = B + min(t × sin_usar_previo, cmax).
 *
 * Los precios son EXÓGENOS: la serie literal de §7.1 (el dataset ficticio
 * no aplica la fórmula de precios; la narrativa la da directamente).
 */
import { presupuesto, type BudgetParams } from "../../../app/modules/economy/index.js";
import {
  groupTopTwoAverage,
  lineupPoints,
  riderMainPoints,
} from "../../../app/modules/scoring/index.js";
import type { Lineup } from "../../../app/shared/types/index.js";
import type { FictionDataset } from "./index.js";

export interface FictionGpRecord {
  gpIdx: number;
  /** Presupuesto disponible en este GP. */
  budget: number;
  /** Coste del lineup fijo a los precios de este GP. */
  cost: number;
  /** Dinero sin usar (presupuesto − coste). */
  sinUsar: number;
  /** Puntos de fantasy del lineup en este GP. */
  points: number;
}

export interface FictionPlayerRecord {
  playerId: string;
  playerName: string;
  byGp: FictionGpRecord[];
  totalPoints: number;
}

export interface FictionOptionResult {
  option: "B" | "E";
  players: FictionPlayerRecord[];
}

/**
 * Simula la temporada completa del dataset ficticio para una opción.
 * Determinista: misma entrada → mismo resultado.
 */
export function simulateFiction(
  ds: FictionDataset,
  option: "B" | "E",
  params: BudgetParams,
): FictionOptionResult {
  const riderById = new Map(ds.riders.map((r) => [r.id, r]));
  const ctorById = new Map(ds.constructors.map((c) => [c.id, c]));
  const teamById = new Map(ds.teams.map((t) => [t.id, t]));
  const ctorOfRider = new Map(ds.riders.map((r) => [r.id, r.constructor]));
  const teamOfRider = new Map(ds.riders.map((r) => [r.id, r.team]));

  const priceOf = (assetId: string, gpIdx: number): number => {
    const asset =
      riderById.get(assetId) ?? ctorById.get(assetId) ?? teamById.get(assetId);
    if (!asset) throw new Error(`Activo desconocido en el dataset ficticio: ${assetId}`);
    return asset.prices[gpIdx] ?? 0;
  };

  const lineupCost = (lineup: Lineup, gpIdx: number): number =>
    [...lineup.gold, ...lineup.silver].reduce((sum, id) => sum + priceOf(id, gpIdx), 0) +
    priceOf(lineup.constructor, gpIdx) +
    priceOf(lineup.team, gpIdx);

  const gpPoints = (gpIdx: number) => {
    const gp = ds.gps[gpIdx];
    if (!gp) throw new Error(`GP ${gpIdx} no disponible`);
    const riderPoints = new Map<string, number>();
    for (const res of gp.results) {
      riderPoints.set(res.riderId, riderMainPoints(res.status, res.position));
    }
    const entries = [...riderPoints.entries()].map(([riderId, points]) => ({
      riderId,
      points,
    }));
    return {
      riderPoints,
      ctorPoints: groupTopTwoAverage(entries, (id) => ctorOfRider.get(id) ?? ""),
      teamPoints: groupTopTwoAverage(entries, (id) => teamOfRider.get(id) ?? ""),
    };
  };

  const players: FictionPlayerRecord[] = [];
  for (const player of ds.players) {
    const byGp: FictionGpRecord[] = [];
    let totalPoints = 0;
    let prevSinUsar = 0;
    // Valor del lineup a los precios nuevos (opción B): se evalúa en el GP
    // siguiente, como en la cronología real (runOption).
    let prevValue = 0;
    for (let i = 0; i < ds.nGps; i++) {
      const budget =
        i === 0
          ? params.B
          : presupuesto(option, params, {
              sinUsarPrevio: prevSinUsar,
              valorEquipo: prevValue,
              puntosJugador: 0,
              mediaPuntos: 0,
            });
      const cost = lineupCost(player.lineup, i);
      const { riderPoints, ctorPoints, teamPoints } = gpPoints(i);
      const points = lineupPoints(player.lineup, riderPoints, ctorPoints, teamPoints);
      byGp.push({ gpIdx: i, budget, cost, sinUsar: budget - cost, points });
      totalPoints += points;
      prevSinUsar = budget - cost;
      prevValue = lineupCost(player.lineup, Math.min(i + 1, ds.nGps - 1));
    }
    players.push({ playerId: player.id, playerName: player.name, byGp, totalPoints });
  }

  return { option, players };
}
