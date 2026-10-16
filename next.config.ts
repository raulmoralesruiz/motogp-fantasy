import type { NextConfig } from "next";

// CSP básica (T-20, ADR-0008). Next.js App Router usa scripts y estilos
// inline (datos RSC), por lo que 'unsafe-inline' es necesario en
// script-src/style-src. Un CSP con nonce es una mejora futura (fuera de T-20).
//
// En desarrollo, el runtime de Fast Refresh de Next.js (react-refresh) usa
// eval para aplicar hot-reloads; sin 'unsafe-eval' el CSP lo bloquea y rompe
// el JS del cliente (la UI se queda en "cargando"). En producción el build
// no usa eval, así que el CSP se mantiene estricto (sin 'unsafe-eval').
const isDev = process.env.NODE_ENV === "development";
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
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
  // Cabeceras de seguridad (T-20, ADR-0008): se aplican a todas las rutas.
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

export default nextConfig;
