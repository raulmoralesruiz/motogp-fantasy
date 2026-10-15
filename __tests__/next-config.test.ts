import { describe, expect, it } from "vitest";

import nextConfig from "../next.config";

// CSP básica acordada en T-20 (ADR-0008). Next.js App Router usa scripts y
// estilos inline (datos RSC), por lo que 'unsafe-inline' es necesario en
// script-src/style-src. Un CSP con nonce es una mejora futura.
const CSP_ESPERADA = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join("; ");

describe("next.config.ts — cabeceras de seguridad (T-20)", () => {
  it("aplica las 6 cabeceras a todas las rutas", async () => {
    const rules = await nextConfig.headers?.();
    expect(rules).toBeDefined();
    expect(rules).toHaveLength(1);

    const rule = rules?.[0];
    expect(rule?.source).toBe("/(.*)");

    const porClave = Object.fromEntries(
      (rule?.headers ?? []).map((h) => [h.key, h.value]),
    );

    expect(porClave["Strict-Transport-Security"]).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(porClave["X-Content-Type-Options"]).toBe("nosniff");
    expect(porClave["X-Frame-Options"]).toBe("DENY");
    expect(porClave["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(porClave["Permissions-Policy"]).toBe(
      "camera=(), microphone=(), geolocation=()",
    );
    expect(porClave["Content-Security-Policy"]).toBe(CSP_ESPERADA);
  });
});
