---
target: flujo de autenticación (login, registro, recuperar-contrasena, reestablecer-contrasena, terminos, privacidad)
total_score: 38
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 0
target_identity: "file:/home/raul/dev/github/motogp/app/login/login-form.tsx"
target_fingerprint: "sha256:87c1c991fb8a9b4eae84fc0e85fc7bf667038de7e79513f278c85319f8046b2f"
target_path: /home/raul/dev/github/motogp/app/login/login-form.tsx
timestamp: 2026-11-08T11-54-05Z
slug: app-login-login-form-tsx
---

Method: dual-agent (A: design director · B: detector)

# Crítica de diseño — flujo de autenticación · F3

**Superficie:** ENTER — la puerta de entrada al producto: registro (proposición de valor + términos), login (1 paso o 2 pasos con 2FA TOTP, D-07/ADR-0039), recuperación/reestablecimiento de contraseña y las páginas legales nuevas `/terminos` + `/privacidad`. ~100% móvil; la Regla de los 44 px aplica a todos los controles.

**Corridas A de la jornada (misma superficie):** R1 (2 P1) → R2 → R3 → R4 (1 P1) → R5 (37/40, 2 P1) → **R6 38/40** (final, 0 P0/P1, gate cumplido). Fixes por ronda:

- **R1 (2 P1):** **P1** registro sin enlace a términos/privacidad (consentimiento sin referencia, GDPR) → enlaces a `/terminos` + `/privacidad` + creación de ambas páginas (contacto + enlace de vuelta) + tests. **P1** 2FA de una sola vía: al entrar en el paso 2 no había salida (el error «El reto ha caducado» prescribe una acción que la UI no ofrecía) → botón secundario «Volver a iniciar sesión» (reset del reto) + tests.
- **R2–R3 (0 P0/P1):** **Fuga de contraseña** (el hallazgo más grave de la jornada) — React reconciliaba ambas ramas de paso sobre el mismo `<form>` y reutilizaba el `<input>` de contraseña como el del código: la contraseña tecleada en el paso 1 seguía visible en el paso 2 → `key="step-1"`/`key="step-2"` (remount completo por paso; el campo de código monta vacío, el email remonta con `defaultValue={email}`) + test de regresión. Además: email enmascarado en el paso 2 (se ve de qué cuenta es el código) y foco en el campo de código al cambiar de paso (`codeRef` + `useEffect`, determinista bajo `commitMount` de React 19).
- **R4 (1 P1):** **P1** al volver del paso 2 el foco se perdía (el usuario tenía que buscar el campo de contraseña) → `passwordRef` + flag `returnedFromStep2` → foco en el campo de contraseña al volver + test.
- **R5 (37/40, 2 P1):** **P1** la pantalla de éxito del registro no conducía al objetivo #1 del producto (montar un lineup) → línea de éxito «Cuenta creada. Ahora monta tu primer lineup: 2 oro + 2 plata + 1 constructor + 1 equipo.» + CTA primaria «Monta tu primer lineup» (→ `/lineups`) + secundaria «Ir a mi dashboard» (→ `/`) + tests. **P1** dispositivo 2FA perdido = callejón silencioso → `Alert` `info` elevado sobre los botones con proceso + SLA: «¿Perdiste el dispositivo o la app de autenticación? Escríbenos a raurmorales22@gmail.com: te pediremos verificar tu identidad y respondemos en 24–48 h.» (buzón real que recibe, decisión del dueño 2026-11-08) + test.
- **R6 (38/40, 0 P0/P1):** veredicto final. El revisor corrigió el registro: la supuesta violación de 44 px **no existe** — midió 44 px en todos los controles de auth a 375/390/430 (el enlace «¿Olvidaste tu contraseña?» es 44 px vía `.button-secondary`; los cross-links inline sub-44 px quedan fuera de la enumeración de la Regla de los 44, DESIGN.md:224, y dentro de WCAG 2.5.8 AA — completitud, no defecto).

**B detector:** `impeccable detect --json` → `[]` (limpio) sobre el código final (re-ejecutado tras cada cambio de fuente).

**Puertas:** lint 0 errores (archivos cambiados) · typecheck limpio · UI 682 tests en verde (56 archivos; auth 6-path 52/52 en 10 archivos).

**P2/P3 residuales (documentados, no bloqueantes):**

1. **P2 — sin gate de regresión de 44 px en las páginas de auth** — `assertTouchTargets` solo corre en el describe del builder; el describe de auth solo aserta `assertNoHorizontalOverflow`. Un cambio de CSS futuro podría romper la Regla de los 44 en login/registro/recuperar/reestablecer sin que el gate lo detecte. Opcional: extender `assertTouchTargets` al describe de auth. (R6.)
2. **P3 — la aserción del gate contradice el patrón del checkbox** — el gate T-16 aserta `min-height: 44px` en `.field input` y `.button`, pero el checkbox de términos es un `<input type="checkbox">` hecho a mano que no coincide con ninguno de los selectores. Opcional: extender el gate a `.field input[type="checkbox"]` o documentar el checkbox como fuera de alcance. (R6.)
3. **P3 — el checkbox de términos carece de `aria-invalid`/`aria-describedby`** — `Field` cablea ambos; el checkbox hecho a mano de `register-form.tsx` no, de modo que los lectores de pantalla no anuncian el error «debes aceptar los términos». Opcional: añadir los ARIA o extraerlo a `Field`. (R6.)
4. **P3 — copy «opuesto a la automatización» (privacidad/page.tsx)** — la redacción no es clara para un usuario no técnico. Opcional: reformular para aclarar la intención. (R6.)
5. **P3 — las páginas legales reutilizan `<section className="form">` para layout** — nit de consistencia menor, no funcional. (R6.)

**Veredicto:** CERRADO — 0 P0/P1 (R6 38/40); 1 P2 + 4 P3 documentados como trade-offs aceptados.
