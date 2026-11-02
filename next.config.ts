import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

// CSP básica (T-20, ADR-0008). Next.js App Router usa scripts y estilos
// inline (datos RSC), por lo que 'unsafe-inline' es necesario en
// script-src/style-src. Un CSP con nonce es una mejora futura (fuera de T-20).
//
// En desarrollo, el runtime de Fast Refresh de Next.js (react-refresh) usa
// eval para aplicar hot-reloads; sin 'unsafe-eval' el CSP lo bloquea y rompe
// el JS del cliente (la UI se queda en "cargando"). En producción el build
// no usa eval, así que el CSP se mantiene estricto (sin 'unsafe-eval').
//
// T-14 (ADR-0036): si hay `NEXT_PUBLIC_SENTRY_DSN` en el build, el SDK de
// cliente envía eventos al host del DSN → ese origen entra en `connect-src`.
// El DSN es una URL pública (clave del proyecto, no un secreto); sin DSN la
// CSP es exactamente la de T-20 (`connect-src 'self'`).
function sentryIngestOrigin(): string | null {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn || !dsn.trim()) return null;
  try {
    return new URL(dsn).origin;
  } catch {
    return null; // DSN malformado: no tocar la CSP (el SDK avisará)
  }
}
const sentryOrigin = sentryIngestOrigin();

const isDev = process.env.NODE_ENV === "development";
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  `connect-src 'self'${sentryOrigin ? ` ${sentryOrigin}` : ""}`,
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  // Prisma carga su query engine en runtime: no debe bundlearse.
  // @node-rs/argon2 (US-01) es un módulo nativo: tampoco debe bundlearse.
  serverExternalPackages: ["@prisma/client", "@node-rs/argon2"],
  // Producción (Docker, T-02): empaqueta un servidor mínimo en .next/standalone.
  output: "standalone",
  // Cabeceras de seguridad (T-20, ADR-008): se aplican a todas las rutas.
  // CORS de la API lo gestiona middleware.ts (reflejo de host).
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          { key: "Content-Security-Policy", value: CSP },
        ],
      },
    ];
  },
};

/**
 * T-14 (ADR-0036): con `NEXT_PUBLIC_SENTRY_DSN` se instrumenta el build
 * (sourcemaps del SDK, wrappers de página/route) y se deshabilita el
 * empaquetado de sourcemaps de la app (no hay donde subirlas: stack
 * self-hosted en TrueNAS sin auth token de upload — `hideSourceMaps`).
 * Sin DSN: config de Next intacta (Sentry desactivado, modo provisional).
 */
const withSentry: (config: NextConfig) => NextConfig = process.env
  .NEXT_PUBLIC_SENTRY_DSN
  ? (config) =>
      withSentryConfig(config, {
        // Sin token de upload (self-hosted en TrueNAS): no subir sourcemaps.
        sourcemaps: { disable: true },
      })
  : (config) => config;

export default withSentry(nextConfig);
