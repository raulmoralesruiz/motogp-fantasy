# Integraciones y Fuentes de Datos

> Estado: BORRADOR v1 (fase 4). Principio: **el núcleo del juego no conoce a ningún proveedor concreto.** Solo conoce un **contrato de fuente de resultados** (adapter pattern). Los proveedores son intercambiables.

## 1. Contrato de fuente (adapter)

### 1.1 Resultados (`ResultsSource`)

```typescript
interface ResultsSource {
  // Devuelve los resultados crudos de un GP (por evento) en un formato normalizado.
  fetchEventResults(gpId: string, event: EventType): Promise<NormalizedEventResults>;
  // Devuelve el estado de un GP (provisional/definitivo/cancelado).
  fetchGpStatus(gpId: string): Promise<GpStatus>;
  // Metadatos de la fuente (para auditoría).
  readonly meta: { name: string; version: string; authorized: boolean };
}

interface NormalizedEventResults {
  event: EventType; // 'q2' | 'sprint' | 'race'
  status: "provisional" | "definitive" | "cancelled";
  entries: Array<{
    riderRef: string; // referencia estable del piloto (se mapea a riders.id)
    position: number | null; // null si DNF/non-starter
    finished: boolean;
    penalties: string[]; // p. ej. ['time-penalty', 'dq']
    bonuses: string[]; // p. ej. ['fastest-lap', 'pole']
    raw: Record<string, unknown>; // payload original (auditoría)
  }>;
  fetchedAt: string;
  sourceVersion: string;
}
```

- **Mapeo de identidades:** cada fuente tiene un mapeo `riderRef → riders.id` (mantenido por el admin). Si un piloto de la fuente no está en `riders`, se crea o se marca como "sin mapear" (requiere acción del admin).
- **Idempotencia:** la importación usa la clave natural `(gp, event, rider)`; re-importar no duplica.
- **Proveniencia:** cada resultado guarda `source` (nombre+versión de la fuente) y `raw` (payload original) para auditoría.

### 1.2 Calendario (`CalendarSource` — US-05, ADR-0012)

```typescript
interface CalendarSource {
  // Calendario normalizado de una temporada (GPs + circuitos + eventos).
  fetchSeasonCalendar(year: number): Promise<NormalizedSeasonCalendar>;
  // Metadatos de la fuente (para auditoría).
  readonly meta: { name: string; version: string };
}

interface NormalizedSeasonCalendar {
  year: number;
  seasonRef: string; // referencia estable de la temporada en la fuente
  source: { name: string; version: string };
  gps: Array<{
    round: number; // 1..N, por orden de fecha
    name: string;
    circuit: { name: string; country: string; location: string | null };
    date: Date; // fecha de la carrera principal (UTC)
    events: Array<{ type: "q1" | "q2" | "sprint" | "race"; startTime: Date | null }>;
  }>;
}
```

- **Implementación del MVP:** `PulseLiveCalendarSource` (`app/modules/seasons/calendar-source.ts`), con inyección de dependencias (`baseUrl?`, `fetchImpl?`) — testeable sin red. La normalización es una **función pura** (`normalizePulseLiveCalendar(raw, source)`) testeada con fixtures de temporada real.
- **Mapeo (ADR-0012):** `Q` por orden temporal → `q1`, `q2` (una sola Q → solo `q2`); `SPR`/`RAC` → la última por fecha (carrera/sprint reiniciada); `FP`/`PR`/`WUP` se ignoran; `round = index + 1` ordenando por `date_start` (la API no tiene campo de ronda); eventos `test: true` excluidos; un GP sin `q2` o sin `race` → `CalendarNormalizationError` con el nombre del GP (el admin lo corrige manualmente).
- **Fechas como `Date`** (superjson-safe): el preview viaja por tRPC con superjson y el input de `calendar.import` se revalida con `z.coerce.date()` (no-op sobre `Date`). Un solo tipo de fecha en todo el camino.
- **Import en 2 pasos** (UI admin `/admin`):
  1. `calendar.fetch({year})` — descarga + normaliza, **sin escribir en BD y sin auditoría** (preview para que el admin revise).
  2. `calendar.import({seasonId, calendar})` — revalidación server-side (el cliente nunca se confía), `calendar.year === season.year` (BAD_REQUEST), **transacción atómica all-or-nothing**: circuitos por upsert idempotente `(name, country)`, las rondas existentes se **saltan** (informe `{created, skipped}`, no es un error), auditoría `calendar.imported` + `gp.created` por GP + `circuit.created` por circuito nuevo.
- **Respaldo manual:** la creación manual de circuitos/GPs/eventos (y de estado/lockout) siempre está disponible: es el fallback permanente y la vía de corrección.

## 2. Fuentes evaluadas

### 2.1 PulseLive (pública, sin auth) — `VERIFICADA EN VIVO`

- Base: `https://api.motogp.pulselive.com/motogp/v1` (GET, sin clave).
- **Verificado:** la API está en vivo y responde. Endpoints clave:
  - `/results/seasons`, `/results/events?seasonUuid=&isFinished=`
  - `/results/categories?seasonUuid=`, `/results/sessions?eventUuid=&categoryUuid=`
  - `/results/session/{id}/classification?seasonYear=`
  - `/results/standings?seasonUuid=&categoryUuid=`
  - `/riders`, `/teams?categoryUuid=&seasonYear=` (rosters históricos vía teams)
- **Verificado también para calendario (US-05, 2026-10-18):** `/results/seasons` → temporada por año; `/results/categories?seasonUuid=` → categoría MotoGP (`legacy_id: 3`); `/results/events?seasonUuid=`; `/results/sessions?eventUuid=&categoryUuid=` (N+1: ~24 peticiones por temporada — aceptable para una acción puntual de admin). Temporada 2026: 22 eventos no-test → 21 GPs con el patrón típico `FP,PR,FP,Q,Q,SPR,WUP,RAC`; el GP de Cataluña tiene **2 `RAC`** (carrera reiniciada), caso que cubre la regla «la última por fecha».
- **Ventajas:** gratis, sin auth, datos oficiales de carrera.
- **Riesgos:**
  - **No es un contrato estable ni autorizado explícitamente** para uso comercial; puede cambiar o bloquearse.
  - Cobertura de datos variable (no todos los campos de bonos/penalizaciones).
  - Depende de un tercero sin SLA.
- **Uso recomendado:** **fuente primaria del MVP** (con entrada manual como respaldo). Se trata como "fuente no garantizada": si falla, el admin importa manualmente.

### 2.2 Sportradar (comercial, licenciado) — `ALTERNATIVA`

- Proveedor de datos deportivos con contrato/licencia.
- **Ventajas:** SLA, datos ricos y estables, autorización contractual.
- **Riesgos:** coste por volumen; requiere negociación.
- **Uso recomendado:** **fuente de producción a medio plazo** cuando el producto tenga tracción. Se implementa como otro adapter del mismo contrato.

### 2.3 Bases comunitarias (moto-db, PyMotoGP, etc.) — `FALLBACK`

- Bases de datos comunitarias de resultados históricos.
- **Uso recomendado:** **backfill histórico** (temporadas pasadas) y cross-check. No como fuente primaria en vivo.

### 2.4 Entrada manual (admin) — `ÚLTIMO RECURSO (SIEMPRE DISPONIBLE)`

- El admin introduce resultados a mano (por evento) con validación.
- **Siempre disponible** como respaldo de cualquier fuente.
- Cada entrada manual queda **auditada** (quién, cuándo, valores).

## 3. Estrategia de fuentes por fase

| Fase       | Fuente primaria         | Respaldo           | Justificación                                      |
| ---------- | ----------------------- | ------------------ | -------------------------------------------------- |
| MVP        | PulseLive (pública)     | Entrada manual     | Sin coste, verificada en vivo; manual cubre fallos |
| Producción | Sportradar (licenciado) | PulseLive + manual | SLA y autorización contractual                     |
| Histórico  | Bases comunitarias      | Manual             | Backfill de temporadas pasadas                     |

> **Ninguna integración se da por disponible sin verificación.** PulseLive se verificó en vivo en la fase 2 (resultados) y el 2026-10-18 (calendario, US-05). Sportradar y las comunitarias **no** se han verificado contractualmente; se tratan como "por validar" antes de depender de ellas.

## 4. Pipeline de importación

```
[Scheduler/job] --(cada X min durante fin de semana)--> [ResultsSource.fetchEventResults]
        |
        v
[Normalización + mapeo de identidades]
        |
        v
[Validación contra esquema (Zod)]
        |
        v
[Import idempotente (clave natural gp+event+rider)]
        |
        v
[Estado provisional] --(admin confirma / fuente marca definitivo)--> [definitivo]
        |
        v
[Dispara recálculo (jobs/recompute)]
```

- **Frecuencia:** durante el fin de semana de carrera, el job consulta cada X minutos (PROVISIONAL: 5 min). Fuera de fin de semana, no.
- **Reintentos:** con backoff exponencial; si la fuente falla N veces, se alerta al admin (que puede importar manualmente).
- **Detección de "definitivo":** la fuente indica cuando un resultado es definitivo; si no, el admin lo marca.

## 5. Actualización de precios

- Tras cada GP **definitivo**, un job aplica la **fórmula de precios versionada** (ver `economy.md` §4.3) a cada activo.
- El admin puede **ajustar manualmente** un precio (p. ej. lesión confirmada no detectada); el ajuste queda auditado con motivo.
- Los precios se **congelan** en el momento del lockout (no se actualizan durante el fin de semana).

## 6. Riesgos de integración

| Riesgo                          | Mitigación                                                    |
| ------------------------------- | ------------------------------------------------------------- |
| PulseLive cambia/bloquea        | Adapter intercambiable + entrada manual siempre disponible    |
| Mapeo de identidades roto       | Validación + alerta de "sin mapear" + acción del admin        |
| Datos incompletos (bonos/penal) | El admin completa manualmente; se guarda `raw` para auditoría |
| Fuente con SLA insuficiente     | En producción, Sportradar licenciado                          |
| Importación duplicada           | Clave natural idempotente + tests                             |

## 7. Decisiones pendientes

- Frecuencia exacta de polling durante el fin de semana.
- Si se usa webhook (si la fuente lo ofrece) en lugar de polling.
- Contratos concretos con Sportradar (cuando haya tracción).
- Política de retención de `raw` (payload original) por auditoría.
