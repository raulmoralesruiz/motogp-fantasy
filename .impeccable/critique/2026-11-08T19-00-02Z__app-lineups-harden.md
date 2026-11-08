---
target: harden del builder /lineups — estados terminales del GP + errores accionables
total_score: 38
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1 (cerrado antes de cerrar la unidad)
target_identity: "file:/home/raul/dev/github/motogp/app/lineups/lineups-page.tsx"
target_fingerprint: "sha256:0518735bb1ae298f993a1ffe77618293205702f5f4f5f7b0536864bb259de998"
target_path: /home/raul/dev/github/motogp/app/lineups/lineups-page.tsx
timestamp: 2026-11-08T19-00-02Z
slug: app-lineups-harden
---
Method: dual-agent (A: design director · B: detector)

# Crítica de diseño — harden /lineups (estados terminales + errores accionables)

**Superficie:** OPERATE — el builder de lineups. El endurecimiento cierra dos huecos de robustez: (H1) los estados terminales del GP (`finished`/`cancelled`) no se trataban — un GP cancelado o finalizado seguía "guardable" en la UI, y `user-flows.md` §4 exige un aviso "GP cancelado, 0 puntos"; (H2) la inconsistencia de reintentar — `builder.isError` tenía botón "Reintentar" pero `lineup.isError`/`history.isError` eran warnings muertos.

**Tesis (antes de la crítica):**
- Semántica estricta de color por estado: `cancelled` → warning (ámbar, "evento excepcional"), `finished` → info (azul, hecho neutro), `locked` → error (rojo, estado cerrado). Tres estados, tres consecuencias distintas, tres tratamientos.
- Nunca un control bloqueado sin motivo escrito (compromiso de marca): el motivo nombra el estado real, no todo "bloqueado".
- Error accionable: cada fallo de carga nombra el siguiente paso (reintentar sin recargar).

**Corrida A:** veredicto **APROBADO CON REVISIÓN** — 0 P0 / 1 P1 / 2 P2 / 4 P3. La semántica de color/variante se respeta de punta a punta (ámbar para cancelado está documentado en DESIGN.md y en el precedente de `/resultados`; rojo para lockout documentado; azul para finalizado defensible). Los defectos están todos en la *interacción* entre las alertas nuevas y la fila de estado y el orden de alertas. El P1 y los P2 se resolvieron antes de cerrar:

- **P1-1 — la fila "Si guardas ahora" es una falsa affordance en un GP cerrado** — con el GP cancelado/finalizado/bloqueado, la lista de estado seguía leyendo "Si guardas ahora: coste X · saldo Y" mientras la alerta decía que guardar es imposible y los botones estaban deshabilitados. Peor: los 6 `<select>` seguían editables, así que el usuario podía recomponer en un GP cancelado y topar con el botón deshabilitado — una trampa. → **CERRADO:** en `gpClosed` la fila se reencuadra a "Coste del borrador:" (dato de referencia, no acción imperativa) y se suprime la señal "· cambios sin guardar" (sin sentido si guardar es imposible).
- **P2-1 — peor caso: tres cajas del mismo tono, la alerta de estado enterrada** — si `lineup.isError` y `history.isError` son verdaderos y el GP está cerrado, apilaban tres cajas tintadas; con estado `cancelled` (ámbar), tres cajas ámbar de tres significados distintos, y la alerta de estado (el dato más relevante) renderizaba al final, bajo los dos avisos ámbar. → **CERRADO:** la alerta de estado se extrajo del `<div>` de contenido y ahora renderiza ANTES de los fallos de carga (es el dato más relevante para decidir).
- **P2-2 — `.status-dirty` ámbar coexiste con la alerta ámbar "GP cancelado"** — dos señales ámbar de significados distintos (estado excepcional vs. "cambios sin guardar"). → **CERRADO:** la clase `.status-dirty` se suprime cuando `gpClosed` (la señal de "cambios sin guardar" pierde sentido).
- **P3-1 — "no puntuará" sujeto ambiguo** — "GP cancelado: no puntuará (0 puntos)" elide el sujeto (el GP no puntúa; el lineup sí). → **CERRADO:** "tu lineup no puntuará (0 puntos)" (sujeto explícito, voz centrada en el fan).
- **P3-2 — voz inconsistente entre las tres alertas** — `locked` usa plural genérico ("no se pueden guardar lineups"), `cancelled`/`finished` usan singular del usuario. → **DIFERIDO:** el mensaje de `locked` es preexistente (F3, probado en 4 tests) y no es parte de esta unidad; las tres alertas son claras y distinguibles. Alinearlo tocaría tests fuera de alcance.
- **P3-3 — "el lineup" presupone un lineup que puede no existir** — "GP finalizado: el lineup ya no se puede modificar". → **CERRADO:** "ya no se puede guardar ni modificar" (sin presuponer un lineup guardado).
- **P3-4 — fila "Cierre de cambios: <fecha>" en un GP cancelado** — un GP cancelado no tiene ventana de cambios que cerrar. → **CERRADO:** la fila se oculta solo cuando `gpClosedReason === "cancelled"`.

**B detector:** `impeccable detect --json app/lineups/lineups-page.tsx app/lineups/page.tsx` → `[]`; **0 hallazgos** (0 nuevos). Verificaciones manuales: variantes de Alert coherentes con DESIGN.md OK · copy 100% español OK · nunca un control bloqueado sin motivo escrito OK · reintentar consistente (mismo `.stack`/`secondary`/`Reintentar`) OK · sin estilos inline OK · radios/tipografía en escala OK.

**Puertas:** typecheck · lint 0 errores · UI 713/713 (57 archivos) · build 19/19 · detector 0 nuevos.

**Veredicto:** CERRADO — 0 P0 / 0 P1 abiertos (38/40); 1 P1 + 2 P2 corregidos antes de cerrar, 3 P3 cerrados, 1 P3 diferido con razón.

## Cierre (2026-11-08)

- **Código:** `app/lineups/lineups-page.tsx` — `gpClosedReason` (`cancelled` > `finished` > `locked` > null) + `gpClosedLabel` (motivo escrito por estado); alerta de estado por variante (warning/info/error) renderizada ANTES de los fallos de carga; `disabledReason`/`wildcardDisabledReason` nombran el estado real; fila de coste reencuadrada a "Coste del borrador" en GP cerrado (sin "cambios sin guardar"); fila de plazo de cierre oculta en GP cancelado; `lineup.isError`/`history.isError` con botón "Reintentar" (mismo patrón que `builder.isError`). Tests: `lineups-page.test.tsx` +8 (estados terminales, prioridad cancelado>lockout, reencuadre de coste A P1, plazo oculto A P3-7, orden de alerta A P2-2, reintentar en lineup/history).
- **Docs:** `docs/architecture/estado-actual.md` — entrada harden /lineups.
- **Siguiente:** cadena harden /lineups cerrada. Pendientes abiertos de otras cadenas: `/mercado` separador decimal (cambia fixtures), nits de layout/copy en `/admin` + auth, auto-selección del último GP con datos (S2 P3 #2).
