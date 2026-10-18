# ADR-0011: Política de cobertura — gate unitario delimitado + objetivo global ≥95% con cobertura fusionada

- **Estado:** Aceptado (confirmado por el usuario, 2026-10-18) — **objetivo final aplicado (addendum, T-24 cerrado 2026-10-19)**
- **Fecha:** 2026-10-18 (addendum: 2026-10-19)
- **Suplanta a:** la calibración informal del umbral global de 2026-10-15 (60 → 39 en `vitest.config.ts`, sin registro de decisión).

## Problema

El gate de cobertura global de `npm run test:coverage` (y del job `quality` de CI) llevaba **rojo desde el commit de US-02** (2026-10-16): el umbral `lines: 39` se calibró el 2026-10-15 a la medida real de entonces (39.67%), y desde entonces US-02 + T-08, T-09 y US-04 añadieron ~3.200 líneas de código cuya cobertura la aporta la **suite de integración** (Testcontainers, `test/integration/**`), que corre por separado y **no alimenta el reporte unitario**. La cobertura global de líneas cayó a 28.37% (576/2030) y el gate fallaba.

Desglose de las 1.454 líneas sin cubrir en el reporte unitario:

| Zona                                                                    | Líneas | Responsable real                       |
| ----------------------------------------------------------------------- | ------ | -------------------------------------- |
| `server/` + `server/routers/` (env, prisma, redis, trpc, routers)       | ~470   | Integración / e2e                      |
| UI de pantallas (registro, login, recuperar, reestablecer, admin, home) | ~570   | Integración / e2e (Playwright, Fase 5) |
| `identity/auth-service.ts` + I/O de `sessions.ts` + `password.ts`       | ~280   | Integración (PG real)                  |
| `seasons/season-service.ts` + `admin/audit.ts`                          | ~150   | Integración (PG real)                  |
| `trpc/client.tsx`, `api/`, `shared/components`                          | ~100   | e2e                                    |

Las capas que sí son responsabilidad del suite unitario estaban sanas: `economy` 96.6%, `scoring` 100%, `shared/validation` 98%, `shared/config` 93%, puras de `identity` ≥93%.

## Opciones

1. **Recalibrar el umbral a 28%** (misma práctica que en 2026-10-15: 60 → 39).
   - Mínimo cambio (1 línea), pero es un **ratchet a la baja**: cada nueva épica (US-05…US-08, E4, E5) añade 1.000–3.000 líneas de services/routers/UI cubiertas por integración y bajaría el umbral más (~22% tras US-05, ~15% por E5). El gate global acabaría sin significado.
2. **Delimitar el gate unitario a la capa unit-testeable** (interina, elegida).
   - `coverage.include: ["app/modules/**", "app/shared/**"]` + exclusión explícita de los servicios con transacciones Prisma (cubiertos por integración) y de `shared/components` (UI, responsabilidad de e2e/RTL).
   - El gate mide lo que el suite unitario es responsable de: estable hacia adelante (los nuevos services/routers/UI quedan fuera; el código puro/shared sube el número).
3. **Fusionar la cobertura de integración en el reporte** (unit + integración en un solo `vitest run --coverage`).
   - Cobertura "global" real (~95% alcanzable), pero `npm run test:coverage` local pasa a requerir Docker (Testcontainers) y el job de CI se reestructura. No es proporcional como arreglo de emergencia; es el objetivo final.

## Decisión

**Opción 2 ahora (gate interino) + opción 3 después (T-24, P1, antes del MVP).**

### Gate interino (aplicado en este ADR)

- Alcance: `app/modules/**` + `app/shared/**`.
- Exclusiones explícitas (cada una justificada; añadir una más es una decisión visible en el diff):
  - `app/modules/identity/auth-service.ts`, `app/modules/seasons/season-service.ts`, `app/modules/admin/audit.ts` — transacciones Prisma; los cubre la suite de integración con PG real.
  - `app/shared/components/**` — primitivas de UI; las cubren e2e (Playwright, Fase 5) y T-24 (React Testing Library).
  - Patrones default de vitest (`**/__tests__/**`, `**/*.test.*`, …) — **re-añadidos a mano porque en vitest fijar `coverage.exclude` sustituye a los defaults** (descubierto al implementar este ADR: sin ellos, los test files entraban en el reporte e inflaban la medida de 84.8% a 91.5%).
- Umbral global unit: **84** (medida real 2026-10-18: 559/659 = 84.83%). Historial: 60 (Fase 0) → 39 (2026-10-15) → 84 (2026-10-18).
- Sub-umbrales `economy`/`scoring` ≥90% (líneas/enunciados/funciones) intactos.

### Objetivo final (T-24, antes del MVP)

- `vitest.full.config.ts`: unit + integración en un solo `vitest run --coverage` (global-setup de Testcontainers); `npm run test:coverage` pasa a ser el run fusionado (requiere Docker; en CI el job `quality` lo corre como hoy).
- Tests nuevos: unit con mocks (`env.ts`, `rate-limit-redis.ts`, contexto `trpc.ts`, `errors.ts`) + React Testing Library para la UI (pantallas, admin, `shared/components`, `trpc/client`).
- Exclusiones explícitas de glue real: `prisma.ts` y `redis.ts` (singletons) y `api/trpc/**/[trpc]/route.ts` (one-liner `trpcToNextHandler`).
- Recalibración del umbral global a la medida real (objetivo ≥95%) + addendum a este ADR.

## Justificación

- **El gate debe medir la responsabilidad de cada suite.** La caída a 28.37% no era un déficit de tests: era un déficit de _alcance_ — el reporte unitario penalizaba código que la suite de integración cubre con PG real. Delimitar el alcance arregla la causa, no el síntoma.
- **Estabilidad hacia adelante.** Con el alcance delimitado, US-05…US-08 y E4/E5 añaden services/routers/UI (fuera del gate) y código puro/shared (dentro, subiendo el número). No hay recalibración por cada épica; la única recalibración prevista es la de T-24 (hacia arriba).
- **El objetivo ≥95% real se mantiene vivo** (T-24 + D-08): 100% de líneas no es un objetivo de calidad en sí mismo (mide ejecución, no verificación de comportamiento); "≥95% global real + exclusiones explícitas y justificadas" sí lo es, y es alcanzable con la cultura de tests existente (golden files, integración con PG real).
- **Coherencia con el repo:** el umbral global era ya PROVISIONAL (D-08); esta decisión no fija el umbral definitivo, delimita el alcance interino y registra el camino al definitivo.

## Impacto técnico

- `vitest.config.ts`: `coverage.include` = `app/modules/**` + `app/shared/**`; `coverage.exclude` = patrones default de test + 3 servicios Prisma + `shared/components/**`; umbral global `lines: 84`.
- `docs/architecture/testing.md` §4: definición de los dos gates (unit delimitado / global fusionado en T-24).
- `docs/backlog.md`: nueva tarea **T-24** (P1, antes del MVP) + nota en D-08.
- El ADR de la fuente de calendario de US-05 pasa a ser **ADR-0012**.

## Riesgos

- **Exclusiones obsoletas:** si un servicio excluido acumula lógica unit-testeable, esa lógica queda fuera del gate. Mitigación: la lista es explícita y corta (3 archivos); revisar en T-24 (los servicios pasan a medirse por la cobertura fusionada).
- **Margen del umbral:** 84.83% medido vs 84 de umbral (0.8 pts). Un cambio pequeño (p. ej. un barrel nuevo sin test) podría rozar el umbral. Mitigación: el código que entra en el alcance (US-05: `gp-status` puro, normalización de calendario con fixtures, schemas Zod) va acompañado de tests unitarios por Definition of Done, así que la tendencia es hacia arriba; si el gate falla, se recalibra a la medida con nota en el comentario (práctica establecida).
- **T-24 se retrasa:** el gate interino sigue siendo válido y estable; solo se pospone la recalibración al ≥95%.

---

## Addendum — T-24 cerrado (2026-10-19)

El **objetivo final (opción 3) queda aplicado**. T-24 se cierra el 2026-10-19 (árbol de trabajo, pendiente de commit).

### Medida final

- **Cobertura global fusionada: 99.94% de líneas (3385/3387)**, 479 tests / 68 archivos, EXIT=0 (`vitest.full.config.ts`, 2026-10-19). Objetivo ≥95% superado.
- **Única línea no cubierta de la app:** `app/modules/economy/pricing.ts` L87-88 — el guard defensivo `prevPrice === undefined` de `buildPriceSeries`: **inalcanzable por construcción** (el array `precio` se rellena secuencialmente desde el índice 0 y el bucle arranca en `gp=2`, por lo que `precio[gp-2]` siempre está definido). Es una exclusión justificada por naturaleza, no por conveniencia; el gate (99.9%) la deja sin cubrir sin romper.

### Decisiones aplicadas

- **Umbral global fusionado: `lines: 99.9`** en `vitest.full.config.ts`. Historial del umbral global: 60 (Fase 0) → 39 (2026-10-15) → 84 unit (2026-10-18, interino) → **99.9 fusionado (2026-10-19, definitivo)**.
- **Exclusiones del run fusionado** (todas justificadas en el comentario del config):
  - Patrones default de test (re-añadidos a mano: en vitest fijar `coverage.exclude` sustituye a los defaults).
  - `app/server/prisma.ts` y `app/server/redis.ts` — glue real (singletons de conexión perezosa); su comportamiento lo cubren la integración y el smoke HTTP de CI.
  - `app/api/trpc/**` — handler tRPC de Next.js (glue de un solo archivo); lo cubren el smoke HTTP de CI y la suite e2e (Playwright, Fase 5).
- **El gate unit (84) sigue vigente** como gate rápido local (sin Docker): `vitest.config.ts` con alcance `app/modules/**` + `app/shared/**`. El gate fusionado (`npm run test:coverage`, requiere Docker) es el gate global real y el que corre CI.
- **CI:** el job `quality` pasa de dos pasos de tests (unit + integración) a **un único paso fusionado** (`npm run test:coverage` = unit + integración + UI + gate de cobertura).
- **Tests nuevos del empujón final (97.31% → 99.94%):**
  - `gp-service` (8 tests, prisma falso por DI): violaciones de unique concurrentes (P2002 → reutilizar/CONFLICT), errores no-P2002 re-lanzados, NOT_FOUND, ordenación de eventos con tie-break por `orderNum` y revalidación del calendario antes de tocar BD.
  - `season-service` (2 tests): revalidación server-side de reglas (BAD_REQUEST sin tocar BD).
  - `auth-service` (1 test): reclamación atómica con `updateMany` count 0 → UNAUTHORIZED genérico.
  - `password` (3 tests): round-trip argon2id, hash malformado → `false` (sin lanzar), hash de relleno memoizado.
  - Barrels placeholder de `results`/`market`/`lineups`/`leagues`/`jobs` (1 test) y barrels de `shared/config` + `shared/validation` (2 tests).
  - `assertProvisionalRulesValid` caso de fallo (1 test, archivo separado con `vi.mock` del esquema).
  - `calendar-source` (+2): `date_end` inválido y categoría MotoGP ausente.
  - `budget` (+1): dispatch de la opción C.
  - UI: `admin/page` (estados pendientes + refetch tras importar calendario), `gp-actions` (éxito de `addEvent` + errores generales de lockout/addEvent), `register-form` (error de campo de términos) y `create-gp-form` (error de campo de circuito).
- **D-08 cerrado** (umbrales de cobertura): `economy`/`scoring` ≥90% + global fusionado 99.9%.
