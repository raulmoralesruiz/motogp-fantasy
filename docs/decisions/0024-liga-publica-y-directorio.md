# ADR-0024: Liga pública y directorio (US-24)

- **Estado:** Aceptado (2026-10-25) — implementado y verificado (núcleo puro + servicio + router + UI + tests; todas las puertas en verde: lint, typecheck, unit 639, UI 379, pureza, build, integración 342/342 y gate de cobertura 99.91% ≥ 99.9%)
- **Fecha:** 2026-10-25
- **Relacionado:** US-24 (backlog E6), ADR-0005 (modelo de ligas), ADR-0022 (rankings por GP y general — los datos que se exponen), ADR-0023 (creación de liga — `getLeague` solo miembros; este ADR extiende el acceso), `leagues.md` §2/§9 (tipos y privacidad; fuente de verdad), `user-flows.md` pantalla 12 (directorio de ligas públicas), T-08 (RBAC por recurso).

## Problema

`leagues.md` §2 define la liga **pública** ("visible en directorio, entrada
abierta con límite") y §9 la privacidad:

> - **Ligas privadas/ocultas:** no aparecen en el directorio público; solo
>   accesibles con código/invitación.
> - **Ligas públicas:** visibles en el directorio; el ranking es público.
> - **Datos personales:** se muestra solo el nombre de usuario (seudónimo),
>   nunca email u otros PII.

La CA de US-24: *"la liga pública es visible en el directorio con ranking
público; la privada no aparece (test: un usuario no autenticado/miembro no la
ve ni puede acceder por ID)."*

US-23 (ADR-0023) implementó la creación (incluida la liga pública) y
`getLeague` **solo para miembros activos** (extraños → NOT_FOUND). Falta la
semántica de visibilidad pública que US-24 debe añadir:

1. ¿Qué es exactamente el "directorio" y qué ligas aparecen en él?
2. ¿Quién puede ver el detalle de una liga pública (¿autenticado o no)?
3. ¿Qué significa "el ranking es público" y qué datos se exponen?
4. ¿El código de una liga pública se hace público?
5. ¿Cómo se evita revelar la existencia de una liga privada (IDOR)?
6. ¿Dónde vive la regla de visibilidad (pura y testable)?

## Opciones

### 1. Contenido del directorio

1. **Ligas `type = public` y `status = active` (elegida):** `leagues.md` §2
   asocia "pública" con "visible en directorio"; el estado `active` es el
   operativo (ADR-0023: la liga queda `active` al crearse). Una pública
   `finished`/`archived` es histórico (accesible por ID si es pública) pero
   no descubre ligas nuevas. Orden por `name` (estable y predecible).
2. Todas las ligas `visibility = public` sin mirar `type`: `visibility` es un
   atributo de configuración (US-23 ya fuerza `type=public ⇒ visibility=public`
   y `type=private ⇒ visibility≠public`), así que filtrar por `type` es más
   directo y no deja hueco a una `private` mal configurada con `visibility=public`.
3. Solo ligas con ≥2 miembros: la CA no lo pide y penaliza la liga recién
   creada (el creador no vería su propia pública en el directorio hasta que
   entre otro).

### 2. Acceso al detalle de una liga

1. **`type = public` ⇒ cualquiera (autenticado o no); `type = private` ⇒ solo
   miembros activos (elegida):** es la regla de §9 literal ("las públicas:
   visibles …; las privadas: solo accesibles con código/invitación"). El actor
   es **opcional**: si hay sesión se usa para el rol (admin ⇒ código); si no,
   se ve la liga sin privilegios.
2. Exigir sesión para todo (solo `protectedProcedure`): contradice "visible en
   el directorio" para un visitante (la CA habla de "usuario no autenticado"
   como el que NO ve la privada, implicando que el no autenticado SÍ ve la
   pública).
3. Distinguir por `visibility` en vez de `type`: duplica la regla y deja
   inconsistencia con la validación de US-23 (que liga `type` y `visibility`).

### 3. "El ranking es público"

1. **Endpoint de solo lectura `ranking(leagueId, gpId?)` con la misma regla de
   acceso que el detalle (elegida):** expone la **última versión publicada**
   (US-21/ADR-0022: la más reciente por `computedAt`) de `rankings` — por GP o
   general — con **seudónimos** (`profiles.displayName ?? users.username`).
   Vacío elegante si aún no hay filas (precedente US-15).
2. Incluir el ranking dentro de `getLeague`: mezcla dos recursos (liga vs
   ranking) y obliga a recargar la liga para ver un GP concreto; un endpoint
   propio encaja con la pantalla 15 (ranking por GP / general).
3. Calcular el ranking al vuelo en la lectura: los rankings son DERIVADOS
   versionados (data-model.md §5, invariante 7): se leen, no se recalculan en
   la lectura (el recálculo es el job de US-18/US-19/US-21).

### 4. ¿El código de una liga pública es público?

1. **No: el código sigue siendo solo del admin (elegida):** `leagues.md` §5
   (revocar/generar código = admin) y §4 (el código es un secreto anti fuerza
   bruta). La entrada a una liga pública es **abierta** (US-25), no por
   código: el código existe para las privadas (`code`/`mixed`). Exponerlo
   rompería la propiedad "revocable" (un código público no se puede revocar
   de forma significativa).
2. Exponer el código en el detalle público: contradice ADR-0023 (secreto,
   nunca en auditoría ni a no-admins) y desincentiva la rotación.

### 5. Anti-revelación de ligas privadas (IDOR)

1. **NOT_FOUND idéntico a "no existe" (elegida):** un extraño (autenticado o
   no) que acceda por ID a una liga privada recibe el mismo `NOT_FOUND` que una
   liga inexistente: no se revela la existencia (leagues.md §9, US-24 CA,
   T-12 IDOR). Mismo patrón que US-23 (`getLeague`).
2. `FORBIDDEN` para extraños: revela que la liga existe (solo que no puede verla)
   — fuga de información que la CA prohíbe explícitamente.

### 6. Regla de visibilidad pura

1. **`canViewLeague` en `leagues/core` (elegida):** la regla "pública ⇒
   cualquiera; privada ⇒ miembro activo" es una regla de negocio: vive en el
   núcleo puro (sin I/O) y se unit-testa, mismo contrato que
   `generateLeagueCode`/`sortRanking` (ADR-0023, T-03). El servicio la
   consume; el router no la duplica.
2. Duplicar la condición en servicio y router: dos sitios que pueden
   divergir (el bug que T-08/T-12 persiguen).

## Decisión

### Arquitectura (US-24)

- **Núcleo puro** `canViewLeague({ type }, { isActiveMember })` en
  `leagues/core/visibility.ts` (sin I/O; auditado por el check de pureza T-03):
  `type = public → true`; `type = private → isActiveMember`.
- **Servicio** `LeagueService` (módulo `leagues`, I/O):
  - `listPublic()`: directorio — ligas `type=public`, `status=active`, orden
    `name asc`; devuelve resumen (nombre, descripción, min/máx, modo de
    entrada, miembros activos). Sin sesión.
  - `getLeague(leagueId, userId | null)`: **extiende** US-23 — pública ⇒
    cualquiera; privada ⇒ miembro activo (extraños → NOT_FOUND). El código
    sigue siendo solo del admin (leagues.md §5). La vista gana `members`
    (seudónimos + rol, solo miembros activos).
  - `leagueRanking(leagueId, gpId | null, userId | null)`: última versión
    publicada de `rankings` (por GP o general) con seudónimos; misma regla de
    acceso que el detalle; vacío elegante si no hay filas.
- **Router** `leagues` (BFF):
  - `listPublic` (`publicProcedure`, sin sesión).
  - `get` pasa de `protectedProcedure` a **`publicProcedure`** (el actor es
    opcional: `ctx.user?.id ?? null`).
  - `ranking` (`publicProcedure`, input `{ leagueId, gpId? }`).
  - `create`/`rotateCode`/`myLeagues` siguen `protectedProcedure` (mutaciones
    y datos propios).
- **UI:**
  - `/ligas`: sección "Directorio de ligas públicas" (lista + enlace al
    detalle) junto a "Mis ligas" (cada liga enlaza al detalle) y el formulario
    de creación (US-23).
  - **Nueva ruta** `/ligas/[id]` (detalle, pantalla 10): info de la liga,
    miembros (seudónimos, admin marcado), ranking general (vacío elegante) y
    panel de admin (código + "Rotar código") si el actor es admin. Ligas
    privadas a extraños → "La liga no existe." (NOT_FOUND).

### Semántica

- **Visibilidad:** `type = public` ⇒ el detalle y el ranking son públicos
  (autenticado o no); `type = private` ⇒ solo miembros activos; extraños
  (autenticados o no) → `NOT_FOUND` idéntico al inexistente (no se revela la
  existencia).
- **Directorio:** solo `type = public` y `status = active`; orden por nombre.
- **Ranking público:** la última versión publicada (US-21/ADR-0022) con
  seudónimos (`displayName ?? username`); nunca PII (leagues.md §9).
- **Código:** sigue siendo secreto y solo del admin, también en ligas públicas
  (la entrada pública es abierta, US-25).
- **Miembros expuestos:** solo miembros `active`, con seudónimo y rol
  (`admin`/`member`); nunca email.

## Consecuencias

- `get` pasa a ser público: los tests de US-23 que asumen "sin sesión →
  UNAUTHORIZED" para `get` se actualizan a "pública → OK sin sesión; privada →
  NOT_FOUND sin sesión".
- `LeagueView` gana `members` (los tests/UI de US-23 que fijan la forma de la
  vista se actualizan; el resto de campos es compatible).
- US-25 (unirse por código/invitación) construye sobre `listPublic`/`getLeague`
  (la liga ya es visible y su estado de plazas legible); US-26 (permisos)
  reutiliza la regla de acceso; US-28 (ranking por liga con UI) reutiliza
  `leagueRanking`.
- El núcleo `leagues/core` gana `visibility.ts` (auditado por T-03).
- El detalle de liga (`/ligas/[id]`) es la primera ruta dinámica de la app.

## Validación

- **Unit (regla pura):** `canViewLeague` (pública ⇒ cualquiera; privada ⇒
  solo miembro activo; no miembro ⇒ no) — `leagues/core/__tests__/visibility.test.ts`.
- **Integración:** `listPublic` (solo públicas activas; excluye privadas,
  finished y unlisted), `getLeague` (pública sin sesión OK + código null;
  pública como miembro admin ⇒ código; privada sin sesión → NOT_FOUND; privada
  como extraño autenticado → NOT_FOUND; privada como miembro → OK),
  `leagueRanking` (pública sin sesión ⇒ filas con seudónimos; privada a extraño
  → NOT_FOUND; privada a miembro → OK; sin filas → vacío), router (glue BFF:
  `listPublic`/`get`/`ranking` sin sesión; `get` de privada sin sesión →
  NOT_FOUND) — `test/integration/leagues.test.ts`.
- **UI:** directorio (lista, vacío, error, enlaces), detalle (info, miembros,
  ranking, panel de admin con rotación, NOT_FOUND) —
  `app/ligas/__tests__/`.
- **Cobertura:** mantener el gate global fusionado 99.9% (T-24).
