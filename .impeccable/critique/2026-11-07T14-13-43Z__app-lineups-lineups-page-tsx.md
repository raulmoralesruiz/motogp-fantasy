---
target: página /lineups
total_score: 39
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 0
target_identity: "file:/home/raul/dev/github/motogp/app/lineups/lineups-page.tsx"
target_fingerprint: "sha256:fad7e29d62497fe9d33412ea79ed684460949a26af4950e5773b137b245aa92c"
target_path: /home/raul/dev/github/motogp/app/lineups/lineups-page.tsx
timestamp: 2026-11-07T14-13-43Z
slug: app-lineups-lineups-page-tsx
---
Method: dual-agent (A: design director · B: detector)

# Crítica de diseño — página `/lineups` · F3

**Superficie:** OPERATE — composición y gestión del lineup por GP (2 oro + 2 plata + constructor + equipo) dentro de presupuesto, con cambios, wildcard e historial, en español.
**Corridas A de la jornada (misma superficie):** pre-fix 28/40 → post-fix 1ª 36/40 → 33/40 (2 P1 + 2 P2 + 3 P3) → 35/40 (1 P1 + 1 P2 + 1 P3) → 32/40 (1 P1 + 4 P2 + 5 P3). Todos los P0/P1/P2 se corrigieron en código; **re-evaluación aislada final sobre el código corregido → A = 39/40 (0 P0/P1/P2, 8 P3)** · B re-ejecutado sobre el código final → **exit 0, findings `[]`**.
**Reconciliación:** el P1 de la última corrida (race de cambio de GP en vuelo: `onSuccess` usaba el `gpId` del último render, no el de envío) se corrigió capturando `variables.gpId` (React Query v5) en `save.onSuccess` y `wildcard.onSuccess`; los P2 (deadline de lockout, errores de lineup/historial silenciosos, aviso de cierre ≤30 min, fila "Cierre de cambios" en `ul.status`, `wildcardsPerSeason` interpolado, `.status-dirty` en ámbar) y el P3 (ayuda "J (jornada)") también. Re-evaluación aislada post-fix → **39/40, 0 P0/P1/P2**.

## Design Health Score (39/40 · Excelente, 97,5%)

| # | Heurística | Nota | Punto clave |
|---|-----------|-------|-------------|
| 1 | Jerarquía y foco | **3** | El dato central (presupuesto/coste/quedan) manda vía `.status` con `<strong>`; "Guardar" queda al final del formulario (P3). |
| 2 | Semántica de color | **4** | Rojo solo negativo (`.bad`, `alert-error`), ámbar solo aviso (`.status-dirty` corregido), verde solo éxito; sin fugas. |
| 3 | Estados y feedback | **4** | Pendiente/éxito/error/lockout/borrador sucio se ven y se entienden sin adivinar. |
| 4 | Mensajes accionables | **4** | Bloqueos nombran qué falta; wildcard distingue dos causas; solo los errores de carga carecen de "qué hacer" (P3). |
| 5 | Honestidad de la interfaz | **4** | Éxito solo al confirmar el servidor; coste en vivo etiquetado como borrador; wildcard no-op deshabilitado. |
| 6 | Densidad y legibilidad | **4** | Cabina de una columna, espaciado `.stack` coherente, sin vacíos muertos ni amontonamiento. |
| 7 | Consistencia con el sistema | **4** | Mismo bloque "Temporada y GP", patrón "X — {GP}", primitivas y patrones de /mercado y /admin. |
| 8 | Accesibilidad | **4** | Labels, `aria-disabled`+`aria-describedby` al motivo, roles, foco/Escape/Tab-trap en ConfirmDialog, AA, ≥44px. |
| 9 | Responsive | **4** | Selects y botones a ancho completo, filas que envuelven, sin desborde a 375px. |
| 10 | Bordes y casos | **4** | GP bloqueado, sin lineup, historial vacío, cambios/wildcard agotados, errores de carga, "Sin precio". |
| **Total** | | **39/40** | **Excelente (97,5%)** |

## Veredicto de especificidad de diseño

**Evaluación (A, post-fix).** "Cabina de gestión del lineup" con identidad propia: la lógica de consola (temporada → GP → slots → presupuesto → guardar), el bloqueo siempre explicado con motivo escrito, el wildcard que se niega a gastar un recurso escaso en silencio, y la protección del borrador (aviso + confirmación con impacto) dan a la página carácter de operación crítica bien diseñada. Los fixes no diluyeron la identidad: la reforzaron — el P1 de la race de GP en vuelo era justo el tipo de fallo que la honestidad de la interfaz exige cerrar. Lo que queda es pulido (8 P3), no falta de identidad.

**Escan determinista (B).** `impeccable detect --json app/lineups` → exit 0, `[]`: 0 findings sobre el código final (re-ejecutado tras los fixes).

**Evidencia de navegador.** Sin tool de navegador en esta corrida (B = detector solo); los cambios de UI están cubiertos por 49 tests de UI (race de GP en vuelo, deadline de lockout, errores de lineup/historial, wildcard no-op, borrador, confirmaciones).

## Lo que funciona

1. **Ningún control bloqueado sin motivo escrito:** `disabledReason` + `aria-describedby` en Guardar y Wildcard; el bloqueo siempre se explica ("faltan piloto oro 1, constructor", "usa tu wildcard", "excede el presupuesto por X").
2. **El wildcard se deshabilita cuando sería un no-op** y da dos motivos distintos según la causa (idéntico al guardado vs. aún sin guardar): no se gasta un recurso escaso en silencio.
3. **El coste en vivo ("Si guardas ahora") se muestra siempre**, también al editar un lineup guardado, y el sobrecoste se pinta en rojo ANTES de pulsar Guardar.
4. **El lockout se cubre de punta a punta:** cuenta atrás ≤30 min, alerta roja + botón bloqueado con motivo al pasar, tick de 30 s que mantiene el estado al día sin recargar.
5. **Protección del borrador:** aviso `beforeunload` + confirmación con impacto escrito al cambiar de GP/temporada, cubriendo tanto el borrador sucio como el borrador nuevo.
6. **El éxito nombra el GP guardado y los cambios restantes tomados del servidor**, y la invalidación de caché usa el GP de envío (no el del último render) — el P1 de la jornada.

## Issues residuales (sin P0/P1/P2; 8 P3 abiertos)

Los 8 son de pulido; ninguno rompe flujo, da señal falsa ni pierde trabajo. Se documentan para decisión explícita (precedente /mercado: P3 abierto registrado, no parcheado en cadena).

1. **[P3] "Guardar lineup" fuera de pliegue en 375px** — botón tras 6 selects, sin barra sticky — *fix:* barra de acciones sticky en móvil o resumen+guardar fijo.
2. **[P3] Errores de carga sin "qué hacer"** — "No se pudo cargar el mercado del GP." sin reintento — *fix:* "Recarga la página" o botón Reintentar.
3. **[P3] Confirmación del wildcard sin `irreversible`** — el impacto sale como párrafo plano, inconsistente con /admin — *fix:* `irreversible: true` en el ConfirmRequest del wildcard.
4. **[P3] Historial en `<ul>` plano** (viñetas por defecto) en vez de `.status` — inconsistente con la lista de estado de arriba — *fix:* `className="status"`.
5. **[P3] Fecha del historial sin hora** (`toLocaleDateString`) — dos cambios el mismo día no se distinguen — *fix:* `toLocaleString` con hora.
6. **[P3] Sin "Limpiar borrador" cuando no hay lineup guardado** — la única vía para vaciar un borrador nuevo es cambiar de GP (con confirmación) — *fix:* botón "Limpiar borrador" si `anySlotFilled(draft)` y sin guardado.
7. **[P3] Éxito con 0 cambios restantes no sugiere el wildcard** (el error server-side sí) — *fix:* "Si no te quedan cambios, usa tu wildcard." cuando `remainingChanges === 0`.
8. **[P3] El prefill puede pisar la entrada del usuario** si selecciona un piloto antes de que llegue `lineup.data` (carrera rara) — *fix:* acotar el prefill a borrador vacío o no sobrescribir slots ya rellenados.

## Observaciones menores

- El rojo juega doble papel: acento de marca (botón primario, links, foco) y señal negativa (`.bad`, `alert-error`). Son tokens distintos (`--accent` vs `--bad`) y coherentes con /mercado, pero en tensión con la regla "rojo = negativo"; decisión de sistema, no de página.
- Un GP `finished`/`cancelled` con `lockoutAt = null` se muestra abierto y guardable (cliente y servidor lo permiten); la UI refleja fielmente el gate del servidor, pero el usuario podría guardar en un GP ya disputado.
- El borrador es solo de cliente: cumple "no se pierde en silencio" (aviso + confirmación), pero no sobrevive a una recarga.

## Preguntas provocadoras

1. Si "rojo = señal negativa/crítica", ¿el botón primario "Guardar lineup" debería tener un color neutro/éxito para no leerse como acción crítica, o el rojo de marca es intencionadamente el acento único?
2. ¿Debe un GP `finished` verse cerrado visualmente aunque el servidor aún permita guardar, para evitar guardar en un GP ya disputado?
3. Dado el compromiso de "el trabajo del fan no se pierde en silencio", ¿el borrador debería persistirse por GP para sobrevivir a una recarga?
4. Con tres botones apilados de tamaño similar (Guardar/Descartar/Wildcard), ¿deberían subordinarse visualmente los secundarios para que "Guardar" sea el primario inequívoco?

## Barrido P2/P3 — cierre (2026-11-08)

Los 8 P3 de "Issues residuales" se corrigieron en esta pasada (barrido, opción (a) del usuario). Ninguno era P0/P1/P2; todos de pulido. Cierre:

1. **Sticky de acciones (375px)** — el bloque Guardar/Descartar/Limpiar ahora vive en `.form-actions` (nueva clase en `globals.css`), sticky al fondo en ≤768px con fondo propio: "Guardar lineup" no cae fuera de pliegue tras los 6 selects.
2. **Error de carga + Reintentar** — el error del builder ahora acompaña un botón `Reintentar` que llama a `builder.refetch()` (sin recargar la página).
3. **Wildcard `irreversible`** — el ConfirmRequest del wildcard pasa `irreversible: true`: el impacto sale como `Alert variant="warning"` (rol `alert`), mismo tratamiento que /admin (recurso escaso + reescritura).
4. **Historial `.status`** — la bitácora usa `ul.status` (lista de estado del sistema), no viñetas por defecto.
5. **Fecha con hora** — el historial usa `toLocaleString("es-ES", {dateStyle:"short", timeStyle:"short"})`: dos cambios el mismo día se distinguen por la hora.
6. **"Limpiar borrador"** — botón secundario cuando `lineup.data == null && !lineup.isPending && anySlotFilled(draft)`: vacía el borrador nuevo sin pasar por "Cambiar de GP" (que exige confirmación).
7. **Éxito 0 cambios → wildcard** — el éxito sugiere el wildcard cuando `remainingChanges === 0 && wildcardAvailable` (no promete un recurso ya gastado).
8. **Prefill no pisa** — el prefill se salta si `anySlotFilled(draft)`: la elección del usuario (carrera rara, prefill tardío) no se sobrescribe.

**Verificación:** typecheck ✓ · lint 0 errores ✓ · unit 903/903 ✓ · UI 701/701 (4 tests nuevos: Reintentar, wildcard `irreversible`, Limpiar borrador, prefill no pisa; 3 tests de fecha actualizados a hora) ✓ · build ✓ · detector `impeccable detect --json app/lineups/lineups-page.tsx app/globals.css` → solo findings preexistentes (L117 side-tab warning; L371/L766 font-size advisory — los antiguos L356/L751 desplazados +15 por el bloque `.form-actions`), 0 findings nuevos.
