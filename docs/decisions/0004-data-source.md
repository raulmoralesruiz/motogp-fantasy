# ADR-0004: Fuente de datos

- **Estado:** Propuesto
- **Fecha:** 2026-10-13

## Problema
No tenemos acceso a APIs privadas del juego oficial ni a datos licenciados. Hay que definir de dónde vienen los resultados de forma **intercambiable, idempotente y con respaldo manual**.

## Opciones
1. **Adapter pattern con contrato de fuente; MVP con PulseLive (pública) + entrada manual; producción con Sportradar (licenciado)** (recomendada).
2. Dependencia única de PulseLive.
3. Solo entrada manual.
4. Dependencia única de Sportradar desde el inicio.

## Pros/Contras
- 1 (recomendada): independencia de proveedor, respaldo manual siempre, escala de coste (gratis → licenciado).
- 2: sin respaldo; PulseLive no es un contrato autorizado/estable.
- 3: viable pero no escalable ni cómodo (todo a mano).
- 4: coste inicial alto sin tracción; requiere contrato.

## Recomendación
**Opción 1.**

## Justificación
- **PulseLive se verificó en vivo** (fase 2): `https://api.motogp.pulselive.com/motogp/v1`, GET sin auth, responde. Es una fuente primaria razonable para el MVP.
- **Ninguna fuente se da por disponible sin verificación.** Sportradar y las bases comunitarias están "por validar" contractualmente.
- La **entrada manual** es el último recurso siempre disponible y cubre cualquier fallo.
- El **adapter pattern** hace que cambiar de fuente no toque el núcleo.

## Impacto de producto
- El MVP funciona sin coste de datos; la calidad de datos mejora al pasar a fuente licenciada.
- La transparencia (proveniencia de cada resultado) refuerza la confianza.

## Impacto técnico
- Contrato `ResultsSource` (ver `integrations.md` §1).
- Importación idempotente (clave natural `gp+event+rider`).
- Mapeo de identidades `riderRef → riders.id` mantenido por el admin.
- Pipeline: normalización → validación (Zod) → import idempotente → provisional → definitivo → recálculo.

## Riesgos
- PulseLive cambia/bloquea → adapter + manual.
- Datos incompletos → el admin completa; se guarda `raw`.
- Mapeo roto → alerta de "sin mapear".

## Validación
- Tests de contrato con fixtures grabadas (PulseLive).
- Test de idempotencia (importar dos veces).
- Verificación en vivo periódica de la fuente (health-check del job).
