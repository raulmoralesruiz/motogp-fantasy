---
target: /admin
total_score: 29
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
p2_count: 1
target_identity: "file:/home/raul/dev/github/motogp/app/admin/page.tsx"
target_fingerprint: "sha256:3b277f31d3150f115cd2cc537894eaff93aecfc08652ac54a64ece5acd17a255"
target_path: /home/raul/dev/github/motogp/app/admin/page.tsx
timestamp: 2026-11-05T00-15-44Z
slug: app-admin-page-tsx
---
Method: dual-agent (A: general · B: general)

# Crítica de diseño — `/admin` · re-run tras la oleada harden/typeset/quieter/clarify

## Design Health Score

| # | Heurística | Score | Problema clave |
|---|-----------|-------|----------------|
| 1 | Visibilidad del estado | 3 | Pending y refresco muy bien; éxitos persistentes sin timestamp y sin overview de lo pendiente |
| 2 | Mundo real | 3 | Glosario de dominio excelente; jerga interna restante (US-xx, ADR, `shared/config`, «fórmula v1»/«pricing-v1») |
| 3 | Control y libertad | 3 | Dirty+confirm, foco seguro, corrección versionada; falta `beforeunload` y el clic-fuera descarta confirmaciones de alto impacto |
| 4 | Consistencia | 3 | Primitivas coherentes; dos familias de feedback (`Alert` vs `p.ok`), estilos inline en `jobs-section`/`gp-actions` |
| 5 | Prevención de errores | 3 | Confirmación con impacto casi omnipresente; huecos: «Fijar» lockout sin confirmación y varios diálogos sin nombrar su objeto (P0) |
| 6 | Reconocer vs recordar | 3 | Ritual + eco de evento + etiquetas con estado: sobresaliente local; los 3 selectores de temporada de Precios exigen recuerdo |
| 7 | Flexibilidad y eficiencia | 2 | Sin CSV/bulk en la entrada manual, sin búsqueda en listas, sin atajos; selección de Precios/Afiliaciones no persiste |
| 8 | Minimalismo | 3 | Plana y rojo escaso por panel; 8 tarjetas + ~20 formularios y párrafos-whitepaper con números de ADR |
| 9 | Recuperación de errores | 3 | Errores accionables y no-op explícitos; issues de Zod concatenados sin mapeo a campo |
| 10 | Ayuda y documentación | 3 | Ayuda contextual abundante pero redactada para quien escribió los ADR; el runbook no se enlaza |
| **Total** | | **29/40** | **Good** (banda 28–35) |

## Design Specificity Verdict

**LLM (A):** anclado en componente y copy; genérico en arquitectura de información. El ritual 1→2→3 con selector único y eco de contexto, la confirmación cuantificada («N filas», «N activos», GP objetivo nombrado en fórmula), el glosario único y `disabledReason` como primitiva son producto de verdad. Lo genérico: 8 tarjetas CRUD ordenadas por modelo de datos — el camino crítico del domingo (Resultados → Precios) vive en las posiciones 6–7, después de «Crear circuito».

**Determinista (B):** `detect --json` sobre `app/admin`, `app/shared/components`, `app/mercado`, `app/lineups` → **0 hallazgos, exit 0** en los cuatro (regex-only: contraste y reglas de página parseada no aplicables por CLI). URL scan omitido: `/admin` exige autenticación y el detector no hace login. Greps: 1 `window.confirm` real restante (`ligas/[id]`), 7 estilos inline (5 `jobs-section`, 2 `gp-actions`), **5/5 tablas con wrapper `.table-scroll`**, enums crudos solo en `resultados-page.tsx`/`score-breakdown.tsx` (copy de jugador / mapa de etiquetas), y 17 `<Button disabled>` sin `disabledReason` (de 27) — casi todos en estados pending con label transitorio («Creando…», «Importando…»); 2 con label fijo («Vincular GP», «Importar {evento}»).

**Overlays:** no disponibles.

## Overall Impression

El riesgo está diseñado de verdad: confirmación con impacto cuantificada, motivos de bloqueo focuseables y el ritual con eco de contexto. Lo que queda ya no es de fundamento sino de oficio: los diálogos de mayor alcance no nombran su objeto, la página sigue siendo entidad-primero en vez de fin-de-semana-primero, y las acciones destructivas tienen los objetivos táctiles más pequeños de la superficie.

## Qué funciona

1. **El ritual con selector único y eco de contexto** (1→2→3, evento en títulos y éxitos, colapso inteligente del paso manual, `dirty` + confirmación de descarte).
2. **El sistema de riesgo** (`disabledReason` + `aria-disabled` focuseable + Confirmación con impacto cuantificada + no-op explícitos).
3. **Disciplina del sistema visual:** plana, rojo escaso por panel, glosario único, escala tipográfica cerrada, Scroll Contenido.

## Problemas prioritarios

**[P0] Las confirmaciones de mayor alcance no nombran su objeto** — «Marcar el GP como definitivo» no dice qué GP ni evento; «Calcular P0 automático» no nombra la temporada; «Recalcular precios de la temporada» no la nombra; «Fijar precio manual» no nombra activo ni GP. Mientras, «Eliminar el mapeo de {piloto}» y «Cambiar el estado del GP» sí lo hacen: inconsistencia en los picos de riesgo. *Arreglo:* plantilla fija en título e impacto («R{round} · {gpName} — {evento}», «{seasonName}», «{assetName}»): el dato ya está en el estado. → `/impeccable harden`

**[P1] IA entidad-primero: el fin de semana de carrera está enterrado** — 8 tarjetas CRUD por modelo de datos; Resultados #7, Precios dentro de Mercado, monitorización al final; sin bloque «qué necesita atención hoy». *Arreglo:* bloque superior de estado + nav por fases (Carrera → Mercado → Temporada → Sistema) + formularios de creación colapsados. → `/impeccable layout`

**[P1] `PricesPanel`: 5 operaciones y 3 contextos de temporada en flujo plano** — 6 botones de escritura visibles; «Temporada» etiqueta dos selectores que alimentan cosas distintas. *Arreglo:* bloques con contexto ecoado o pestañas, un selector compartido, orden de operaciones como pasos numerados. → `/impeccable distill`

**[P1] Objetivos táctiles de ~24 px en las acciones destructivas** — `.row-action` («Desvincular», «Eliminar», «Cancelar evento», «Borrar» lockout) por debajo de la Regla de los 44; el fallo de umbral del auto-import se señala solo por color. *Arreglo:* `min-height` en `.row-action` y marca textual del umbral. → `/impeccable polish`

**[P2] Voz rota por jerga interna + feedback inconsistente y persistente** — IDs de backlog y rutas de código en copy (IDs: decisión registrada; rutas y «pricing-v1»: pendientes), `Alert` vs `p.ok`, éxitos que no expiran, sin `beforeunload` con `dirty`. → `/impeccable clarify`

## Banderas rojas por persona

- **Alex:** entrada manual sin CSV/bulk ni «copiar del evento anterior»; selección de Precios/Afiliaciones no persiste; éxitos pegados que ya no describen el estado.
- **Sam:** `.row-action` ~24 px en los controles destructivos; submits con `aria-disabled` que aún envían el formulario (falta `preventDefault`); «Estados de evento» como párrafo corrido de nodos y acciones; umbral solo por color.
- **Organizador en fin de semana:** este panel es `global_admin` (su panel real es `/ligas/[id]`); si es el operador global, su camino está en las posiciones 6–7 y «Marcar definitivo» no dice qué GP se está cerrando.

## Observaciones menores

El paso «2.» se renderiza siempre mientras los pasos 1/3 requieren GP (al cargar se ve un «2.» huérfano) · «Fijar» lockout sin confirmación frente a «Borrar» que sí la tiene · `prefillMapping` enfoca por `getElementById` · el trap de foco del diálogo alterna primer/último botón (se rompería con un tercero) · el intro de `page.tsx` lista un subconjunto obsoleto de historias.

## Preguntas para reflexionar

1. ¿Cuándo una consola de operación deja de ser un CRUD? ¿Qué justifica 8 tarjetas de entidades frente a una consola «domingo de carrera»?
2. ¿La entrada manual es un camino real o un fallback que merece UI de fallback (abrirse sobre lo importado como diff)?
3. ¿«Marcar definitivo» merece un momento propio (resumen de impacto, GP nombrado, vuelta atrás explicada) como cierre del ritual?
