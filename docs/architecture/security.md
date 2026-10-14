# Seguridad

> Estado: BORRADOR v1 (fase 4).

## 1. Amenazas y controles

### 1.1 Autenticación y sesiones

- **Contraseñas:** hash con **argon2** (o bcrypt) + salt; política de longitud mínima. Nunca en claro ni reversible.
- **Sesiones:** cookie `HttpOnly` + `Secure` + `SameSite=Lax`; token de sesión opaco en BD (`sessions`); expiración y revocación.
- **Reinicio de contraseña:** token de uso único con expiración corta.
- **Rate-limiting** en login y reset (anti fuerza bruta).
- **Bloqueo temporal** tras N intentos fallidos.

### 1.2 Autorización (por recurso y por rol)

- **RBAC:** roles `user`, `league_admin` (por liga), `global_admin`.
- **Autorización por recurso:** cada endpoint verifica que el actor puede actuar sobre ese recurso (p. ej. solo el owner o un admin de la liga puede gestionar esa liga; solo `global_admin` accede al panel global).
- **El servidor es la fuente de verdad:** el cliente nunca decide permisos; cada request se revalida server-side.
- **Lineups:** solo el owner ve/modifica su lineup (salvo opciones de privacidad de liga).

### 1.3 Validación de entrada

- **Esquemas Zod compartidos** (cliente y servidor) como fuente única de verdad de validación.
- **Todo input se valida y sanitiza** server-side (incluso lo que el cliente ya validó).
- **Presupuesto/lineup:** el coste se **recalcula server-side** con la lista de precios congelada; el cliente no envía "presupuesto" ni "coste" de confianza.
- **SQL:** solo vía ORM/queries parametrizadas (sin concatenación).

### 1.4 Protección del presupuesto (anti invalidación)

- El presupuesto se **deriva** de `B + carry + movimientos`, no se acepta un valor del cliente.
- Guardar un lineup valida: composición (2+2+1+1), coste ≤ presupuesto, lockout, límites de cambios, concentración.
- **Condiciones de carrera:** transacción + `FOR UPDATE` sobre el lineup; el cierre (lockout) se evalúa dentro de la transacción.
- **No hay forma de "inyectar" presupuesto** desde el cliente.

### 1.5 Protección del panel de admin

- Acceso solo con rol `global_admin` (lista blanca de usuarios).
- **Acciones sensibles** (cambiar precios, reglas, resultados, sanciones, eliminar usuarios) requieren el rol y quedan **auditadas**.
- **Separación de deberes:** idealmente, el que importa resultados no es el único que puede marcarlos definitivos (configurable).

### 1.6 Control de intentos de acceso

- **Rate-limiting** por IP y por usuario en: login, unión a liga (código), creación de ligas, cambios de lineup, API en general.
- **Detección de fuerza bruta** en códigos de liga (entropía alta + límite de intentos).
- **Logs de acceso fallido** para acciones sensibles.

### 1.7 Seguridad de invitaciones

- Códigos de alta entropía, revocables, con límite de intentos.
- El código no expone datos de la liga (no es un ID enumerable).
- Unirse valida: código activo, plaza disponible, no ya miembro.

### 1.8 Lockout (sin cambios tras cierre)

- El estado `locked` del GP + timestamp de cierre se evalúan **server-side** en la transacción de cambio.
- Un intento de cambio tras el cierre se **rechaza** (no se aplica parcialmente).
- El histórico de cambios refleja solo cambios válidos.

### 1.9 Registro de cambios sensibles (auditoría)

- `audit_log` para: cambios de precios (manuales), cambios de reglas, importación/marcado de resultados, recálculos, sanciones, eliminación de usuarios, gestión de ligas por admin, cambios de rol.
- Cada entrada: actor, acción, entidad, antes/después, IP, timestamp.
- El log es **append-only** (no editable/borrable por la app).

### 1.10 Backup y restore

- **Backups** automáticos de PostgreSQL (diarios + PITR si la plataforma lo permite).
- **Prueba de restore** periódica (un task del backlog).
- **Retención** definida (PROVISIONAL: 30 días diarios + 12 meses mensuales).

### 1.11 Privacidad y eliminación de cuenta (GDPR)

- **Minimización:** solo se recoge email + seudónimo + datos de juego. Sin PII innecesario.
- **Derecho de acceso:** el usuario puede exportar sus datos (lineups, puntos, ligas).
- **Derecho de supresión:** al eliminar la cuenta:
  - Se **anonimiza** el usuario (seudónimo → "Usuario eliminado", email borrado).
  - Se retira de todas las ligas.
  - Su histórico de puntos se **anonimiza** (se conserva el ranking numérico sin identidad) o se elimina según configuración — decisión pendiente.
  - Se borran datos personales; se conservan datos de juego anonimizados para integridad de rankings.
- **Retención de logs:** los logs de auditoría que contengan PII se anonimizan tras un periodo.

## 2. Cabeceras y transporte

- **HTTPS** obligatorio (HSTS).
- Cabeceras: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` (o CSP frame-ancestors), `Content-Security-Policy` básica, `Referrer-Policy`.
- **CORS** restringido al origen de la app.

## 3. Secrets

- **Nunca en el repo.** Se usan variables de entorno / vault (Doppler, SOPS, o secrets del PaaS).
- Secrets: credenciales de BD, clave de sesión, claves de fuentes de datos (si las hubiera), claves de monitoreo.
- **Rotación** periódica.

## 4. Superficie de ataque a minimizar

- Sin ejecución de código dinámico.
- Sin subida de archivos en el MVP (solo avatar opcional, validado).
- Dependencias auditadas (CI: `npm audit` / dependabot).

## 5. Decisiones pendientes

- Política exacta de retención/anonimización al eliminar cuenta.
- Si se habilita 2FA para `global_admin` (recomendado: sí).
- Separación de deberes en el marcado de resultados definitivos.
- Periodo exacto de retención de backups y logs.
