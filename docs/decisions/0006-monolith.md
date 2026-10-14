# ADR-0006: Monolito modular vs microservicios

- **Estado:** Propuesto
- **Fecha:** 2026-10-13

## Problema

Decidir la topología de despliegue: ¿monolito o microservicios?

## Opciones

1. **Monolito modular** (un despliegue, módulos delimitados) — recomendada.
2. Microservicios (identity, market, scoring, results, leagues separados).
3. Monolito clásico (sin límites de módulo).

## Pros/Contras

- 1 (recomendada): un solo deploy, transacciones locales simples, equipo pequeño; los módulos puros (economy/scoring) aíslan la complejidad.
- 2: escala independiente, pero sobrecarga de infra (redes, contratos, observabilidad, distribuir transacciones) desproporcionada para la escala real.
- 3: rápido al inicio, pero deriva en "big ball of mud"; la complejidad de reglas de juego necesita límites.

## Recomendación

**Opción 1.**

## Justificación

- **Escala acotada:** el tráfico es de jugadores (miles), no de millones; un nodo + Postgres basta.
- **Transacciones:** el presupuesto/lineup/recálculo necesitan transacciones ACID; en monolito son locales y simples.
- **Equipo pequeño:** menos superficie de infra que mantener.
- **Módulos puros:** `economy` y `scoring` sin I/O → la complejidad del dominio queda aislada y testable, con el beneficio de un microservicio sin su coste.

## Impacto de producto

- Iteración rápida en reglas (un solo repo, un solo deploy).
- Menos fallos de integración entre servicios.

## Impacto técnico

- Estructura de módulos con límites de dependencias (ver `overview.md` §3).
- Si en el futuro un módulo necesita escalar independiente (p. ej. importación de datos), se extrae entonces (el contrato ya está definido).

## Riesgos

- El monolito crece → límites de módulo + tests + code review.
- Un fallo tumba todo → el tráfico es acotado; se mitiga con salud y reinicios; no justifica microservicios.

## Validación

- La estructura de módulos se aplica desde el primer commit; los módulos puros (economy/scoring) tienen tests de unit sin I/O.
