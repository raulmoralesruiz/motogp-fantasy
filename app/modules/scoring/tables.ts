/**
 * Tablas de puntuación — versión `scoring-v1` (PROVISIONAL).
 *
 * Fuente de verdad: `docs/product/scoring.md`. Los valores son PROVISIONAL y
 * versionados por temporada; nunca se hardcodean como constantes mágicas en
 * otros módulos (viven aquí y, en producción, en `season_rules`).
 *
 * Módulo PURO: sin I/O.
 */

export const SCORING_VERSION = "scoring-v1" as const;

/** Puntos por posición en la carrera principal (scoring.md §2.3). */
export const MAIN_RACE_POINTS: Record<number, number> = {
  1: 25,
  2: 20,
  3: 16,
  4: 13,
  5: 11,
  6: 10,
  7: 9,
  8: 8,
  9: 7,
  10: 6,
  11: 5,
  12: 4,
  13: 3,
  14: 2,
  15: 1,
};

/** Bono por ganar la carrera principal (scoring.md §2.4). */
export const WINNER_BONUS = 5;

/** Penalización por DNF en la carrera principal (scoring.md §2.5). */
export const DNF_PENALTY = 5;

/** Puntos por posición en la carrera principal (0 si 16+ / no clasifica). */
export function mainRacePositionPoints(position: number): number {
  return MAIN_RACE_POINTS[position] ?? 0;
}
