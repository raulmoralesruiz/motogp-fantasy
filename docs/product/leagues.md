# Sistema de Ligas

> Estado: BORRADOR v1 (fase 3).

## 1. Concepto

Una **liga** es un grupo de usuarios que comparten un ranking. Un usuario puede pertenecer a **varias ligas a la vez**. Los **lineups y puntos son compartidos** entre ligas (un lineup por GP por usuario); lo que varía por liga es el conjunto de miembros y el ranking.

**Reglas globales vs por liga:**

| Aspecto                                                       | Ámbito                     |
| ------------------------------------------------------------- | -------------------------- |
| Presupuesto, precios, puntuación, lockout, transfers          | **Global** (por temporada) |
| Miembros, invitaciones, visibilidad, nombre, min/máx miembros | **Por liga**               |
| Restricción de entrada (solo invitados / abierta)             | **Por liga**               |

> Racional: las reglas de juego globales garantizan que los puntos sean comparables y que un lineup valga lo mismo en todas las ligas. Permitir reglas por liga rompería la comparabilidad y multiplicaría la complejidad de validación.

## 2. Tipos de liga

| Tipo              | Visibilidad           | Entrada                     | Duración                | Caso de uso                  |
| ----------------- | --------------------- | --------------------------- | ----------------------- | ---------------------------- |
| **Privada**       | Oculta                | Solo por código/invitación  | Temporal o de temporada | Amigos, familia              |
| **Pública**       | Visible en directorio | Abierta (con límite)        | De temporada            | Comunidad general            |
| **Amigos**        | Oculta                | Solo por invitación directa | Temporal                | Círculo cercano              |
| **Temporal**      | Según config          | Según config                | Ventana de fechas/horas | Reto de un fin de semana     |
| **De temporada**  | Según config          | Según config                | Una temporada completa  | Liga principal               |
| **Personalizada** | Según config          | Según config                | Según config            | Reglas de membresía a medida |

## 3. Creación de liga

- El creador define: nombre, descripción, tipo, visibilidad, min/máx miembros, modo de entrada (código/invitación/abierta), duración.
- **Min/máx miembros** (PROVISIONAL): min 2, máx 50 (configurable por tipo).
- El creador es **admin** de la liga por defecto.
- Se genera un **código de invitación** (si el modo lo requiere).

## 4. Invitaciones

- **Código de liga:** cadena aleatoria de alta entropía (≥8 caracteres, sin ambigüedad 0/O/1/I). Permite unirse mientras la liga acepte entradas y no esté llena.
- **Invitación directa:** un admin/miembro invita a un usuario concreto (por ID de usuario o email si existe).
- **Seguridad del código:**
  - Entropía suficiente para no ser adivinado.
  - Revocable por el admin (generar nuevo código invalida el anterior).
  - Límite de intentos de unirse por código (rate-limit) para evitar fuerza bruta.
  - El código no expira por defecto, pero el admin puede desactivar las entradas.
- **Anti-abuso:** un usuario no puede unirse a la misma liga dos veces; los bots/autos requieren verificación.

## 5. Roles y permisos

| Acción                                   | Admin de liga | Miembro                         |
| ---------------------------------------- | ------------- | ------------------------------- |
| Ver ranking y miembros                   | ✅            | ✅                              |
| Colocar/cambiar lineup                   | ✅            | ✅                              |
| Invitar usuarios (si el modo lo permite) | ✅            | ⚠️ solo si el admin lo habilita |
| Expulsar miembro                         | ✅            | ❌                              |
| Cambiar nombre/descripción/visibilidad   | ✅            | ❌                              |
| Activar/desactivar el ranking ajustado   | ✅            | ❌                              |
| Revocar código / generar nuevo           | ✅            | ❌                              |
| Cerrar la liga                           | ✅            | ❌                              |
| Transferir admin                         | ✅            | ❌                              |

- **Admin vs miembro:** el admin gestiona la liga; el miembro solo juega.
- **Creador** puede ceder el rol de admin.

## 6. Unirse, salir, expulsión

- **Unirse:** con código o invitación, si hay plaza y la liga acepta entradas.
- **Salida voluntaria:** el miembro se retira; su histórico de puntos **se conserva** en el ranking (marcado "retirado") para no alterar el historial de otros.
- **Expulsión:** el admin retira a un miembro; mismo tratamiento que la salida (histórico conservado, marcado "expulsado").
- **Cierre de liga:** el admin cierra; los lineups de los miembros se liberan (pueden seguir en otras ligas).

## 7. Entrada a mitad de temporada

- Un usuario que se une a mitad de temporada **empieza con 0 puntos** desde su primer GP jugado en esa liga.
- No recibe puntos de GPs previos a su entrada (no hay "herencia" de puntos).
- Su ranking se calcula sobre los GPs en los que estuvo activo.
- **Elegibilidad por GP:** un miembro cuenta en un GP solo si el **inicio efectivo** del GP (`lockoutAt`, o la fecha del GP si no hay lockout) es **estrictamente posterior** a su entrada. Entrar en el cierre ya no da acceso a ese GP.
- **Re-entrada:** si un miembro sale y vuelve a unirse, **no recupera** los GPs jugados mientras estuvo fuera (la re-entrada abre un periodo nuevo — ADR-0027/ADR-0028).
- **Opción (configurable por liga, solo admin):** "ranking ajustado" que, en el **ranking general**, solo cuenta GPs desde la **entrada del último miembro** (corte común, para ligas que quieren igualdad). El ranking **por GP no se ajusta** (cada miembro sigue siendo elegible por su propia entrada). **Desactivado por defecto** en todos los tipos de liga (D-10, ADR-0028).
- **Desempates coherentes:** los desempates (GPs ganados, último GP, coste total) se calculan sobre el **mismo** conjunto de GPs elegibles, para que un recién llegado no herede ventaja por GPs previos.

## 8. Rankings

- **Por GP:** quién sumó más puntos en ese GP (entre los miembros **elegibles** en ese GP — §7).
- **General (temporada):** suma de puntos de todos los GPs en los que el miembro estuvo activo (elegibles — §7). Si la liga tiene activado el **ranking ajustado** (§7), el general cuenta solo los GPs desde la entrada del último miembro (corte común).
- **Desempates** (en orden):
  1. Más GPs ganados (por GP).
  2. Mejor puntuación en el último GP.
  3. Menor coste total de lineups (premia eficiencia).
  4. Antigüedad en la liga (quien se unió antes).
- Los rankings se recalculan al publicarse resultados definitivos y se versionan.

## 9. Privacidad

- **Ligas privadas/ocultas:** no aparecen en el directorio público; solo accesibles con código/invitación.
- **Ligas públicas:** visibles en el directorio; el ranking es público.
- **Datos personales:** se muestra solo el nombre de usuario (seudónimo), nunca email u otros PII.
- **Eliminación de cuenta:** al eliminar la cuenta, el usuario se retira de todas las ligas y su histórico se anonimiza (se conserva el ranking numérico sin identidad, o se elimina según configuración de privacidad — ver `security.md`).

## 10. Anti-abuso

- **Multi-cuenta:** detección heurística (mismos dispositivos/patrones) + reporte; la política de sanción es del admin global.
- **Self-play:** se permite que dos cuentas del mismo "humano" estén en la misma liga solo si el admin lo habilita (algunos quieren ligas de práctica); por defecto, se desaconseja.
- **Resultados manipulados:** los resultados vienen de la fuente autorizada o entrada manual auditada; no hay forma de "inflar" puntos desde el cliente.
- **Rate-limiting** en unión por código, creación de ligas y cambios de lineup.

## 11. Comportamiento ante la salida de un usuario

- El ranking **no se recalcula hacia atrás**: los puntos que ese usuario dio a la liga se conservan en el histórico.
- Si la liga queda por debajo del mínimo de miembros, se marca "inactiva" (no se borra).
- Los lineups del usuario saliente se liberan (deja de competir, pero su histórico queda).

## 12. Decisiones pendientes

- ~~Si el "ranking ajustado" (solo GPs desde la última entrada) se activa por defecto en algún tipo.~~ → **Cerrado (D-10, ADR-0028):** desactivado por defecto en **todos** los tipos de liga; es una opción que el admin activa explícitamente por liga.
- Límite exacto de miembros por tipo de liga.
- Política exacta de multi-cuenta y self-play.
- Si las ligas temporales tienen reglas de puntuación propias (no, por el principio de reglas globales — confirmación pendiente).

## 13. Liga de bienvenida (US-31)

- Al **registrarse**, el usuario queda en una **liga pública de bienvenida** (creada/operada por el admin) para no empezar solo.
- **La liga la configura el servidor** (UUID por env, `WELCOME_LEAGUE_ID`); el cliente **nunca** la elige (AGENTS.md §8). Vacío = bienvenida desactivada (registro normal).
- Es una **liga pública normal** (US-23/US-24): el admin la crea y la opera como cualquier otra (puede llenarse, cerrarse, etc.).
- **Atómica con el registro:** el alta en la bienvenida se hace en la **misma transacción** que la creación del usuario. Si la bienvenida no está disponible (liga inexistente, no pública/visible/activa, o **llena**), el registro **rechaza** y **revierte** el usuario (no queda usuario colgado, no se crea sesión).
- **Concurrencia:** dos registros por la **última plaza** no pueden confirmar ambas (plaza revalidada con `FOR UPDATE`); solo uno confirma la membresía.
- **Auditoría:** `league.joined` con `via = "welcome"` (distingue el canal de la unión voluntaria).
