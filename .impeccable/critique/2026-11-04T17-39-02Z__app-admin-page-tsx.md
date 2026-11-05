---
target: /admin
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
p2_count: 2
target_identity: "file:/home/raul/dev/github/motogp/app/admin/page.tsx"
target_fingerprint: "sha256:6fccb30acab83fcf5e9ed9cfe4c1b5ee197c9017eff8629d282788c1f3c660fb"
target_path: /home/raul/dev/github/motogp/app/admin/page.tsx
timestamp: 2026-11-04T17-39-02Z
slug: app-admin-page-tsx
---
⚠️ DEGRADED: single-context (no se pudieron lanzar sub-agentes aislados: el harness limita la profundidad de subagentes — Assessment A y B se han ejecutado en este contexto, secuencialmente y sin cruzar evidencias)

**Método:** Assessment A (revisión de diseño, fuente) → Assessment B (detector determinista) en secuencia, con aislamiento conservado: el detector no se ejecutó hasta cerrar la revisión de diseño. Sin navegador disponible en este entorno.

# Crítica de diseño — `/admin` (Panel de administración)

## Salud del diseño

| # | Heurística | Puntuación | Problema clave |
|---|-----------|-----------|----------------|
| 1 | Visibilidad del estado del sistema | 3 | «Consultando…», etiquetas de pending y éxitos con conteo; pero botones deshabilitados sin motivo y navegación ancla sin sección actual |
| 2 | Correspondencia con el mundo real | 2 | IDs internos (US-04, T-10, ADR-0036), backticks literales (`shared/config`), «pricing-v1», códigos sin glosa, título «Admin *panel*» |
| 3 | Control y libertad del usuario | 2 | Confirmaciones inconsistentes; `window.confirm` con botones «Cancelar/Aceptar» sobre la acción «Cancelar evento»; sin deshacer en la UI |
| 4 | Consistencia y estándares | 2 | Dos vocabularios para el estado de GP («bloqueado» vs «cerrado (lockout)»), h4/h5 fuera de escala, `window.confirm` fuera del sistema, estilos inline |
| 5 | Prevención de errores | 2 | Zod compartido y botones deshabilitados ✓; «Recalcular precios de la temporada» y «Calcular P0 automático» reescriben datos sin confirmación |
| 6 | Reconocimiento antes que memoria | 3 | Etiquetas y aria-label completos; faltan glosas de códigos y el contexto del GP elegido se pierde al scrollear («Requiere una temporada elegida arriba») |
| 7 | Flexibilidad y eficiencia | 2 | Importar desde la fuente es un buen atajo; sin relleno masivo en la tabla manual, sin atajos, sin persistencia de selección |
| 8 | Estética minimalista | 2 | Hasta 6 rellenos rojos en un párrafo («Estados de evento») rompe la Regla de la Señal; ruido de IDs de backlog |
| 9 | Recuperación de errores | 3 | Errores específicos del servidor, formulario preservado; sin advertencia previa ni recuperación en acciones irreversibles |
| 10 | Ayuda y documentación | 3 | Cada bloque explica qué hace y qué queda auditado; pero mezcla jerga de desarrollo (ADR/US/T-xx) |
| **Total** | | **24/40** | **Aceptable** (banda 20–27) |

## Veredicto de especificidad de diseño

**Revisión LLM:** el mundo visual es inconfundible (pantalla de telemetría, rojo escaso, listas de estado, pareja semántica), pero la estructura es CRUD de admin convencional y se pierden oportunidades de carácter: el mono no aparece donde DESIGN.md lo pide (IDs, `rules_version`, referencias de fuente), la palabra roja solo vive en el h1 y la tarjeta «Mercado» diluye la voz del sistema. Especificidad: media-alta en estética, media en comportamiento.

**Escaneo determinista:** limpio sobre `app/admin` (0 hallazgos, exit 0). Matiz de alcance: el CSS de la superficie vive en `app/globals.css`, fuera del target; ahí el detector sobre `app/` señala 3 avisos `design-system-font-size` (globals.css:238/317/406 — 0.95rem `.card .cta` y `.tab`, 0.8rem `.results-table th`). Dos son falsos positivos documentados en el cuerpo de DESIGN.md; `.tab` 0.95rem es deriva real.

**Overlays visuales:** no disponibles (sin navegador ni servidor dev); sin overlay que reclamar.

## Impresión general

Un panel de operación honesto y bien educado: explica, confirma con números y nunca deja un estado sin frase. Lo que falla está en los momentos de mayor estrés: la acción irreversible tiene un diálogo nativo con etiquetas trampa, las acciones que reescriben datos no piden confirmación y el flujo crítico está enterrado bajo dos bloques ajenos. Mayor oportunidad: convertir la tarjeta «Resultados» en un ritual guiado por GP con un único patrón de confirmación con impacto escrito.

## Qué funciona

1. **Transparencia como voz:** éxitos con conteo real y estados neutrales con la semántica gris correcta.
2. **Divulgación progresiva** con selects en cascada y pre-validación Zod compartida con el servidor.
3. **El cierre monitorizado:** «Jobs y fuentes» (colas, probe, Sentry, alertas) cierra con control operativo.

## Problemas prioritarios

**[P1] Controles bloqueados sin motivo escrito** — ~20 botones deshabilitados sin explicación («Importar resultados» con 0 filas, «Fijar P0», «Añadir mapeo», «Cambiar», «Aplicar fórmula…»). Rompe el compromiso de marca «nunca un control bloqueado sin explicación». Arreglo: motivo accionable junto al control (extender `Button` con `disabledReason`), primero en el flujo de resultados. Comando: `/impeccable clarify` (+ `/impeccable harden`).

**[P1] Confirmación de acciones irreversibles inconsistente y con trampa de etiquetas** — «Cancelar evento» («Acción irreversible») se confirma con `window.confirm` cuyo botón de descarte se llama «Cancelar»; «Recalcular precios de la temporada» y «Calcular P0 automático» reescriben datos sin confirmación. Arreglo: patrón único de confirmación en el sistema (Alert de aviso + impacto + «Sí, cancelar el evento»/«No, volver»); jamás «Cancelar» como etiqueta de acción destructiva. Comando: `/impeccable harden`.

**[P1] El ritual de resultados está en el orden equivocado y rompe la Regla de la Señal** — el selector de evento aparece después de los bloques «Definitivo» e «Importación automática»; «Estados de evento» apila 2 botones rojos por evento (hasta 6 en un párrafo). Arreglo: reordenar temporada → GP → evento → tabla; estados de evento como acciones fantasma de fila o segmented control con un solo rojo protagonista. Comando: `/impeccable layout`.

**[P2] Deriva del sistema: jerarquía tipográfica y vocabulario dual** — h4/h5 fuera de la escala; «bloqueado» vs «cerrado (lockout)» para el mismo estado; h1 «Admin *panel*» con la palabra roja sobre un anglicismo. Arreglo: cerrar la escala, un solo glosario («bloqueado (lockout)»), título «Panel de *administración*». Comando: `/impeccable typeset` (+ `/impeccable clarify`).

**[P2] Foco ausente y objetivos táctiles por debajo de la Regla de los 44** — solo `.form input:focus` tiene contorno rojo; botones/pestañas/row-actions/chips sin foco visible; checkboxes ~16 px, numéricos ~31 px, chips ~36 px. T-16 no cubre estos controles. Arreglo: `:focus-visible` global (2 px rojo, offset 1 px) y alturas/hitos mínimos. Comando: `/impeccable adapt`.

## Banderas rojas por persona

**Alex (usuario experto):** sin relleno masivo ni pegado tabular en la importación manual (20 pilotos × 6 campos); `window.confirm` interrumpe la ruta rápida; 6 botones rojos sin agrupación por evento en «Estados de evento».

**Sam (accesibilidad):** sin `:focus-visible` en la superficie más densa del producto; checkboxes de 16 px y numéricos de ~31 px; fila de fallos señalada solo por color (`.bad`). Lo bueno: `aria-label` por fila, `role="status"/"alert"`, contraste correcto.

**Organizador en fin de semana de carrera (PRODUCT.md):** el ritual crítico vive en una tarjeta de ~1.000 líneas con dos bloques ajenos delante y el contexto del GP no se repite junto a la tabla; el momento irreversible usa el diálogo más ambiguo posible; «Recalcular precios de la temporada» no pide confirmación.

## Observaciones menores

- Saltos de la navegación ancla sin `scroll-margin-top` (el título queda bajo la barra sticky); sin scrollspy.
- IDs de backlog (US-04, T-10, ADR-0036), backticks literales (`shared/config`) y «pricing-v1» en la copia de usuario.
- Estilos inline en `jobs-section.tsx`/`gp-actions.tsx` frente al sistema de clases.
- `<tr className="bad">` señala por color: falta texto de estado.
- El detector solo ve limpio el target porque el CSS de la superficie está fuera de `app/admin` (2 de 3 avisos falsos positivos; `.tab` 0.95rem es deriva real).

## Preguntas para reflexionar

- ¿Y si el ritual del fin de semana tuviera su propia vista guiada por GP en vez de vivir dentro de una página de 8 secciones?
- ¿Qué versión «muro de boxes» obtendríamos si IDs y versiones se monospaciaran como datos de cronometraje?
- ¿Puede una tabla de importación manual de 20 pilotos operarse con una mano en un móvil? ¿Debe?
- ¿Cuánto valor tendría un único componente de «confirmación con impacto» reutilizado por precios, resultados y reglas?

## Notas de ejecución

- Degradado a un solo contexto (banner al inicio): el harness no permite lanzar sub-agentes desde un sub-agente. Assessment A se completó antes de ejecutar el detector.
- Sin navegador ni servidor dev disponible: vervisual sobre fuente y tokens; sin overlay.
- Evaluación desde el código y los compromisos de DESIGN.md/PRODUCT.md, sin entrevista al usuario (ejecución autónoma de un sub-agente).
