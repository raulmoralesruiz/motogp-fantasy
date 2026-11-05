---
target: /admin
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
p2_count: 2
target_identity: "file:/home/raul/dev/github/motogp/app/admin/page.tsx"
target_fingerprint: "sha256:57c16ecdfda7be378953a250714425ee00d0ca6294da9ee750cb7098dfd91e75"
target_path: /home/raul/dev/github/motogp/app/admin/page.tsx
timestamp: 2026-11-05T01-07-32Z
slug: app-admin-page-tsx
---
Method: dual-agent (A: general · B: general)

# Crítica de diseño — `/admin` · re-run tras la oleada P0+P1 (consola, fases, precios, revisión/diff)

## Design Health Score

| # | Heurística | Score | Problema clave |
|---|-----------|-------|----------------|
| 1 | Visibilidad del estado | 3 | Estados y conteos excelentes; pero éxitos/errores «stale» que sobreviven al cambio de contexto |
| 2 | Mundo real y lenguaje | 3 | Voz operativa impecable en estados/motivos, filtrada por jerga dev (US-xx, ADR, `shared/config`) |
| 3 | Control y libertad | 3 | Confirmaciones, dirty-guard y reversibilidad escrita; sin control previo en algunas escrituras masivas (ver P1 nº 1) |
| 4 | Consistencia y estándares | 2 | `Alert` vs `<p class="bad/ok">` crudos; confirmación repartida sin criterio; pasos h3 vs h4; «Crear GP manual» no colapsado; piel de input ausente fuera de `.form` |
| 5 | Prevención de errores | 3 | `disabledReason`, transiciones válidas, diff antes de importar; «Fijar» lockout (bloquea a todos) sin confirmación |
| 6 | Reconocimiento vs recuerdo | 3 | Ecos de contexto, diff «· modificada», URL persistente; pero 5 selectores «Temporada» independientes |
| 7 | Flexibilidad y eficiencia | 3 | Nav por fases, deep-links, prefill de mapeo; sin handoff consola → ritual con contexto |
| 8 | Estética y minimalismo | 2 | Párrafos-documentación, IDs de backlog, estilos inline, selects nativos rompiendo el muro |
| 9 | Recuperación de errores | 2 | Mensajes específicos pero no anunciados (sin `role`) y persistentes fuera de su contexto |
| 10 | Ayuda y documentación | 3 | Ayuda abundante in situ y motivos accionables; redactada para quien escribió los ADRs |
| **Total** | | **27/40** | **Acceptable** (banda 20–27) |

## Design Specificity Verdict

**LLM (A): especificidad alta, con bolsillos de CRUD genérico.** Vocabulario que no existe en un admin genérico: ritual 1→2→3 con `provisional → definitive`, `rv-1`, P0 con heurística de siembra, fórmula v1 con motivos, transiciones de estado filtradas, mapeo de pilotos de fuente, cancelar/neutralizar evento. La consola «Fin de semana de carrera» es un objeto de este juego. Los bolsillos CRUD están deliberadamente colapsados en «Altas y configuración» (decisión correcta) — excepción: «Crear GP manual» siempre expandido.

**Determinista (B):** detector 3 runs → **0 hallazgos, exit 0** (regex-only; contraste no aplicable por CLI; URL scan omitido por auth). Greps: 1 `window.confirm` real (`ligas/[id]`), 7 estilos inline, 5/5 tablas con wrapper, 2 enums crudos (copy de jugador), 8 `<Button disabled>` con condición no-pending sin `disabledReason` (formularios de alta e import) + 2 con label fijo en pending («Vincular GP», «Importar {evento}»).

**Nota de la pasada:** el hallazgo de IDs duplicados (P2 de accesibilidad) era un **bug real** — el reorden del panel hizo que `htmlFor="name"` de «Crear temporada» apuntara al input de otro formulario (E2E «crear temporada» roto en los 3 viewports). Corregido durante esta pasada: `Field` genera ids únicos (`useId`), ids duplicados de los imports renombrados y `getByLabel` ya no cruza formularios.

## Overall Impression

El panel ya opera como un cockpit: consola con siguiente paso, ritual con diff, confirmaciones que nombran su objeto. Lo que queda es madurez de riesgo y de piel: la inversión «confirmación para lo menor, nada para lo grave» («Fijar» lockout bloquea a todos sin preguntar), el CTA de la consola que no lleva a ningún lado con contexto, y los controles fuera de `.form` que se renderizan como selects nativos en mitad del muro de boxes.

## Qué funciona

1. **`ConfirmDialog` como sistema:** título con objeto y acción, impacto con cifras, «Sí, …»/«No, volver», foco seguro y devolución de foco — aplicado con disciplina en resultados, precios y GPs.
2. **El ritual como IA de producto:** consola con siguiente paso, pasos 1→2→3, ecos de contexto, diff sobre baseline importado y protección de trabajo al cambiar de contexto.
3. **Motivos de bloqueo escritos y accionables + semántica sin color:** `aria-disabled` anunciable, «— ▲ umbral de fallos», solo transiciones válidas.

## Problemas prioritarios

**[P1] El modelo de riesgo está invertido** — «Fijar» lockout (bloquea la edición de lineups de todos los jugadores) sin confirmación mientras «Borrar» sí la tiene; «Asignar desde/para este GP» (afiliaciones con efecto en puntuaciones) y «Fijar P0» sin confirmación. *Arreglo:* `ConfirmRequest` (objeto + impacto) para toda escritura con alcance > 1 fila o efecto sobre jugadores. → `/impeccable harden`

**[P1] El «siguiente paso» no lleva a ninguna parte** — el CTA de la consola es un ancla fija `#resultados` que contradice la instrucción cuando el paso es de precios, y nunca precarga `?season=&gp=&event=` pese a que el ritual ya lo soporta. *Arreglo:* la consola emite un botón primario por estado con el contexto concreto; el ritual ofrece «siguiente evento pendiente». → `/impeccable adapt`

**[P2] La piel del sistema se rompe fuera de `.form`** — selects/inputs sueltos (ritual, precios, afiliaciones, GPs) y todos los `datetime-local` se renderizan como control nativo. *Arreglo:* extraer el skin a un selector base y añadir `datetime-local`. → `/impeccable polish`

**[P2] Deuda de accesibilidad** — «Terminó»/«Posición» con `disabled` nativo sin motivo escrito; errores/éxitos de Precios y Afiliaciones sin `role` y sin caja tintada 10/40; chips del anchor-nav ~37 px. (Los IDs duplicados ya corregidos en esta pasada.) → `/impeccable audit`

**[P3] Copy de jerga interna y estados pegajosos** — IDs de backlog y rutas en la UI (IDs: decisión registrada), paso 1 de Precios como párrafo-documentación, éxitos que no expiran al cambiar de contexto. → `/impeccable clarify`

## Banderas rojas por persona

- **Alex:** el CTA de la consola no precarga contexto (3 selecciones manuales por evento); «Aplicar fórmula» exige elegir el GP fuente a mano; el selector «Activo» no muestra el P0 actual.
- **Sam:** «Terminó»/«Posición» sin motivo escrito; errores sin `role` (no se anuncian); chips de nav < 44 px. Lo bueno: `aria-disabled` con motivo, foco seguro en diálogos, `check-cell` 44 px, tablas semánticas.
- **Organizador en fin de semana:** la consola mira atrás (el sábado del GP en curso aún habla del anterior); el paso 2 se colapsa con fuente vinculada — justo donde revisar el diff da confianza; corrección masiva en móvil = scroll + edit + scroll.

## Observaciones menores

«Crear GP manual» no colapsado (patrón roto solo en `#gps`) · h3 en el ritual de Resultados vs h4 en el de Precios · sin `aria-current`/scroll-spy en el nav · estilos inline en `jobs-section` · el diálogo «Acción irreversible» de cancelar evento convive con la transición posterior «Neutralizar» · `add-rules-version-form` (publicar una versión de reglas) sin confirmación y su éxito no identifica la versión creada.

## Preguntas para reflexionar

1. ¿El panel es un cockpit de fin de semana o un CRUD con teatro de ritual? ¿Qué sobra si solo se usa los domingos?
2. Si «transparencia total» es el diferenciador, ¿por qué «Calcular P0 automático» (la mayor reescritura del panel) responde con una línea verde sin vista antes → después?
3. ¿A qué control le tendrías miedo de prestarle el panel a un segundo admin? A «Fijar» el lockout: bloquea a todos, no pide confirmación y no se deshace con un clic.
