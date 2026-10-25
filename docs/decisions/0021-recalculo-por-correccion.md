# ADR-0021: Recálculo auditable y versionado por corrección (US-19)

- **Estado:** Aceptado (2026-10-24) — implementado, verificado, commitado (`6a2fe2f`) y desplegado en producción (2026-10-25)
- **Fecha:** 2026-10-24
- **Relacionado:** US-19 (backlog E5), ADR-0007 (pipeline de resultados), ADR-0018 (semántica del pipeline — fija "cada corrección, US-19" y "el recálculo se dispara solo si el GP ya tiene `results_version`"), ADR-0020 (definitivo + primer recálculo — fija el motor y el servicio que US-19 reutiliza), `scoring.md` §7, invariantes 6 y 7 (AGENTS.md §4), `season_rules` (tablas de puntuación versionadas).

## Problema

ADR-0018 fijó que "cada recálculo genera una versión nueva (el primer
definitivo, US-18; **cada corrección, US-19**)" y que "el recálculo se
dispara solo si el GP ya tiene `results_version` (es decir, si existen
`scores`)". ADR-0020 implementó el primer definitivo (rv-1) y el motor de
puntuación, y dejó explícitamente a US-19 "el recálculo por corrección
(nueva `results_version`, aviso al usuario)". Quedaban abiertas las
semánticas concretas que US-19 debe implementar:

1. ¿Quién dispara el recálculo por corrección: la propia corrección (inline
   en la importación) o una reconfirmación posterior (`markDefinitive`)?
2. ¿Qué estado queda la fila `Result` tras la corrección + recálculo
   (`corrected` persistente o `definitive`)?
3. ¿Qué `results_version` se genera y cómo se asigna a las filas?
4. ¿Qué se audita y cómo se notifica al usuario?

## Opciones

### 1. Disparador del recálculo por corrección

1. **Inline en la importación (elegida):** la corrección (o la creación de
   filas) dispara el recálculo en la misma transacción, **solo si el GP ya
   tiene `scores`**. Coherente con `scoring.md` §7 ("al corregir un
   resultado, se recalcula el GP completo con la misma `rules_version` y se
   genera una nueva `results_version`"), con ADR-0018 ("cada corrección,
   US-19"; "el recálculo se dispara solo si el GP ya tiene
   `results_version`") y con la CA de US-19 ("corregir un resultado → se
   recalcula el GP completo"). El admin no necesita una segunda acción; el
   usuario ve los puntos actualizados de inmediato.
2. Por reconfirmación (`markDefinitive`): la corrección deja la fila
   `corrected` y el admin debe volver a marcar definitivo para recalcular.
   Dos acciones para un efecto; el usuario ve puntos obsoletos hasta la
   reconfirmación; contradice la lectura directa de la CA y de `scoring.md`
   §7.
3. Job asíncrono (BullMQ): más infraestructura; el recálculo de un GP es
   acotado (T-10: <30 s para 1000 lineups) y el admin espera el resultado
   (misma razón que ADR-0020, opción 3.2).

### 2. Estado de la fila tras la corrección + recálculo

1. **Reconfirmación automática (elegida):** la corrección pasa la fila
   `definitive → corrected` (ADR-0018) y el recálculo inline la reconfirma
   `corrected → definitive` (transición ya definida por ADR-0020). El estado
   `corrected` es **transitorio** (visible solo dentro de la transacción);
   el GP queda definitivo con la nueva `results_version`. La transición
   `corrected → definitive` de la máquina de estados de ADR-0020 se
   conserva, pero se ejecuta como parte del recálculo (no como acción
   separada del admin).
2. `corrected` persistente hasta reconfirmación: la fila queda `corrected`
   y el GP no es definitivo hasta que el admin reconfirma. Contradice la
   opción 1 (si el recálculo es inline, la reconfirmación es redundante) y
   deja el GP en un estado "a medio" visible.

### 3. `results_version` del recálculo

1. **`nextResultsVersion` (elegida):** `rv-1` si el GP aún no tiene versión
   (no aplica: el disparo exige `scores`); `rv-<seq+1>` en caso contrario
   (rv-2, rv-3…). Núcleo puro `core/version.ts` (ya existe, ADR-0018). La
   versión anterior nunca se muta; los `scores` de versiones previas
   permanecen para histórico (invariante 7).
2. Re-upsert de la misma versión (rv-1): rompe la invariante 7 (no hay
   histórico de versiones) y contradice ADR-0018 ("cada recálculo genera una
   versión nueva").

## Decisión

### Disparador y alcance (US-19)

- **El recálculo se dispara inline en la importación** (`importEvent` manual
  y `importEventFromSource` auto), **solo si el GP ya tiene `scores`**
  (es decir, si había sido recalculado antes — primer definitivo o
  corrección previa) **y la importación cambió algo** (creó o corrigió
  filas; el no-op no recalcula).
- **Mismo motor y servicio que US-18:** `recalculateGp` (privado) +
  `scoreRiderWeekend`/`lineupWeekendPoints` (motor puro `scoring`). La
  `rules_version` es la misma (la más reciente de `season_rules` de la
  temporada); solo cambia la `results_version`.
- **Reconfirmación automática:** tras el recálculo, todas las filas del GP
  (`results` y `results_events`) pasan a `status = definitive` y reciben la
  nueva `results_version`. El estado `corrected` es transitorio.
- **`markDefinitive` (US-18) pasa a usar `nextResultsVersion`** (antes
  hardcodeaba `rv-1`): el primer definitivo sigue siendo rv-1; una
  reconfirmación tras una corrección que **no** auto-recalculó (p. ej.
  corrección sobre un GP sin `scores`) genera la siguiente versión. No-op
  (sin auditoría) si el GP ya era definitivo (sin filas
  `provisional`/`corrected`).

### Semántica de versiones e histórico

- **Nueva `results_version` por recálculo:** `rv-2`, `rv-3`, …
  (`nextResultsVersion` del núcleo `core/version.ts`). La versión anterior
  nunca se muta; los `scores` de versiones previas permanecen para
  histórico (invariante 7).
- **`results_history` conserva anterior→nuevo** (ya implementado en US-16):
  la entrada de la corrección referencia la `results_version` **en vigor al
  momento de la corrección** (la anterior, no la nueva). El aviso al usuario
  ("Resultados actualizados") se deriva de `results_history` (ya implementado
  en US-15: `recalculationNotices` → dashboard).
- **Idempotencia (invariante 6):** re-importar el mismo resultado es un
  no-op (sin escrituras, sin histórico, sin auditoría, **sin recálculo**).
  Los `scores` no se duplican: unique `(lineupId, resultsVersion)`.

### Auditoría

- Una entrada en `audit_log` por recálculo, **en la misma transacción**
  (T-09): `results.recalculated` (actor — `null` en el auto-import —, GP,
  `resultsVersion` nueva, `lineupsScored`).
- La corrección sigue auditándose como `results.correct` (manual) o
  `results.correct` con `actorId = null` (auto); el no-op no deja rastro.
- **`FOR UPDATE` sobre la fila del GP** (mismo patrón que ADR-0017/0018/0020):
  serializa las importaciones y recálculos del mismo GP.

### Migración

- **Ninguna:** las tablas `results`, `results_events`, `scores`,
  `results_history` y `audit_log` ya existen (T-06); el recálculo reutiliza
  el motor y el servicio de US-18.

## Consecuencias

- El admin corrige un resultado (manual o auto) y el GP queda
  **inmediatamente** recalculado y reconfirmado (nueva `results_version`);
  no necesita una segunda acción.
- El usuario ve el aviso "Resultados actualizados" en el dashboard
  (US-15, `recalculationNotices`) con el nº de correcciones y la última
  fecha; el histórico anterior→nuevo queda en `results_history`.
- Los `scores` de versiones previas permanecen para histórico (invariante
  7); el ranking (US-21) usará la versión más reciente.
- El auto-import (US-17) sobre un GP definitivo también recalcula (misma
  semántica que el manual); la auditoría del recálculo del auto tiene
  `actorId = null`.
- El job de recálculo con advisory lock (T-10) sigue siendo tarea separa
  (Dep: US-19); no se implementa en US-19.
- `markDefinitive` deja de hardcodear `rv-1` (usa `nextResultsVersion`); el
  primer definitivo sigue siendo rv-1.

## Validación

- **Integración (US-19):** corrección sobre GP definitivo → nueva
  `results_version` (rv-2) + `results_history` anterior→nuevo + `scores`
  rv-2 + reconfirmación (fila `definitive`) + auditoría
  `results.recalculated`; re-importar el mismo resultado no duplica puntos
  (no-op, sin recálculo); auto-corrección sobre GP definitivo → recálculo
  (rv-2) + auditoría sin actor.
- **Cobertura:** mantener el gate global fusionado 99.9% (T-24).
