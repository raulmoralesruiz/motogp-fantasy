# ADR-0013: Semántica de la afiliación "desde el GP X en adelante" (US-06)

- **Estado:** Aceptado (implementado en US-06, 2026-10-19)
- **Fecha:** 2026-10-19
- **Relacionado:** US-06, invariante 5 (constructor ≠ equipo), ADR-0012 (import de calendario — mismo patrón de "relleno idempotente con informe").

## Problema

US-06 debe permitir al admin asignar el equipo de un piloto. Un cambio de equipo a mitad de temporada (p. ej. un fichaje) afecta al GP del fichaje y a todos los siguientes, pero **no** a los anteriores: la afiliación es por GP (unique `(rider, gp)`) y el CA de US-06 lo exige explícitamente (test). Hacer una asignación manual por GP (~20 por temporada) es lento y propenso a errores; hace falta una operación "desde el GP X en adelante". La pregunta de diseño es qué debe pasar con los GPs siguientes que **ya tienen** una afiliación.

## Opciones

1. **Sobrescribir todos los GPs siguientes** (el GP X y todos los de la temporada, con o sin afiliación previa).
2. **Rellenar solo los GPs sin afiliación** (elegida): el GP X y los siguientes de la misma temporada que no tengan afiliación; los existentes se **saltan y se reportan** con el motivo; los GPs anteriores nunca se tocan.
3. **Solo el GP X** (sin efecto en adelante; el admin repite la operación GP a GP).

### Pros/Contras

- 1: simple, pero destruye información: si el admin ya había fijado una afiliación concreta para un GP futuro (p. ej. un fichaje puntual ya registrado), se pisa sin aviso; además obliga a re-crear lo que ya estaba bien.
- 2: idempotente y segura frente a re-ejecuciones (repetir la operación no crea ni sobreescribe nada); el informe de `skipped` (GP + motivo en español) deja al admin ver exactamente qué no se aplicó y por qué; nunca toca el pasado (CA US-06).
- 3: no resuelve el problema original (sigue siendo GP a GP).

## Decisión

Opción 2. `setRiderAffiliationFrom({ riderId, fromGpId, teamId })`:

- Transacción atómica; rellena el GP de inicio y todos los GPs de la **misma temporada** con `round >= fromGp.round` que no tengan afiliación.
- Los GPs siguientes que ya tengan afiliación se **saltan** (no se sobreescriben) y se reportan: `{ gpId, round, reason }` con motivo en español (p. ej. `La ronda 5 ya tiene afiliación (Equipo X)`).
- Los GPs anteriores (`round < fromGp.round`) nunca se modifican.
- El constructor de cada afiliación se deriva del equipo en el servidor (invariante 5: el cliente nunca lo envía).
- Auditoría (T-09): `affiliation.set` por cada GP creado (before/after) + un resumen `affiliation.range_set` (entidad = piloto) con `created` y `skipped`.
- Para corregir un GP concreto existe el ajuste fino `setRiderAffiliation` (reemplaza, auditado before/after; no-op sin auditar si es la misma afiliación).

## Consecuencias

- La operación es **idempotente**: re-ejecutarla no crea ni sobreescribe nada (lo que no existía ya existe; lo que existía se salta).
- El ajuste fino por GP sigue disponible y es la vía para cambios puntuales, incluido corregir un GP que `setFrom` saltó.
- Patrón de "relleno idempotente con informe" compartido con el import de calendario (ADR-0012): mismo tratamiento de las entradas parciales (informe, no error).
