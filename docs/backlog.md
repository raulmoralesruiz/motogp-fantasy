# Backlog

> Estado: BORRADOR v1 (fase 5). El backlog descompone el `roadmap.md` en epics, user stories y tareas técnicas, con **criterios de aceptación verificables**, dependencias y prioridades.
>
> **Convenciones:**
>
> - **IDs:** `US-xx` (user story), `T-xx` (tarea técnica), `D-xx` (decisión/calibración por cerrar).
> - **Prioridad:** `P0` = crítico para el MVP (sin esto no hay producto) · `P1` = incluido en el MVP · `P2` = post-MVP.
> - **Criterios de aceptación (CA):** deben ser verificables (un test, un comportamiento observable o un número). Si un CA no se puede verificar, no está bien escrito.
> - Los valores `PROVISIONAL` (B=100, carry 25%/máx 8, tablas de puntuación, etc.) se toman de `product/economy.md` y `product/scoring.md`; se calibran en las tareas `D-xx` antes del lanzamiento.
> - **Definition of Done (todas las historias):** código + tests (unit/integración según capa), validación server-side si afecta a presupuesto/lineup/permisos, auditoría si es acción sensible, docs actualizadas si cambia una regla, sin errores de lint/typecheck.

## Mapa de epics ↔ fases del roadmap

| Epic   | Contenido                             | Fase roadmap | Prioridad         |
| ------ | ------------------------------------- | ------------ | ----------------- |
| **E1** | Fundaciones y módulos puros           | Fase 0       | P0                |
| **E2** | Identidad y admin global              | Fase 1       | P0                |
| **E3** | Temporada y mercado                   | Fase 1       | P0                |
| **E4** | Lineups y economía en juego           | Fase 2       | P0                |
| **E5** | Resultados y puntuación               | Fase 3       | P0                |
| **E6** | Ligas                                 | Fase 4       | P0                |
| **E7** | Endurecimiento y lanzamiento MVP      | Fase 5       | P0/P1             |
| **E8** | Post-MVP                              | Fases 6–9    | P2                |
| **D**  | Decisiones y calibraciones por cerrar | Transversal  | P1 (antes de MVP) |
| **X**  | Tareas técnicas transversales         | Transversal  | P0/P1             |

---

## E1 — Fundaciones y módulos puros (Fase 0)

> **Regla de oro:** `economy` y `scoring` se implementan y testean **antes** de cualquier UI. Son el corazón del producto (ver `roadmap.md`, camino crítico).

### Plan de ejecución de Fase 0 (WP)

> Las **WP (work packages)** son lotes de entrega para ejecutar la Fase 0: tareas agrupadas por
> contexto, verificadas juntas (lint + typecheck + tests + build en verde) y reportadas como una unidad.
> El orden de ejecución lo define el grafo de dependencias (campo "Dep:"), **no** la numeración de las
> tareas (los números siguen el epic donde se redactó cada tarea: E1 = T-01…T-07, X transversal = T-18…T-22).
>
> Nota: T-04/T-05 (módulos puros) se implementaron antes de Fase 0 — son el corazón del producto y sus
> tests validaron el diseño económico (simulación 2026). T-03 aporta el check que garantiza su pureza.

| WP  | Tareas                                                                                                                                      | Estado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| WP1 | T-01 (bootstrap)                                                                                                                            | ✅ cerrado (2026-10-14): app + API + CI v1 + health-check verificado en vivo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| WP2 | T-03 (estructura de módulos + check de dependencias) · T-18 (validación Zod compartida) · golden files por versión de reglas (`testing.md`) | ✅ cerrado (2026-10-14): estructura de módulos + `shared/`; check de pureza por AST cableado en build y CI (falla con exit 1, verificado con violación real); `seasonRulesSchema` + `PROVISIONAL_SEASON_RULES` (tests de parseo y rechazo en español); golden files `economy-v1`/`scoring-v1` (94 tests en verde)                                                                                                                                                                                                                                                                                                                    |
| WP3 | T-06 (schema Prisma completo) · T-07 (spike Testcontainers) · T-22 (fixtures)                                                               | ✅ cerrado (2026-10-14): schema 28 modelos + 22 enums con constraints duros (trigger de composición + 8 uniques + índice P0 + vista `price_history`); integración Testcontainers (1 contenedor/run, `migrate deploy`, 18 tests en verde < 30 s); dataset ficticio canónico `economy.md` §7 en `test/fixtures/fiction/` (mercado/jugadores/resultados anonimizados, loader Prisma, simulación B/E + CLI `simulate:fiction`, golden de trayectorias exactas §7.3/§7.4; 99 unit + 18 integración en verde)                                                                                                                              |
| WP4 | T-02 (CI/CD completo + deploy) · T-19 (secrets)                                                                                             | ✅ cerrado (2026-10-14): CI con coverage gate (90% economy/scoring, global calibrado a 60% — D-08) + job `docker build` + gitleaks + dependabot; deploy **modelo pull** en TrueNAS Scale (sin IP pública ⇒ CI no deploya): `Dockerfile` multi-stage (standalone), `docker-compose.prod.yml` (web+postgres+redis, healthchecks, bind-mounts en `/mnt/data-nas/motogp/`), `deploy.sh` (pull→build→migraciones→up→health-check), `.env.prod.example` + runbook `docs/operations/deploy.md` (deploy key SSH read-only, NPM `motogp:81`/`motogp.raulmorales.eu` → `192.168.1.3:22020`). Worker fuera de alcance (módulo `jobs` pendiente) |

### Tareas técnicas

- **T-01 · Bootstrap del repositorio** — `P0` — Dep: ninguna.
  Stack: TypeScript estricto, Next.js (App Router), PostgreSQL, Prisma, Zod, tRPC, BullMQ+Redis.
  - CA: `npm run dev` arranca app + API; Prisma genera tipos; un endpoint tRPC de ejemplo responde; CI en verde.

- **T-02 · CI/CD (GitHub Actions)** — `P0` — Dep: T-01.
  - CA: en cada PR corren lint + typecheck + unit + **coverage gate** (≥90% economy/scoring; global PROVISIONAL, D-08) + integración (Testcontainers) + build + **build de la imagen Docker** y **bloquean el merge** si fallan; dependabot activo. **Deploy: modelo pull** (el TrueNAS no tiene IP pública): `./deploy.sh` desde el servidor (git pull → build → migraciones → up → health-check), documentado en `docs/operations/deploy.md`.

- **T-03 · Estructura de módulos** — `P0` — Dep: T-01.
  - CA: los 10 módulos + `shared/` existen según `architecture/overview.md` §3; hay un check (lint o test) que falla si `economy` o `scoring` importan I/O (fs, db, http) o módulos no permitidos.

- **T-04 · Módulo `economy` puro** — `P0` — Dep: T-03.
  Funciones puras: `presupuesto(gp) = B + min(t·sin_usar_previo, cmax)`; motor de precios v1 (objetivo ponderado 50/30/20, suavizado, acotaciones `[0.85,1.15]·prev` y `[0.25,2.0]·P0`, regla de lesión).
  - CA (tests de unit con I/O verificable, ver `testing.md` §2.1):
    - `presupuesto(B=100, t=0.25, cmax=8, sin_usar=8)` → `102`.
    - `sin_usar=40` → `carry=min(10,8)=8` → `108` (tope aplicado).
    - Precio: `P0=20, prev=20, W=50` → `objetivo=20` → `precio=20`.
    - Lesión: `P0=20, prev=20` → `max(5,10)=10`.
    - Acotación: ningún precio sale de `[0.25·P0, 2.0·P0]` (property-based o casos extremos).
  - Cobertura ≥ 90%.

- **T-05 · Módulo `scoring` puro** — `P0` — Dep: T-03.
  Funciones puras: tablas Q2/sprint/GP, bonos, penalizaciones, oro 100%/plata 50%, constructor/equipo = media top-2, sin doble conteo.
  - CA (tests de unit):
    - El ejemplo completo de `scoring.md` §5 (lineup {A,C oro; E,H plata; X; X-team}) → **170.5 puntos**, con desglose idéntico al documento.
    - DNF: 0 por posición + (−5) **una sola vez por GP**; non-starter: 0 sin penalización.
    - Sprint + GP: ambos puntúan y se suman.
    - Constructor/equipo con <2 pilotos: media sobre los disponibles.
  - Cobertura ≥ 90%.

- **T-06 · Migraciones iniciales (schema base)** — `P0` — Dep: T-01.
  - CA: el schema de `architecture/data-model.md` existe en Prisma; las migraciones se aplican en orden; los constraints duros existen en BD: `lineup_slots` (exactamente 2 gold + 2 silver + 1 constructor + 1 team), `lineups` unique `(user, gp)`, `results` unique `(gp, event, rider)`, `prices` unique `(asset_type, asset_id, gp)`, `rider_affiliations` unique `(rider, gp)`, `league_members` unique `(league, user)`, `season_rules` unique `(season, version)`.

- **T-07 · Spike de integración (Testcontainers)** — `P0` — Dep: T-06.
  - CA: un test de integración corre contra PostgreSQL real en CI y completa una transacción (insert + rollback) en < 30 s.

---

## E2 — Identidad y admin global (Fase 1)

### User stories

- **US-01 · Me registro con email + contraseña + nombre de usuario** — `P0` — Dep: E1.
  - CA: el nombre de usuario es único (rechazo explícito si existe); la contraseña se guarda con hash argon2 (nunca en claro, verificado inspeccionando la BD); la sesión usa cookie `HttpOnly+Secure+SameSite=Lax`; login con rate-limiting y bloqueo temporal tras N intentos fallidos (test de seguridad).

- **US-02 · Inicio de sesión, cierre y recuperación de contraseña** — `P0` — Dep: US-01.
  - CA: el token de recuperación es de uso único y expira (test: reutilizarlo falla); cerrar sesión revoca la sesión en BD.

- **US-03 · Perfil: datos, exportación y eliminación de cuenta** — `P1` — Dep: US-01.
  - CA: el usuario puede exportar sus datos (lineups, puntos, ligas) en formato legible; al eliminar la cuenta: se anonimiza (seudónimo → "Usuario eliminado", email borrado), se retira de todas las ligas y su histórico se anonimiza (ver `security.md` §1.11, política `D-06`).

- **T-08 · RBAC y autorización por recurso** — `P0` — Dep: US-01.
  Roles: `user`, `global_admin` (globales) + admin de liga (vive en `league_members.rol`).
  - CA: un `user` no accede al panel de admin (403, test de integración); cada endpoint revalida permisos server-side (suite IDOR: un usuario no lee/modifica el lineup o la liga de otro — todas las acciones rechazadas).

- **T-09 · Auditoría (audit_log append-only)** — `P0` — Dep: T-06.
  - CA: las acciones sensibles (precios manuales, reglas, resultados, recálculos, sanciones, roles, gestión de ligas) crean una entrada con actor/acción/entidad/antes/después/IP/timestamp; la app no puede actualizar ni borrar entradas (verificado por test).

### User stories (admin)

- **US-04 · El admin crea una temporada con sus reglas** — `P0` — Dep: E1.
  - CA: la temporada guarda una `season_rules` versionada (JSONB: B, t, cmax, tablas de puntuación, límites, `rules_version`); crear una segunda versión no muta la primera (unique `(season, version)`, test).

- **US-05 · El admin añade GPs, circuitos y eventos** — `P0` — Dep: US-04.
  - CA: cada GP tiene orden, circuito y eventos (Q1/Q2/sprint opcional/race); el estado del GP transita `scheduled → locked → finished/cancelled` y solo el admin lo cambia (auditado).

- **US-06 · El admin monta el mercado (pilotos, constructores, equipos, afiliaciones)** — `P0` — Dep: US-05.
  - CA: constructor y equipo son entidades distintas (un equipo pertenece a exactamente un constructor); la afiliación es **por GP** (unique `(rider, gp)`): un cambio de equipo a mitad de temporada no altera GPs anteriores (test).

- **US-07 · El admin fija precios de apertura (P0) y ve el histórico** — `P0` — Dep: US-06.
  - CA: cada activo (piloto/constructor/equipo) tiene un P0 publicado; el histórico de precios es público y completo por activo (una fila por GP, unique `(asset_type, asset_id, gp)`).

- **US-08 · Precios actualizados por fórmula + ajuste manual** — `P0` — Dep: US-07, T-04.
  - CA: tras cada GP definitivo, el job aplica la fórmula v1 y registra cada movimiento (motivo `formula`); un ajuste manual queda registrado con motivo `manual` + actor (auditoría); **los precios no cambian durante el lockout** (test: intentar actualizar en lockout no modifica la BD).

---

## E3 — (contenido de E3 incluido en US-04…US-08 arriba)

> Nota editorial: E3 se documenta junto a E2 porque comparten la Fase 1; el split se mantiene en el roadmap.

---

## E4 — Lineups y economía en juego (Fase 2)

### User stories

- **US-09 · Compongo y guardo mi lineup (2+2+1+1)** — `P0` — Dep: E2, E3, T-04.
  - CA (todos server-side, verificados por tests de integración):
    - Composición exacta: 2 oro + 2 plata + 1 constructor + 1 equipo; cualquier desviación → rechazado con motivo.
    - Coste ≤ presupuesto (recalculado en el servidor con precios congelados; el cliente no envía coste ni presupuesto de confianza — test de seguridad).
    - Coste exacto = presupuesto → aceptado; coste = presupuesto + 0.01 → rechazado con motivo "excede presupuesto por X".
    - Límite de concentración (PROVISIONAL: máx 2 por constructor, máx 2 por equipo) → rechazado con motivo.
    - Un usuario tiene a lo sumo 1 lineup activo por GP (unique `(user, gp)`).
    - Confirmación: "Lineup guardado para GP X. Cambios restantes: N."

- **US-10 · Veo mi presupuesto (base + carry) y el coste en tiempo real** — `P0` — Dep: US-09.
  - CA: el presupuesto mostrado es `B + min(t·sin_usar_previo, cmax)` y coincide con el que el servidor valida (test: mismo input → mismo valor); **nunca depende del valor de mercado del equipo** (test: con el mismo `sin_usar`, el presupuesto es idéntico aunque los precios de mis activos suban/bajen — este es el anti-ratchet, la ventaja central del producto).

- **US-11 · Reasigno oro/plata gratis** — `P0` — Dep: US-09.
  - CA: cambiar oro↔plata no consume cambio ni cambia el coste; durante el lockout se bloquea (motivo explícito).

- **US-12 · Hago transfers (2/GP + exención + wildcard) y veo el historial** — `P0` — Dep: US-09.
  - CA: cada cambio (add/remove/swap) consume 1 de los 2 cambios del GP; agotados → rechazado con "no te quedan cambios; usa tu wildcard"; exención por lesión confirmada: +1 cambio gratuito; 1 wildcard por temporada resetea el lineup completo; el historial de cambios es visible y auditable (quién/cuándo/qué/coste antes-después).

- **US-13 · El lockout cierra el GP (server-side)** — `P0` — Dep: US-09.
  - CA: desde el inicio de Q1 hasta la publicación de resultados definitivos: sin cambios de lineup, sin reasignación oro/plata, sin cambios de precio; un intento tras el cierre se rechaza **incluso bajo concurrencia** (test de carga: N usuarios guardando en la ventana de cierre → ninguno se aplica tras el cierre); el lockout es global por usuario (multi-liga: un único cierre por GP).

- **US-14 · Exploro el mercado (lista, detalle, histórico, tendencia)** — `P1` — Dep: US-07.
  - CA: lista filtrable por constructor/equipo/rango de precio; cada activo muestra precio actual, tendencia (sube/baja/estable) y mini-histórico; el detalle muestra el histórico completo (gráfico) y la concentración (popularidad, según privacidad).

- **US-15 · Dashboard (próximo GP, presupuesto, ranking, avisos)** — `P1` — Dep: US-09.
  - CA: muestra próximo GP con cuenta atrás a lockout, presupuesto disponible, coste del lineup, posición en cada liga y avisos (recálculo, lockout); usable en viewport móvil (Playwright).

---

## E5 — Resultados y puntuación (Fase 3)

### User stories

- **US-16 · El admin importa resultados manualmente** — `P0` — Dep: E2, E3.
  - CA: importación por evento (Q2/sprint/race) con validación (Zod) de posiciones/bonos/penalizaciones; cada entrada queda auditada (quién/cuándo/valores); entra como **provisional**; disponible siempre, como respaldo de cualquier fuente.

- **US-17 · Importación automática vía PulseLive (adapter)** — `P0` — Dep: US-16, T-06.
  Contrato `ResultsSource` de `integrations.md` §1.
  - CA: tests de contrato con fixtures grabadas (normaliza correctamente; maneja errores/timeouts); idempotente (re-importar no duplica, test de integración); mapeo `riderRef → riders.id` con alerta de "sin mapear" que requiere acción del admin; el job hace polling (PROVISIONAL: 5 min) solo durante el fin de semana; si la fuente falla N veces, se alerta al admin.

- **US-18 · Paso de provisional a definitivo** — `P0` — Dep: US-16/US-17.
  - CA: el admin marca el resultado definitivo (o la fuente lo indica); al hacerlo se dispara el recálculo; hasta entonces el ranking muestra estado "provisional".

- **US-19 · Recálculo auditable y versionado** — `P0` — Dep: US-18, T-05.
  - CA: corregir un resultado (p. ej. penalización posterior, DQ) → se recalcula el GP completo con la **misma** `rules_version`, se genera una nueva `results_version` y `results_history` conserva anterior→nuevo (test de integración); el usuario ve el aviso "Resultados actualizados" con el histórico; **re-importar el mismo resultado no duplica puntos** (test: importar 2 veces → 1 fila, mismos puntos).

- **US-20 · Veo mi puntuación con desglose** — `P0` — Dep: US-19.
  - CA: el desglose muestra por piloto (Q2/sprint/GP/bonos/penal), constructor y equipo, con pesos oro/plata; el total coincide con el módulo `scoring` (test: el ejemplo de `scoring.md` §5 → 170.5, replicado contra datos reales importados en un GP de test).

- **US-21 · Rankings por GP y general** — `P0` — Dep: US-20.
  - CA: ranking por GP (puntos de ese GP) y general (acumulado) derivados de `scores` (recalculables); desempates en el orden de `leagues.md` §8 (más GPs ganados → mejor último GP → menor coste total → antigüedad) (test de unit de desempates).

- **US-22 · Pantallas de resultados y ranking** — `P1` — Dep: US-20, US-21.
  - CA: el usuario ve su posición, el delta vs el GP anterior y el desglose; si hubo recálculo, ve el aviso + histórico; GP cancelado → "GP cancelado, 0 puntos" para todos.

### Tareas técnicas

- **T-10 · Job de recálculo con lock por GP** — `P0` — Dep: US-19.
  - CA: un solo recálculo a la vez por GP (advisory lock, test de concurrencia: 2 jobs simultáneos → se serializan, sin duplicados); rendimiento: GP completo (todos los pilotos/eventos, 1000 lineups) recalculado en < 30 s (test de carga).

---

## E6 — Ligas (Fase 4)

### User stories

- **US-23 · Creo una liga privada con código** — `P0` — Dep: E5.
  - CA: el creador define nombre/descripción/tipo/visibilidad/min-máx (PROVISIONAL: 2–50)/modo de entrada/duración; el creador es admin; el código generado tiene ≥8 caracteres de alta entropía (sin 0/O/1/I) y es revocable (generar uno nuevo invalida el anterior, test).

- **US-24 · Creo una liga pública y aparece en el directorio** — `P0` — Dep: US-23.
  - CA: la liga pública es visible en el directorio con ranking público; la privada no aparece (test: un usuario no autenticado/miembro no la ve ni puede acceder por ID).

- **US-25 · Me uno a una liga por código o invitación** — `P0` — Dep: US-23.
  - CA: validaciones server-side con motivo explícito: "código no válido", "la liga está llena", "ya eres miembro", "la liga no acepta entradas"; rate-limiting por IP/usuario en el intento de unión (test de fuerza bruta: N intentos fallidos → bloqueo temporal); unirse es transaccional (plaza + membresía, test de concurrencia: dos usuarios por la última plaza → solo uno entra).

- **US-26 · Permisos de liga (admin/miembro)** — `P0` — Dep: US-23.
  - CA: solo el admin expulsa, cambia configuración, revoca código, cierra la liga o transfiere el rol (tests de integración: un miembro intenta cada acción → 403); invitar solo si el admin lo habilita.

- **US-27 · Salir, ser expulsado o cierre de liga (histórico conservado)** — `P1` — Dep: US-26.
  - CA: al salir/expulsar: el miembro queda marcado `left`/`kicked`, su histórico de puntos **se conserva** en el ranking (marcado "retirado"/"expulsado") y el ranking de los demás no se recalcula hacia atrás (test); al cerrar la liga, los lineups de los miembros se liberan (pueden seguir en otras ligas).

- **US-28 · Ranking por liga con desempates** — `P0` — Dep: US-21, US-23.
  - CA: cada liga tiene su ranking (GP y general) sobre sus miembros activos; los desempates aplican en el orden definido (test de unit).

- **US-29 · Juego en varias ligas con el mismo lineup** — `P0` — Dep: US-28.
  - CA: un usuario en 2+ ligas tiene **un único lineup por GP** y los **mismos puntos** en todas las ligas (test de integración: los `scores` son por `(user, gp)`; los `rankings` por `(league, user, gp)` con valores idénticos).

- **US-30 · Me uno a mitad de temporada** — `P1` — Dep: US-29.
  - CA: empieza con 0 puntos desde su primer GP activo en esa liga; no hereda puntos de GPs previos; opción "ranking ajustado" (solo GPs desde la última entrada) configurable por liga, desactivado por defecto (`D-10`).

- **US-31 · Liga de bienvenida** — `P1` — Dep: US-24.
  - CA: al registrarse, el usuario queda en una liga pública de bienvenida (creada/operada por el admin) para no empezar solo.

---

## E7 — Endurecimiento y lanzamiento MVP (Fase 5)

### Tareas técnicas

- **T-11 · Suite de tests completa** — `P0` — Dep: E1–E6.
  - CA: las 7 capas de `testing.md` (unit/integración/contrato/e2e/regresión/carga/seguridad) pasan en CI; los casos límite obligatorios de `testing.md` §3 están cubiertos (tabla de 12 casos, cada uno con un test nombrado).

- **T-12 · Revisión de seguridad** — `P0` — Dep: T-11.
  - CA: suite de seguridad verde: IDOR (lineups/ligas de otros), fuerza bruta (login + códigos de liga), inyección (inputs maliciosos sanitizados), presupuesto (el cliente no puede inyectar coste/presupuesto — se recalcula server-side); 0 hallazgos críticos abiertos.

- **T-13 · Backups + prueba de restore** — `P0` — Dep: T-02.
  - CA: backups automáticos de PostgreSQL (diarios; retención PROVISIONAL 30 días diarios + 12 meses mensuales, `D-11`… ver `security.md` §1.10); un restore real desde backup se ejecuta y documenta en el runbook (datos íntegros tras el restore, verificado por checksum/consulta).

- **T-14 · Monitoreo** — `P1` — Dep: T-02.
  - CA: Sentry captura errores con contexto; métricas de los jobs (import, recalcular, precios) con alerta de fallo; el health-check de la fuente de datos (PulseLive) alerta si deja de responder.

- **T-15 · Re-simulación económica con parámetros finales** — `P0` — Dep: D-01, D-02.
  - CA: la simulación de `economy.md` §7 se re-ejecuta con los parámetros definitivos y produce: Gini < 0.05, ratio de recuperación del peor arranque > 0.95, diversidad de lineups > 70%, concentración < 40% (métricas de `economy.md` §6); el informe queda en el repo.

- **T-16 · Verificación responsive** — `P1` — Dep: E4, E5.
  - CA: Playwright en viewport móvil (360–430 px): el constructor de lineup es usable en una mano (todas las acciones del flujo central alcanzables sin zoom); dashboard y rankings legibles.

- **T-17 · Documentación de operaciones (runbook)** — `P1` — Dep: T-13, T-14.
  - CA: runbook cubre: deploy, importar resultados (auto/manual), marcar definitivo, forzar recálculo, restore de backup, incidente de datos (qué hacer si un resultado es incorrecto), rotación de secrets.

- **US-32 · Criterios de aceptación del MVP** — `P0` — Dep: todo lo anterior.
  - CA: los 10 criterios de `product/mvp.md` §5 verificados uno a uno (registro→primer lineup <2 min; dos usuarios compiten en la misma liga; presupuesto nunca ratchet (test); idempotencia (test); corrección con histórico (test); lockout server-side (test); multi-liga (test); admin crea temporada/importa/recalcula; Gini < 0.05 (T-15); móvil usable (T-16)).

---

## E8 — Post-MVP (Fases 6–9) — `P2`

- **US-33 · Fuente licenciada (Sportradar) como adapter** — Dep: E5.
  - CA: implementa el mismo contrato `ResultsSource`; tests de contrato comunes verdes; SLA contractual verificado antes de depender de ella (`integrations.md` §2.2: **no verificada contractualmente**).
- **US-34 · Backfill histórico con bases comunitarias** — Dep: US-33.
  - CA: temporadas pasadas importables y puntuables con la versión de reglas declarada; cross-check contra la fuente primaria.
- **US-35 · Ligas temporales y personalizadas** — Dep: E6.
  - CA: reutilizan el motor de ligas (ventana de fechas, reglas de membresía a medida) sin tocar las reglas globales de juego.
- **US-36 · Notificaciones (push/email)** — Dep: E5.
  - CA: notificación al publicarse resultados definitivos y al aplicar un recálculo.
- **US-37 · Estadísticas avanzadas y analítica** — Dep: E5.
  - CA: histórico de puntos por piloto/activo; métricas de uso (activación, retención, ligas activas de `vision.md` §6).
- **US-38 · Demand-driven (torneos, draft, API pública, temas)** — Dep: señal de demanda (`mvp.md` §4).
  - CA: solo se planifica con peticiones reales de usuarios/organizadores.

---

## D — Decisiones y calibraciones por cerrar (transversal)

> Cada una remite a la "decisión pendiente" del documento de origen. Se cierran **antes del lanzamiento del MVP** salvo indicación.

| ID       | Decisión                                                                                   | Origen                                 | Prioridad | Criterio de cierre                                                                                                             |
| -------- | ------------------------------------------------------------------------------------------ | -------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **D-01** | Valores definitivos de `B`, `t`, `cmax` (prov. 100 / 0.25 / 8)                             | `economy.md` §4.1, `vision.md` §8      | P0        | Re-simulación (T-15) con los valores elegidos alcanza las métricas de `economy.md` §6; decisión registrada como ADR o addendum |
| **D-02** | Tablas de puntuación definitivas + calibración de `Pmax` con datos reales de una temporada | `scoring.md` §8, `economy.md` §4.3     | P0        | Tablas fijadas en `season_rules` v1; `Pmax` recalibrado; golden files actualizados y revisados                                 |
| **D-03** | Límites de concentración (prov. máx 2 por constructor/equipo)                              | `economy.md` §4.4, `game-rules.md` §11 | P1        | Valor fijado + test de validación + métrica de concentración < 40% en re-simulación                                            |
| **D-04** | Política exacta de transfers (nº por GP, exención, wildcard)                               | `game-rules.md` §5, `vision.md` §8     | P1        | Política fijada por temporada + tests de US-12                                                                                 |
| **D-05** | Límite exacto de miembros por tipo de liga (prov. 2–50)                                    | `leagues.md` §12                       | P2        | Valores por tipo fijados en config                                                                                             |
| **D-06** | Política de retención/anonimización al eliminar cuenta (GDPR)                              | `security.md` §5, `leagues.md` §9      | P1        | Política documentada + test de US-03 + registro legal                                                                          |
| **D-07** | 2FA para `global_admin` (recomendado: sí)                                                  | `security.md` §5                       | P1        | Implementado o decisión registrada                                                                                             |
| **D-08** | Umbrales de cobertura (prov. 90% economy/scoring, 70% global)                              | `testing.md` §6                        | P2        | Umbrales fijados en CI                                                                                                         |
| **D-09** | Frecuencia de polling (prov. 5 min) y uso de webhooks si la fuente lo ofrece               | `integrations.md` §7                   | P2        | Frecuencia fijada + test de contrato                                                                                           |
| **D-10** | Si el "ranking ajustado" se activa por defecto en algún tipo de liga                       | `leagues.md` §12                       | P2        | Decisión registrada + test de US-30                                                                                            |
| **D-11** | Retención de backups y logs (prov. 30 días diarios + 12 meses mensuales)                   | `security.md` §1.10, §5                | P1        | Retención fijada en infraestructura + runbook                                                                                  |
| **D-12** | Bono "resultado extraordinario" y "posiciones ganadas" (mantener/retirar/ajustar)          | `scoring.md` §8                        | P1        | Decisión en la tabla v1 definitiva (D-02)                                                                                      |
| **D-13** | Constructor/equipo: media top-2 vs otro esquema                                            | `scoring.md` §8, `game-rules.md` §11   | P1        | Esquema fijado + módulo scoring + golden files                                                                                 |

---

## X — Tareas técnicas transversales

- **T-18 · Validación compartida (Zod)** — `P0` — Dep: T-01.
  - CA: un único esquema Zod por entidad/acción usado en cliente y servidor; el servidor revalida todo input (test: payload malformado → 400 con motivo; el cliente no puede saltarse validaciones).
- **T-19 · Gestión de secrets** — `P0` — Dep: T-01.
  - CA: ningún secret en el repo (check en CI: escaneo de secretos); credenciales de BD, clave de sesión y claves de fuentes en vault/variables de entorno; procedimiento de rotación documentado.
- **T-20 · Cabeceras de seguridad y transporte** — `P1` — Dep: T-01.
  - CA: HTTPS/HSTS obligatorio; `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (o CSP frame-ancestors), CSP básica, `Referrer-Policy`; CORS restringido al origen de la app (tests de integración HTTP).
- **T-21 · Higiene de dependencias** — `P1` — Dep: T-02.
  - CA: `npm audit` en CI con umbral de vulnerabilidades; dependabot activo; sin dependencias sin justificar.
- **T-22 · Datos de test y fixtures** — `P0` — Dep: T-07.
  - CA: fixtures de resultados anonimizados en el repo (para contrato/integración); el dataset ficticio de `economy.md` §7 disponible como fixture de la simulación; **nunca PII ni datos reales de usuarios en tests** (check en CI o revisión).

---

## Mapa de dependencias (resumen)

```
E1 (T-01…T-07, módulos puros)
 ├─► E2 (US-01…US-03, T-08, T-09)
 │    └─► E3 (US-04…US-08, mercado + precios)
 │         └─► E4 (US-09…US-15, lineups + economía)  ← requiere T-04 (economy)
 │              └─► E5 (US-16…US-22, T-10)           ← requiere T-05 (scoring)
 │                   └─► E6 (US-23…US-31, ligas)
 │                        └─► E7 (T-11…T-17, US-32)  ← requiere D-01/D-02 (calibración)
 └─► X (T-18…T-22, transversal: arranca con E1)
E8 (post-MVP) ← E5/E6 + tracción
```

**Camino crítico:** T-04/T-05 (módulos puros) → E4 (lineups) → E5 (resultados/puntuación) → E6 (ligas) → E7 (MVP). Coincide con el camino crítico de `roadmap.md`.

## Riesgos del backlog y mitigaciones

| Riesgo                                                        | Mitigación                                                                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Los módulos puros crecen en complejidad (fórmulas de precios) | Son puros y testados primero; golden files por versión; property-based tests (`testing.md` §6)          |
| PulseLive cambia o bloquea                                    | Adapter + entrada manual siempre disponible (US-16 no se pospone nunca)                                 |
| Calibración (D-01/D-02) se retrasa                            | Los valores PROVISIONAL son jugables desde E4; la re-simulación (T-15) es la puerta del MVP, no de E4   |
| Alcance del MVP crece                                         | `mvp.md` §2/§3 es fijo; lo nuevo va a E8 (P2) o demand-driven                                           |
| Concurrencia en lockout/recálculo                             | Tests de carga desde E4/E5 (no solo en E7); locks por GP y `FOR UPDATE` definidos en `data-model.md` §6 |
