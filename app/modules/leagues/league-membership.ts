/**
 * Alta de membresía bajo lock de liga (US-25/US-30/US-31).
 *
 * Lo comparten la unión voluntaria y el alta de bienvenida: la plaza se
 * revalida con `FOR UPDATE`, la reentrada abre un periodo nuevo (`joinedAt`)
 * y la auditoría se escribe en la MISMA transacción que la membresía.
 */
import { TRPCError } from "@trpc/server";
import type {
  LeagueStatus,
  LeagueType,
  LeagueVisibility,
  Prisma,
} from "@prisma/client";

import { appendAudit } from "@/modules/admin";

export type LeagueJoinChannel = "code" | "open" | "welcome";

export interface AddLeagueMemberInput {
  leagueId: string;
  userId: string;
  actorId: string;
  ip: string;
  via: LeagueJoinChannel;
}

/** Inserta/reactiva la membresía y audita; el caller aporta la transacción. */
export async function addLeagueMemberInTransaction(
  tx: Prisma.TransactionClient,
  input: AddLeagueMemberInput,
): Promise<void> {
  const rows = await tx.$queryRaw<
    Array<{
      id: string;
      status: LeagueStatus;
      type: LeagueType;
      visibility: LeagueVisibility;
      maxMembers: number;
    }>
  >`
    SELECT id, status, type, visibility, max_members AS "maxMembers"
    FROM leagues
    WHERE id = ${input.leagueId}::uuid
    FOR UPDATE
  `;
  const league = rows[0];
  if (!league) {
    throw new TRPCError({ code: "NOT_FOUND", message: "La liga no existe." });
  }

  // La bienvenida es una configuración operativa, no una entrada arbitraria:
  // debe seguir siendo pública, visible y activa. En una unión normal también
  // se revalida el estado bajo lock para no entrar tras un cierre concurrente.
  if (
    league.status !== "active" ||
    (input.via === "welcome" &&
      (league.type !== "public" || league.visibility !== "public"))
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        input.via === "welcome"
          ? "La liga de bienvenida no está disponible."
          : "La liga no acepta entradas.",
    });
  }

  // Recontar bajo lock: dos altas concurrentes por la última plaza no pueden
  // confirmar ambas (Read Committed relee tras esperar el lock).
  const count = await tx.leagueMember.count({
    where: { leagueId: input.leagueId, status: "active" },
  });
  if (count >= league.maxMembers) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "La liga está llena." });
  }

  const joinedAt = new Date();
  await tx.leagueMember.upsert({
    where: {
      leagueId_userId: { leagueId: input.leagueId, userId: input.userId },
    },
    // US-30: el reingreso NO recupera los GPs jugados fuera de la liga.
    update: { role: "member", status: "active", joinedAt, leftAt: null },
    create: {
      leagueId: input.leagueId,
      userId: input.userId,
      role: "member",
      status: "active",
      joinedAt,
    },
  });
  await appendAudit(tx, {
    actorId: input.actorId,
    action: "league.joined",
    entity: "league",
    entityId: input.leagueId,
    afterData: { userId: input.userId, via: input.via },
    ip: input.ip,
  });
}
