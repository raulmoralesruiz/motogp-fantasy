---
target: P3 localización es-ES — separador decimal en toda la app (formatNumber + barrido cross-page)
total_score: 34
max_score: 40
na_heuristics: 1,3,7,8,10
p0_count: 0
p1_count: 1 (cerrado antes de cerrar la unidad: inconsistencia cross-page)
target_identity: "file:/home/raul/dev/github/motogp/app/shared/format.ts"
target_fingerprint: "sha256:ed9d8aa8e71381d9363dc77d10b48b605d604ecf094d6749a95ff69b338a0903"
target_path: /home/raul/dev/github/motogp/app/shared/format.ts
timestamp: 2026-11-08T20-04-40Z
slug: app-shared-format-es-es
---
Method: dual-agent (A: design director · B: detector)

# Crítica de diseño — P3 localización es-ES (separador decimal en toda la app)

**Superficie:** OPERATE — datos de decisión (precio, presupuesto, coste, saldo, puntos) en 6 superficies: `/mercado`, `/`, `/lineups`, `/ligas/[id]`, `/admin` (precios), `score-breakdown` (`/puntuacion` + `/resultados`).

**Tesis (antes de la crítica):**
- La convención numérica es un atributo de identidad, no un detalle: el North Star ("El Muro de Boxes") pide datos legibles bajo presión, y los números de esta app son datos de decisión.
- Una única fuente de formato (`formatNumber`, es-ES, sin ceros sobrantes) — los componentes delegan, no duplican la config `Intl`.
- El parser acepta el separador del usuario (coma) y el mensaje de error dice el formato con ejemplo.
- El cierre del P1 cross-page es real: el mismo activo se lee igual en `/mercado` y en `/lineups`.

**Corrida A (R1):** veredicto **APROBADO CON REVISIÓN** — 34/40, 0 P0 / 1 P1 / 2 P2 / 3 P3. El P1 se resolvió antes de cerrar:

- **P1 — inconsistencia inter-página: el cambio se detenía en la frontera de `/mercado`** — el mismo activo se leía "17,4" en `/mercado` y "17.4" en `/lineups`/`/`/`/ligas/[id]`/`/admin`; contradecía el docstring "única fuente de formato" de `format.ts`. → **CERRADO:** barrido cross-page — `/` (presupuesto total/base/carry, coste, saldo, puntos por liga con guard null → "—"), `/lineups` (selects de precio, `riderPriceLabel`/`assetPriceLabel`, presupuesto, coste/saldo guardado, borrador + sobrecoste, historial antes→después), `/ligas/[id]` (puntos del ranking), `/admin` precios (rango P0 min–max, P0 por activo, histórico, cambios de recálculo).

**Corrida A (R2, tras el barrido):** **APROBADO** — 0 P0 / 0 P1 / 3 P3. Todos cerrados:
- **P3-1** — aria-labels de Sparkline/PriceChart usaban `", "` como separador de puntos: la coma de separación colisionaba con la coma decimal al leerse en voz alta. → `join("; ")`.
- **P3-2** — "introduce un número positivo" era impreciso para valores negativos (el parser rechaza, pero el mensaje sugería que solo era el signo el problema). → "introduce un número válido (usa coma para decimales, p. ej. 17,4)".
- **P3-3** — "máximo 2 decimales" sin ejemplo. → "máximo 2 decimales (p. ej. 17,45)".

**Corrida B:** `impeccable detect --json` sobre los 7 archivos (format.ts, score-breakdown, mercado-page, page.tsx, lineups-page, league-detail-page, prices-panel) → **`[]` limpio** (exit 0).

**Fuera de alcance (decisión explícita, documentada):**
- Inputs `value=` (se quedan crudos — el usuario escribe; el parser acepta coma).
- Counts enteros (GPs, resultados, lineups) — `formatNumber` es no-op sobre enteros.
- Mensaje server-side "El lineup excede el presupuesto por X (coste Y, presupuesto Z)" (`lineup-service.ts`) — contrato de error tRPC; alinear cuando se decida el formato de inputs.
- Import manual de resultados (`/^\d+(\.\d+)?$/`) — alinear cuando se decida el formato de inputs.

**Tests:** unit `format.test.ts` 4 casos (NUEVO); UI `mercado-page` +3 (coma entrada → número, display coma lista/tendencia/sparkline, fixture decimales RIDER_D); aserciones actualizadas (dashboard 150,5/800,25; ranking liga 170,5; admin "— → 7,83"; mensajes de error; aria `;`).

**Puertas:** lint 0 errores, typecheck, unit 907/907, UI 715/715, build 19/19.
