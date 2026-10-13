# Modelo de Datos

> Estado: BORRADOR v1 (fase 4). Esquema relacional (PostgreSQL). Se detallan entidades, claves, relaciones, constraints, índices, y la distinción **fuente de verdad vs derivado**.

## 1. Principios

1. **Fuente de verdad vs derivado:** solo se almacena como fuente de verdad lo que no puede derivarse. Lo derivado (puntuaciones, rankings, presupuesto) se recalcula y se versiona.
2. **Sin duplicar saldos/puntuaciones sin reconciliación:** el presupuesto se deriva de movimientos; las puntuaciones se derivan de resultados + reglas.
3. **Idempotencia:** las claves naturales de importación evitan duplicados.
4. **Versionado:** reglas y resultados se versionan; nada se muta en silencio.
5. **Integridad referencial** con FK y constraints; los invariantes duros se garantizan con constraints de BD donde sea posible.

## 2. Entidades (resumen)

### Identidad
- `users` — usuario (1 cuenta por persona).
- `profiles` — perfil público (seudónimo, avatar, prefs). 1:1 con users.
- `sessions` — sesiones de autenticación.
- `roles` / `user_roles` — roles globales (user, global_admin); el rol de admin de liga vive en `league_members.rol`.

### Temporada y GPs
- `seasons` — temporada (nombre, fechas, estado).
- `season_rules` — **versión de reglas** por temporada (JSONB: B, carry, tablas de puntuación, límites, versión).
- `gps` — Gran Premio (season, orden, circuito, fechas, estado: scheduled/locked/finished/cancelled).
- `circuits` — circuito (nombre, país, ubicación).
- `weekend_events` — eventos del fin de semana (gp, tipo: Q1/Q2/sprint/race, orden, hora, estado).

### Mercado
- `riders` — piloto (nombre, dorsal, activo).
- `constructors` — constructor (nombre).
- `teams` — equipo (nombre, constructor FK).
- `rider_affiliations` — **afiliación por GP** (rider, team, constructor, gp). Permite cambios de equipo a mitad de temporada.
- `prices` — **precio de apertura y por GP** (asset_type: rider/constructor/team, asset_id, gp, price, motivo: formula/manual, rules_version, created_by).
- `price_history` — derivado/índice sobre prices (o vista).

### Lineups
- `lineups` — lineup activo (user, gp, estado: draft/locked/submitted, created/updated).
- `lineup_slots` — slots del lineup (lineup, slot_type: gold/silver/constructor/team, asset_type, asset_id). **Constraint: exactamente 2 gold + 2 silver + 1 constructor + 1 team.**
- `lineup_changes` — **historial de cambios** (lineup, gp, tipo: add/remove/swap/gold-silver, asset, coste_anterior, coste_nuevo, motivo, timestamp, user).

### Economía
- `budget_movements` — **movimientos de presupuesto** (user, gp, tipo: base/carry/spend/adjust, cantidad, referencia). Fuente de verdad del presupuesto (se deriva el saldo).
- (El presupuesto disponible se **calcula** como `B + carry` y se valida contra movimientos; no se almacena un "saldo" suelto.)

### Ligas
- `leagues` — liga (nombre, tipo, visibilidad, min/max miembros, modo entrada, duración, estado).
- `league_members` — membresía (league, user, rol: admin/member, estado: active/left/kicked, joined_at, left_at).
- `league_invites` — invitaciones/códigos (league, código, creado_por, estado: active/revoked, expires, usos).

### Resultados
- `results` — **resultado por piloto por evento** (gp, event, rider, posición, puntos_crudos, estado: provisional/definitive/corrected, results_version, source: auto/manual, imported_at). **Clave natural idempotente: (gp, event, rider).**
- `results_events` — metadatos del evento de resultado (gp, event, estado, neutralizada, cancelada, results_version).
- `results_history` — **histórico de correcciones** (result_id, anterior, nuevo, motivo, results_version, timestamp, user).

### Puntuación y rankings
- `scores` — **puntuación por lineup por GP** (lineup, user, gp, points_total, desglose JSONB: por piloto/constructor/equipo/bonos/penal, rules_version, results_version, computed_at). Derivado de results + rules.
- `rankings` — **ranking por liga por GP y general** (league, gp|null, user, posición, puntos, desempates, results_version, computed_at). Derivado de scores.

### Admin
- `audit_log` — **auditoría** (actor, acción, entidad, entity_id, antes/después JSONB, ip, timestamp). Para acciones sensibles.

## 3. Relaciones principales

```
users 1--1 profiles
users 1--N sessions
seasons 1--N season_rules (versionado)
seasons 1--N gps
gps 1--1 circuits
gps 1--N weekend_events
constructors 1--N teams
riders 1--N rider_affiliations N--1 teams
riders 1--N rider_affiliations N--1 gps
prices N--1 (riders|constructors|teams) + gps
users 1--N lineups N--1 gps
lineups 1--N lineup_slots
lineups 1--N lineup_changes
users 1--N budget_movements N--1 gps
leagues 1--N league_members N--1 users
leagues 1--N league_invites
gps 1--N results N--1 riders
gps 1--N results_events
results 1--N results_history
lineups 1--N scores N--1 gps
leagues 1--N rankings
```

## 4. Constraints e índices clave

### Invariantes como constraints de BD
- `lineup_slots`: constraint de tabla que garantiza **exactamente 2 gold + 2 silver + 1 constructor + 1 team** por lineup (check sobre conteo por slot_type).
- `lineups`: unique `(user, gp)` → **a lo sumo 1 lineup activo por usuario por GP**.
- `league_members`: unique `(league, user)` → no duplicar membresía.
- `results`: unique `(gp, event, rider)` → **idempotencia de importación**.
- `prices`: unique `(asset_type, asset_id, gp)` → un precio por activo por GP.
- `rider_affiliations`: unique `(rider, gp)` → una afiliación por piloto por GP.
- `season_rules`: unique `(season, version)`.

### Índices
- `lineups(user, gp)`, `lineups(gp)`.
- `lineup_slots(lineup_id)`, `lineup_slots(asset_type, asset_id)`.
- `results(gp, event)`, `results(rider)`.
- `scores(gp)`, `scores(user)`.
- `rankings(league, gp)`, `rankings(league)`.
- `prices(asset_type, asset_id, gp)`.
- `budget_movements(user, gp)`.
- `league_members(league)`, `league_members(user)`.
- `audit_log(actor, timestamp)`, `audit_log(entity, entity_id)`.

## 5. Fuente de verdad vs derivado

| Dato | Tipo | Nota |
|---|---|---|
| users, profiles, seasons, gps, circuits, riders, teams, constructors | **Fuente de verdad** | Se gestionan (admin/import) |
| rider_affiliations (por GP) | **Fuente de verdad** | Permite cambios de equipo |
| prices (por GP) | **Fuente de verdad** | Con motivo (fórmula/manual) y versión |
| lineups + lineup_slots | **Fuente de verdad** | El lineup del usuario |
| lineup_changes | **Fuente de verdad** | Historial de cambios (auditable) |
| budget_movements | **Fuente de verdad** | De donde se deriva el presupuesto |
| results (por piloto por evento) | **Fuente de verdad** | Con estado provisional/definitivo y versión |
| results_history | **Fuente de verdad** | Histórico de correcciones |
| season_rules (versionado) | **Fuente de verdad** | Reglas por temporada |
| scores | **Derivado** | De results + rules (recalculable) |
| rankings | **Derivado** | De scores (recalculable) |
| presupuesto disponible | **Derivado** | De B + carry + movimientos (validado server-side) |
| valor de mercado del equipo | **Derivado** | De prices actuales (informativo) |

> **Reconciliación:** al recalcular, se comparan los scores nuevos con los anteriores; las diferencias se registran. No hay "saldo" ni "puntuación" almacenada que no sea trazable a su origen.

## 6. Transacciones y concurrencia

| Operación | Transacción | Bloqueo |
|---|---|---|
| Guardar/actualizar lineup | Sí (slots + cambios + validación de presupuesto) | `FOR UPDATE` sobre el lineup del usuario |
| Aplicar cambio (transfer) | Sí (descuenta cambio, valida) | `FOR UPDATE` sobre lineup + counter de cambios |
| Importar resultados | Sí (por lote, idempotente) | Por `(gp, event)` |
| Marcar definitivo + recalcular | Sí (por GP) | Lock por GP (un recálculo a la vez) |
| Unirse a liga | Sí (valida plaza + membership) | `FOR UPDATE` sobre league (contador de miembros) |
| Actualizar precios | Sí (por GP) | Por GP |

- **Evitar condiciones de carrera en lockout:** el estado del GP (`locked`) + el timestamp de cierre se evalúan server-side dentro de la transacción; un intento de cambio tras el cierre se rechaza.
- **Recálculo concurrente:** se usa un lock (p. ej. `advisory lock` por GP) para que dos jobs no recalculen el mismo GP a la vez.

## 7. Invariantes del sistema (garantizados)

1. **Exactamente 2 oro + 2 plata + 1 constructor + 1 equipo** por lineup. → Constraint de BD.
2. **Coste del lineup ≤ presupuesto.** → Validación server-side en transacción (recalcula coste con precios congelados).
3. **A lo sumo 1 lineup activo por usuario por GP.** → Unique `(user, gp)`.
4. **Multi-liga:** un usuario en varias ligas; sus puntos por GP son los mismos en todas. → scores por (user, gp), rankings por (league, user, gp).
5. **Puntos de resultados identificables + reglas identificables.** → scores referencia `results_version` + `rules_version`.
6. **No duplicar puntos al re-importar.** → Unique `(gp, event, rider)` + estado.
7. **No cambios retroactivos silenciosos.** → season_rules versionado; recálculo genera nueva `results_version` con histórico.

## 8. Notas de modelado

- **JSONB** se usa para: `season_rules` (tablas completas), desglose de `scores`, antes/después de `audit_log`. El resto es relacional estricto.
- **Soft delete** para: users (anonimización GDPR), league_members (left/kicked), results (no se borran, se corrigen).
- **Timestamps** `created_at`/`updated_at` en todas las entidades.
- **IDs:** `uuid` (o `bigserial` + uuid público) para evitar enumeración.
