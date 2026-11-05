---
target: /admin
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/home/raul/dev/github/motogp/app/admin/page.tsx"
target_fingerprint: "sha256:6fccb30acab83fcf5e9ed9cfe4c1b5ee197c9017eff8629d282788c1f3c660fb"
target_path: /home/raul/dev/github/motogp/app/admin/page.tsx
timestamp: 2026-11-04T20-58-29Z
slug: app-admin-page-tsx
---
Method: dual-agent (A: general · B: general)

# Crítica de diseño — `/admin` (Panel de administración) · re-run tras clarify/harden/layout/polish

## Design Health Score

| # | Heurística | Score | Problema clave |
|---|-----------|-------|----------------|
| 1 | Visibilidad del estado del sistema | 3 | Estados y conteos honestos («Consultando…», «creados/corregidos/unchanged/kept», refresco 30 s); pero sin panorama: qué GPs faltan por definitivo no se ve de un vistazo |
| 2 | Correspondencia con el mundo real | 2 | «Admin panel» en inglés, enums crudos `FINISHED/DNF/ABSENT`, códigos `dq`/`time-penalty`/`pole` como etiquetas, «bloqueado» vs «cerrado (lockout)», IDs US/ADR en pantalla |
| 3 | Control y libertad del usuario | 2 | Diálogo con foco seguro y Esc ✓; pero cambiar de evento borra las filas editadas sin aviso y F5 pierde la selección (sin estado en URL) |
| 4 | Consistencia y estándares | 2 | Primitivas en Resultados ✓, pero `<p class="bad">`/`<p class="ok">` sin `role` en Precios/Afiliaciones/GpActions, estilos inline (7), h4/h5 fuera de escala, `disabledReason` solo en los controles críticos |
| 5 | Prevención de errores | 2 | Pre-checks y confirmaciones con impacto ✓; pero «Eliminar» mapeo y «Desvincular» sin confirm, y edición destruida al cambiar de contexto |
| 6 | Reconocimiento antes que memoria | 2 | Selects con estado en las opciones ✓; códigos de penalización sin glosa, estados de evento sin estado actual visible, «Sin mapear» ↔ formulario de mapeo a mano |
| 7 | Flexibilidad y eficiencia | 2 | Automatización real (auto-import, P0 heurístico, fórmula); cero aceleradores en la entrada manual: sin bulk/pegado, sin deep-link, 5 selectores de temporada repetidos |
| 8 | Estética minimalista | 2 | Sistema plano y acento escaso, pero contenido maximalista: ~20 controles en «Precios», 6 acciones rojas en un párrafo, referencias de tickets |
| 9 | Recuperación de errores | 3 | Errores específicos y accionables, formularios preservados, mensajes `noop`; sin foco en la fila ofensora tras el fallo |
| 10 | Ayuda y documentación | 3 | Explicación por bloque e impactos escritos (excelente base), redactada en jerga de ingeniería y sin glosar códigos |
| **Total** | | **23/40** | **Aceptable** (banda 20–27) |

## Design Specificity Verdict

**LLM (Assessment A):** dominio anclado, composición genérica, copy que traiciona. La cascada temporada → GP → evento con opciones que narran estado («Q2 — sin resultados», «— evento cancelado») y el lenguaje de idempotencia («El GP ya era definitivo (sin cambios)») son de este producto; la confirmación de «Marcar definitivo» habla del dominio («primer recálculo rv-1… N lineups puntuados»). Pero la composición es intercambiable (8 tarjetas CRUD idénticas) y el copy cita su propio backlog («US-04, US-05…», «T-10, T-14, ADR-0036», «pricing-v1»): la UI narra su proceso de desarrollo en lugar de la faena del operador. La firma «Sube/Baja/Estable + ▲/▼» del sistema no aparece en el admin.

**Escaneo determinista (Assessment B):** `impeccable detect --json app/admin` → 0 hallazgos (exit 0, 38 ficheros) y `app/shared/components` → 0 (exit 0, 12). Caveat del propio detector: runs regex-only sobre .ts/.tsx — las reglas que requieren página parseada (texto diminuto, contraste) no corren; es un undercount, no un certificado de limpieza. Visualización en navegador omitida: sin dev server ni automatización disponible. Grep corroborante: `window.confirm` con 1 uso real restante (`app/ligas/[id]/league-detail-page.tsx:305`), 7 `style={{` inline (2 en `gp-actions`, 5 en `jobs-section`), 0 `<tr className="bad">`.

**Overlays visuales:** no disponibles (sin navegador); sin overlay que reclamar.

## Overall Impression

La infraestructura de confianza ya está: motivos de bloqueo escritos, confirmación con impacto que nombra la acción y el resultado, flujo crítico al frente y rojo escaso en los estados de evento. Lo que queda es la faena del domingo de carrera: trabajo que se pierde con un cambio de selector, riesgo sin red donde más duele («Eliminar», «Desvincular») y un copy que obliga a recordar códigos. Mayor oportunidad: convertir la tarjeta «Resultados» en un ritual numerado con un solo mecanismo de selección de evento y estado visible por evento.

## Qué funciona

1. **La cascada con opciones que narran estado** («Q2 — sin resultados», «— evento cancelado»): reconocimiento sobre memoria, anclado al ritual del producto.
2. **Confirmación con impacto bien construida:** foco en «No, volver», Esc y clic fuera, «Sí, …» que nombra la acción, impacto con cifras reales (filas, lineups, versión), aviso tintado si es irreversible.
3. **Feedback honesto e idempotente:** mensajes `noop`, desglose creados/corregidos/unchanged/kept, motivos de bloqueo accionables en el flujo crítico.

## Problemas prioritarios

**[P1] El flujo de «Resultados» sigue sin seguir el proceso** — tras elegir GP: tabla manual → «Definitivo» → «Importación automática». La acción de cierre queda entre las dos fuentes de entrada, la fuente habitual (auto-import) queda al final, hay dos mecanismos de selección de evento y el mapeo vive desconectado de su disparador («Sin mapear»). *Por qué:* es la tarea semanal del operador. *Arreglo:* pasos numerados — 1) fuente/auto-import («Sin mapear» → «Mapear» con precarga), 2) revisión manual (colapsable), 3) definitivo + estados de evento con estado actual visible; un solo selector de evento. *Comando:* `/impeccable layout`.

**[P1] Pérdida silenciosa de trabajo y contexto no persistente** — el `useEffect` de pre-carga borra filas editadas y el motivo al cambiar de evento; cambiar temporada/GP idem. Sin dirty flag ni aviso. Toda la selección vive en `useState`: F5 reinicia la cascada. *Por qué:* 22 filas capturadas a mano destruidas sin recurso. *Arreglo:* dirty flag + confirmación «Tienes resultados sin importar» al cambiar de contexto; `seasonId/gpId/eventId` en query params; devolver foco al disparador al cerrar diálogos. *Comando:* `/impeccable harden`.

**[P2] Política de riesgo inconsistente** — «Eliminar» (mapeo) es `Button` rojo relleno por fila sin confirmación (viola la Regla de la Señal: tantos rellenos como mapeos); «Desvincular» ídem; «Cancelar evento» (irreversible) es fantasma gemelo de «Neutralizar evento» y ambos siempre visibles; «Fijar precio manual» reescribe precio sin confirmar y sin `disabledReason`. *Arreglo:* niveles de riesgo explícitos (irreversible ⇒ confirm + fantasma/neutra; reescritura auditada ⇒ confirm con impacto; idempotente ⇒ directo); estados de evento con estado actual y solo la transición válida; `disabledReason` en todo control bloqueado. *Comando:* `/impeccable harden`.

**[P2] Copy de consola de desarrollo** — «Admin panel» (inglés), columna Estado con `FINISHED/DNF/ABSENT`, códigos `dq`/`time-penalty`/`fastest-lap`/`pole` como etiquetas, «bloqueado» vs «cerrado (lockout)» para lo mismo. (Los IDs de backlog se mantienen como referencia útil del operador — decisión registrada — pero el resto rompe «UI en español, voz preciso y operativa».) *Arreglo:* glosario único de enums y códigos en español («Descalificado», «Penalización de tiempo»…), título «Panel de *administración*», una sola etiqueta para `locked`. *Comando:* `/impeccable clarify`.

**[P2] Accesibilidad del flujo crítico (lote Sam)** — checkboxes de 16 px en la tabla de importación; `display: block` en `<table class="results-table">` destruyendo la semántica de tabla; texto pequeño en rojo de acción `#e10600` ≈ 3.8:1 (por debajo de AA); sin `scroll-margin-top` bajo la navegación ancla sticky; el foco no vuelve al disparador al cerrar `ConfirmDialog`. *Arreglo:* wrapper `div` con `overflow-x`; área de toque ≥44 px en checkboxes; texto pequeño en `#f85149` (o acento aclarado solo en texto); `scroll-margin-top`; return-focus en `onClose`. *Comando:* `/impeccable audit`.

## Banderas rojas por persona

**Alex (usuario experto):** sin estado en URL (F5 borra la cascada); «Sin mapear» es solo lectura mientras el formulario pide teclear `rider-42` a mano (sin click-to-fill); 5 selectores de temporada independientes; tabla manual sin pegado masivo ni filtros.

**Sam (accesibilidad):** checkboxes de 16 px en el flujo crítico; semántica de tabla rota por `display: block`; contraste ≈ 3.8:1 del rojo de acción en texto pequeño; `ConfirmDialog` no devuelve el foco al cerrar. Lo bueno: `aria-label` por fila, `role="status"/"alert"`, `aria-describedby` en motivos de bloqueo, foco de apertura en la opción segura.

**Organizador en fin de semana de carrera (PRODUCT.md):** si no es `global_admin`, el rechazo de `/admin` no le señala el detalle de su liga (mensaje sin salida); si lo es, no hay «sala de control»: debe abrir cada GP para saber cuáles están provisionales; la línea «Estados de evento» ofrece acciones pero no dice el estado actual.

## Observaciones menores

- `formatDateTime` duplicado 3 veces con comportamientos distintos ante fechas inválidas.
- Pluralizaciones «1 fila(s) provisional(es)» vs «1 afiliación creada» cuidada.
- `JobsSection`: contadores por cola sin veredicto («sano / revisar»).
- El motivo de `disabledReason` se renderiza como hermano inline: en filas apretadas se despega del control.
- «Estados de evento» son botones dentro de un `<p>`: lectores de pantalla lo leen como frase corrida.
- Sin scroll suave ni estado activo en los chips del anchor nav.

## Preguntas para reflexionar

1. «Cancelar evento» se declara «Acción irreversible» en su propio diálogo, pero el principio 4 del producto es «los resultados no se borran, se corrigen». ¿Existe vía de recuperación (des-cancelar) o el diálogo exagera? La UI no dice al operador qué red tiene.
2. ¿Para quién es `/admin`? Si el operador real es una persona en un proyecto indie, la primera pantalla debería ser una cola del fin de semana de carrera — no ocho tarjetas CRUD.
3. La firma «Sube/Baja/Estable + ▲/▼» no aparece en el «Historial de precios», el único sitio donde el operador lee movimiento de mercado. ¿Debe el admin hablar el idioma visual del jugador?
