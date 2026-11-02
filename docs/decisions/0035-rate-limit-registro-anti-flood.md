# ADR-0035: Rate limit de registro de cuentas (T-12) — anti-flood por IP

- **Estado:** Aceptado (2026-11-02)
- **Fecha:** 2026-11-02
- **Relacionado:** T-12 (backlog: revisión de seguridad), `security.md` §1.6 (control de intentos de acceso), US-31/ADR-0029 (liga de bienvenida: el registro se une a ella atómicamente), US-01 (registro), `rate-limit.ts`/`rate-limit-redis.ts` (patrón de ventana fija por IP).

## Problema

La revisión de seguridad de T-12 encontró un hueco real en `security.md` §1.6 ("Rate-limiting en login y reset + bloqueo temporal"): **el registro de cuentas no tiene rate limit**.

Los otros flujos sensibles sí están cubiertos (login: ventana por IP + bloqueo por cuenta; recuperación: ventana por IP; creación de ligas: por usuario; unión a ligas: por IP + bloqueo; eliminación de cuenta: por usuario). El registro no: `AuthService.register` recibe `meta.ip` pero no lo usaba para limitar nada.

Impacto concreto con US-31 activa: el registro se une **atómicamente** a la liga de bienvenida (misma transacción que el usuario). Una ola de registros bot (una sola IP o un botnet) consume las plazas de esa liga (máx. 50) y **bloquea los registros legítimos** ("La liga está llena" → rollback del registro). Es un vector de denegación de servicio de bajo coste.

## Opciones

1. **Ventana fija por IP sobre el registro (elegida):** mismo patrón que login/reset/ligas — `recordRegistration(ip, windowSec)` con contador atómico (Redis Lua INCR+EXPIRE; in-memory en tests). Rechazo `BAD_REQUEST` con mensaje "Estás enviando demasiadas peticiones. Inténtalo de nuevo en N s." Consistente con los 4 flujos ya limitados; sin nuevo mecanismo.
2. **Bloqueo por cuenta tras N fallos de registro:** el fallo de registro no es un "intento fallido" contra credenciales (no hay cuenta que proteger); el activo a proteger son las **plazas** y la **capacidad**, no una cuenta. El bloqueo por cuenta no encaja.
3. **Captcha / verificación de email antes del registro:** cambio de flujo de producto (afecta UX de US-01 y US-31: la adhesión a la bienvenida ocurre en el registro). Fuera de alcance de T-12; se puede reconsiderar post-MVP si aparece abuso real.
4. **No hacer nada (mitigar con el límite de plazas de la liga):** la liga de bienvenida es solo UN caso; sin US-31 el flood sigue creando spam de usuarios sin límite. Rechazado.

## Decisión

**Rate limit de registro por IP, ventana fija**, como parámetro operativo (no de reglas de juego → vive en env, no en `season_rules`, AGENTS.md §1.3):

- **`AUTH_REGISTER_RATE_LIMIT_MAX`** (default **10** registros/hora por IP) y **`AUTH_REGISTER_RATE_LIMIT_WINDOW_SEC`** (default **3600** s).
- Implementación: `RateLimitStore.recordRegistration` (nueva; clave Redis `rl:register:ip:*`, independiente de las de login/reset/ligas — el registro NO consume el contador de login) + `AuthService.register` rechaza **antes** de tocar la BD cuando `count > max ∧ remaining > 0`.
- **Especificación de tests:** los tests de integración de flujo usan umbral generoso (`maxPerWindow: 100`) para no interferir; la suite E2E (3 viewports en paralelo registran ~30 cuentas/corrida desde una IP) fija `AUTH_REGISTER_RATE_LIMIT_MAX=100` **solo en el entorno de prueba** (`.env` local, `.env.example` documentado comentado, workflow nightly) — en producción no se fija (default 10/hora). La **semántica** (rechazo N+1, sin crear usuario, otro IP no afectado, reintento tras la ventana) la cubre el test de integración `auth.test.ts` ("T-12/ADR-0035: N+1 registros por IP → rechazo").

## Consecuencias

- **Positivas:** cierra el hueco de anti-flood (US-31); un solo patrón de rate limit en toda la app; el rechazo ocurre antes de la BD (no crea usuarios, no consume plazas).
- **Negativas / riesgos:** una IP compartida (NAS, oficina, campus) con >10 altas/hora legítimas se bloquearía temporalmente — aceptable: el mensaje indica el reintento y la ventana es larga; si aparece el caso, subir el default por env sin tocar código.
- **Alternativas descartadas:** captcha (fuera de alcance UX), bloqueo por cuenta (no encaja con el activo a proteger).

## Reversibilidad

Alta: es un parámetro operativo; desactivarlo equivaldría a un umbral muy alto (p. ej. 10⁶). El contador es independiente de los demás, así que revertir no toca login/reset/ligas.
