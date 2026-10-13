# Sistema de Puntuación

> Estado: BORRADOR v1 (fase 3). Tablas `PROVISIONAL` y **versionadas por temporada** (ej. `scoring-v1`). Cada recálculo referencia la versión usada.

## 1. Principios

1. **Sin doble conteo:** cada evento puntúa una vez. Los bonos son aditivos y explícitos.
2. **Pilotos, constructor y equipo puntúan por separado** (son activos distintos).
3. **Oro 100% / plata 50%** sobre la puntuación del piloto.
4. **Configurable y versionado:** cada temporada declara una versión de reglas con tablas completas.
5. **Reversible:** resultados provisionales → definitivos con recálculo auditable.

## 2. Puntuación de pilotos (PROVISIONAL)

### 2.1 Clasificación (Q2 — parrilla para la carrera)

| Posición | Puntos |
|---|---|
| 1 (pole) | 12 |
| 2–3 | 8 |
| 4–6 | 5 |
| 7–12 | 3 |
| 13–20 | 1 |
| No clasifica / no participa | 0 |

### 2.2 Sprint (si el GP tiene sprint)

| Posición | Puntos |
|---|---|
| 1 | 12 |
| 2 | 9 |
| 3 | 7 |
| 4 | 6 |
| 5 | 5 |
| 6 | 4 |
| 7 | 3 |
| 8 | 2 |
| 9 | 1 |
| 10+ / DNF | 0 |

### 2.3 Carrera principal (GP)

| Posición | Puntos |
|---|---|
| 1 | 25 |
| 2 | 20 |
| 3 | 16 |
| 4 | 13 |
| 5 | 11 |
| 6 | 10 |
| 7 | 9 |
| 8 | 8 |
| 9 | 7 |
| 10 | 6 |
| 11 | 5 |
| 12 | 4 |
| 13 | 3 |
| 14 | 2 |
| 15 | 1 |
| 16+ / DNF | 0 |

### 2.4 Bonos (aditivos, por piloto)

| Bono | Puntos | Condición |
|---|---|---|
| Vuelta rápida (GP) | +3 | Vuelta más rápida de la carrera |
| Pole position | +2 | Salida en pole (Q2) |
| Ganador de la carrera | +5 | 1º en la carrera principal |
| Posiciones ganadas (GP) | +1 por posición | Máx. +3, solo si termina |
| Resultado extraordinario | +5 | Top-3 siendo el piloto más barato de su equipo (regla configurable) |

### 2.5 Penalizaciones (sustractivas, por piloto)

| Evento | Puntos |
|---|---|
| DNF (no termina) | −5 |
| Descalificación (DQ) | −10 |
| Penalización de tiempo aplicada | −2 |

> **Nota:** un DNF ya puntúa 0 por posición; el −5 es el castigo adicional. La penalización de DNF se aplica **una vez por GP** (referida a la carrera principal); un DNF en sprint puntúa 0 según su tabla, sin penalización adicional. Un piloto que no sale (non-starter) puntúa 0 sin penalización.

## 3. Puntuación de constructor y equipo

- **Constructor** = media de los **2 mejores** pilotos de ese constructor (campo completo) en la suma (Q2 + sprint + GP + bonos − penalizaciones) de ese GP.
- **Equipo** = media de los **2 mejores** pilotos de ese equipo (campo completo) en la misma suma.
- Si el constructor/equipo tiene <2 pilotos que puntuaron, la media se hace sobre los disponibles.
- El constructor y el equipo del **lineup del jugador** son los que puntúan para el jugador (no todos los constructores/equipos).

## 4. Cálculo total del lineup

```
puntos_lineup(gp) =
    Σ_{p ∈ pilotos_oro}   1.0 × puntos_piloto(p, gp)
  + Σ_{p ∈ pilotos_plata} 0.5 × puntos_piloto(p, gp)
  + puntos_constructor(c, gp)
  + puntos_equipo(e, gp)
```

donde `puntos_piloto(p, gp)` = Q2 + sprint + GP + bonos − penalizaciones.

## 5. Ejemplo completo (ficticio)

GP con sprint. Lineup: oro = {A, C}, plata = {E, H}, constructor = X, equipo = X-team.

| Piloto | Q2 | Sprint | GP | Bonos | Penal. | Total | Peso | Contribución |
|---|---|---|---|---|---|---|---|---|
| A (oro) | 12 (pole) | 12 (1º) | 25 (1º) | +5 gan. +2 pole | 0 | 56 | 1.0 | 56.0 |
| C (oro) | 8 (2º) | 7 (3º) | 16 (3º) | +1 pos. ganada | 0 | 32 | 1.0 | 32.0 |
| E (plata) | 3 (8º) | 4 (6º) | 10 (6º) | 0 | 0 | 17 | 0.5 | 8.5 |
| H (plata) | 1 (15º) | 0 (DNF) | 0 (DNF) | 0 | −5 | −4 | 0.5 | −2.0 |

- Constructor X: sus pilotos {A, B, I} puntuaron 56, 20, 6 → top-2 = {56, 20} → media = **38.0**.
- Equipo X-team: sus pilotos {A, B, I} puntuaron 56, 20, 6 → media top-2 = **38.0** (misma afiliación que en el mercado ficticio de `economy.md` §7.1).

**Total lineup = 56.0 + 32.0 + 8.5 − 2.0 + 38.0 + 38.0 = 170.5 puntos.**

## 6. Casos límite y reglas de manejo

| Caso | Regla |
|---|---|
| **Sprint + GP** | Ambos puntúan y se suman (no hay exclusión). |
| **Cambio de equipo a mitad de temporada** | El piloto puntúa para el equipo que tiene **en ese GP** (afiliación por GP, no global). |
| **Sustitución de piloto** (un piloto reemplaza a otro en un GP) | Se puntúa al piloto que **sale** en ese GP; el reemplazado no puntúa. |
| **Non-starter** (no sale a la carrera) | 0 puntos por posición, sin penalización de DNF. |
| **Resultado corregido** (p. ej. penalización aplicada después) | Se marca el resultado como **corregido**, se recalcula el GP con la misma versión de reglas, y se guarda el histórico (anterior → nuevo). |
| **Carrera cancelada** (no hay resultado) | GP con 0 puntos para todos; no se penaliza; se anota "cancelado". |
| **Carrera neutralizada** (bandera roja, resultado parcial) | Se puntúa con el resultado oficial declarado (parcial o completo según reglamento); se versiona. |
| **DNF** | 0 por posición + penalización −5. |
| **DQ** | 0 por posición + penalización −10; si la DQ es posterior, se recalcula. |
| **Vuelta rápida de quien no termina** | No otorga bono (debe terminar). |
| **Empates de posición** (dos pilotos en misma posición) | Se usan las posiciones oficiales; si hay empate real, ambos reciben los puntos de esa posición. |
| **Piloto lesionado (no sale a varios GPs)** | 0 puntos en esos GPs; su precio cae por la regla de lesión (economy §4.3). |

## 7. Versionado y recálculo

- Cada temporada declara una **versión de reglas** (ej. `scoring-v1`) con todas las tablas.
- Cada puntuación calculada referencia: `gp_id + rules_version + results_version`.
- **Recálculo:** al corregir un resultado, se recalcula el GP completo con la misma `rules_version` y se genera una nueva `results_version`. El histórico conserva ambas.
- **No hay cambios retroactivos silenciosos:** cambiar reglas a mitad de temporada requiere una nueva versión y se aplica solo a GPs futuros (o se recalcula todo de forma explícita y auditada, decisión del admin con registro).

## 8. Decisiones pendientes

- Valores exactos de las tablas (PROVISIONAL aquí).
- Si el "resultado extraordinario" se mantiene o se retira.
- Si posiciones ganadas dan +1 por posición o un bono fijo.
- Si el constructor/equipo puntúan por media de top-2 o por otro esquema (p. ej. solo el mejor).
