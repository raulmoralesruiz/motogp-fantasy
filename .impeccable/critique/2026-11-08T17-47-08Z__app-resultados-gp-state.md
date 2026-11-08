---
target: momento focal provisional → definitivo en /resultados (animate A2)
total_score: 37
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1 (cerrado antes de cerrar la unidad)
target_identity: "file:/home/raul/dev/github/motogp/app/globals.css + file:/home/raul/dev/github/motogp/app/resultados/resultados-page.tsx"
target_fingerprint: "sha256:58243fe94041d89d5d6053a9d61cef782ea788f13d7157faadec3df5f1a968f7"
target_path: /home/raul/dev/github/motogp/app/resultados/resultados-page.tsx
timestamp: 2026-11-08T17-47-08Z
slug: app-resultados-gp-state
---
Method: dual-agent (A: design director · B: detector)

# Crítica de diseño — momento focal provisional → definitivo (animate A2)

**Superficie:** OPERATE — el único momento de la app que merece autoría: el estado del GP en `/resultados`. El estado provisional → definitivo era texto plano enterrado en un párrafo; A2 lo hace legible de un vistazo (chip de estado) y le da al definitivo un solo beat de asentamiento — el único beat de la app. Modo Operate: el movimiento confirma la llegada del estado, no lo decora.

**Tesis (antes de la crítica):**
- Legibilidad: chip `.gp-state` — definitivo = ok (verde), provisional = en curso; el texto muted lleva el detalle (versión / "aún sin confirmar").
- Material: solo `color`/`border-color`/`background-color` (Regla del Material de la sección «Motion»); el beat asienta de un tinte fuerte (90/22) al tinte de reposo 40/10.
- Budget: un solo beat, `--motion-focal` 400 ms, `--ease-out`, una vez por nodo (no bucle, sin repetición al cambiar de GP).
- Todo dentro del guard de `prefers-reduced-motion: reduce` (se conserva color/etiqueta; solo se elimina el movimiento).

**Corrida A:** veredicto **APROBADO CON REVISIÓN** — 0 P0 / 1 P1 / 2 P2 / 2 P3. El sistema duro se respeta de punta a punta (tinte, radios, tipografía, material de animación, guard, copy, convivencia inline); el P1 y los P2 se resolvieron antes de cerrar:

- **P1-1 — el provisional en ámbar contradice la semántica documentada y colisiona en la misma pantalla** — DESIGN.md: «Azul informativo: alertas informativas (puntuación provisional…)»; la propia página trata los estados rutinarios como neutros/info y reserva el ámbar para lo excepcional (GP cancelado). Con el chip ámbar, el mismo hecho («el GP no está confirmado») aparecía con dos colores en la misma pantalla (chip ámbar + Alert info azul). → **CERRADO:** `.gp-state--provisional` pasa a `var(--info)` (Tinte 10/40 del azul informativo); DESIGN.md registra el uso («estado provisional del GP»).
- **P2-1 — el beat atado al render podía diluirse en "beat por visita"** — la Regla del Movimiento con Propósito exige que la transición confirme una acción o un cambio de estado. → **CERRADO (semántica documentada, sin JS):** el beat corre una vez por nodo — al primer render del estado definitivo (la llegada del estado al usuario) y de nuevo si el GP pasa de provisional a definitivo con la página abierta; no se repite al cambiar de GP (mismo nodo, clase estable) ni es bucle. Documentado en el comentario de `globals.css` y en la sección «Motion» de DESIGN.md.
- **P2-2 — 400 ms valor suelto** — la disciplina F2 (cada valor una vez en `:root`) no se aplicaba al motion. → **CERRADO:** token `--motion-focal: 400ms` en `:root`, referenciado en la animación y en la tabla de tokens de «Motion».
- **P3-1 — doble declaración de `.gp-state--definitive`** → **CERRADO:** color + animación en un solo bloque.
- **P3-2 — duplicación estado/versión entre chip y línea del total** — el total (ScoreBreakdown, compartido con `/puntuacion`, donde la etiqueta es la única señal de estado) repite "definitivo · resultados rv-X". → **DIFERIDO:** cambiar la etiqueta del componente compartido por una sola página rompería `/puntuacion`; el chip es autocontenido y la repetición es redundancia, no contradicción.

**B detector:** `impeccable detect --json app/globals.css app/resultados/resultados-page.tsx DESIGN.md` → 3 hallazgos, **los 3 preexistentes exactos** (1 `side-tab` warning + 2 `design-system-font-size` advisory, desplazados de línea por el bloque A2); **0 nuevos**. Verificaciones manuales: radios (6 px, en escala) OK · tipografía (0.9 rem Subhead, en escala) OK · cero hex fuera de tokens OK · sin `transform`/geometría en animaciones OK · animación dentro del guard de reduced-motion OK · JSX sin estilos inline OK · coherencia con DESIGN.md OK.

**Puertas:** typecheck · lint 0 errores · UI 705/705 (57 archivos) · build 19/19 · detector 0 nuevos.

**Veredicto:** CERRADO — 0 P0 / 0 P1 abiertos (37/40); 1 P1 + 2 P2 corregidos antes de cerrar, 1 P3 cerrado, 1 P3 diferido con razón.

## Cierre (2026-11-08)

- **Código:** `app/globals.css` — chip `.gp-state` (inline, radio 6 px, Subhead 0.9 rem, Tinte 10/40): `.gp-state--definitive` (ok) con beat `gp-state-settle` (`--motion-focal` 400 ms, solo borde/fondo) y `.gp-state--provisional` (info, quieto); token `--motion-focal` en `:root`; guard de reduced-motion neutraliza el beat y conserva color/etiqueta. `app/resultados/resultados-page.tsx` — estado del GP en chip + detalle muted. Tests: `resultados-page.test.tsx` (clase del chip + exclusión mut definitiva/provisional), `test/e2e/flows.results.test.ts` (texto del chip).
- **Docs:** `DESIGN.md` — sección «Motion» (token `--motion-focal` en la tabla + «Momento focal (animate A2)» con la semántica exacta del beat), línea «Azul informativo» (estado provisional del GP), changelog «animate A2 cerrada».
- **Siguiente:** la cadena animate queda cerrada (A1 fundación + A2 momento focal). Pendientes abiertos de otras cadenas: `/mercado` separador decimal (cambia fixtures), nits de layout/copy en `/admin` + auth, auto-selección del último GP con datos (S2 P3 #2).
