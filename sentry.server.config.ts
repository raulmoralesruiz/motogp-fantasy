/**
 * Sentry — servidor (T-14, ADR-0036), runtime `nodejs`.
 *
 * Sin `NEXT_PUBLIC_SENTRY_DSN` **no inicializa** (modo provisional,
 * ADR-0036): sin cliente activo los capturers de la app son no-op y no
 * hay coste de arranque.
 *
 * GDPR (AGENTS.md §8): `dataCollection` cerrada — sin userInfo, cookies,
 * headers, query params ni bodies. Lo que importa para depurar es el stack
 * trace y los tags que la app añade (`trpc.path`, `alert.kind`, cola, GP);
 * el tráfico entrante no aporta señal en esta app (tRPC JSON de juego).
 *
 * Solo errores (sin tracing): no se fija `tracesSampleRate` (0 traces).
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
