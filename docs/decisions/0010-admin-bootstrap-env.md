# ADR-0010: Bootstrap del rol `global_admin` por variable de entorno (T-08)

- **Estado:** Aceptado (confirmado por el usuario, 2026-10-16)
- **Fecha:** 2026-10-16

## Problema

T-08 (RBAC y autorización por recurso) necesita que el rol `global_admin` sea concedible. `security.md` §1.5 dice "acceso solo con rol `global_admin` (lista blanca de usuarios)" pero no especifica el mecanismo de asignación. En una BD nueva (producción hoy tiene 0 usuarios) no existe aún el panel de admin (épica posterior) ni ningún usuario con el rol: huevo y gallina — para conceder el rol hace falta un admin, y para tener un admin hace falta conceder el rol.

## Opciones

1. **Bootstrap por variable de entorno** (recomendada): `BOOTSTRAP_ADMIN_EMAIL` — el registro del usuario con ese email (minúsculas) recibe `global_admin` en la misma transacción que el registro. Vacía o sin fijar → nadie lo recibe.
2. **Script CLI** (`npm run admin:grant <email>`): script auditable que concede el rol a un usuario ya existente.
3. **BD a mano** (INSERT en `user_roles`): sin auditoría, propenso a errores, fuera de la aplicación.

## Pros/Contras

- 1 (recomendada): sin superficie nueva (ni CLI, ni tabla); el otorgamiento es atómico con el registro (misma transacción); desbloquea el deploy en BD nueva; comportamiento explícito y testeado (test de integración).
- 2: correcto para _gestionar_ roles más adelante, pero exige que el usuario ya exista y montar un CLI con auditoría antes de que haya panel de admin es sobredimensionado ahora; encaja en la épica de admin.
- 3: incumple `security.md` (las acciones sensibles quedan auditadas) y es frágil operativamente.

## Recomendación

**Opción 1 ahora, opción 2 más adelante.** El primer admin se crea fijando `BOOTSTRAP_ADMIN_EMAIL` **antes** del primer registro con ese email. La concesión/restricción de roles a _futuros_ admins la hará el panel de admin (auditada con T-09); el script CLI queda como candidato de esa épica.

## Justificación

- La BD de producción está limpia (0 usuarios): el bootstrap resuelve exactamente el caso que hay que resolver ahora.
- El otorgamiento es atómico con el registro (misma transacción) e idempotente por naturaleza: el email es único en BD, así que a lo sumo un registro por email bootstrap puede tener éxito (no reintroduce la race corregida en `register`).
- Es un **parámetro operativo**, no una regla de juego: vive en env (no en `season_rules`), coherente con el resto de parámetros del módulo `identity` (AGENTS.md §1.3).

## Impacto técnico

- `app/server/env.ts` + `.env.example`: `BOOTSTRAP_ADMIN_EMAIL` (opcional, default vacío).
- `app/modules/identity/auth-service.ts`: `register()` otorga `global_admin` (upsert del rol + link en `user_roles`) cuando el email coincide.
- `app/server/trpc.ts`: `ctx.userRoles` + `adminProcedure` (403 sin `global_admin`).
- Test de integración: registro con el email bootstrap → `global_admin` + acceso al router `admin`; usuario regular → 403.

## Riesgos

- Si el env se fija con un email **ya registrado** → no pasa nada (el rol no se concede retroactivamente). Mitigación: documentado que debe fijarse antes del primer registro con ese email; en BD nueva está garantizado.
- Si el env cambia después a otro email y esa persona se registra, se crea un **segundo** admin. Mitigación: es un parámetro bajo control del operador (env del contenedor) y cada concesión es visible en BD (`user_roles`) y, a partir de T-09, auditada.
