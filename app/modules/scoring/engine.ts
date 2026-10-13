/**
 * Motor de puntuación — FÓRMULAS PURAS (scoring-v1).
 *
 * Convierte resultados de carrera principal en puntos de fantasy y calcula
 * los puntos de un lineup. Sin I/O: solo recibe datos y devuelve resultados.
 *
 * Fuente de verdad: `docs/product/scoring.md`.
 */

import type { GpStatus, Lineup } from "../../shared/types/index.js";
import { DNF_PENALTY, WINNER_BONUS, mainRacePositionPoints } from "./tables.js";

/**
 * Puntos de un piloto en la carrera principal de un GP.
 * - FINISHED: puntos por posición (+ bono de ganador si 1º).
 * - DNF: 0 por posición − penalización (−5).
 * - ABSENT (non-starter): 0, sin penalización.
 */
export function riderMainPoints(status: GpStatus, position: number | null): number {
  if (status === "FINISHED") {
    const pos = position ?? 0;
    let pts = mainRacePositionPoints(pos);
    if (pos === 1) pts += WINNER_BONUS;
    return pts;
  }
  if (status === "DNF") {
    return -DNF_PENALTY;
  }
  return 0;
}

/** Media de los 2 mejores valores de un grupo (top-2). Vacío → 0. */
export function topTwoAverage(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => b - a);
  const top = sorted.slice(0, 2);
  return top.reduce((s, v) => s + v, 0) / top.length;
}

export interface GpRiderPoints {
  riderId: string;
  points: number;
}

/**
 * Puntos de cada grupo (constructor o equipo) para un GP: media de los 2
 * mejores pilotos del grupo (campo completo). `groupOf` mapea riderId → grupo.
 */
export function groupTopTwoAverage(
  riderPoints: GpRiderPoints[],
  groupOf: (riderId: string) => string,
): Map<string, number> {
  const byGroup = new Map<string, number[]>();
  for (const { riderId, points } of riderPoints) {
    const g = groupOf(riderId);
    const arr = byGroup.get(g) ?? [];
    arr.push(points);
    byGroup.set(g, arr);
  }
  const out = new Map<string, number>();
  for (const [g, pts] of byGroup) out.set(g, topTwoAverage(pts));
  return out;
}

/**
 * Puntos totales de un lineup (scoring.md §4):
 *   oro 100% + plata 50% + constructor + equipo.
 */
export function lineupPoints(
  lineup: Lineup,
  riderPoints: Map<string, number>,
  ctorPoints: Map<string, number>,
  teamPoints: Map<string, number>,
): number {
  const get = (id: string): number => riderPoints.get(id) ?? 0;
  const gold = lineup.gold.reduce((s, id) => s + get(id), 0);
  const silver = lineup.silver.reduce((s, id) => s + 0.5 * get(id), 0);
  const ctor = ctorPoints.get(lineup.constructor) ?? 0;
  const team = teamPoints.get(lineup.team) ?? 0;
  return gold + silver + ctor + team;
}
