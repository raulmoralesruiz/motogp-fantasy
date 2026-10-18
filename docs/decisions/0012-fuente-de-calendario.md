# ADR-0012: Fuente de calendario (US-05) — `CalendarSource` + PulseLive + import en 2 pasos

- **Estado:** Aceptado (implementado en US-05, 2026-10-18)
- **Fecha:** 2026-10-18
- **Relacionado:** ADR-0004 (fuente de datos de resultados), US-05, E4 (lockout).

## Problema

US-05 debe poblar cada temporada con sus GPs, circuitos y eventos de fin de semana. Una temporada real tiene ~22 GPs × 3–4 eventos: la entrada manual pura es lenta y propensa a errores. Hace falta (1) una fuente de calendario y (2) una forma de que el admin **revisara los datos antes de que entren en la BD**, porque la fuente del MVP no es un contrato garantizado.

## Opciones

1. **Solo entrada manual** (siempre disponible, sin fuente externa).
2. **Adapter `CalendarSource` + PulseLive (pública, verificada en vivo) + import en 2 pasos con preview** (elegida).
3. **Fuente licenciada (Sportradar) desde el inicio** para calendario.

### Pros/Contras

- 1: cero dependencias, pero 22 GPs × 4 eventos a mano por temporada; el admin es el cuello de botella.
- 2: el admin revisa un preview normalizado antes de importar; la import es idempotente y auditada; el manual queda como fallback y para correcciones.
- 3: coste y contrato innecesarios para el MVP; el calendario no es el dato crítico (los resultados sí — ADR-0004).

## Decisión

**Opción 2.** Detalles:

### Contrato (adapter)

```typescript
interface CalendarSource {
  readonly meta: { name: string; version: string };
  fetchSeasonCalendar(year: number): Promise<NormalizedSeasonCalendar>;
}
```

- El núcleo solo conoce el contrato (misma regla que `ResultsSource`, ADR-0004).
- `PulseLiveCalendarSource` es la implementación del MVP, con inyección de dependencias (`baseUrl?`, `fetchImpl?`): testeable sin red.
- La normalización (`normalizePulseLiveCalendar(raw, source)`) es una **función pura** (fixture → calendario), testeada unitariamente; la parte de I/O es fina.

### Flujo PulseLive (verificado en vivo, 2026-10-18)

- Base: `https://api.motogp.pulselive.com/motogp/v1` (GET, sin auth).
- `/results/seasons` → temporada por año; `/results/categories?seasonUuid=` → categoría MotoGP (`legacy_id: 3`); `/results/events?seasonUuid=`; `/results/sessions?eventUuid=&categoryUuid=` (N+1: ~24 peticiones para la temporada 2026 — aceptable para una acción de admin, no es un job).
- Verificado en la temporada 2026: 22 eventos no-test → 21 GPs con el patrón típico `FP,PR,FP,Q,Q,SPR,WUP,RAC`; el GP de Cataluña tiene **2 `RAC`** (carrera reiniciada: `number: null` a las 14:00 y `number: 2` a las 15:17).

### Reglas de mapeo

- Eventos con `test: true` se excluyen.
- `round = index + 1` ordenando por `date_start` (tie-break por nombre): la API no tiene campo de ronda.
- `Q` por orden temporal → `q1`, `q2` (una sola Q —clasificación combinada— → solo `q2`; más de dos → las primeras dos).
- `SPR` → `sprint` y `RAC` → `race`: si hay varias, **la última por fecha** (carrera/sprint reiniciada).
- `FP`/`PR`/`WUP` se ignoran (no puntúan en el juego).
- `Gp.date` = fecha de la carrera (fallback: `date_end` del evento a medianoche UTC).
- Circuito: `name = circuit.name`, `country = country.name`, `location = circuit.place ?? null`.
- Un GP sin `q2` o sin `race` en la fuente → `CalendarNormalizationError` con el nombre del GP («corrígelo manualmente»).

### Fechas como `Date`

El calendario normalizado usa `Date` (UTC), no strings ISO: el preview viaja por tRPC con **superjson** (que serializa `Date` correctamente) y el input de `calendar.import` se revalida con `z.coerce.date()` (no-op sobre `Date`). Un solo tipo de fecha en todo el camino.

### Import en 2 pasos

1. **`calendar.fetch({year})`** — descarga y normaliza el año desde la fuente. **No escribe en BD y no audita** (es un preview para que el admin revise).
2. **`calendar.import({seasonId, calendar})`** — revalida el payload **server-side** con Zod (el cliente nunca se confía — AGENTS.md §8), exige `calendar.year === season.year` (BAD_REQUEST) y crea en una **transacción atómica all-or-nothing**:
   - circuitos: upsert idempotente por `(name, country)` (se reutilizan los existentes);
   - GPs: las rondas ya existentes se **saltan** (informe `{created, skipped: [{round, reason}]}`, no es un error) y el resto se crea con sus eventos;
   - auditoría: `calendar.imported` (resumen) + `gp.created` por GP creado + `circuit.created` por circuito nuevo (con `source: "calendar"`).

### Errores

- `CalendarSourceError` (red/HTTP/formato inesperado) y `CalendarNormalizationError` (datos no mapeables) → en el router, `TRPCError INTERNAL_SERVER_ERROR` **con el mensaje en español** (el errorFormatter expone `message` para todos los códigos, así que el admin ve el motivo: p. ej. «El GP «X» no tiene Q2 ni la carrera en la fuente; corrígelo manualmente»).

### Lo que NO decide este ADR

- **La creación manual se mantiene** (circuitos, GPs, eventos, estado, lockout): es el fallback permanente y la vía de corrección (AGENTS.md §11: no depender de un proveedor no verificado).
- **La automatización del lockout** (US-13/E4) es otra historia: este ADR solo define el dato manual (`lockoutAt` opcional en la creación y editable después, auditado con before/after en `gp.lockout_changed`).

## Justificación

- **Coherencia con ADR-0004:** el adapter pattern ya es la regla para resultados; el calendario sigue el mismo patrón con su propio contrato.
- **El preview protege la BD:** PulseLive es una fuente no garantizada; el admin ve exactamente qué se va a crear (nombres, circuitos, fechas, eventos) antes de confirmar.
- **Idempotencia y auditoría:** re-importar el mismo calendario no duplica (salta rondas existentes) y cada import queda auditada con su resumen; los GPs importados llevan la procedencia (`source`, `seasonRef`) en su auditoría.
- **Normalización pura:** el mapeo (la parte con reglas) es testeable con fixtures sin red; la I/O queda reducida a una capa fina con `fetchImpl` inyectable.

## Impacto técnico

- `app/modules/seasons/calendar-source.ts`: contrato `CalendarSource` + normalización pura + `PulseLiveCalendarSource` (DI) + `WEEKEND_EVENT_ORDER`; `__tests__/calendar-source.test.ts` (fixtures de temporada real 2026 + casos límite).
- `app/modules/seasons/gp-service.ts`: circuitos (idempotentes), GPs + eventos, transiciones de estado, lockout e import; `gp-status.ts`: tabla pura de transiciones.
- `app/shared/validation/seasons.ts`: schemas de US-05 (circuitos, GPs, eventos, estado, lockout, calendario).
- `app/server/routers/seasons.ts`: routers anidados `circuits`/`gps`/`calendar`; `calendarSource` inyectable (los tests inyectan una fuente falsa sin red).
- UI admin: secciones de circuitos, GPs (con acciones de estado/lockout) e import de calendario en 2 pasos (`app/admin/**`).
- `docs/architecture/integrations.md`: contrato `CalendarSource` + verificación en vivo de PulseLive.

## Riesgos

- **PulseLive cambia o bloquea** → adapter intercambiable + entrada manual siempre disponible (mismo riesgo que ADR-0004).
- **Datos incompletos en la fuente** (p. ej. un GP sin carrera) → el `fetch` falla con el nombre del GP; el admin lo crea manualmente. La import es por temporada completa, no por GP: si un GP falla la normalización, el resto tampoco se importa (el admin corrige y re-importa; las rondas ya creadas se saltan).
- **N+1 de peticiones** (~24 por temporada) → aceptable para una acción puntual de admin; si se convierte en job periódico, se optimiza (caché o batch) antes de US-13.
- **Divergencia de nombres/circuitos** entre importaciones (p. ej. «Circuito de Barcelona» vs «Circuit de Barcelona-Catalunya») → el unique `(name, country)` crea circuitos duplicados; el admin los gestiona manualmente (no hay fusión automática en el MVP).
