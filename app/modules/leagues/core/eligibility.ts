/**
 * Elegibilidad temporal de una membresía — FÓRMULAS PURAS (sin I/O).
 *
 * US-30 (leagues.md §7): un miembro no hereda puntos de GPs anteriores a
 * su entrada. El corte es el inicio efectivo del GP (`lockoutAt`, o `date`
 * si no hay lockout); entrar exactamente en el cierre ya no da acceso.
 */
export interface LeagueGpWindow {
  date: Date;
  lockoutAt: Date | null;
}

/** Un GP cuenta para la membresía solo si su inicio efectivo es posterior a la entrada. */
export function isMemberEligibleForGp(
  joinedAt: Date,
  gp: LeagueGpWindow,
): boolean {
  const startsAt = gp.lockoutAt ?? gp.date;
  return startsAt.getTime() > joinedAt.getTime();
}

/**
 * Corte común del ranking ajustado: la entrada más reciente. Sin miembros no
 * hay corte. El servicio decide si lo aplica (la opción está apagada por
 * defecto, D-10); esta función solo calcula el máximo.
 */
export function latestMembershipJoinedAt(
  joinedAt: readonly Date[],
): Date | null {
  if (joinedAt.length === 0) return null;
  let latest = joinedAt[0]!;
  for (const date of joinedAt.slice(1)) {
    if (date.getTime() > latest.getTime()) latest = date;
  }
  return latest;
}
