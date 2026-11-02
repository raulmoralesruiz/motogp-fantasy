# ADR-0036: Monitoreo — Sentry + alertas de fallos de jobs + health-check de la fuente (T-14)

- **Estado:** Aceptado (2026-11-02)
- **Fecha:** 2026-11-02
- **Relacionado:** T-14 (backlog: "Sentry captura errores con contexto; métricas de los jobs (import, recalcular, precios) con alerta de fallo; el health-check de la fuente de datos (PulseLive) alerta si deja de responder"), `overview.md` (fila "Monitoreo: Sentry (errores) + métricas básicas"), T-10/ADR-0034 (worker BullMQ + lock por GP; fallos hoy solo logueados), US-17/ADR-0019 (polling + `source_state` con umbral de alertas sin consumidor), US-36/ADR-0033 (sender de email reutilizable), T-02 (`/api/health` liveness).

## Problema

Hoy un fallo de la app es invisible hasta que un usuario lo reporta:

1. **Errores sin contexto:** las excepciones de la web (servidor/cliente) y del worker salen por `console.error` a los logs del contenedor. No hay agrupación, stack trace legible ni aviso.
2. **Alertas de polling sin consumidor:** US-17 emite `PollAlert` al alcanzar `failureAlertThreshold` (3) y persiste `source_state.consecutive_failures`, pero **nadie los consume**: ni email, ni Sentry, ni panel.
3. **Salud de la fuente fuera de ventana:** el polling solo sondea PulseLive cuando hay un GP en `[now−48h, now+24h]`. Si la fuente deja de responder **fuera** de esa ventana (o con 0 GPs enlazados), nada lo detecta.
4. **Fallos finales de job sin aviso:** BullMQ reintenta con backoff y el `failed` solo lo loguea el worker (`worker/index.ts`).

`overview.md` ya comprometía "Sentry (errores) + métricas básicas" como stack de monitoreo; esta ADR la implementa.

## Opciones

1. **Sentry + alertas de email (Resend existente) + panel admin (elegida):** Sentry (self-hosted en TrueNAS, opción principal; sentry.io free tier como alternativa) captura errores con contexto; las alertas operativas van **en la transición** al umbral de fallos (email a `OPS_ALERT_EMAIL` + Sentry) y un panel de admin muestra estado de colas, alertas activas y salud de la fuente con probe a demanda. Reutiliza el sender de US-36 y el umbral de US-17; no añade ninguna dependencia nueva de email.
2. **Solo Sentry (reglas de notificación del panel):** descarta el email. Rechazada: el operador puede no mirar el panel; el email llega aunque no haya navegador abierto (el servidor no tiene IP pública: el email es el canal de salida natural, como US-36).
3. **Solo logs + cron de health-check:** sin agregación de errores ni stack traces; reintroduce el problema 1. Rechazada.
4. **Prometheus/Grafana:** métricas continuas, pero añade un stack de infra más pesado que Sentry para un app de un único operador y no resuelve la captura de errores con contexto (mitad de la CA). Fuera de alcance; Sentry cubre los errores y el panel cubre el estado puntual.

## Decisión

**Sentry (SDK `@sentry/nextjs` v11 web + `@sentry/node` worker) + alertas en transición por email + panel "Jobs y fuentes" en `/admin`.**

### 1. Sentry

- **DSN opcional:** `NEXT_PUBLIC_SENTRY_DSN` por env (comentado en `.env.example`). Vacío ⇒ **desactivado** (los envoltorios son no-op; mismo espíritu "modo provisional" que `RESEND_API_KEY` vacía, ADR-0009/ADR-0033). Así T-14 se deploya antes de que Sentry esté arriba.
- **Instalación (infra, fuera del código): self-hosted en TrueNAS** (stack oficial de Docker de Sentry), con el free tier de sentry.io como alternativa ligera. El código es idéntico: solo cambia el DSN. Documentado en `deploy.md` y en el runbook.
- **Contexto:** tags en cada captura (ruta tRPC, cola, GP); `dataCollection` restringida por GDPR (sin `userInfo`, sin cookies, sin headers, sin query params, sin bodies — el dato privado que importa es el stack trace y nuestros tags, no el tráfico).
- **Superficie:** web (errores de servidor vía `onRequestError`, errores de render vía `global-error.tsx` + ErrorBoundary, errores de cliente vía `instrumentation-client.ts`) + worker (`@sentry/node` en `worker/index.ts`) + tRPC (`onError` captura solo `INTERNAL_SERVER_ERROR` — los rechazos esperados `FORBIDDEN`/`NOT_FOUND`/`BAD_REQUEST` no son errores: no spamean).
- **CSP:** `connect-src` se amplía con el host del DSN **solo si está fijado en el build** (DSN autohospedado o SaaS); sin DSN la CSP sigue siendo `connect-src 'self'` (T-20 intacta).

### 2. Alertas de fallos (canal doble: email + Sentry)

- **Destinatario:** `OPS_ALERT_EMAIL` por env (vacío ⇒ solo Sentry + log; no rompe nada — el sink nunca lanza).
- **Política de transición (núcleo puro, `modules/jobs/alerts.ts`):** se alerta **al cruzar el umbral** (`prev < N ∧ new ≥ N`) y **al recuperar** (`prev ≥ N ∧ new < N`); mientras el fallo persiste **no se repite** (evita un email por ciclo de 5 min durante horas). Misma política para:
  - **Polling de resultados** (US-17): transición sobre `source_state.consecutive_failures` (umbral `failureAlertThreshold` = 3, ya en `PROVISIONAL_RESULTS_POLL`).
  - **Probe de la fuente** (nuevo): cada ciclo del worker (cada 5 min, `results-poll`) sondea el endpoint ligero de PulseLive (`GET /results/seasons`, timeout 5 s — `PROVISIONAL_SOURCE_PROBE`) **aunque no haya GPs en ventana**; el estado (fallos consecutivos, último error, última latencia) vive en Redis (`mon:source:probe`) y el umbral es el mismo (3).
  - **Fallo final de job** (BullMQ `failed` tras agotar `attempts` = 3, `PROVISIONAL_JOBS`): uno por job, con cola + motivo.
- **Recálculo (inline, ADR-0034):** no es job de cola: sus errores salen como tRPC `INTERNAL_SERVER_ERROR` → Sentry (`onError`) + auditoría (ya existe). No añade alerta de email dedicada: un admin está frente al panel cuando recalcula.
- El **sink** (`app/server/alert-sink.ts`) compone: email vía `chooseNotificationSender` (Resend/Log, US-36) + `captureMessage`/`captureException` de Sentry + log. **Nunca lanza** (un fallo de notificación no puede romper el ciclo que dispara la alerta).

### 3. Métricas y panel ("Jobs y fuentes")

- `admin.jobsStatus` (solo `global_admin`): counts BullMQ por cola (waiting/active/delayed/completed/failed), último job fallido (motivo + momento), alertas activas (`source_state` con `consecutive_failures ≥ umbral`), estado del probe de la fuente (Redis) y si Sentry está habilitado.
- `admin.sourceHealth` (solo `global_admin`): **probe a demanda** al endpoint ligero de PulseLive → `{ ok, latencyMs, error, probedAt }` (el botón "Comprobar fuente" del panel; no muta el estado del probe automático).
- UI: sección nueva en `/admin` (tarjeta, patrón `fae839c`) + entrada en la navegación por anclas.

## Consecuencias

- **Positivas:** CA de T-14 completa y testeable; las alertas ya existían en datos (`PollAlert`, `source_state`) pero no llegaban a nadie; la salud de la fuente se cubre también fuera de ventana de GP; Sentry desactivado por defecto ⇒ cero fricción hasta que TrueNAS tenga el stack arriba; el email reutiliza Resend (0 dependencias npm de email).
- **Negativas / riesgos:** 2 dependencias npm nuevas (`@sentry/nextjs`, `@sentry/node`); el stack self-hosted de Sentry es pesado (~10 contenedores, 6–10 GB de RAM) — mitigado con la alternativa free tier documentada; un email por transición puede llegar fuera de horario — aceptado (es un aviso de fallo, no de marketing) y es un solo email por incidente (no por ciclo).
- **Datos enviados a Sentry:** solo errores + tags + contexto restringido (sin PII por diseño: `dataCollection` cerrada, AGENTS.md §8 GDPR).

## Reversibilidad

Alta: vaciar `NEXT_PUBLIC_SENTRY_DSN` desactiva Sentry (los capturers son no-op); vaciar `OPS_ALERT_EMAIL` apaga el canal de email; la UI y el sink no existen sin los envs. Los datos persistidos (estado del probe en Redis, `source_state`) son operativos y se pierden sin consecuencia al purgar.
