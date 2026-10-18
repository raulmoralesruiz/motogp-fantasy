# Cómo colaborar

Bienvenido/a. Este repo es **Fantasy MotoGP Independiente**: un juego de fantasy de MotoGP propio (sin licencias ni APIs oficiales), multi-liga, con una economía diseñada para ser justa y transparente.

Antes de escribir código, 10 minutos de lectura en este orden:

1. [`README.md`](README.md) — qué es el proyecto y su estado.
2. [`docs/architecture/estado-actual.md`](docs/architecture/estado-actual.md) — **el código que existe hoy**, archivo a archivo.
3. [`docs/backlog.md`](docs/backlog.md) — el trabajo pendiente (IDs, prioridades, dependencias, criterios de aceptación).
4. [`AGENTS.md`](AGENTS.md) — las reglas operativas del repo (fuentes de verdad, invariantes, prohibiciones).

## Requisitos

- **Node.js 24** + npm.
- **Docker** (PostgreSQL 16 + Redis 7 para desarrollo; Testcontainers para los tests de integración).

## Quickstart

```bash
git clone git@github.com:raulmoralesruiz/motogp-fantasy.git
cd motogp-fantasy

cp .env.example .env        # los valores por defecto sirven para local
npm install                 # postinstall ejecuta `prisma generate`
npm run db:up               # PostgreSQL 16 + Redis 7 (docker compose)
npm run db:migrate          # aplica las migraciones de Prisma
npm run dev                 # http://localhost:3000
```

**Verifica que funciona:** la pantalla de inicio muestra el estado del sistema (app + BD + Redis) como _operativa_; `/registro` crea una cuenta y `/login` entra con ella.

Opcional: `npm run seed:fiction` carga el dataset ficticio canónico (economy.md §7) para trabajar contra datos.

## Comandos

| Comando                                   | Propósito                                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                             | Desarrollo (app + API) en `http://localhost:3000`.                                                                              |
| `npm run build`                           | Build de producción (ejecuta antes el check de pureza).                                                                         |
| `npm run start`                           | Sirve el build de producción.                                                                                                   |
| `npm run lint` / `npm run lint:fix`       | ESLint.                                                                                                                         |
| `npm run typecheck`                       | `tsc --noEmit`.                                                                                                                 |
| `npm run format` / `npm run format:check` | Prettier (formato; la Definition of Done exige `format:check` en verde).                                                        |
| `npm run test`                            | Unit (Vitest). No requiere Docker.                                                                                              |
| `npm run test:ui`                         | UI (React Testing Library, jsdom). No requiere Docker.                                                                          |
| `npm run test:coverage`                   | **Run fusionado** unit + integración + UI con gate de cobertura global (99.9%, T-24). Requiere Docker; es el gate que corre CI. |
| `npm run test:integration`                | Integración (Testcontainers, PostgreSQL real). Requiere Docker.                                                                 |
| `npm run check:purity`                    | Falla si `economy`/`scoring` violan su pureza (también corre en `build`).                                                       |
| `npm run db:up` / `npm run db:down`       | Arranca/para PostgreSQL + Redis locales.                                                                                        |
| `npm run db:migrate`                      | Aplica migraciones de Prisma (`prisma migrate dev`).                                                                            |
| `npm run seed:fiction`                    | Carga el dataset ficticio en la BD local.                                                                                       |
| `npm run simulate` / `simulate:fiction`   | Re-ejecuta la simulación económica (economy.md §7).                                                                             |

## Tests

- **Unit** (`npm run test`): fórmulas puras de `economy`/`scoring`, validación Zod, sesiones, rate limit, CORS, check de pureza. Rápidos y sin Docker.
- **Integración** (`npm run test:integration`): registro/login contra PostgreSQL real, invariantes de BD (incluido el trigger de composición del lineup) e importación idempotente. Sube 1 contenedor de PostgreSQL por ejecución y aplica las migraciones.
- **Cobertura mínima** (puerta de CI): ≥90% en `economy` y `scoring`; global PROVISIONAL (D-08).
- **Golden files** por versión de reglas (`app/modules/{economy,scoring}/__tests__/golden/`): si cambias una regla, actualiza el golden **explícitamente** y explica el cambio en el PR.
- **Nunca PII ni datos reales de usuarios en tests ni fixtures** (se usa el dataset ficticio de `test/fixtures/fiction/`).

## Convenciones (no negociables)

- **Idioma:** documentación, UI, mensajes de error y motivos de rechazo en **español**; identificadores de código (variables, funciones, tablas) en **inglés**.
- **No hardcodear parámetros de reglas** (B, carry, tablas de puntuación, límites, transfers): viven en `season_rules` (JSONB versionado) y en `app/shared/config`.
- **No introducir I/O en `economy`/`scoring`** (ni fs, ni BD, ni http, ni reloj): el check de pureza rompe el build.
- **El servidor manda:** toda validación de presupuesto, lineup, lockout y permisos es server-side; el cliente es una vista.
- **No borrar resultados ni histórico:** se corrigen y se versionan. No mutar una versión de reglas publicada.
- **No incluir secrets ni PII** en el repo, en docs ni en tests (gitleaks corre en CI).
- **Cambio de regla de juego ⇒** en este orden: documento de producto ⇒ ADR (si es una decisión) ⇒ `season_rules`/config ⇒ golden files ⇒ tests.
- **Dependencias de módulos:** `UI → tRPC → modules → shared`. Los módulos puros solo importan de `app/shared/types`.

## Definition of Done

Una historia del backlog está **hecha** cuando:

1. El código cumple su criterio de aceptación (verificable).
2. Tests unitarios (y de integración si toca BD) en verde.
3. Validación server-side de lo que el cliente pueda enviar.
4. Auditoría (`audit_log`) si la acción es sensible (precios manuales, reglas, resultados, recálculos, roles, ligas).
5. Docs actualizadas si cambia una regla de juego.
6. `npm run lint`, `npm run typecheck`, `npm run format:check` y `npm run test` en verde en local.

## Cómo tomar trabajo

- Todo el trabajo pendiente está en [`docs/backlog.md`](docs/backlog.md): IDs (`US-xx` historias, `T-xx` tareas, `D-xx` decisiones de calibración), prioridades (P0/P1/P2), dependencias y criterios de aceptación verificables.
- Sigue el camino crítico: **módulos puros → lineups → resultados → ligas → MVP** (ver `docs/roadmap.md`).
- Antes de empezar, comprueba las dependencias de la historia y avisa si falta algo.
- Las tareas `D-xx` (calibración de reglas) **requieren la decisión del dueño del proyecto**: no las resuelvas unilateralmente.
- Si descubres una discrepancia entre el código y `docs/`, el documento es la fuente de verdad: revisa si es un bug del código o una regla obsoleta y documenta la resolución (ADR si es una decisión).

## Commits y pull requests

- Rama nueva desde `main` por historia/tarea (p. ej. `us-05-gps-circuitos`), PR contra `main`.
- Un PR por historia o tarea del backlog.
- Estilo de commit: `feat:`, `fix:`, `chore:`, `ci:`, `docs:` (descripción en español, referenciando el ID, p. ej. `feat: US-05 (GPs, circuitos y eventos)`).
- **La CI tiene que quedar verde** (lint, typecheck, unit + cobertura, integración, pureza, build, docker smoke, gitleaks).
- El dueño del proyecto decide cuándo se hacen commits/pushes sobre `main` y los deploys (ver `docs/operations/deploy.md`).

## Dónde leer más

| Documento                         | Para qué                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------ |
| `docs/product/economy.md`         | El documento central: opciones económicas, modelo recomendado, fórmula de precios, simulaciones. |
| `docs/product/game-rules.md`      | Reglas de juego (composición, presupuesto, precios, transfers, lockout, invariantes).            |
| `docs/product/scoring.md`         | Tablas de puntuación versionadas, ejemplos, casos límite.                                        |
| `docs/architecture/overview.md`   | Arquitectura diseñada: stack, módulos, flujo de datos, transacciones.                            |
| `docs/architecture/data-model.md` | Esquema relacional, constraints, fuente de verdad vs derivado.                                   |
| `docs/architecture/testing.md`    | Capas de testing, casos límite obligatorios, puertas de CI.                                      |
| `docs/architecture/security.md`   | Amenazas y controles, GDPR, backups.                                                             |
| `docs/decisions/`                 | ADRs (una por decisión relevante).                                                               |
| `docs/operations/deploy.md`       | Runbook de despliegue en TrueNAS.                                                                |
