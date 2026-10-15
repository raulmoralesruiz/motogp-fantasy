/**
 * Lógica de decisión CORS para la API (T-20).
 *
 * Función pura: recibe solo datos (método, `Origin`, `Host`) y devuelve una
 * decisión — sin I/O, sin dependencias de Next.js ni del objeto `Request` —
 * para poder testearla de forma aislada. (No se usa `Request` como entrada
 * porque `Host` y `Origin` son "cabeceras prohibidas" de la spec de fetch:
 * en algunos entornos no se pueden fijar en un `Request` de test.)
 *
 * Estrategia: **reflejo de host**. Un `Origin` se permite solo si su host
 * (host + puerto) coincide exactamente con el `Host` de la petición. Cubre
 * los dos orígenes reales de acceso a la app sin mantener allow-list:
 *   - https://motogp.raulmorales.eu (público, vía Cloudflare → NPM)
 *   - http://192.168.1.3:22020 (LAN, directo)
 *
 * Notas:
 * - El navegador envía `Origin` también en POST same-origin, así que el
 *   check se aplica a las propias peticiones de la app.
 * - Un GET cross-origin no es legible por el origen si la respuesta no lleva
 *   `Access-Control-Allow-Origin` (y solo se añade si el origen está permitido).
 *
 * Ver ADR-0008 para la decisión.
 */

export type CorsOutcome =
  /**
   * La petición pasa. Si `allowOrigin` está presente, el llamador debe añadir
   * `Access-Control-Allow-Origin: <allowOrigin>` a la respuesta.
   */
  | { kind: "pass"; allowOrigin?: string }
  /** Preflight (OPTIONS): el llamador responde directamente con 204 + cabeceras. */
  | { kind: "preflight"; headers: Record<string, string> }
  /** Origen no permitido: el llamador responde 403. */
  | { kind: "reject" };

export interface CorsInput {
  /** Método HTTP de la petición (p. ej. "GET", "POST", "OPTIONS"). */
  method: string;
  /** Valor de la cabecera `Origin` (null si no está presente). */
  origin: string | null;
  /** Valor de la cabecera `Host` (null si no está presente). */
  host: string | null;
}

export function evaluateCors({ method, origin, host }: CorsInput): CorsOutcome {
  // Sin `Origin`: GET same-origin, curl, health-check de deploy.sh → pasa.
  if (!origin) return { kind: "pass" };

  let originHost: string;
  try {
    // `URL` normaliza y minúscula el host (host + puerto no por defecto).
    originHost = new URL(origin).host;
  } catch {
    // Origin malformado (p. ej. origen opaco "null") → se rechaza.
    return { kind: "reject" };
  }

  if (host === null || originHost !== host.toLowerCase()) {
    return { kind: "reject" };
  }

  if (method === "OPTIONS") {
    return {
      kind: "preflight",
      headers: {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "86400",
        vary: "Origin",
      },
    };
  }

  return { kind: "pass", allowOrigin: origin };
}
