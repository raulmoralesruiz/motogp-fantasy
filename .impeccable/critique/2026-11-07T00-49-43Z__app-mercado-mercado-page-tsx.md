---
target: página /mercado
total_score: 37
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 0
target_identity: "file:/home/raul/dev/github/motogp/app/mercado/mercado-page.tsx"
target_fingerprint: "sha256:39f94801dd0af8ecb31f13cc716b0fecc080aa87bd5144e03f83ce7d9123529a"
target_path: /home/raul/dev/github/motogp/app/mercado/mercado-page.tsx
timestamp: 2026-11-07T00-49-43Z
slug: app-mercado-mercado-page-tsx
---
Method: dual-agent (A: design director · B: detector)

# Crítica de diseño — página `/mercado` · F3

**Superficie:** EXPLORE — exploración del mercado (pilotos/constructores/equipos) por temporada y GP, en español.
**Corrida pre-fix (misma jornada):** A = 29/40 (1 P1 + 3 P2 + consistencia de color) · B = `[]` (0 findings).
**Reconciliación:** los 4 issues de A (P1 min>max, P2 outline, P2 tendencia Δ, P2 estado vacío) + la consistencia de color se corrigieron en la misma jornada, después de la evaluación; re-evaluación aislada post-fix → **A = 37/40** · B re-ejecutado sobre el código final → **exit 0, findings `[]`**.

## Design Health Score (37/40 · Excelente, 92,5%)

| # | Heurística | Nota | Punto clave |
|---|-----------|-------|-------------|
| 1 | Visibilidad del estado del sistema | **4** | Todos los estados nombrados (cargando/error/vacío/detalle); procedencia P0 marcada en lista y detalle. |
| 2 | Ajuste al mundo real | **4** | Jerga definida en primera aparición: Tendencia, P0, Lineups, Motivo. |
| 3 | Control y libertad del usuario | **4** | Salida desde cada estado: "Borrar filtros" en el vacío, "Cerrar" en el detalle, resets al cambiar contexto. |
| 4 | Consistencia y estándares | **4** | **Corregido:** outline h1→h2→h3 (h2 del bloque "Mercado — GP" + "Detalle — X" + "Historial completo" h3); rojo solo como señal negativa (gráfico neutral a `var(--fg)`). |
| 5 | Prevención de errores | **4** | **Corregido (P1):** min>max detectado localmente con error nombrado; el rango inválido nunca se envía al servidor. |
| 6 | Reconocimiento antes que recuerdo | **4** | Etiquetas, placeholders y vocabulario explicado en el sitio; nada que memorizar. |
| 7 | Flexibilidad y eficiencia | **3** | **Corregido:** Δ a un vistazo en lista y detalle desde una sola fuente (servicio); sin atajos ni filtros guardados — aceptable en lectura. |
| 8 | Diseño minimalista estético | **3** | Disciplinado y neutral; el roce es la coma decimal (precios con punto en una UI en español). |
| 9 | Recuperación de errores | **4** | El rango imposible se nombra en vez de disfrazarse de vacío; errores por campo asociados al input (`aria-invalid`/`aria-describedby`, P3 corregido). |
| 10 | Ayuda y documentación | **3** | Contextual y bien ubicada; redacción de "Tendencia" corregida (punto anterior = ronda anterior o P0). |
| **Total** | | **37/40** | **Excelente (92,5%)** |

## Veredicto de especificidad de diseño

**Evaluación (A, post-fix).** Sigue siendo — y es más suya que antes — "exploración de mercado con identidad propia": la lógica de cabina (temporada → GP → tipo → filtros → lista → detalle), el vocabulario explicado en el sitio, la paleta neutral donde el rojo solo es señal, y el Δ en la insignia dan a la página carácter de consola operativa. Los fixes no diluyeron la identidad: la reforzaron, porque ya no se escapaba por el outline ni por el color. Lo que queda es pulido, no falta de identidad.

**Escan determinista (B).** `impeccable detect --json app/mercado` → exit 0, `[]`: 0 findings sobre el código final (re-ejecutado tras los fixes).

**Evidencia de navegador.** Sin tool de navegador en esta corrida (B = detector solo); los cambios de UI están cubiertos por 34 tests de UI (aria, h2 del bloque, Δ, rango imposible, Borrar filtros).

## Lo que funciona

1. **Δ como dato de decisión, con una sola fuente de verdad:** `currentPriceAndTrend` (price-service.ts) computa tendencia + magnitud sobre el histórico ordenado P0→ronda, y lo comparten `listMarket` y `getMarketDetail` — lista y detalle no pueden desdecirse; `null` (sin punto anterior) → "Estable" sin número, semántica explícita y testeada.
2. **La vía de error quedó diseñada, no accidental:** `rangeError` nombra el rango imposible, se muestra junto al campo (asociado por aria) y la consulta lo excluye; el estado vacío tiene salida real ("Borrar filtros"); ningún fallo queda disfrazado de "Ningún activo coincide".
3. **Identidad de sistema de punta a punta:** rojo solo señal (TrendBadge), series de datos neutras, outline correcto (h2 "Mercado — GP"), jerga explicada en primera aparición y cero componentes nuevos (reutiliza `RowAction`/`Alert`).

## Issues residuales (sin P1 ni P2; 1 P3 abierto)

**[P3] Localización del separador decimal** (display + inputs)
- **Qué:** precios con punto (p. ej. `17.4`) en una UI en español; escribir "17,4" cae en `Number()` → NaN → "introduce un número positivo" (no nombra el separador).
- **Por qué:** roce menor para quien escribe decimales con coma; el display es coherente con el resto de la app (enteros + máx 2 decimales).
- **Fix (si se hace):** parse tolerante al coma + mensaje que nombra el separador, o formato `es-ES` en el display — cambia fixtures, así que va como unidad propia, no parche.
- **Comando sugerido:** `/impeccable polish`

## Observaciones menores

- El `aria-label` de `Sparkline` ("Mini-histórico: P0 20, J1 22") y el texto de ayuda ("ronda anterior") son dos vocabularios para lo mismo; ahora el ayuda dice "punto anterior del histórico (ronda anterior o P0)" y el roce se reduce.
- El fallback `?? "GP"` del h2 solo es alcanzable sin data de GPs: defensivo, no de producto.

## Preguntas provocadoras

1. ¿El explorador sabe cuándo cierra el mercado del GP que está mirando? Un "próximo GP" o fecha de cierre en la cabecera del bloque podría pasar de información opcional a decisión.
2. ¿Filtros guardados por tipo de activo? "Pilotos entre 10 y 25" se reescribe en cada GP; si el patrón se repite 3 veces, la memoria la hace el usuario.
3. ¿La tendencia sin magnitud ("Sube"/"Baja") es suficiente para decidir, o el Δ es el único dato que importa y la etiqueta es ornamento?
