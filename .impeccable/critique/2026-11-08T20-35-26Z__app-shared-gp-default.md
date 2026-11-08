---
target: S2 P3 #2 — auto-selección al último GP con datos (defaultGpId + consistencia /resultados ↔ /puntuacion)
total_score: 34
max_score: 40
na_heuristics: 1,5,6,7,8,9
p0_count: 0
p1_count: 1 (cerrado antes de cerrar la unidad: snap-back en /puntuacion)
target_identity: "file:/home/raul/dev/github/motogp/app/shared/gp-default.ts"
target_fingerprint: "sha256:4945ef37131deece4656c59714e135d508dbec5e6a1b1f42cb39b1e9ba07f959"
target_path: /home/raul/dev/github/motogp/app/shared/gp-default.ts
timestamp: 2026-11-08T20-35-26Z
slug: app-shared-gp-default
---
Method: dual-agent (A: design director · B: detector)

# Crítica de diseño — S2 P3 #2 (auto-selección al último GP con datos)

**Superficie:** OPERATE — el GP por defecto de las páginas de LECTURA (`/resultados`, `/puntuacion`): qué GP abre la página al llegar.

**Tesis (antes de la crítica):**
- La distinción lectura/acción es la semántica estricta de "El Muro de Boxes": las páginas de lectura abren donde el fan va a mirar (último GP con resultados definitivos), las de acción abren donde puede actuar (próximo programado).
- `finished` = "publicación de los resultados definitivos" (`gp-status.ts`) — la señal de que hay datos. Un GP `locked` (carrera en curso) no es default en lectura (coherente; el usuario puede elegirlo a mano).
- Una única fuente de criterio (`defaultGpId`, helper puro) — las dos páginas de lectura delegan, no duplican la lógica inline.
- La deselección explícita del usuario se respeta (sin snap-back) en ambas páginas.

**Corrida A:** veredicto **APROBADO CON REVISIÓN** — 0 P0 / 1 P1 / 1 P2 / 2 P3. "El criterio de auto-selección es el correcto; el defecto principal no es de criterio sino de consistencia: las dos páginas de lectura no se comportan igual ante la deselección explícita." Todos cerrados antes de cerrar la unidad:

- **P1 — snap-back en `/puntuacion`:** la deselección explícita del usuario (elegir "— Temporada —" / "— GP —") no se respetaba: los efectos de auto-selección la anulaban en el siguiente render (a diferencia de `/resultados`, que sí respeta). **Fix:** flags `seasonCleared`/`gpCleared` + guards en los dos efectos + `onChange` de ambos selects — patrón idéntico al de `/resultados`.
- **P2 — sin test UI del nuevo default en `/puntuacion`:** el mock `GP1` no llevaba `status` y el test existente pasaba por la razón equivocada (no ejercitaba `defaultGpId`). **Fix:** `status: "finished"` en el mock + test "con GP finalizado abre en él por defecto" + test reescrito "sin finalizados ni programados (cancelled) → sin pre-selección".
- **P3-1 — tipo `GpLike.status: string` laxo:** documentado (unión canónica en `modules/seasons/gp-status.ts`, inaccesible desde `shared/` por layering; nombre `GpLike` no colisiona con `GpStatus` de `shared/types`, que es otra cosa: estado del piloto en el resultado).
- **P3-2 — hueco de test `locked`:** 2 casos añadidos a `gp-default.test.ts` (`[locked, scheduled] → scheduled`; `[locked] → null`).

**Corrida B (detector):** `[]` limpio — sin defectos funcionales, sin regresiones, sin fugas de estado, sin violación de invariantes (multi-liga, lockout, idempotencia no tocados).

**Puntuación A (heurísticas aplicables):** H2 claridad de propósito 4/5 · H3 consistencia cross-page 3/5 (el P1 la restaba; tras el fix, 4) · H4 feedback/estado 3/5 · H10 testabilidad 3/5 (tras P2/P3, 4). Resto n/a (no aplica a un helper de selección por defecto).

**Veredicto final:** 0 P0 / 0 P1 abiertos — **CIERRA UNIDAD**. Puertas: lint 0 errores, typecheck, unit 914/914, UI 717/717, build 19/19.
