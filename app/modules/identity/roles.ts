/**
 * Decisiones de autorización por roles (T-08, security.md §1.5).
 *
 * Funciones PURAS: reciben los roles del usuario y devuelven la decisión.
 * Las decisiones por recurso (lineups, ligas) se añaden con cada módulo
 * que las necesite: cada router revalida permisos server-side
 * (AGENTS.md §8, CA de T-08).
 */
import type { RoleName } from "@prisma/client";

/**
 * Acceso al panel de administración global (security.md §1.5):
 * solo `global_admin`. El rol `user` lo tienen todos los registrados
 * y no otorga acceso.
 */
export function canAccessGlobalAdmin(roles: readonly RoleName[]): boolean {
  return roles.includes("global_admin");
}
