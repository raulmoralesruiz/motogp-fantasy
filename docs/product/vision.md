# Visión de Producto — Fantasy MotoGP Independiente

> Estado: BORRADOR v1 (fase 3 — diseño de producto). Documento vivo; cada decisión relevante se remite a un ADR en `docs/decisions/`.

## 1. Propuesta de valor

Un juego de fantasy de MotoGP **independiente**, jugable en cualquier navegador (móvil, tablet, escritorio), donde:

1. **La economía es justa y estratégica.** El presupuesto no se encoge si tu equipo pierde valor ni se infla si gana. Cada jugador arranca cada Gran Premio con la misma base y decide cómo invertirla. La ventaja la da la *lectura del mercado*, no la *suerte de los resultados previos*.
2. **Es transparente.** Precios, reglas de puntuación, versiones de reglas y recálculos son públicos, versionados y auditables. Un jugador puede explicar por qué su puntuación es la que es.
3. **Es multi-liga.** Un usuario puede jugar en varias ligas a la vez (privada con amigos, pública, de temporada, efímera) con las mismas fichas y lineups.
4. **No depende de licencias ni APIs privadas.** Funciona con fuentes de datos autorizadas (PulseLive público, Sportradar licenciado, bases comunitarias) y con **entrada manual de resultados** como último recurso. Identidad visual propia, sin marcas ni logos licenciados.

## 2. Diferenciación frente al juego oficial

El juego oficial usa un **sistema de presupuesto acumulado**: el valor de tu equipo (suma de precios actuales de tus activos + dinero sin usar) se convierte en tu *salary cap* del siguiente GP. Esto crea una **dependencia de trayectoria** (ratchet):

- Quien empieza ganando → sus activos suben → su cap crece → puede comprar mejor → sigue ganando.
- Quien empieza perdiendo → sus activos bajan → su cap se encoge → no puede reponerse → espiral de la muerte.

Nuestro sistema recomendado (ver `economy.md`) rompe ese ratchet: **base fija por GP + carry limitado**. La simulación (datos ficticios, `economy.md` §7) muestra que en el oficial dos jugadores con el mismo presupuesto inicial terminan con poder de compra muy distinto (cap 89 vs 103) solo por qué activos subieron/bajaron; en el recomendado ambos terminan en 108.

**Ventaja clave:** la competencia se decide por *estrategia de mercado*, no por *inercia de resultados*.

## 3. Audiencia objetivo

| Segmento | Necesidad | Cómo lo cubrimos |
|---|---|---|
| Fan casual de MotoGP | Jugar con amigos, sin fricción | Ligas privadas por código, onboarding en <2 min, mobile-first |
| Fan competitivo | Optimizar, analizar mercado | Historial de precios, métricas, reglas versionadas, recálculos auditables |
| Organizador de liga | Controlar su liga | Panel de admin: reglas por liga, precios, participantes, invitaciones |
| Jugador multi-liga | Unas fichas, varias ligas | Lineups compartidos, rankings por liga y global |

## 4. Principios de diseño

1. **Justicia antes que complejidad.** Si una regla no puede explicarse en una frase, se simplifica.
2. **Transparencia total.** Todo lo que afecta a puntos o presupuesto es visible y versionado.
3. **Reversibilidad.** Resultados provisionales → definitivos, con recálculo auditable. Nada se pierde por un dato mal importado.
4. **El servidor manda.** Toda validación de presupuesto, lineup y lockout es server-side. El frontend nunca es la fuente de verdad.
5. **Independencia de datos.** El núcleo del juego no conoce a ningún proveedor concreto; solo a un contrato de "fuente de resultados".
6. **Mobile-first, responsive.** El 80% del uso será en móvil durante el fin de semana de carrera.

## 5. No-objetivos (out of scope)

- No replicar el juego oficial ni usar su branding, logos ni datos licenciados.
- No depender de APIs privadas del juego oficial (no tenemos acceso).
- No hacer betting real / dinero real (solo puntos ficticios).
- No hacer cobertura en vivo segundo a segundo en el MVP (los resultados se importan por sesión, no en streaming).
- No hacer multijugador en tiempo real / chat en el MVP.

## 6. Métricas de éxito (norte)

| Métrica | Def | Meta MVP |
|---|---|---|
| Activación | % registros que colocan su primer lineup | > 60% |
| Retención semanal | % que vuelve la semana siguiente | > 30% |
| Ligas activas | Ligas con ≥2 lineups colocados en un GP | > 50 |
| Fairness (equidad) | Gini de presupuesto/riqueza entre jugadores por GP | < 0.05 |
| Diversidad de lineups | % de lineups únicos entre jugadores por GP | > 70% |
| Confianza en datos | % de GPs con resultados definitivos sin recálculo manual | > 95% |

## 7. Riesgos de producto principales

1. **Datos incorrectos o tardíos** → frustración y desconfianza. Mitigación: pipeline idempotente, provisional→definitivo, recálculo auditable, entrada manual.
2. **Percepción de injusticia en puntuación** → abandono. Mitigación: reglas versionadas y públicas, ejemplos, soporte de "por qué mis puntos".
3. **Adopción multi-liga** → si nadie crea ligas, el juego no tiene red. Mitigación: ligas públicas por defecto + liga de bienvenida.
4. **Mantenimiento de precios** → si el admin no actualiza precios, el mercado se estanca. Mitigación: fórmula de precios automática + ajuste manual opcional.

## 8. Decisiones pendientes (ver backlog)

- Valores exactos de presupuesto base y carry (provisionalmente 100 / 25% máx 8).
- Tablas de puntuación definitivas (provisional en `scoring.md`).
- Límites de concentración (máx pilotos por constructor/equipo en un lineup).
- Política exacta de cambios de lineup (nº de cambios por GP, wildcard).
