# ADR-0041: Seleccionador gráfico de activos y avatares generativos

- **Estado:** Aceptado (2026-11-17)
- **Fecha:** 2026-11-17
- **Relacionado:** US-41 (backlog E8), US-09 (builder de lineups, ADR-0017), `DESIGN.md` (tokens F2, patrón de control con motivo de bloqueo), `testing.md` §3 (sin PII/datos reales; T-16 touch targets), prohibiciones de `AGENTS.md` §11 (sin branding/fotografía licenciada de MotoGP).

## Problema

El builder de lineups (`/lineups`) compone el lineup con **6 `<select>` nativos** (piloto oro 1/2, piloto plata 1/2, constructor, equipo). El resultado funciona, pero tiene tres defectos de experiencia reales:

1. **Ciego sobre el mercado.** Cada `<select>` solo ve sus propias opciones; el usuario no compara precios, equipos ni constructores de un vistazo, y no hay feedback visual de qué piloto ocupa qué slot.
2. **Identidad pobre.** Los pilotos se representan como texto plano ("Piloto Uno — Equipo A, 12"); no hay ningún identificador visual de activo, y el dorsal del piloto (`riders.number`, ya en BD) no se muestra en ningún sitio.
3. **Flujo de dos pasos por asignación.** Para reasignar un piloto entre slots hay que borrar uno y elegir de nuevo en otro selector; el modelo de "slot activo + rejilla de activos" permite clic-único.

## Opciones

- **A. Mecha de los `<select>` nativos** (opciones enriquecidas, optgroup por equipo, `title` con precio).
  - Barato, pero mantiene el modelo ciego: sigue sin haber comparativa visual entre activos ni identidad.
- **B. Seleccionador gráfico por tipo** (una rejilla de tarjetas de pilotos para los 4 slots de piloto + 2 selects para constructor/equipo).
  - Mejor en pilotos, peor en consistencia: el constructor y el equipo son activos de primer nivel (invariante 5) y merecen el mismo trato.
- **C. Seleccionador gráfico único para los 6 slots, con tarjetas generativas (elegida).**
  - Un solo componente reutilizado para piloto/constructor/equipo; modelo "slot activo + rejilla"; tarjeta con avatar generativo (dorsal o iniciales), nombre, equipo, constructor y precio; estados deshabilitados con motivo ("sin precio para este GP", "ya en otro slot"); acción de quitar.

## Recomendación

**Opción C.**

## Justificación

- **Cero I/O, cero dependencias.** Todo el comportamiento nuevo (búsqueda, filtro por equipo, orden, asignación a slot, razones de bloqueo, color derivado) vive en un **módulo puro `app/shared/picker.ts`** sin I/O (misma regla que `economy`/`scoring`), testable por sí solo; el componente `asset-picker` solo renderiza el resultado.
- **Identidad generativa, sin licencias.** El avatar es un **dorsal** (`riders.number`, ya persistida) o las **iniciales** del nombre si el dorsal no existe, sobre un fondo de color **derivado determinísticamente de un hash del nombre** (estable entre renders y GPs, sin esquema nuevo, sin imágenes, sin branding licenciado — cumple la prohibición de `AGENTS.md` §11). El color de constructor/equipo se deriva del mismo hash (mismo nombre ⇒ misma tarjeta).
- **Mantiene todos los invariantes.** El borrador sigue siendo solo IDs; el servidor recalcula coste y presupuesto en transacción (invariante 2); lockout/wildcard/historial/`beforeunload` no se tocan.
- **Accesibilidad y touch.** Las tarjetas son botones (≥ 44 px, T-16); el motivo de bloqueo usa el patrón `disabledReason` + `aria-disabled` + `aria-describedby` ya establecido en `shared/components/button.tsx`; la selección por teclado funciona porque los slots y las tarjetas son elementos de botón estándar.
- **Coste aceptable.** Un componente nuevo + módulo puro + reescritura de los tests de la página y del flujo E2E; sin migración, sin dependencia nueva, sin ADR de reglas (no cambia ninguna regla de juego).

## Consecuencias

- El patrón de "slot activo + rejilla de activos" queda documentado en `DESIGN.md` como patrón de selección de activo; cualquier selector futuro de activos (torneos, draft de US-38) lo reutiliza.
- El color derivado de hash es **estético, nunca semántico**: no comunica estado (los estados usan los tokens `--ok`/`--bad`/`--warning`); dos pilotos de nombres distintos pueden coincidir en color por colisión de hash — aceptado porque el nombre y el dorsal siguen identificando sin ambigüedad.
- `BuilderView` expone el dorsal (`number`) de cada piloto: solo lectura sobre un campo ya persistido, sin cambio de esquema.
- El equipo de colores configurables (columna `teams.color` + panel admin) se **difiere**: extensión opcional posterior si hay demanda; el hash por nombre cubre el MVP visual.
