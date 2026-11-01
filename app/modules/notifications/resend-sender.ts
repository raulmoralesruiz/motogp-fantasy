/**
 * Resend (US-36, ADR-0033): proveedor real de email transaccional.
 *
 * Cero dependencias npm: API REST vía `fetch`
 * (`POST https://api.resend.com/emails`), el mismo enfoque con el que se
 * integra PulseLive (ADR-0019). `fetchImpl` es inyectable para tests sin
 * red (mismo patrón que `PulseLiveResultsSource`, U2).
 *
 * La API key es un secreto (security.md §1.12): solo por env
 * (`RESEND_API_KEY`), nunca en el repo.
 */
import type { NotificationEmail, NotificationEmailSender } from "./email-sender";

export interface ResendEmailSenderOptions {
  /** API key de Resend (`re_…`); en producción viene de `RESEND_API_KEY`. */
  apiKey: string;
  /** Remitente verificado en Resend (p. ej. `notificaciones@motogp.raulmorales.eu`). */
  from: string;
  /** Endpoint de la API (inyectable para tests/proxies). */
  apiUrl?: string;
  /** Implementación de `fetch` (inyectable para tests sin red). */
  fetchImpl?: typeof fetch;
}

export class ResendEmailSender implements NotificationEmailSender {
  private readonly apiKey: string;
  private readonly from: string;
  private readonly apiUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ResendEmailSenderOptions) {
    this.apiKey = options.apiKey;
    this.from = options.from;
    this.apiUrl = options.apiUrl ?? "https://api.resend.com/emails";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async send({ to, subject, html }: NotificationEmail): Promise<void> {
    const response = await this.fetchImpl(this.apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: this.from, to, subject, html }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Resend respondió ${response.status}: ${body.slice(0, 200) || "sin detalle"}`,
      );
    }
  }
}
