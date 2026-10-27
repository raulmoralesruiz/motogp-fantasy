/**
 * Permisos de liga (admin/miembro) — FÓRMULA PURA (sin I/O).
 *
 * US-26 (leagues.md §5, ADR-0026):
 * - **Solo el admin** gestiona la liga: expulsa, cambia configuración,
 *   revoca/genera código, cierra la liga y transfiere el rol. Un miembro
 *   que intente cualquiera de estas acciones recibe 403 (CA de US-26).
 * - **Invitar** (ver/compartir el código de invitación): el admin siempre
 *   (si el modo lo permite); el miembro **solo si el admin lo habilita**
 *   (`allowMemberInvites`, leagues.md §5: "⚠️ solo si el admin lo habilita").
 *
 * La función es pura: el servicio (I/O) resuelve el rol del actor y la
 * configuración de la liga y consume estas reglas; el router no las duplica
 * (T-08: una sola fuente). Mismo contrato que `canViewLeague` (US-24) y
 * `evaluateLeagueJoin` (US-25).
 *
 * Los tipos se definen localmente (sin I/O, check de pureza T-03): reflejan
 * los enums de la BD, compatibles por estructura.
 */

/** Rol de un miembro de la liga (reflejo del enum `LeagueMemberRole` de la BD). */
export type LeagueMemberRole = "admin" | "member";

/**
 * Acciones de gestión de la liga (leagues.md §5). Todas son de **admin**:
 * el miembro solo juega (ver ranking/miembros, colocar/cambiar lineup).
 */
export type LeagueAdminAction =
  | "update" // cambiar nombre/descripción/visibilidad
  | "rotate_code" // revocar código / generar uno nuevo
  | "kick" // expulsar a un miembro
  | "close" // cerrar la liga
  | "transfer_admin"; // transferir el rol de admin

/**
 * Roles que pueden ejecutar cada acción de gestión (leagues.md §5). Hoy todas
 * son exclusivas del admin; el mapa es la fuente única de la regla, así que
 * si una acción futura admite al miembro (p. ej. invitar) basta con añadirlo
 * aquí sin tocar el servicio.
 */
const ACTION_ROLES: Readonly<Record<LeagueAdminAction, readonly LeagueMemberRole[]>> = {
  update: ["admin"],
  rotate_code: ["admin"],
  kick: ["admin"],
  close: ["admin"],
  transfer_admin: ["admin"],
};

/**
 * ¿Puede un miembro con el rol dado ejecutar la acción de gestión?
 *
 * - Rol `admin` → sí, cualquier acción de gestión.
 * - Rol `member` → no (leagues.md §5: "el admin gestiona la liga; el
 *   miembro solo juega"). El servicio traduce el `false` en 403 FORBIDDEN.
 */
export function canManageLeague(
  role: LeagueMemberRole,
  action: LeagueAdminAction,
): boolean {
  return ACTION_ROLES[action].includes(role);
}

/**
 * ¿Puede un miembro ver/compartir el código de invitación (leagues.md §5:
 * "Invitar usuarios (si el modo lo permite)" — admin ✅, miembro ⚠️ solo si
 * el admin lo habilita)?
 *
 * - Rol `admin` → siempre (si el modo de entrada tiene código).
 * - Rol `member` → solo si `allowMemberInvites` está habilitado por el admin.
 */
export function canInvite(
  role: LeagueMemberRole,
  cfg: { allowMemberInvites: boolean },
): boolean {
  return role === "admin" || cfg.allowMemberInvites;
}
