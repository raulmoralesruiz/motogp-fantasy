/**
 * Ranking y desempates de liga — FÓRMULA PURA (sin I/O).
 *
 * US-21 (leagues.md §8): orden de los miembros de una liga.
 * - **Por GP:** quién sumó más puntos en ese GP (entre miembros activos).
 * - **General (temporada):** suma de puntos de todos los GPs en los que el
 *   miembro estuvo activo.
 * - **Desempates** (en orden, cuando los puntos empatan):
 *   1. Más GPs ganados (1º por puntos, sin empate).
 *   2. Mejor puntuación en el último GP.
 *   3. Menor coste total de lineups (premia eficiencia).
 *   4. Antigüedad en la liga (quien se unió antes).
 *
 * El valor de cada desempate lo aporta el servicio (I/O: scores, lineups,
 * costes, membresía); esta función solo ordena. Sin I/O: recibe datos y
 * devuelve el orden (mismo contrato que `economy`/`scoring`, AGENTS.md §3).
 */

/** Entrada de un miembro al orden de una liga (US-21). */
export interface RankingInput {
  userId: string;
  /** Puntos: por GP (ese GP) o general (suma de la temporada). Clave principal. */
  points: number;
  /** Nº de GPs ganados (1º por puntos, sin empate). Desempate 1 (desc). */
  gpsWon: number;
  /** Puntos en el último GP de la temporada. Desempate 2 (desc). */
  lastGpScore: number;
  /** Coste total de los lineups de la temporada. Desempate 3 (asc: menor gana). */
  totalCost: number;
  /** Cuándo se unió a la liga. Desempate 4 (asc: quien se unió antes gana). */
  joinedAt: Date;
}

/**
 * Ordena los miembros de una liga (leagues.md §8): puntos (desc); en empate,
 * más GPs ganados (desc) → mejor último GP (desc) → menor coste total (asc) →
 * antigüedad (asc). Determinista: dos entradas idénticas mantienen su orden
 * relativo (el comparador devuelve 0 solo si los 5 criterios son iguales).
 */
export function sortRanking(inputs: readonly RankingInput[]): RankingInput[] {
  return [...inputs].sort((a, b) =>
    b.points - a.points ||
    b.gpsWon - a.gpsWon ||
    b.lastGpScore - a.lastGpScore ||
    a.totalCost - b.totalCost ||
    a.joinedAt.getTime() - b.joinedAt.getTime(),
  );
}
