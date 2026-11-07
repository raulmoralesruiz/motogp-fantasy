---
target: página /ligas/[id]
total_score: 37
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 0
target_identity: "file:/home/raul/dev/github/motogp/app/ligas/[id]/league-detail-page.tsx"
target_fingerprint: "sha256:107d5d26a89d51b9eb7da80e0573b75e96c8bc165db07f85a46bc1f317df1457"
target_path: /home/raul/dev/github/motogp/app/ligas/[id]/league-detail-page.tsx
timestamp: 2026-11-07T22-08-10Z
slug: app-ligas-[id]-league-detail-page-tsx
---
Method: dual-agent (A: design director · B: detector)

# Crítica de diseño — página `/ligas/[id]` · F3

**Superficie:** OPERATE — "Detalle de liga" (US-24/US-25/US-26/US-27): cabecera con estado, miembros (admin marcado + formerMembers), panel de administración (código de invitación, rotar, habilitar invitaciones, nombre/descripción/ranking ajustado, Hacer admin/Expulsar, Cerrar liga), salir de la liga, código de invitación de solo-lectura para el miembro, unión a la liga pública, ranking general.

**Corridas A de la jornada (misma superficie):** de **25/40** (1 P0 + 5 P1 + 2 P2 + 2 P3) a **37/40** (0 P0/P1, 1 P2 residual corregido). Fixes principales:
- **P0** «Hacer admin»/«Expulsar»/«Cerrar liga» disparaban al instante → `ConfirmDialog` con impacto escrito (`irreversible: true` en Expulsar/Cerrar).
- **P1** «Salir de la liga» usaba `window.confirm` → `ConfirmDialog` (patrón del sistema).
- **P1** feedback compartido arriba para 7 mutaciones → feedback acotado por acción (`rotateError`/`rotated`, `updateError`/`updateSuccess`, `membersError`/`membersSuccess`, `closeError`/`closeSuccess`, `invitesError`/`invitesSuccess`, `joinError`, `leaveError`/`leaveSuccess`).
- **P1** visibilidad `<select>` con opciones que el servidor rechaza → lectura de solo-lectura derivada de `l.type` (`VISIBILITY_BY_TYPE`); la visibilidad **no** se envía en el payload de `update` (acoplada por el servidor).
- **P1** estado de la liga no visible en cabecera → `<strong>{leagueStatusLabel(l.status)}</strong>` cuando `status !== "active"`.
- **P1** «Unirme» aparecía en ligas públicas finalizadas (el servidor rechaza `not_accepting_entries`) → sección de unión condicionada a `status === "active"`; aviso neutro con enlace a `/ligas` en caso contrario.
- **P2** acciones de fila en rojo sin contexto de miembro para lectores de pantalla → `RowAction` + `aria-label` con el nombre de usuario («Hacer admin a piloto2», «Expulsar a piloto2»).
- **P2** formulario de configuración sin validación cliente; «Guardar cambios» siempre activo → `submitBlockReason()` + `disabledReason` en el botón.
- **P3** listas en `<ul>`/`<ol>` planos → `ul.status`/`ol.status`; formulario en `<div>` → `<form className="form">` + `.stack`; fechas UTC → `toLocaleDateString("es-ES")`.
- **P3** sección «Salir» del admin no apuntaba a «Hacer admin» → referencia textual (y rama de admin único: «cierra la liga»).
- **P1 (2ª corrida)** código de invitación invisible para el miembro (función muerta para su público) → bloque de solo-lectura «Invitar a amigos» cuando `l.isMember && !l.isAdmin && l.code` (el servidor lo entrega al miembro con `allowMemberInvites`, `canInvite`).
- **P2 (2ª corrida)** «Cerrar la liga» era un control muerto en liga no activa (el servidor rechaza) → oculto cuando `status !== "active"`.
- **P2 (2ª corrida)** «Rotar código» revocaba el código vigente sin advertir el impacto → `ConfirmDialog` con impacto escrito («El código actual quedará revocado»).
- **P3 (2ª corrida)** `auth.me` `isError` conflaba "sin sesión" con "fallo real" → `isUnauthorized()` (solo `UNAUTHORIZED` lee como "inicia sesión"; el resto, fallo real).
- **P2 (3ª corrida)** `leaveSuccess` vivía dentro del bloque de miembro: al salir de una pública el refetch vuelve `isMember: false` y el aviso se perdía → feedback de salida movido a nivel de página (sobrevive al cambio de estado).
**B detector:** `impeccable@4.8.0 detect --json app/ligas/[id]` → `[]` (limpio) sobre el código final.

**Puertas:** lint 0 errores (solo warnings preexistentes de scripts minificados del skill) · typecheck limpio · UI 636 tests en verde (54 archivos; `league-detail-page` 65).

**P3 residuales (documentados, no bloqueantes):**
1. El admin «Salir» apunta a «Hacer admin» por referencia textual, no por enlace clicable — P3 aceptado.
2. El aviso de éxito de rotación repite el nuevo código (también visible en la alerta info tras el refetch) — redundancia deliberada: el refetch es asíncrono y el valor directo es fiable.

**Veredicto:** CERRADO — 0 P0/P1; 2 P3 documentados como trade-offs aceptados.
