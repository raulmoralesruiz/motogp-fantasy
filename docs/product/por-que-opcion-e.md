# Por qué la opción E supera al modelo oficial

> Versión accesible (sin tecnicismos) del argumento central del producto, con ejemplos de la **simulación sobre la temporada 2026 real** (`simulacion-2026.md`).
> Documentos técnicos de referencia: `economy.md` (opciones A–E) y `docs/decisions/0002-economy-model.md`.

## El problema en una frase

En el juego oficial, **el presupuesto que tienes para el siguiente Gran Premio depende del valor de mercado de tu equipo**. Y eso castiga exactamente a quien más lo necesita.

### La analogía: un salario que depende del valor de tu casa

Imagina que tu sueldo mensual no es fijo, sino que se calcula con el valor de tu casa:

- Si tu casa **sube** de precio, al mes siguiente cobras más.
- Si tu casa **baja** de precio, al mes siguiente cobras menos.
- Y como cobras menos, te ves obligado a vender cosas de la casa para llegar a fin de mes, lo que **baja aún más su valor**, lo que hace que el mes siguiente cobres aún menos…

Eso es lo que hace el modelo oficial (que en los documentos llamamos **opción B**): tu presupuesto del GP siguiente es el valor de mercado de tu lineup. Si tu estrella gana, su precio sube y tu presupuesto sube. Si tu estrella se cae, su precio se hunde y **tu presupuesto se hunde con él**. Y con menos presupuesto tienes que vender tus mejores activos, lo que hunde aún más el valor… Es la **espiral de la muerte**: una mala racha (lesiones, caídas, un mal fin de semana) no se recupera, se acumula.

## Nuestra propuesta: salario fijo + prima por ahorrar

La **opción E** (la que usamos en este producto) cambia la regla:

> **Cada Gran Premio arrancas con una base fija (B=100, PROVISIONAL) más una pequeña prima por lo que ahorraste en el GP anterior (25% de lo sin usar, con tope de 8).**

Con la analogía: cobras un **salario fijo** cada mes, y si ahorraste el mes anterior, recibes una **prima pequeña y con tope**. Dos consecuencias:

1. **Una mala racha no te hunde el sueldo.** Tu estrella se cae y su precio baja: puedes comprarla más barata, pero tu presupuesto sigue ahí (100 + tu prima). No entras en espiral.
2. **Gestionar bien se premia, pero con tope.** Ahorrar da una prima de hasta 8 (8% de la base). No es una fortuna: no crea ventaja acumulativa ni separa "ricos" y "pobres".

La diferencia con un presupuesto simplemente fijo (sin prima) es que **hay un incentivo real a gestionar el dinero**: comprar bien sigue importando, pero sin el castigo del ratchet.

## El ejemplo real: Francesco Bagnaia en 2026

Tomemos un caso de la temporada 2026 real. Un jugador que "ancla" a Bagnaia (se lo queda aunque rinda mal) vio esto en la simulación:

| Momento                    | Modelo oficial (B) | Opción E  |
| -------------------------- | ------------------ | --------- |
| GP 1                       | 100                | 100       |
| GP 12 (su peor momento)    | **61.6**           | 108       |
| GP 17 (final de temporada) | **74.6**           | **107.7** |

Con el modelo oficial, en la mitad de la temporada ese jugador tenía un **38% menos de presupuesto** que al inicio, y al final de la temporada **sigue un 25% por debajo** del punto de partida. Su mala racha no se recuperó: se convirtió en una sentencia.

Con la opción E, el mismo jugador **termina la temporada con más presupuesto del que tenía al empezar** (107.7), porque el carry limitado le fue devolviendo lo que ahorró. La mala racha doló (perdió puntos), pero **no le cambió el nivel de juego**.

## La temporada completa: 40 jugadores simulados

Simulamos la temporada 2026 real (17 GPs, datos de PulseLive) con 40 jugadores de perfiles distintos (favoritistas, ahorradores, value, mal arranque…) bajo cada modelo:

|                                                                 | Modelo oficial (B)        | Opción E                    |
| --------------------------------------------------------------- | ------------------------- | --------------------------- |
| Jugadores que en algún GP cayeron por debajo del 90% de la base | **36 de 40**              | **0 de 40**                 |
| Jugadores que terminaron la temporada por debajo de la base     | **26 de 40**              | **0 de 40**                 |
| Presupuesto del jugador peor parado al final                    | **55.8** (56% de la base) | **107.1** (107% de la base) |
| Desigualdad final (Gini)                                        | 0.063                     | **0.001**                   |
| Puntos por jugador (contexto)                                   | 757.6                     | 765.2                       |

Cómo leerlo:

- **36 de 40** significa que bajo el modelo oficial, _casi cualquiera_ cae en espiral en algún momento de la temporada. No es un caso extremo: es la norma.
- El jugador peor parado termina con **55.8** de presupuesto: le queda poco más de la mitad de lo que tenía al empezar. Eso significa que los últimos GPs de la temporada los juega en modo supervivencia.
- El **Gini** mide la desigualdad (0 = todos iguales, 1 = todo en manos de uno). 0.063 vs 0.001: la opción E mantiene a todos en el mismo nivel; el modelo oficial separa a los jugadores en "con presupuesto" y "sin presupuesto".
- Los **puntos** son solo contexto: no es que E dé más puntos, es que los jugadores no se ven obligados a desmantelar su equipo para sobrevivir.

## "Pero entonces, ¿los precios ya no importan?"

Sí importan, y mucho. La opción E **no toca el mercado**: los precios suben y bajan con el rendimiento, igual que en el modelo oficial (en la simulación son exactamente los mismos para ambos modelos). Solo cambia **de dónde sale tu presupuesto**.

Ejemplos reales de 2026 (mismo mercado en ambos modelos):

- Marco Bezzecchi: de 17.6 a **6.7** (−62%) — una caída de rendimiento se refleja en el precio.
- Joan Mir: de 7.7 a **1.9** (−75%).
- Marc Márquez: de 25.0 a **26.8** (+7%) — el rendimiento también sube precios.

La lectura del mercado sigue siendo **la** habilidad del juego: comprar barato y vender caro. Lo que cambia es que una mala lectura ya no te condena a la espiral: el siguiente GP vuelves a tener tu base completa.

## Lo que la opción E NO hace (para ser honestos)

- **No perdona una mala gestión.** Si gastas mal el presupuesto (compras caras sin valor), el siguiente GP no tienes prima. El carry premia el ahorro, no el despilfarro.
- **No es magia: los parámetros son PROVISIONAL.** B=100, 25% y tope 8 son valores de partida que se calibrarán antes del lanzamiento (tareas D-01/D-02 del backlog, con re-simulación como puerta: Gini < 0.05, recuperación > 0.95, diversidad > 70%). La simulación valida la **mecánica**, no los números exactos.
- **La simulación tiene límites conocidos** (`simulacion-2026.md` §6): el lineup se reconstruye cada GP sin coste (en el juego real hay transfers y lockout), y la puntuación usa solo la carrera principal. Ambos efectos son conservadores a favor de la igualdad.

## En una línea

El modelo oficial convierte una mala racha en una sentencia (tu presupuesto depende del valor de tu equipo); la opción E convierte la mala racha en una oportunidad (tu presupuesto es fijo y los precios caídos te dejan comprar barato), premiando con un tope a quien gestiona bien. **La ventaja la da la lectura del mercado, no la suerte.**

---

_Datos: simulación sobre la temporada 2026 real (17 GPs, 22 pilotos, 40 jugadores simulados) — `docs/product/simulacion-2026.md`. Parámetros PROVISIONAL._
