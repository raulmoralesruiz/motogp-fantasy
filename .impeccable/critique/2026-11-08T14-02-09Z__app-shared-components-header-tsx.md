---
target: cabecera global (T-26)
total_score: 29
max_score: 36
na_heuristics: [10]
p0_count: 0
p1_count: 0
target_identity: "file:/home/raul/dev/github/motogp/app/shared/components/header.tsx"
target_fingerprint: "sha256:453a3fb4d0670f88a2ec0d8795926f493615e54140537a036c193d400a545d45"
target_path: /home/raul/dev/github/motogp/app/shared/components/header.tsx
timestamp: 2026-11-08T14-02-09Z
slug: app-shared-components-header-tsx
---

Method: dual-agent (A: design director · B: detector)

# Crítica de diseño — cabecera global persistente · T-26

**Superficie:** ENTER + OPERATE — `app/shared/components/header.tsx` (brand + 6 secciones + sesión + Admin para `global_admin` + hamburguesa ≤768 px), montada en `app/layout.tsx` en todas las páginas; dedupe de la nav «Secciones» y la sección «Sesión» de la home (`app/page.tsx`); skip-link en el layout; CSS `.site-header*` + `.skip-link` en `app/globals.css`.

**Veredicto A (ronda 1):** «coherente, no específica» — on-brand por paleta (pit-night, rojo reservado para señal/CTA), no por diseño; sin rasgo de motorismo (limitado por el constraint de licencias, documentado). 27/36, **2 P1 + 3 P2**.

## Hallazgos A (ronda 1) y resolución

| # | Prioridad | Hallazgo | Resolución |
|---|---|---|---|
| 1 | **P1** | Sin skip-link: el teclado recorre brand + 6–7 links + sesión en cada página (WCAG 2.4.1) | **FIXED** — `<a class="skip-link" href="#contenido">Saltar al contenido</a>` como primer elemento de `<body>` en `layout.tsx`; `{children}` envuelto en `<div id="contenido" tabIndex={-1}>` (patrón W3C; cada página aporta su propio `<main>`); CSS oculto hasta `:focus`; test en `layout.test.tsx` |
| 2 | **P1** | Al cerrar el menú móvil (Escape / navegar / logout) el foco se pierde en `<body>` | **FIXED** — `menuButtonRef`; el foco vuelve al toggle en las 3 vías de cierre; guard `menuWasOpenRef` evita robar foco en el mount inicial; tests en las 3 vías |
| 3 | P2 | CLS: la zona de sesión (asíncrona, `auth.me`) podía envolver a una 2ª línea y cambiar la altura de la barra en anchos de escritorio estrechos | **FIXED (estructural)** — `.site-header-bar` sin `flex-wrap` en escritorio; `.site-header-nav { min-width: 0 }` absorbe la presión (los links envuelven DENTRO de la nav, síncrono); `.site-header-session { flex: 0 0 auto }` nunca envuelve; el wrap se restaura solo en ≤768 px (menú abierto = cambio iniciado por el usuario, no asíncrono) |
| 4 | P2 | Copy dividido: «Inicia sesión» (home, registro, perfil, ligas, detalle, unirse) vs «Iniciar sesión» (header, login) | **FIXED** — infinitivo en todas las apariciones (7 archivos + 6 tests); `grep "Inicia sesión" app test` → 0 |
| 5 | P2 | «Reintentar» sin busy durante el refetch (doble clic posible, sin feedback) | **FIXED** — `disabled={me.isRefetching}` + test |

## Hallazgos B (detector)

`impeccable detect --json` sobre `header.tsx`, `layout.tsx`, `page.tsx`, `globals.css`:

- `design-system-font-size` (advisory) en `.site-header-brand` 1.05rem — **fuera de la rampa de DESIGN.md** → **FIXED**: 1.1rem (headline documentada).
- Restantes (preexistentes, fuera de T-26, sin acción): `side-tab` L117 (alerta de estado, `border-left 3px var(--warning)`), `2.5rem` L356 (display hero), `0.8rem` L751 (cabecera de tabla — documentada en DESIGN.md «0.8 de cabecera»).

## Tabla final de heurísticas (estado al cerrar)

| # | Heurística | Puntuación |
|---|---|---|
| 1 | Visibilidad del estado del sistema | 3 |
| 2 | Ajuste al mundo real | 3 |
| 3 | Control y libertad del usuario | 3 |
| 4 | Consistencia y estándares | 4 |
| 5 | Prevención de errores | 3 |
| 6 | Reconocimiento antes que recuerdo | 3 |
| 7 | Flexibilidad y eficiencia | 3 |
| 8 | Estética y diseño minimalista | 3 |
| 9 | Recuperarse de errores | 4 |
| 10 | Ayuda y documentación | n/a |

**Suma: 29/36 · P0: 0 · P1: 0 → CERRADO.**

## Residuos documentados (P3, no bloquean)

- Pendiente de sesión = vacío silencioso (sin pulso `.pending` como en home) — coherente con la decisión de no añadir movimiento a la barra; el fallo real sí es visible (`role=alert` + «Reintentar» con busy).
- Logout a un clic sin confirmación — coherente con el resto de la app (el estado logueado se recupera con un login).
- Especificidad de marca: «on-brand» por paleta, no por forma — limitado por el constraint de licencias (sin logo de MotoGP); el span rojo «Independiente» + subrayado de 2 px del link activo son las marcas propias.

## Puertas (al cierre)

typecheck 0 · `npx eslint app/ test/` 0 issues · UI 692/692 · build 19/19 páginas · detector: 0 hallazgos de T-26 (3 preexistentes documentados arriba).
