/**
 * Envío de emails de notificación (US-36, ADR-0033) — frontera de I/O
 * inyectable.
 *
 * MISMO PATRÓN que `EmailSender` (US-02, ADR-0009): el servicio recibe el
 * enviador por inyección; en producción se usa `ResendEmailSender`
 * (proveedor real, ADR-0033) y en dev/tests `LogNotificationSender`
 * (logea en el servidor, cero dependencias). Cambiar de proveedor es
 * sustituir una clase sin tocar el servicio ni los tests.
 */

export interface NotificationEmail {
  /** Destinatario (email del usuario). */
  to: string;
  /** Asunto (español, AGENTS.md §2). */
  subject: string;
  /** Cuerpo HTML de la notificación. */
  html: string;
}

/** Contrato de envío de notificaciones por email de la app (US-36). */
export interface NotificationEmailSender {
  send(email: NotificationEmail): Promise<void>;
}

/**
 * Implementación PROVISIONAL (dev/tests): loguea la notificación en el
 * servidor. Cero dependencias externas ni claves; el operador la recupera
 * de los logs del contenedor (`docker logs motogp-web | grep notification`).
 */
export class LogNotificationSender implements NotificationEmailSender {
  async send({ to, subject }: NotificationEmail): Promise<void> {
    // Etiqueta estable para grep en los logs.
    console.log(
      `[notification] PROVISIONAL (sin proveedor de email): destinatario=${to} asunto="${subject}"`,
    );
  }
}
