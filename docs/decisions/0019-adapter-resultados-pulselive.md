# ADR-0019: Semántica del adapter de resultados PulseLive (US-17)

- **Estado:** Aceptado (2026-10-21)
- **Fecha:** 2026-10-21
- **Relacionado:** US-17 (backlog E5), ADR-0004 (fuente de datos), ADR-0007 (pipeline de resultados), ADR-0012 (fuente de calendario), ADR-0018 (semántica del pipeline), ADR-0009 (email provisional), `integrations.md` §1.1/§2.1/§4, `scoring.md` (bonos), invariantes 6 y 7 (AGENTS.md §4).

## Problema

US-17 debe implementar la importación automática de resultados vía PulseLive: la implementación concreta del contrato `ResultsSource` (`integrations.md` §1.1), el job de polling (solo durante el fin de semana) y el mapeo de identidades `riderRef → riders.id`. ADR-0018 fijó la semántica del pipeline (importación idempotente, provisional→definitivo, re-importación como corrección), pero quedan abiertas las semánticas concretas del adapter:

1. ¿Qué campo del payload de PulseLive identifica de forma estable al piloto entre temporadas (`riderRef`)?
2. ¿Cómo se mapean los estados de entrada de la fuente al juego (`started`/`finished`, DNF vs ABSENT, ADR-0018)?
3. ¿Qué códigos de bono/penalización aporta la fuente y cuáles se dejan al import manual?
4. ¿Cómo sabe el adapter qué evento de la fuente corresponde a un GP de la BD (`gpId → eventUuid`)?
5. ¿Dónde vive el mapeo `riderRef → riders.id`, quién lo mantiene y qué pasa con los pilotos sin mapear?
6. ¿Qué ocurre cuando un re-import automático y una corrección manual compiten por la misma fila?
7. ¿Cómo decide el job qué GPs consultar («durante el fin de semana») y cómo se alerta al admin si la fuente falla?
8. ¿Qué devuelve `fetchGpStatus` en una fuente que nunca declara «definitivo»?

**Verificación en vivo** (2026-10-21, temporada 2026 completa: 22 GPs no-test, 177 sesiones, 69 sesiones Q/SPR/RAC clasificadas, 0 sin clasificación):

- Endpoints y payloads según `integrations.md` §2.1 (actualizada por este ADR). El parámetro de `/results/sessions` es el campo `id` del evento (**no** `toad_api_uuid`); el de `/results/classification` es el campo `id` de la sesión.
- `rider.riders_id` presente en el 100% de las entradas escaneadas; `rider.id` no es estable entre eventos.
- Estados de entrada observados: `INSTND` (terminó), `OUTSTND` (DNF), `NOTFINISHFIRST` (DNF), `NOTONRESTARTGRID` (ausente).
- Tipos de sesión: `FP`, `PR`, `Q` (1–2 por GP), `SPR`, `WUP`, `RAC` (23: un GP con 2 `RAC` = carrera reiniciada). Estados observados: `FINISHED`, `NOT-STARTED`.
- `/classification` de una sesión `NOT-STARTED` devuelve **HTTP 400** (error de Spring, mensaje confuso) → el job debe gatear sobre el estado de la sesión antes de fetchear.

## Opciones

### 1. Adapter con normalización pura + DI + fixtures grabadas (elegida)

`PulseLiveResultsSource` (`app/modules/results/pulselive-source.ts`) implementa el contrato documentado con dependencias inyectadas (`baseUrl?`, `fetchImpl?`, `eventRefResolver?`), siguiendo el patrón de `PulseLiveCalendarSource` (ADR-0012). La normalización es una **función pura** testeada con fixtures grabadas en el repo.

- Pros: contrato testeable sin red; Sportradar futuro = una clase nueva, cero cambios en núcleo/servicio; coherente con el calendario (misma fuente, mismo patrón).
- Contras: una capa más; el contrato debe mantenerse en sincronía con la documentación.

### 2. Fetch directo dentro del job (sin adapter)

- Pros: menos código.
- Contras: rompe el contrato documentado y el principio «el núcleo no conoce al proveedor» (AGENTS.md §3, `integrations.md` §1); el job queda intesteable sin red; Sportradar obligaría a reescribir el job. Descartada.

### 3. Fuente licenciada (Sportradar) desde el inicio

- Contras: no verificada contractualmente (`integrations.md` §3). Descartada (ver `integrations.md` §3: PulseLive es la fuente primaria del MVP).

## Decisión

### `riderRef` = `rider.riders_id` (fail-closed)

UUID estable del piloto en la fuente (presente en el 100% de las entradas de 2026 escaneadas; `rider.id` varía por evento). Si falta en una entrada → error de normalización: no se importan datos parciales con identidad inestable.

### Mapeo de estados de entrada (fail-closed)

| PulseLive          | `started` | `finished` | Estado (ADR-0018) |
| ------------------ | --------- | ---------- | ----------------- |
| `INSTND`           | ✓         | ✓          | FINISHED          |
| `OUTSTND`          | ✓         | ✗          | DNF               |
| `NOTFINISHFIRST`   | ✓         | ✗          | DNF               |
| `NOTONRESTARTGRID` | ✗         | ✗          | ABSENT            |
| desconocido        | —         | —          | error de normalización |

Fail-closed ante estado desconocido: si la fuente añade un estado que no conocemos, el import falla a lo alto en vez de adivinar (un DNF/ABSENT equivocado cambia la puntuación: −5 vs 0).

### Selección de sesión por tipo de evento (coherente con ADR-0012)

- `q2` → la **última sesión `Q` por fecha** (si solo hay una Q, esa).
- `sprint` → la última `SPR` por fecha.
- `race` → la última `RAC` por fecha (si la carrera se reinició, la segunda).

Si el evento vinculado no tiene sesión del tipo pedido → error de normalización (inconsistencia de datos; el admin revisa el vínculo).

### Gate de sesión: solo `FINISHED`

El adapter solo fetchea `/classification` si la sesión seleccionada tiene estado `FINISHED` (verificado: `NOT-STARTED` → HTTP 400). Para una sesión sin terminar lanza el error tipado `SourceSessionNotFinishedError`: el job la **salta sin contarla como fallo** (es el estado esperado antes de que se celebre).

### Códigos de bono/penalización que aporta la fuente

- `q2`: `pole` si posición 1.
- `race`: `fastest-lap` para el piloto de `records[type="fastestLap"]` (la vuelta rápida de la carrera; **no** `bestLap`, que es el lap de referencia histórico con `year`), **solo si terminó** (`scoring.md`: vuelta rápida sin terminar no otorga bono).
- `sprint`: sin bonos.
- `penalties`: siempre `[]`. PulseLive no aporta DQ/time-penalty; el admin los añade vía import manual (US-16/US-19) y la entrada original queda en `raw` para auditoría.

### `raw` y `rawPoints`

Cada entrada conserva el payload original en `raw` (contrato §1.1). La columna `raw` de la fila guarda los valores normalizados (la forma que `entryFromRow`/diff usan) **más** el payload original bajo `sourcePayload`. `rawPoints` (núcleo) se deriva de `points` del payload (puntos oficiales de campeonato; `null` en Q2 — la fuente no aporta puntos allí). El motor de puntuación no la usa (solo auditoría).

### Vínculo GP ↔ evento de la fuente: `Gp.sourceRef` + `results.linkSource`

El import de calendario (ADR-0012) persistió `seasonRef` solo en `audit_log`; hoy no existe mapeo `gpId → eventUuid`. Diseño:

- Nueva columna nullable `Gp.sourceRef` (campo `id` del evento en la fuente), fijada en el import de calendario (`CalendarGp`/`NormalizedSeasonCalendar` ganan `sourceEventRef`).
- Acción admin `results.linkSource` (auditada, `results.link_source`): para GPs existentes/manuales, vincula por **match de nombre** contra los eventos de la fuente de la temporada del GP (comparación normalizada: mayúsculas/espacios; **match único exigido**, si no rechaza listando candidatos). `results.unlinkSource` desvincula.
- El source recibe inyectado `eventRefResolver: (gpId) => Promise<EventRefResolution | null>` con `EventRefResolution = { seasonYear: number; eventRef: string | null; gpName: string }` (DI, mismo patrón que `fetchImpl`; `gpName` alimenta los mensajes de error en español): se conserva el contrato documentado `fetchEventResults(gpId, event)` sin que el adapter toque la BD. `eventRef = null` → error tipado `SourceNotLinkedError` (el job lo reporta; el admin vincula).
- El source resuelve temporada/categoría desde `seasonYear` (`/results/seasons` → año; `/results/categories` → `legacy_id 3`), con caché en memoria por temporada (mismo descubrimiento que el calendario, ADR-0012). No hace falta columna `Season.sourceRef`: las temporadas son únicas por año en PulseLive.

### Tabla `rider_mappings`

Nueva tabla `rider_mappings (source, riderRef, riderId)`, `unique (source, riderRef)`: mapeo **por fuente**, mantenido por el admin (acciones `results.riderMapping.set/delete`, auditadas), future-proof para Sportradar (filas con otro `source`).

- Alternativa descartada: campo `sourceRef` en `riders` — acoplaría el mercado (identidad de pilotos) al esquema de identidad de una fuente concreta y no soportaría múltiples fuentes.
- Match por nombre/dorsal en el import: frágil (cambios de nombre, mismo nombre entre categorías); no determinista. Descartado.

### Pilotos sin mapear: saltar + reportar (no rechazar)

El import no se rechaza si hay pilotos sin mapear: se **saltan** y se **reportan** (`unmapped: [{riderRef, name}]`). El reporte se persiste en `source_state.lastUnmapped` (por GP/evento) y se muestra en la UI admin como **alerta que requiere acción del admin**. Cuando el admin mapea, un re-import idempotente (job o manual) crea las filas que faltan (invariante 6).

### Manual gana a auto (re-import)

La columna `source` de la fila es «el último escritor» (ADR-0018: el import/corrección manual marca `source: "manual"`). El **auto-import solo escribe filas que son suyas**: crea las que no existen y actualiza las `source: "auto"` cuando cambian los datos de la fuente; **nunca toca filas `source: "manual"`**. El diff se calcula contra **todas** las filas existentes (la idempotencia se conserva: re-importar los mismos datos es no-op aunque las filas sean manuales), pero las escrituras solo aplican a filas inexistentes (crear) o `source: "auto"` (actualizar); las filas manuales con valores distintos se conservan y se reportan como `kept`. Justificación: una acción manual es una decisión explícita del admin y siempre gana a la fuente (p. ej. un DQ añadido a mano no puede borrarlo un re-import). Si el admin quiere la versión de la fuente para una fila manual, la re-importa manualmente.

### Job de polling: solo durante el fin de semana

- Ventana por GP: `now ∈ [gp.date − 48h, gp.date + 24h]` (UTC; **PROVISIONAL**, configurable en `shared/config`). `gp.date` es la hora de la carrera (ADR-0012), por lo que la ventana cubre del viernes (clasificación) al día después de la carrera (correcciones).
- Intervalo: 5 min (**PROVISIONAL**, `integrations.md` §4).
- El job recibe `now` inyectado (testeable); consulta los GPs (cualquier temporada) dentro de la ventana y no `cancelled`, por evento `q2`/`sprint`/`race` que exista y no esté `cancelled`.
- Por (GP, evento): `fetchEventResults` → mapeo `riderRef → riderId` → import (semántica de `results-service`, `source: "auto"`, `sourceName` según ADR-0018 = `"<fuente>:<versión>"`, `actorId = null`, motivo estándar en correcciones) → actualizar `source_state`.
- Sin lock store extra: el `FOR UPDATE` de la fila del GP dentro de la transacción de import (ADR-0018) serializa con importaciones manuales concurrentes.

### Alerta de fallos: `source_state` + UI admin + log

Nueva tabla `source_state (gpId, event, source, consecutiveFailures, lastError, lastAttemptAt, lastSuccessAt, lastUnmapped)`, `unique (gpId, event, source)`:

- Cada intento del job actualiza la fila: éxito → `consecutiveFailures = 0` + `lastSuccessAt`; fallo → `+1` + `lastError` (truncado) + `lastAttemptAt`. `lastUnmapped` se actualiza cuando el intento encuentra pilotos sin mapear.
- `consecutiveFailures ≥ N` (N = 3, **PROVISIONAL**) → alerta: banner en la UI admin (sección resultados) + log del servidor. La alerta se mantiene visible hasta que un éxito restablece el contador.
- **Email diferido**: la infraestructura de email es PROVISIONAL (ADR-0009, solo log); añadir un proveedor real es una decisión aparte.
- Alternativas descartadas: contador en memoria (se pierde al reiniciar); `audit_log` (append-only para acciones sensibles, no para estado operativo).

### `fetchGpStatus`

PulseLive nunca declara resultados «definitivos» (eso es decisión admin en el juego, ADR-0018). Mapeo: evento `FINISHED` → `"provisional"`; `NOT-STARTED` → `"not-started"` (**refinamiento de contrato**: `GpStatus` de `integrations.md` §1.1 gana `"not-started"`). El job no usa `fetchGpStatus`: el gate a nivel de sesión es más fino; el método se implementa y testa por completitud del contrato.

## Consecuencias

- Nuevas migraciones: `Gp.sourceRef`, `rider_mappings`, `source_state`.
- `CalendarGp`/`NormalizedSeasonCalendar` ganan `sourceEventRef` (el import de calendario persiste la referencia; los GPs importados antes de este cambio quedan `null` → `results.linkSource`).
- `results-service` gana la vía de auto-import (núcleo transaccional compartido; manual gana a auto).
- La UI admin de resultados gana: import desde fuente (por GP/evento), `linkSource`/`unlinkSource`, mapeo de pilotos, alerta de pilotos sin mapear y estado `source_state` (fallos + último error).
- El módulo `jobs` gana el job `results-poll` (solo fin de semana, `now` inyectado).
- `integrations.md` §2.1 se actualiza con el payload verificado (este ADR).
- Se conservan las invariantes 6 y 7: import idempotente, proveniencia `source`/`raw`, versionado.

## Provisionales (calibración D-xx)

- Intervalo de polling (5 min).
- Ventana de fin de semana (−48h/+24h).
- N de fallos para alertar (3).

## Validación

- **Tests de contrato con fixtures grabadas** en el repo (`test/fixtures/`): normalización (estados, bonos, `riderRef`, formato Q2, `rawPoints`), errores (estado desconocido, falta de `riders_id`, sesión sin terminar, GP sin vincular, errores HTTP/timeouts).
- **Integración**: re-import idempotente (no duplica); manual gana a auto; sin mapear → saltar + alerta persistente; `linkSource` (match único).
- **Job**: ventana con `now` inyectado; gate `NOT-STARTED` sin contar fallo; N fallos → alerta.
- Verificación en vivo 2026-10-21 (ver Problema).
