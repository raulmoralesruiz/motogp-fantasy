---
target: página /lineups (US-41 · seleccionador gráfico)
total_score: 40
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 0
target_identity: "file:/home/raul/dev/github/motogp/app/lineups/lineups-page.tsx"
target_fingerprint: "sha256:3d5aa58addce852ff00262bd7eee49bbb84893e3b4baf095cdc01d89fe1908d2"
target_path: /home/raul/dev/github/motogp/app/lineups/lineups-page.tsx
timestamp: 2026-11-17T13-51-01Z
slug: app-lineups-lineups-page-tsx
---
Method: dual-agent (A: design director · B: detector)

# Crítica de diseño — página `/lineups` · US-41 (seleccionador gráfico de activos)

**Superficie:** OPERATE — composición del lineup por GP (2 oro + 2 plata + constructor + equipo) dentro de presupuesto, ahora mediante un **seleccionador gráfico** (6 botones de slot + rejilla de tarjetas con avatar generativo) en lugar de los 6 selects nativos. Misma operación, nueva interfaz. En español.
**Corridas A de la jornada (misma superficie):** pasada de cierre 2026-11-08 → **39/40 (0 P0/P1/P2, 8 P3 abiertos)**. Esta corrida (US-41, 2026-11-17): pasada crítica final sobre el código con el picker → **1 P3 detectado y corregido en código** (estado vacío decía «coincide con la **búsqueda**» aunque la rejilla también se vacía por el **filtro de grupo** → «coincide con los **filtros**», test actualizado) → **re-evaluación aislada final → A = 40/40 (0 P0/P1/P2/P3)** · B re-ejecutado sobre el código final → **exit 0, findings `[]`**.
**Reconciliación:** los **8 P3** del snapshot de 2026-11-07 (`guardar fuera de pliegue`, `errores sin "qué hacer"`, `wildcard sin irreversible`, `historial plano`, `fecha sin hora`, `sin "Limpiar borrador"`, `éxito sin sugerir wildcard`, `prefill pisa`) quedan **CERRADOS** (verificado uno a uno en el código final); el único P3 abierto de esta corrida (mensaje de estado vacío) se corrigió antes de puntuar.

## Design Health Score (40/40 · Excelente, 100%)

| # | Heurística | Nota | Punto clave |
|---|-----------|-------|-------------|
| 1 | Jerarquía y foco | **4** | El dato central (presupuesto/coste/saldo/cambios) manda en `.status`; el picker es la operación; «Guardar» cierra la barra sticky. Cada bloque tiene un rol. |
| 2 | Semántica de color | **4** | Rojo solo negativo, ámbar solo aviso, verde solo éxito, azul informativo; el tinte del avatar es **estético, no semántico** (Regla del Avatar Generativo) — sin fugas. |
| 3 | Estados y feedback | **4** | Slot activo (`aria-pressed` + acento), tarjeta asignada (borde + tinte), bloqueada (opacidad + motivo escrito), vacío, coste en vivo, éxito/errores. Todo se ve y se entiende. |
| 4 | Mensajes accionables | **4** | Bloqueos nombran qué falta / por qué (sin precio, ya en otro slot); el hint explica el toggle; los errores de carga acompañan «Reintentar». |
| 5 | Honestidad de la interfaz | **4** | Coste en vivo etiquetado como borrador; éxito solo al confirmar el servidor; «Sin precio» explícito; el cliente solo envía IDs (invariante 2). |
| 6 | Densidad y legibilidad | **4** | Cabina de una columna, espaciado `.stack` coherente, tarjeta = avatar + nombre + sublínea + precio; sin amontonamiento ni vacíos muertos. |
| 7 | Consistencia con el sistema | **4** | `.field`, patrón `Button`/`DisabledReason`, `.status`, tokens de color, Regla de los 44 — mismo sistema que /mercado y /admin. |
| 8 | Accesibilidad | **4** | `aria-label` explícito con separadores en tarjeta, `aria-pressed`, `aria-disabled`+`aria-describedby` al motivo, roles, foco nativo, AA, ≥44 px. |
| 9 | Responsive | **4** | ≤768 px: 2 columnas de slots, rejilla de 1 columna, `.form-actions` sticky; sin desborde a 375 px. |
| 10 | Bordes y casos | **4** | GP bloqueado/cerrado/cancelado, «Sin precio», «Ya en otro slot», sin coincidencias, slot vacío, borrador sucio, lockout. |
| **Total** | | **40/40** | **Excelente (100%)** |

## Veredicto de especificidad de diseño

**Evaluación (A, post-fix).** "Cabina de gestión del lineup" que ahora se compone **mirando** en lugar de **buscando en listas**: el modelo «slot activo + rejilla» convierte los 6 selects en un gesto — toco la plaza, toco la tarjeta — y el avatar generativo (dorsal o iniciales sobre el tinte derivado del nombre) identifica a cada activo sin una sola imagen licenciada. La identidad del sistema se refuerza, no se diluye: el bloqueo sigue siempre explicado con motivo escrito, el coste en vivo sigue nombrando la decisión, y la protección del borrador se mantiene. El picker hereda el patrón `Button.disabledReason` (nunca un control bloqueado sin explicación) y respeta la Regla de los 44 y la de tokens. Lo que quedó era un P3 de microcopy (estado vacío), corregido; no falta de identidad.

**Escan determinista (B).** `impeccable detect --json app/lineups` → exit 0, `[]`: 0 findings sobre el código final (re-ejecutado tras la corrección del estado vacío).

**Evidencia de navegador.** Sin tool de navegador en esta corrida (B = detector solo); la superficie está cubierta por 74 tests de UI (14 `AssetPicker` + 60 `lineups-page`) y 32 tests del núcleo puro `picker.ts`, más el E2E `flows.lineup` ×3 viewports (tarjetas, tarjeta bloqueada verificada, coste 94 ≤ 100, guardar).

## Lo que funciona

1. **Componer mirando, no buscando:** el modelo «slot activo + rejilla» reemplaza 6 selects por dos toques (plaza → tarjeta); tocar de nuevo la tarjeta asignada la quita, y un hint escrito lo explica.
2. **Ningún control bloqueado sin motivo escrito:** «Sin precio para este GP» / «Ya en otro slot» via `aria-disabled` + `aria-describedby` (patrón `Button.disabledReason`), opacados — no desaparecen.
3. **Avatar generativo sin licencias:** dorsal (o iniciales) sobre un tinte derivado determinísticamente del nombre; el texto usa solo tokens (`--bg` + `color-mix`), así el contraste es seguro sobre cualquier tinte y no entra un hex nuevo fuera de `:root`.
4. **Invariante 5 respetada en el filtro:** el grupo de un piloto es su equipo; el de un equipo es su constructor; el del constructor no existe — y al cambiar de tipo de slot el filtro se reinicia para no dejar una rejilla vacía «misteriosa».
5. **El cliente solo envía IDs (invariante 2):** el coste se recalcula en el servidor con la lista de precios congelada; el picker no envía ni coste ni presupuesto de confianza.
6. **El 8 de los 8 P3 de 2026-11-07 está cerrado:** guardar sticky, «Reintentar», wildcard `irreversible`, historial en `.status`, fecha + hora, «Limpiar borrador», éxito que sugiere el wildcard, prefill que no pisa.

## Issues residuales (0 P0/P1/P2/P3 abiertos)

Sin P0/P1/P2/P3 abiertos en el código final. **1 P3 detectado y cerrado en esta corrida** antes de puntuar:

1. **[P3, cerrado] Estado vacío impreciso** — «Ningún activo coincide con la **búsqueda**» cuando la rejilla también se vacía por el **filtro de grupo** — *fix aplicado:* «Ningún activo coincide con **los filtros**» (cubre búsqueda + grupo); test de UI actualizado (2 aserciones + nombre del test).

## Observaciones menores

- El hint de toggle («Vuelve a tocar a X para quitarlo de {slot}») vive al final, tras la rejilla: con una rejilla larga en móvil puede quedar bajo el pliegue. Es info complementaria (la tarjeta asignada ya marca su estado con `aria-pressed` + borde), así que no es un defecto — decisión de ubicación.
- Mover un activo de una plaza a otra del mismo tipo requiere **vaciar y reasignar** (tocar la tarjeta en su plaza actual para quitarla y luego asignarla en la nueva), no un «arrastrar directo». Es el modelo simple y consistente que el E2E verifica («Ya en otro slot» deshabilita la tarjeta en la plaza destino); un movimiento directo de un toque sería más rápido pero menos predecible.
- El tinte del avatar es determinístico por nombre: dos activos con nombres muy similares podrían acabar con tintes cercanos. El dorsal/iniciales + el texto del nombre los desambiguan; es ornamental-informativo, no de estado.

## Preguntas provocadoras

1. ¿Debe el movimiento entre plazas del mismo tipo ser un **arrastrar de un toque** (activo → plaza destino) en vez de vaciar-reasignar, para el caso frecuente de «cambiar a otro oro»?
2. Dado el avatar generativo, ¿conviene dejar un **configurador de color por activo** (el admin fija el tinte de su equipo) sin romper la Regla del Avatar Generativo (color derivado por defecto, override opcional)?
3. Con seis plazas, ¿debería el picker **recuerda la última plaza activa** por sesión del GP para no volver siempre al piloto oro 1?

## Cierre (2026-11-17)

US-41 (ADR-0041): `/lineups` se compone con el seleccionador gráfico. Los 6 selects nativos quedan retirados. Nueva regla «La Regla del Avatar Generativo» y nuevo componente «Asset Picker» en `DESIGN.md`. El núcleo puro (`app/shared/picker.ts`) es testable como fórmula (32 tests); el componente solo renderiza (14 tests UI); la página (60 tests UI) delega la semántica de movimiento. El único P3 de la corrida (microcopy del estado vacío) se corrigió antes de puntuar.

**Verificación:** typecheck ✓ · lint 0 errores ✓ · unit `picker` 32/32 ✓ · UI `AssetPicker` 14/14 + `lineups-page` 60/60 (74) ✓ · detector `impeccable detect --json app/lineups` → `[]` (0 findings) · E2E `flows.lineup` ×3 viewports (verificado en CI) · **todo sin commit** (árbol de trabajo, a la espera de permiso del usuario).
