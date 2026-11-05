---
target: /admin
total_score: 31
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
p2_count: 2
target_identity: "file:/home/raul/dev/github/motogp/app/admin/page.tsx"
target_fingerprint: "sha256:3b277f31d3150f115cd2cc537894eaff93aecfc08652ac54a64ece5acd17a255"
target_path: /home/raul/dev/github/motogp/app/admin/page.tsx
timestamp: 2026-11-04T22-26-05Z
slug: app-admin-page-tsx
---
Method: dual-agent (A: general · B: general)

# Crítica de diseño — `/admin` · re-run tras la oleada P1+P2

## Design Health Score

| # | Heurística | Score | Problema clave |
|---|-----------|-------|----------------|
| 1 | Visibilidad del estado del sistema | 3 | Loading/éxito/error correctos; «Importar {evento}» se deshabilita sin label de pending y los refetches son silenciosos |
| 2 | Correspondencia con el mundo real | 3 | Voz de muro de boxes y glosario excelentes; pero US-xx/ADR-xxxx/rutas de código (`shared/config`, `NEXT_PUBLIC_SENTRY_DSN`) son vocabulario del repo |
| 3 | Control y libertad del usuario | **4** | ConfirmDialog con foco seguro, Esc/clic-fuera, retorno de foco, dirty-guard con salida accionable, reversibilidad siempre escrita |
| 4 | Consistencia y estándares | 3 | Patrones uniformes; pero el gate de riesgo es asimétrico (1 precio manual confirma; la fórmula que reescribe el mercado, no) y la escala h3/h4/h5 se desvía de DESIGN.md |
| 5 | Prevención de errores | 3 | Pre-validación, transiciones limitadas, disabled+motivo, idempotencia; aun así «Borrar» lockout y «Aplicar fórmula» ejecutan impacto masivo sin red |
| 6 | Reconocer antes que recordar | 3 | Estados en las opciones del select, «Mapear» con prefill; pero el evento activo no se ecoa en los pasos y «Puntos crudos»/«rv-N» exigen memoria del motor |
| 7 | Flexibilidad y eficiencia | 3 | URL persistida, teclado, cascadas; sin operaciones en bloque ni copiar del evento anterior (3 eventos × 22 filas) |
| 8 | Estética y minimalista | 3 | Sistema plano y escaso en el producto; en admin el rojo se democratiza (~15 rellenos) y `jobs-section` usa estilos inline |
| 9 | Recuperación de errores | 3 | Errores específicos y `noop` honestos; los errores caen al pie de un formulario de 22 filas, lejos de la fila culpable |
| 10 | Ayuda y documentación | 3 | Cada panel se explica y `disabledReason` es primitiva con `aria-describedby`; pero con vocabulario de desarrollo y sin enlazar al runbook |
| **Total** | | **31/40** | **Good** (banda 28–35) |

## Design Specificity Verdict

**LLM (A):** anclado ~75%. El ritual numerado 1→2→3 con selector único, la nomenclatura de muro de boxes («Q2 — sin resultados», «Pole», «No terminó (DNF)», «bloqueado (lockout)»), el copy de reversibilidad en las confirmaciones («Los resultados ya importados no se tocan») y las acciones nombradas («Sí, marcar definitivo»/«No, volver») no son un CRUD genérico. Fugas hacia dentro: IDs de backlog y rutas de código en copy de usuario (decisión registrada para los IDs; las rutas y «pricing-v1»/«Puntos crudos» quedan fuera del glosario único).

**Determinista (B):** `detect --json` sobre `app/admin`, `app/shared/components`, `app/mercado`, `app/lineups` → **0 hallazgos, exit 0** en los cuatro. Caveat: runs regex-only sobre .ts/.tsx — las reglas de página parseada (texto diminuto, contraste) no corren: infraconteo, no certificado. URL scan de `/admin` omitido: exige autenticación y el detector CLI no hace login. Greps: 1 `window.confirm` real restante (`ligas/[id]`), 7 estilos inline (5 `jobs-section`, 2 `gp-actions`), **5/5 tablas con wrapper `.table-scroll`** (semántica preservada), enums crudos solo en `score-breakdown.tsx` (mapa de etiquetas) y `resultados-page.tsx` (copy de jugador, fuera del alcance admin).

**Overlays:** no disponibles (sin automatización de navegador para el detector en página).

## Overall Impression

Una superficie operativa honesta por encima de la media: el modelo de confirmación con impacto es literalmente excelente y el ritual con selector único + protección de trabajo ya refleja la faena real. Lo que queda es madurez de sistema: el gate de riesgo aún es asimétrico donde más personas afecta, la jerarquía tipográfica del ritual se rompe (el paso 2 se ve más grande que los pasos 1 y 3 y desaparece del outline de encabezados) y el rojo se acumula hasta dejar de significar.

## Qué funciona

1. **Confirmación con impacto como estándar del producto** (8 acciones de riesgo): impacto con conteos reales, acción nombrada, foco en «No, volver», retorno de foco al disparador.
2. **Ritual con selector único + protección de trabajo**: dirty flag con salida accionable («cancela y pulsa «Importar resultados»»), selección en URL, atajos «Mapear» que precargan y enfocan el campo.
3. **Glosario único y motivos de bloqueo como primitiva**: `RESULT_STATUS_LABELS`/`RESULT_CODE_LABELS`/`GP_STATUS_LABELS` como única fuente; `disabledReason` con `aria-describedby` en `Button`/`RowAction`.

## Problemas prioritarios

**[P1] Gate de riesgo asimétrico y «Borrar» con peso de acción primaria** — «Borrar» lockout (reabre la edición de lineups de todos los jugadores), «Cambiar estado» y «Aplicar fórmula al siguiente GP» (reescribe la serie de precios de todo el mercado) ejecutan sin `ConfirmDialog`, mientras «Fijar precio manual» (un activo) lo tiene. «Fijar» y «Borrar» son dos `<Button>` rojos idénticos consecutivos. *Arreglo:* confirmación con impacto escrito para los tres; «Borrar» pasa a `RowAction`/secondary (nunca relleno rojo); impacto de la fórmula nombrando el GP objetivo. → `/impeccable harden`

**[P1] La jerarquía del ritual se rompe en tipografía y en el outline** — `.ritual-step > summary` (1.1rem/700) supera a los h3 de los pasos 1 y 3 (1rem/700); h3 ≡ h4; h5 cae a ~13.3 px (por debajo del body); `<summary>` no es heading: la navegación por encabezados salta el paso 2 completo. *Arreglo:* los tres pasos al mismo nivel de encabezado real; h4 → Title, h5 → Label. → `/impeccable typeset`

**[P2] La Regla de la Señal colapsa** — ~15 rellenos rojos simultáneos en la página (5 en precios, 3–4 en Resultados, 1–2 por tarjeta); «Borrar» comparte color con la acción constructiva. *Arreglo:* un solo primario por región (en Resultados «Importar resultados»/«Marcar definitivo»; en precios el bulk), el resto fantasma/secondary. → `/impeccable quieter`

**[P2] Working memory: el contexto del evento no se ecoa donde se actúa** — los títulos de los pasos 2/3 y el éxito «Importación completada: …» no nombra el evento activo; en el paso 3 se listan eventos no seleccionados con acciones inline. Riesgo real de importar el evento equivocado. *Arreglo:* eco del evento en cada título de paso y alerta de éxito; acciones del paso 3 solo del evento seleccionado. → `/impeccable clarify`

**[P3] Vocabulario del repo en la copy del operador** — rutas de código (`shared/config`, `NEXT_PUBLIC_SENTRY_DSN`), «pricing-v1», «Puntos crudos», «rv-N» fuera del glosario (los IDs de backlog se mantienen por decisión registrada). *Arreglo:* al runbook/tooltip; añadir los conceptos restantes al glosario. → `/impeccable distill`

## Banderas rojas por persona

- **Alex:** 22 filas × 8 columnas sin «copiar del evento anterior» ni marcar en bloque (~500 interacciones por GP); «Aplicar fórmula» sin confirmación mientras «Fijar precio manual» la tiene; precios no persiste en URL (solo el ritual).
- **Sam:** `<summary>` no es heading (paso 2 invisible en el outline); `disabled` + `aria-describedby` hace que el motivo de bloqueo no se anuncie al navegar por foco; tabla «Estado del auto-import» sin elementos enfocables no desplazable por teclado; `<th></th>` sin nombre accesible.
- **Organizador en fin de semana:** el evento activo no se repite en los pasos (riesgo de importar el equivocado); «Borrar» lockout es un rojo gemelo de «Fijar» sin confirmación; nav sticky de 8 chips a 3–4 filas en 375 px tapa el destino pese al `scroll-margin-top`.

## Observaciones menores

Estilos inline en `jobs-section` (5) · `formatDateTime` duplicado 3 veces (tercera aparición: toca extraer) · `disabledReason` genérico en afiliaciones vs específico en precios · el confirm de «Marcar definitivo» dice «primer recálculo» aunque ya exista versión previa · doble listado «Sin mapear» tras importar · tras «Marcar definitivo» el refetch resetea `dirty` y puede perder ediciones recientes del paso 2.

## Preguntas para reflexionar

1. Si la métrica es «95% de GPs definitivos sin recálculo manual» y el ritual es el corazón, ¿por qué vive en la séptima tarjeta de ocho?
2. El criterio de «impacto» para confirmar: ¿filas afectadas o personas afectadas? Debería estar escrito en DESIGN.md.
3. ¿Debería `disabledReason` usar `aria-disabled` para mantener el motivo anunciable en navegación por foco?
