---
target: panel /admin
total_score: 36
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
target_identity: "file:/home/raul/dev/github/motogp/app/admin/page.tsx"
target_fingerprint: "sha256:10d3bcf89a1c03ee63a785ea775394e3b64206c66cd7c412341776cb1e77b9b1"
target_path: /home/raul/dev/github/motogp/app/admin/page.tsx
timestamp: 2026-11-06T15-42-01Z
slug: app-admin-page-tsx
---
Method: dual-agent (A: design director · B: detector + browser evidence)

# Crítica de diseño — panel `/admin` · re-evaluación y cierre de F1

**Superficie:** OPERATE — cabina operativa interna (admin global), en español.
**Base anterior:** 31/40 (snapshot 2026-11-05T15-55-16Z).
**Reconciliación de esta corrida:** A = 35/40 (pre-fix) · B = 0 anti-patterns (`impeccable detect app/admin/` → `[]`) · los 3 puntos restantes de A (capa de ayuda de cancelar/neutralizar, párrafo de acciones en línea, salto de encabezados) se corrigieron la misma jornada, después de la evaluación → **+1 en #10 Help** (y refuerza #4 Consistencia y #6 Reconocimiento) → **36/40**.

## Design Health Score (36/40 · Excelente, 90%)

| # | Heurística | Nota | Punto clave |
|---|-----------|-------|-------------|
| 1 | Visibilidad del estado del sistema | **4** | Toda query con pendiente/error/éxito; éxitos con contadores concretos; no-ops explícitos; estado del GP con `resultsVersion`; tabla de fallos del auto-import con umbral. |
| 2 | Ajuste al mundo real | **4** | Vocabulario del producto (ritual, definitivo, lockout, P0); pasos en el orden real del operador; "Siguiente paso" escrito en cada estado de la consola. |
| 3 | Control y libertad del usuario | **4** | Re-importar corrige sin borrar; neutralizar idempotente; cancelar dice que es irreversible; protección de trabajo sucio con opción de conservar; revert de la URL al cancelar. |
| 4 | Consistencia y estándares | **3** | **Corregido:** salto h2→h4 (h3 en el preview de mercado) y párrafo de acciones en línea (`ul.status`, una fila por evento). **Residual:** `<ul>` desnudo de eventos del GP en `gp-actions.tsx` y h2 dentro de las tarjetas de «Altas». |
| 5 | Prevención de errores | **4** | Solo se ofrecen transiciones válidas (`allowedGpStatusTransitions`); confirmación con impacto escrito; `disabledReason` en todo botón deshabilitado; validación local + Zod + server-side. |
| 6 | Reconocimiento antes que recuerdo | **4** | Cascada prellenada desde la URL; mapeo prellenado desde los sin-mapear; diff contra baseline con marca "modificada"; filas por evento con su acción (esta jornada). |
| 7 | Flexibilidad y eficiencia | **3** | Un fin de semana = 3 ciclos de importación (q2/sprint/race), sin lote; atajos solo dentro del diálogo (Enter/Esc/Tab). |
| 8 | Diseño minimalista estético | **3** | 9 secciones, una sección de resultados de 1513 líneas, pared de 4 listas en el preview de mercado; mitiga el colapso de «Altas» y los `details`. |
| 9 | Recuperación de errores | **4** | Errores con mensaje del servidor + `zodIssues` por campo; mensajes de recuperación accionables; no-ops explicados. |
| 10 | Ayuda y documentación | **3** | **+1:** cancelar/neutralizar se explica ahora *antes* de la acción (línea de ayuda + filas por evento). **Residual:** sin capa de ayuda para P0, Pmax, lockout, carry, rv-N fuera de los diálogos; sin enlaces a `docs/product/`. |
| **Total** | | **36/40** | **Excelente (90%)** |

## Veredicto de especificidad de diseño

**Evaluación (LLM).** No es un panel de administración genérico: es una **cabina**. Tema oscuro, rojo único como señal de acción/destrucción, rejilla de control de 44 px, ritual numerado (fin de semana → resultados → precios → mercado) y CRUD colapsado por defecto. El operador no decide "qué hago": *continúa* — la consola responde "¿qué hago ahora?" con estado + motivo + siguiente paso, y el handoff lleva el contexto (`?season=&gp=#resultados`) en vez de un scroll ciego. Lo que falta ya no es estructura, es **explicación**: el vocabulario (P0, Pmax, rv-N) solo vive dentro de los diálogos. Ese es el nuevo techo del panel — y su fix más barato.

**Escan determinista (B).** `impeccable detect --json app/admin/` → `[]`: 0 anti-patterns, 0 advisorys en los 24 ficheros del panel.

**Evidencia de navegador (B).** Sin overlay visible para el usuario (headless); señal de fallback = verificación en vivo con Playwright. Ahí se cazó el único bug live de la corrida: el scroll-spy no se activaba porque las secciones se montan después de la consulta `me` y el `IntersectionObserver` no se re-anudaba. Corregido con el parámetro `enabled` en `useScrollSpy` (el efecto se re-anuda al pasar a `true`) + test de regresión de late-mount, verificado en vivo.

## Impresión general

Los 8 puntos de la crítica anterior están corregidos y verificados en el código; el panel pasa de "CRUD con buenas intenciones" a **cabina de operaciones real**. Lo de corrección quedó resuelto; lo que queda es **explicación** (vocabulario, P1) y **densidad** (sección de resultados de 1513 líneas, pared del preview, P2). La mayor oportunidad: una capa de ayuda de una línea por término — el fix más barato con más impacto para un segundo operador futuro. F1 cierra sobre esta base: F2 (sistema de diseño) → F3 (resto de páginas) continúan con las mismas puertas de calidad.

## Lo que funciona

1. **La consola del fin de semana** (`page.tsx` + `season-activity.ts`): máquina de estados pura con tres salidas escritas (open/closed/empty), cada una con motivo y "Siguiente paso" anclado; el handoff prellena el ritual con contexto, y el re-click a la misma URL no re-dispara.
2. **La confirmación con impacto** (`ConfirmDialog`): título que nombra objeto+acción, impacto escrito, irreversible como warning, foco en la opción segura, foco devuelto al control que abrió. Aplicada de forma uniforme en los 6 ficheros que mutan datos — coherencia de sistema, no de página.
3. **La difusión de cambios:** diff contra baseline con marca "modificada" por piloto; precios "antes→después" computados en el servicio (P2-2, `changes: PriceChange[]`); contadores concretos en cada éxito. El operador nunca tiene que adivinar qué cambió.

## Issues prioritarios

**[P1] Sin capa de ayuda para el vocabulario del panel** (todo el panel)
- **Qué:** P0, Pmax, lockout, carry, rv-N no se definen en ninguna parte fuera de los diálogos de confirmación; sin enlaces a `docs/product/`. Cancelar/neutralizar es hoy la excepción que sí se explica *antes* de la acción.
- **Por qué:** para el admin-autor es un trade-off aceptable; el día que haya un segundo operador, "P0" y "rv-3" serán una llamada de teléfono. El panel está diseñado como si fuera para un rol.
- **Fix:** una línea de ayuda por término en su primera aparición, o un `<details>` de glosario en el pie de la consola con enlace a `docs/product/`.
- **Comando sugerido:** `/impeccable clarify`

**[P2] Importación por evento, sin lote** (`results-section.tsx`)
- **Qué:** un fin de semana completo = 3 ciclos de importación (q2, sprint, race), cada uno con su confirmación y su scroll.
- **Por qué:** correcto y seguro, pero en un día de resultados en vivo ahí se pierden los minutos: 2 confirmaciones y 2 scrolls de más por carrera.
- **Fix:** un "Importar los 3 eventos" que reutilice el mismo patrón de confirmación — un solo diálogo que enumera los 3 eventos con su impacto respectivo.
- **Comando sugerido:** `/impeccable optimize`

**[P2] Densidad de resultados y del preview de mercado**
- **Qué:** `results-section.tsx` son 1513 líneas en un solo `<section>`; el preview del import de mercado muestra 4 listas completas antes de permitir importar (con 20+ pilotos, una pared que obliga a scroll para llegar al botón).
- **Por qué:** los `details` mitigan pero no resuelven; el preview obliga a leer lo que el operador quiere confirmar, no leer.
- **Fix:** listas del preview colapsadas por defecto (contador + primeras filas + "ver todas"); el `details` del paso 2 ya sugiere la costura para dividir la sección de resultados.
- **Comando sugerido:** `/impeccable distill`

**[P3] Residuales de consistencia**
- **Qué:** `<ul>` desnudo de eventos del GP en `gp-actions.tsx:138-145` (el resto del panel usa `.status` o tablas); h2 dentro de las tarjetas colapsadas «Altas y configuración» (`page.tsx:318-332, 358-364`); el estado "sin transiciones" se indica por ausencia de acciones en vez de por etiqueta (`results-section.tsx:1463-1468`); UUIDs truncados en las afiliaciones del preview.
- **Por qué:** menor, pero es la diferencia entre un 3 y un 4 en #4 Consistencia.
- **Fix:** `ul.status` en gp-actions, h3 dentro de las «Altas», etiqueta "sin transiciones" explícita, nombres completos en el preview si la fuente los trae.
- **Comando sugerido:** `/impeccable polish`

## Red flags por persona

**A. El operador bajo presión (día de carrera, 10 minutos para cerrar el GP).**
- ✅ La consola le dice el siguiente paso, el ritual está prellenado, los no-ops no le hacen dudar, "Marcar definitivo" cuantifica el impacto.
- ✅ (Resuelto esta jornada) la decisión más cara — cancelar vs neutralizar — se explica ahora antes de la acción.
- ⚠️ Si aparece un término que no está en la consola, no hay a quién preguntar (P1).

**B. El operador que regresa (vuelve semanas después, contexto perdido).**
- ⚠️ El vocabulario (P0, neutralizado, lockout, rv-N) no se re-explica en ninguna parte; la consola mitiga "¿qué hago?" pero no "¿qué significa esto?".
- ✅ La URL conserva el contexto (F5/enlace compartido recupera la cascada) y el histórico de precios con "antes→después" le permite reconstruir la serie sin memoria.

**C. El admin-autor (hoy, la única persona real).**
- ✅ El panel está pensado para su flujo exacto; la densidad que a otros les pesa a él le ahorra clicks.
- ⚠️ La ausencia de capa de ayuda (P1) es hoy un activo (él escribe los docs) y mañana una deuda — una fecha de caducidad, no un bug.

## Observaciones menores

- Las afiliaciones del preview muestran `rider: <8 chars>… → equipo: <8 chars>…`: útil para el debug, casi inútil para la lectura.
- El `<h3>{name}</h3>` dinámico (nombre de cola) en `jobs-section.tsx:59` es el único encabezado generado por dato; funciona, pero rompe levemente el patrón de encabezados estáticos.
- h4 y h5 del mismo tamaño (0.9 rem), solo difieren en peso: advisory preexistente de la escala, candidata a F2.

## Preguntas provocadoras

1. **¿El panel es para una persona o para un rol?** Si es para un rol, la capa de ayuda no es opcional: el día que haya un segundo operador, "P0" y "neutralizar" serán una llamada de teléfono, no una línea de ayuda.
2. **¿Cuánto vale "Importar los 3 eventos"?** Si el operador repite el mismo ciclo 3 veces por fin de semana, el lote no es un lujo: son 2 confirmaciones y 2 scrolls menos por carrera.
3. **¿La consola del fin de semana es el futuro del panel?** Si "¿qué hago ahora?" se responde bien en la consola, ¿las otras 8 secciones no deberían empezar a parecerse a ella: estado + motivo + siguiente paso, en vez de CRUD?
4. **¿El panel envejece bien?** La densidad que hoy ahorra clicks al admin-autor mañana puede ahogar a un segundo operador.

## Barrido P2/P3 — cierre (2026-11-08)

- **P3 «`<ul>` desnudo de eventos del GP»** — CERRADO: `gp-actions.tsx` pasa de `<ul>` a `<ul className="status">` (misma piel de lista que el resto del panel; antes: lista sin la disciplina de `.status`).
- **P3 «estado "sin transiciones" por ausencia de acciones»** — YA CUBIERTO (el revisor no lo vio): la etiqueta `sin transiciones` ya existe en `results-section.tsx` (añadida en `3779cb6`, anterior a este snapshot) — `!canCancel && !canNeutralize → <span className="muted">sin transiciones</span>`, con test (`results-section.test.tsx:1979`).
- **P3 «h2 dentro de tarjetas colapsadas» / «UUIDs truncados en afiliaciones»** — ABIERTOS (triage por coste/riesgo): nits de layout y de densidad, no bloqueantes; fuera del alcance de pulido (requieren reestructuración del panel, ver P2 de densidad).

Puertas en verde (2026-11-08): typecheck, lint 0 errores, unit 903/903, UI 705/705, build, detector `impeccable detect --json` → `[]` sobre `app/admin/gp-actions.tsx`.
