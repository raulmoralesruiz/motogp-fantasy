# ADR-0022: Rankings por GP y general (US-21)

- **Estado:** Aceptado (2026-10-25) — implementado y verificado (fórmula pura + servicio + orquestación BFF + tests; pendiente de commit)
- **Fecha:** 2026-10-25
- **Relacionado:** US-21 (backlog E5), ADR-0005 (modelo de ligas — rankings derivados de `scores`, por `(league, user, gp)`), ADR-0020/0021 (pipeline de resultados — `results_version`), `leagues.md` §8 (reglas de ranking y desempates, fuente de verdad), `data-model.md` §5 (`rankings` = derivado de `scores`), invariantes 4 y 7 (AGENTS.md §4).

## Problema

`leagues.md` §8 define las reglas ("los rankings se recalculan al publicarse
resultados definitivos y se versionan"; desempates: más GPs ganados → mejor
último GP → menor coste total → antigüedad) y ADR-0005 fija el diseño de alto
nivel (rankings por `(league, user, gp)` derivados de `scores`, que son por
`(user, gp)`). Quedaban abiertas las semánticas concretas que US-21 debe
implementar:

1. ¿Dónde se calcula el ranking y quién lo orquesta (módulo `leagues` vs
   `results` vs BFF), respetando "módulos no importan módulos"?
2. ¿Qué significa "más GPs ganados" cuando dos miembros empatan a 1º en un GP?
3. ¿Cómo se versiona: se sobreescribe la fila o se añade una nueva por
   recálculo?
4. ¿A qué ligas se publican rankings (todas las activas, o solo las que
   puntuaron)?
5. ¿Cómo se mide el "menor coste total de lineups" (desempate 3)?
6. ¿Quién dispara el recálculo de rankings y cuándo?

## Opciones

### 1. Dónde se calcula y quién orquesta

1. **Fórmula pura en `leagues/core` + `LeagueService.recalculateRankings`
   (I/O) + orquestación BFF (elegida):** el orden lo aplica una función pura
   (`sortRanking`, sin I/O — mismo contrato que `economy`/`scoring`); el
   servicio (módulo `leagues`) carga los datos (scores, lineups, costes,
   membresía) y escribe `rankings`; el **router `results`** (capa BFF) llama a
   `leagues.recalculateRankings` tras el definitivo/corrección. Respeta
   "módulos no importan módulos" (`results` no importa `leagues`; es la BFF la
   que compone, como `jobs/`).
2. Calcular en el módulo `results` (el que hace el recálculo): viola la
   dirección de dependencias (los rankings son del dominio `leagues`) y mezcla
   responsabilidades.
3. Job asíncrono (BullMQ) que recalcula rankings: más infraestructura para un
   cálculo derivado y acotado que puede hacerse inline tras el definitivo.

### 2. "Más GPs ganados" con empate a 1º

1. **Máximo estricto (elegida):** un GP "se gana" solo si el miembro es el
   único con la máxima puntuación de ese GP (entre miembros de la liga). Un
   empate a 1º no lo gana nadie. Determinista y evita otorgar la ventaja a dos
   a la vez.
2. Cualquier 1º (empate incluido): otorga la ventaja a varios miembros a la
   vez y puede generar más empates, no menos.
3. Podio (top-3): aleja la semántica de "ganado" (leagues.md §8 dice
   "ganados").

### 3. Versionado

1. **Append (elegida):** cada recálculo añade nuevas filas `Ranking`
   (versionadas por `results_version` + `computedAt`); la lectura (US-15) toma
   la más reciente. Coherente con la invariante 7 (no hay cambios
   retroactivos silenciosos) y el histórico de `results_history`.
2. Sobreescribir la fila `(league, gp, user)`: pierde el histórico y rompe la
   invariante 7 (no se puede auditar cómo evolucionó la posición).

### 4. Alcance de la publicación

1. **Solo ligas con miembros activos que puntuaron (elegida):** el ranking es
   *derivado de `scores`* (`data-model.md` §5); una liga donde nadie puntuó no
   recibe filas (vacío elegante, US-15) y no se cuenta en el retorno.
2. Todas las ligas activas (aunque nadie puntuó): publicaría rankings de 0
   puntos que la UI mostraría como "posición 1 con 0 pts" (engañoso).

### 5. "Menor coste total de lineups"

1. **Suma de los precios de los slots de los lineups de la temporada, a los
   precios del GP (elegida):** coherente con la invariante 2 (el coste se
   calcula con la lista de precios congelada del GP) y con `lineupCost`
   (ADR-0015/0017). Un activo sin precio no cuenta (el lineup no se habría
   podido guardar).
2. Coste de compra histórico (movimientos de presupuesto): mezcla la economía
   (presupuesto) con el ranking (eficiencia de lineup); no es "coste del
   lineup".

## Decisión

### Arquitectura (US-21)

- **Fórmula pura** `sortRanking(inputs)` en `leagues/core/ranking.ts`
  (sin I/O): ordena por puntos (desc) → GPs ganados (desc) → último GP (desc)
  → coste total (asc) → antigüedad (asc). Determinista; no muta la entrada.
- **Servicio** `LeagueService.recalculateRankings(gpId, resultsVersion)`
  (módulo `leagues`, I/O): carga los GPs de la temporada, los `scores`, el
  coste por usuario y la membresía activa; aplica `sortRanking` por liga y
  publica las filas `Ranking` (por GP + general) en una transacción.
- **Orquestación BFF:** el router `results` llama a
  `leagues.recalculateRankings` **después** de `markDefinitive` (si `!noop &&
  resultsVersion`) y de `importEvent` (si `recalculated && resultsVersion`).
  El módulo `results` **no** importa `leagues` (la BFF compone, como `jobs/`).

### Semántica

- **Por GP:** orden por los puntos de ese GP (solo miembros que puntuaron en
  ese GP) + desempates.
- **General (temporada):** orden por la suma de puntos de la temporada (solo
  miembros que puntuaron en algún GP) + los mismos desempates. La fila general
  lleva `gpId = NULL`.
- **Desempates** (leagues.md §8, en orden):
  1. Más GPs ganados (máximo estricto, sin empate — opción 2.1).
  2. Mejor puntuación en el último GP de la temporada (0 si aún no puntuó).
  3. Menor coste total de lineups (opción 5.1).
  4. Antigüedad en la liga (quien se unió antes).
- **Versionado (append):** cada recálculo añade filas nuevas
  (`results_version` + `computedAt`); no se sobreescribe. La lectura (US-15)
  toma la más reciente por `computedAt` (desempate `createdAt`).
- **Alcance:** solo se publican las ligas con miembros activos **que
  puntuaron** en la temporada (opción 4.1); el retorno cuenta esas ligas.
- **Multi-liga (invariante 4):** los puntos por GP son los mismos en todas las
  ligas; la posición SÍ es por liga (los desempates de coste/antigüedad pueden
  diferir).
- **Desempeño de los desempates:** los valores de cada desempate (`gpsWon`,
  `lastGpScore`, `totalCost`) se guardan en `Ranking.tiebreakers` (JSON) para
  auditoría/depuración.

### Disparador y auditoría

- **Disparador:** el definitivo (`markDefinitive`, US-18) y la corrección que
  recalcula (`importEvent`, US-19) — ambos generan una `results_version` nueva,
  que versiona los rankings. Coherente con `leagues.md` §8 ("al publicarse
  resultados definitivos").
- **Auditoría:** la acción disparadora ya se audita (T-09:
  `results.marked_definitive` / corrección). La publicación de rankings es un
  efecto derivado y auditable (filas versionadas + `tiebreakers`); no se añade
  una entrada de auditoría separada (no es una acción sensible de admin, es un
  cálculo derivado).

### Migración

- **Ninguna:** la tabla `rankings` ya existe (T-06) con `results_version`,
  `tiebreakers`, `computed_at`; no hay constraint de unique `(league, gp, user)`
  (el versionado por append lo requiere así).

## Consecuencias

- El router `results` compone el módulo `leagues` (orquestación BFF); el
  dominio `results` sigue sin importar `leagues` (AGENTS.md §3).
- `LeagueService.myRankings` (US-15) pasa de "vacío elegante" a datos reales:
  la home muestra la posición por GP y general.
- US-22 (pantallas de resultados y ranking) y US-28 (ranking por liga con
  desempates) construyen sobre esta base.
- El coste de un lineup se recalcula desde los slots + precios del GP (no se
  confía en un valor almacenado), coherente con la invariante 2.
- Un GP definitivo tiene `scores` **y** `rankings` (por GP + general) para
  cada liga con miembros que puntuaron.

## Validación

- **Unit (fórmula pura):** `sortRanking` (puntos, cada desempate por separado,
  cascada completa en el orden de leagues.md §8, no-mutación, lista vacía, una
  sola entrada) — `leagues/core/__tests__/ranking.test.ts`.
- **Integración:** `recalculateRankings` (ranking por GP, ranking general con
  desempates de GPs ganados + último GP, **desempate de coste** con slots +
  precios reales, versionado por `results_version`, liga sin miembros → sin
  filas, GP inexistente → NOT_FOUND) — `test/integration/rankings.test.ts`.
- **Cobertura:** mantener el gate global fusionado 99.9% (T-24).
