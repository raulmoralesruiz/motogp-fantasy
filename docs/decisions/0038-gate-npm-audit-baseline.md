# ADR-0038: Gate de `npm audit` en CI con baseline de excepciones conocidas (T-21)

- **Estado:** Aceptado (2026-11-03)
- **Fecha:** 2026-11-03
- **Relacionado:** T-21 (backlog: "`npm audit` en CI con umbral de vulnerabilidades; dependabot activo; sin dependencias sin justificar"), T-23 (majores pendientes: next 16, prisma 7, zod 4, vitest 5), T-02 (dependabot ya activo: `.github/dependabot.yml`, solo patch/minor), ADR-0011 (política de puertas de calidad), `security.md` §5.

## Problema

T-21 exige un gate de vulnerabilidades en CI, pero el estado actual del repo (2026-11-03, `npm audit`) es **7 high + 4 critical** sobre 38 vulnerabilidades totales:

| Paquete | Sev | Ámbito | Por qué no se arregla sin major |
|---|---|---|---|
| `next` | critical | **producción** | La corrección está en next 16.x (rango vulnerable `…- 16.3.0-preview.10`); `npm audit fix` (no rompedor) no la aplica |
| `zod` | high | **producción** | Corregido en zod 4.6.6+ (rango vulnerable `<4.6.6`); `npm audit fix` no lo arregla |
| `vitest`, `vite`, `tinypool`, `@vitest/coverage-v8` | critical/high | solo dev (tests) | Corregido en vitest 5.1.0 (major) |
| `prisma`, `@prisma/config`, `deepmerge-ts` | high | solo dev (CLI) | prisma 7 (major) |
| `postcss` | high | transitive de next | next 16 (major) |
| `undici` | high | solo dev (jsdom/testcontainers) | versiones parent pinneadas (majores de toolchain) |

Un gate directo (`npm audit --audit-level=high`) **falla desde el primer día**: los hallazgos de producción (`next`, `zod`) y toda la toolchain solo se cierran con las actualizaciones a mayores de **T-23**, que es deliberadamente una tarea aparte (una por una, con CI verde tras cada bump). El gate no puede esperar a T-23 (su propósito es detectar **regresiones** entre ahora y entonces), pero tampoco puede nacer rojo.

Análisis de superficie de ataque de los hallazgos de producción (verificado en el código):

- **`next` critical (GHSA-2464-fhr4-w9xw, RCE vía Image Optimization con SVG):** la app **no usa `next/image`** (0 usos en `app/`) ni el endpoint `/_next/image`; no procesa SVG de terceros.
- **`next` high (GHSA-p3m5-59mp-jv5r, DoS vía Server Actions):** la app **no usa Server Actions** (0 `use server`); toda la API es tRPC sobre route handlers.
- **`zod` high (GHSA-mrhx-c7xc-m3w5, exhaustión de memoria en colecciones grandes):** los esquemas acotan con `.max()` las cadenas y la mayoría de arrays (bonos `max(5)`, lineups 2+2+1+1 fijos, import de resultados con tope de entradas por evento). Superficie residual: arrays de entrada de admin (import de calendario/resultados), actor autenticado `global_admin`.

El resto (9 paquetes) es **devDependency**: toolchain de tests/build; no se empaqueta en la imagen de producción.

## Opciones

| Opción | Descripción | Contras |
|---|---|---|
| A. `npm audit --audit-level=high` en CI (gate directo) | El estándar; falla si hay high/critical | **Rojo desde hoy** con 11 hallazgos: o se bloquea el CI hasta T-23 (semanas) o se cierra el ojo; no cubre el periodo intermedio |
| B. Gate directo solo sobre producción (`--omit=dev`) | Reduce la superficie gateada | Sigue rojo (`next`, `zod`) y además **desprotege la toolchain** (un build comprometido en CI empaqueta la app: los critical de vitest/vite/tinypool importan aquí) |
| C. **Baseline de excepciones conocidas** + gate contra hallazgos nuevos u obsoletos | `audit-baseline.json` lista los 11 hallazgos actuales, cada uno con **motivo + tarea de cierre**; CI falla si aparece una high/critical **no** en el baseline o si una entrada del baseline deja de existir | Exige disciplina: mantener el baseline limpio (el gate falla contra la obsolescencia, que es la presión necesaria) |

**Decisión: opción C.** Mantiene el espíritu de T-21 (ninguna vulnerabilidad alta/crítica entra sin revisión explícita) sin bloquear el repo en T-23, y cubre **todo el árbol** (producción + toolchain). La lista de dependencias de producción queda revisada en este ADR (14 paquetes, cada uno justificado por su módulo: argon2 auth; prisma ORM; sentry monitoring; react-query estado cliente; trpc API; bullmq colas; ioredis cache/lock; next/react framework; superjson serialización tRPC; zod validación compartida).

## Decisión

### 1. `audit-baseline.json` (raíz del repo)

- **Solo high/critical** en el umbral (`threshold: ["high","critical"]`); low/moderate los gestiona Dependabot (patch/minor semanales, T-02) y no bloquean.
- Una entrada por paquete: `package`, `severity`, `reason` (**obligatorio**, español: por qué se acepta y por qué no es explotable en nuestro uso), `closure` (tarea que lo cierra).
- Los 11 hallazgos actuales están listados con su GSA/justificación y cierre en **T-23** (next 16, zod 4, vitest 5, prisma 7). Los 2 de producción llevan el análisis de superficie de ataque del §Problema dentro del `reason`.
- El gate **falla si una entrada queda obsoleta** (el hallazgo desaparece del audit): se elimina la entrada en el mismo commit que la solución. El baseline no es una lista de la basura: es una lista viva de deudas justificadas.

### 2. `scripts/audit-gate/` (lógica pura + CLI, patrón `check-purity` T-03)

- `lib.ts`: **pura, sin I/O** — `parseAuditBaseline(raw)` (valida estructura del baseline: `version`, `threshold`, entradas con `reason`, paquetes únicos) y `evaluateAudit(report, baseline)` (compara el informe de `npm audit --json` contra el baseline: `new-vulnerability` / `stale-baseline-entry` / `invalid-baseline`; devuelve `allowed` con los motivos para que la salida de CI sea legible y auditable).
- `cli.ts`: ejecuta `npm audit --json` (tolerando el exit code de npm, que ya fallaría en low), parsea, evalúa, imprime el reporte (✅ listado de cubiertos con motivo y cierre / ❌ fallos con cómo avanzar) y fija `process.exitCode`.
- Tests: `scripts/audit-gate/__tests__/lib.test.ts` (16 casos: parseo válido/inválido, estado verde, hallazgo nuevo high y critical, severidad empeorada, baseline obsoleto, severidades fuera de umbral ignoradas, informe con la forma real de `npm audit` de hoy).

### 3. CI

- Job `quality` (`.github/workflows/ci.yml`): paso **"npm audit — gate de vulnerabilidades (T-21, ADR-0038)"** tras `npm ci` (falla rápido, antes de tests): `npm run audit:ci`.
- El resto de T-21 ya estaba cumplido: **dependabot activo** (T-02: semanal, solo patch/minor, límite 5 PRs, npm + github-actions) y **dependencias de producción justificadas** (revisión de este ADR).

## Consecuencias

- **Regresión bloqueada:** cualquier nueva high/critical (dependencia directa o transitive, prod o dev) rompe el CI hasta que se arregle o se revise y se acepte explícitamente en el baseline con motivo y cierre.
- **Deuda visible y acotada:** los 11 hallazgos actuales son deuda conocida, cada uno con tarea de cierre (T-23). Cuando T-23 haga cada bump, las entradas se eliminan en el mismo commit; al terminar T-23 el baseline queda (idealmente) vacío.
- **Coste de mantenimiento:** revisar una entrada nueva es una decisión explícita (motivo + cierre) — exactamente lo que T-21 pide ("sin dependencias sin justificar").
- **Limitación aceptada:** el gate compara paquetes, no versiones: si un paquete aparece con severidad distinta a la del baseline, se reporta a la vez como "nueva" y su entrada como "obsoleta" (estricto a propósito: obliga a actualizar el motivo).
- `npm audit` necesita red (endpoint de advisories) — disponible en los runners y local; si falla sin red, el paso falla (no pasa en silencio).

## Reversibilidad

Alta. Quitar el gate = borrar el paso de CI + el script + el baseline. No toca `package.json` de dependencias ni el código de la app. Si T-23 resuelve todo, el gate puede simplificarse a un `npm audit --audit-level=high` puro (ADR posterior o addendum a este).
