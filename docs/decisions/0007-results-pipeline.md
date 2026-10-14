# ADR-0007: Pipeline de resultados

- **Estado:** Propuesto
- **Fecha:** 2026-10-13

## Problema

Definir cómo entran los resultados, cómo se pasa de provisional a definitivo, y cómo se recalcula sin duplicar ni perder histórico.

## Opciones

1. **Importación idempotente + provisional→definitivo + recálculo auditable versionado** (recomendada).
2. Importación directa a definitivo (sin provisional).
3. Sin recálculo (los resultados son inmutables).

## Pros/Contras

- 1 (recomendada): tolera datos tardíos/incorrectos; transparente; auditable.
- 2: más simple, pero un dato mal importado corrompe los puntos sin forma limpia de corregir.
- 3: no tolera correcciones (penalizaciones posteriores, DQ) → puntos incorrectos permanentes.

## Recomendación

**Opción 1.**

## Justificación

- Los resultados reales cambian (penalizaciones, DQ, neutralización). El sistema debe tolerarlo sin perder confianza.
- La **idempotencia** (clave natural `gp+event+rider`) garantiza que re-importar no duplica.
- El **versionado** (`results_version`) + histórico (`results_history`) hace cada recálculo auditable.
- El **provisional→definitivo** da al admin un punto de control antes de afectar a rankings.

## Impacto de producto

- El usuario ve avisos claros cuando un resultado se corrige, con el histórico (anterior→nuevo).
- La confianza en los datos se refuerza (nada se cambia en silencio).

## Impacto técnico

- `results` con estado (`provisional/definitive/corrected`) + `results_version`.
- `results_history` para correcciones.
- Job de recálculo con lock por GP (un recálculo a la vez).
- `scores` y `rankings` se recalculan y versionan.

## Riesgos

- Recálculo costoso → el volumen es acotado; lock por GP; tiempo objetivo < 30 s para 1000 lineups.
- Confusión provisional/definitivo → estados explícitos + aviso al usuario.

## Validación

- Tests de integración: idempotencia (importar 2 veces), recálculo con histórico, GP cancelado, DQ posterior, sprint+GP.
- Test de carga: recálculo de un GP completo en tiempo objetivo.
