/**
 * Módulo `identity` — usuarios, sesiones, autorización y roles.
 *
 * Placeholder de Fase 0 (T-03): la estructura existe; el contenido se
 * implementa en Fase 1 (E2: US-01…US-03, T-08 RBAC, T-09 auditoría).
 *
 * Responsabilidad:
 * - Registro/login (contraseñas con hash argon2, sesiones en cookie HttpOnly).
 * - RBAC: roles globales `user`/`global_admin` + admin de liga (`league_members.rol`).
 * - Autorización por recurso: cada endpoint revalida que el actor puede actuar.
 * - GDPR: exportación y eliminación/anonimización de cuenta.
 */
export {};
