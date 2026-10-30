# Economía y Presupuesto — Análisis y Recomendación

> Estado: BORRADOR v1 (fase 3). **Documento central del producto.** Los valores numéricos son `PROVISIONAL` y configurables por temporada. Las simulaciones usan **datos 100% ficticios** y se incluyen para validar el diseño, no como predicción.

## 1. El problema

El juego oficial usa un presupuesto **acumulado (ratchet)**: el valor de tu equipo (suma de precios actuales de tus activos + dinero sin usar) se convierte en el _salary cap_ del siguiente GP. Consecuencias verificadas en sus reglas:

- **Dependencia de trayectoria:** resultados previos → valor del equipo → presupuesto futuro.
- **Ventaja compuesta para ganadores:** sus activos suben → cap más grande → pueden comprar mejor.
- **Espiral de la muerte para perdedores:** sus activos bajan → cap más pequeño → no pueden reponerse.
- **La lesión castiga doble:** el piloto no puntúa Y su precio cae (−$100k por GP de baja en el oficial), encogiendo además el cap de quien lo tiene.

**Hipótesis:** el ratchet es la raíz de la percepción de injusticia. Un jugador no puede "comprar" su forma: la leen los precios de sus activos.

## 2. Opciones analizadas

### Opción A — Presupuesto fijo por GP

Cada GP todos empiezan con `B`. Sin carry.

- ✅ Máxima igualdad; cero ratchet; trivial de explicar.
- ❌ No premia la gestión del dinero; el dinero sin usar se pierde (incentivo a gastar "a ciegas"); menos profundidad estratégica.
- ❌ Sin mecanismo de recompensa por eficiencia.

### Opción B — Presupuesto acumulado (oficial)

Cap siguiente = valor del equipo + sin usar.

- ✅ "Realista" (mercado); premia tener activos que suben.
- ❌ Ratchet → dependencia de trayectoria; espiral de la muerte; la lesión castiga triple.
- ❌ Difícil de explicar ("¿por qué mi cap bajó?").
- ❌ Nuestra simulación (§7) lo demuestra: mismo punto de partida, cap final 89 vs 103.

### Opción C — Dinámico con límites

El cap se ajusta por rendimiento del jugador, con suelo y techo.

- ✅ Intenta premiar a los buenos sin espiral.
- ❌ Complejidad alta; "rendimiento del jugador" es endógeno (circular: presupuesto → resultados → presupuesto).
- ❌ Difícil de auditar y explicar.
- ❌ Añade una fuente más de percepción de injusticia.

### Opción D — Separar valor de mercado y presupuesto disponible

Dos monedas: (1) valor de mercado del equipo (informativo) y (2) presupuesto disponible (fijo o con carry).

- ✅ Claridad: el valor de mercado deja de gobernar el presupuesto.
- ✅ Permite mostrar "valor de tu equipo" como métrica de vanidad sin que sea punitiva.
- ❌ Por sí solo no define cómo evoluciona el presupuesto (hay que combinarse con A o E).

### Opción E — Híbrido: base fija + carry limitado (RECOMENDADA)

Presupuesto del GP = `B + carry`, donde `carry = min(tasa × sin_usar_previo, tope)`.

- ✅ **Rompe el ratchet:** el presupuesto no depende del valor de mercado de tus activos.
- ✅ **Premia la eficiencia** con un carry acotado (el dinero sin usar da una pequeña ventaja, pero limitada).
- ✅ **Recuperación garantizada:** un mal arranque no reduce tu base; el carry incluso lo compensa.
- ✅ **Simple de explicar:** "cada GP tienes 100, más hasta 8 si no gastaste todo".
- ✅ **Transparente y auditable:** presupuesto = fórmula pública de 2 términos.
- ⚠️ El carry puede incentivar no gastar; el tope lo mitiga (máx 8 sobre 100 = 8%).
- ⚠️ Requiere decidir `B`, `tasa` y `tope` (PROVISIONAL: 100 / 25% / 8).

## 3. Comparativa resumida

| Criterio                       | A Fijo  | B Acumulado     | C Dinámico   | D Separado | **E Híbrido**          |
| ------------------------------ | ------- | --------------- | ------------ | ---------- | ---------------------- |
| Rompe ratchet                  | ✅      | ❌              | ⚠️           | ✅         | ✅                     |
| Premia eficiencia              | ❌      | ✅              | ✅           | ⚠️         | ✅ (acotado)           |
| Recuperación tras mal arranque | ✅      | ❌              | ⚠️           | ✅         | ✅                     |
| Simplicidad de explicar        | ✅      | ❌              | ❌           | ✅         | ✅                     |
| Profundidad estratégica        | Baja    | Alta (punitiva) | Alta (opaca) | Media      | **Media-alta (justa)** |
| Auditabilidad                  | ✅      | ⚠️              | ❌           | ✅         | ✅                     |
| Riesgo de espiral de muerte    | Ninguno | Alto            | Medio        | Ninguno    | **Ninguno**            |

**Recomendación: Opción E (híbrido)**, incorporando el principio D (mostrar valor de mercado como métrica informativa, no gobernan).

## 4. Modelo recomendado (especificación)

### 4.1 Parámetros (DEFINITIVOS — calibración D-01, 2026-10-29; configurables por temporada)

| Parámetro               | Símbolo | Valor definitivo | Rango razonable |
| ----------------------- | ------- | ---------------- | --------------- |
| Presupuesto base por GP | `B`     | 100.00           | 100–120         |
| Tasa de carry           | `t`     | 0.25             | 0.10–0.30       |
| Tope de carry           | `cmax`  | 8.00             | 5–10            |
| Presupuesto máx.        | —       | 108.00           | —               |

> **Calibración D-01 (2026-10-29, ADR-0030):** se mantuvieron los valores PROVISIONAL como definitivos. La búsqueda de parámetros (`npm run calibrate`, 36 combinaciones del rango razonable sobre la temporada 2026 real, opción E) pasa las 3 métricas de equilibrio T-15 en el 100% de los casos (Gini 0.000–0.010 < 0.05; recuperación 1.03–1.10 > 0.95; diversidad 87% > 70%; espiral de la muerte 0/40). La combinación elegida (centro del rango) ofrece el mejor equilibrio entre premio a la eficiencia y el riesgo "carry incentiva no gastar" (§8).

### 4.2 Fórmulas

```
sin_usar(gp)   = presupuesto(gp) − coste(lineup, gp)
carry(gp+1)    = min(t × sin_usar(gp), cmax)
presupuesto(gp+1) = B + carry(gp+1)
```

- `coste(lineup, gp)` = suma de precios (a la lista de precios del GP) de los 4 pilotos + constructor + equipo.
- Restricción: `coste ≤ presupuesto(gp)`.
- El **valor de mercado** del equipo (suma de precios actuales) se muestra como métrica informativa, **no** afecta al presupuesto.

### 4.3 Motor de precios (fórmula v1, versionada)

```
perf(r)      = min(100, puntos(r) / Pmax × 100)  // índice 0–100 por GP (topado a 100)
W(r)         = 0.5·perf(r) + 0.3·perf(r−1) + 0.2·perf(r−2)   // ponderado últimos 3
objetivo(r+1)= P0 × (0.75 + 0.5 × W(r)/100)       // banda [0.75·P0, 1.25·P0]
precio(r+1)  = precio(r) + 0.5 × (objetivo − precio(r))
precio(r+1)  ← acotado a [0.85·precio(r), 1.15·precio(r)] y [0.25·P0, 2.00·P0]
```

- **Lesión confirmada** para el GP `r+1`: `precio(r+1) = max(0.25·P0, 0.5·precio(r))`.
- **Baja por temporada**: `precio = 0.25·P0`.
- `Pmax` = puntuación máxima de referencia del activo en un GP. **Calibración D-02 (2026-10-29, ADR-0030):** el motor de precios puntúa solo la carrera principal (ADR-0015), cuyo máximo es **30** (25 por victoria + 5 bono ganador). Por tanto **`pmaxRider = 30` y `pmaxGroup = 30`** (media top-2, máx 30 por piloto). El punto neutro `W=50` corresponde a ~15 pts (entre 3º y 4º) y una victoria → `perf 100`. *(Antes: `PMAX_RIDER=60`, máximo teórico del fin de semana completo; con puntuación solo de carrera principal ningún piloto alcanzaba `perf > 50` y el mercado era deflacionista por construcción.)* **T-25:** `Pmax` se lee de `season_rules` (JSONB versionado); ya no vive como constante en el código. `perf` está topado a 100 para que el índice permanezca en 0–100.
- Todo movimiento de precio queda registrado: `activo, gp, precio_previo, precio_nuevo, motivo (fórmula|manual), versión_fórmula`.

### 4.4 Anti-explotación

- **Límite de concentración** (PROVISIONAL): máx. 2 pilotos del mismo constructor en un lineup; máx. 2 del mismo equipo. Evita "apostar todo a un constructor".
- **Piso de precio** `0.25·P0`: ningún activo se vuelve gratis (evita acaparamiento de activos lesionados a coste casi 0).
- **Tope de precio** `2.00·P0`: ningún activo se vuelve inalcanzable.
- **Congelamiento en lockout:** los precios se fijan antes del lockout; no hay cambios de precio durante el fin de semana.
- **Validación server-side:** el coste se recalcula en el servidor con la lista de precios congelada; el frontend nunca define el presupuesto.

## 5. Ejemplo numérico rápido (ficticio)

Jugador con lineup que cuesta 92.00 en un GP con presupuesto 100.00:

- `sin_usar = 8.00` → `carry = min(0.25×8, 8) = 2.00` → presupuesto siguiente GP = `102.00`.
- Si en el siguiente GP sus pilotos suben de precio y el lineup cuesta 95.00: `sin_usar = 7.00` → carry 1.75 → presupuesto siguiente 101.75. **El presupuesto no cayó aunque el valor de mercado suba o baje.**

## 6. Métricas de equilibrio (para validar en producción)

| Métrica                       | Def                                                                                      | Meta             |
| ----------------------------- | ---------------------------------------------------------------------------------------- | ---------------- |
| **Equidad competitiva**       | Gini del presupuesto (o riqueza = presupuesto + valor de mercado) entre jugadores por GP | < 0.05           |
| **Diversidad de lineups**     | % de lineups únicos entre jugadores por GP                                               | > 70%            |
| **Capacidad de recuperación** | Ratio presupuesto(tarde)/presupuesto(inicio) para el jugador con peor arranque           | > 0.95           |
| **Concentración**             | % de lineups con 2 pilotos del mismo constructor                                         | < 40%            |
| **Eficiencia del gasto**      | Distribución de `sin_usar` por GP (media, p95)                                           | media < 20% de B |

## 7. Simulaciones obligatorias (datos ficticios)

> **Aviso:** todos los nombres, precios y resultados son **ficticios**. Se simulan 6 GPs con un mercado de 11 pilotos / 4 constructores / 4 equipos, presupuesto base 100. Se comparan el sistema **OFF** (oficial: cap = valor del equipo) y **REC** (recomendado: base 100 + carry). Lineups fijos por jugador para aislar el efecto económico. Puntuación: oro 100% / plata 50% (los 2 pilotos más caros del lineup son oro), constructor y equipo = media de sus 2 mejores pilotos.

### 7.1 Mercado ficticio (precios de apertura)

| Piloto | Constructor | Equipo | P0  | Rol narrativo                         |
| ------ | ----------- | ------ | --- | ------------------------------------- |
| A      | X           | X-team | 24  | Superestrella estable                 |
| B      | X           | X-team | 22  | Superestrella → **lesionada GP3–GP4** |
| C      | Y           | Y-team | 18  | Favorita en ascenso                   |
| D      | Y           | Y-team | 16  | Favorita en bajada                    |
| E      | Z           | Z-team | 12  | Media en ascenso                      |
| F      | Z           | Z-team | 11  | Media estable                         |
| G      | W           | W-team | 10  | Media en bajada                       |
| H      | W           | W-team | 6   | Barata en ascenso                     |
| I      | X           | X-team | 5   | Barata estable                        |
| J      | Z           | Z-team | 5   | **Ascendente (infravalorada)**        |
| K      | W           | W-team | 4   | Barata estable                        |

Constructores: X=8, Y=7, Z=6, W=5. Equipos: X-team=6, Y-team=5, Z-team=4, W-team=3.

Evolución de precios (GP1→GP6): A `24,24,25,25,26,26` · B `22,22,8,8,8,9` (lesión) · C `18,19,19,20,20,20` · D `16,16,15,15,14,14` · E `12,12,13,13,14,14` · F `11,11,11,12,12,12` · G `10,9,9,8,8,8` · H `6,6,6,7,7,7` · I `5,5,5,5,5,5` · J `5,6,8,11,14,17` (ascenso) · K `4,4,4,4,4,4`.

### 7.2 Jugadores simulados (cubren los 7 escenarios obligatorios)

| Jugador                | Lineup               | Escenario obligatorio                          |
| ---------------------- | -------------------- | ---------------------------------------------- |
| **P1 Favoritista**     | A+B+C+D + X + X-team | (1) Jugador de favoritos caros                 |
| **P2 Equilibrado**     | A+C+E+H + Y + Y-team | (2) Mezcla favoritos + baratos                 |
| **P3 Value**           | J+E+F+H + Z + Z-team | (3) Detector de infravalorados (compra J)      |
| **P4 Mal arranque**    | B+D+G+I + W + W-team | (4) Mal arranque (B se lesiona)                |
| **P5 Doble estrella**  | A+B+K+I + X + X-team | (7a) Mismo presupuesto que P6, decide distinto |
| **P6 Estrella+medias** | A+E+F+G + Y + Y-team | (7b) Mismo presupuesto que P5, decide distinto |

Escenarios de piloto: (5) piloto que mejora = **J** (5→17); (6) piloto lesionado/en bajada = **B** (lesión) y **D/G** (bajada).

### 7.3 Resultados — Sistema OFF (oficial: cap = valor del equipo)

Trayectorias de cap (GP1→GP6):

| Jugador            | Cap GP1 | GP2 | GP3    | GP4 | GP5    | GP6     | Puntos totales |
| ------------------ | ------- | --- | ------ | --- | ------ | ------- | -------------- |
| P1 Favoritista     | 100     | 101 | **87** | 88  | 88     | 89      | 798.0          |
| P2 Equilibrado     | 100     | 101 | 103    | 105 | 107    | 107     | 778.5          |
| P3 Value           | 100     | 101 | 104    | 109 | 113    | **116** | 634.5          |
| P4 Mal arranque    | 100     | 99  | **84** | 83  | **82** | 83      | 324.0          |
| P5 Doble estrella  | 100     | 100 | **87** | 87  | 88     | 89      | 631.5          |
| P6 Estrella+medias | 100     | 99  | 101    | 101 | 103    | **103** | 696.0          |

### 7.4 Resultados — Sistema REC (recomendado: base 100 + carry)

Trayectorias de presupuesto (GP1→GP6):

| Jugador            | Pres. GP1 | GP2    | GP3    | GP4    | GP5    | GP6    | Puntos totales |
| ------------------ | --------- | ------ | ------ | ------ | ------ | ------ | -------------- |
| P1 Favoritista     | 100       | 101.50 | 101.63 | 105.16 | 105.79 | 105.95 | 798.0          |
| P2 Equilibrado     | 100       | 107.00 | 108.00 | 108.00 | 107.75 | 107.19 | 778.5          |
| P3 Value           | 100       | 108.00 | 108.00 | 108.00 | 108.00 | 108.00 | 634.5          |
| P4 Mal arranque    | 100       | 108.00 | 108.00 | 108.00 | 108.00 | 108.00 | 324.0          |
| P5 Doble estrella  | 100       | 107.75 | 108.00 | 108.00 | 108.00 | 108.00 | 631.5          |
| P6 Estrella+medias | 100       | 107.75 | 108.00 | 108.00 | 108.00 | 108.00 | 696.0          |

### 7.5 Métricas de comparación

| Métrica                                                    | OFF (oficial)                 | REC (recomendado)               | Lectura                                                                                            |
| ---------------------------------------------------------- | ----------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Gini de riqueza final** (presupuesto + valor de mercado) | **0.0653**                    | **0.0412**                      | REC es 37% más igualitario                                                                         |
| **Ratio recuperación P4** (media pres. GP4–6 / pres. GP1)  | **0.83**                      | **1.08**                        | OFF: P4 pierde 17% de poder de compra de forma permanente. REC: P4 se recupera y supera su base    |
| **P5 vs P6 (mismo inicio, decisiones distintas)**          | Cap final **89 vs 103** (Δ14) | Pres. final **108 vs 108** (Δ0) | OFF: el poder de compra diverge por qué activos subieron/bajaron, no por skill. REC: idéntico      |
| **Ventas forzadas**                                        | 0 (en este escenario)         | 0                               | En escenarios de cap más ajustado OFF sí fuerza ventas; REC nunca                                  |
| **Puntos totales**                                         | Idénticos en ambos            | Idénticos en ambos              | El sistema económico no cambia la puntuación (lineups fijos); cambia el **poder de compra futuro** |

### 7.6 Conclusiones de la simulación

1. **El ratchet del oficial crea dependencia de trayectoria medible:** P5 y P6 empiezan idénticos (coste 69, cap 100) y terminan con cap 89 vs 103. La diferencia la causó que B se lesionó (activo de P5), no una decisión superior de P6.
2. **El mal arranque es permanente en OFF:** P4 cae a cap 82–84 y no recupera. En REC vuelve a 108.
3. **La lesión castiga triple en OFF** (no puntúa + precio cae + cap del dueño se encoge). En REC solo castiga en puntos y en el precio del activo (que además tiene piso 0.25·P0).
4. **El carry acotado premia la eficiencia sin crear ratchet:** P3 (gasta poco) llega a 108, pero P1 (gasta casi todo) también termina en 105.95 — nadie queda por debajo de la base.
5. **La equidad (Gini) mejora** al eliminar el ratchet.

### 7.7 Limitaciones de la simulación

- Lineups fijos (aisla el efecto económico; en realidad el cap cambia qué lineups son asequibles, lo que retroalimenta puntos).
- No aplica el límite de concentración provisional (§4.4): por ejemplo, P3 y P5 tienen 3 pilotos del mismo equipo en su lineup. Se valida por separado (backlog D-03).
- Mercado pequeño (11 pilotos); la concentración y la liquidez real serían mayores.
- No modela la decisión óptima de compra/venta (los jugadores siguen su arquetipo).
- Pmax y parámetros de precios PROVISIONAL; una calibración con datos reales de una temporada completa es un task del backlog.

## 8. Riesgos y validación

| Riesgo                           | Mitigación                                   | Validación                            |
| -------------------------------- | -------------------------------------------- | ------------------------------------- |
| Carry incentiva no gastar        | Tope `cmax` bajo (8% de B)                   | Métrica "eficiencia del gasto" por GP |
| Precios se desestabilizan        | Acotaciones [0.85,1.15]·prev y [0.25,2.0]·P0 | Revisión de volatilidad por activo    |
| Acaparamiento de activos baratos | Límite de concentración + piso de precio     | Métrica de concentración              |
| Parámetros mal calibrados        | Configurables por temporada + simulación     | Re-simular antes de cada temporada    |
