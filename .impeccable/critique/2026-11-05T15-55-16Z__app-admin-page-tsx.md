---
target: panel /admin
total_score: 31
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 2
target_identity: "file:/home/raul/dev/github/motogp/app/admin/page.tsx"
target_fingerprint: "sha256:9ad1421ca8b6f780f5b2c6e0024d4a86c1f0526998206313b7d254d8c985bbad"
target_path: /home/raul/dev/github/motogp/app/admin/page.tsx
timestamp: 2026-11-05T15-55-16Z
slug: app-admin-page-tsx
---
# Crítica de diseño — panel `/admin` (re-evaluación post-ola P1/P2)

**Método:** dual-agent (A: diseño director · B: detector + evidencia de navegador).
**Superficie:** OPERATE (cabina operativa de un panel interno, en español, para el organizador de liga / admin global).
**Base anterior:** 27/40 (snapshot 2026-11-05T01-07-32Z).

## Veredicto de especificidad de diseño

Este es un **cockpit operativo** con lenguaje propio: tema oscuro, rojo único como señal de acción/destrucción, rejilla de control de 44 px, ritual numerado (fin de semana → resultados → precios → mercado) y CRUD colapsado por defecto. La ola P1/P2 no fue cosmética: `ConfirmDialog` con impacto y default seguro, deshabilitados con motivo escrito, cobertura touch completa y foco uniforme son sistema, no parches. Ya no se parece a «pantallas de admin pegadas»: se parece a una cabina de vuelo.

Pero la cabina tiene dos grietas que se ven en uso real:

1. **La primera pantalla prometía y no dijo.** La consola «Fin de semana de carrera» —la que vende el ritual— mostraba «Siguiente paso» vacío en la BD viva, porque selecciona la temporada más reciente por `year` y la más reciente es una E2E de 2105 sin GPs.
2. **El estado que ofrece no es el estado que tiene.** Tras «Cancelar evento», la UI sigue ofreciendo «Neutralizar evento» como transición válida —y neutralizar después de cancelar es un no-op para la puntuación (la flag `cancelled` es write-once y domina el recálculo, verificado en `setEventFlag` y en el recálculo).

## Escala de heurísticas (Nielsen 10)

| # | Heurística | Score | Problema clave |
|---|-----------|:---:|----------------|
| 1 | Visibilidad del estado del sistema | 3 | Estado en todas partes (GP/evento, contadores, motivos), pero la nav no tiene `aria-current`/scroll-spy y la consola «Siguiente paso» llegó vacía en BD viva |
| 2 | Coincidencia con el mundo real | 3 | Lenguaje de dominio excelente; pero conviven dos capas de «cancelado» (estado de GP vs flag de evento) y el impacto del diálogo es estático |
| 3 | Control y libertad del usuario | 3 | `ConfirmDialog` con default seguro «No, volver» y retorno de foco —excelente—; pero la transición no-op cancelar→neutralizar se sigue ofreciendo |
| 4 | Coherencia y estándares | 3 | Sistema de control 44 px, foco y alertas unificados; pero los pasos de Resultados son h3 (16 px) y los de Precios h4/h5 (14,4 px), con inversión h3 > h4 (reforzado por detector: 3 avisos `heading-rhythm`) |
| 5 | Prevención de errores | 3 | Confirmación con impacto + advertencia de irreversible (texto verificado preciso); pero el texto no cuantifica el volumen de resultados afectados |
| 6 | Reconocimiento en vez de recuerdo | 4 | Nav sticky de 10 chips + 4 fases, etiquetas visibles, motivos escritos en los 6 deshabilitados |
| 7 | Flexibilidad y eficiencia | 3 | Nav ancla + cascadas ayudan; pero sin acciones en lote y cada operación de resultados cuesta 3 selects en serie (temporada → GP → evento) |
| 8 | Estética y diseño minimalista | 3 | Acento único disciplinado, CRUD colapsado, diálogos compactos; pero escala de encabezados comprimida y 4 estilos inline |
| 9 | Recuperación de errores | 3 | Alerts de éxito con contadores; pero sin diff antes→después en el recálculo de precios |
| 10 | Ayuda y documentación | 3 | Fases = ritual operativo; panel «Jobs y fuentes» con probe a demanda; pero sin enlazado al runbook ni ayuda en campo |

**Total: 31/40** (banda: Good). Las 10 heurísticas aplican (7 y 10 sin atenuar: es una consola usada por power users que trabajan desde un runbook).

## Evidencia del detector (evaluación B)

- **CLI sobre el código:** limpio (exit 0, cero hallazgos).
- **DOM en vivo (CDP):** 15 hallazgos primarios + 3 advisories: `nested-cards` ×8 (`ul.status` dentro de `div.card` —patrón deliberado de lista de estado con filete, no card-slop; se juzga menor), `line-length` ×4 (4 párrafos `p.muted` de ~100–104 caracteres), `heading-rhythm` ×3 (h3/h4 con 0 px arriba y 16 px abajo —refuerza la P2 de jerarquía de pasos), `low-contrast` ×2 advisory (placeholders «2026» a 4.0:1, intencionalmente atenuados), `em-dash-overuse` ×1 advisory (70 guiones largos: convención tipográfica española deliberada en este producto → falso positivo).
- **Overlay de navegador:** inyección bloqueada por la CSP propia de la app (`script-src 'self'` / `connect-src 'self'` —el live-server es otro origen). Fallback documentado: escaneo CDP del DOM autenticado (el equivalente determinista). No hay overlay visible para el usuario.
- **Convergencia A+B:** ambas evaluaciones señalan la jerarquía de encabezados de los pasos (A por nivel tipográfico, B por ritmo de espaciado). El detector añade 4 párrafos densos y el doble borde `ul.status` que A no nombró; A añade los 2 P0 semánticos que el detector no puede ver.

## Fuerzas (verificadas en código y en vivo)

1. **Sistema de ConfirmDialog:** `role=dialog` + `aria-modal` + focus trap, foco inicial en la opción segura, retorno de foco al elemento que abrió, `role=alert` para lo irreversible, primaria destructora en rojo. El `window.confirm` solo sobrevive fuera del panel (`app/ligas/[id]/league-detail-page.tsx:305`).
2. **Deshabilitado con motivo:** los 6 botones `aria-disabled` traen `aria-describedby` con el motivo escrito.
3. **Cobertura y a11y base:** 0 elementos interactivos <44 px en 1280 y 390; 28/28 controles etiquetados; 0 overflow horizontal; foco 2 px sólido en rojo de marca en las 6 familias.
4. **Alertas de éxito cuantificadas** (contadores «X creados, Y actualizados, Z sin cambios, W sin P0»).
5. **Copia de impacto precisa:** «El evento no puntuará (0 para todos). Acción irreversible.» —verificada contra `scoring.md §6`.

## Problemas prioritarios

**P0-1 — «Neutralizar evento» se sigue ofreciendo tras «Cancelar evento», y es un no-op.**
`canNeutralize` (`app/admin/results-section.tsx:1414`) comprueba solo `resultsStatus !== "neutralized"` e ignora `cancelled`; `setEventFlag` (`results-service.ts:2076–2132`) es write-once y devuelve `noop: true` si la flag ya está fijada; el recálculo excluye el evento cancelado (`cancelledEvents`, `raceCancelled`). El operador ve un camino de vuelta que no existe: el diálogo le dijo «irreversible» y dos líneas debajo la lista de acciones dice «puedes».
*Fix:* `canNeutralize = event.resultsStatus !== "neutralized" && !event.cancelled` —o, si la decisión de producto es permitirlo, implementarlo como acción explícita y auditada («Anular la cancelación»). Alinear la máquina de estados de `scoring.md §6`, el diálogo y la oferta de acciones.
*Comando:* `/impeccable harden`.

**P0-2 — El impacto del diálogo no escala con el daño.**
El impacto de cancelar es texto estático (`results-section.tsx:613`): idéntico para el evento con 0 resultados que para el de GP1 de «Temporada Ficticia (2099)» (11 resultados definitivos, 40 lineups puntuados). «Irreversible» es abstracto; «11 resultados definitivos y 40 lineups dejarán de puntuar» es concreto. Los contadores ya están en la línea de estado del evento.
*Fix:* inyectar los contadores en el impacto del diálogo.
*Comando:* `/impeccable clarify`.

**P1-1 — Consola frágil en BD multi-temporada: «Siguiente paso» vacío.**
La consola (`app/admin/page.tsx:51–152`) elige la temporada más reciente por `year` desc; en la BD viva esa es la E2E de 2105 sin GPs → «Siguiente paso» vacío. Un admin no distingue «sistema sano, nada que hacer», «hay algo que hacer en otra temporada» y «algo se rompió».
*Fix:* la consola opera sobre «la temporada con GPs sin cerrar» (o la más reciente con actividad); el estado vacío dice por qué y qué hacer, con enlace a Temporadas.
*Comando:* `/impeccable adapt`.

**P1-2 — La nav no indica dónde estoy (sin `aria-current`/scroll-spy).**
10 chips + 4 fases, todos 44 px, sticky —y todos con `aria-current: null` (medido). En una página de ~10.600 px, «¿dónde estoy?» no tiene respuesta.
*Fix:* IntersectionObserver que marca el chip de la sección en vista (`scroll-margin-top: 80px` ya existe) + `aria-current="location"`.
*Comando:* `/impeccable adapt`.

**P2-1 — Jerarquía de pasos inconsistente entre secciones.**
Pasos de Resultados en h3 (16 px/700); pasos de Precios en h4 (14,4/600) y h5 (14,4/400). Medido: h2 17,6/700 ×13, h3 16/700 ×11, h4 14,4/600 ×4, h5 14,4/400 ×2 —inversión h3 > h4. Detector: 3 avisos `heading-rhythm` (0 px arriba / 16 px abajo).
*Fix:* un único token «paso de ritual» (un nivel, un tamaño, un peso) aplicado en Resultados, Precios y Mercado.
*Comando:* `/impeccable typeset`.

**P2-2 — Sin diff antes→después en el recálculo de precios.**
El recálculo devuelve contadores, pero no qué activo pasó de cuánto a cuánto. La transparencia de precios es la promesa central del producto y el registro de movimientos existe (ADR-0015).
*Fix:* tabla compacta tras el recálculo: activo | anterior → nuevo | motivo | versión.
*Comando:* `/impeccable clarify`.

**P3-1 — 4 estilos inline** (`gp-actions.tsx`, `jobs-section.tsx`): clase utilitaria en `globals.css`.
**P3-2 — Párrafos densos** (4 × `p.muted` de ~100+ caracteres) y **doble borde** `ul.status` dentro de `div.card`: aligerar (líneas divisorias sin caja interior, o caja interior solo para tablas reales).
**P3-3 — Placeholders «2026» a 4.0:1** (advisory; intencionalmente atenuados —decisión, no defecto).

## Red flags por persona

**Alex (power user):** tres cascadas en serie por operación (marcar 8 GPs definitivo = 24 selecciones encadenadas); sin acciones en lote; la primera pantalla llegó vacía; sin diff en el recálculo.
**Sam (accesibilidad):** sin `aria-current` en los 10 chips; la línea «Estados de evento» es un flujo de `<span>` cuya asociación evento→acción se sostiene por orden de lectura, no por estructura; inversión h3 > h4. Lo que sí funciona: 28/28 controles etiquetados, 0 touch <44 px, motivos escritos, diálogo con `role`/`aria-modal`/foco seguro.
**Pablo (organizador de liga):** el no-op cancelar→neutralizar (cancela en pánico, le da a «Neutralizar», los puntos siguen a 0 —concluye que el panel está roto); el diálogo «irreversible» sin cuantificar; la consola vacía.

## Observaciones menores

- `ConfirmDialog` sin borde/sombra: se separa del fondo solo por el backdrop; un borde de 1 px daría profundidad por nada.
- h4 y h5 del mismo tamaño (14,4 px), solo difieren en peso: unificar si ambos son «detalle».
- «Estados de evento» como `<span class="muted">` dentro de `<p>`: un `<dl>` o lista lo haría legible para máquina y humano.
- «W sin P0»: expansión inline («sin precio de apertura») para el admin nuevo.
- h1 acento 3,87:1: cumple AA de texto grande (28 px/700); no toca.
- *Retractado con evidencia:* el hallazgo de «bloques rojos de 822 px por defecto» era artefacto de medición (`getBoundingClientRect` en hijos de `<details>` cerrados no pintados; `checkVisibility(): false`).

## Preguntas provocadoras

1. Si el panel me ofrece «Neutralizar» tras «Cancelar» como transición válida, **¿qué otras transiciones ofrece la UI que el código no ejecutará?**
2. **¿Por qué la consola calcula el «siguiente paso» con la temporada de mayor año y no con la que tiene algo pendiente?**
3. La transparencia de precios es la promesa central y el registro de movimientos existe. **¿Por qué el panel muestra contadores y no deltas?**
