# ADR-0009: Envío de email provisional (US-02)

- **Estado:** Aceptado (confirmado por el usuario, 2026-10-16)
- **Fecha:** 2026-10-16

## Problema

US-02 (recuperación de contraseña) necesita enviar un email con el link de restablecimiento. Para el MVP no hay proveedor de email configurado (ni cuenta, ni API key, ni dominio verificado), pero el flujo debe ser usable de extremo a extremo.

## Opciones

1. **`EmailSender` inyectable + `LogEmailSender`** (recomendada): interfaz `EmailSender` en el módulo `identity`; la implementación provisional loguea el link en el servidor con una etiqueta estable (`[reset-link]`) para grepearlo en `docker logs motogp-web`. Cambiar a un proveedor real = sustituir una clase.
2. **Proveedor real desde el inicio** (Resend/SendGrid/etc.): requiere cuenta, API key en secrets y verificación de dominio; sobredimensionado para el MVP y añade una dependencia externa antes de que haya usuarios reales.
3. **Sin email (flujo manual)**: el usuario pide al admin el link. Rompe el self-service que US-02 existe para dar.

## Pros/Contras

- 1 (recomendada): el flujo completo funciona hoy; mismo patrón de DI ya usado en `RateLimitStore` (Redis en producción, in-memory en tests); los tests usan un `CapturingEmailSender` sin I/O real; el cambio a proveedor real es un swap de una clase + una variable de entorno.
- 2: correcto a largo plazo, pero bloquea US-02 en infraestructura que no hace falta todavía; el secreto añade superficie de rotación antes de tiempo.
- 3: no cumple la historia (recuperación de contraseña self-service).

## Recomendación

**Opción 1.** El link se compone con `NEXT_PUBLIC_APP_URL` (ahora sí la consume el código) y se loguea como:

```
[reset-link] PROVISIONAL (sin proveedor de email) — destinatario: usuario@example.com — http://app/reestablecer-contrasena?token=…
```

## Justificación

- La decisión de "cómo se envía" queda aislada en `app/modules/identity/email.ts`; el resto del sistema solo conoce la interfaz `EmailSender`.
- El token de recuperación es de uso único y expira en 1 h (`RESET_TOKEN_TTL_SEC`), así que un link en logs tiene ventana de abuso acotada y el log solo vive en el NAS (acceso restringido).
- El patrón es el mismo que `RateLimitStore`: producción inyecta una implementación, tests inyectan otra.

## Impacto técnico

- `app/modules/identity/email.ts`: interfaz `EmailSender` + `LogEmailSender` + instancia `logEmailSender`.
- `app/modules/identity/auth-service.ts`: dependencia `emailSender` inyectada; `requestPasswordReset` compone el link y delega el envío.
- `app/server/routers/auth.ts`: el router por defecto inyecta `logEmailSender` (los tests inyectan el capturador).
- Env: `NEXT_PUBLIC_APP_URL` deja de ser "reservada" (se usa para el link); `RESET_TOKEN_TTL_SEC`, `RESET_RATE_LIMIT_MAX`, `RESET_RATE_LIMIT_WINDOW_SEC` (ver `.env.example`).

## Riesgos

- El link (con token) queda en logs del servidor. Mitigación: token de uso único + expiración 1 h + logs locales al NAS; al conectar un proveedor real desaparece.
- Si el usuario no sabe leer logs, el flujo "no funciona" para él. Mitigación: es provisional y explícito en la etiqueta `PROVISIONAL`; el swap a proveedor real está diseñado para ser trivial.

## Validación

- Unit: `LogEmailSender` loguea destinatario + link + etiqueta (spy de `console.log`).
- Integración: `CapturingEmailSender` verifica destinatario y formato del link en el flujo completo `requestReset` → `resetPassword`.
