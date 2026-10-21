# ADR-0018: Semántica del pipeline de resultados (Fase 3, US-16…US-19)

- **Estado:** Aceptado (2026-10-21)
- **Fecha:** 2026-10-21
- **Relacionado:** US-16…US-19 (backlog E5), ADR-0007 (pipeline de resultados), `integrations.md` §1/§4, `scoring.md` §2/§6/§7, `data-model.md` §6, invariantes 6 y 7 (AGENTS.md §4), `season_rules` (tablas de puntuación versionadas).

## Problema

ADR-0007 fijó la forma del pipeline (importación idempotente + provisional→definitivo + recálculo auditable versionado), pero quedaron abiertas las semánticas concretas que US-16…US-19 deben implementar:

1. ¿Qué eventos del fin de semana admiten resultados (es Q1 un evento de resultados)?
2. ¿Qué datos tiene una entrada y qué validaciones aplican —incluida la distinción DNF vs non-starter, que cambia la puntuación (−5 vs 0)?
3. ¿Qué bonos/penalizaciones importa el admin y cuáles deriva el motor de puntuación?
4. Ciclo de vida de `results_version`: cuándo se asigna, formato y alcance.
5. Semántica de la re-importación: cuándo es no-op idempotente, cuándo es corrección (con histórico), y qué pasa con las filas que no están en el nuevo payload.
6. Efectos sobre el estado de `results_events` y `weekend_events`, y gates (GP/evento cancelados).
7. Cuándo se dispara el recálculo (se fija aquí; se implementa en US-18/US-19).

## Opciones

### 1. `results_version` de los resultados provisionales

1. **Null hasta el primer definitivo/recálculo (elegida)**: los resultados provisionales llevan `results_version = null`; la versión se asigna cuando el GP se recalcula (primer definitivo, US-18).
2. Versión provisional por importación (`prov-<timestamp>`): asignar versión al importar.
3. Versión por cada importación: toda importación genera una versión nueva.

### 2. Distinción DNF vs non-starter

1. **Flag `started` explícito en la entrada (elegida)**: `started=false` → ABSENT (0 puntos, sin penalización); `started=true ∧ finished=false` → DNF (0 − 5 en la carrera principal).
2. Implícita: ausencia de fila = non-starter; fila con `position=null` = DNF.
3. Sin distinción: un único flag `finished`; la penalización de DNF se aplica siempre.

### 3. Re-importación con valores distintos

1. **Corrección con histórico (elegida)**: se escribe `results_history` (anterior→nuevo, motivo, actor) y se actualiza la fila; si era definitivo, el estado pasa a `corrected`.
2. Rechazo si el evento ya tiene resultados (inmutable hasta el definitivo).
3. Sobrescritura silenciosa (sin histórico).

### 4. Vocabulario de códigos importables

1. **Mínimo importable + derivados (elegida)**: el admin importa solo los hechos que la fuente no deriva (`fastest-lap`, `pole`, `dq`, `time-penalty`); el motor deriva el resto (ganador, posiciones ganadas, extraordinario, DNF).
2. Todos los códigos importables: el admin marca también los bonos derivados.

## Decisión

### Alcance y gates (US-16)

- **Eventos de resultados: `q2`, `sprint`, `race`**. Q1 no es un evento de resultados (no aparece en el contrato `ResultsSource`, `integrations.md` §1.1): su importación se rechaza ("Q1 no es un evento de resultados").
- **Gates**: el GP debe existir y no estar `cancelled`; el evento debe existir en ese GP y no estar `cancelled`. La importación en un GP `scheduled` (sin lockout) está **permitida** (leniente: los resultados son provisionales y no afectan a puntuaciones hasta el definitivo; útil para backfill y tests).
- Los **pilotos** deben existir en `riders`; **no se exige afiliación** al GP (la entrada manual es el fallback leniente, `integrations.md` §2.4).

### Entrada y validación

Entrada: `{ riderId, position: int ≥ 1 | null, started: bool, finished: bool, penalties: PenaltyCode[], bonuses: BonusCode[], rawPoints?: number }`.

Coherencia (Zod + servicio):

| `started` | `finished` | `position` | Estado derivado |
| --------- | ---------- | ---------- | --------------- |
| false     | false      | null       | ABSENT (non-starter: 0, sin penalización) |
| true      | false      | null       | DNF (carrera principal: 0 − 5) |
| true      | true       | ≥ 1        | FINISHED |

- Sin `riderId` duplicado en el payload (máx. 100 entradas).
- **Empates de posición permitidos** (`scoring.md` §6): ambos pilotos reciben los puntos de esa posición.
- `rawPoints` opcional (puntos oficiales de la fuente; en la importación manual suele ser `null`).

### Códigos importables vs derivados

- **Importables** (hechos que aporta el admin/la fuente):
  - Bonos: `fastest-lap` (race; exige `finished=true`), `pole` (q2; exige clasificar, `position ≥ 1`).
  - Penalizaciones: `dq` (q2/sprint/race), `time-penalty` (sprint/race).
- **Derivados** (los calcula el motor de puntuación, US-19; **no son importables**): ganador (+5, P1 de la carrera), posiciones ganadas (+1 por posición, máx. +3, desde la parrilla de Q2), resultado extraordinario (top-3 + piloto más barato de su equipo), DNF (−5, desde `started ∧ ¬finished` en la carrera principal).
- Los **valores** de todos los bonos/penalizaciones viven en `season_rules` (versionado por temporada); el vocabulario de códigos es estable y compartido (`shared/types`).
- Código fuera del vocabulario o no aplicable al tipo de evento → rechazo con motivo explícito.

### `results_version` (invariante 7)

- **Formato**: `rv-<seq>` (seq desde 1), **alcance por GP**: la versión se lee junto al GP (las filas de `results`, `results_events`, `scores` y `rankings` llevan `gp_id`/`lineup_id`).
- **Los resultados provisionales llevan `results_version = null`** hasta el primer recálculo (opción 1).
- **Cada recálculo genera una versión nueva** (el primer definitivo, US-18; cada corrección, US-19). La versión anterior nunca se muta; los `scores`/`rankings` de versiones previas permanecen para histórico.
- El `results_version` de una entrada de `results_history` = la versión en vigor en el momento de la corrección (`null` si el GP aún no se ha recalculado).

### Re-importación (idempotencia y corrección, invariante 6)

Clave natural `(gp, event, rider)`:

- **Mismos valores** → no-op: sin cambios de fila, sin histórico, sin auditoría (la UI informa "sin cambios").
- **Valores distintos** → **corrección**: actualización de la fila + `results_history` (anterior→nuevo, motivo, actor, versión en vigor). Estado: `definitive → corrected`; `provisional → provisional` (nunca fue definitivo, no pasa a "corregido").
- **Las filas que no están en el payload se conservan** (los resultados no se borran, se corrigen). Para "quitar" a un piloto de los resultados, el admin re-importa su entrada como DNF/non-starter.
- **`reason`** (mín. 3 caracteres) es **obligatorio en corrección** y opcional en creación (por defecto "importación manual").
- **Recálculo**: se dispara solo si el GP ya tiene `results_version` (es decir, si existen `scores`) — se implementa en US-18/US-19. En US-16 la importación nunca recalcula (aún no hay puntuaciones).

### Estado y efectos secundarios

- `results_events`: la importación crea/actualiza la fila con `status = finished` (hay resultados del evento; si son provisionales o definitivos es por fila). `neutralized`/`cancelled` son acciones admin posteriores (US-18/US-19).
- `weekend_events`: la importación pasa `status: scheduled → finished` (los resultados son evidencia de que el evento tuvo lugar).
- Proveniencia: `source = manual`, `sourceName = "manual"`, `raw` = payload de la entrada (validado) para auditoría. Adapter futuro (US-17): `source = auto`, `sourceName = "<fuente>:<versión>"`.

### Auditoría y concurrencia

- Una entrada en `audit_log` por acción de importación, **en la misma transacción** (atómico, T-09):
  - `results.import` (creación): `afterData` con el payload completo (quién/cuándo/valores — CA US-16).
  - `results.correct` (corrección): antes/después por entrada + motivo.
  - Re-importación no-op: sin entrada (no deja rastro en la BD).
- **`FOR UPDATE` sobre la fila del GP** en la transacción de importación: serializa las importaciones del mismo GP (mismo patrón que lineups, ADR-0017, y precios, ADR-0015).

### Migración

- **Ninguna**: las tablas `results`, `results_events` y `results_history` (y las derivadas `scores`/`rankings`) ya existen desde T-06.

## Consecuencias

- El motor necesita la **parrilla de Q2** para calcular posiciones ganadas (US-19): importar Q2 es precondición de la puntuación completa de la carrera.
- Un non-starter puede importarse explícitamente (`started=false`) u omitirse (sin fila): ambos se tratan como ABSENT (0, sin penalización).
- El motivo de la corrección es texto libre: queda en `results_history` y en la auditoría (trazable, CA US-19).
- La UI de admin precarga el formulario con las filas actuales del evento.
- `rawPoints` en la importación manual suele ser `null`: son los puntos oficiales de la fuente, no los puntos de fantasy (que calcula el motor).
- Importar en un GP `scheduled` no lo desbloquea ni altera su estado: el ciclo de lockout (ADR-0017) es independiente de los resultados.

## Validación

- **Unit** (núcleo puro): derivación de estado (FINISHED/DNF/ABSENT), diff de re-importación (creadas/cambiadas/inalteradas/conservadas), códigos aplicables por evento, `results_version` (parse/next).
- **Integración** (US-16): idempotencia (importar 2 veces → 1 fila, sin auditoría ni histórico); corrección con histórico y estado; conservación de filas no presentes en el payload; rechazos (Q1, GP/evento cancelados, piloto desconocido, duplicado en payload, `finished` sin posición, código desconocido, código de otro evento, no-admin → 403); estados (`results_events.status=finished`, `weekend_events.status=finished`); auditoría (quién/cuándo/valores).
- **US-18/US-19** (siguientes bloques): definitivo con recálculo y versión; corrección tras definitivo → nueva versión + histórico (CA US-19); re-importar el mismo resultado no duplica puntos.
