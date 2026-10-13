# Reglas de Juego — Fantasy MotoGP Independiente

> Estado: BORRADOR v1 (fase 3). Los valores numéricos marcados con `PROVISIONAL` son puntos de partida configurables por temporada; no están fijados.

## 1. Concepto central

Cada Gran Premio (GP), cada jugador compone un **lineup** de activos ficticios con un **presupuesto limitado**. El lineup puntúa según el rendimiento real de pilotos, constructor y equipo en ese GP. Los puntos se acumulan a lo largo de la temporada.

## 2. Composición del lineup (invariante dura)

Un lineup válido contiene **exactamente**:

| Rol | Cantidad | Nota |
|---|---|---|
| Pilotos **oro** | 2 | Puntúan al 100% |
| Pilotos **plata** | 2 | Puntúan al 50% |
| **Constructor** | 1 | Fabricante de la moto |
| **Equipo** | 1 | Escuadra/escudería |

**Total: 4 pilotos + 1 constructor + 1 equipo.**

### 2.1 Constructor ≠ Equipo (distinción obligatoria)

- **Constructor** = fabricante de la moto (ej. ficticios: *Apex, Corsa, Titan, Vega*). Varios equipos compiten con el mismo constructor.
- **Equipo** = escuadra concreta que inscribe pilotos (ej. *Apex Factory*, *Apex II*, ambos con motos Apex).
- Son activos **distintos**, con precios **distintos** y puntuación **distinta**. Nunca son intercambiables.
- Un constructor puede tener varios equipos (factory + satélite). Un equipo pertenece a exactamente un constructor.

### 2.2 Asignación oro/plata

- El jugador designa cuáles de sus 4 pilotos son oro (2) y cuáles plata (2).
- La reasignación oro↔plata es **gratuita e ilimitada** (no consume cambio).
- El oro puntúa al 100% de la puntuación del piloto; el plata al 50%.

## 3. Presupuesto (resumen — detalle en `economy.md`)

- **Base fija por GP** para todos los jugadores: `B = 100.00` créditos `PROVISIONAL`.
- **Carry** limitado del dinero sin usar: `carry = min(0.25 × sin_usar_previo, 8.00)` `PROVISIONAL`.
- Presupuesto del GP = `B + carry`. Máximo posible: `108.00`.
- El coste del lineup (suma de precios de los 6 activos) debe ser **≤ presupuesto**.
- **No hay ratchet:** el presupuesto no depende del valor de mercado de tu equipo.

## 4. Precios del mercado

- **Precio de apertura (P0)** fijado por el admin antes de la temporada y publicado.
- **Actualización por GP** con fórmula transparente y versionada (ver `economy.md` §4):
  - Objetivo basado en índice de rendimiento ponderado de los últimos 3 GPs (pesos 50/30/20).
  - Banda de referencia `[0.75·P0, 1.25·P0]`.
  - Suavizado: `precio_nuevo = prev + 0.5·(objetivo − prev)`, acotado a `[0.85·prev, 1.15·prev]` y `[0.25·P0, 2.00·P0]`.
- **Lesión confirmada** para el siguiente GP: `precio = max(0.25·P0, 0.5·prev)`. Baja por temporada: `0.25·P0`.
- **Congelamiento de precios** en el momento del lockout (ver §6).
- **Historial de precios** completo y público por activo.
- Todo movimiento de precio queda registrado (quién/cuándo/cuánto/por qué: fórmula o manual).

## 5. Cambios de lineup (transfers)

`PROVISIONAL` — configurable por temporada:

- **Cambios por GP:** 2 (un cambio = modificar 1 activo: piloto, constructor o equipo).
- **Exención por lesión:** +1 cambio gratuito si un activo del lineup queda confirmado fuera.
- **Wildcard:** 1 reset completo por temporada (cambiar todo el lineup sin límite).
- La reasignación oro/plata **no** consume cambio.
- Los cambios se registran en un **historial de cambios** (auditable).

## 6. Lockout (cierre)

- **Inicio:** comienzo de la Q1 (o del primer evento del fin de semana configurado).
- **Fin:** publicación de los **resultados definitivos** del GP.
- Durante el lockout: **sin cambios** de lineup, **sin cambios** de precios, **sin** reasignación oro/plata.
- El lockout es **server-side** y por GP. Un jugador con varias ligas tiene un único lockout global por GP (los lineups son compartidos).
- Intentos de cambio fuera de ventana → rechazados con motivo explícito (ver `user-flows.md`).

## 7. Puntuación (resumen — detalle en `scoring.md`)

- Cada piloto puntúa por: clasificación (Q2), sprint (si existe), carrera principal, y bonos/penalidades.
- El **constructor** puntúa como la media de los 2 mejores pilotos de ese constructor (campo completo, no solo los del jugador).
- El **equipo** puntúa como la media de los 2 mejores pilotos de ese equipo.
- Los pilotos oro contribuyen al 100%, los plata al 50%.
- **Sin doble conteo:** cada evento puntúa una vez; los bonos son aditivos y explícitos.
- Las reglas de puntuación se versionan por temporada (identificador de versión).

## 8. Temporada y GPs

- Una **temporada** contiene N **GPs** (ordenados).
- Cada GP tiene: circuito, eventos del fin de semana (Q1, Q2, sprint opcional, carrera), y resultados.
- El admin gestiona temporadas, GPs, circuitos, precios y reglas.
- **Rankings:** por GP (quién ganó ese fin de semana) y por temporada (acumulado).

## 9. Ligas (resumen — detalle en `leagues.md`)

- Tipos: privada (código), pública, amigos, temporal, de temporada, personalizada.
- Un usuario puede pertenecer a **varias ligas a la vez**.
- Las **reglas de juego son globales** (presupuesto, puntuación, lockout, transfers) — no por liga. Lo que sí es por liga: miembros, invitaciones, visibilidad, y (opcional) restricciones de entrada.
- Los lineups son **compartidos** entre ligas (un lineup por GP por usuario).
- Rankings por liga (general y por GP) con desempates definidos.

## 10. Invariantes del sistema (garantizadas server-side)

1. Exactamente 2 oro + 2 plata + 1 constructor + 1 equipo por lineup.
2. Coste del lineup ≤ presupuesto disponible.
3. A lo sumo 1 lineup activo por usuario por GP.
4. Un usuario puede estar en varias ligas; sus puntos por GP son los mismos en todas.
5. Los puntos provienen de resultados identificables + versión de reglas identificable.
6. Re-importar resultados no duplica puntos (idempotencia).
7. No hay cambios de reglas retroactivos silenciosos (versionado).

## 11. Decisiones tomadas vs pendientes

**Tomadas (en este documento):**
- Composición 2+2+1+1.
- Constructor ≠ equipo (activos distintos).
- Oro 100% / plata 50%.
- Presupuesto base fija + carry limitado (sin ratchet).
- Lockout server-side por GP, global para el usuario.
- Reglas de juego globales (no por liga).
- Lineups compartidos entre ligas.

**Pendientes (backlog):**
- Valores exactos de `B` y carry.
- Tablas de puntuación definitivas.
- Límites de concentración (máx pilotos por constructor/equipo en un lineup).
- Política exacta de transfers (nº, wildcard, exención).
- Si el constructor/equipo puntúan por media de top-2 o por otro esquema.
