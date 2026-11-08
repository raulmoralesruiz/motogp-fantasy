---
target: /unirse (unirse a una liga por código, US-25) + destino `next` del login
total_score: 32
max_score: 40
na_heuristics: [10]
p0_count: 0
p1_count: 0
target_identity: "file:/home/raul/dev/github/motogp/app/unirse/join-league-page.tsx"
target_fingerprint: "sha256:50651b4c9e1c8687ce1fa8cb23ee19be8412d1a3fb2f6237b39a1cc1cd3e65cf"
target_path: /home/raul/dev/github/motogp/app/unirse/join-league-page.tsx
timestamp: 2026-11-08T14-57-04Z
slug: app-unirse-join-league-page-tsx
---

Method: dual-agent (A: design director · B: detector)

# Crítica de diseño — `/unirse` (US-25) · F4

**Superficie:** ENTER — la puerta de entrada de un usuario externo que ha recibido un código de invitación de una liga privada (no conoce el `leagueId`). El servidor valida todo (código, estado, modo, membresía, plaza, anti-fuerza-bruta por IP); la UI solo muestra el motivo en español. Éxito → confirmación visible + redirección al detalle `/ligas/{id}`. Unirse exige sesión (sin ella: CTA a /login con `next=/unirse` + /registro).

**Corridas A de la jornada (misma superficie):** R1 29/40 ABIERTO (1 P1 + 3 P2 + 4 P3) → fixes → **R2 32/40 CERRADO** (0 P0/P1, gate cumplido). Fixes por ronda:

- **R1 (1 P1 + 3 P2 + 4 P3):**
  - **P1 — el momento de éxito no está marcado:** `onSuccess` solo hacía `router.push` — el pico del viaje de adquisición (usuario invitado, alta expectativa) se dejaba a la inferencia → `Alert variant="success"` «Te has unido a «{nombre}» — entrando…» + redirección diferida ~1 s (con `clearTimeout` al desmontar; no se dispara un push «fantasma» sobre otra página) + test.
  - **P2-1 — CTA «Unirme» deshabilitado sin motivo escrito** (contra el compromiso de marca «nunca un control bloqueado sin explicación» y el patrón de `/ligas`) → `disabledReason="Escribe el código de invitación."` (el `Button` lo asocia con `aria-describedby` y bloquea con `aria-disabled`, no `disabled` nativo: sigue en el orden de foco) + test.
  - **P2-2 — el error del servidor vivía fuera de la acción** → `onError` + `Alert variant="error"` **dentro del `<form>`, junto al CTA** + test (`alert.closest("form")`).
  - **P2-3 — h1 con toda la frase marcada en rojo** (`<span>Unirse a una liga</span>`) → una sola palabra roja: «Unirse a una **liga**» (coherente con «Inicia **sesión**»).
  - **P3-1 — el destino se perdía tras el login** (sin sesión → /login → home, y el invitado tenía que re-encontrar `/unirse`) → `?next=/unirse` en el CTA + `redirectTarget` en `login-form.tsx` (solo rutas relativas válidas: ni absolutas ni `//…` — anti open-redirect) + Suspense en `login/page.tsx` (Next 15) + 2 tests (next válido → `/unirse`; `//evil.com` → `/`).
  - **P3-2 — un fallo real de `auth.me` (500/red) se leía como «sin cuenta»** → rama distinta: «No se pudo verificar tu sesión. Recarga la página e inténtalo de nuevo.» (mismo patrón que el detalle de liga, F3 P3) + test.
  - **P3-3 — el error anterior seguía visible durante el nuevo envío** → `setError(null)` en `handleSubmit` + test.
  - **P3-4 — sin salida para quien no tiene código** → intro «¿No tienes código? Ver las ligas» (rama con sesión) + también en la rama sin sesión.
- **R2 (32/40, 0 P0/P1):** veredicto final. Quedó 1 P2 + 3 P3; se corrigió el P2:
  - **P2 — la rama sin sesión trataba su acción principal con el target más fino de la página** (enlaces inline dentro de un `Alert`) → jerarquía de CTA: «Iniciar sesión» (`.button`, conserva `next=/unirse`) + «Crear cuenta» (`.button-secondary`, Regla de la Señal: un solo relleno rojo) + salida «¿No tienes código? Ver las ligas» + test.
  - **P3 — el pico de éxito era una sola frase** → una línea sobre lo que viene («Verás el ranking, el presupuesto y los próximos GPs en el detalle de la liga») sin romper Regla Plana ni Señal.

**B detector:** `impeccable detect --json app/unirse/ app/login/` → `[]` (limpio) sobre el código final (re-ejecutado tras cada cambio de fuente).

**Puertas:** typecheck 0 · lint 0 errores (94 warnings preexistentes en scripts de la skill) · UI 697/697 (57 archivos; unirse 12 tests) · build 19/19 páginas · detector `[]`.

**P2/P3 residuales (documentados, no bloqueantes):**

1. **P3 — el bloqueo por fuerza bruta se viste de error genérico** — el servidor responde `BAD_REQUEST` tanto para «código no válido» como para «IP bloqueada» (el mensaje sí distingue: «Demasiados intentos fallidos…»). Distinguirlo en la UI (p. ej. `Alert variant="warning"` para el bloqueo) exigiría un código de error propio en el contrato del servidor (`league-service.ts`); no se abre aquí: es una decisión de contrato, no de UI. (R2.)
2. **P3 — el texto de la alerta de éxito envuelve dos frases** — «Te has unido a «…» — entrando…» + línea de contexto; si el nombre de la liga es muy largo, la alerta crece. Aceptable: es un estado transitorio de ~1 s. (R2.)
3. **P3 — `next` solo se respeta en login, no en 2FA** — `verifyTotp` también usa `redirectTarget(searchParams)`, pero si el usuario vuelve de un login 2FA desde otra pestaña, el `next` original no viaja con el reto (el reto vive en estado local). Fuera de alcance: el flujo 2FA ya cierra en la misma página. (R2.)

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

**Suma: 32/40 · P0: 0 · P1: 0 → CERRADO.**
