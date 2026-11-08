---
target: página /perfil
total_score: 36
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 0
target_identity: "file:/home/raul/dev/github/motogp/app/perfil/perfil-page.tsx"
target_fingerprint: "sha256:02c9ad58a392943406ce2b34fbfeaae5276bdcb722c9d2c05e97f894badeb821"
target_path: /home/raul/dev/github/motogp/app/perfil/perfil-page.tsx
timestamp: 2026-11-08T03-20-46Z
slug: app-perfil-perfil-page-tsx
---

Method: dual-agent (A: design director · B: detector)

# Crítica de diseño — página `/perfil` · F3

**Superficie:** OPERATE — gestión de cuenta: datos del usuario (nombre visible, email), exportación JSON (GDPR), 2FA TOTP (D-07/ADR-0039: desactivado / matriculación con QR / pendiente / activo), notificaciones por email (US-36) y eliminación de cuenta por anonimización (ADR-0016). ~80% de uso en móvil.

**Corridas A de la jornada (misma superficie):** R1 (2 P1) → **R2 35/40** (0 P0/P1) → **R3 36/40** (0 P0/P1, 1 P2) → **R4 36/40** (final, 0 P0/P1). Fixes por ronda:

- **R1 (2 P1):** **P1** botón «Eliminar cuenta» sin jerarquía destructiva (se leía como acción normal) → `RowAction` con outline rojo + `disabledReason` + guard de submit del formulario de confirmación. **P1** estado TOTP PENDIENTE: «Generar nuevo código» era un no-op silencioso (la rama `enrolled` ocultaba el QR nuevo) → reorden de ramas `enabled`→`qr`→`enrolled`→default + botón «Cancelar» + tests de regresión.
- **R2 (35/40, 0 P0/P1):** dos items de severidad menor: **P2** `perfil-page.tsx` confundía «sin sesión» (UNAUTHORIZED, estado normal) con fallo real del servidor (500/red) → un usuario logueado con un 500 transitorio veía «No has iniciado sesión» y era enviado a /login, enmascarando el error. **P3** tras confirmar 2FA, la prop `enabled` (de `profile.me`) aún era stale y la sección parpadeaba «PENDIENTE» antes de asentar en «ACTIVO».
- **P2/P3 aplicados:** **P2** `isUnauthorized(error)` (criterio `error.data.code === "UNAUTHORIZED"`, idéntico al de la home) → rama dividida: UNAUTHORIZED → «No has iniciado sesión» + enlace /login; cualquier otro error → `Alert variant="error"` con mensaje amigable + botón «Reintentar» (`me.refetch()`). **P3** rama de éxito gateada en `confirm.isSuccess` (muestra «ACTIVA» hasta que `profile.me` vuelque a `enabled`). Pulido adicional: errores de `settings` → Alert + Reintentar; `Field` con ARIA (`aria-invalid`/`aria-describedby`/`role="alert"`); pulso `.pending` coherente.
- **R3 (36/40, 0 P0/P1, 1 P2):** el P2 nuevo era propio del fix anterior: `confirm.isSuccess` nunca se reseteaba (TanStack lo conserva hasta `reset()`), así que tras activar→desactivar→re-matricular→cancelar la rama de éxito se disparaba con 2FA pendiente (callejón sin salida). **Fix:** `confirm.reset()` en `enroll.onSuccess` y `disable.onSuccess` + rama de éxito elevada ANTES que `enrolled` (cubre también el gap de matriculación nueva) + 2 tests de regresión (el mock por defecto `defaultMutationResult()` gana `reset`, fiel a la API real de TanStack).
- **R4 (36/40, 0 P0/P1):** veredicto final. P2 verificado RESOLVED con trazado línea a línea de la máquina de estados (confirm → activo → desactivar → re-matricular → cancelar ya cae en PENDIENTE, no en «ACTIVA»). **P3** residual aplicado: el botón «Cancelar» también resetea `confirm` (un error de confirmación superado no reaparecía en PENDIENTE) + assertion en el test.

**B detector:** `impeccable detect --json app/perfil/` → `[]` (limpio) sobre el código final (re-ejecutado tras cada cambio de fuente).

**Puertas:** lint 0 errores (archivos cambiados) · typecheck limpio · UI 662 tests en verde (54 archivos; `totp-section` 17, `perfil-page` 22, `field` 6).

**P3 residuales (documentados, no bloqueantes):**

1. **Alertas de éxito sin auto-descarte** — `update.isSuccess` y `updateSettings.isSuccess` persisten tras la acción (caen en la siguiente mutación o al desmontar); un «actualizado» stale puede quedar junto a un formulario sin cambios. Opcional: auto-dismiss o limpieza en `onMutate`. (R4.)
2. **Tests de regresión del flag stale verifican el mecanismo, no la secuencia completa** — el mock de `isSuccess` es estático (el `reset` es un spy no-op), así que la secuencia confirm→activo→desactivar→re-matricular→cancelar no se simula de punta a punta en un solo test; la trazabilidad del código cierra el escenario. Opcional: mock de estado que volteara `isSuccess`/`isError`. (R4.)

**Veredicto:** CERRADO — 0 P0/P1 (R4 36/40); 2 P3 documentados como trade-offs aceptados.
