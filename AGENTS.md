# AGENTS.md — Instrucciones operativas para agentes

> Este repositorio es **Fantasy MotoGP Independiente**: un juego de fantasy de MotoGP propio (sin licencias ni APIs oficiales), multi-liga, con una economía diseñada para ser justa y transparente.
>
> **Estado actual:** **Fase 0 cerrada**; **Fase 1 en curso** — US-01 (registro/login), T-20 (cabeceras de seguridad/CORS), US-02 (cierre de sesión + recuperación de contraseña), T-08 (RBAC + autorización por recurso), T-09 (auditoría append-only) y US-04 (temporadas + `season_rules` versionado, panel admin) en producción (imagen `2a2d497`, 2026-10-17); **US-05** (GPs, circuitos, eventos + import de calendario PulseLive en 2 pasos, ADR-0012), **T-24** (cobertura global fusionada 99.9%, ADR-0011 addendum), **US-06** (mercado: pilotos, constructores, equipos + afiliaciones por GP, ADR-0013), **US-07** (precios de apertura P0 + histórico, ADR-0014) y **US-08** (precios por GP: fórmula v1 + ajuste manual + gate de lockout, ADR-0015) commitados y empujados (commit `e3ac7a8`, 2026-10-19, desplegados en producción); **US-03** (perfil: datos, exportación JSON y eliminación de cuenta por anonimización, ADR-0016; cierra D-06) commitado y empujado (commit `2161b3d`, 2026-10-20, desplegado en producción). Fase 1 completa y desplegada en producción. **Fase 2:** **US-09…US-13** (lineups: composición 2+2+1+1, presupuesto base + carry, reasignación gratis, transfers + exención + wildcard, lockout server-side en transacción, ADR-0017) commitados y empujados (commit `36c4377`, 2026-10-21) y desplegados en producción (2026-10-23). **Fase 3 en curso:** **US-16** (import manual de resultados por evento q2/sprint/race, ADR-0018) commitado y empujado (commit `f315708`, 2026-10-21) y desplegado en producción (2026-10-23); **US-17** (import automático de resultados vía PulseLive: adapter + mapeo de pilotos + job de polling, ADR-0019) commitado y empujado (commit `e0764bf`, 2026-10-23) y desplegado en producción (2026-10-23); **US-18** (paso provisional→definitivo + primer recálculo inline + estados cancelado/neutralizado de evento, ADR-0020) commitado (commit `f99f815`, 2026-10-24), **US-19** (recálculo auditable y versionado por corrección: inline en la importación + `results_version` nueva + reconfirmación + auditoría, ADR-0021) commitado (commit `6a2fe2f`), **US-20** (puntuación con desglose: `ResultsService.myScore` + router `results.myScore` + UI `/puntuacion`, solo lectura sobre `Score.breakdown` — sin ADR, precedente US-14) commitado (commit `5d40fb5`) y **US-21** (rankings por GP y general: fórmula pura `sortRanking` + `LeagueService.recalculateRankings` + orquestación BFF desde el router `results`, ADR-0022) commitado (commit `56055cc`, 2026-10-25) — **desplegados en producción (2026-10-25)**. **Fase 4 en curso:** **US-23** (creación de liga privada con código: `LeagueService.createLeague`/`rotateCode`/`getLeague`/`myLeagues` + núcleo puro `generateLeagueCode` + rate-limit por usuario + UI `/ligas` + migración `20261025120000_league_description`, ADR-0023) y **US-24** (liga pública + directorio: núcleo puro `canViewLeague` + `LeagueService.listPublic`/`leagueRanking` + `getLeague` extendida (actor opcional) + router `get`/`ranking`/`listPublic` públicos + UI `/ligas` con directorio + nueva ruta `/ligas/[id]`, ADR-0024) implementados y verificados (2026-10-25; todas las puertas en verde). `docs/` sigue siendo la fuente de verdad de las reglas. `app/` contiene el monolito (Next.js) con los módulos puros `economy`/`scoring`, los módulos `identity`, `seasons`, `market`, `lineups`, `results` y `leagues` (dashboard US-15, rankings US-21, creación de liga US-23, liga pública + directorio US-24), el módulo `jobs` (job de precios, US-08; job de polling de resultados, US-17) y la UI de registro/login/recuperación + perfil + lineups + mercado + puntuación + ligas (listado + directorio + detalle) + panel admin. El estado del código, archivo a archivo, está en `docs/architecture/estado-actual.md`.

## 1. Fuentes de verdad

1. **`docs/` es la fuente de verdad de las reglas de juego.** Si el código y un documento discrepan, se revisa el documento primero (puede ser un bug del código o una regla obsoleta).
2. **`docs/decisions/` (ADRs)** registra cada decisión relevante con problema/opciones/recomendación/justificación. Toda decisión nueva o cambio de decisión ⇒ ADR nuevo (o addendum). Nunca se revierte una decisión en silencio.
3. **Los valores `PROVISIONAL`** (B=100, carry 25%/máx 8, tablas de puntuación, Pmax=60, límites de concentración, transfers 2+exención+1 wildcard, min/máx de liga 2–50) son **configurables por temporada** y se calibran en las tareas `D-xx` de `docs/backlog.md`. **Nunca se hardcodean como constantes mágicas:** viven en `season_rules` (tabla versionada, JSONB) y en `shared/config`.
4. **`docs/backlog.md`** es la lista de trabajo: IDs (`US-xx`, `T-xx`, `D-xx`), prioridades, dependencias y criterios de aceptación verificables.

## 2. Idioma

- Documentación, UI, mensajes de error y motivos de rechazo: **español**.
- Identificadores de código (nombres de variables, funciones, tablas): inglés.

## 3. Estructura de módulos (monolito modular)

```
app/
  modules/
    identity/      # usuarios, sesiones, authz, roles
    seasons/       # temporadas, GPs, circuitos, eventos
    market/        # pilotos, constructores, equipos, afiliaciones, precios
    lineups/       # lineups, cambios, validación, lockout
    economy/       # presupuesto, carry, motor de precios (FÓRMULAS PURAS)
    scoring/       # motor de puntuación (FÓRMULAS PURAS), versiones de reglas
    results/       # importación, provisional/definitivo, recálculo
    leagues/       # ligas, miembros, invitaciones, rankings
    admin/         # panel de admin, auditoría
    jobs/          # workers de background (import, recompute, prices)
  shared/
    validation/    # esquemas Zod compartidos cliente/servidor
    types/         # tipos TS compartidos
    config/        # parámetros por temporada (B, carry, tablas)
    components/    # primitivas de UI (Button, Field, Alert, …)
```

**Reglas de dependencias (no negociables):**

- `economy` y `scoring` son **módulos puros**: sin I/O (ni fs, ni BD, ni http, ni reloj), sin imports de otros módulos salvo `shared/types`. Solo reciben datos y devuelven resultados. Esto es lo que los hace testables como fórmulas y es el corazón del producto.
- Dirección de dependencias: `UI → tRPC → modules → shared`. `jobs/` orquesta módulos; nunca al revés.
- El check de dependencias (backlog T-03) debe fallar el build si un módulo puro importa I/O.
- **UI:** reutilizar las primitivas de `shared/components/` cuando el caso encaja; extraer un componente nuevo en la 3ª aparición del patrón (o antes si encapsula comportamiento real), migrando **todas** las apariciones existentes en la misma unidad de trabajo.

## 4. Invariantes del sistema (garantizadas, no se rompen)

De `docs/product/game-rules.md` §10 y `docs/architecture/data-model.md` §7:

1. Exactamente **2 oro + 2 plata + 1 constructor + 1 equipo** por lineup → constraint de BD.
2. **Coste del lineup ≤ presupuesto** → validación server-side en transacción (el coste se recalcula en el servidor con la lista de precios congelada; el cliente nunca envía coste ni presupuesto de confianza).
3. A lo sumo **1 lineup activo por usuario por GP** → unique `(user, gp)`.
4. **Multi-liga:** los puntos por GP de un usuario son los mismos en todas sus ligas (scores por `(user, gp)`; rankings por `(league, user, gp)`).
5. **Constructor ≠ equipo:** activos distintos, precios distintos, puntuación distinta. Nunca intercambiables.
6. **Idempotencia:** re-importar resultados no duplica puntos → unique `(gp, event, rider)`.
7. **Versionado:** cada puntuación referencia `rules_version` + `results_version`; no hay cambios retroactivos silenciosos.
8. **El presupuesto nunca depende del valor de mercado del equipo** (anti-ratchet — la ventaja central del producto). `presupuesto(gp) = B + min(t·sin_usar_previo, cmax)`.

## 5. Versionado de reglas y resultados

- Cada temporada declara una **versión de reglas** (`season_rules`, JSONB: B, t, cmax, tablas de puntuación, límites, `rules_version` p. ej. `scoring-v1`, `economy-v1`).
- Cambiar reglas ⇒ **nueva versión**; la anterior nunca se muta. Aplicación: solo a GPs futuros, o recálculo explícito y auditado (decisión del admin, registrada).
- Los resultados tienen estado `provisional → definitive` (o `corrected`); cada recálculo genera una **nueva `results_version`** y conserva el histórico en `results_history` (anterior → nuevo, motivo, actor).
- **Los resultados no se borran: se corrigen.**
- Los movimientos de precio se registran: `activo, gp, precio_previo, precio_nuevo, motivo (fórmula|manual), versión_fórmula, actor`.

## 6. Reglas de datos y pipeline de resultados

- **Adapter pattern:** el núcleo solo conoce el contrato `ResultsSource` (`docs/architecture/integrations.md` §1). PulseLive (MVP, pública, verificada en vivo) y la entrada manual (siempre disponible) son implementaciones; Sportradar es una implementación futura (no verificada contractualmente: no darla por disponible).
- Pipeline: `fetch → normalizar → validar (Zod) → import idempotente → provisional → (admin) definitivo → recálculo`.
- El recálculo corre como job con **lock por GP** (un solo recálculo a la vez por GP).
- Cada resultado guarda `source` (nombre+versión de la fuente) y `raw` (payload original) para auditoría.

## 7. Puertas de calidad (testing)

De `docs/architecture/testing.md`:

- **CI (cada PR, bloquea el merge):** lint + typecheck + unit + integración (Testcontainers, PostgreSQL real) + build.
- **Nightly/main:** e2e (Playwright) + carga.
- **Cobertura mínima:** 90% en `economy` y `scoring`; global: **gate fusionado (unit + integración + UI) 99.9%** (`npm run test:coverage`, requiere Docker; medida 99.94% = 3385/3387 líneas, T-24 cerrado 2026-10-19, ADR-0011 addendum); gate unit 84% (rápido local, sin Docker).
- **Golden files** por versión de reglas: entradas/salidas conocidas en el repo; cambiar una regla exige actualizar el golden de forma **explícita y revisada**.
- Los ejemplos verificables de referencia (deben pasar siempre):
  - `presupuesto(B=100, t=0.25, cmax=8, sin_usar=8) = 102`; `sin_usar=40 → 108` (tope).
  - Precio: `P0=20, prev=20, W=50 → 20`; lesión `P0=20, prev=20 → 10`.
  - Lineup de ejemplo de `scoring.md` §5 → **170.5 puntos**.
- **Nunca PII ni datos reales de usuarios en tests ni fixtures** (fixtures anonimizados; dataset ficticio de `economy.md` §7).

## 8. Seguridad (resumen operativo)

De `docs/architecture/security.md`:

- **El servidor manda:** toda validación de presupuesto, lineup, lockout y permisos es server-side; el cliente es una vista.
- **RBAC + autorización por recurso:** roles globales `user`/`global_admin` (`user_roles`); el admin de liga vive en `league_members.rol`. Cada endpoint revalida que el actor puede actuar sobre ese recurso.
- **Contraseñas:** argon2 (o bcrypt) + salt. **Sesiones:** cookie `HttpOnly+Secure+SameSite=Lax`, token opaco en BD, expiración y revocación.
- **Rate-limiting + bloqueo temporal:** login, recuperación, unión por código de liga, creación de ligas, cambios de lineup.
- **Códigos de liga:** ≥8 caracteres de alta entropía, revocables, no enumerables.
- **Auditoría:** `audit_log` append-only para acciones sensibles (precios manuales, reglas, resultados, recálculos, sanciones, roles, ligas).
- **Secrets:** nunca en el repo (vault/variables de entorno); rotación periódica.
- **GDPR:** minimización (email + seudónimo + datos de juego); exportación y eliminación/anonimización de cuenta (política D-06).
- **Lockout:** el estado `locked` del GP se evalúa **dentro de la transacción** de cambio; tras el cierre no se aplica nada (ni parcialmente), incluso bajo concurrencia.

## 9. Flujo de trabajo de implementación

1. **Empezar por la Fase 0** de `docs/roadmap.md`: bootstrap, CI, estructura de módulos, y los **módulos puros (`economy`, `scoring`) con tests antes de cualquier UI**. Si los módulos puros no están testeados, no se construye UI sobre ellos.
2. Seguir el orden del roadmap (Fase 0 → 5) y el camino crítico del backlog: `módulos puros → lineups → resultados → ligas → MVP`.
3. Cada historia del backlog se considera **hecha** cuando cumple su Definition of Done (código + tests + validación server-side + auditoría si aplica + docs actualizadas si cambia una regla).
4. **Antes de lanzar el MVP:** cerrar `D-01` y `D-02` (calibración) y pasar la re-simulación económica (T-15: Gini < 0.05, recuperación > 0.95, diversidad > 70%).
5. Si una regla de juego necesita cambiar: actualizar el documento de producto ⇒ ADR (si es una decisión) ⇒ `season_rules`/config ⇒ golden files ⇒ tests. En ese orden.
6. **Commits y pushes (regla estricta, acordada con el usuario):** el agente **no hace commits ni pushes sin permiso explícito del usuario**. Todo el trabajo diario queda en el árbol de trabajo sin commit, con cada unidad de trabajo verificada (typecheck + tests + lint en verde) para que el estado sea siempre consistente. Cuando el usuario da la señal, el agente crea los commits (uno único o uno por unidad de trabajo, a elección del usuario) y hace push. Objetivo: controlar manualmente commit y push.

## 10. Comandos (convención prevista — se definen en Fase 0, T-01)

| Comando                              | Propósito                                                                                            |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `npm run dev`                        | Desarrollo (app + API)                                                                               |
| `npm run lint` / `npm run typecheck` | Calidad estática                                                                                     |
| `npm run test`                       | Unit (Vitest, sin Docker)                                                                            |
| `npm run test:ui`                    | UI (React Testing Library, jsdom, sin Docker)                                                        |
| `npm run test:coverage`              | **Run fusionado** unit + integración + UI con gate de cobertura global 99.9% (T-24; requiere Docker) |
| `npm run test:integration`           | Integración (Testcontainers, PG real)                                                                |
| `npm run test:e2e`                   | E2E (Playwright)                                                                                     |
| `npm run test:load`                  | Carga                                                                                                |
| `npm run build`                      | Build de producción                                                                                  |
| `npx prisma migrate dev` / `deploy`  | Migraciones                                                                                          |
| `npm run simulate`                   | Re-ejecuta la simulación económica de `economy.md` §7 (fixture del dataset ficticio)                 |

## 11. Prohibiciones

- No hardcodear parámetros de reglas (usan `season_rules`/config versionados).
- No confiar en valores de presupuesto/coste/permisos enviados por el cliente.
- No borrar resultados ni histórico: se corrigen y se versiona.
- No mutar una versión de reglas publicada.
- No introducir I/O en `economy`/`scoring`.
- No usar branding, logos ni datos licenciados de MotoGP; no depender de APIs privadas del juego oficial.
- No incluir secrets ni PII en el repo, en docs ni en tests.
- No dar por verificado un proveedor de datos sin verificación real (ver `integrations.md` §3).

## 12. Mapa de documentos

| Documento                            | Qué responde                                                                                                                                                                      |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                          | Índice y resumen ejecutivo                                                                                                                                                        |
| `CONTRIBUTING.md`                    | Cómo colaborar: quickstart local, comandos, convenciones, Definition of Done, cómo tomar trabajo                                                                                  |
| `docs/product/vision.md`             | Propuesta de valor, diferenciación, métricas, riesgos                                                                                                                             |
| `docs/product/game-rules.md`         | Reglas de juego (composición, presupuesto, precios, transfers, lockout, invariantes)                                                                                              |
| `docs/product/economy.md`            | **Documento central:** opciones A–E, modelo recomendado, fórmula de precios, simulaciones                                                                                         |
| `docs/product/economia-guia.md`      | Guía accesible de `economy.md`: glosario, opciones en lenguaje claro, motor de precios paso a paso, GP completo, calibración                                                      |
| `docs/product/por-que-opcion-e.md`   | Explicación no técnica: por qué la opción E supera al modelo oficial (ejemplos con datos reales 2026)                                                                             |
| `docs/product/scoring.md`            | Tablas de puntuación versionadas, ejemplos, casos límite, recálculo                                                                                                               |
| `docs/product/leagues.md`            | Tipos de liga, invitaciones, permisos, rankings, privacidad, anti-abuso                                                                                                           |
| `docs/product/user-flows.md`         | Flujos de usuario y pantallas (~18)                                                                                                                                               |
| `docs/product/mvp.md`                | Alcance del MVP, diferimientos, criterios de aceptación                                                                                                                           |
| `docs/architecture/estado-actual.md` | **El código que existe hoy:** estado por fase, mapa del repo, módulos, invariantes, puertas de calidad                                                                            |
| `docs/architecture/overview.md`      | Stack, módulos, flujo de datos, transacciones, ADRs                                                                                                                               |
| `docs/architecture/data-model.md`    | Esquema relacional, constraints, fuente de verdad vs derivado                                                                                                                     |
| `docs/architecture/integrations.md`  | Contrato `ResultsSource`, fuentes evaluadas, pipeline de importación                                                                                                              |
| `docs/architecture/security.md`      | Amenazas y controles, GDPR, backups                                                                                                                                               |
| `docs/architecture/testing.md`       | Capas de testing, casos límite, puertas de CI                                                                                                                                     |
| `docs/operations/deploy.md`          | Runbook de despliegue en TrueNAS (modelo pull, Portainer, NPM, backups, rollback)                                                                                                 |
| `docs/decisions/0001…0024`           | ADRs: stack, economía, puntuación, fuente de datos, ligas, monolito, pipeline, cabeceras/CORS, email provisional, bootstrap de admin, política de cobertura, fuente de calendario, semántica de afiliaciones, precio de apertura P0, precios por GP (fórmula v1 + ajuste manual + lockout), anonimización en la eliminación de cuenta (GDPR), estado de lineup y contabilidad de cambios (Fase 2), semántica del pipeline de resultados (import manual, US-16), adapter de resultados PulseLive (US-17), paso de provisional a definitivo + primer recálculo + estados de evento (US-18), recálculo auditable y versionado por corrección (US-19), rankings por GP y general (US-21), creación de liga privada con código (US-23), liga pública y directorio (US-24) |
| `docs/roadmap.md`                    | Fases 0–5 + post-MVP, camino crítico                                                                                                                                              |
| `docs/backlog.md`                    | Epics, historias, tareas, dependencias, prioridades, criterios de aceptación                                                                                                      |
