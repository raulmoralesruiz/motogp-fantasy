/**
 * Sink de alertas operativas (T-14, ADR-0036): entrega un `OpsAlert` por
 * los tres canales — log de la app, Sentry y email (sender de US-36:
 * Resend o Log provisional).
 *
 * **Nunca lanza** (ADR-0036, mismo principio que US-36/ADR-0033): un fallo
 * en la entrega de una alerta NO puede romper el ciclo que la dispara
 * (polling, worker). Cada canal va con su propio `catch` y log.
 *
 * Canales según env (todos opcionales, ADR-0036):
 * - log: siempre (el operador puede `docker logs motogp-worker | grep alert`);
 * - Sentry: si hay `NEXT_PUBLIC_SENTRY_DSN` (los capturers son no-op si no);
 * - email: si hay `OPS_ALERT_EMAIL` (destinatario fijo del operador).
 */
import type { NotificationEmailSender } from "@/modules/notifications";
import {
  alertBodyHtml,
  alertSubject,
  type OpsAlert,
} from "@/modules/jobs";

import { captureMessage } from "./sentry";

export interface AlertSink {
  /** Entrega la alerta por todos los canales configurados. No lanza. */
  send(alert: OpsAlert): Promise<void>;
}

export interface AlertSinkDeps {
  /** Destinatario del email (`OPS_ALERT_EMAIL`); vacío ⇒ sin canal de email. */
  to: string;
  /** Enviador de emails (US-36: Resend o Log provisional). */
  sender: NotificationEmailSender;
}

export function createAlertSink(deps: AlertSinkDeps): AlertSink {
  return {
    async send(alert) {
      // 1) Log (siempre): etiqueta estable `[alert]` para grep en los logs.
      console.warn(
        `[alert] ${alertSubject(alert)} — ${JSON.stringify(alert).slice(0, 500)}`,
      );

      // 2) Sentry (no-op sin DSN; captureMessage ya captura sus propios fallos).
      captureMessage(alertSubject(alert), {
        "alert.kind": alert.kind,
      });

      // 3) Email (si hay destinatario): nunca propaga el fallo.
      if (deps.to) {
        try {
          await deps.sender.send({
            to: deps.to,
            subject: alertSubject(alert),
            html: alertBodyHtml(alert),
          });
        } catch (error) {
          console.error(
            "[alert] fallo enviando el email de la alerta:",
            error instanceof Error ? error.message : error,
          );
        }
      }
    },
  };
}
