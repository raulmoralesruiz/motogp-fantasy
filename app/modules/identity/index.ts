/**
 * Módulo `identity` — usuarios, sesiones, autorización y roles.
 *
 * US-01 (hecho): registro/login con argon2, sesión opaca en cookie
 * HttpOnly+Secure+SameSite=Lax, rate limit por IP y bloqueo temporal.
 * US-02 (hecho): cierre de sesión (revocación en BD) + recuperación de
 * contraseña (token de uso único con expiración, envío de email inyectable).
 * T-08 (hecho): RBAC — decisiones puras de roles (`roles.ts`) + bootstrap
 * de `global_admin` por env en el registro (ADR-0010).
 * US-03 (hecho): perfil/GDPR — exportación de datos + eliminación de
 * cuenta por anonimización (ADR-0016).
 */
export * from "./account-service";
export * from "./auth-service";
export * from "./email";
export * from "./password";
export * from "./rate-limit";
export * from "./reset-tokens";
export * from "./roles";
export * from "./sessions";
