/**
 * Regla de visibilidad de ligas — FÓRMULA PURA (sin I/O).
 *
 * US-24 (leagues.md §9, ADR-0024):
 * - **Ligas públicas:** visibles para cualquiera (autenticado o no) —
 *   "visibles en el directorio; el ranking es público".
 * - **Ligas privadas:** solo accesibles por sus miembros activos — "no
 *   aparecen en el directorio público; solo accesibles con código/invitación".
 *   Un extraño (autenticado o no) que acceda por ID recibe NOT_FOUND idéntico
 *   al de una liga inexistente (no se revela la existencia — T-12 IDOR).
 *
 * La función es pura: recibe el tipo de liga y si el espectador es miembro
 * activo, y devuelve si puede verla. El servicio (I/O) resuelve la membresía
 * y consume esta regla; el router no la duplica (T-08: una sola fuente).
 *
 * El tipo se define localmente (sin I/O, check de pureza T-03): refleja el
 * enum `LeagueType` de la BD (compatible por estructura con el tipo de
 * Prisma, que es la misma unión de literales).
 */

/** Tipo de liga (reflejo del enum `LeagueType` de la BD). */
export type LeagueType = "private" | "public";

/**
 * ¿Puede el espectador ver la liga (detalle y ranking)?
 *
 * - `type = public` → sí, cualquiera (miembro activo o no, con o sin sesión).
 * - `type = private` → solo si es **miembro activo**.
 */
export function canViewLeague(
  league: { type: LeagueType },
  viewer: { isActiveMember: boolean },
): boolean {
  return league.type === "public" || viewer.isActiveMember;
}
