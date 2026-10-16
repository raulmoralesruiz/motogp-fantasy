/**
 * Auditoría (T-09): entradas append-only en `audit_log`.
 *
 * La tabla está protegida a nivel de base de datos por el trigger
 * `audit_log_append_only` (migración `20261016190000`): Postgres rechaza
 * UPDATE/DELETE, así que ningún camino de código puede alterar ni borrar
 * el histórico.
 *
 * `appendAudit` es la única forma de escribir una entrada y siempre lo
 * hace dentro de la misma transacción que la acción auditada: si la
 * acción se commitea, se commitea la entrada, y viceversa (atómico).
 */
import type { Prisma, PrismaClient } from "@prisma/client";

/** Acción sensible a registrar (security.md §1.9). */
export interface AuditEntry {
  /** Actor de la acción; `null` = sistema (sin usuario). */
  actorId: string | null;
  /** Acción (p. ej. `role.bootstrap_admin`, `price.manual_change`). */
  action: string;
  /** Entidad auditada (p. ej. `role`, `price`, `season_rules`). */
  entity: string;
  /** Identificador de la entidad auditada. */
  entityId: string;
  /** Estado previo a la acción (si aplica). */
  beforeData?: Prisma.InputJsonValue | null;
  /** Estado posterior a la acción (si aplica). */
  afterData?: Prisma.InputJsonValue | null;
  /** IP del cliente (si se conoce). */
  ip?: string | null;
}

/**
 * Añade una entrada de auditoría.
 *
 * @param tx Cliente Prisma o transacción: la entrada se commitea de forma
 *   atómica con el resto de la transacción.
 */
export function appendAudit(
  tx: PrismaClient | Prisma.TransactionClient,
  entry: AuditEntry,
) {
  return tx.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      beforeData: entry.beforeData ?? undefined,
      afterData: entry.afterData ?? undefined,
      ip: entry.ip ?? undefined,
    },
  });
}
