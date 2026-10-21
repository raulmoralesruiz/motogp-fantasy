# ADR-0017: Estado de lineup y contabilidad de cambios (Fase 2, US-09…US-13)

- **Estado:** Aceptado (2026-10-20)
- **Fecha:** 2026-10-20
- **Relacionado:** US-09…US-13 (backlog E4), D-04 (política de transfers), `game-rules.md` §4–§6, `data-model.md` §5/§7 (invariantes 1–3 y 8), ADR-0013 (afiliaciones desde el GP), ADR-0015 (precios por GP), `season_rules` (`transfers`, `limits`, B/t/cmax).

## Problema

La Fase 2 implementa el flujo central de juego: componer/guardar el lineup (2+2+1+1), presupuesto (base + carry), reasignación oro/plata, transfers (2/GP + exención por lesión + wildcard) y lockout por GP. El data model (T-06) ya trae `lineups`, `lineup_slots` (trigger de composición), `lineup_changes` (historial) y `budget_movements` (saldo derivado de movimientos), pero faltaban por fijar las **semánticas de contabilidad**:

1. ¿Dónde viven los contadores de "cambios usados" y "wildcard usada"?
2. ¿Cuándo se escriben los movimientos de presupuesto (`base`/`carry`/`spend`) y cómo se deriva el saldo?
3. ¿Cómo se modela la "lesión confirmada" (que concede +1 cambio gratuito) en Fase 2, sin resultados reales todavía?
4. ¿Cómo se registra el wildcard (reset completo) en el historial de cambios?
5. ¿Cómo se evalúa el gate de lockout para garantizar que ningún cambio se aplica tras el cierre, incluso bajo concurrencia?

## Opciones

### 1. Contador de cambios

1. **Derivado del historial (elegida)**: `usados = count(lineup_changes del GP con tipo add/remove/swap)`; wildcard usada = `count(tipo wildcard de la temporada)`. Sin tabla de estado nueva; el historial es la única fuente de verdad; no hay riesgo de inconsistencia entre contador e historial.
2. **Contador explícito** (tabla `user_gp_state` con `changesUsed`/`wildcardUsed`): lectura más barata, pero estado redundante que hay que mantener consistente con el historial en cada transacción (un fallo más posible).

### 2. Movimientos de presupuesto

1. **Escritura en el primer save + delta en cada cambio (elegida)**: el primer save del GP n escribe `base(B)` + `carry(min(t·sin_usar_{n-1}, cmax))` + `spend(−coste)`; cada cambio posterior escribe `spend(−Δcoste)`. Saldo = suma de movimientos. Idempotente (los movimientos del primer save solo si no existen).
2. **Escritura al crear el GP/temporada**: exigiría un job de background que creara movimientos para todos los usuarios × GPs; más piezas móviles y el usuario puede no usar nunca el GP.
3. **Almacenar el saldo directamente**: viola `data-model.md` §5 (el saldo se deriva, no se almacena suelto).

### 3. Exención por lesión

1. **Confirmación de lesión por GP del admin (elegida)**: nueva tabla `injury_confirmations` (gp + activo, única); al confirmar, cada usuario cuyo lineup de ese GP contenga ese activo recibe +1 cambio gratuito (`change_exemptions`). Fiel a la regla ("queda confirmado fuera"), auditable, y funciona ya en Fase 2 (sin resultados).
2. **Concesión manual al usuario**: más simple, pero menos fiel a la regla y más propensa a error (el admin tendría que saber quién tiene ese activo).
3. **Diferir a Fase 3**: US-12 quedaría incompleto respecto a su CA.

### 4. Wildcard en el historial

1. **Una sola entrada (elegida)**: fila en `lineup_changes` con nuevo valor de enum `wildcard`, `costBefore`/`costAfter` = coste total del lineup, activo nulo. Simple; el diff exacto de slots queda implícito en el estado del lineup.
2. **Entrada + diff completo en JSONB** (columna `details`): auditoría máxima, pero más superficie (columna, serialización, tests) para un evento de baja frecuencia.

### 5. Lockout

1. **Cierre manual del admin + `lockoutAt` opcional (elegida)**: el admin cierra el GP (`status=locked`, auditado) o fija `lockoutAt` (cierre automático a esa hora). El gate evalúa `status=locked ∨ now ≥ lockoutAt` **dentro de la transacción de cambio** (`FOR UPDATE` sobre la fila del GP). Reapertura antes de `finished` permitida (auditada).
2. **Automático desde el evento Q1**: acopla el cierre al calendario importado (que hoy trae fechas, no siempre horas fiables).

## Decisión

### Contabilidad de cambios (derivada del historial)

- **El primer save no consume cambio**: crear el lineup no es un cambio; cada `add`/`remove`/`swap` consume 1.
- `usados(user, gp) = count(lineup_changes donde user, gp, type ∈ {add, remove, swap})`.
- **Capacidad** = `season_rules.transfers.perGp` + nº de exenciones sin usar del `(user, gp)`.
- **Wildcard**: se puede usar si `count(lineup_changes donde user, gp.seasonId, type = wildcard) < season_rules.transfers.wildcardsPerSeason`. Resetea el lineup completo en una transacción (sin límite por slot) y **no** consume cambios por GP.
- **Exención**: cada fila de `change_exemptions` con `usedAt = null` concede +1 cambio gratuito sobre cualquier cambio de ese GP. El consumo es automático al agotar los cambios por GP: el cambio que consume la exención fija `usedAt = now` (misma transacción) y registra `reason = "exencion:<id de la exención>"` en el historial (trazable). Varias lesiones que afecten al mismo lineup → varias exenciones (sin tope por GP; caso límite documentado).
- Agotada la capacidad (cambios + exenciones) → rechazo con motivo "no te quedan cambios; usa tu wildcard".

### Presupuesto (por GP, derivado de movimientos)

- **Primer save del GP n** (en la transacción del save; idempotente): `base(B)` + `carry(min(t · sin_usar_{n-1}, cmax))` + `spend(−coste)`, donde `sin_usar_{n-1} = max(0, saldo_{n-1})` y `saldo = sum(movimientos)`. Primer GP de la temporada: `carry = 0`.
- **Cada cambio posterior**: `spend(−Δcoste)` (Δ = coste_after − coste_before; Δ < 0 → devolución).
- **Anti-ratchet (invariante 8):** el carry depende solo de `sin_usar`, nunca del valor de mercado de los activos del usuario.
- El coste se recalcula **siempre** server-side con la lista de precios congelada del GP (ADR-0015); un activo sin precio para ese GP → rechazado con motivo.

### Lockout

- Gate: `gp.status = locked ∨ (gp.lockoutAt ≠ null ∧ now ≥ gp.lockoutAt)`, evaluado **dentro de la transacción** de cada cambio (save, reasignación oro/plata, transfer, wildcard) con `FOR UPDATE` sobre la fila del GP → bajo concurrencia, ningún cambio se aplica tras el cierre (CA de US-13).
- Cierre: acción admin auditada (`gp.locked`); reapertura antes de `finished` permitida y auditada (`gp.unlocked`). `finished` se fija en Fase 3 (resultados definitivos).
- El lockout es **global por usuario y GP** (multi-liga: un único cierre).

### Lesiones (Fase 2)

- `injury_confirmations`: unique `(gp, assetType, assetId)`; acción admin auditada (`injury.confirmed`).
- Al confirmar: para cada usuario cuyo lineup **actual** de ese GP contenga ese activo → `change_exemptions` (user, gp, injury), idempotente por el unique.
- En Fase 3 la confirmación podrá alimentarse de resultados reales; el modelo no cambia.

### Migración

- `LineupChangeType` += `wildcard`.
- `lineup_changes.asset_type`/`asset_id` → nullable (la entrada de wildcard no tiene activo; `gold_silver` apunta al piloto reasignado).
- Nuevas tablas `injury_confirmations` y `change_exemptions`.

## Consecuencias

- Sin tablas de estado para contadores: el historial es la fuente de verdad; las lecturas hacen `count` (barato con los índices existentes; si algún día es cuello de botella, se puede añadir un contador materializado sin romper la semántica).
- El wildcard pierde el diff exacto por slot en el historial (solo el coste total antes/después); aceptado (evento de baja frecuencia; el estado del lineup es la fuente de verdad).
- La exención se concede según el lineup **en el momento de la confirmación**: un usuario que ya vendió al piloto lesionado antes de la confirmación no recibe exención (caso límite documentado).
- Los movimientos de presupuesto solo existen para GPs donde el usuario guardó lineup: un usuario que nunca juega un GP no deja rastro en `budget_movements` (el saldo se deriva bajo demanda).
- La reapertura tras un cierre es permitida (auditada): un cambio aplicado tras reabrir es válido; el historial conserva la cronología completa (cierre → reapertura → cambio).
