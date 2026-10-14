# ADR-0005: Modelo de ligas

- **Estado:** Propuesto
- **Fecha:** 2026-10-13

## Problema

Definir cómo funcionan las ligas: tipos, reglas globales vs por liga, multi-liga, invitaciones, permisos, rankings.

## Opciones

1. **Reglas de juego globales + lineups compartidos + multi-liga + ligas como contenedores de miembros/ranking** (recomendada).
2. Reglas por liga (cada liga define su presupuesto/puntuación).
3. Una única liga global (sin ligas privadas).

## Pros/Contras

- 1 (recomendada): comparabilidad de puntos, un lineup por GP por usuario, simplicidad de validación; la privacidad se resuelve con visibilidad por liga.
- 2: máxima flexibilidad, pero rompe la comparabilidad, multiplica la validación y la complejidad de rankings; alto riesgo de percepción de injusticia.
- 3: no cubre el caso de uso principal (jugar con amigos en privado).

## Recomendación

**Opción 1.**

## Justificación

- Las reglas globales garantizan que un lineup valga lo mismo en todas las ligas y que los puntos sean comparables.
- El multi-liga con lineups compartidos es un requisito confirmado del brief.
- La privacidad (ligas ocultas) y la gestión (admin/miembro, invitaciones) se resuelven a nivel de liga sin tocar las reglas de juego.

## Impacto de producto

- Un usuario juega en varias ligas con el mismo esfuerzo (un lineup).
- Los organizadores controlan su liga (miembros, visibilidad, entrada) sin redefinir el juego.

## Impacto técnico

- `leagues`, `league_members`, `league_invites` (ver `data-model.md`).
- Rankings por `(league, user, gp)` derivados de `scores` (que son por `(user, gp)`).
- Autorización por recurso (solo admin de la liga gestiona la liga).

## Riesgos

- Adopción (si nadie crea ligas) → liga de bienvenida pública.
- Multi-cuenta/self-play → política del admin + detección heurística.

## Validación

- Tests de integración: multi-liga (mismos puntos en 2 ligas), unión por código, permisos admin/miembro, expulsión/salida con histórico conservado.
