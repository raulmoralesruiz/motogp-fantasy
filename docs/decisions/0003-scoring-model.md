# ADR-0003: Modelo de puntuación

- **Estado:** Propuesto
- **Fecha:** 2026-10-13

## Problema

Definir cómo puntúan pilotos, constructor y equipo, evitando doble conteo, manejando casos límite (sprint+GP, lesiones, DQ, resultados corregidos) y permitiendo cambios por temporada.

## Opciones

1. **Tablas versionadas por temporada + sin doble conteo + constructor/equipo por media de top-2** (recomendada).
2. Puntuación única global (sin separar constructor/equipo).
3. Puntuación por evento independiente sin versionado.

## Pros/Contras

- 1 (recomendada): transparencia, auditable, flexible por temporada; el constructor/equipo puntúan de forma independiente y justificable.
- 2: más simple, pero pierde la profundidad de activos distintos (constructor ≠ equipo es un pilar del producto).
- 3: no versionado → cambios retroactivos silenciosos, imposible auditar.

## Recomendación

**Opción 1.**

## Justificación

- Constructor ≠ equipo es una distinción central del producto; deben puntuar por separado.
- El versionado garantiza que cada puntuación sea trazable a una versión de reglas + una versión de resultados.
- El "sin doble conteo" (cada evento puntúa una vez; bonos aditivos explícitos) evita la percepción de injusticia.

## Impacto de producto

- El jugador puede explicar sus puntos (desglose por piloto/constructor/equipo/bonos/penal).
- Los cambios de reglas entre temporadas son explícitos y no sorprenden.

## Impacto técnico

- `season_rules` versionado (JSONB) con las tablas completas.
- `scores` referencia `rules_version` + `results_version`.
- Motor de puntuación puro (testable) + tests de regresión por versión (golden files).

## Riesgos

- Tablas mal calibradas → ajustables por temporada + ejemplos.
- Complejidad de casos límite → documentados en `scoring.md` §6 con tests.

## Validación

- Tests de unit con ejemplos verificables (el del `scoring.md` §5 → 170.5 puntos).
- Golden files por versión de reglas.
- Tests de integración para recálculo con resultados corregidos.
