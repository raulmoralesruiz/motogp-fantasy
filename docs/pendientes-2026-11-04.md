# Pendientes (snapshot 2026-11-04)

> Resumen de trabajo pendiente tras cerrar el **bloque 1** (T-21 + D-03/D-05/D-09 + limpieza US-36/US-32, commit `7f89d31`).
> **No es fuente de verdad:** la lista de trabajo oficial sigue siendo `docs/backlog.md`; este fichero es una instantánea con opciones, esfuerzo y decisiones por tomar.

## Estado

- **Bloque 1 (rápidos): ✅ cerrado** — T-21 (gate `npm audit`, ADR-0038), D-03/D-05 (ratificación), D-09 (polling 5 min, ADR-0019 addendum), US-36 (dominio Resend verificado) y US-32 (10/10) actualizadas en backlog.
- **CI de `7f89d31`:** pendiente de verificar (lint → audit gate → typecheck → tests fusionados + cobertura 99.9% → build; docker; gitleaks).

## Bloque 2 — D-07: 2FA para `global_admin` (seguridad P1, la última P1 abierta) — ✅ **cerrado (2026-11-04, ADR-0039)**

**Opción A (TOTP RFC 6238)** implementada y verificada:

- Núcleo puro `identity/core/totp.ts` (base32 RFC 4648, `computeTotp` HMAC-SHA1 RFC 6226/6238, `verifyTotpCode` ventana ±1 — vectores oficiales en tests) + `TotpChallengeStore` (Redis en prod `totp:challenge:*`/`totp:fail:*`; in-memory con reloj inyectable en tests).
- **Login de 2 pasos:** contraseña ⇒ reto opaco de vida corta (`TOTP_CHALLENGE_TTL_SEC=300`); la sesión solo existe al canjear el código (`verifyTotp`). Doble presupuesto de intentos: por reto (`TOTP_MAX_ATTEMPTS=5`) y por cuenta (reutiliza el bloqueo del login). **Detalle de seguridad (hallado por la integración):** el login 2FA con contraseña correcta NO resetea el contador de fallos de la cuenta — si lo hiciera, un atacante con la contraseña rotaría retos infinitamente sin bloquearse (ADR-0039 + test unit de regresión + el test de integración de fuerza bruta).
- `enrollTotp` (queda **pendiente**) / `confirmTotp` (activo) / `disableTotp` con re-autenticación de contraseña; re-matricular sustituye el secreto y vuelve a pendiente.
- QR **server-side** (`qrcode` → SVG data-URI; la URI lleva el secreto: nunca sale a servicios externos — ADR-0039). `audit:ci` confirma 0 hallazgos nuevos.
- Auditoría `totp.enrolled`/`totp.enabled`/`totp.disabled`; GDPR: `account-service` limpia `totp_secret`/`totp_enabled_at` al anonimizar; `PublicUser.totpEnabled`; `profile.me` expone `totpEnabled`/`totpEnrolled`.
- UI `/perfil → Seguridad` (4 estados: desactivado, matriculación con QR, pendiente, activo) + login de 2 pasos en `login-form`.
- Migración `20261104120000_user_totp` (verificada: aplica limpia en NAS/CI).
- **Puertas:** lint 0, typecheck, pureza, unit 880/880, UI 501/501, build OK, **integración 496/496 (NAS, Testcontainers, PostgreSQL real)** (incluida la corrección del setup: `waitForTcp` + reintento acotado del `migrate deploy` — race de publicación de puerto en el daemon del NAS que causaba P1001), `audit:ci` 0 nuevos.
- Docs: ADR-0039, `security.md` §5 (resuelta), `backlog.md` D-07 (Hecho), runbook §9 (recovery de 2FA del `global_admin`), `estado-actual.md`, `.env.example`/`.env.prod.example` (`TOTP_CHALLENGE_TTL_SEC`/`TOTP_MAX_ATTEMPTS`), AGENTS.md (estado + ADR map 0039).
- **Commit + push: ✅ (`c1bc607`, 2026-11-04).** CI de `c1bc607`: 2 jobs en rojo (Gitleaks: falsos positivos sobre vectores de test con la "latest" sin pin; gate de cobertura 99.65% < 99.9%: el borde Redis de 2FA no estaba cubierto) → **corregidos en el árbol de trabajo (2026-11-04): ADR-0040** (pin `GITLEAKS_VERSION: 8.30.1` en CI + `.gitleaks.toml` con 2 excepciones documentadas y acotadas) **+ 19 tests nuevos** (borde Redis de 2FA, ramas NOT_FOUND del servicio, estados/errores de la UI de 2FA). Puertas finales: lint 0, typecheck, pureza, unit 893, UI 507, build, **cobertura 99.9283% ≥ 99.9% (NAS, Testcontainers, 171/171 archivos)**, gitleaks 8.30.1 simulando el modo exacto de la acción → 0 hallazgos (control positivo: un secret inyectado fuera de las rutas exentas sigue detectado). **Pendiente: commit + push del fix (permiso del usuario) y CI en verde.**

## Bloque 3 — Operación (producción en "modo provisional")

- **3a. Copia off-site de backups** (riesgo residual ADR-0037 §3: dumps en la misma pool `data-nas`): script semanal + cifrado (age/gpg) + cron + runbook §4 + addendum. **Decisión: destino** (USB en el NAS / rsync a otro servidor / cloud object storage, dumps ~300 KB). **Esfuerzo: pequeño.**
- **3b. Sentry** (T-14 desactivado, DSN vacía; el código es idéntico, solo cambia la DSN — ADR-0036): **decisión** free tier sentry.io (30 min) / self-hosted TrueNAS (medio día) / seguir desactivado.
- **3c. `OPS_ALERT_EMAIL`:** verificar que está fijado + probar el disparo real (posible `admin.sendTestAlert`). **Esfuerzo: pequeño.**
- **3d. `WELCOME_LEAGUE_ID` (US-31, desactivada):** **decisión** activar (crear liga + env + re-desplegar + prueba) o dejar desactivada. **Esfuerzo: 15–30 min.**
- **3e. Métrica de concentración** (objetivo de validación, no gate): script que mide % de lineups con ≥2 pilotos del mismo constructor sobre datos reales. **Esfuerzo: pequeño.**

## Bloque 4 — E8 (post-MVP, P2)

- **4a. US-40 — Web push** (la más natural; US-36 ✅): VAPID + service worker + `push_subscriptions` + canal push en `NotificationService` (mismos eventos) + dep `web-push` justificada + toggle en `/perfil` + tests. **Esfuerzo: mediano.** Valor alto.
- **4b. US-35 — Ligas temporales/personalizadas:** primero definir el producto (p. ej. mini-torneo de 3 GPs con ranking propio). **Esfuerzo: mediano.**
- **4c. US-37 — Estadísticas y analítica:** histórico de puntos por piloto/activo + métricas de uso. Más útil con datos reales. **Esfuerzo: mediano.**
- **4d. US-33 + US-34 — Sportradar + backfill histórico:** requieren verificación contractual de SLA primero (integrations.md §2.2). Solo si hay tracción.
- **4e. US-38 — Demand-driven:** solo con peticiones reales. No ahora.
- **4f. T-23 — Majores deliberados** (cierra todo `audit-baseline.json`): next 15→16, prisma 6→7, **zod 3→4** (el más arriesgado: toda la validación), vitest 2→5, @types/node 24. Uno a uno, CI verde tras cada bump + borrar entradas del baseline. **Esfuerzo: grande (2–4 unidades).**

## Orden propuesto

1. ✅ **D-07 TOTP** — cerrado (ADR-0039; pendiente commit+push y CI)
2. **Operación**: off-site + Sentry free tier + `OPS_ALERT_EMAIL` + decisión `WELCOME_LEAGUE_ID`
3. **US-40** (la feature con más valor por coste)
4. **T-23** (mejor sin otra cosa en marcha; bumps con riesgo de regressión)
