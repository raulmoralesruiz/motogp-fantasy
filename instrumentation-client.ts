/**
 * Sentry — CLIENTE (T-14, ADR-0036).
 *
 * `NEXT_PUBLIC_SENTRY_DSN` se inyecta en el bundle en el BUILD (patrón
 * oficial de @sentry/nextjs): para activar Sentry hay que fijar el DSN y
 * hacer build. Sin DSN el SDK no inicializa y no hay sobrecoste.
 *
 * GDPR (AGENTS.md §8): `dataCollection` cerrada — sin userInfo, cookies,
 * headers, query params ni bodies.
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
