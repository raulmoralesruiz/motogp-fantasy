---
target: fundación de motion + feedback de control (animate A1)
total_score: 39
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 0
target_identity: "file:/home/raul/dev/github/motogp/app/globals.css"
target_fingerprint: "sha256:343b0e683779e737dd087814b68a056f1205a2099e502a262a364d459247746b"
target_path: /home/raul/dev/github/motogp/app/globals.css
timestamp: 2026-11-08T16-46-48Z
slug: app-globals-css
---
Method: dual-agent (A: design director · B: detector)

# Crítica de diseño — fundación de motion (animate A1)

**Superficie:** OPERATE — la app es 100% estática (0 transiciones, 1 keyframe `pending-pulse`, 1 guard de reduced-motion). A1 introduce la fundación de motion: tokens de duración/easing + transiciones de control (solo color/borde/fondo) + guard de reduced-motion completo. Modo Operate: el movimiento sirve a feedback, estado y continuidad; transiciones de rutina rápidas; sin coreografía de carga.

**Tesis (antes de la crítica):**
- Material: solo `background-color`/`border-color`/`color` — compositor-friendly, sin animar layout (la Regla Plana no se toca).
- Budget: `--motion-fast` 120 ms (feedback de control), `--motion-base` 200 ms (cambio de estado de rutina), easing `cubic-bezier(0.16, 1, 0.3, 1)`.
- Cobertura inicial: botones primario/secundario, navegación ancla, inputs/selects (fast) y pestañas del mercado (base).
- Todo detrás de `prefers-reduced-motion: reduce` (se conserva el feedback de estado; solo se elimina el movimiento).

**Corrida A (misma superficie):** veredicto **0 P0 / 0 P1** — «clean, purposeful foundation and it passes». Hallazgos:

- **P2-1 — cobertura parcial crea inconsistencia** — `.anchor-nav a` transiciona pero `.site-header-links a` (mismo lenguaje visual: 6 px, surface, filete 1 px) «salta» en hover. En `/admin` ambas barras conviven en la misma página: un chip desliza y el otro salta. → **CERRADO:** `.site-header-links a` entra en la lista fast.
- **P2-2 — `.row-action` fuera de cobertura** — la acción fantasma de fila (texto/borde rojo) cambia de tinte en hover sin transición, «salta» frente a `.button` que «desliza». → **CERRADO:** `.row-action` entra en la lista fast.
- **P3-1 — `.card .cta` sin hover** — el CTA de tarjeta (relleno rojo) no profundiza en hover como `.button`; feedback muerto. → **CERRADO:** `.card .cta:hover { background: var(--accent-deep); }` (mismo hover que `.button`, Regla de la Señal).
- **P3-2 — nota de mantenimiento** — inputs/selects hoy usan `outline` de foco (instantáneo, a propósito); si una unidad posterior añade un estado visible de foco/error en color, debe entrar en la lista fast. → **DOCUMENTADO** (comentario en el bloque).
- **P3-3 — nota de mantenimiento** — toda transición nueva entra también en el guard de reduced-motion. → **DOCUMENTADO** (comentario en el bloque).

**B detector:** `impeccable detect --json app/globals.css` → 3 hallazgos, **todos preexistentes** (2 `design-system-font-size` advisory + 1 `side-tab` warning); **0 nuevos** por el motion.

**Puertas:** lint 0 errores (94 warnings preexistentes en `.opencode/skills/impeccable/scripts/`) · UI 77/77 (shared components + `page.test.tsx`) · detector 0 nuevos.

**Veredicto:** CERRADO — 0 P0/P1 (39/40); 2 P2 + 1 P3 corregidos en código, 2 P3 documentados como notas de mantenimiento.

## Cierre (2026-11-08)

- **Código:** `app/globals.css` — tokens `--motion-fast`/`--motion-base`/`--ease-out` en `:root`; transiciones (solo color/borde/fondo) en `.button`, `.button-secondary`, `.anchor-nav a`, `.site-header-links a`, `.row-action`, `.card .cta`, inputs/selects (fast) y `.tab` (base); `.card .cta:hover` (mismo hover que `.button`); guard de `prefers-reduced-motion: reduce` neutraliza todas las transiciones y conserva el feedback de estado.
- **Docs:** `DESIGN.md` — nueva sección «Motion» (tokens, material permitido, cobertura, Named Rules «La Regla del Movimiento con Propósito» y «La Regla del Reposo Respetado») + Do/Don't de motion + entrada en «Estado» (F3 cerrada + animate A1 cerrada).
- **Siguiente (animate A2):** el momento focal — la transición *provisional → definitivo* en `/resultados` (el resultado se cierra y el ranking se mueve).
