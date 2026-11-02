# Estrategia de Testing

> Estado: v1 vigente (T-11 cerrado 2026-11-02: suite completa — unit, integración, contrato, E2E, regresión, carga y seguridad — en verde; T-12 cerrado 2026-11-02: revisión de seguridad + `security-t12.test.ts` + ADR-0035; ver §2.4, §2.7, §3 y §4).

## 1. Filosofía

- **Las reglas de juego son el producto.** La economía y la puntuación se testean como **fórmulas puras** (unit), con ejemplos de entrada/salida verificables.
- **La integridad es no negociable:** presupuesto, lineup, idempotencia y autorización se testean en integración (BD real).
- **Cada regla versionada tiene tests de regresión** para esa versión.

## 2. Capas de testing

### 2.1 Unit (fórmulas puras) — Vitest

- **Economía:**
  - `presupuesto(gp) = B + min(t·sin_usar_previo, cmax)`.
  - Motor de precios (fórmula v1): objetivo, suavizado, acotaciones, lesión.
  - **Ejemplo verificable:**
    - Entrada: `B=100, t=0.25, cmax=8, sin_usar_previo=8` → Salida: `presupuesto=102`.
    - Entrada: `sin_usar_previo=40` → `carry=min(10,8)=8` → `presupuesto=108` (tope aplicado).
    - Precio: `P0=20, prev=20, W=50` → `objetivo=20·(0.75+0.25)=20` → `precio=20`.
    - Lesión: `P0=20, prev=20` → `precio=max(5,10)=10`.
- **Puntuación:**
  - Tablas Q2/sprint/GP, bonos, penalizaciones, oro/plata, constructor/equipo (media top-2).
  - **Ejemplo verificable** (el del §5 de `scoring.md`): lineup {A,C oro; E,H plata; X; X-team} → **170.5 puntos**.
  - Sin doble conteo: un DNF puntúa 0 posición + (−5) una sola vez.
- **Validación de lineup:** composición 2+2+1+1, coste ≤ presupuesto, concentración.
- **Desempates de ranking.**

### 2.2 Integración (BD + transacciones + authz) — Testcontainers (PostgreSQL real)

- **Presupuesto:** guardar un lineup que excede presupuesto → rechazado; el presupuesto no se puede inyectar desde el cliente.
- **Idempotencia:** importar dos veces el mismo resultado → no duplica (unique `(gp,event,rider)`).
- **Recálculo:** corregir un resultado → recalcula el GP, conserva histórico, misma `rules_version`.
- **Lockout:** intentar cambiar tras el cierre → rechazado (aunque dos intentos concurrentes).
- **Concurrencia:** dos cambios simultáneos sobre el mismo lineup → uno falla o se serializan correctamente (sin sobre-pasar límites).
- **Authz:** un usuario no puede gestionar la liga de otro; un no-admin no accede al panel; un miembro no expulsa.
- **Multi-liga:** un usuario en 2 ligas → mismos puntos por GP en ambas.
- **Migraciones:** las migraciones se aplican en orden y son reversibles donde aplique.

### 2.3 Contrato (fuentes de datos)

- **Adapter de PulseLive:** con fixtures grabadas (responses reales anonimizados) → normaliza correctamente; maneja errores/timeouts; idempotente.
- **Mapeo de identidades:** `riderRef → riders.id` correcto; "sin mapear" se detecta.
- **Cada fuente** implementa el mismo contrato (tests de contrato comunes).

### 2.4 E2E (flujos de usuario) — Playwright — **Hecho (T-11, 2026-11-02)**

- **Registro → primer lineup** (<2 min, flujo completo) → `test/e2e/flows.auth.test.ts` (5 tests × 3 viewports: registro, registro→login, credenciales incorrectas, logout→anónimo, email duplicado) y `test/e2e/flows.lineup.test.ts` (registro → componer 2 oro + 2 plata + constructor + equipo → guardar).
- **Unirse a liga por código** (y casos de error: código inválido, llena) → `test/e2e/flows.league.test.ts` (US-25: código válido, código inválido con error en español, liga llena rechazada).
- **Construir y guardar lineup** (con validación de presupuesto visible) → `test/e2e/flows.lineup.test.ts` + `responsive.test.ts` (builder real con presupuesto visible).
- **Ver resultados y ranking** tras un GP (con fixture de resultados) → `test/e2e/flows.results.test.ts` (US-22/US-21: estado del GP, posiciones en ligas, puntuación).
- **Admin:** crear temporada, importar resultados, marcar definitivo, ver recálculo → `test/e2e/flows.admin.test.ts` (US-04/US-16/US-18 con la fixture del dataset ficticio; los 3 viewports corren en paralelo contra la misma BD, así que cada uno usa su propio GP de la fixture — 360→GP 1, 390→GP 2, 430→GP 3 — para no corregir/importar el mismo GP a la vez) + RBAC negativo (usuario normal sin acceso al panel).
- **Mobile (T-16):** `test/e2e/responsive.test.ts` — Playwright en 3 viewports (360/390/430 px — Chromium, `defaultBrowserType: "chromium"`; WebKit no disponible en el entorno local/CI por librerías del sistema):
  - No overflow horizontal en lineup, ligas, resultados, puntuación, mercado, login, registro.
  - Touch targets ≥ 44px en todos los campos del builder (garantizado además por CSS global: `app/globals.css` `.field input/select, .button, .tab` ≥ 44px).
  - Botón "Guardar lineup" presente en el DOM en los 3 viewports.
- **Sesiones y setup:** `test/e2e/global-setup.ts` (Playwright `globalSetup`) espera la salud de la app, deja hueco en las ligas activas (borra las membresías activas no-admin, conservando a los admins — US-31: la liga de bienvenida llena revierte el registro atómico, y la suite registra ~30 usuarios por corrida) y crea dos usuarios E2E compartidos con `storageState` (`auth-state.json` usuario normal, `admin-state.json` con rol `global_admin`): máximo 1 llamada contable de login por run (el registro no cuenta para el rate-limit de login — `AUTH_RATE_LIMIT_MAX` solo aplica a `auth.login`). Credenciales fijas de solo local/CI (`@local.test`, no PII).
- **Ejecución:** `npm run test:e2e` (local: `docker compose up -d` + `npm run dev` + `npm run seed:fiction`); nightly en GitHub Actions (`.github/workflows/nightly.yml`: servicios postgres/redis, migraciones, seed, Playwright, artefacto HTML). Suite total: **138 tests** por corrida (auth 15 + registro→lineup 3 + liga 9 + resultados 3 + admin 9 + responsive 99 = 46 tests × 3 viewports).
- **Anti-fuerza-bruta de ligas en E2E:** la suite crea y une varias ligas por corrida desde una misma IP (3 viewports en paralelo), así que el dev server de pruebas relaja los parámetros operativos (`LEAGUE_CREATE_RATE_LIMIT_MAX`, `LEAGUE_JOIN_RATE_LIMIT_MAX`, `LEAGUE_JOIN_LOCKOUT_THRESHOLD` — ver `.env.example` y `nightly.yml`). La **semántica** anti-fuerza-bruta (ventana, bloqueo por IP, revocación de código) la cubren los tests de integración (`app/server/routers/__tests__/` + `league-service`), no la E2E.

### 2.5 Regresión (cambios de reglas)

- **Por versión de reglas:** cada `season_rules` (p. ej. `scoring-v1`, `economy-v1`) tiene un suite de tests que verifica sus tablas/fórmulas.
- **Golden files:** entradas/salidas conocidas por versión; un cambio de reglas debe actualizar el golden de forma explícita (revisión obligatoria).
- **Re-simulación económica:** antes de cada temporada, se re-ejecuta la simulación de `economy.md` con los parámetros propuestos y se verifican las métricas (Gini < 0.05, etc.).

### 2.6 Carga (lockout y cálculo) — **Hecho (T-11, 2026-11-02)**

- **Lockout:** N usuarios intentan guardar/cambiar en la ventana de cierre → ninguno se aplica tras el cierre; sin condiciones de carrera → `test/integration/lineups.test.ts` "T-11 · carga: N usuarios guardando en la ventana de cierre → ninguno se aplica tras el cierre" (44 usuarios concurrentes; los intentos en ventana se aplican, los de tras el cierre —incluidos los que entraron antes— se rechazan íntegros).
- **Recálculo:** importar resultados de un GP completo (todos los pilotos/eventos) → el recálculo termina en tiempo aceptable (PROVISIONAL: < 30 s para 1000 lineups) → `test/integration/recalc-perf.test.ts` (puerta `npm run test:load`; medida T-10: ~1,2 s para 1000 lineups) + `test:integration/lineups.test.ts` (lockout bajo carga).
- **Fin de semana de carrera:** carga sostenida de consultas de precios/rankings durante el evento → diferido (post-MVP; ver §6).

### 2.7 Seguridad — **Hecho (T-12, 2026-11-02: revisión + suite dedicada + 1 hallazgo real corregido con ADR-0035)**

- **Permisos / IDOR:** suite que intenta acciones no autorizadas → todas rechazadas → `test/integration/rbac.test.ts` (roles globales por recurso) + `test/integration/leagues.test.ts` (IDOR de ligas: extraños → `NOT_FOUND` sin revelar la existencia, no gestionar la de otro) + **`test/integration/security-t12.test.ts`** (T-12: B no lee el lineup de A; el save de B en el GP de A no toca el de A; extraño a liga privada → `NOT_FOUND` en get/update/kick/transferAdmin/leave; miembro no-admin → `FORBIDDEN` en update/kick/transferAdmin/close y la liga intacta) + E2E `flows.admin.test.ts` (RBAC negativo del panel).
- **Fuerza bruta:** login, **registro (T-12/ADR-0035)**, recuperación, creación/unión de ligas con rate-limiting → se bloquean → `test/integration/auth.test.ts` (login: ventana por IP + bloqueo por cuenta; **registro: N+1 por IP → `BAD_REQUEST` sin crear usuario, otro IP no afectado, reintento tras la ventana — `auth.test.ts` "T-12/ADR-0035"**) + `app/server/__tests__/rate-limit-redis.test.ts` (claves Redis, incluida `rl:register:ip:*`) + `test/integration/leagues.test.ts` (unión por código con ventana + bloqueo tras N fallos; creación 5/hora por usuario) + `reset.test.ts` — parámetros operativos de `app/server/env.ts` (registro: `AUTH_REGISTER_RATE_LIMIT_MAX` default 10/h por IP), semántica probada en integración (la E2E los relaja solo en el dev server de pruebas — ver §2.4).
- **Inyección:** inputs maliciosos → rechazados server-side o guardados inertes → validación Zod compartida (`app/shared/validation/`) revalidada en cada procedimiento + tests de validación en `app/shared/validation/__tests__/` + **`test/integration/security-t12.test.ts`** (T-12: payloads XSS/SQLi en nombre/descripción de liga se guardan como dato y se devuelven tal cual — tabla `users` intacta; UUIDs malformados con SQLi embebido → `BAD_REQUEST` en `lineups.save`/`get`/`leagues.kick` sin tocar la BD; campos sobre el máximo (nombre 80, descripción 500, username 20, `reason` 500 en `results.importEvent`) → `BAD_REQUEST` sin escribir). Revisión de código (T-12): solo `$queryRaw` tagged (el único `$queryRawUnsafe` es `SELECT 1` constante en `health.ts`), cero `dangerouslySetInnerHTML`, `eval` solo en el script Lua fijo de rate-limit.
- **Presupuesto:** intentar inyectar coste/presupuesto desde el cliente → ignorado (se recalcula server-side) → `test/integration/lineups.test.ts` (el coste lo calcula siempre el servidor con la lista de precios congelada; `save` rechaza excedentes) + **`test/integration/security-t12.test.ts`** (T-12: `cost`/`budget` inyectados se ignoran — exceso 100.01 > 100 sigue rechazado con el lineup previo intacto; save válido con `cost: 0` inyectado se guarda con el coste del servidor (80) y la contabilidad refleja el gasto real (−80)).
- **Regresión corregida en T-12:** `notifications.test.ts` asertaba `audit[1]` sin `orderBy` (Postgres no garantiza el orden de inserción → flake en la corrida unida) → `orderBy: { createdAt: "asc" }`.

## 3. Casos límite obligatorios — **cubiertos con test nombrado (T-11, 2026-11-02)**

| Caso                                          | Capa        | Esperado                                      | Test nombrado (referencia)                                                                                                                                                                                                                                          |
| --------------------------------------------- | ----------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lineup con coste exacto = presupuesto         | Unit/Integ  | Aceptado                                      | `test/integration/lineups.test.ts` → "save posterior: coste = presupuesto aceptado, diff mínimo + spend(−Δ) + historial"                                                                                                                                              |
| Lineup con coste = presupuesto + 0.01         | Unit/Integ  | Rechazado con motivo                          | `test/integration/lineups.test.ts` → "rechaza el lineup que excede el presupuesto por 0.01"                                                                                                                                                                          |
| Piloto reemplazado a mitad de temporada       | Integ       | Puntúa el que sale en ese GP                  | `test/integration/results-definitive.test.ts` → "caso 3 · piloto reemplazado a mitad de temporada: puntúa el que sale en ese GP"                                                                                                                                      |
| Resultado corregido (penalización posterior)  | Integ       | Recalcula + histórico                         | `test/integration/results-definitive.test.ts` → "corrección: recalcula inline (rv-2) y reconfirma (US-19)" + "corrección: results_history conserva antes→nuevo (CA US-19)"                                                                                            |
| Dos lockouts simultáneos (carrera de cambios) | Carga/Integ | Solo se aplican los válidos antes del cierre  | `test/integration/lineups.test.ts` → "T-11 · carga: N usuarios guardando en la ventana de cierre → ninguno se aplica tras el cierre"                                                                                                                                    |
| Multi-liga (mismo lineup, 2 ligas)            | Integ       | Mismos puntos en ambas                        | `test/integration/rankings.test.ts` → "US-29: un usuario en 2 ligas tiene un único lineup por GP y los mismos puntos en ambas"                                                                                                                                          |
| Empate en ranking                             | Unit        | Desempates en orden definido                  | `test/integration/rankings.test.ts` → "publica el ranking general con los desempates de leagues.md §8" + "desempate 3: menor coste total de lineups (leagues.md §8)"                                                                                                  |
| GP cancelado                                  | Integ       | 0 puntos, marcado cancelado, sin penalización | `test/integration/results-definitive.test.ts` → "carrera cancelada → el GP puntúa 0 para todos (scoring.md §6)" + `test/integration/my-results.test.ts` → "GP cancelado: `cancelled = true` (la UI muestra 'GP cancelado, 0 puntos')"                                         |
| Sprint + GP (ambos puntúan)                   | Unit        | Se suman, sin exclusión                       | `app/modules/scoring/__tests__/weekend.test.ts` → "fin de semana completo: Q2 + sprint + carrera + bonos" + `test/integration/results-definitive.test.ts` → "sprint sin cancelar: sus puntos entran en el recálculo"                                             |
| Piloto lesionado (no sale a varios GPs)       | Unit/Integ  | 0 puntos + precio cae por regla               | `app/modules/economy/__tests__/pricing.test.ts` → "lesión P0=20, prev=20 → 10" + "lesión en el GP 3 → precio[2] = max(0.25·P0, 0.5·prev)" (puntuación 0 sin salir: `weekend.test.ts` "non-starter (carrera): 0, sin penalización")                                        |
| DQ posterior                                  | Integ       | Recalcula con −10                             | `test/integration/results-definitive.test.ts` → "caso 11 · DQ posterior: 0 por posición + (−10), y la corrección recalcula (scoring.md §6)"                                                                                                                            |
| Non-starter                                   | Unit        | 0 sin penalización de DNF                     | `app/modules/scoring/__tests__/weekend.test.ts` → "non-starter (carrera): 0, sin penalización"                                                                                                                                                                        |

## 4. Cobertura y puertas de calidad (CI)

- **Cobertura** (ADR-0011 + addendum 2026-10-19; T-24 y D-08 cerrados):
  - **Gate fusionado (global, real)** (`npm run test:coverage`; requiere Docker): unit + integración + UI en un solo `vitest run --coverage` (global-setup de Testcontainers). Umbral **99.9%** (medida real 2026-10-19: 99.94% = 3385/3387 líneas, 479 tests). Exclusiones (justificadas en el config): `app/server/prisma.ts`, `app/server/redis.ts`, `app/api/trpc/**` (glue real) + patrones default de test. Única línea no cubierta de la app: `pricing.ts` L87-88 (guard defensivo inalcanzable por construcción).
  - **Gate unit (rápido, local, sin Docker)** (`vitest run --config vitest.config.ts --coverage`): alcance = `app/modules/**` + `app/shared/**`, excluyendo los servicios con transacciones Prisma (los cubre la integración) y `shared/components` (UI, responsabilidad de e2e/RTL). Umbral **84** (medida real 2026-10-18: 84.83%).
  - `economy`/`scoring` ≥90% (líneas/enunciados/funciones) en ambos gates.
- **CI (GitHub Actions):** lint + typecheck + **tests fusionados (unit + integración + UI) con gate de cobertura global** + check de pureza + build en cada PR; e2e + carga en el main/nightly.
- **Bloqueo de merge** si falla lint/typecheck/tests/coverage.
- **Golden files** de reglas versionadas como parte del repo (cambios revisados).

## 5. Datos de test

- **Fixtures** de resultados (anonimizados) para contrato e integración.
- **Dataset ficticio** (el de `economy.md`) para la simulación de equilibrio.
- **Nunca** datos reales de PII en tests.

## 6. Decisiones pendientes

- ~~Umbral global definitivo de cobertura~~: **resuelto (2026-10-19, T-24/D-08)** — gate fusionado **99.9%** (medida 99.94% = 3385/3387 líneas); ver ADR-0011 (addendum).
- ~~Frecuencia del suite de carga (nightly vs por release)~~: **resuelto (2026-11-02, T-11)** — nightly (`nightly.yml`: E2E + `npm run test:load`); el lockout bajo carga (N usuarios en la ventana de cierre) corre además en la integración de cada PR (`lineups.test.ts`).
- Si se añaden property-based tests (p. ej. fast-check) para las fórmulas de economía/puntuación.
