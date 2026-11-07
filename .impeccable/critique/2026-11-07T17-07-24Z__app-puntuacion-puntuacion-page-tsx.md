---
target: página /puntuacion
total_score: 35
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 0
target_identity: "file:/home/raul/dev/github/motogp/app/puntuacion/puntuacion-page.tsx"
target_fingerprint: "sha256:0222e99304d111e8be3aca0ecf5bdc27e642a978123192a4dbb93d62962297b4"
target_path: /home/raul/dev/github/motogp/app/puntuacion/puntuacion-page.tsx
timestamp: 2026-11-07T17-07-24Z
slug: app-puntuacion-puntuacion-page-tsx
---
Method: dual-agent (A: design director · B: detector)

# Crítica de diseño — página `/puntuacion` · F3

**Superficie:** OPERATE — "Mi puntuación" con desglose (US-20): total con versiones de reglas/resultados, desglose por piloto (Q2/sprint/carrera/bonos/penalizaciones) con pesos oro ×1 / plata ×0,5, constructor y equipo (media top-2), y el estado provisional (ADR-0031) con los eventos incluidos.

**Corridas A de la jornada (misma superficie):** 1ª **27/40** (1 P1 + 3 P2 + 3 P3: estados legítimos de `myScore` en rojo; sin auto-selección; sin capa de ayuda; selector sin `.stack`) → fixes aplicados (P1 `scoreErrorKind`/`renderScoreError` + enlace a /lineups; P2 auto-selección temporada+GP; P2 capa de ayuda de vocabulario; P2 `.stack`; P3 `ul.status` en el desglose por piloto) → **re-evaluación aislada final sobre el código corregido → A = 35/40 (0 P0/P1, 1 P2 + 1 P3)** · B re-ejecutado sobre el código final → **exit 0, findings `[]`**.

**Reconciliación.** El P1 de la jornada (los 3 errores de `myScore` pintados en rojo) se corrigió clasificando el error tRPC por código + mensaje (`scoreErrorKind`/`renderScoreError`, mismo patrón que /resultados): `PRECONDITION_FAILED` (sin resultados) → info neutro; `NOT_FOUND` + «…lineup…» (sin lineup) → info neutro + salida accionable "Monta tu lineup"→/lineups; `NOT_FOUND` «GP no existe» (fallo real, sobrecarga del código) → rojo. Los 3 P2 de la jornada (auto-selección, capa de ayuda, `.stack`) se aplicaron con el patrón F3 ya consolidado en /mercado, /lineups y /resultados. Quedan 1 P2 + 1 P3 (ver "Issues residuales").

## Design Health Score (35/40 · Excelente, 88%)

| # | Heurística | Nota | Punto clave |
|---|-----------|-------|-------------|
| 1 | Jerarquía y foco | **3** | h2 (Temporada y GP · Mi puntuación — {GP})→h3 (Oro/Plata/Constructor y equipo); sin saltos; el bloque selector es h2 como manda F3. P2: la auto-selección abre en el GP próximo, no en el último con puntuación. |
| 2 | Semántica de color | **4** | Rojo solo fallos reales (error de `seasons`, `myScore` fuera de legítimos); los 3 errores de `myScore` discriminados (2 info neutros + 1 rojo); sin fugas. |
| 3 | Estados y feedback | **4** | Todos los legítimos nombrados y neutros: sin resultados (info), sin lineup (info+link), sin GP, provisional (aviso + eventos). |
| 4 | Mensajes accionables | **4** | "Monta tu lineup"→/lineups; sin resultados explica el timing sin salida falsa (importación es de admin). |
| 5 | Honestidad de la interfaz | **4** | Provisional/definitivo con reglas + versión de resultados; desglose con pesos visibles y datos primero. |
| 6 | Densidad y legibilidad | **3** | Listas de datos `.status` con separadores, escaneables; cabina de una columna. P3: `CODE_LABELS`/`EVENT_LABELS` degeneran al código crudo si aparece un bono/evento nuevo. |
| 7 | Consistencia con el sistema | **4** | Mismo bloque "Temporada y GP", patrón "X — {GP}", `ScoreBreakdown` compartido con /resultados, auto-selección F3, capa de ayuda, `.status`. |
| 8 | Accesibilidad | **4** | Labels en selects, roles (status/alert), sin bloqueos sin motivo, AA. |
| 9 | Responsive | **4** | Cabina de una columna, selects a ancho completo, filas que envuelven, sin desborde a 375px. |
| 10 | Bordes y casos | **4** | Sin resultados, sin lineup, sin GP, provisional, fallo real, `NOT_FOUND` sobrecargado desambiguado. |
| **Total** | | **35/40** | **Excelente (88%)** |

## Veredicto de especificidad de diseño

**Evaluación (A, post-fix).** "Cabina de puntuación" con identidad propia: la lectura de consola (temporada → GP → total → desglose), la disciplina de color exacta (rojo solo fallo real; los 3 errores de `myScore` discriminados — 2 legítimos neutros con salida accionable, 1 fallo real en rojo), y la honestidad del dato (provisional/definitivo con reglas + versión, desglose con pesos visibles) dan a la página carácter de operación de lectura bien diseñada. Los fixes no diluyeron la identidad: la reforzaron — desambiguar `NOT_FOUND` por mensaje y quitar el rojo de los estados legítimos eran justo el tipo de coherencia que la honestidad de la interfaz exige. Lo que queda es 1 P2 de alcance (auto-selección) + 1 P3 de pulido, no falta de identidad.

**Escan determinista (B).** `impeccable detect --json app/puntuacion app/shared/components/score-breakdown.tsx` → exit 0, `[]`: 0 findings sobre el código final (re-ejecutado tras los fixes).

**Evidencia de navegador.** Sin tool de navegador en esta corrida (B = detector solo); los cambios de UI están cubiertos por 9 tests de UI (`puntuacion-page`): discriminación de los 3 errores de `myScore` por código/mensaje (2 info neutros + 1 rojo), `NOT_FOUND` «GP no existe» (fallo real, sin CTA), desglose 170.5 (scoring.md §5), provisional (ADR-0031) con eventos, y el render del desglose oro/plata/constructor/equipo.

## Lo que funciona

1. **Disciplina de señales exacta y verificada contra el contrato server:** rojo solo para fallos reales (error de `seasons`, y `myScore` fuera de los legítimos); la sobrecarga de `NOT_FOUND` se resuelve por mensaje y encaja con los mensajes reales ("No tienes lineup para este GP." → info + "Monta tu lineup"; "El GP no existe." → rojo); `PRECONDITION_FAILED` (sin resultados) → info neutro.
2. **Honestidad del dato de punta a punta:** provisional/definitivo con reglas + versión de resultados; desglose con pesos oro ×1 / plata ×0,5 visibles; constructor y equipo (media top-2); bonos/penalizaciones con etiquetas en español.
3. **Higiene F3 completa:** `.stack` en el selector, listas `.status`, h2 "Mi puntuación — {GP}", auto-selección de temporada+GP, capa de ayuda de vocabulario antes de la primera lista, salida accionable en el estado "sin lineup" y guarda de datos obsoletas (`score.data.gpId === gpId`).

## Issues residuales (sin P0/P1; 1 P2 + 1 P3 abiertos)

Se documentan para decisión explícita (precedente /resultados: P2/P3 abiertos registrados, no parcheados en cadena).

1. **[P2] La auto-selección abre en el GP próximo, no en el último con puntuación** — una página de *puntuación* aterriza por defecto en un GP sin puntuación mientras el último GP disputado (el que interesa al fan) exige selección manual — *fix:* preferir el último GP con `Score` como por defecto, con fallback al primer programado. **Alcance:** requiere un nuevo endpoint en `results` (listar los GPs con puntuación del actor) — cambio funcional más allá de la UX de página, fuera del alcance F3 (sistema de diseño). El default "próximo GP" es el patrón F3 consolidado y consistente en /mercado, /lineups y /resultados (donde el mismo punto quedó abierto como P3).
2. **[P3] `CODE_LABELS`/`EVENT_LABELS` degeneran al código crudo si aparece un bono/evento nuevo** — `?? code` / `?? e` expone identificadores técnicos al usuario — *fix:* añadir un fallback neutro (p. ej. "Otro ajuste") o un `console.warn` en dev. **Nota:** el comportamiento actual es defensible — mostrar el código crudo es lo que alerta al desarrollador de que falta una etiqueta; un fallback neutro lo ocultaría y dificultaría notarlo.

## Observaciones menores

- `ScoreBreakdown` es compartido con `/resultados`; el P3 2 (código crudo) afecta a ambas páginas.
- El P3 1 de /resultados ("auto-selección abre en GP próximo, no último con datos") es el mismo punto que aquí es P2; se mantiene abierto en ambas por el mismo motivo de alcance (nuevo endpoint).
- El rojo juega doble papel: acento de marca (botón primario, links, foco) y señal negativa (`.bad`, `alert-error`). Son tokens distintos (`--accent` vs `--bad`) y coherentes con /mercado y /lineups; decisión de sistema, no de página.

## Preguntas provocadoras

1. Dado que /puntuacion es una página de *lectura de mi última puntuación*, ¿debería la auto-selección aterrizar en el último GP **con puntuación** (el que interesa al fan) en vez del próximo, a diferencia de /mercado y /lineups (que sí quieren el próximo)?
2. Si un bono/evento nuevo aparece sin etiqueta, ¿es mejor mostrar el código crudo (alerta al dev) o un fallback neutro (limpio para el usuario)?
3. Con la opción vacía que se revierte (P3 de /resultados), ¿debería /puntuacion permitir explícitamente "quedarse sin GP" (estado de reposo) en vez de forzar siempre uno?
