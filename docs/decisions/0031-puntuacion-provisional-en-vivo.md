# ADR-0031: Puntuación provisional en vivo (mi puntuación, sin esperar al definitivo)

- **Estado:** Propuesto (2026-10-31) — implementado y verificado localmente (lint 0, typecheck, pureza, unit 714, UI 35 en los archivos tocados, build); integración en CI (sin Docker local)
- **Fecha:** 2026-10-31
- **Relacionado:** US-20 (puntuación con desglose), US-18/US-19 (definitivo + recálculo, ADR-0020/ADR-0021), US-22 (pantallas de resultados), `scoring.md` §2/§5, invariantes 4–7 (AGENTS.md §4), `data-model.md` §7.

## Problema

Con el flujo vigente, el usuario **no ve sus puntos hasta que el admin marca el GP definitivo**: `myScore` lee la fila `Score` (que solo existe tras `markDefinitive` + recálculo) y, si no existe, devuelve `PRECONDITION_FAILED`. En un fin de semana real (Q2 → sprint → carrera) esto obliga a esperar a que todo el GP esté cerrado y marcado para ver cualquier cosa, aunque Q2 y la sprint ya estén importadas.

Para probar la app en vivo (GP de Malasia, sprint ya disputada) y para el uso normal, el usuario necesita ver su **puntuación parcial** en cuanto hay resultados importados, sin esperar al definitivo.

## Opciones

1. **Puntuación provisional al vuelo (elegida):** `myScore` detecta que no hay `Score` pero sí hay resultados importados → calcula la puntuación **en el momento** con el motor puro `scoring` (la misma fórmula que el recálculo definitivo) y devuelve `status: "provisional"` + `eventsIncluded` (los eventos que puntúan). Solo lectura: no escribe `Score`, no genera `results_version`, no afecta al ranking.
2. Recalcular (escribir `Score`) en cada importación de resultados: el usuario vería puntos, pero rompería la semántica vigente — el ranking y el versionado (`results_version`) están diseñados para moverse **solo** al definitivo (ADR-0018/ADR-0020/ADR-0021); además cada importación duplicaría trabajo de recálculo (y el ranking provisional no está en el alcance acordado).
3. Mantener el status quo (solo definitivo): el usuario no ve nada hasta el cierre del GP; la prueba en vivo con amigos se vuelve inviable.

## Decisión

**Opción 1** — alcance: **solo mi puntuación** (no se publica ranking provisional; el ranking sigue reflejando solo lo definitivo, semántica de US-21/US-22 inalterada).

- `MyScoreView` gana `status: "definitive" | "provisional"` y `eventsIncluded: Array<"q2" | "sprint" | "race">`; `resultsVersion` y `computedAt` pasan a `null` en provisional.
- **`computeGpScores`** (helper privado de `ResultsService`): extrae los pasos 1–5 de `recalculateGp` (reglas de la temporada + eventos + afiliaciones + precios + motor puro `scoring` → puntos por piloto, desgloses, media top-2 constructor/equipo). `recalculateGp` lo reutiliza (paso 6: escribir `Score`), así **definitivo y provisional usan exactamente la misma fórmula** (coherencia garantizada por construcción).
- **`eventsIncludedForGp`** (helper privado): eventos q2/sprint/race **con resultados importados y no cancelados** (orden `orderNum`); criterio único del recálculo y de la vista.
- **`lineupScoreView`** (helper privado): construye la vista del lineup (total + oro/plata con desglose + constructor/equipo con nombres) a partir de los puntos del motor puro.
- `myScore`:
  - con `Score` → `status: "definitive"` (comportamiento anterior, sin cambios en el desglose);
  - sin `Score` pero con resultados importados → `status: "provisional"`, total calculado al vuelo, `resultsVersion = null`, `computedAt = null`;
  - sin `Score` y **sin** resultados importados → `PRECONDITION_FAILED` (mensaje actualizado: "…aún no tiene resultados importados…").
- Eventos sin importar → **0 puntos** (el motor puro ya lo soporta: `EventOutcome | null` por evento); los eventos incluidos se listan en `eventsIncluded` para que la UI lo haga explícito.
- UI: `ScoreBreakdown` muestra un aviso «**Puntuación provisional**: calculada con los resultados importados hasta ahora (Q2, sprint). Se confirmará cuando el GP se marque definitivo.» cuando `status = "provisional"`; `/puntuacion` y `/resultados` etiquetan el total («provisional · reglas …» vs «definitivo · … · resultados rv-N»).
- **Sin migraciones** (solo lectura sobre tablas existentes) y **sin cambios en el pipeline definitivo** (import → provisional → `markDefinitive` → recálculo rv-1 → `Score` → ranking).

### Cambios de código

- `app/modules/results/results-service.ts`: `MyScoreView` extendida; helpers `eventsIncludedForGp`/`computeGpScores`/`lineupScoreView`; `myScore` con los dos caminos; `recalculateGp` refactorizado sobre `computeGpScores` (misma fórmula).
- `app/shared/components/score-breakdown.tsx`: aviso provisional + `eventsLabel` (exportada).
- `app/puntuacion/puntuacion-page.tsx`, `app/resultados/resultados-page.tsx`: etiqueta provisional/definitiva en el total.
- Tests: `test/integration/my-score.test.ts` (reestructurado: provisional Q2 → 47 · Q2+sprint → 82 · completo → 170.5 = definitivo, sin `Score` escrita en los tres pasos; definitivo → 170.5 con desglose), UI en `score-breakdown`/`puntuacion-page`/`resultados-page` (aviso + eventos + etiquetas).

## Consecuencias

- **El usuario ve sus puntos parciales en vivo** (tras Q2, tras la sprint) y el total definitivo al marcar el GP definitivo — sin doble fuente de verdad: la fórmula es la misma (`computeGpScores`).
- **El ranking no se toca** (invariante 4 y semántica US-21/US-22): sigue publicándose solo al definitivo.
- **No hay versionado nuevo**: la provisional no genera `results_version` ni filas `Score`; el histórico (`results_history`) y la auditoría siguen siendo solo de las escrituras reales.
- El provisional **puede cambiar** si el admin corrige resultados o importa el evento faltante (es una vista, no un dato); la UI lo hace explícito con el aviso.
- Si el admin cancela un evento tras importar sus resultados, ese evento deja de puntuar también en el provisional (mismo criterio que el recálculo: `eventsIncludedForGp`).
- Coste: `myScore` provisional hace ~6 consultas extra (reglas, eventos, resultados, afiliaciones, precios, nombres) por llamada — aceptable para una vista de un usuario (mismo orden que el recálculo, sin escrituras).

## Validación

- **Unit:** 714 tests en verde (el motor puro `scoring` ya cubre eventos `null` → 0 puntos; los helpers de servicio se cubren en integración).
- **UI:** 35 tests en verde en `score-breakdown`/`puntuacion`/`resultados` (aviso provisional con eventos, etiquetas provisional/definitiva, sin aviso en definitivo).
- **Lint / typecheck / pureza / build:** en verde.
- **Integración (CI, PostgreSQL real):** `my-score.test.ts` — provisional Q2 (47 pts, `eventsIncluded = [q2]`, sin `Score`), Q2+sprint (82 pts), fin de semana completo (170.5 = mismo total que el definitivo), definitivo (170.5 con desglose, `status = definitive`), gates (sin resultados importados → PRECONDITION_FAILED; sin lineup → NOT_FOUND; GP inexistente → NOT_FOUND; sin sesión → UNAUTHORIZED).
