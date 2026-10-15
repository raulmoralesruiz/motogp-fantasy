# Arquitectura — Visión General

> Estado: diseño de referencia (redactado en fase 4 de planificación, cuando el repo era verde). **El código ya existe:** para lo que está implementado hoy, ver [`estado-actual.md`](estado-actual.md). Las decisiones se documentan como ADR en `docs/decisions/` (0001…0008).

## 1. Enfoque

- **Monoliter modular** (no microservicios): un solo despliegue con módulos bien delimitados. Racional: equipo pequeño, un solo dominio, la complejidad está en las reglas de juego (no en la escala de infraestructura). Ver ADR-0006.
- **El servidor es la fuente de verdad.** Toda validación de presupuesto, lineup, lockout y autorización es server-side. El cliente es una vista.
- **Independencia de datos:** el núcleo no conoce a ningún proveedor concreto; solo a un **contrato de fuente de resultados** (adapter pattern). Ver `integrations.md`.
- **Todo lo que afecta a puntos o presupuesto es versionado y auditable.**

## 2. Stack recomendado

| Capa                  | Tecnología                                                                             | Racional                                                                                                                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lenguaje              | **TypeScript** (estricto)                                                              | Un solo lenguaje en cliente/servidor; tipos compartidos para validación y API                                                                                                                                                 |
| Frontend + API        | **Next.js** (App Router)                                                               | SSR/CSR, rutas, API routes en el mismo repo; ecosistema maduro                                                                                                                                                                |
| Base de datos         | **PostgreSQL**                                                                         | Transacciones ACID, integridad referencial, JSONB para reglas versionadas, buena para datos relacionales + algo flexible                                                                                                      |
| ORM + migraciones     | **Prisma** (o Drizzle)                                                                 | Migraciones versionadas, tipos generados, validación de esquema                                                                                                                                                               |
| Validación compartida | **Zod** (esquemas)                                                                     | Un solo esquema de validación usado en cliente y servidor (fuente única de verdad de validación)                                                                                                                              |
| Auth                  | Sesiones + **bcrypt/argon2** (contraseñas)                                             | Simple y suficiente para el MVP; extensible a OAuth                                                                                                                                                                           |
| API                   | **tRPC** (o REST tipado con OpenAPI)                                                   | Tipado extremo a extremo; tRPC elimina la serialización manual                                                                                                                                                                |
| Jobs en background    | **BullMQ** (sobre Redis) o cola en PG                                                  | Importación de resultados, recálculo, actualización de precios                                                                                                                                                                |
| Tests                 | **Vitest** (unit), **Playwright** (e2e), **Testcontainers** (integración PG)           | Cobertura de las capas críticas                                                                                                                                                                                               |
| CI/CD                 | **GitHub Actions**                                                                     | Lint, typecheck, tests, coverage, build, build de imagen Docker, escaneo de secrets (gitleaks), dependabot. **No deploya** (el servidor no tiene IP pública)                                                                  |
| Despliegue            | **TrueNAS Scale (LAN) + Docker**, modelo pull                                          | Un contenedor (app) + Postgres + Redis; el humano lanza `./deploy.sh` desde el servidor (git pull → build → migraciones → up). Gestión opcional por Portainer; proxy por Nginx Proxy Manager. Ver `docs/operations/deploy.md` |
| Monitoreo             | **Sentry** (errores) + métricas básicas (p. ej. Prometheus/Grafana o un log agregador) | Detección de fallos y de anomalías de datos                                                                                                                                                                                   |
| Secrets               | **`.env` en el servidor** (fuera del repo, `chmod 600`) + **gitleaks en CI**           | Nunca en el repo; sobre-infraestructura (vault/SOPS) descartada para un servidor local                                                                                                                                        |

> Las elecciones concretas se ratifican en los ADRs (0001 stack, 0006 monolito). Las alternativas rechazadas se documentan allí.

## 3. Módulos del monolito

```
app/
  modules/
    identity/      # usuarios, sesiones, authz, roles
    seasons/       # temporadas, GPs, circuitos, eventos
    market/        # pilotos, constructores, equipos, afiliaciones, precios
    lineups/       # lineups, cambios, validación, lockout
    economy/       # presupuesto, carry, motor de precios (fórmulas puras)
    scoring/       # motor de puntuación (fórmulas puras), versiones de reglas
    results/       # importación, provisional/definitivo, recálculo
    leagues/       # ligas, miembros, invitaciones, rankings
    admin/         # panel de admin, auditoría
    jobs/          # workers de background (import, recompute, prices)
  shared/
    validation/    # esquemas Zod compartidos cliente/servidor
    types/         # tipos TS compartidos
    config/        # parámetros por temporada (B, carry, tablas)
```

**Regla de dependencias:** `economy` y `scoring` son **módulos puros** (sin I/O) que solo reciben datos y devuelven resultados. Esto los hace trivialmente testables y los aísla de la persistencia.

## 4. Flujo de datos de un GP

```
[Fuente de resultados] --(adapter)--> [results: import idempotente]
        |
        v
[results: provisional] --(admin confirma)--> [results: definitivo]
        |
        v
[jobs: recalcular] --> [scoring: puntos por lineup (rules_version)]
        |
        v
[scoring: guardar scores versionados] --> [leagues: rankings]
        |
        v
[market: actualizar precios (fórmula versionada)] --> [market: histórico]
```

- **Importación idempotente:** re-importar el mismo resultado no duplica ni altera (clave natural: `gp + piloto + evento`).
- **Provisional → definitivo:** los resultados entran como provisionales; el admin (o la fuente) los marca definitivos; al hacerlo se dispara el recálculo.
- **Recálculo auditable:** cada recálculo genera una nueva `results_version` y conserva el histórico.

## 5. Transacciones y concurrencia

- **Operaciones sensibles** (guardar lineup, aplicar cambios, importar resultados, recalcular) se ejecutan en **transacciones** con bloqueo apropiado.
- **Lockout y cambios:** se usan constraints + `SELECT ... FOR UPDATE` sobre el lineup del usuario para evitar condiciones de carrera en el cierre.
- **Presupuesto:** se recalcula server-side dentro de la misma transacción que valida el lineup; no hay "presupuesto" almacenado que pueda desincronizarse (se deriva de base + carry + movimientos).
- **Recálculo:** se ejecuta como job con bloqueo por GP (un solo recálculo a la vez por GP) para evitar duplicados.

## 6. Configuración por temporada

- Los parámetros (B, carry, tablas de puntuación, límites) se almacenan en una tabla `season_rules` versionada (JSONB + metadatos).
- Cada puntuación y cada movimiento de precio referencia la versión de reglas usada.
- Cambiar reglas a mitad de temporada crea una **nueva versión** (no muta la anterior).

## 7. Decisiones de arquitectura (ADRs)

| ADR  | Decisión                                                                          |
| ---- | --------------------------------------------------------------------------------- |
| 0001 | Stack (TypeScript + Next.js + PostgreSQL)                                         |
| 0002 | Modelo de economía (Opción E: base fija + carry)                                  |
| 0003 | Modelo de puntuación (versionado, sin doble conteo)                               |
| 0004 | Fuente de datos (adapter, fuente pública + manual)                                |
| 0005 | Modelo de ligas (reglas globales, multi-liga)                                     |
| 0006 | Monolito modular (vs microservicios)                                              |
| 0007 | Pipeline de resultados (idempotente, provisional→definitivo, recálculo auditable) |

## 8. Riesgos técnicos principales

| Riesgo                                | Mitigación                                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Datos incorrectos/tardíos             | Pipeline idempotente + provisional/definitivo + recálculo + entrada manual                                     |
| Condiciones de carrera en lockout     | Transacciones + row locks + constraints                                                                        |
| Reglas mal versionadas                | Versionado estricto + tests de regresión por versión                                                           |
| Complejidad del monolito              | Módulos puros (economy/scoring) + límites de dependencias + tests                                              |
| Escala en el fin de semana de carrera | El tráfico es acotado (jugadores, no millones); un solo nodo + PG basta; se escala verticalmente si hace falta |
