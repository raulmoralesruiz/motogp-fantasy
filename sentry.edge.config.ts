/**
 * Sentry — edge (T-14, ADR-0036), runtime `edge` (middleware de CORS,
 * T-20). Misma política que el servidor: sin DSN no inicializa, y
 * `dataCollection` cerrada (GDPR, AGENTS.md §8).
 */
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn && dsn.trim()) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "production",
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: false, response: false },
      urlQueryParams: false,
      httpBodies: [],
    },
  });
}
