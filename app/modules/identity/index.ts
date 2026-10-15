/**
 * Módulo `identity` — usuarios, sesiones, autorización y roles.
 *
 * US-01 (hecho): registro/login con argon2, sesión opaca en cookie
 * HttpOnly+Secure+SameSite=Lax, rate limit por IP y bloqueo temporal.
 * Pendiente: US-02 (logout/recuperación), US-03 (perfil/GDPR),
 * T-08 (RBAC por recurso), T-09 (auditoría).
 */
export * from "./auth-service";
export * from "./password";
export * from "./rate-limit";
export * from "./sessions";
