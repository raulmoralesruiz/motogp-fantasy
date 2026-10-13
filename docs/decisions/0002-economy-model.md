# ADR-0002: Modelo de economía (presupuesto)

- **Estado:** Propuesto (recomendación principal del producto)
- **Fecha:** 2026-10-13

## Problema
El juego oficial usa un presupuesto **acumulado (ratchet)**: el valor del equipo se convierte en el cap del siguiente GP. Esto crea dependencia de trayectoria y espiral de la muerte. Hay que elegir un modelo más justo y estratégico.

## Opciones
- **A** Fijo por GP (sin carry).
- **B** Acumulado (oficial).
- **C** Dinámico con límites (por rendimiento del jugador).
- **D** Separar valor de mercado y presupuesto.
- **E** Híbrido: base fija + carry limitado.

## Pros/Contras (resumen — detalle en `product/economy.md` §2)
- A: máxima igualdad, pero no premia eficiencia y el dinero se pierde.
- B: ratchet → espiral de muerte; difícil de explicar.
- C: opaco, circular, difícil de auditar.
- D: claridad, pero no define la evolución del presupuesto.
- **E: rompe el ratchet, premia eficiencia (acotada), garantiza recuperación, simple de explicar y auditar.**

## Recomendación
**Opción E** (base fija `B=100` + `carry=min(0.25·sin_usar, 8)`), incorporando el principio D (valor de mercado como métrica informativa).

## Justificación
- La simulación (`economy.md` §7, datos ficticios) muestra: en B, dos jugadores con el mismo presupuesto inicial terminan con cap 89 vs 103 (dependencia de trayectoria); en E, ambos terminan en 108.
- El Gini de riqueza final baja de 0.0653 (B) a 0.0412 (E).
- El jugador con mal arranque recupera (ratio 1.08 en E vs 0.83 en B).

## Impacto de producto
- La ventaja competitiva la da la lectura del mercado, no la inercia de resultados.
- Es fácil de comunicar: "cada GP tienes 100, más hasta 8 si no gastaste todo".

## Impacto técnico
- El presupuesto se deriva de `B + carry + movimientos` (no se almacena un saldo suelto).
- El motor de precios es un módulo puro versionado.
- Tests de unit sobre las fórmulas + re-simulación por temporada.

## Riesgos
- El carry puede incentivar no gastar → tope bajo (8%).
- Parámetros mal calibrados → configurables por temporada + re-simulación.

## Validación
- Tests de unit de las fórmulas (ejemplos con entrada/salida).
- Re-ejecutar la simulación antes de cada temporada y verificar métricas (Gini < 0.05, recuperación > 0.95).
