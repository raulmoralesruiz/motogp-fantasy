# ADR-0039: 2FA TOTP (RFC 6238) por cuenta, recomendado para `global_admin` (D-07)

- **Estado:** Aceptado (2026-11-04)
- **Fecha:** 2026-11-04
- **Relacionado:** D-07 (backlog: "2FA para `global_admin` (recomendado: sí)"), `security.md` §1.6/§5/§1.11, US-01 (auth + anti fuerza bruta), T-09 (auditoría), T-12/ADR-0035 (patrón de rate limit por IP), ADR-0016 (anonimización GDPR — la limpieza de `totp_secret`/`totp_enabled_at` al borrar cuenta), ADR-0038 (gate de `npm audit`: `qrcode` entra en el baseline si tiene hallazgos), `testing.md` (capa de tests del núcleo puro).

## Problema

D-07 pide decidir sobre 2FA para `global_admin`: es el único actor que puede marcar resultados definitivos, recalcular, importar, cambiar reglas y precios — una cuenta comprometida (contraseña filtrada, sesión secuestrada, reemplazo de navegador) compromete la integridad de los datos del juego. `security.md` §5 lo listaba como decisión pendiente ("Si se habilita 2FA para `global_admin` (recomendado: sí)").

La cuenta de `global_admin` vive en un dispositivo del dueño; no hay flujo de "reclamar el acceso" desde otra cuenta (el bootstrap es una vez por BD). La contraseña sola + cookie de sesión es la única barrera. Un segundo factor de posesión (app de autenticación en el móvil) es el estándar de la industria para esta superficie, sin infraestructura adicional (sin SMS/email, sin dependencias de terceros).

## Opciones

### A. TOTP (RFC 6238) implementado por la app (opción elegida)

El núcleo TOTP (HMAC-SHA1, base32, ventana ±1 paso) es **puro** (sin I/O ni reloj real: el tiempo se inyecta en ms) y vive en `app/modules/identity/core/totp.ts`, con tests contra los vectores oficiales de los RFC 4226/6238/4648. La frontera de I/O (reto del login) sigue el patrón del módulo (`RateLimitStore`): interfaz `TotpChallengeStore` + implementación Redis en producción (`app/server/totp-redis.ts`) + in-memory con reloj inyectable para tests.

- **Ventajas:** cero proveedores externos y cero latencia; el secreto no sale del dominio; compatible con cualquier app de autenticación (Authenticator, 1Password, FreeOTP…); auditable; los fallos de código alimentan el bloqueo por cuenta existente (`recordFailure`/`shouldLockAccount`): un atacante con la contraseña no puede hacer fuerza bruta de 6 dígitos sin bloquear la cuenta.
- **Riesgos:** perder el dispositivo bloquea el acceso (mitigado: recovery manual documentado en el runbook — el admin del dueño de la BD puede desactivar el 2FA directamente en la BD); el QR se genera server-side (ver justificación de `qrcode` abajo).

### B. Diferir la 2FA (opción descartada)

Quedaría una "recomendación" sin código: `security.md` seguiría con una decisión pendiente abierta, y `global_admin` seguiría sin capa de posesión. El backlog ya la marca P1 y es la última decisión de seguridad de la Fase 1; diferirla no ahorra trabajo real (la superficie de auth ya existe y se testea).

### C. 2FA solo por email (código enviado a la bandeja)

El email ya está integrado (Resend, US-36), pero: el código llega al mismo medio que la contraseña (comprometer la bandeja compromete ambos factores); dependemos de la disponibilidad/latencia del proveedor en el momento del login; y el abuso de la bandeja (phishing) es el vector más común. TOTP es estrictamente mejor para la cuenta de admin y no excluye el email como método futuro (US-40/Post-MVP: push).

## Decisión

**Opción A**: 2FA TOTP opcional por cuenta (no obligatorio para nadie — es **recomendado** para `global_admin`), con esta semántica:

1. **Dos estados por cuenta (columnas en `users`):**
   - `totp_secret` (base32, 32 chars = 160 bits): existe tras matricular (enroll), incluso sin confirmar.
   - `totp_enabled_at` (null ⇒ pendiente o desactivado): el 2FA solo exige código en el login cuando NO es null.
   - `enroll` → estado **PENDIENTE** (2FA aún no protege la cuenta: el dispositivo nuevo debe confirmarse). `confirm` con un código válido → **ACTIVO**. `disable` → borra ambas (re-autenticación con contraseña, como `deleteAccount`, ADR-0016).
   - **Re-matricular** (ya activo) sustituye el secreto y **vuelve a pendiente**: el dispositivo nuevo debe confirmarse antes de que el 2FA siga protegiendo (sin confirm, el login sigue siendo de un paso → no hay bloqueo accidental de la cuenta activa).

2. **Login de 2 pasos (solo cuentas activas):** la contraseña correcta NO emite sesión: emite un **reto opaco de vida corta** (`TotpChallengeStore.issue`, TTL `TOTP_CHALLENGE_TTL_SEC` default 300 s). `verifyTotp` canjea un código TOTP válido por la cookie de sesión. La cookie solo existe tras el segundo factor (invariante: nunca hay sesión de una cuenta 2FA con solo contraseña).

3. **Anti fuerza bruta del segundo factor (doble presupuesto):**
   - **Por reto:** `TOTP_MAX_ATTEMPTS` (default 5) códigos; al agotarse, el reto se invalida (`consume`) y hay que volver a login.
   - **Por cuenta:** cada fallo de código también alimenta `rateLimit.recordFailure(account)` (reutiliza `shouldLockAccount` del login, 5 fallos → 15 min por defecto). Así un atacante con la contraseña no hace fuerza bruta de 6 dígitos sin bloquear la cuenta. El login de una cuenta 2FA (contraseña correcta → reto) **no resetea** ese contador: una contraseña correcta no es autenticación completa mientras el 2.º factor está pendiente. Si lo reseteara, el atacante rotaría retos infinitamente (login → fallo de código → login → …) sin bloquearse; el contador solo se resetea al canjear un código válido (`verifyTotp`) — o en un login normal de cuenta sin 2FA.
   - **Error genérico idéntico** para reto inexistente/expirado, código incorrecto y presupuesto agotado: "El código no es válido o ha caducado." (no se revela cuál fue el caso).

4. **Re-autenticación con contraseña** en `enroll` y `disable` (operaciones sensibles, security.md §1.11): un atacante con una sesión robada (cookie) no puede ni matricular su propio 2FA ni desactivar el existente sin la contraseña.

5. **Auditoría (T-09):** `totp.enrolled`, `totp.enabled`, `totp.disabled` en `audit_log` (append-only) con IP del actor.

6. **GDPR (ADR-0016):** la anonimización al borrar la cuenta limpia `totp_secret` y `totp_enabled_at` (un usuario anonimizado no debe llevar el secreto de su antiguo 2FA).

7. **Proyección pública:** `PublicUser.totpEnabled` (activa o no) para que la UI de `/perfil` muestre el estado; el secreto nunca viaja fuera de la respuesta de `enroll`.

8. **Parámetros operativos por env** (no reglas de juego: no viven en `season_rules`, AGENTS.md §1.3): `TOTP_CHALLENGE_TTL_SEC` (300), `TOTP_MAX_ATTEMPTS` (5).

### Justificación de la única dependencia añadida: `qrcode` (v1.5.4)

El QR de matriculación se genera **server-side** con `qrcode` (generación de SVG sin Canvas). Alternativas:

- **QR client-side** (p. ej. librería en el bundle): el secreto viaja al navegador y la generación depende de JS de cliente; más superficie de ataque y un bundle nuevo por una vista de una sola vez.
- **Sin QR** (secreto manual solo): peor UX para una cuenta de admin; el QR es el estándar de las apps de autenticación.
- **Servicio externo de QR**: inaceptable — la URI `otpauth://` **contiene el secreto**: enviarla fuera del dominio sería una fuga de credenciales.

`qrcode` es una dependencia runtime pequeña, sin I/O de red (genera el SVG localmente), con types de community (`@types/qrcode`). Su huella de auditoría (`npm audit`) se cubre con el gate de ADR-0038/baseline si tuviera hallazgos (en 2026-11-04 no tiene).

## Consecuencias

- **Positivas:** cierra D-07; la cuenta `global_admin` puede tener una capa de posesión sin proveedores externos; el núcleo TOTP es puro y testable con los vectores oficiales de los RFC; el doble presupuesto de intentos contiene la fuerza bruta del 2.º factor; los fallos y las transiciones de estado quedan en la auditoría.
- **Negativas / riesgos:** el admin se bloquea si pierde el dispositivo **y** la contraseña: el recovery es manual (runbook §"Recovery de 2FA": `UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL WHERE id = …` en la BD de producción, documentado y auditado por el operador). El QR server-side añade una dependencia runtime (`qrcode`, justificada arriba). Los tests de integración crean más cuentas por corrida (una por flujo 2FA).
- **Compatibilidad:** la 2FA es **opt-in** (default off): el flujo de login existente no cambia para ninguna cuenta; las suites E2E existentes (auth, admin `global_admin`) siguen pasando sin cambios; `me`/`login` solo ganan campos opcionales (`totpRequired`, `totpToken`, `totpEnabled`), backwards-compatible.
- **Alternativas descartadas:** email como 2.º factor (C), diferir (B).

## Reversibilidad

Alta: es opt-in por cuenta. Desactivarla para una cuenta = `disable` (o la limpieza de la BD). Retirar la funcionalidad = revertir el router/la UI y dejar las columnas (no migran nada de vuelta; los secretos ya matriculados se limpian con la misma query del runbook). El núcleo puro `core/totp.ts` no tiene dependencias hacia afuera: se puede eliminar sin tocar el resto.
