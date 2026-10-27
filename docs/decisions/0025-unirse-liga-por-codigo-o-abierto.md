# ADR-0025: Unirse a una liga por código o entrada abierta (US-25)

- **Estado:** Aceptado (2026-10-25) — implementado y verificado (núcleo puro + servicio + router + UI + tests; todas las puertas en verde: lint, typecheck, unit 669, UI 397, pureza, build, integración 365/365 y gate de cobertura 99.90% ≥ 99.9%)
- **Fecha:** 2026-10-25
- **Relacionado:** US-25 (backlog E6), ADR-0005 (modelo de ligas), ADR-0023 (creación de liga — el código y su rotación), ADR-0024 (liga pública — `type=public` ⇒ entrada abierta; visibilidad), `leagues.md` §2/§4/§6/§10 (tipos, invitaciones, unirse, anti-abuso; fuente de verdad), `security.md` §1.6 (rate-limiting y bloqueo temporal), T-09 (auditoría append-only), T-12 (IDOR).

## Problema

`leagues.md` define la entrada a las ligas:

> - **Pública:** "Abierta (con límite)" (§2).
> - **Privada:** "Solo por código/invitación" (§2).
> - **Unirse:** "con código o invitación, si hay plaza y la liga acepta entradas" (§6).
> - **Código:** "Permite unirse mientras la liga acepte entradas y no esté
>   llena"; "Límite de intentos de unirse por código (rate-limit) para evitar
>   fuerza bruta" (§4).
> - **Anti-abuso:** "un usuario no puede unirse a la misma liga dos veces"
>   (§4); "Rate-limiting en unión por código" (§10).

La CA de US-25: *"validaciones server-side con motivo explícito: 'código no
válido', 'la liga está llena', 'ya eres miembro', 'la liga no acepta
entradas'; rate-limiting por IP/usuario en el intento de unión (test de
fuerza bruta: N intentos fallidos → bloqueo temporal); unirse es
transaccional (plaza + membresía, test de concurrencia: dos usuarios por la
última plaza → solo uno entra)."*

Falta definir:

1. ¿Cómo se unifica la unión (pública abierta vs privada por código) en un
   solo endpoint?
2. ¿Qué significa "la liga no acepta entradas" exactamente (qué estados y
   configuraciones lo producen)?
3. ¿Dónde vive la regla de elegibilidad (pura y testable) y en qué orden
   se evalúan los motivos de rechazo?
4. ¿Cómo se protege la unión por código contra fuerza bruta (rate-limit +
   bloqueo) sin bloquear a usuarios legítimos de otras ligas?
5. ¿Cómo se garantiza que por la última plaza entre solo uno (concurrencia)?
6. ¿"Invitación" (título de US-25) incluye la invitación directa a un
   usuario concreto (`leagues.md` §4) o solo el código de invitación?

## Opciones

### 1. Forma del endpoint de unión

1. **Un endpoint `join({ leagueId?, code? })` con al menos uno de los dos
   (elegida):** la pública se une por `leagueId` (entrada abierta, ADR-0024);
   la privada por `code` (el código resuelve la liga — el extraño no conoce
   el `leagueId` porque el detalle de la privada es NOT_FOUND, US-24) o por
   `leagueId` + `code`. Un endpoint, una validación server-side, una
   auditoría.
2. Dos endpoints (`joinPublic` / `joinByCode`): duplica validaciones
   (plaza, membresía, estado) en dos sitios que pueden divergir (el bug que
   T-08 persigue).
3. Solo `join({ code })` para todo: la pública no tiene código (ADR-0024: el
   código sigue siendo secreto y solo del admin; la entrada pública es
   abierta) — no encaja con el flujo "ver la pública en el directorio y
   unirse".

### 2. "La liga no acepta entradas"

1. **`status ≠ active` (planned/finished/archived) O `type=private` +
   `entryMode=invite` O `type=private` + sin código activo (elegida):**
   cubre los tres casos reales: liga no operativa; liga "solo invitación
   directa" (sin código — la invitación directa a usuario concreto se difiere,
   ver §6); liga cuyo admin revocó todos los códigos.
2. Solo `status ≠ active`: deja un hueco — una privada `entryMode=invite`
   aceptaría uniones por código que no tiene (contradice "solo por
   invitación" y el modo que el creador eligió, US-23).
3. Un flag `acceptingEntries` en BD: duplica el estado real (status +
   entryMode + código activo) y puede desincronizarse.

### 3. Regla de elegibilidad pura y orden de rechazo

1. **`evaluateLeagueJoin(state, cfg)` en `leagues/core/join.ts` (elegida):**
   una función pura (sin I/O, auditada por el check de pureza T-03) que
   recibe el estado resuelto (rate-limit + liga + membresía + plazas) y
   devuelve la decisión con motivo. Orden de prioridad:
   `locked → rate_limited → not_accepting_entries → invalid_code →
   already_member → league_full → ok`. El servicio (I/O) resuelve el estado
   de la BD y consume la regla; el router no la duplica (T-08: una sola
   fuente), mismo contrato que `evaluateLoginAttempt` (US-01) y
   `canViewLeague` (US-24).
2. Duplicar la condición en el servicio: dos sitios que pueden divergir.
3. Poner "ya eres miembro" antes que "código no válido": un miembro que
   introduce un código erróneo debe saber que el código es el error (y el
   fallo cuenta para el anti fuerza bruta), no que ya está dentro.

### 4. Anti fuerza bruta en la unión por código

1. **Ventana fija por IP (todos los intentos) + bloqueo por IP tras N
   fallos de código consecutivos (elegida):** espejo exacto del patrón
   US-01 (login: ventana por IP + bloqueo por cuenta). Aquí la "cuenta" es
   la IP (dispositivo): `LEAGUE_JOIN_RATE_LIMIT_MAX` intentos por
   `LEAGUE_JOIN_RATE_LIMIT_WINDOW_SEC` (todos los intentos de unión) y
   `LEAGUE_JOIN_LOCKOUT_THRESHOLD` fallos de código → bloqueo
   `LEAGUE_JOIN_LOCKOUT_SEC` (aunque el código sea correcto). Solo el motivo
   "código no válido" cuenta como fallo (los demás — llena, miembro, no
   acepta — no son señal de fuerza bruta). El contador se resetea con la
   unión correcta.
2. Bloqueo por (liga, IP): más preciso, pero un atacante que no conoce la
   liga escapa del contador; y la clave compuesta complica el store sin
   beneficio medible (la ventana por IP ya limita la tasa global).
3. Bloqueo por usuario (cuenta): un atacante con cuentas nuevas no lo
   dispara; la IP (dispositivo) es la unidad de fuerza bruta real (mismo
   razonamiento que el login, donde la ventana es por IP).
4. Solo ventana por IP, sin bloqueo: la CA exige explícitamente "N intentos
   fallidos → bloqueo temporal".

### 5. Concurrencia de la última plaza

1. **`SELECT … FOR UPDATE` de la fila de la liga dentro de la transacción +
   recontar miembros + insertar (elegida):** patrón ya establecido en el
   módulo `results` (US-18/US-19: lock `FOR UPDATE` del GP serializa las
   importaciones). Dos uniones concurrentes por la última plaza: la primera
   bloquea la fila, cuenta, inserta y commitea; la segunda espera el lock,
   re-cuenta (ya ve el miembro) y rechaza "la liga está llena". El unique
   `(leagueId, userId)` de `LeagueMember` es el backstop anti-duplicado.
2. Contador `plazasRestantes` decrementado atómicamente: duplica el estado
   real (miembros) y hay que mantenerlo a mano en salida/expulsión/creación.
3. Dejarlo solo al unique `(leagueId, userId)`: no resuelve la plaza — dos
   usuarios distintos cabrían por encima de `maxMembers`.

### 6. Alcance de "invitación"

1. **Código de invitación en este US; invitación directa a usuario concreto
   diferida (elegida):** la CA de US-25 solo lista motivos de rechazo de
   código ("código no válido", …) y US-26 cubre el permiso de "invitar"
   ("invitar solo si el admin lo habilita"). `leagues.md` §4 describe la
   invitación directa como un mecanismo aparte ("un admin/miembro invita a un
   usuario concreto"). Una liga `entryMode=invite` no se puede unir en este
   US ("la liga no acepta entradas"): su entrada llegará con la invitación
   directa.
2. Implementar también la invitación directa ahora: dobla el alcance del US
   (nueva tabla de invitaciones por usuario, flujo de aceptación, permisos
   de US-26) sin que la CA lo exija.

## Decisión

### Arquitectura (US-25)

- **Núcleo puro** `evaluateLeagueJoin(state, cfg)` +
  `shouldLockLeagueJoin(failureCount, cfg)` en `leagues/core/join.ts` (sin
  I/O; auditado por el check de pureza T-03): decide con motivo
  (`locked | rate_limited | not_accepting_entries | invalid_code |
  already_member | league_full | ok`) y `retryAfterSec`.
- **Servicio** `LeagueService.joinLeague(input, meta)` (módulo `leagues`,
  I/O):
  1. Revalida el input server-side (`joinLeagueInputSchema`: `leagueId?` +
     `code?`, al menos uno).
  2. Registra el intento en la ventana por IP (si hay store inyectado).
  3. **Consulta el bloqueo por IP — PRIORIDAD TOTAL (espejo US-01): si la
     IP está bloqueada, lanza "Demasiados intentos fallidos." ANTES de
     resolver el código.** (Ver addendum: el orden original — resolver el
     código primero — esquivaba el bloqueo con un código erróneo.)
  4. Resuelve la liga: por el código (invite activa; si no existe/revocada
     o no coincide con `leagueId` → "El código no es válido." + registro de
     fallo) o por `leagueId` (inexistente → NOT_FOUND).
  5. Lee membresía activa, miembros activos y código activo de la liga.
  6. Aplica la regla pura; si rechaza por "código no válido", registra el
     fallo y, al alcanzar el umbral, bloquea la IP (y resetea el contador
     con la unión correcta).
  7. Transacción: `SELECT … FOR UPDATE` de la fila de la liga → recontar
     miembros activos (última plaza) → insertar membresía
     (`role=member`, `status=active`) → auditoría `league.joined`
     (`via: code | open`; el código NO se registra — secreto).
  8. Devuelve la `LeagueView` del actor (la UI redirige al detalle).
- **Rate limit** (módulo `identity`, frontera de I/O): `RateLimitStore`
  gana `recordLeagueJoinAttempt(ip, windowSec)`,
  `recordLeagueJoinFailure(ip)`, `resetLeagueJoinFailures(ip)`,
  `lockLeagueJoin(ip, lockoutSec)`, `leagueJoinLockRemainingSec(ip)` —
  implementaciones InMemory (tests) y Redis (producción, claves
  `rl:league:join:ip:*` / `rl:league:join:fail:*` / `rl:league:join:lock:*`).
  Parámetros operativos por env (no reglas de juego, AGENTS.md §1.3):
  `LEAGUE_JOIN_RATE_LIMIT_MAX` (10), `LEAGUE_JOIN_RATE_LIMIT_WINDOW_SEC`
  (60), `LEAGUE_JOIN_LOCKOUT_THRESHOLD` (5), `LEAGUE_JOIN_LOCKOUT_SEC` (900).
- **Router** `leagues` (BFF): `join` (`protectedProcedure` — unirse exige
  cuenta; el actor sale del contexto, AGENTS.md §8).
- **UI:**
  - **Nueva ruta** `/unirse`: formulario de código de invitación → `join` →
    redirección al detalle de la liga. (El extraño no ve el detalle de la
    privada — US-24 —, así que esta página es la puerta de entrada.)
  - `/ligas/[id]` (detalle): botón "Unirme a la liga" para ligas **públicas**
    (actor autenticado y no miembro); la vista gana `isMember`.
  - `/ligas`: enlace "¿Tienes un código de invitación? Únete a una liga" →
    `/unirse`.

### Semántica

- **Unión:** `protectedProcedure`; input `{ leagueId?, code? }` (al menos
  uno). Pública ⇒ entrada abierta por `leagueId` (ADR-0024); privada ⇒
  código activo (entryMode `code`/`mixed`); el código resuelve la liga.
- **Motivos de rechazo (BAD_REQUEST, español):** "La liga no acepta entradas."
  (status ≠ active; privada `entryMode=invite`; privada sin código activo) →
  "El código no es válido." (privada sin código o código no activo/de otra
  liga) → "Ya eres miembro de esta liga." (membresía activa) → "La liga está
  llena." (miembros activos ≥ máximos). Operativos: "Estás enviando
  demasiadas peticiones. Inténtalo de nuevo en N s." (ventana) y "Demasiados
  intentos fallidos. Inténtalo de nuevo en N s." (bloqueo).
- **Anti fuerza bruta:** ventana por IP en todos los intentos; bloqueo por IP
  tras N fallos de código consecutivos (solo "código no válido" cuenta);
  reset con la unión correcta.
- **Concurrencia:** lock `FOR UPDATE` de la fila de la liga + recontar dentro
  de la transacción → por la última plaza entra solo uno.
- **Auditoría:** `league.joined` (actor, liga, `via`, IP); el código no se
  registra (secreto, ADR-0023).
- **Invitación directa** a usuario concreto: diferida (US-26 y siguientes);
  una liga `entryMode=invite` no admite uniones en este US.

## Consecuencias

- `LeagueView` gana `isMember` (la UI decide si muestra el botón de unión;
  los tests/UI de US-23/US-24 que fijan la forma de la vista se actualizan —
  el resto de campos es compatible).
- `RateLimitStore` gana 5 métodos (InMemory + Redis); los tests del store
  Redis (`app/server/__tests__/rate-limit-redis.test.ts`) cubren las claves
  nuevas (gate de cobertura 99.9%).
- `env.ts` gana 4 variables operativas con defaults (sin romper despliegues
  existentes).
- US-26 (permisos) construye sobre la regla de acceso existente; la
  invitación directa (si se implementa) reutilizará `joinLeague` con un
  `via: invite` y el motivo "la liga no acepta entradas" dejará de aplicarse
  a `entryMode=invite` solo para el invitado concreto.
- La unión es `protectedProcedure`: un visitante anónimo debe iniciar sesión
  antes de unirse (la UI lo indica con enlace a `/login`).

## Validación

- **Unit (regla pura):** `evaluateLeagueJoin` (todas las ramas: bloqueo con
  prioridad, ventana, estado, modo de entrada, código, membresía, plaza,
  orden de motivos, `retryAfterSec`) y `shouldLockLeagueJoin` —
  `leagues/core/__tests__/join.test.ts`.
- **Integración:** unión pública (membresía + auditoría `league.joined`),
  privada con código válido, código inválido/revocado/de otra liga/sin código
  → "El código no es válido.", ya miembro → "Ya eres miembro de esta liga.",
  llena → "La liga está llena.", status ≠ active y `entryMode=invite` → "La
  liga no acepta entradas.", ventana N+1 → rate-limit, N fallos → bloqueo
  (el código correcto también se rechaza hasta que expira), **código
  erróneo también se rechaza con "Demasiados intentos fallidos" mientras la
  IP esté bloqueada** (test de regresión, ver addendum), reset del
  contador con éxito, **concurrencia: dos usuarios por la última plaza →
  solo uno entra**, router (sin sesión → UNAUTHORIZED; con sesión → OK) —
  `test/integration/leagues.test.ts`.
- **UI:** `/unirse` (formulario, error, redirección, sin sesión → enlace de
  login), detalle (botón de unión en pública no-miembro; oculto en miembro),
  `/ligas` (enlace a `/unirse`) — `app/ligas/__tests__/` +
  `app/unirse/__tests__/`.
- **Cobertura:** mantener el gate global fusionado 99.9% (T-24).

## Addendum 2026-10-27 — fix del orden del bloqueo (bug de verificación en prod)

**Problema.** La verificación E2E en producción (2026-10-25, 19/20 checks)
descubrió que el bloqueo por IP **no se aplicaba a un código erróneo**: la
IP bloqueada seguía recibiendo "El código no es válido." en lugar de
"Demasiados intentos fallidos." El orden implementado era —
resolver el código (paso 3 original; lanzaba directamente en el caso
erróneo) → consultar el bloqueo (paso 4 original) —, de modo que un código
erróneo nunca llegaba al check de bloqueo.

Esto contradecía la propia decisión de este ADR:

- la regla pura `evaluateLeagueJoin` declara orden `locked → … →
  invalid_code` (`locked` es prioridad 1);
- §4 "Anti fuerza bruta" lo define como "espejo exacto del patrón US-01"
  y el login (`evaluateLoginAttempt`/`auth-service.login`) consulta el
  bloqueo **antes** de verificar credenciales;
- §4: "bloqueo … (aunque el código sea correcto)" — la intención es que el
  bloqueo sea la restricción dominante.

Los tests de integración no lo detectaron porque solo cubrían el caso de
código **correcto** con la IP bloqueada (el código correcto sí pasaba por
la resolución y llegaba al check).

**Decisión (fix).** El check de bloqueo se mueve al **paso 3** (antes de
resolver el código), como en el login. El lanzamiento reutiliza
`joinRejection({ reason: "locked" })` (sin duplicar el mensaje) y la rama
`locked` de la llamada desde la regla pura queda inalcanzable por
construcción (`ipLockRemainingSec` es 0 al llegar allí — si no, ya se
habría lanzado). Test de regresión añadido: código erróneo con la IP
bloqueada → "Demasiados intentos fallidos.".

**Consecuencias.** El atacante pasa a estar limitado por el bloqueo (15
min) además de la ventana (10/60 s) también con códigos erróneos. Ventana
y fallos siguen por IP; sin cambios de esquema, envs ni API. Todas las
puertas en verde (lint, typecheck, unit 669, UI 397, integración 365,
build, cobertura 99.9% ≥ 99.9%).
