# ADR-0042: Colores reales de equipo y dorsal persistente en el picker

- **Estado:** Aceptado (2026-11-18)
- **Fecha:** 2026-11-18
- **Relacionado:** US-42 (backlog E8), ADR-0041 (picker + avatares generativos; §Consecuencias difiere el color real de equipo), ADR-0013 (import de mercado en 2 pasos), `data-model.md` §Mercado, `AGENTS.md` §1–§11 (docs fuente de verdad, sin PII, sin branding licenciado).

## Problema

ADR-0041 resolvió la identidad visual del picker con avatares generativos: dorsal o iniciales sobre un fondo **derivado de un hash FNV-1a del nombre** (estable, sin licencias), y difirió explícitamente "el equipo de colores configurables (columna `teams.color`)". Dos defectos quedaron abiertos:

1. **Los colores no son los reales.** Todos los avatares (pilotos, equipos, constructores) usan colores estéticos derivados de hash que no se corresponden con los colores reales de los equipos de MotoGP. La fuente (PulseLive) **ya envía** `team.color` y `team.text_color` (hex) en el payload de `/riders`, pero el normalizador los descarta y `teams` no tiene columnas para ellos.
2. **Los dorsales no persisten en producción.** `riders.number` es `NULL` para los 34 pilotos reales de producción (verificado en vivo) → todos los avatares caen en iniciales, que es el fallback estético y no la identidad real. Raíz de causa: la dorsal de PulseLive vive en `current_career_step.number`, **no** en el campo top-level `rider.number` (ausente en el payload en vivo, 34/34); `normalizePulseLiveMarket` lee solo el top-level (`rider.number ?? null`) → `number: null` → BD `NULL`.

Ambos son defectos de **fidelidad de datos**, no de UX: la fuente da los datos, la normalización los descarta.

## Opciones

- **A. Derivar color en el cliente por heurística de nombre** (mapa nombre de equipo → color conocido, o hash más oscuro).
  - Barato y sin migración, pero: los colores siguen sin ser los reales (se adivinan), cada consumidor re-implementa el mapeo, y se rompe cuando un equipo cambia de nombre/patrón. No es "datos reales".
- **B. Persistir los colores de la fuente en `teams` + fijar la dorsal en la normalización (elegida).**
  - `teams.color`/`teams.text_color` (hex, NULL-ables) rellenan el `import de mercado` (idempotente, auditado); la dorsal se corrige en la raíz (`normalizePulseLiveMarket` lee `current_career_step.number` con fallback top-level) y el import rellena los `NULL` existentes. El picker consume el color **explícito** cuando existe y cae al **hash derivado** cuando no (backward-compatible con datos sin color).
  - Coste: una migración (2 columnas), extensión del normalizador/import y del `BuilderView`; el hash queda como *fallback*, no como fuente.

## Recomendación

**Opción B.**

## Decisión (reglas concretas)

1. **Color solo en `teams`.** Nuevas columnas `teams.color TEXT NULL` y `teams.text_color TEXT NULL` (hex, p. ej. `#ad0000`). `rider.color` y `constructor.color` **no** se persisten: son **derivados** del equipo (el rider por su afiliación de GP; el constructor por heurística, ver 2). Así un cambio de equipo cambia el color del rider sin migración de riders.
2. **Color del constructor = heurística determinística sobre `teams`.** Elige el equipo cuyo nombre contenga el nombre del constructor (coincidencia, case-insensitive); empate (p. ej. Honda con 2 equipos, Yamaha con 3) → el equipo con **más pilotos afiliados** y, aún empatado, **nombre ascendente**. Sin color de equipo aplicable → fallback al hash derivado. Es una proyección de vista (no persistida, no auditada como dato): `BuilderView` la calcula en el BFF.
3. **Dorsal en la raíz de causa.** `normalizePulseLiveMarket` toma la dorsal de `current_career_step.number` (fuente real, 34/34 en vivo), con fallback al top-level `rider.number` si el campo no existiera. `importMarket` rellena `riders.number` `NULL` con el valor normalizado (idempotente: solo cuando la BD es `NULL` y el normalizado no lo es; si la BD ya tiene valor se respeta).
4. **Backfill vía `market.import` (no SQL ad-hoc).** El import existente (ADR-0013, 2 pasos `fetch`→`import`) se extiende para rellener `NULL` de `teams.color`/`teams.text_color` y de `riders.number` sobre las filas ya creadas. Idempotente (re-ejecutar no muta valores ya presentes), auditado (`market.imported` incluye los contadores `colorBackfilled`/`numberBackfilled`; `rider.identity.backfilled` / `market.color.backfilled` para los rellenos).
5. **Picker consume color explícito con fallback.** `PickerAsset` gana `color?`/`textColor?` (opcionales → el helper `asset()` de tests sigue compilando). Núcleo puro nuevo `avatarPalette(asset)` → `{background, foreground}`: usa `asset.color` (y `textColor` como foreground) cuando existen, si no el hash `assetColor(name)`. El componente `asset-picker` renderiza desde `avatarPalette`. Sin cambiar ningún otro comportamiento (búsqueda, slots, bloqueo, precio).

## Consecuencias

- **El color se vuelve un dato de la fuente** (fidelidad real) con **fallback estético determinista** (hash) para cualquier activo sin color → compatibilidad total con datos anteriores y con ligas/fuentes futuras que no envíen color.
- **La dorsal deja de depender del payload top-level**: se fija en la normalización y se backfillea en BD; `BuilderView` ya la expone (ADR-0041), así que el picker la muestra sin cambio de vista.
- **El color de constructor es una proyección** (heurística sobre `teams`) documentada y testeada; si la fuente añadiera un color propio de constructor en el futuro, bastaría con añadirlo al normalizador y al `BuilderView` sin migración.
- **Sin cambio de reglas de juego** (no toca presupuesto, lineup, lockout, scoring, pricing, ligas) → no hay golden file de reglas afectado; sí una migración de esquema (2 columnas NULL-ables) y extensión de 3 vistas (`TeamView`/`ConstructorView`/`BuilderView`).
- **Cobertura:** el gate fusionado global sigue en 99.9% — las nuevas ramas (normalización de color/dorsal, relleno idempotente, `avatarPalette`, heurística de constructor) se cubren con tests unit (normalizador puro, `picker.ts` puro, service con `prisma` falso) e integración (import en PostgreSQL real).
- **GDPR/seguridad:** color y dorsal son datos de catálogo (no PII), no se añaden secrets ni cabeceras; el import sigue siendo `global_admin` (RBAC existente, ADR-0013).
