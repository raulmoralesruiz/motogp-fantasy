# ADR-0033: Notificaciones por email (US-36) — Resend como proveedor, opt-out por usuario

- **Estado:** Aceptado (2026-11-01) — implementado y verificado localmente (lint 0, typecheck, pureza, unit 737, UI 479, build); integración en CI (sin Docker local)
- **Fecha:** 2026-11-01
- **Relacionado:** US-36 (backlog E8), US-02/ADR-0009 (patrón de envío de email inyectable), US-18/ADR-0020 (definitivo) y US-19/ADR-0021 (recálculo por corrección) — los dos eventos que se notifican, T-09 (auditoría append-only), `security.md` §1.11/§3, `runbook.md` §6.

## Problema

El usuario no recibe aviso cuando ocurre algo que le afecta: la publicación de los **resultados definitivos** de un GP o la aplicación de un **recálculo** (corrección de resultados). Hoy solo descubre el cambio al abrir la app. El backlog (US-36) pide "notificación al publicarse resultados definitivos y al aplicar un recálculo" y deja el canal (push/email) abierto.

Decisiones a tomar: **canal** (email vs push), **proveedor** de email, **destinatarios** (¿solo quien tiene lineup? ¿todas las ligas?), **semántica de fallo** (¿un email fallido rompe el definitivo?) y **preferencias de usuario**.

## Opciones

1. **Email transaccional (elegido):** canal maduro, sin infraestructura nueva (ni service worker, ni VAPID, ni push subscriptions), llega a cualquier dispositivo. Proveedor: **Resend** (API REST, plan gratuito 100 emails/día + 3000/mes — suficiente para el volumen real: un GP definitivo notifica a los miembros de las ligas con ranking, decenas como mucho).
2. **Web push (VAPID + service worker):** sin proveedor externo, pero requiere navegador abierto/registrado, permisos de push, service worker y tabla de suscripciones; más superficie de ataque y más código para el mismo aviso. Se difiere a **US-40** (reutilizando la base de US-36: mismo servicio, mismos eventos, ajustes de usuario).
3. **Ambos a la vez:** duplica el trabajo del MVP de notificaciones; el canal push no aporta nada hasta que no exista el canal base.

Sobre el envío: **Resend vía REST `fetch`** (cero dependencias npm — mismo enfoque que PulseLive, ADR-0019) frente a la librería oficial `@resend/react` (añade una dependencia para una única llamada `POST /emails`).

## Decisión

**Email vía Resend**, con estas reglas:

- **Eventos notificados (2):** `definitive_published` (tras `markDefinitive` con commit, excluido el no-op) y `recalculation_applied` (tras una corrección que dispara recálculo, US-19). Son los dos momentos en que la puntuación/ranking de un GP cambia de forma definitiva.
- **Destinatarios:** **miembros activos** de las ligas que tienen **ranking en el GP** (la liga "pertenecer" al GP se deriva de `rankings` — `League` no tiene `seasonId`, invariantes 4/5), **incluyendo miembros sin lineup** (reciben el aviso aunque no puntúen; son parte de la liga) y **excluyendo** usuarios anonimizados (GDPR) y con email deshabilitado. Las ligas sin ranking en el GP no notifican (nadie puntuó allí).
- **Opt-out por usuario:** tabla `notification_settings` (`userId` PK, `emailEnabled` default `true`). **Sin fila ⇒ habilitado** (no hay que hacer nada para recibir). Se gestiona en `/perfil` (`notifications.settings` / `notifications.updateSettings`, `protectedProcedure`; el `userId` sale siempre de la sesión).
- **Nunca bloquea el flujo principal:** el envío corre **después** del commit de `markDefinitive`/recálculo (orquestación BFF en el router `results`, patrón US-21 — `results` no importa `notifications`). Un fallo individual se loguea y se audita (`notification.sent` con `sent`/`failed`/`failedEmails`); el resto de destinatarios sigue recibiendo.
- **Proveedor inyectable (frontera de I/O, patrón US-02/ADR-0009):** `ResendEmailSender` (producción) / `LogNotificationSender` (dev/tests: loguea con etiqueta `[notification]`). `RESEND_API_KEY` vacía ⇒ modo provisional sin proveedor. Cambiar de proveedor = sustituir una clase.
- **Secretos:** `RESEND_API_KEY` solo por env (security.md §3); `EMAIL_FROM` es el remitente verificado (no es secreto). Documentados en `.env.prod.example` y `runbook.md` §6.
- **Auditoría:** una entrada `notification.sent` por envío (append-only, T-09), con el resultado agregado; 0 destinatarios ⇒ sin envío ni auditoría.

### Cambios de código

- `app/modules/notifications/` (nuevo): `notification-service.ts` (`NotificationService`: `notifyDefinitivePublished`/`notifyRecalculationApplied`/`getSettings`/`updateSettings` + resolución de destinatarios por SQL + contenido de email en español), `email-sender.ts` (contrato `NotificationEmailSender` + `LogNotificationSender`), `resend-sender.ts` (`ResendEmailSender`: `POST https://api.resend.com/emails`, `fetchImpl` inyectable), `sender-selection.ts` (`chooseNotificationSender`: con API key → Resend, sin ella → log — función pura de la configuración, testable sin env), `index.ts`.
- `prisma/schema.prisma` + migración `20261101120000_notification_settings`: tabla `notification_settings` (FK `users` `ON DELETE CASCADE`).
- `app/shared/validation/notifications.ts` (nuevo): `updateNotificationSettingsInputSchema`.
- `app/server/env.ts`: `RESEND_API_KEY` (default `""`) y `EMAIL_FROM` (default `Fantasy MotoGP <onboarding@resend.dev>`).
- `app/server/routers/notifications.ts` (nuevo): `createNotificationsRouter` (inyectable) + `getDefaultNotificationsRouter` + `createDefaultNotificationService` (factory compartida con el router `results`).
- `app/server/routers/results.ts`: dep opcional `notifications?` (`NotificationService`) + helper `notify()` (`.catch` con log) + hooks en `markDefinitive` (si `!noop && resultsVersion`) e `importEvent` (si `recalculated && resultsVersion`); `getDefaultResultsRouter` inyecta `createDefaultNotificationService(prisma)`.
- `app/server/routers/_app.ts`: router `notifications` registrado.
- `app/perfil/perfil-page.tsx`: sección "Notificaciones" (checkbox + guardar) sobre `trpc.notifications.*`.
- **Tests:** unit `app/modules/notifications/__tests__/` (servicio: destinatarios, contenido, fallos individuales, auditoría, ajustes; sender Resend: petición/errores/`fetchImpl`; log sender; `chooseNotificationSender`: ambas ramas) + integración `test/integration/notifications.test.ts` (settings por defecto/401, `updateSettings`, `markDefinitive` → 3 miembros de la liga con ranking (incluido el sin lineup), liga sin ranking no notifica, no-op sin notificación, corrección → `recalculation_applied` excluyendo email deshabilitado, auditoría, **fallo grave del servicio → el recálculo se completa igualmente (el fallo se loguea, no bloquea)**) + UI `app/perfil/__tests__/perfil-page.test.tsx` (checkbox, guardar, éxito, error).
- **Docs:** `backlog.md` (US-36 hecho + US-40 push diferido), `estado-actual.md`, `security.md` §1.11/§3, `runbook.md` §6, `.env.prod.example`.

## Consecuencias y límites

- **Volumen:** un GP definitivo con N ligas activas y M miembros ⇒ `N·M` emails (los destinatarios se deduplican por email). Con el plan gratuito (100/día, 3000/mes) es holgado para el uso real; el runbook (§6) documenta cómo vigilar el contador y qué hacer si se excede.
- **Sin historial de envíos en BD:** el registro es la auditoría (append-only), coherente con T-09 y con la ausencia de filas de "email enviado" en el resto de la app (US-02).
- **El link del email apunta a `/resultados`** (la página elige el GP; no lee query params — no se añade una para esto).
- **Push (US-40)** se construirá sobre esta base: mismo `NotificationService`, mismos eventos, canal inyectable y toggle de usuario adicional.
