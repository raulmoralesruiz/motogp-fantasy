/**
 * Módulo `notifications` — notificaciones por email (US-36, ADR-0033).
 *
 * Responsabilidad:
 * - Notificar a los miembros activos de las ligas (con email habilitado)
 *   cuando se publican resultados definitivos de un GP o se aplica un
 *   recálculo.
 * - Ajustes de notificación por usuario (email on/off, opt-out).
 * - Frontera de I/O inyectable: `ResendEmailSender` (producción) /
 *   `LogNotificationSender` (dev/tests).
 *
 * El módulo NO importa otros módulos de negocio (solo `admin` para la
 * auditoría, infraestructura transversal — mismo patrón que `results`).
 * La orquestación (cuándo notificar) la hace el router `results` (BFF,
 * patrón US-21): `results` no importa `notifications`.
 */
export * from "./email-sender";
export * from "./notification-service";
export * from "./resend-sender";
export * from "./sender-selection";
