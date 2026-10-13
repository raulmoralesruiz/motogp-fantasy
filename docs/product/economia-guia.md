# Guía de Economía — Explicación y Profundización

> **Companion de `economy.md`.** Este documento traduce el diseño económico a lenguaje accesible y profundiza en tres campos: el motor de precios, un GP completo de principio a fin, y la calibración antes del MVP.
>
> Estado: BORRADOR. Los valores numéricos son `PROVISIONAL` y viven en `season_rules` (configurables por temporada). Las simulaciones usan datos 100% ficticios.

---

# PARTE 1 — Las opciones de economía, explicadas en claro

## 1.1 El problema: por qué el sistema oficial "se siente injusto"

Imagina el sistema oficial como **un sueldo que depende de lo que vale tu casa**.

En el Fantasy oficial, tu presupuesto del GP siguiente **no es fijo**: se calcula mirando **cuánto vale tu equipo** (la suma de los precios actuales de tus pilotos + constructor + equipo + el dinero que te sobró). A esto se le llama *salary cap* o tope de salario.

Eso tiene una consecuencia en cadena:

- Si tus pilotos **van bien**, sus precios suben → tu equipo vale más → **tu cap sube** → puedes comprar mejor.
- Si tus pilotos **van mal o se lesionan**, sus precios bajan → tu equipo vale menos → **tu cap baja** → no puedes reponerte.

Esa cadena se llama **ratchet** (mecanismo de "solo hacia arriba para el rico, solo hacia abajo para el pobre"). Y produce la **espiral de la muerte**: perder te hace más pobre, y ser más pobre te hace más difícil volver a ganar. La lesión castiga **doble o triple**: el piloto no puntúa, su precio cae, *y* el cap de quien lo tiene se encoge.

> El objetivo del producto —"que una mala racha no quite las ganas de seguir jugando"— es **exactamente** lo que el ratchet rompe. Un jugador que arranca mal no puede "comprar" su forma: el sistema la lee en los precios de sus activos y le castiga dos veces.

## 1.2 Glosario (todos los términos, en claro)

| Término | Qué significa, en humano |
|---|---|
| **Presupuesto** | El dinero que tienes para montar tu lineup en un GP. |
| **Salary cap** | El tope máximo que puedes gastar. En el oficial, es tu "valor de equipo". |
| **Ratchet** | Mecanismo por el que el presupuesto de hoy depende de tus resultados de ayer. Es la raíz de la injusticia. |
| **Espiral de la muerte** | Perder → tu presupuesto baja → no puedes reponerte → sigues perdiendo. |
| **Carry** | El dinero "ahorrado" (lo que no gastaste) que se lleva al GP siguiente, como un pequeño bonus. |
| **Sin usar** | El sobrante: `presupuesto − coste de tu lineup`. |
| **Valor de mercado** | Cuánto vale tu equipo hoy (suma de precios actuales). En el oficial **gobierna** tu presupuesto; en el nuestro solo es una **métrica de vanidad** (la ves, pero no te castiga). |
| **P0** | Precio de apertura de un piloto al inicio de la temporada (su "valor base"). |
| **Precio** | Lo que cuesta un piloto en un GP concreto. Sube o baja según su forma. |
| **Lineup** | Tu alineación: 2 oro + 2 plata + 1 constructor + 1 equipo. |
| **Oro / Plata** | Dos tipos de casilla de piloto. Oro puntúa al 100%, plata al 50%. |
| **Constructor** | La marca de la moto. **No es lo mismo que el equipo.** |
| **Equipo** | El box que compite (el "squad"). **No es intercambiable con el constructor.** |
| **Lockout** | Cierre de cambios. Una vez cerrado el GP, no puedes tocar el lineup ni cambian los precios. |
| **Lesión** | Baja confirmada de un piloto. En el oficial hunde su precio y el cap de su dueño. |
| **Pmax** | Puntuación máxima de referencia de un piloto en un GP (para normalizar). Provisional: 60. |
| **perf** | Índice de rendimiento 0–100 de un piloto en un GP (sus puntos ÷ Pmax, topado a 100). |
| **W** | Índice ponderado de los últimos 3 GPs (50% actual, 30% anterior, 20% el de antes). Mide la "tendencia". |
| **Piso de precio** | Un precio nunca baja de `0.25·P0`. Nadie se vuelve gratis. |
| **Techo de precio** | Un precio nunca sube de `2.00·P0`. Nadie se vuelve inalcanzable. |
| **Límite de concentración** | Máx. 2 pilotos del mismo constructor/equipo en tu lineup. Evita "apostar todo a un constructor". |
| **Gini** | Medida de desigualdad (0 = todos iguales, 1 = todo en manos de uno). Aquí: qué tan desigual es el presupuesto entre jugadores. |
| **Recuperación** | Si el jugador con peor arranque vuelve a tener poder de compra. Ratio presupuesto(tarde)/presupuesto(inicio). |
| **B** | Presupuesto base por GP. Provisional: 100. |
| **t** | Tasa de carry (qué % del sobrante se lleva). Provisional: 25%. |
| **cmax** | Tope del carry (máximo que puedes llevarte). Provisional: 8. |
| **PROVISIONAL** | Valor configurable por temporada, no está grabado en piedra. Se calibra antes del MVP. |
| **season_rules** | La "caja" versionada donde viven B, t, cmax y las tablas de puntuación. Nunca se hardcodean. |

## 1.3 Las 5 opciones, explicadas en claro

### Opción A — Presupuesto fijo por GP
Cada GP todos empiezan con **100**. Punto. No se lleva nada.

- **Analogía:** un sueldo fijo mensual, sin ahorros que cuenten.
- ✅ Máxima igualdad. Cero ratchet. Trivial de explicar.
- ❌ No premia a quien gestiona bien el dinero. El sobrante se pierde (incentiva gastar "a ciegas"). Menos profundidad.

### Opción B — Presupuesto acumulado (EL OFICIAL)
Cap siguiente = **valor de tu equipo + dinero sin usar**.

- **Analogía:** tu sueldo depende de cuánto vale tu casa.
- ✅ "Realista" (mercado). Premia tener activos que suben.
- ❌ **Ratchet → espiral de la muerte.** La lesión castiga triple. Difícil de explicar ("¿por qué mi cap bajó?").
- ❌ Nuestra simulación lo demuestra: **dos jugadores que empiezan idénticos terminan con cap 89 vs 103** (ver §1.4).

### Opción C — Dinámico con límites
El cap se ajusta por **rendimiento del jugador**, con un suelo y un techo.

- **Analogía:** un sueldo variable según tu evaluación, con un mínimo y un máximo.
- ✅ Intenta premiar a los buenos sin espiral.
- ❌ Muy complejo. "Rendimiento del jugador" es **circular** (presupuesto → resultados → presupuesto). Difícil de auditar y de explicar. Añade *más* fuentes de percepción de injusticia.

### Opción D — Separar valor de mercado y presupuesto
Dos monedas: (1) **valor de mercado** (solo informativo) y (2) **presupuesto disponible** (fijo o con carry).

- **Analogía:** puedes *ver* cuánto vale tu casa, pero tu sueldo **no depende de ella**.
- ✅ Claridad: el valor de mercado deja de gobernar tu presupuesto.
- ❌ Por sí solo no dice cómo evoluciona el presupuesto. **Es un principio, no una opción completa** — se combina con A o E.

### Opción E — Híbrido: base fija + carry limitado ⭐ RECOMENDADA
Presupuesto del GP = **`B + carry`**, donde `carry = min(tasa × sin_usar_previo, tope)`.

- **Analogía:** un sueldo fijo de 100, más un **pequeño bonus (máx. 8)** si ahorraste el GP anterior. Tu sueldo **nunca depende del mercado**.
- ✅ **Rompe el ratchet:** tu presupuesto no depende del valor de mercado de tus activos.
- ✅ **Premia la eficiencia** con un carry acotado (ahorrar da ventaja, pero limitada).
- ✅ **Recuperación garantizada:** un mal arranque **no reduce tu base**.
- ✅ **Simple de explicar:** "cada GP tienes 100, más hasta 8 si no gastaste todo".
- ⚠️ El carry puede incentivar no gastar; el tope lo mitiga (8 sobre 100 = 8%).

## 1.4 El corazón de la comparación: oficial (B) vs. el resto

Con los números de la simulación (datos ficticios, 6 GPs, 6 jugadores). Lo que se mide es **poder de compra**, no puntos — la puntuación es idéntica en ambos sistemas.

### a) La mala racha: ¿es permanente o no?

Jugador **P4 "mal arranque"**: su estrella se lesiona en el GP3.

| Sistema | Su presupuesto a lo largo de la temporada | ¿Se recupera? |
|---|---|---|
| **OFICIAL (B)** | 100 → 99 → **84** → 83 → **82** → 83 | ❌ **No.** Pierde ~17% de poder de compra **para siempre**. Ratio de recuperación = **0.83**. |
| **NUESTRO (E)** | 100 → 108 → 108 → 108 → 108 → 108 | ✅ **Sí.** Vuelve a 108 e incluso supera su base. Ratio = **1.08**. |

> En el oficial, una mala racha (una lesión, una racha de DNFs) te deja **permanentemente más pobre** → no puedes reponerte → se te quitan las ganas. En E, tu base es siempre 100: la mala racha te castiga **en puntos**, no en tu capacidad de seguir jugando.

### b) ¿La suerte (no el skill) decide tu destino?

Jugadores **P5 y P6**: empiezan **idénticos** (mismo presupuesto, mismo coste 69). Solo toman decisiones distintas.

| Sistema | Cap final de P5 | Cap final de P6 | Diferencia |
|---|---|---|---|
| **OFICIAL (B)** | **89** | **103** | **14** (¡por pura suerte!) |
| **NUESTRO (E)** | **108** | **108** | **0** |

La única razón de la diferencia en el oficial: **el piloto B (de P5) se lesionó**. P5 no hizo nada peor que P6, pero su cap se encogió porque *su activo* bajó. En E, ambos terminan en 108: **tu presupuesto no depende de qué activos subieron o bajaron, sino de tu gestión.**

### c) ¿Se puede "hacer el rico" sin merecerlo?

Jugador **P3 "value"**: compra barato y gasta poco.

- **OFICIAL (B):** su cap **sube hasta 116** (se aprovecha de que sus activos suben).
- **NUESTRO (E):** llega a 108 (el tope). Se premia, pero **acotado**.

### d) Desigualdad global (Gini)

| Sistema | Gini final | Lectura |
|---|---|---|
| **OFICIAL (B)** | **0.0653** | Más desigual |
| **NUESTRO (E)** | **0.0412** | **37% más igualitario** |

## 1.5 Tabla comparativa completa

| Criterio | A Fijo | **B Oficial** | C Dinámico | D Separado | **E Híbrido ⭐** |
|---|---|---|---|---|---|
| Rompe el ratchet | ✅ | ❌ | ⚠️ | ✅ | ✅ |
| Premia la eficiencia | ❌ | ✅ | ✅ | ⚠️ | ✅ (acotado) |
| **Recuperación tras mala racha** | ✅ | ❌ | ⚠️ | ✅ | ✅ |
| Simplicidad de explicar | ✅ | ❌ | ❌ | ✅ | ✅ |
| Profundidad estratégica | Baja | Alta (punitiva) | Alta (opaca) | Media | **Media-alta (justa)** |
| Auditabilidad | ✅ | ⚠️ | ❌ | ✅ | ✅ |
| **Riesgo de espiral de muerte** | Ninguno | **Alto** | Medio | Ninguno | **Ninguno** |

## 1.6 Por qué E es la que cumple el objetivo

El requisito era: **justo + que una mala racha no quite las ganas de seguir jugando.**

E lo cumple por tres razones concretas:

1. **Tu base nunca baja.** Siempre empiezas con 100. Una lesión o una racha mala te restan **puntos**, no **poder de compra futuro**. En el oficial te restan ambas cosas.
2. **No hay suerte que decida tu economía.** P5 y P6 lo demuestran: en el oficial, lesionarse un piloto te deja 14 puntos de cap por debajo de un rival idéntico. En E, eso no existe.
3. **Sigue habiendo profundidad** (el carry premia ahorrar, el motor de precios premia detectar infravalorados), pero **acotada**: el bonus máximo es 8 (8% de la base). No hay espiral, ni hacia arriba ni hacia abajo.

Y además es la más **transparente**: tu presupuesto es una fórmula pública de dos términos (`100 + min(0.25 × sobrante, 8)`). Cualquiera puede auditarlo. El oficial ("¿por qué mi cap bajó?") no.

> **Nota importante:** todos los números (100 / 25% / 8) son **PROVISIONAL** y viven en `season_rules`, configurables por temporada. Antes del MVP hay que cerrar la calibración (tareas D-01/D-02 del backlog) y re-simular con datos reales de una temporada completa para confirmar que Gini < 0.05 y recuperación > 0.95.

---

# PARTE 2 — Profundización

## 2.1 El motor de precios, paso a paso

**Pregunta que responde:** ¿cuánto cuesta un piloto en el GP `r+1`, sabiendo cómo ha ido hasta ahora?

La fórmula completa (versión v1, versionada):

```
perf(r)      = min(100, puntos(r) / Pmax × 100)   // índice 0–100 del GP
W(r)         = 0.5·perf(r) + 0.3·perf(r−1) + 0.2·perf(r−2)   // tendencia (últimos 3)
objetivo(r+1)= P0 × (0.75 + 0.5 × W(r)/100)        // precio "justo" según forma
precio(r+1)  = precio(r) + 0.5 × (objetivo − precio(r))      // deriva la mitad hacia el objetivo
precio(r+1)  ← acotado a [0.85·precio(r), 1.15·precio(r)] y [0.25·P0, 2.00·P0]
```

### Cada pieza, en humano

1. **`perf` — "¿qué tal lo hizo este GP?"**
   Sus puntos divididos por su máximo de referencia (Pmax), en escala 0–100. Si Pmax=60 y saca 54 puntos → `perf = 90`. Topado a 100 para que el índice no se dispare.

2. **`W` — "¿va en racha o en caída?"**
   Media ponderada de los últimos 3 GPs, dando más peso al presente: 50% actual, 30% anterior, 20% el de antes. Un piloto en racha sube su W; uno en caída, lo baja.

3. **`objetivo` — "el precio justo según su forma"**
   Es el precio al que *debería* estar el piloto. La clave:
   - `W = 0` (forma pésima) → objetivo = `0.75·P0` (el mínimo).
   - `W = 50` (forma media) → objetivo = `1.00·P0` (**punto neutro**: ni sube ni baja).
   - `W = 100` (forma perfecta) → objetivo = `1.25·P0` (el máximo).

   Es decir, **el precio solo se aleja de P0 cuando hay una tendencia real**, y como mucho un 25% arriba o abajo.

4. **El `0.5` — "deriva, no salta"**
   El precio no salta al objetivo de golpe: cada GP se mueve **la mitad** de la distancia que le falta. Esto evita swings brutales y hace que el mercado sea predecible.

5. **Las acotaciones — "los topes de seguridad"**
   - `[0.85·prev, 1.15·prev]`: ningún precio se mueve más del **15%** en un solo GP.
   - `[0.25·P0, 2.00·P0]`: ningún precio baja de la cuarta parte ni sube del doble de su precio de apertura. Nadie se vuelve gratis ni inalcanzable.

6. **Casos especiales**
   - **Lesión confirmada** para el GP siguiente: `precio = max(0.25·P0, 0.5·precio_actual)`. Se corta a la mitad, pero nunca por debajo del piso.
   - **Baja por temporada**: `precio = 0.25·P0` (directo al piso).

### Ejemplo 1 — Piloto en racha (sube el precio)

Piloto "Lucía", `P0 = 20`, `Pmax = 60`. Saca **54 puntos** en GP1, GP2 y GP3 (forma constante). `perf = min(100, 54/60×100) = 90` en cada GP. Precio de apertura (GP1) = `P0 = 20`.

| Paso | Cálculo | Resultado |
|---|---|---|
| **Precio GP1** | apertura | **20.00** |
| Tras GP1 → precio GP2 | `W(1) = 0.5·90 = 45` (sin historia) → `objetivo = 20×(0.75+0.5·45/100) = 19.50` → `20 + 0.5·(19.50−20)` | **19.75** |
| Tras GP2 → precio GP3 | `W(2) = 0.5·90 + 0.3·90 = 72` → `objetivo = 20×(0.75+0.36) = 22.20` → `19.75 + 0.5·(22.20−19.75)` | **20.98** |
| Tras GP3 → precio GP4 | `W(3) = 0.5·90 + 0.3·90 + 0.2·90 = 90` → `objetivo = 20×(0.75+0.45) = 24.00` → `20.98 + 0.5·(24.00−20.98)` | **22.49** |

Lectura: el precio **sube de forma gradual** (20 → 19.75 → 20.98 → 22.49) a medida que la tendencia (W) se consolida. En el GP1 el precio incluso baja un poco porque, sin historia, W=45 está por debajo del punto neutro (50). A partir de que W supera 50, el precio empieza a subir.

### Ejemplo 2 — Lesión (baja el precio, con piso)

Piloto con `P0 = 20`, precio actual `20`. Se confirma su lesión para el GP siguiente:

```
precio = max(0.25·P0, 0.5·precio_actual) = max(0.25×20, 0.5×20) = max(5, 10) = 10
```

El precio se **corta a la mitad** (20 → 10), pero el piso `0.25·P0 = 5` garantiza que nunca se vuelva gratis. (Este es el ejemplo verificable de referencia: `lesión P0=20, prev=20 → 10`.)

### Ejemplo 3 — Forma media (el precio no se mueve)

`P0 = 20`, precio actual `20`, `W = 50`:

```
objetivo = 20 × (0.75 + 0.5·50/100) = 20 × 1.00 = 20
precio   = 20 + 0.5·(20 − 20) = 20
```

Con forma exactamente media, el precio **se queda en P0**. (Ejemplo verificable: `P0=20, prev=20, W=50 → 20`.)

> **Todo movimiento de precio queda registrado** (`activo, gp, precio_previo, precio_nuevo, motivo (fórmula|manual), versión_fórmula`), así que cualquier cambio es auditable.

## 2.2 Un GP completo de principio a fin

**Pregunta que responde:** ¿cómo fluye el dinero en un GP concreto?

Jugadora **Ana**, GP5. Presupuesto disponible: **102.00** (100 base + 2.00 de carry del GP4).

Lista de precios congelada del GP5 (fragmento):

| Activo | Tipo | Precio GP5 |
|---|---|---|
| A | Piloto | 26.00 |
| C | Piloto | 20.00 |
| E | Piloto | 14.00 |
| H | Piloto | 7.00 |
| X | Constructor | 8.00 |
| X-team | Equipo | 6.00 |

### Paso a paso

1. **Presupuesto disponible:** `102.00`.
2. **Ana elige su lineup** (2 oro + 2 plata + 1 constructor + 1 equipo):
   - Oro: **A (26.00)**, **C (20.00)**
   - Plata: **E (14.00)**, **H (7.00)**
   - Constructor: **X (8.00)**
   - Equipo: **X-team (6.00)**
3. **Coste del lineup:** `26 + 20 + 14 + 7 + 8 + 6 = 81.00`.
4. **Validación server-side:** `81.00 ≤ 102.00` ✅. El servidor recalcula el coste con la lista de precios congelada; el cliente nunca envía el coste ni el presupuesto.
5. **Sin usar:** `102.00 − 81.00 = 21.00`.
6. **Carry para el GP6:** `min(0.25 × 21.00, 8.00) = min(5.25, 8.00) = 5.25`.
7. **Presupuesto del GP6:** `100.00 + 5.25 = 105.25`.

### ¿Y si hubiera gastado de otra forma?

| Escenario | Coste | Sin usar | Carry `min(0.25·s, 8)` | Presupuesto GP6 |
|---|---|---|---|---|
| Gasta poco (lineup barato) | 76.00 | 26.00 | `min(6.50, 8) = 6.50` | **106.50** |
| Gasta casi todo | 95.00 | 7.00 | `min(1.75, 8) = 1.75` | **101.75** |
| Gasta muy poco (toca el tope) | 62.00 | 40.00 | `min(10.00, 8) = 8.00` ⛔ tope | **108.00** |

Lectura clave: **el presupuesto siempre queda cerca de 100**, entre 100 y 108. Ahorrar da una pequeña ventaja (hasta +8), pero **el tope `cmax=8` impide que el carry se dispare**. Y lo más importante: **no importa si tus pilotos suben o bajan de precio** — tu presupuesto del GP6 depende solo de cuánto gastaste, no del valor de mercado. (Ejemplos verificables: `sin_usar=8 → 102`; `sin_usar=40 → 108` por tope.)

> Las **puntos** del lineup se calculan aparte (motor de puntuación, `scoring.md`) y no afectan al presupuesto. La economía y la puntuación son independientes: el presupuesto decide qué puedes comprar; los puntos miden cómo te fue.

## 2.3 La calibración antes del MVP

**Pregunta que responde:** ¿cómo se afinan B, t y cmax (y el motor de precios) antes de lanzar?

Los valores `100 / 25% / 8` son un **punto de partida razonable**, pero son `PROVISIONAL`. La razón: la simulación de `economy.md` usa **datos ficticios**. La volatilidad real de precios, la frecuencia real de lesiones y la distribución real de rendimiento de los pilotos van a desplazar el equilibrio. Por eso, **antes del MVP** hay que calibrar con datos reales de una temporada completa.

### El bucle de calibración

1. **Partir de los valores provisionales** (`B=100`, `t=0.25`, `cmax=8`, `Pmax=60`).
2. **Ejecutar la simulación económica** (`npm run simulate`) sobre datos reales de una temporada completa.
3. **Medir las métricas de equilibrio** (ver tabla abajo).
4. **Ajustar el parámetro que falla** (ver guía de ajuste).
5. **Re-simular** hasta que todas las métricas pasen.
6. **Congelar los valores** en `season_rules` para la temporada (versión nueva, nunca mutar la publicada).

### Métricas y metas (las "puertas" que debe pasar)

| Métrica | Qué mide | Meta |
|---|---|---|
| **Gini del presupuesto** | Desigualdad de presupuesto entre jugadores por GP | **< 0.05** |
| **Recuperación** | Ratio presupuesto(tarde)/presupuesto(inicio) del jugador con peor arranque | **> 0.95** |
| **Diversidad de lineups** | % de lineups únicos entre jugadores por GP | **> 70%** |
| **Concentración** | % de lineups con 2 pilotos del mismo constructor | **< 40%** |
| **Eficiencia del gasto** | Distribución de `sin_usar` (media, p95) | media **< 20% de B** |

### Guía de ajuste (si una métrica falla)

| Si falla… | Probable causa | Ajuste |
|---|---|---|
| **Gini alta** (muy desigual) | El carry o la base crean brecha | Subir `B` y/o bajar `t`/`cmax` |
| **Recuperación baja** | La base no protege lo suficiente | En E la recuperación es estructural (base siempre = B); revisar el motor de precios (piso de precio) |
| **Diversidad baja** (todos el mismo lineup) | La economía no crea diferenciación | Ajustar la sensibilidad del motor de precios (ampliar la banda objetivo) |
| **Concentración alta** | Nadie reparte riesgo | Revisar el límite de concentración (máx. 2 por constructor/equipo) |
| **Eficiencia baja** (todos ahorran mucho) | El carry es demasiado atractivo | Bajar `t` y/o `cmax` |

### Tareas del backlog que cierran esto

- **D-01 / D-02** — Calibración de la economía (B, t, cmax) y del motor de precios (Pmax, bandas). **Obligatorias antes del MVP.**
- **T-15** — Re-simulación económica con datos reales: debe pasar Gini < 0.05, recuperación > 0.95, diversidad > 70%.
- **D-03** — Validación del límite de concentración (se valida por separado, no está en la simulación base).

> **Regla de oro:** calibrar ⇒ nueva versión de `season_rules` ⇒ actualizar los golden files ⇒ tests. Nunca se muta una versión publicada ni se hardcodean los valores.
