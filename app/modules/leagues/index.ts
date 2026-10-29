/**
 * Módulo `leagues` — ligas, miembros, invitaciones y rankings.
 *
 * Fase 0 (T-03): la estructura existe.
 *
 * US-15 (dashboard, hecho): `LeagueService.myRankings` — ligas activas del
 * usuario + sus posiciones en `rankings` (por GP y general). Los rankings son
 * derivados (US-21): la vista es `null` (vacío elegante) hasta que no hay
 * filas y se llena sola cuando US-21 los publica.
 *
 * Responsabilidad:
 * - Ligas privadas (código de alta entropia, revocable) y públicas (directorio).
 * - Membresía (unique `(league, user)`) con roles admin/miembro y permisos.
 * - Multi-liga: un usuario juega en varias ligas con el mismo lineup y los
 *   mismos puntos por GP (scores por `(user, gp)`, rankings por `(league, user, gp)`).
 * - Rankings por GP y general con desempates definidos.
 *
 * US-21 (hecho, ADR-0022): `core/ranking.ts` (FÓRMULA PURA de desempates,
 * leagues.md §8) + `LeagueService.recalculateRankings` (calcula y publica los
 * rankings por GP y general a partir de `scores`, versionados por
 * `results_version`).
 */
export * from "./core";
export * from "./league-membership";
export * from "./league-service";
