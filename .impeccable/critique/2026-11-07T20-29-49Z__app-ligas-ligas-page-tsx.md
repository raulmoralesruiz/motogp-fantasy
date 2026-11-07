---
target: página /ligas
total_score: 37
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 0
target_identity: "file:/home/raul/dev/github/motogp/app/ligas/ligas-page.tsx"
target_fingerprint: "sha256:c40b9f63284e8005b99e97a8e3d30eed31403f0b672b229c7b0c937dedad333c"
target_path: /home/raul/dev/github/motogp/app/ligas/ligas-page.tsx
timestamp: 2026-11-07T20-29-49Z
slug: app-ligas-ligas-page-tsx
---
Method: dual-agent (A: design director · B: detector)

# Crítica de diseño — página `/ligas` · F3

**Superficie:** OPERATE — "Ligas" (US-23/US-24/US-25): mis ligas con su estado, directorio de ligas públicas, enlace a la unión por código (`/unirse`) y creación de una liga (nombre/descripción/tipo/visibilidad derivada/min-máx miembros/modo de entrada/fechas/ranking ajustado).

**Corridas A de la jornada (misma superficie):** 13 evaluaciones aisladas, de **26/40** (5 P1 + 3 P2 + 3 P3) a **37/40** (0 P0/P1/P2, 3 P3). Fixes principales:
- **P1** doble envío → guard `create.isPending` + botón `disabled` nativo en transitorio + "Limpiar" bloqueado.
- **P1** estado sin sesión → consulta `auth.me` y rama neutra con salidas a `/login` y `/registro` (patrón `/unirse`, US-25), no error en rojo + formulario que fallaría al enviar.
- **P2** `entryMode=invite` deshabilitado con explicación (hoy crea una liga muerta — sin código y sin uniones, ADR-0025).
- **P2** liga no activa marcada en "Mis ligas" (`LeagueView.status` + `leagueStatusLabel` tipado con la unión de dominio `LeagueStatus`).
- **P2** error de creación junto a la acción (dentro del `<form>`), no arriba de la página.
- **P3** "Sin listar" retirado (funcionalmente idéntica a "privada" — `canViewLeague` solo mira `type`).
- **P3** visibilidad ya no es un `<select>` muerto: lectura de solo lectura derivada de `VISIBILITY_BY_TYPE` (el tipo la determina por completo).
- **P3** `MIN_MEMBERS`/`MAX_MEMBERS`/`EMPTY_FORM` derivados de `PROVISIONAL_SEASON_RULES.league` (fuente de verdad, AGENTS.md §1.3 — no constantes mágicas).
- **P3** `Number.isInteger` en miembros; fecha de fin ≥ inicio; banner de éxito se limpia al tocar el formulario.
- **P3** estados vacíos con salidas accionables (`#crear-liga`, `#directorio`); capa de vocabulario antes de la primera lista; ayuda de "modo de entrada" aclara que en una pública la entrada es abierta (ADR-0024) y el modo solo decide si se genera código.
**B detector:** `impeccable@4.8.0 detect --json app/ligas` → `[]` (limpio) sobre el código final.

**Puertas:** lint 0 errores (94 warnings preexistentes) · typecheck limpio · UI 92 tests en verde (4 archivos: `ligas-page` 34, `league-detail-page` 57 + 2 suites).

**P3 residuales (documentados, no bloqueantes):**
1. `me.isError` confla "sin sesión" con "fallo transitorio" — mismo patrón que `/unirse` (US-25); aceptado.
2. Etiquetas "Miembros mínimos/máximos (2–50)" repiten el rango del párrafo de ayuda — UX deliberada en el punto de entrada.
3. Gap de `.stack` (1rem) > `.form` (0.9rem) — CSS global de todas las páginas F3.

**Veredicto:** CERRADO — 0 P0/P1/P2; 3 P3 documentados como trade-offs aceptados.
