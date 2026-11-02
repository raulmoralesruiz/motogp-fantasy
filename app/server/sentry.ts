/**
 * Punto único de captura de Sentry de la app (T-14, ADR-0036).
 *
 * **Desactivado por defecto:** si `NEXT_PUBLIC_SENTRY_DSN` está vacío
 * (o sin configurar) todos los capturers son no-op — el código no necesita
 * saber si Sentry está arriba (mismo espíritu "modo provisional" que
 * `RESEND_API_KEY` vacía, ADR-0009/ADR-0033).
 *
 * Lee el env **en cada llamada** (no en el import): testeable sin fijar el
 * entorno, y coherente con que el DSN es un parámetro operativo (AGENTS.md
 * §1.3), no una regla de juego.
 *
 * Nota de PII (GDPR, AGENTS.md §8): la restricción de datos enviados
 * (`dataCollection` cerrada: sin userInfo/cookies/headers/bodies) se fija
 * en `sentry.server.config.ts` / `instrumentation-client.ts`, no aquí.
 */
import * as Sentry from "@sentry/node";

/** Contexto (tags) adjunto a la captura; valores en español/estables. */
export type SentryContext = Record<string, string>;

/** ¿Está Sentry habilitado (hay DSN no vacío)? */
export function isSentryEnabled(): boolean {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  return Boolean(dsn && dsn.trim());
}

/**
 * Captura una excepción con contexto (tags). No-op si no hay DSN.
 * Nunca lanza (un fallo de reporteo no puede romper el flujo que captura).
 */
export function captureException(
  error: unknown,
  context: SentryContext = {},
): void {
  if (!isSentryEnabled()) return;
  try {
    Sentry.withScope((scope) => {
      for (const [key, value] of Object.entries(context)) {
        scope.setTag(key, value);
      }
      Sentry.captureException(error);
    });
  } catch {
    // Deliberado: reportar errores no puede fallar la operación principal.
  }
}

/**
 * Captura un mensaje (alertas operativas sin excepción). No-op si no hay DSN.
 * Nunca lanza.
 */
export function captureMessage(message: string, context: SentryContext = {}): void {
  if (!isSentryEnabled()) return;
  try {
    Sentry.withScope((scope) => {
      for (const [key, value] of Object.entries(context)) {
        scope.setTag(key, value);
      }
      Sentry.captureMessage(message);
    });
  } catch {
    // Deliberado: ver comentario de `captureException`.
  }
}
