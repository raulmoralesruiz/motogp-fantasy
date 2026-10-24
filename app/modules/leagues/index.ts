/**
 * Módulo `leagues` — ligas, miembros, invitaciones y rankings.
 *
 * Fase 0 (T-03): la estructura existe.
 *
 * US-15 (dashboard, hecho): `LeagueService.myRankings` — ligas activas del
 * usuario + sus posiciones en `rankings` (por GP y general). Los rankings
 * son derivados (US-19/US-21 pendientes): hasta entonces la vista es
 * `null` (vacío elegante) y se llena sola cuando lleguen los datos.
 *
 * Responsabilidad:
 * - Ligas privadas (código de alta entropia, revocable) y públicas (directorio).
 * - Membresía (unique `(league, user)`) con roles admin/miembro y permisos.
 * - Multi-liga: un usuario juega en varias ligas con el mismo lineup y los
 *   mismos puntos por GP (scores por `(user, gp)`, rankings por `(league, user, gp)`).
 * - Rankings por GP y general con desempates definidos.
 */
export * from "./league-service";
