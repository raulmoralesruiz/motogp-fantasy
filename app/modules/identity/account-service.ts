/**
 * Servicio de cuenta (US-03, ADR-0016): exportación de datos (derecho de
 * acceso) y eliminación de cuenta = anonimización (derecho de supresión).
 *
 * - `exportUserData`: JSON con la cuenta, sesiones activas y datos de juego
 *   (lineups, puntos, ligas). Tablas-driven: cuando lleguen nuevas
 *   relaciones en Fases 2–4 se cubren añadiendo la consulta aquí.
 * - `deleteAccount`: una única transacción que anonimiza al usuario,
 *   revoca sesiones, borra tokens/roles, cierra membresías, revoca
 *   invitaciones creadas y registra la acción en auditoría SIN PII.
 *
 * Helpers puros (testables sin I/O): `anonymizedEmail`,
 * `anonymizedUsername`.
 */
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";

import { appendAudit } from "@/modules/admin";
import { verifyPassword } from "./password";
import type { RateLimitStore } from "./rate-limit";

/** Sentinela de hash: `verifyPassword` devuelve `false` ante hash malformado. */
export const ANONYMIZED_PASSWORD_SENTINEL = "eliminado";

/** Placeholder determinista que libera el email original (ADR-0016). */
export function anonymizedEmail(userId: string): string {
  return `anonimizado.${userId}@invalido.local`;
}

/** Placeholder determinista, único por construcción (el id es único). */
export function anonymizedUsername(userId: string): string {
  return `usuario-eliminado-${userId.slice(0, 8)}`;
}

export interface AccountServiceDeps {
  prisma: PrismaClient;
  rateLimit: RateLimitStore;
  cfg: {
    /** Intentos de eliminación máximos por usuario por ventana (ADR-0016). */
    deleteMaxPerWindow: number;
    /** Ventana del rate limit de eliminación en segundos (ADR-0016). */
    deleteWindowSec: number;
  };
}

/** Exportación de datos (derecho de acceso): cuenta, sesiones, juego. */
export interface UserExport {
  cuenta: {
    id: string;
    email: string;
    username: string;
    displayName: string | null;
    roles: string[];
    createdAt: Date;
  };
  sesionesActivas: {
    id: string;
    ip: string | null;
    userAgent: string | null;
    createdAt: Date;
    expiresAt: Date;
  }[];
  lineups: {
    id: string;
    gp: string;
    status: string;
    createdAt: Date;
  }[];
  puntos: {
    gp: string;
    pointsTotal: number;
    rulesVersion: string;
    resultsVersion: string;
    computedAt: Date;
  }[];
  ligas: {
    id: string;
    name: string;
    role: string;
    status: string;
    joinedAt: Date;
  }[];
}

export class AccountService {
  constructor(private readonly deps: AccountServiceDeps) {}

  /**
   * Exporta los datos del usuario (derecho de acceso, GDPR). Tablas-driven
   * sobre las relaciones de `User`: hoy cubre cuenta, sesiones activas,
   * lineups, puntos y ligas.
   */
  async exportUserData(userId: string): Promise<UserExport> {
    const { prisma } = this.deps;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        userRoles: { include: { role: true } },
        sessions: { where: { revokedAt: null } },
        lineups: { include: { gp: { select: { name: true } } } },
        scores: { include: { gp: { select: { name: true } } } },
        leagueMembers: { include: { league: { select: { name: true } } } },
      },
    });
    if (!user) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Cuenta no encontrada." });
    }
    return {
      cuenta: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.profile?.displayName ?? null,
        roles: user.userRoles.map((ur) => ur.role.name),
        createdAt: user.createdAt,
      },
      sesionesActivas: user.sessions.map((s) => ({
        id: s.id,
        ip: s.ip,
        userAgent: s.userAgent,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
      })),
      lineups: user.lineups.map((l) => ({
        id: l.id,
        gp: l.gp.name,
        status: l.status,
        createdAt: l.createdAt,
      })),
      puntos: user.scores.map((s) => ({
        gp: s.gp.name,
        pointsTotal: Number(s.pointsTotal),
        rulesVersion: s.rulesVersion,
        resultsVersion: s.resultsVersion,
        computedAt: s.computedAt,
      })),
      ligas: user.leagueMembers.map((m) => ({
        id: m.leagueId,
        name: m.league.name,
        role: m.role,
        status: m.status,
        joinedAt: m.joinedAt,
      })),
    };
  }

  /**
   * Elimina la cuenta = anonimiza (derecho de supresión, ADR-0016).
   *
   * Guardas:
   * - Ya anonimizada → `PRECONDITION_FAILED` (idempotencia: la 2ª
   *   eliminación no modifica nada).
   * - Rate limit POR USUARIO (3/h por defecto) → `TOO_MANY_REQUESTS`.
   * - Contraseña correcta obligatoria (operación destructiva).
   *
   * Transacción única: anonimiza `users`/`profiles`, revoca sesiones,
   * borra tokens de recuperación y roles, cierra membresías de liga
   * (`left`) y revoca invitaciones creadas. Los datos de juego (lineups,
   * scores, rankings) se CONSERVAN apuntando al usuario anonimizado
   * (integridad de rankings). La entrada de auditoría `user.account_deleted`
   * no incluye PII: solo `userId`, `anonymizedAt` y contadores.
   */
  async deleteAccount(
    userId: string,
    input: { password: string },
    meta: { ip: string | null },
  ): Promise<void> {
    const { prisma, rateLimit, cfg } = this.deps;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Cuenta no encontrada." });
    }
    if (user.isAnonymized) {
      // Idempotencia: la 2ª eliminación no modifica nada (no cuenta para
      // el rate limit, que protege la operación destructiva).
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "La cuenta ya está eliminada.",
      });
    }

    const { count, remainingSec } = await rateLimit.recordUserDeletion(
      userId,
      cfg.deleteWindowSec,
    );
    if (count > cfg.deleteMaxPerWindow && remainingSec > 0) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Demasiados intentos de eliminación. Inténtalo de nuevo en ${remainingSec} s.`,
      });
    }

    const passwordOk = await verifyPassword(input.password, user.passwordHash);
    if (!passwordOk) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "La contraseña no es correcta.",
      });
    }

    await prisma.$transaction(async (tx) => {
      const now = new Date();

      await tx.user.update({
        where: { id: user.id },
        data: {
          email: anonymizedEmail(user.id),
          username: anonymizedUsername(user.id),
          passwordHash: ANONYMIZED_PASSWORD_SENTINEL,
          isAnonymized: true,
          anonymizedAt: now,
        },
      });

      await tx.profile.updateMany({
        where: { userId: user.id },
        data: { displayName: "Usuario eliminado", avatarUrl: null },
      });

      const sessionsRevoked = await tx.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now },
      });

      await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
      await tx.userRole.deleteMany({ where: { userId: user.id } });

      const membershipsLeft = await tx.leagueMember.updateMany({
        where: { userId: user.id, status: "active" },
        data: { status: "left", leftAt: now },
      });

      await tx.leagueInvite.updateMany({
        where: { createdBy: user.id, status: "active" },
        data: { status: "revoked" },
      });

      // Auditoría sin PII (ADR-0016): solo userId, fecha y contadores.
      await appendAudit(tx, {
        actorId: user.id,
        action: "user.account_deleted",
        entity: "user",
        entityId: user.id,
        afterData: {
          isAnonymized: true,
          anonymizedAt: now,
          sessionsRevoked: sessionsRevoked.count,
          membershipsLeft: membershipsLeft.count,
        },
        ip: meta.ip,
      });
    });
  }
}
