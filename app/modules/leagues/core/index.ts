/**
 * Núcleo puro del módulo `leagues` (sin I/O, auditado por el check de
 * pureza T-03): ranking y desempates de liga (US-21, leagues.md §8),
 * código de invitación (US-23, leagues.md §4), regla de visibilidad
 * (US-24, leagues.md §9), regla de unión (US-25, leagues.md §6) y
 * permisos de liga admin/miembro (US-26, leagues.md §5).
 */
export * from "./eligibility";
export * from "./invite-code";
export * from "./join";
export * from "./permissions";
export * from "./ranking";
export * from "./visibility";
