---
target: página /resultados
total_score: 36
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 0
target_identity: "file:/home/raul/dev/github/motogp/app/resultados/resultados-page.tsx"
target_fingerprint: "sha256:913981520a4c213cb02e753363fe73ae4d0c93cfceb9d5fcb8c489eef3f9ec6a"
target_path: /home/raul/dev/github/motogp/app/resultados/resultados-page.tsx
timestamp: 2026-11-07T16-41-18Z
slug: app-resultados-resultados-page-tsx
---
Method: dual-agent (A: design director · B: detector)

# Crítica de diseño — página `/resultados` · F3

**Superficie:** OPERATE — resultados y ranking por GP (US-22): estado del GP (definitivo + versión de resultados), posición en cada liga + delta vs el GP anterior, desglose de puntuación (US-20), aviso + histórico de recálculo (US-19), "GP cancelado, 0 puntos", y los estados legítimos (sin lineup / sin resultados / sin ligas).

**Corridas A de la jornada (misma superficie):** 1ª 37/40 → post-P2 28/40 (2 P1: alerta roja para estados legítimos; estado vacío sin salida) → post-P1 38/40 (1 P2: "GP cancelado" ÁMBAR) → 35/40 (1 P2: `NOT_FOUND` sobrecargado) → 36/40 (2 P2: delta negativo rojo; error `myResults` siempre rojo) → **re-evaluación aislada final sobre el código corregido → A = 36/40 (0 P0/P1/P2, 6 P3)** · B re-ejecutado sobre el código final → **exit 0, findings `[]`**.

**Reconciliación.** Los P1 de la jornada (alerta roja para estados legítimos — `NOT_FOUND` sin lineup / `PRECONDITION_FAILED` sin resultados; estado vacío sin salida) se corrigieron clasificando el error tRPC (`scoreErrorKind`) y pintando los estados legítimos neutros (info) con salida accionable ("Monta tu lineup"→/lineups, "Explora las ligas"→/ligas); rojo solo para fallos reales. P2 posteriores resueltos: "GP cancelado" ÁMBAR (evento excepcional, documentado en código); `NOT_FOUND` sobrecargado (desambiguado por mensaje — solo «…lineup…» es legítimo, «GP no existe»=fallo real); delta negativo rojo→muted (dato, no fallo). El P2 "error de `myResults` siempre rojo" se evaluó contra el contrato server y es **falso positivo**: `myGpResults` solo lanza `NOT_FOUND` «GP no existe» (fallo real), no estados legítimos → rojo correcto. Re-evaluación aislada post-fix → **36/40, 0 P0/P1/P2**.

## Design Health Score (36/40 · Excelente, 90%)

| # | Heurística | Nota | Punto clave |
|---|-----------|-------|-------------|
| 1 | Jerarquía y foco | **3** | h1→h2 (Temporada y GP · Mis resultados — {GP} · Mi puntuación)→h3; sin saltos; el bloque selector es h2 como manda F3. P3: la auto-selección abre en el GP próximo, no en el último con datos. |
| 2 | Semántica de color | **4** | Rojo solo fallos reales (errores de carga, `myScore` fuera de legítimos); delta sube=verde / baja=neutro; "GP cancelado" ÁMBAR documentado; sin fugas. |
| 3 | Estados y feedback | **4** | Todos los legítimos nombrados y neutros: sin lineup (info+link), sin resultados (info), sin ligas (muted+link), sin GP, sin definitivos, sin posición, delta 0, provisional. |
| 4 | Mensajes accionables | **4** | "Monta tu lineup"→/lineups; "Explora las ligas"→/ligas; sin resultados explica el timing sin salida falsa (importación es de admin). |
| 5 | Honestidad de la interfaz | **3** | Provisional/definitivo con reglas + versión de resultados; recálculo anterior→nuevo con motivo y actor; "sin posición" neutro. P3: la ayuda define "Corrección" pero la sección se titula "Resultados actualizados". |
| 6 | Densidad y legibilidad | **3** | Listas de datos `.status` con separadores, escaneables; cabina de una columna. P3: el aviso "provisional" se duplica (línea muted + Alert info del desglose). |
| 7 | Consistencia con el sistema | **3** | Mismo bloque "Temporada y GP", patrón "X — {GP}", `ScoreBreakdown` compartido con /puntuacion, auto-selección F3, capa de ayuda. P3: mayúsculas de etiquetas de evento ("sprint" vs "Sprint"). |
| 8 | Accesibilidad | **4** | Labels en selects, roles (status/alert), sin bloqueos sin motivo, AA. |
| 9 | Responsive | **4** | Cabina de una columna, selects a ancho completo, filas que envuelven, sin desborde a 375px. |
| 10 | Bordes y casos | **4** | GP cancelado, sin lineup, sin resultados, sin definitivos, sin posición, delta 0, recálculo, provisional, fallo real. P3: snap-back de la opción vacía; pista "Selecciona un GP…" sin temporadas. |
| **Total** | | **36/40** | **Excelente (90%)** |

## Veredicto de especificidad de diseño

**Evaluación (A, post-fix).** "Cabina de resultados" con identidad propia: la lectura de consola (temporada → GP → estado → posición → desglose), la disciplina de color exacta (rojo solo fallo real, ÁMBAR solo aviso excepcional, verde solo mejora, neutro para lo legítimo), y la honestidad del dato (provisional/definitivo con reglas + versión, recálculo anterior→nuevo con motivo y actor, "sin posición" sin inventar cero) dan a la página carácter de operación de lectura bien diseñada. Los fixes no diluyeron la identidad: la reforzaron — desambiguar `NOT_FOUND` por mensaje y quitar el rojo del delta eran justo el tipo de coherencia que la honestidad de la interfaz exige. Lo que queda es pulido (6 P3), no falta de identidad.

**Escan determinista (B).** `impeccable detect --json app/resultados` → exit 0, `[]`: 0 findings sobre el código final (re-ejecutado tras los fixes).

**Evidencia de navegador.** Sin tool de navegador en esta corrida (B = detector solo); los cambios de UI están cubiertos por 16 tests de UI (`resultados-page`): clasificación de errores por código/mensaje, estados legítimos neutros con salida accionable, delta positivo/negativo/empate, recálculo con histórico, GP cancelado, provisional, y el caso `NOT_FOUND` «GP no existe» (fallo real, sin CTA).

## Lo que funciona

1. **Disciplina de señales exacta y verificada contra el contrato server:** rojo solo para fallos reales (errores de `seasons`/`results`, y `myScore` fuera de los legítimos); la sobrecarga de `NOT_FOUND` se resuelve por mensaje y encaja con los mensajes reales ("No tienes lineup para este GP." → info + "Monta tu lineup"; "El GP no existe." → rojo); "GP cancelado" en ÁMBAR documentado.
2. **Delta coherente de punta a punta:** el contrato del BFF (positivo = subí) coincide con la UI (▲ verde, ▼/empate neutro, "sin posición" neutro) — cero señal falsa en el dato más sensible de la página.
3. **Higiene F3 completa:** `.stack` en el selector, listas `.status`, h2 "Mis resultados — {GP}", auto-selección de temporada+GP, capa de ayuda antes de la primera lista, salidas accionables en los estados legítimos y guardas de datos obsoletas en ambas queries (`gp.id === gpId`, `score.data.gpId === gpId`).

## Issues residuales (sin P0/P1/P2; 6 P3 abiertos)

Los 6 son de pulido; ninguno rompe flujo, da señal falsa ni pierde trabajo. Se documentan para decisión explícita (precedente /lineups: P3 abierto registrado, no parcheado en cadena).

1. **[P3] La opción vacía de los selects se revierte (snap-back)** — elegir "— Temporada —"/"— GP —" es anulado al instante por los efectos de auto-selección — *fix:* retirar la opción vacía o respetar la deselección explícita (flag `userCleared`).
2. **[P3] La auto-selección abre en el GP próximo, no en el último con datos** — una página de resultados aterriza por defecto en un GP sin resultados mientras el último GP disputado exige selección manual — *fix:* en /resultados, preferir el último GP con resultados como por defecto (el patrón /mercado encaja mejor en /mercado).
3. **[P3] Vocabulario de la capa de ayuda no coincide con el titular de sección** — la ayuda define "Corrección" pero la sección se titula "Resultados actualizados" — *fix:* alinear el término (p. ej. "Correcciones (resultados actualizados)").
4. **[P3] Aviso de puntuación provisional duplicado** — "provisional" se anuncia dos veces (línea muted + Alert info del desglose) — *fix:* la página se limita a la versión de reglas y deja la explicación al componente.
5. **[P3] Mayúsculas inconsistentes en etiquetas de eventos** — "sprint" (`EVENT_LABELS`) frente a "Sprint" (`RiderRow`) — *fix:* unificar mayúsculas.
6. **[P3] Pista engañosa cuando no hay temporadas** — si `seasons.data` es vacía se muestra "Selecciona un GP…" sin que el selector de GP esté renderizado — *fix:* condicionar la pista a `seasonId === "" && seasons.data.length > 0`.

## Observaciones menores

- El P2 "error de `myResults` siempre rojo" (corrida 36/40) se evaluó contra el contrato server (`myGpResults`) y es **falso positivo**: solo lanza `NOT_FOUND` «GP no existe» (fallo real), no estados legítimos → rojo correcto; no se parcha.
- `ScoreBreakdown` es compartido con `/puntuacion`; los P3 4 y 5 (duplicación provisional, mayúsculas de evento) afectan a ambas páginas y se resolverían al cerrar `/puntuacion` en la cadena F3.
- El rojo juega doble papel: acento de marca (botón primario, links, foco) y señal negativa (`.bad`, `alert-error`). Son tokens distintos (`--accent` vs `--bad`) y coherentes con /mercado y /lineups; decisión de sistema, no de página.

## Preguntas provocadoras

1. Dado que /resultados es una página de *lectura*, ¿debería la auto-selección aterrizar en el último GP **con datos** (el que interesa al fan) en vez del próximo, a diferencia de /mercado y /lineups (que sí quieren el próximo)?
2. Si "provisional" se explica ya en el desglose (`ScoreBreakdown`), ¿debería la página no repetirlo para no diluir la señal?
3. Con la opción vacía que se revierte, ¿debería /resultados permitir explícitamente "quedarse sin GP" (estado de reposo) en vez de forzar siempre uno?
