/**
 * Contabilidad de cambios — FÓRMULAS PURAS (sin I/O, ADR-0017).
 *
 * Los contadores se derivan del historial (`lineup_changes`): el historial
 * es la única fuente de verdad (no hay tabla de estado). Aquí viven las
 * fórmulas de capacidad que la capa de servicio aplica sobre esos
 * contadores, en la transacción del cambio.
 */

/**
 * Cambios restantes del GP: `perGp − usados` (con suelo 0) + exenciones sin
 * usar. La exención por lesión solo se consume al agotar los cambios por GP
 * (el servicio decide el consumo en la transacción y fija `usedAt`).
 */
export function remainingChanges(
  used: number,
  unusedExemptions: number,
  perGp: number,
): number {
  return Math.max(0, perGp - used) + unusedExemptions;
}

/** ¿Se puede usar el wildcard? (1 por temporada; no consume cambios por GP). */
export function canUseWildcard(
  wildcardsUsed: number,
  wildcardsPerSeason: number,
): boolean {
  return wildcardsUsed < wildcardsPerSeason;
}
