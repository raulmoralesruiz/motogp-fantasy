/**
 * Envío de emails (US-02) — frontera de I/O inyectable.
 *
 * MISMO PATRÓN que `RateLimitStore` (US-01): el servicio recibe el enviador
 * por inyección; en producción se usa `logEmailSender` (PROVISIONAL, ver
 * ADR-0009: el link se loguea en el servidor y se recupera con
 * `docker logs motogp-web`). Cambiar a un proveedor real (SMTP/Resend/…)
 * es sustituir una clase sin tocar el servicio ni los tests.
 */

export interface ResetLinkEmail {
  /** Destinatario (email del usuario). */
  to: string;
  /** Link de recuperación completo (incluye el token en claro). */
  link: string;
}

/** Contrato de envío de emails de la app (por ahora, solo recuperación). */
export interface EmailSender {
  sendResetLink(email: ResetLinkEmail): Promise<void>;
}

/**
 * Implementación PROVISIONAL (ADR-0009): loguea el link en el servidor.
 * Cero dependencias externas ni claves; el operador recupera el link de los
 * logs del contenedor.
 */
export class LogEmailSender implements EmailSender {
  async sendResetLink({ to, link }: ResetLinkEmail): Promise<void> {
    // Etiqueta estable para grep en los logs: `docker logs motogp-web | grep reset-link`.
    console.log(
      `[reset-link] PROVISIONAL (sin proveedor de email): destinatario=${to} link=${link}`,
    );
  }
}

/** Instancia por defecto del enviador provisional (la inyecta el router). */
export const logEmailSender = new LogEmailSender();
