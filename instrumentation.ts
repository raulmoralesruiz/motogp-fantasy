/**
 * Instrumentación de Next.js (T-14, ADR-0036) — punto de carga del SDK de
 * Sentry en el SERVIDOR (App Router).
 *
 * - `register()` corre al arrancar el servidor: carga
 *   `sentry.server.config` (runtime nodejs) y `sentry.edge.config` (edge,
 *   para el middleware de CORS).
 * - `onRequestError` captura los errores de Server Components, middleware
 *   y route handlers (Next 15+).
 *
 * Sin `NEXT_PUBLIC_SENTRY_DSN` los config files NO inicializan (modo
 * provisional, ADR-0036 — igual que `RESEND_API_KEY` vacía, ADR-0033):
 * el SDK queda inactivo y los capturers de la app son no-op.
 */
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Errores de Server Components / middleware / route handlers (Next 15+).
export const onRequestError = Sentry.captureRequestError;
