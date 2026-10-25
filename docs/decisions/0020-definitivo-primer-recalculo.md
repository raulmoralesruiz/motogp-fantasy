# ADR-0020: Definitivo, primer recálculo y estados de evento (US-18)

- **Estado:** Aceptado (2026-10-24) — implementado, verificado, commitado (`f99f815`) y desplegado en producción (2026-10-25)
- **Fecha:** 2026-10-24
- **Relacionado:** US-18 (backlog E5), ADR-0007 (pipeline de resultados), ADR-0018 (semántica del pipeline — fija `results_version` y "el primer definitivo, US-18"), ADR-0019 (adapter PulseLive), `scoring.md` §2/§5/§6/§7, `data-model.md` §5/§6, invariantes 6 y 7 (AGENTS.md §4), `season_rules` (tablas de puntuación versionadas).

## Problema

ADR-0018 fijó el ciclo `provisional → definitivo → corregido` y que "los
resultados provisionales llevan `results_version = null` hasta el primer
recálculo (el primer definitivo, US-18)", pero quedaron abiertas las
semánticas concretas que US-18 debe implementar:

1. ¿A qué granularidad se marca definitivo (por GP o por evento)?
2. ¿Qué máquina de estados aplica a las filas `Result` y cómo se deriva el
   estado "definitivo" del GP (nuevo campo o derivado)?
3. ¿Qué hace el "primer recálculo" (rv-1): qué datos puntúa, qué escribe,
   con qué reglas y en qué transacción?
4. ¿Cómo puntúa el fin de semana completo (Q2 + sprint + carrera + bonos −
   penalizaciones) y qué hace el motor puro frente al servicio?
5. Semántica de los estados de evento `neutralized`/`cancelled` (ADR-0018
   los asigna a "US-18/US-19"): efectos sobre la puntuación.
6. ¿Quién dispara el definitivo y cómo se audita?

## Opciones

### 1. Granularidad del definitivo

1. **Por GP (elegida):** el admin marca definitivo el GP completo (todos sus
   eventos de resultados). Coherente con `data-model.md` §6 ("Marcar
   definitivo + recalcular → por GP"), el lock por GP y que los `scores` son
   por `(user, gp)`.
2. Por evento (GP+evento): más granular, pero el recálculo y los `scores` son
   por GP; un GP "a medio definitivo" no tiene sentido de puntuación.
3. Automático por la fuente (PulseLive indica `FINISHED`): menos control
   admin, y la fuente ya se usa como gate de importación (ADR-0019).

### 2. Estado "definitivo" del GP

1. **Derivado de las filas `Result` (elegida):** un GP es definitivo cuando
   no tiene filas `provisional`. No añade campo; no hay estado que
   mantener en sincronía.
2. Nuevo campo `Gp.resultsDefinitive` (bool): duplica el estado de las filas
   y puede desincronizarse.
3. Nuevo estado en `Gp.status`: mezcla el ciclo de vida del GP (lockout) con
   el ciclo de los resultados (son ejes independientes, ADR-0017/0018).

### 3. Primer recálculo (rv-1)

1. **Inline en la transacción de "marcar definitivo" (elegida):** el admin
   dispara el definitivo y el recálculo atómicos (mismo `FOR UPDATE` del GP,
   misma transacción, misma auditoría). Coherente con `data-model.md` §6
   ("Marcar definitivo + recalcular → una transacción, lock por GP").
2. Job asíncrono (BullMQ): más infraestructura; el recálculo de un GP es
   acotado (T-10: <30 s para 1000 lineups) y el admin espera el resultado.
3. Diferido (flag "pendiente de recalcular" que un job recoge): introduce un
   estado intermedio visible y una ventana donde el GP es definitivo sin
   `scores`.

### 4. Motor de puntuación

1. **Extender el módulo puro `scoring` con el fin de semana completo
   (elegida):** `scoreRiderWeekend` (Q2 + sprint + carrera + bonos −
   penalizaciones) sobre las tablas de `season_rules`. El servicio (no puro)
   carga datos (resultados, afiliaciones, precios, reglas) y los pasa al
   motor. Golden file con el ejemplo `scoring.md` §5.
2. Puntuar solo en el servicio (mezclar I/O y fórmula): incumple AGENTS.md
   §3 (módulos puros) y §7 (golden files).
3. Nuevo módulo `results/scoring`: duplica el motor `scoring` (corazón del
   producto) y rompe la dirección de dependencias.

## Decisión

### Granularidad y actor (US-18)

- **Definitivo por GP.** El admin (`global_admin`) marca definitivo el GP
  completo. La acción es **explícita y auditable**; la fuente no auto-marca
  (su estado `FINISHED` ya es el gate de importación, ADR-0019).
- **RBAC:** `global_admin` (mismo `adminProcedure` que el resto del router
  `results`).

### Máquina de estados (por fila `Result`)

- `provisional → definitive` (marcar definitivo).
- `definitive → corrected` (corrección por importación; ya implementado en
  US-16, ADR-0018).
- `corrected → definitive` (reconfirmar tras una corrección).
- **No hay vuelta a `provisional`** (los resultados no se "des-hacen"; se
  corrigen, invariante 6).

### Estado "definitivo" del GP (derivado)

- Un GP es **definitivo** cuando tiene filas `Result` y ninguna es
  `provisional` ni `corrected` (las `corrected` aún requieren reconfirmar;
  un GP sin filas no es definitivo: `markDefinitive` lo rechaza). Derivado,
  sin nuevo campo. La `resultsVersion` se asigna al recalcular.
- El estado se expone en la API (`results.gpState`) para que la UI muestre
  "provisional" hasta el definitivo (CA US-18; la pantalla de ranking llega
  en US-22).

### Primer recálculo (rv-1)

- **Inline en la transacción de "marcar definitivo"** (opción 3.1):
  1. `FOR UPDATE` de la fila del GP (serializa; mismo patrón que lineups
     ADR-0017, precios ADR-0015, importación ADR-0018).
  2. Gates: el GP existe (NOT_FOUND); el GP no está `cancelled`
     (PRECONDITION_FAILED); el GP tiene al menos una fila `Result`
     (BAD_REQUEST "no hay resultados").
  3. Volteo de filas: `provisional → definitive` y `corrected → definitive`
     (reconfirmar); las ya `definitive` no cambian.
  4. **No-op** (sin auditoría) si no hay filas `provisional`/`corrected`
     (el GP ya era definitivo): coherente con el no-op de importación
     (ADR-0018, invariante 6).
  5. **Recálculo:** puntuar el fin de semana de cada piloto con el motor
     puro (tablas de `season_rules` vigentes de la temporada) y escribir una
     fila `Score` por lineup del GP (oro/plata/constructor/equipo +
     desglose). Asignar `resultsVersion = rv-1` a las filas `Result` y
     `ResultsEvent` del GP (ADR-0018: "el primer definitivo, US-18").
  6. **Auditoría** en la misma transacción (T-09): `results.marked_definitive`
     (actor, GP, conteos por transición, `resultsVersion`).

### Motor de puntuación (módulo puro `scoring`)

- `scoreRiderWeekend(riderId, weekend, rules, ctx)` (nuevo, `scoring/weekend.ts`):
  - **Puntos por posición** (tablas `q2`/`sprint`/`mainRace` de
    `season_rules`).
  - **Bonos:** `pole` (q2, importado), `fastest-lap` (race, importado),
    `winner` (1º race, derivado), `positions-gained` (race terminada, desde
    la parrilla de Q2, máx. `positionsGainedMax`, derivado), `extraordinary`
    (top-3 race + piloto más barato de su equipo, derivado).
  - **Penalizaciones:** `dnf` (race, `started ∧ ¬finished`, derivado), `dq`
    (por evento, importado; **anula los puntos de posición del evento** y
    tiene precedencia sobre el DNF — scoring.md §6), `time-penalty`
    (por evento, importado; conserva los puntos de posición).
  - El DNF penaliza **solo** en la carrera principal (scoring.md §2.5 nota);
    un DNF en sprint puntúa 0 según su tabla, sin penalización.
  - Devuelve el **desglose** (`q2`/`sprint`/`mainRace`/`bonuses`/
    `penalties`/`total`), que se guarda en `Score.breakdown`.
- `cheapestInTeam(riderId, teamOf, priceOf)` (nuevo): ¿es el piloto el más
  barato de su equipo? (bono extraordinario).
- **Semántica del bono extraordinario:** "el más barato de su equipo" se
  mide sobre el **roster afiliado al GP** (todos los pilotos con afiliación
  de equipo en ese GP), no solo los que tienen resultado (scoring.md §2.4,
  lectura literal: "su equipo" = el equipo del GP). El servicio carga los
  precios de todos los pilotos afiliados y los pasa al motor; si un piloto
  del roster no tiene precio, se ignora en la comparación.
- **Golden file** (`scoring-v1.json`): el ejemplo `scoring.md` §5 → **170.5**
  (combinación `lineupPoints`) + el desglose del piloto A (56). AGENTS.md §7.
- **Sin I/O:** el motor solo recibe datos (resultados, parrilla Q2,
  afiliaciones, precios, reglas) y devuelve puntos. El servicio carga los
  datos de BD y los pasa al motor (AGENTS.md §3).

### Estados de evento `neutralized`/`cancelled` (ADR-0018: "US-18/US-19")

- **`cancelled` (evento):** el evento no puntúa (0 para todos; "no se
  penaliza", scoring.md §6 "Carrera cancelada"). La fila `ResultsEvent`
  lleva `cancelled = true`; el recálculo salta ese evento. Si la **carrera
  principal** está cancelada, el GP puntúa 0 para todos (scoring.md §6).
- **`neutralized` (evento):** se puntúa con el resultado oficial declarado
  (scoring.md §6 "Carrera neutralizada"); es un flag de metadatos
  (`ResultsEvent.neutralized = true`) que no altera la puntuación, pero se
  versiona y se audita.
- Ambos son **acciones admin** (RBAC `global_admin`), auditadas
  (`results.event_cancelled` / `results.event_neutralized`), idempotentes
  (repetir la misma acción es no-op) y **irreversibles** en US-18 (no hay
  "des-cancelar"; para corregir, se re-importa el resultado — invariante 6).

### Auditoría y concurrencia

- Una entrada en `audit_log` por acción, **en la misma transacción** (T-09):
  - `results.marked_definitive` (definitivo + primer recálculo).
  - `results.event_cancelled` / `results.event_neutralized` (estados de
    evento).
  - No-op (GP ya definitivo / evento ya en ese estado): sin entrada.
- **`FOR UPDATE` sobre la fila del GP** en todas las transacciones de US-18
  (mismo patrón que ADR-0017/0018): serializa definitivo/recálculo/estados
  del mismo GP.

### Migración

- **Ninguna:** las tablas `results`, `results_events`, `scores` y
  `results_history` ya existen (T-06); el estado "definitivo" es derivado y
  los flags `neutralized`/`cancelled` ya existen en `results_events`.

## Consecuencias

- El motor `scoring` pasa de "carrera principal" (scoring-v1) a "fin de
  semana completo" (todavía `scoring-v1`, PROVISIONAL — D-02 calibrará las
  tablas). Los valores viven en `season_rules` (versionado); el motor no
  hardcodea (AGENTS.md §1.3).
- El **bono extraordinario** necesita los precios de los pilotos del equipo
  en ese GP (datos de mercado): el servicio los carga y los pasa al motor
  (el motor sigue siendo puro).
- **Posiciones ganadas** necesitan la parrilla de Q2: si no hay Q2
  importada, ese bono no se aplica (ADR-0018: "importar Q2 es precondición
  de la puntuación completa").
- Un GP definitivo tiene `scores` (una fila por lineup) y `resultsVersion =
  rv-1`. Las versiones previas de `scores`/`rankings` permanecen para
  histórico (invariante 7).
- La UI de admin (sección Resultados) gana: botón "Marcar definitivo" por GP
  (confirmación + filas afectadas), acciones de cancelar/neutralizar evento
  y badge de estado (provisional/definitivo/corregido).
- El recálculo por **corrección** (nueva `results_version`, aviso al usuario)
  y el job de recálculo con advisory lock (T-10) son de **US-19** (reutiliza
  el motor y el servicio de US-18).

## Validación

- **Unit (motor puro):** `scoreRiderWeekend` (puntos por posición, cada
  bono, cada penalización, DQ-anula-posición, DQ-precede-DNF, DNF solo
  carrera, non-starter, combinaciones) + `cheapestInTeam` + **golden**
  (`scoring.md` §5 → 170.5 y desglose del piloto A → 56).
- **Integración (US-18):** marcar definitivo (volteo de filas, `rv-1`,
  `scores` por lineup, auditoría, no-op si ya definitivo, RBAC 403, gates:
  GP inexistente/cancelado/sin resultados, concurrencia); cancelar/
  neutralizar evento (flag, auditoría, no-op, irreversibilidad, efecto en el
  recálculo); `gpState` (estado derivado, conteos, `resultsVersion`).
- **UI (admin):** botón "Marcar definitivo" + acciones de evento + badge de
  estado (React Testing Library).
- **Cobertura:** mantener el gate global fusionado 99.9% (T-24).
