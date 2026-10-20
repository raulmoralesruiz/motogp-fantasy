# ADR-0016: Anonimización en la eliminación de cuenta (GDPR, D-06, US-03)

- **Estado:** Aceptado (2026-10-20)
- **Fecha:** 2026-10-20
- **Relacionado:** US-03 (perfil/export/eliminación), D-06 (backlog), `security.md` §1.11, `data-model.md` (campos `isAnonymized`/`anonymizedAt` de `User`), ADR-0010 (bootstrap de admin), T-09 (auditoría append-only), invariante 7 (versionado, sin cambios retroactivos silenciosos).

## Problema

US-03 implementa el **derecho de acceso** (exportar mis datos) y el **derecho de supresión** (eliminar mi cuenta) de la RGPD. La política exacta era una decisión pendiente (D-06, `security.md` §5). Preguntas de diseño:

1. ¿Borrar la fila de `users` (hard delete) o **anonimizarla** (conservar la fila, borrar los datos personales)?
2. ¿Qué hacer con los constraints únicos de `email`/`username` (re-registro con el mismo email)?
3. ¿Qué se hace con sesiones, roles, tokens de recuperación, membresías de liga e invitaciones?
4. ¿Qué se hace con los datos de juego (lineups, scores, rankings) que referencian al usuario?
5. ¿Qué se hace con `audit_log` (append-only, con trigger de BD que impide UPDATE/DELETE)?
6. ¿Cómo se garantiza que la eliminación es una acción deliberada (operación destructiva e irreversible)?

## Opciones

1. **Hard delete de la fila de usuario** (cascada a datos de juego): cumplimiento literal del derecho de supresión, pero destruye la integridad de rankings (scores/rankings quedarían huérfanos o exigirían recálculo), rompe la invariante "los resultados no se borran: se corrigen" y deja `audit_log` con `userId` colgando.
2. **Anonimización (elegida)**: conservar la fila, borrar los datos personales, revocar todo el acceso, retirar de ligas y **conservar los datos de juego apuntando al usuario anonimizado**. Integridad de rankings intacta, auditoría consistente, re-registro posible (el email se libera).
3. **Híbrida: anonimizar + hard delete diferido** (p. ej. a los 30 días): más compleja (requiere un job de purga), sin beneficio adicional para el MVP y con riesgo de borrar datos que un ranking aún referencia.

## Decisión

**Opción 2: anonimización en una única transacción.**

### Datos que se anonimizan (transacción atómica)

| Tabla | Acción |
| --- | --- |
| `users` | `email` → `anonimizado.<userId>@invalido.local`; `username` → `usuario-eliminado-<8 chars del id>`; `passwordHash` → sentinela (nunca verifica); `isAnonymized = true`; `anonymizedAt = now` |
| `profiles` | `displayName` → "Usuario eliminado"; `avatarUrl` → null |
| `sessions` | todas revocadas (`revokedAt = now`) → el usuario queda deslogueado en todas partes al instante |
| `password_reset_tokens` | borrados (dato personal sin valor de integridad) |
| `user_roles` | borrados (incluido `global_admin`) |
| `league_members` | `status → left`, `leftAt = now` (sale de todas las ligas) |
| `league_invites` creadas por el usuario | revocadas |
| **Datos de juego** (`lineups`, `lineup_changes`, `budget_movements`, `scores`, `rankings`, …) | **conservados**, apuntando al usuario anonimizado (histórico anonimizado; integridad de rankings) |
| `audit_log` | **conservado** (append-only por trigger de BD; integridad > PII). La entrada de la eliminación (`user.account_deleted`) **no incluye PII** en before/after: solo `userId`, `anonymizedAt` y contadores (sesiones revocadas, membresías cerradas, …) |

### Semántica de los placeholders

- **Email:** `anonimizado.<userId>@invalido.local` — determinista (mismo id → mismo placeholder), imposible de usar como email real (TLD `.local`), y **libera el email original para re-registro** (el `@unique` no choca).
- **Username:** `usuario-eliminado-<primeros 8 chars del id>` — único por construcción (el id es único), legible en rankings.
- **Password:** sentinela fija; `verifyPassword` devuelve `false` para cualquier hash malformado (comportamiento ya existente de `password.ts`), así que **los logins viejos fallan siempre** sin excepciones.

### Guardas e idempotencia

- Requiere **sesión activa + re-introducción de la contraseña** (operación destructiva; confirmación explícita).
- **Rate-limit: 3 eliminaciones/hora por usuario** (Redis, mismo patrón que login/recuperación).
- Ya anonimizado → `PRECONDITION_FAILED` (la 2ª eliminación no modifica nada: idempotente).
- Un `global_admin` **puede eliminar su propia cuenta: permitido + auditado**. Caso límite documentado: el sistema puede quedarse sin admin global; la entrada `user.account_deleted` lo registra y el operador puede reasignar el rol (panel/BD). Riesgo aceptado.

### Export (derecho de acceso)

- **Descarga JSON** con: cuenta (id, email, username, displayName, roles, createdAt), sesiones activas, y secciones de juego (lineups, puntos, ligas) — hoy vacías (llegan en Fases 2–4), pero las consultas ya están escritas contra las tablas.
- El servicio es **tablas-driven sobre todas las relaciones de `User`**: cuando lleguen lineups/scores/ligas, export y anonimización los cubren sin cambios.

## Consecuencias

- **Sin migración nueva**: el schema ya trae `isAnonymized`/`anonymizedAt`.
- El email original puede re-registrarse inmediatamente tras la eliminación (la persona vuelve con cuenta nueva; el histórico de juego de la cuenta anonimizada **no se transfiere**).
- Los rankings de las ligas donde participaba conservan la fila anonimizada ("Usuario eliminado"); **no se recalcula ningún ranking** (invariante 7: sin cambios retroactivos silenciosos).
- `audit_log` sigue referenciando el `userId` anonimizado: aceptable (es un identificador, no PII); documentado aquí.
- La retención de logs con PII (anonimizar `before`/`after` tras un periodo) **sigue pendiente** en `security.md` §5 (afecta a todos los actores, no solo a la eliminación de cuenta).
