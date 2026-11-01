/**
 * Selección del enviador según configuración (US-36, ADR-0033).
 *
 * Función pura de la configuración (testable sin env): con API key de
 * Resend → `ResendEmailSender` (producción); sin ella →
 * `LogNotificationSender` (dev/provisional: la notificación se loguea en el
 * servidor, mismo espíritu que ADR-0009).
 */
import {
  LogNotificationSender,
  type NotificationEmailSender,
} from "./email-sender";
import { ResendEmailSender } from "./resend-sender";

export interface SenderSelectionConfig {
  /** API key de Resend (`re_…`); vacía/ausente ⇒ modo provisional. */
  apiKey?: string;
  /** Remitente verificado en Resend. */
  from: string;
}

export function chooseNotificationSender(
  config: SenderSelectionConfig,
): NotificationEmailSender {
  return config.apiKey
    ? new ResendEmailSender({ apiKey: config.apiKey, from: config.from })
    : new LogNotificationSender();
}
