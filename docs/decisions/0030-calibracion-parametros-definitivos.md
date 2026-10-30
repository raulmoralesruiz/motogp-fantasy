# ADR-0030: Calibración de parámetros definitivos — D-01 (B/t/cmax) y D-02 (tablas + Pmax)

- **Estado:** Aceptado (2026-10-29) — calibración ejecutada y documentada (búsqueda de parámetros + recalibración de Pmax + tests + docs; todas las puertas en verde: lint 0 issues, typecheck, pureza, unit 681, UI 449, build, integración 420/420, gate de cobertura fusionada 99.9% ≥ 99.9%); **verificado en producción (2026-10-30)**: `PMAX_RIDER=30` desplegado y aplicando la fórmula (ver §Verificación en producción)
- **Fecha:** 2026-10-29
- **Relacionado:** D-01, D-02, D-12, D-13 (backlog §D), T-15 (re-simulación económica), ADR-0002 (motor de precios — `economy/pricing.ts`), ADR-0015 (precios por GP — fuente de `puntos(r)` = solo carrera principal), ADR-0013 (afiliaciones por GP), `economy.md` §4.1/§4.3/§6, `scoring.md` §2/§8, invariantes 1–8 (AGENTS.md §4).

## Problema

El backlog deja dos calibraciones `P0` abiertas antes del MVP (E7/T-15):

- **D-01:** fijar los valores definitivos de `B`, `t`, `cmax` (PROVISIONAL 100 / 0.25 / 8). CA: *"Re-simulación (T-15) con los valores elegidos alcanza las métricas de `economy.md` §6; decisión registrada como ADR o addendum."*
- **D-02:** fijar las tablas de puntuación definitivas + calibrar `Pmax` con datos reales de una temporada. CA: *"Tablas fijadas en `season_rules` v1; `Pmax` recalibrado; golden files actualizados y revisados."*

Además, al preparar la calibración se detectó una **discrepancia doc↔implementación** en `Pmax`:

| Fuente | Puntuación usada por GP | Máximo | `Pmax` |
|---|---|---|---|
| `economy.md` §4.3 (doc) | fin de semana completo (Q2+sprint+carrera+bonos) | ~55–67 | 60 (PROVISIONAL) |
| `price-service.ts` (ADR-0015) | **solo carrera principal** | 30 (25+5) | `PMAX_RIDER=60` / `PMAX_GROUP=30` |

Con la implementación vigente (solo carrera principal, máx 30) y `PMAX_RIDER=60`, **ningún piloto alcanzaba `perf > 50`** (30/60). Como `W` es la media ponderada de `perf`, `W ≤ 50` siempre → `objetivo ≤ P0` → el mercado era **deflacionista por construcción** (los precios solo podían mantenerse o bajar, nunca subir por rendimiento). La simulación (`simulacion-2026.md` §3.3) ya advertía de esto y rescaleaba `Pmax` a 30 para no enmascarar el problema.

## Opciones

### 1. D-01 — Valores de `B`, `t`, `cmax`

1. **Mantener los PROVISIONAL (100 / 0.25 / 8) como definitivos (elegida):** están en el centro del rango razonable (`economy.md` §4.1) y la búsqueda de parámetros (abajo) los valida con margen.
2. Cambiar a otra combinación del rango (p. ej. `t=0.30, cmax=10` para premiar más la eficiencia, o `t=0.20` para premiar menos): también pasa T-15, pero no hay evidencia que la prefiera a la del centro; añadiría un cambio sin beneficio medible.

**Evidencia (búsqueda de parámetros, `npm run calibrate`):** se exploraron las **36 combinaciones** del rango razonable (`B ∈ {100,110,120}`, `t ∈ {0.10,0.20,0.25,0.30}`, `cmax ∈ {5,8,10}`) sobre la **temporada 2026 real** (17 GPs, 22 pilotos, opción E) y **las 36/36 pasan** las 3 métricas de equilibrio T-15:

| Métrica (meta T-15) | Rango observado en las 36 combinaciones |
|---|---|
| Gini del presupuesto final (< 0.05) | 0.000 – 0.010 |
| Recuperación del peor jugador (> 0.95) | 1.03 – 1.10 |
| Diversidad de lineups (> 70%) | 87% (constante) |
| Espiral de la muerte (0/40) | 0/40 (constante) |

La opción E es **robusta en todo el rango**: ninguna combinación falla y las diferencias son mínimas. La combinación del centro (100 / 0.25 / 8) ofrece el mejor equilibrio entre premiar la eficiencia (carry) y el riesgo documentado "carry incentiva no gastar" (`economy.md` §8).

### 2. D-02 — Calibración de `Pmax`

1. **`PMAX_RIDER=30`, `PMAX_GROUP=30` (elegida):** alinea `Pmax` con la puntuación real que usa el motor de precios (solo carrera principal, ADR-0015, máx 30). El punto neutro `W=50` corresponde a ~15 pts (entre 3º y 4º) y una victoria → `perf 100`. Cambio mínimo (solo el valor de `PMAX_RIDER`, 60→30), consistente, y elimina la deflación por construcción.
2. Cambiar el motor de precios a fin de semana completo (Q2+sprint+carrera+bonos) y mantener `PMAX_RIDER=60`: más "correcto" (refleja el scoring de fantasía), pero es un cambio mayor (nueva fuente de `puntos(r)`, ADR-0015), y el máximo varía por GP (con/sin sprint), lo que complica la calibración. Se difiere (post-MVP).

### 3. D-02 — Tablas de puntuación (cierra D-12/D-13)

Las tablas PROVISIONAL de `scoring.md` §2 ya están implementadas y versionadas (`scoring-v1`, `season_rules`). Se **fijan como definitivas**, resolviendo las decisiones pendientes de `scoring.md` §8:

- **Resultado extraordinario:** se **mantiene** (+5, top-3 de la carrera siendo el más barato del equipo). *(D-12)*
- **Posiciones ganadas:** **+1 por posición ganada**, tope 3 (desde la parrilla de Q2). *(D-12)*
- **Constructor/equipo:** puntúan por **media de sus 2 mejores pilotos** (campo completo del GP). *(D-13)*

No se cambian los valores de las tablas (no hay evidencia de desequilibrio; la re-simulación T-15 mide la economía, no la puntuación, y la puntuación no afecta al presupuesto en la opción E).

## Decisión

- **D-01:** valores definitivos **`B=100`, `t=0.25`, `cmax=8`** (PROVISIONAL confirmados). Registrado en `economy.md` §4.1.
- **D-02 (Pmax):** **`PMAX_RIDER=30`** (antes 60) y **`PMAX_GROUP=30`** (sin cambio). El motor de precios sigue puntuando solo la carrera principal (ADR-0015). Registrado en `economy.md` §4.3.
- **D-02 (tablas):** las tablas `scoring-v1` se fijan como definitivas (incl. bonos extraordinario +5, posiciones ganadas +1/máx 3, media top-2 constructor/equipo). Cierra D-12 y D-13. Registrado en `scoring.md` §8.

### Cambios de código

- `app/modules/economy/pricing.ts`: `PMAX_RIDER` 60 → 30 (con comentario de la calibración).
- `app/shared/config/season-rules.ts`: `pmaxRider` 60 → 30 (defaults tipados; en producción viven en `season_rules`).
- Tests recalibrados: `economy/__tests__/pricing.test.ts` (caso `perf` con Pmax=30), `market/__tests__/price-service.test.ts` (precios esperados con `PMAX_RIDER=30`), `shared/config/__tests__/season-rules.test.ts` (Pmax 30/30).
- Golden files: **revisados, sin cambios** (no referencean `Pmax`; los casos de `computeNextPrice`/`buildPriceSeries` usan valores de `perf` directos, no puntos/`Pmax`).
- `scripts/simulate/calibrate.ts` (nuevo): búsqueda de parámetros D-01 (`npm run calibrate`).

## Consecuencias

- **El mercado deja de ser deflacionista por construcción.** Antes, con `PMAX_RIDER=60` y solo carrera principal, la victoria (30 pts) daba `perf 50` y ningún piloto superaba `perf 50`; ahora la victoria da `perf 100` y el punto neutro es un podio. Los precios pueden subir por rendimiento (banda `[0.75·P0, 1.25·P0]`), como diseñó la fórmula.
- **Los precios ya calculados en producción con `PMAX_RIDER=60` no se corrigen retroactivamente** (AGENTS.md §5: no hay cambios retroactivos silenciosos). Solo las **nuevas** aplicaciones de la fórmula (GPs futuros) usan `PMAX_RIDER=30`. Si el admin quiere recalcular precios de GPs pasados, debe hacerlo de forma explícita y auditada (re-aplicar la fórmula con los resultados definitivos).
- **La simulación (`npm run simulate`) no cambia sus resultados:** ya usaba `PMAX_RIDER_SIM=30` (rescaleado, §3.3). Ahora el `Pmax` de producto (30) coincide con el de la simulación, por lo que el "rescaleo" deja de ser necesario (se documenta en `dataset.ts` y `simulacion-2026.md`).
- **D-12 y D-13 quedan cerradas** como consecuencia de D-02 (las decisiones de bonos/esquema se fijan en la tabla `scoring-v1` definitiva).
- **Limitación cerrada (T-25):** el motor de precios ahora lee `Pmax` (`pmaxRider`/`pmaxGroup`) de la versión vigente de `season_rules` (JSONB) en lugar de constantes hardcodeadas. Se añadió una **nueva versión** de `season_rules` con los valores calibrados D-01/D-02 (`pmaxRider=30`, `pmaxGroup=30`) sin mutar la versión publicada vigente. La desalineación entre `season_rules` y el motor queda resuelta: `season_rules` es la fuente de verdad de `Pmax` (cierra AGENTS.md §1.3).
- **La opción de fin de semana completo para el motor de precios (Opción 2 de D-02) queda diferida** a post-MVP: sería un cambio de ADR-0015 (fuente de `puntos(r)`) con impacto en la calibración de `Pmax` por GP (con/sin sprint).

## Validación

- **Búsqueda de parámetros (D-01):** `npm run calibrate` — 36/36 combinaciones del rango razonable pasan T-15 sobre la temporada 2026 real (Gini 0.000–0.010, recuperación 1.03–1.10, diversidad 87%, espiral 0/40).
- **Unit:** 681 tests en verde (incl. los recalibrados: `economy/pricing` con Pmax=30, `market/price-service` con precios nuevos, `config/season-rules` con Pmax 30/30).
- **UI:** 449 tests en verde.
- **Lint / typecheck / pureza / build:** en verde.
- **Integración (Docker/Testcontainers):** 420/420 tests en verde (incl. `prices-formula.test.ts` recalibrado: r1 20 / recálculo 18.83, ctor 14.69/14.25, team 11.75/11.40).
- **Cobertura fusionada (unit + integración + UI):** 1550 tests, 99.9% de líneas (cumple el gate ≥ 99.9%; módulos puros ≥ 90%).
- **Golden files:** revisados, sin cambios (no referencean `Pmax`).

## Verificación en producción (2026-10-30)

Se verifica **en vivo** que el motor de precios desplegado usa `PMAX_RIDER=30` (y no el valor obsoleto 60), aplicando la fórmula sobre un GP definitivo como `global_admin`.

**Escenario (creado en producción y conservado):** un piloto que **gana la carrera principal del GP1** (round 1) → 25 pts + 5 bono ganador = **30 puntos**; `P0=20`; primer GP de la temporada (sin histórico de `perf`). Afiliación del piloto en el **GP objetivo** (round 2) para que la fórmula lo incluya en el grid. Tras importar el resultado y marcar el GP1 **definitivo** (`rv-1`), se aplica `market.prices.applyFormula`.

**Prueba concluyente** — el precio del GP2 del ganador discrimina el `Pmax` desplegado:

| `PMAX_RIDER` | `perf` (30 pts) | `W` | objetivo | **precio GP2** |
|---|---|---|---|---|
| **30** (calibrado) | 100 | 50 | 20 | **20** |
| 60 (obsoleto) | 50 | 25 | 17.5 | **18.75** |

**Resultado observado:** `applyFormula` → `created: 1` (el piloto; `skippedNoOpening: 2` = constructor y equipo, sin P0, correcto). Histórico de precios del piloto:

| Fila | GP | Precio | Motivo |
|---|---|---|---|
| P0 | — | 20 | manual |
| Precio | GP2 (round 2) | **20** | **formula** |

El precio real es **20** (no 18.75) → el motor desplegado calcula con **`PMAX_RIDER=30`**. La calibración D-02 queda **confirmada en producción**. El movimiento quedó auditado con motivo `formula` (visible en el histórico de precios y en `audit_log`).

**Datos de la verificación (en producción, conservados a petición del operador):**

| Entidad | Nombre |
|---|---|
| Piloto | `Piloto Verificacion Pmax` (dorsal 99) |
| Equipo | `Equipo Verificacion Pmax` |
| Constructor | `Constructor Verificacion Pmax` |
| GP fuente (definitivo) | round 1 (`gp1`) — carrera: victoria del piloto (30 pts) |
| GP objetivo (precio fijado) | round 2 (`GRAND PRIX OF BRAZIL`) — precio 20 por fórmula |
