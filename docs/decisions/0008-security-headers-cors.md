# ADR-0008: Cabeceras de seguridad y estrategia CORS (T-20)

- **Estado:** Aceptado (confirmado por el usuario, 2026-10-15)
- **Fecha:** 2026-10-15

## Problema

La app se expone por dos orígenes reales de acceso (T-20: cabeceras de seguridad y transporte):

1. `https://motogp.raulmorales.eu` (público, vía Cloudflare → NPM → 192.168.1.3:22020).
2. `http://192.168.1.3:22020` (LAN, directo).

Hay que (a) aplicar cabeceras de seguridad estándar a todas las rutas y (b) restringir el CORS de la API (`/api/*`) al origen de la app, sin mantener una allow-list frágil con dos orígenes (y dos esquemas: https público + http LAN).

## Opciones

1. **CORS por reflejo de host** (recomendada): permitir la petición si el host del `Origin` (host + puerto) coincide exactamente con el `Host` de la petición; si no, 403. Sin allow-list.
2. **Allow-list estática** de orígenes (`https://motogp.raulmorales.eu`, `http://192.168.1.3:22020`) configurable por temporada.
3. **Sin CORS explícito**: no enviar `Access-Control-Allow-Origin` nunca (los GET cross-origin no serían legibles, pero las mutaciones cross-origin no se bloquearían de forma explícita).

## Pros/Contras

- 1 (recomendada): cubre los dos orígenes reales sin mantener lista; auto-adaptable si cambia IP o dominio; el 403 explícito cubre las mutaciones cross-origin; lógica pura y testeable.
- 2: más estricto y auditable, pero hay que mantener la lista a mano (IP LAN, dominio, puertos) y cada cambio es un deploy; más frágil ante cambios de infraestructura.
- 3: no bloquea de forma explícita POST cross-origin (solo los hace ilegibles); no cumple el CA de T-20 ("CORS restringido al origen de la app").

## Recomendación

**Opción 1** (reflejo de host), con 403 JSON en español para orígenes no permitidos y preflight `OPTIONS` → 204 con las cabeceras CORS.

## Justificación

- El navegador envía `Origin` también en POST same-origin, así que el reflejo de host se aplica a las propias peticiones de la app (no las rompe).
- El `Host` lo fija la infraestructura (Cloudflare/NPM para el dominio; el puerto LAN para la IP), así que "Origin == Host" es una señal fiable de same-origin.
- Un GET cross-origin sin `Access-Control-Allow-Origin` no es legible por el origen; el 403 de servidor añade el bloqueo explícito de las mutaciones.
- La lógica de decisión es una función pura (`evaluateCors` en `cors.ts`) testeada de forma aislada; el wrapper de `middleware.ts` solo traduce la decisión a respuesta de Next.js.

## Cabeceras de seguridad (todas las rutas)

| Cabecera                    | Valor                                                                                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains`                                                                                                                                                                                                |
| `X-Content-Type-Options`    | `nosniff`                                                                                                                                                                                                                            |
| `X-Frame-Options`           | `DENY`                                                                                                                                                                                                                               |
| `Referrer-Policy`           | `strict-origin-when-cross-origin`                                                                                                                                                                                                    |
| `Permissions-Policy`        | `camera=(), microphone=(), geolocation=()`                                                                                                                                                                                           |
| `Content-Security-Policy`   | `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'` |

La CSP es básica: Next.js App Router usa scripts/estilos inline (datos RSC), por lo que `'unsafe-inline'` es necesario en `script-src`/`style-src`. Un CSP con nonce es una mejora futura (fuera de alcance de T-20, junto con rate-limiting — US-01 — y Sentry — T-14).

**Nota (2026-10-16): `unsafe-eval` solo en desarrollo.** `script-src` es consciente del entorno: en `next dev` añade `'unsafe-eval'` porque el runtime de Fast Refresh de Next.js (`react-refresh`) usa `eval` para aplicar hot-reloads; sin él, el CSP bloquea el `eval` y el `EvalError` resultante rompe el JS del cliente (la UI se queda en "cargando" y no dispara peticiones tRPC). En producción el build no usa `eval`, por lo que el CSP se mantiene estricto (sin `'unsafe-eval'`; la tabla de arriba es el valor de producción). Es un refinement de la decisión —el CSP de producción no cambia—, no una reversión.

## Impacto técnico

- `next.config.ts`: `headers()` con las 6 cabeceras para `/(.*)`.
- `middleware.ts` (raíz): aplica solo a `/api/:path*` (matcher); delega en `evaluateCors` (función pura en `cors.ts`).
- `Vary: Origin` en las respuestas de `/api/*` para que las caches (Cloudflare) no mezclen respuestas con/sin `Access-Control-Allow-Origin`.
- Tests: unit de `evaluateCors` (matriz de decisiones) y de `headers()`; smoke HTTP real en el job `docker` del CI (`docker run` de la imagen + curl).

## Riesgos

- Reflejo de host: si un CDN/proxy reescribiera `Host` de forma inconsistente con `Origin`, se producirían falsos 403. Mitigación: la infraestructura actual (Cloudflare→NPM) conserva `Host`; el smoke test del CI lo cubre.
- CSP básica con `'unsafe-inline'` no mitiga XSS que inyecte scripts inline. Mitigación: es una mejora incremental; el nonce es una tarea futura.

## Validación

- Unit: matriz de `evaluateCors` (permitido/denegado/preflight/malformado) y valores de `headers()`.
- Integración HTTP (CI, job `docker`): cabeceras presentes en `/` y `/api/health`; POST same-origin → 200 + ACAO + Vary; POST cross-origin → 403; preflight permitido → 204; preflight denegado → 403.
