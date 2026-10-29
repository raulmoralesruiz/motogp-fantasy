# Simulación 2026 — Comparación de opciones económicas (A / B / C / E)

> **Generado por:** `npm run simulate` el 2026-10-29
> **Datos:** temporada 2026 real (PulseLive, fetch 2026-10-13): 17 GPs terminados, 22 pilotos full-time en el mercado, 5 constructores, 12 equipos.
> **Versiones:** scoring-v1 · pricing-v1 · parámetros definitivos (B=100, t=0.25, cmax=8, Pmax=30/30 — calibración D-01/D-02, ADR-0030; la simulación usa el mismo Pmax — §3.3).
> **Población:** 40 jugadores arquetípicos deterministas.

---

## 1. Objetivo

Comparar las opciones económicas A (fijo), B (oficial, ratchet), C (dinámico) y E (híbrido, recomendado) sobre la **temporada 2026 real**, para decidir la mecánica de presupuesto del producto y cerrar la puerta de re-simulación **T-15** (Gini < 0.05, recuperación > 0.95, diversidad > 70%).

La pregunta central: **¿qué mecánica evita que una mala racha (lesiones, caídas, precio que sube) arrastre al jugador a una espiral de la muerte?**

## 2. Datos reales 2026

- **17 GPs** terminados (del 1 al 17).
- **Mercado de pilotos:** 22 full-time (listados en ≥10 GPs). Los pilotos de prueba/puntuales se excluyen del mercado pero puntúan para su constructor/equipo (campo completo).
- **Constructores:** 5. **Equipos:** 12.

### 2.1 Top 10 real 2026 (puntos de carrera principal)

| # | Piloto | Equipo | Puntos |
|---|---|---|---|
| 1 | Jorge Martin | Aprilia Racing | 355 |
| 2 | Marc Marquez | Ducati Lenovo Team | 353 |
| 3 | Marco Bezzecchi | Aprilia Racing | 309 |
| 4 | Ai Ogura | SuperFile Trackhouse MotoGP Team | 259 |
| 5 | Pedro Acosta | Red Bull KTM Factory Racing | 258 |
| 6 | Fabio Di Giannantonio | Pertamina Enduro VR46 Racing Team | 245 |
| 7 | Raul Fernandez | SuperFile Trackhouse MotoGP Team | 236 |
| 8 | Alex Marquez | BK8 Gresini Racing MotoGP | 172 |
| 9 | Francesco Bagnaia | Ducati Lenovo Team | 166 |
| 10 | Fermin Aldeguer | BK8 Gresini Racing MotoGP | 125 |

### 2.2 Top 10 de 2025 (base de P0)

| # | Piloto | Equipo | Puntos |
|---|---|---|---|
| 1 | Marc Marquez | Ducati Lenovo Team | 545 |
| 2 | Alex Marquez | BK8 Gresini Racing MotoGP | 467 |
| 3 | Marco Bezzecchi | Aprilia Racing | 353 |
| 4 | Pedro Acosta | Red Bull KTM Factory Racing | 307 |
| 5 | Francesco Bagnaia | Ducati Lenovo Team | 288 |
| 6 | Fabio Di Giannantonio | Pertamina Enduro VR46 Racing Team | 262 |
| 7 | Franco Morbidelli | Pertamina Enduro VR46 Racing Team | 231 |
| 8 | Fermin Aldeguer | BK8 Gresini Racing MotoGP | 214 |
| 9 | Fabio Quartararo | Monster Energy Yamaha MotoGP Team | 201 |
| 10 | Raul Fernandez | Trackhouse MotoGP Team | 172 |

## 3. Metodología

### 3.1 Mercado y P0

| Activo | P0 |
|---|---|
| Piloto | `4 + 21 × (pts2025 / máx2025)` (top 2025 = 25, suelo 4; novatos = 4) |
| Constructor | `5 + 3 × (fuerza / máxFuerza)` (fuerza = Σ pts2025 de sus pilotos full-time, afiliación 2026) |
| Equipo | `3 + 3 × (fuerza / máxFuerza)` |

### 3.2 Motor de precios (pricing-v1) — EXÓGENO

La serie de precios se calcula **una sola vez** para toda la temporada (misma para las 4 opciones) con la fórmula v1 de `economy.md` §4.3: ponderación 50/30/20 de los 3 últimos GPs, objetivo `P0 × (0.75 + 0.5·W/100)`, suavizado `prev + 0.5·(objetivo − prev)`, acotado a `[0.85·prev, 1.15·prev] ∩ [0.25·P0, 2·P0]`. Ausencia confirmada en el GP → `max(0.25·P0, 0.5·prev)`. DNF → fórmula normal con perf 0.

El precio del GP *gp* usa el rendimiento real de *gp−1, gp−2, gp−3* y la ausencia en *gp* (información disponible al componer el lineup). Los precios son **exógenos**: solo difiere la mecánica de presupuesto entre opciones.

### 3.3 Puntuación (scoring-v1)

Carrera principal: tabla por posición (1º=25 … 15º=1) + bono ganador +5, DNF −5, no sale 0. Oro 100% / plata 50% (oro = los 2 pilotos más caros del lineup). Constructor/equipo = media de los 2 mejores pilotos del grupo en el **campo completo** de ese GP.

**Pmax de la simulación:** la puntuación simulada es reducida (máx 30 puntos por piloto y GP: 25 + 5, solo carrera principal). Tras la calibración D-02 (ADR-0030), el Pmax de producto es **30** (el motor de precios puntúa solo la carrera principal, ADR-0015), por lo que la simulación usa el **mismo** valor (sin rescaleo): **Pmax=30** para pilotos y **Pmax=30** para grupos (media de 2 pilotos, máx 30 cada uno). El punto neutro de la fórmula (W=50) corresponde a ~15 pts (entre 3º y 4º) y una victoria → perf 100.

### 3.4 Población (40 arquetipos)

| Arquetipo | N | Comportamiento de pilotos | Constructor/equipo |
|---|---|---|---|
| Favoritista (F1–F6) | 6 | Precio actual desc (sigue el mercado); variante k salta los k primeros | El más caro |
| Gastador (G1–G5) | 5 | P0 desc (compra la estrella aunque caiga) | El más caro |
| Equilibrado (E1–E8) | 8 | Media de ranking precio + forma | El más equilibrado |
| Value (V1–V8) | 8 | Mejor forma/precio (valueScore desc) | El mejor value |
| Ahorrador (A1–A5) | 5 | Precio actual asc (maximiza carry) | El más barato |
| Mal arranque (M1–M4) | 4 | Ancla fija: Francesco Bagnaia (M1/M2) y Alex Marquez (M3/M4) | El de la ancla |
| Estratega (S1–S4) | 4 | S1 (P5): 2 favoritos + 2 value · S2 (P6): 1 favorito + 3 value · S3: ofensivo (precio) · S4: defensivo (forma) | Según mezcla |

### 3.5 Construcción de lineup

El presupuesto cubre los **6 activos** (4 pilotos + constructor + equipo): el coste total debe ser ≤ presupuesto (invariante game-rules.md §2). Estrategía greedy determinista: (1) pilotos por orden de preferencia dentro de `presupuesto − (ctor mín + equipo mín)`; (2) constructor + equipo = la combinación más preferida que quepa en el resto. Invariantes duras: máx 2 pilotos por constructor y por equipo. Si el presupuesto no alcanza 4 pilotos, se completa con los más baratos que cumplan. Oro = los 2 más caros. **El lineup se reconstruye cada GP** (simplificación: no se modelan transfers ni lockout — el jugador puede cambiar de lineup sin coste, lo que es favorable a la igualdad y se documenta como límite).

### 3.6 Presupuesto por opción

| Opción | Fórmula (GP *r+1*) |
|---|---|
| A (fijo) | `B` |
| B (oficial, ratchet) | `valor de mercado del lineup a precios nuevos + sin usar` |
| C (dinámico) | `clamp(B × (1 + 0.2 × clamp(rel, −1, 1)), 0.8B, 1.2B)`, `rel = (puntos − media)/media` |
| E (híbrido, RECOMENDADO) | `B + min(t × sin_usar_previo, cmax)` |

GP1 = B para todas. En B, el "valor del equipo" se valora a los **precios nuevos** (los publicados tras la carrera, i.e. los del GP siguiente): es el ratchet — si tu estrella gana, su precio sube y tu cap sube; si rinde mal, tu cap se hunde.

## 4. Resultados

### 4.1 Tabla comparativa

| Opción | Gini fin / media | Recuperación peor | Rec. mal arranque | P5–P6 fin / máx | Espiral (<0.9B) | Final <0.9B | Diversidad | Concentración | Puntos/jugador |
|---|---|---|---|---|---|---|---|---|---|
| A | 0.000 / 0.000 | 1.00 (F1) | 1.00 | 0.0 / 0.0 | 0 (—) | 0 | 87% | 90% | 765.2 |
| B | 0.063 / 0.059 | 0.55 (V4) | 0.82 | 4.9 / 6.5 | 36 (F1, F2, F4, F5, F6, G1) | 26 | 89% | 90% | 757.6 |
| C | 0.057 / 0.046 | 0.81 (A2) | 1.06 | 10.9 / 21.2 | 23 (F6, G2, G3, E5, E6, E7) | 8 | 87% | 90% | 765.2 |
| E | 0.001 / 0.002 | 1.08 (F1) | 1.08 | 0.0 / 2.8 | 0 (—) | 0 | 87% | 90% | 765.2 |

### 4.2 Puerta T-15 (re-simulación)

| Opción | Gini final | < 0.05 | Recuperación (peor jugador) | > 0.95 | Diversidad | > 70% | T-15 |
|---|---|---|---|---|---|---|---|
| A | 0.000 | ✅ | 1.00 (F1) | ✅ | 87% | ✅ | **✅ PASS** |
| B | 0.063 | ❌ | 0.55 (V4) | ❌ | 89% | ✅ | **❌ FAIL** |
| C | 0.057 | ❌ | 0.81 (A2) | ❌ | 87% | ✅ | **❌ FAIL** |
| E | 0.001 | ✅ | 1.08 (F1) | ✅ | 87% | ✅ | **✅ PASS** |

### 4.3 Trayectoria de presupuestos por GP

**Opción A:**

| GP | GP | Min | Media | Máx | Gini |
|---|---|---|---|---|---|
| 1 | THA | 100.0 | 100.0 | 100.0 | 0.000 |
| 2 | BRA | 100.0 | 100.0 | 100.0 | 0.000 |
| 3 | USA | 100.0 | 100.0 | 100.0 | 0.000 |
| 4 | SPA | 100.0 | 100.0 | 100.0 | 0.000 |
| 5 | FRA | 100.0 | 100.0 | 100.0 | 0.000 |
| 6 | CAT | 100.0 | 100.0 | 100.0 | 0.000 |
| 7 | ITA | 100.0 | 100.0 | 100.0 | 0.000 |
| 8 | HUN | 100.0 | 100.0 | 100.0 | 0.000 |
| 9 | CZE | 100.0 | 100.0 | 100.0 | 0.000 |
| 10 | NED | 100.0 | 100.0 | 100.0 | 0.000 |
| 11 | GER | 100.0 | 100.0 | 100.0 | 0.000 |
| 12 | GBR | 100.0 | 100.0 | 100.0 | 0.000 |
| 13 | ARA | 100.0 | 100.0 | 100.0 | 0.000 |
| 14 | RSM | 100.0 | 100.0 | 100.0 | 0.000 |
| 15 | AUT | 100.0 | 100.0 | 100.0 | 0.000 |
| 16 | JPN | 100.0 | 100.0 | 100.0 | 0.000 |
| 17 | INA | 100.0 | 100.0 | 100.0 | 0.000 |

**Opción B:**

| GP | GP | Min | Media | Máx | Gini |
|---|---|---|---|---|---|
| 1 | THA | 100.0 | 100.0 | 100.0 | 0.000 |
| 2 | BRA | 91.6 | 94.0 | 96.9 | 0.008 |
| 3 | USA | 89.0 | 92.2 | 95.8 | 0.010 |
| 4 | SPA | 88.3 | 93.1 | 98.2 | 0.015 |
| 5 | FRA | 79.7 | 90.6 | 99.1 | 0.034 |
| 6 | CAT | 75.2 | 89.0 | 98.5 | 0.038 |
| 7 | ITA | 65.8 | 84.9 | 100.0 | 0.062 |
| 8 | HUN | 51.7 | 76.9 | 95.7 | 0.091 |
| 9 | CZE | 50.7 | 76.6 | 95.3 | 0.093 |
| 10 | NED | 50.9 | 77.4 | 95.4 | 0.094 |
| 11 | GER | 49.9 | 77.4 | 95.7 | 0.098 |
| 12 | GBR | 50.3 | 77.6 | 96.8 | 0.095 |
| 13 | ARA | 50.5 | 77.9 | 96.6 | 0.089 |
| 14 | RSM | 51.6 | 79.2 | 97.3 | 0.080 |
| 15 | AUT | 53.8 | 80.9 | 97.0 | 0.072 |
| 16 | JPN | 54.3 | 82.7 | 97.4 | 0.066 |
| 17 | INA | 55.8 | 84.2 | 98.1 | 0.063 |

**Opción C:**

| GP | GP | Min | Media | Máx | Gini |
|---|---|---|---|---|---|
| 1 | THA | 100.0 | 100.0 | 100.0 | 0.000 |
| 2 | BRA | 84.7 | 99.9 | 120.0 | 0.054 |
| 3 | USA | 80.0 | 99.9 | 120.0 | 0.053 |
| 4 | SPA | 80.0 | 100.0 | 120.0 | 0.050 |
| 5 | FRA | 80.4 | 99.8 | 120.0 | 0.060 |
| 6 | CAT | 80.4 | 99.5 | 120.0 | 0.054 |
| 7 | ITA | 82.8 | 100.0 | 116.3 | 0.043 |
| 8 | HUN | 81.6 | 100.0 | 110.9 | 0.043 |
| 9 | CZE | 87.8 | 100.0 | 110.1 | 0.039 |
| 10 | NED | 81.2 | 100.0 | 116.7 | 0.042 |
| 11 | GER | 83.9 | 100.0 | 120.0 | 0.055 |
| 12 | GBR | 81.7 | 100.0 | 110.7 | 0.042 |
| 13 | ARA | 85.2 | 100.0 | 111.4 | 0.037 |
| 14 | RSM | 83.2 | 100.0 | 114.8 | 0.044 |
| 15 | AUT | 80.0 | 100.0 | 114.4 | 0.049 |
| 16 | JPN | 84.4 | 100.0 | 115.9 | 0.054 |
| 17 | INA | 80.0 | 100.1 | 115.7 | 0.057 |

**Opción E:**

| GP | GP | Min | Media | Máx | Gini |
|---|---|---|---|---|---|
| 1 | THA | 100.0 | 100.0 | 100.0 | 0.000 |
| 2 | BRA | 101.4 | 106.1 | 108.0 | 0.011 |
| 3 | USA | 103.7 | 107.4 | 108.0 | 0.005 |
| 4 | SPA | 104.3 | 107.5 | 108.0 | 0.004 |
| 5 | FRA | 103.7 | 107.3 | 108.0 | 0.005 |
| 6 | CAT | 105.1 | 107.6 | 108.0 | 0.003 |
| 7 | ITA | 105.7 | 107.7 | 108.0 | 0.002 |
| 8 | HUN | 108.0 | 108.0 | 108.0 | 0.000 |
| 9 | CZE | 108.0 | 108.0 | 108.0 | 0.000 |
| 10 | NED | 108.0 | 108.0 | 108.0 | 0.000 |
| 11 | GER | 108.0 | 108.0 | 108.0 | 0.000 |
| 12 | GBR | 108.0 | 108.0 | 108.0 | 0.000 |
| 13 | ARA | 108.0 | 108.0 | 108.0 | 0.000 |
| 14 | RSM | 108.0 | 108.0 | 108.0 | 0.000 |
| 15 | AUT | 108.0 | 108.0 | 108.0 | 0.000 |
| 16 | JPN | 108.0 | 108.0 | 108.0 | 0.000 |
| 17 | INA | 107.1 | 107.9 | 108.0 | 0.001 |

### 4.4 Casos nombrados

**M1 — Mal arranque con Francesco Bagnaia:** 17 GPs listados, 0 victorias, 3 podiums, 8 DNF, 0 ausencias en 2026. Un jugador que lo ancla (no lo vende) ve cómo su precio cae y, en la opción B, su cap se hunde con él.

### Mal arranque · Francesco Bagnaia · ancla: Francesco Bagnaia

Presupuesto / puntos por GP (el jugador reconstruye el lineup cada GP).

| GP | GP | Opción A | Opción B | Opción C | Opción E |
|---|---|---|---|---|---|
| 1 | THA | 100.0 / 48.5 | 100.0 / 48.5 | 100.0 / 48.5 | 100.0 / 48.5 |
| 2 | BRA | 100.0 / 63.5 | 93.3 / 63.5 | 108.6 / 63.5 | 103.1 / 63.5 |
| 3 | USA | 100.0 / 72.5 | 93.0 / 72.5 | 110.0 / 72.5 | 105.6 / 72.5 |
| 4 | SPA | 100.0 / 33.5 | 95.5 / 33.5 | 108.0 / 33.5 | 106.3 / 33.5 |
| 5 | FRA | 100.0 / 23.0 | 84.0 / 23.0 | 94.5 / 23.0 | 105.8 / 23.0 |
| 6 | CAT | 100.0 / 34.5 | 82.6 / 34.5 | 96.2 / 34.5 | 106.0 / 34.5 |
| 7 | ITA | 100.0 / 79.5 | 71.6 / 77.0 | 95.9 / 79.5 | 106.4 / 79.5 |
| 8 | HUN | 100.0 / 75.5 | 63.1 / 51.5 | 108.1 / 75.5 | 108.0 / 75.5 |
| 9 | CZE | 100.0 / 61.0 | 63.9 / 47.5 | 106.9 / 61.0 | 108.0 / 61.0 |
| 10 | NED | 100.0 / 14.5 | 63.6 / 15.5 | 101.1 / 14.5 | 108.0 / 14.5 |
| 11 | GER | 100.0 / 65.0 | 62.2 / 46.5 | 92.4 / 65.0 | 108.0 / 65.0 |
| 12 | GBR | 100.0 / 31.0 | 61.6 / 40.0 | 104.0 / 31.0 | 108.0 / 31.0 |
| 13 | ARA | 100.0 / 79.0 | 63.4 / 61.5 | 97.9 / 79.0 | 108.0 / 79.0 |
| 14 | RSM | 100.0 / 86.0 | 66.2 / 59.5 | 107.9 / 86.0 | 108.0 / 86.0 |
| 15 | AUT | 100.0 / 67.5 | 68.7 / 65.5 | 108.9 / 67.5 | 108.0 / 67.5 |
| 16 | JPN | 100.0 / 86.5 | 72.2 / 71.0 | 114.9 / 86.5 | 108.0 / 86.5 |
| 17 | INA | 100.0 / 40.5 | 74.6 / 57.5 | 115.7 / 40.5 | 107.7 / 40.5 |

**M3 — Mal arranque con Alex Marquez:** 14 GPs listados, 1 victorias, 2 podiums, 6 DNF, 3 ausencias en 2026.

### Mal arranque · Alex Marquez · ancla: Alex Marquez

Presupuesto / puntos por GP (el jugador reconstruye el lineup cada GP).

| GP | GP | Opción A | Opción B | Opción C | Opción E |
|---|---|---|---|---|---|
| 1 | THA | 100.0 / 21.5 | 100.0 / 21.5 | 100.0 / 21.5 | 100.0 / 21.5 |
| 2 | BRA | 100.0 / 66.0 | 92.1 / 66.0 | 92.7 / 66.0 | 101.5 / 66.0 |
| 3 | USA | 100.0 / 72.5 | 92.4 / 72.5 | 111.2 / 72.5 | 103.9 / 72.5 |
| 4 | SPA | 100.0 / 74.5 | 95.2 / 74.5 | 108.0 / 74.5 | 104.4 / 74.5 |
| 5 | FRA | 100.0 / 38.0 | 86.8 / 38.0 | 112.1 / 38.0 | 103.8 / 38.0 |
| 6 | CAT | 100.0 / 33.5 | 85.8 / 33.5 | 106.7 / 33.5 | 105.1 / 33.5 |
| 7 | ITA | 100.0 / 63.0 | 74.5 / 63.0 | 95.5 / 63.0 | 105.7 / 63.0 |
| 8 | HUN | 100.0 / 49.0 | 60.0 / 49.0 | 102.2 / 49.0 | 108.0 / 49.0 |
| 9 | CZE | 100.0 / 41.5 | 59.9 / 41.5 | 97.5 / 41.5 | 108.0 / 41.5 |
| 10 | NED | 100.0 / 22.5 | 60.5 / 22.5 | 94.4 / 22.5 | 108.0 / 22.5 |
| 11 | GER | 100.0 / 40.0 | 60.1 / 40.0 | 99.3 / 40.0 | 108.0 / 40.0 |
| 12 | GBR | 100.0 / 42.0 | 61.0 / 42.0 | 94.8 / 42.0 | 108.0 / 42.0 |
| 13 | ARA | 100.0 / 87.0 | 64.3 / 87.0 | 104.2 / 87.0 | 108.0 / 87.0 |
| 14 | RSM | 100.0 / 102.5 | 69.4 / 102.5 | 110.7 / 102.5 | 108.0 / 102.5 |
| 15 | AUT | 100.0 / 52.0 | 74.9 / 52.0 | 114.4 / 52.0 | 108.0 / 52.0 |
| 16 | JPN | 100.0 / 62.0 | 80.0 / 62.0 | 106.9 / 62.0 | 108.0 / 62.0 |
| 17 | INA | 100.0 / 47.0 | 83.3 / 47.0 | 105.6 / 47.0 | 107.3 / 47.0 |

**S1 (P5) vs S2 (P6) — mismo inicio, decisiones distintas:** P5 mezcla 2 favoritos + 2 value; P6, 1 favorito + 3 value. La divergencia de presupuesto mide cuánto amplifica la opción las diferencias de decisión.

### P5 · 2 favoritos + 2 value

Presupuesto / puntos por GP (el jugador reconstruye el lineup cada GP).

| GP | GP | Opción A | Opción B | Opción C | Opción E |
|---|---|---|---|---|---|
| 1 | THA | 100.0 / 25.0 | 100.0 / 25.0 | 100.0 / 25.0 | 100.0 / 25.0 |
| 2 | BRA | 100.0 / 39.0 | 92.0 / 39.0 | 94.7 / 39.0 | 101.4 / 39.0 |
| 3 | USA | 100.0 / 64.5 | 89.9 / 64.5 | 98.4 / 64.5 | 107.6 / 64.5 |
| 4 | SPA | 100.0 / 36.0 | 91.6 / 36.0 | 105.0 / 36.0 | 108.0 / 36.0 |
| 5 | FRA | 100.0 / 28.5 | 80.6 / 28.5 | 95.5 / 28.5 | 108.0 / 28.5 |
| 6 | CAT | 100.0 / 19.5 | 79.7 / 19.5 | 100.0 / 19.5 | 108.0 / 19.5 |
| 7 | ITA | 100.0 / 78.5 | 67.6 / 78.5 | 89.0 / 78.5 | 108.0 / 78.5 |
| 8 | HUN | 100.0 / 67.5 | 60.7 / 67.5 | 107.7 / 67.5 | 108.0 / 67.5 |
| 9 | CZE | 100.0 / 56.0 | 61.1 / 36.5 | 104.1 / 56.0 | 108.0 / 56.0 |
| 10 | NED | 100.0 / 5.5 | 60.6 / 10.0 | 99.4 / 5.5 | 108.0 / 5.5 |
| 11 | GER | 100.0 / 69.0 | 59.0 / 50.0 | 84.7 / 69.0 | 108.0 / 69.0 |
| 12 | GBR | 100.0 / 44.0 | 58.8 / 44.0 | 105.5 / 44.0 | 108.0 / 44.0 |
| 13 | ARA | 100.0 / 81.5 | 61.5 / 62.5 | 105.4 / 81.5 | 108.0 / 81.5 |
| 14 | RSM | 100.0 / 84.0 | 64.4 / 53.5 | 108.8 / 84.0 | 108.0 / 84.0 |
| 15 | AUT | 100.0 / 65.5 | 67.3 / 71.5 | 108.2 / 65.5 | 108.0 / 65.5 |
| 16 | JPN | 100.0 / 79.5 | 71.8 / 60.5 | 113.9 / 79.5 | 108.0 / 79.5 |
| 17 | INA | 100.0 / 37.5 | 73.5 / 30.0 | 112.8 / 37.5 | 108.0 / 37.5 |

### P6 · 1 favorito + 3 value

Presupuesto / puntos por GP (el jugador reconstruye el lineup cada GP).

| GP | GP | Opción A | Opción B | Opción C | Opción E |
|---|---|---|---|---|---|
| 1 | THA | 100.0 / 53.0 | 100.0 / 53.0 | 100.0 / 53.0 | 100.0 / 53.0 |
| 2 | BRA | 100.0 / 44.0 | 94.2 / 44.0 | 111.3 / 44.0 | 104.2 / 44.0 |
| 3 | USA | 100.0 / 35.0 | 92.2 / 35.0 | 100.8 / 35.0 | 108.0 / 35.0 |
| 4 | SPA | 100.0 / 18.5 | 92.1 / 18.5 | 93.5 / 18.5 | 108.0 / 18.5 |
| 5 | FRA | 100.0 / 0.5 | 80.9 / 0.5 | 88.0 / 0.5 | 108.0 / 0.5 |
| 6 | CAT | 100.0 / 50.0 | 80.4 / 50.0 | 80.4 / 50.0 | 108.0 / 50.0 |
| 7 | ITA | 100.0 / 79.0 | 71.4 / 79.0 | 103.1 / 79.0 | 108.0 / 79.0 |
| 8 | HUN | 100.0 / 47.0 | 64.3 / 47.0 | 107.9 / 47.0 | 108.0 / 47.0 |
| 9 | CZE | 100.0 / 28.5 | 64.6 / 28.5 | 96.8 / 28.5 | 108.0 / 28.5 |
| 10 | NED | 100.0 / 11.0 | 64.3 / 11.0 | 89.9 / 11.0 | 108.0 / 11.0 |
| 11 | GER | 100.0 / 50.0 | 64.0 / 50.0 | 89.4 / 50.0 | 108.0 / 50.0 |
| 12 | GBR | 100.0 / 49.5 | 64.9 / 49.5 | 98.5 / 49.5 | 108.0 / 49.5 |
| 13 | ARA | 100.0 / 80.5 | 67.9 / 80.5 | 108.6 / 80.5 | 108.0 / 80.5 |
| 14 | RSM | 100.0 / 67.0 | 70.8 / 67.0 | 108.4 / 67.0 | 108.0 / 67.0 |
| 15 | AUT | 100.0 / 24.5 | 73.7 / 24.5 | 102.5 / 24.5 | 108.0 / 24.5 |
| 16 | JPN | 100.0 / 53.0 | 76.4 / 53.0 | 92.7 / 53.0 | 108.0 / 53.0 |
| 17 | INA | 100.0 / 24.5 | 78.4 / 24.5 | 101.9 / 24.5 | 108.0 / 24.5 |

### 4.5 Precios: movimientos destacados

**Subidas** (precio final vs P0):

| Piloto | Constructor | P0 | Final | Δ |
|---|---|---|---|---|
| Marc Marquez | Ducati | 25.0 | 26.8 | +7% |
| Pedro Acosta | KTM | 15.8 | 16.6 | +5% |
| Jorge Martin | Aprilia | 5.3 | 5.4 | +2% |

**Bajadas**:

| Piloto | Constructor | P0 | Final | Δ |
|---|---|---|---|---|
| Joan Mir | Honda | 7.7 | 1.9 | -75% |
| Maverick Viñales | KTM | 6.8 | 2.2 | -67% |
| Marco Bezzecchi | Aprilia | 17.6 | 6.7 | -62% |
| Ai Ogura | Aprilia | 7.4 | 3.1 | -58% |
| Johann Zarco | Honda | 9.7 | 4.9 | -50% |

### 4.6 Puntos (contexto)

| Opción | Puntos totales | Puntos/jugador |
|---|---|---|
| A | 30608 | 765.2 |
| B | 30306 | 757.6 |
| C | 30608 | 765.2 |
| E | 30608 | 765.2 |

Los puntos son **contexto**, no métrica de éxito: la opción ganadora es la que iguala presupuestos y preserva la recuperación, no la que da más puntos (que dependen de la estrategia del jugador, no de la mecánica).

## 5. Conclusiones

1. **La opción B (oficial, ratchet) reproduce la espiral de la muerte:** 36 de 40 jugadores caen por debajo de 0.9·B en algún GP y 26 terminan por debajo. El caso M1 (ancla a Francesco Bagnaia) lo ilustra: su presupuesto cae de 100 a 61.6 (GP 12) y solo recupera hasta 74.6 al final, muy por debajo del nivel base. Gini final 0.063 (objetivo < 0.05).

2. **La opción E (híbrido) pasa la puerta T-15:** Gini final 0.001, recuperación del peor jugador 1.08 (F1), diversidad 87%. El carry limitado (min(0.25 × sin_usar, 8)) recompensa la eficiencia sin crear ventaja acumulativa: el presupuesto está acotado a [B, B+cmax].

3. **La opción A (fijo) es igualitaria por defecto** (Gini 0.000) pero no recompensa nada: no hay carry, no hay incentivo de eficiencia. Sirve como referencia inferior.

4. **La opción C (dinámico)** ajusta el presupuesto al rendimiento relativo, pero **premia a los ganadores y castiga a los perdedores** (Gini 0.057, recuperación peor 0.81): es un ratchet blando, no resuelve la mala racha.

5. **Recomendación: opción E** (B=100, t=0.25, cmax=8 — PROVISIONAL, calibrable en D-01/D-02). A y E pasan la puerta T-15 (igualdad y recuperación); la diferencia es que E añade un carry que recompensa la eficiencia (hasta +8) sin crear espiral de la muerte, a diferencia de B y C. Es la base del argumento de producto: una mala racha no reduce el deseo de seguir jugando.

## 6. Límites de la simulación

- **Lineup reconstruido cada GP:** no se modelan transfers, lockout ni coste de cambio. Es favorable a la igualdad (el jugador se adapta sin fricción); en producción, el lockout añade fricción que podría aumentar ligeramente la divergencia.
- **Puntuación reducida:** solo carrera principal (posición + ganador + DNF). Quedan fuera Q2, sprint, vuelta rápida, pole y posiciones ganadas; el motor de precios usa esos mismos puntos y el mismo Pmax=30 que la simulación (calibración D-02, §3.3).
- **Arquetipos deterministas:** la población modeliza estilos, no decisiones racionales óptimas. No hay aleatoriedad (re-ejecutar da lo mismo).
- **P0 derivado de 2025:** el precio de apertura aproxima el valor previo; no es un mercado real de subastas.
- **Parámetros definitivos (calibración D-01/D-02, ADR-0030):** B=100, t=0.25, cmax=8, Pmax=30/30, tablas de puntuación `scoring-v1`. Esta simulación valida la **mecánica** y los valores pasan las métricas T-15.

---

*Informe generado automáticamente por `npm run simulate` (scripts/simulate/). Datos: PulseLive (pública, sin auth). Para reproducir: `npm run fetch:data && npm run simulate`.*