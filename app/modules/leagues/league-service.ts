/**
 * Servicio de ligas (US-15, dashboard): lecturas de solo lectura de las
 * ligas del usuario y sus rankings.
 *
 * El dashboard (US-15) muestra «posición en cada liga»: las ligas activas
 * del usuario (`league_members.status = active`) + sus posiciones en la
 * tabla `rankings` (por GP y general — `gpId` NULL). Los rankings son
 * DERIVADOS (data-model.md §5): los calcula el recálculo (US-18/US-19) y
 * los publica US-21; hasta entonces la vista es `null` (vacío elegante,
 * decisión US-15) y se llena sola cuando lleguen los datos.
 *
 * Multi-liga (invariante 4): los puntos por GP de un usuario son los
 * mismos en todas sus ligas; la posición SÍ es por liga.
 *
 * Las dependencias se inyectan (prisma): el servicio se prueba sin los
 * singletons de la app (mismo patrón que `LineupService`).
 */
import type { PrismaClient, Ranking } from "@prisma/client";

export interface LeagueServiceDeps {
  prisma: PrismaClient;
}

/** Posición del usuario en una liga (US-15): por GP y general. */
export interface MyLeagueRanking {
  leagueId: string;
  leagueName: string;
  /** Posición en el GP (null si aún no se ha calculado — US-21). */
  gpPosition: number | null;
  gpPoints: number | null;
  /** Posición general (ranking `gpId` NULL; null si aún no calculada). */
  overallPosition: number | null;
  overallPoints: number | null;
}

/** Fila de ranking con los campos que usa la vista. */
type RankingRow = Pick<Ranking, "leagueId" | "gpId" | "position" | "points" | "computedAt" | "createdAt">;

/**
 * La fila más reciente (por `computedAt`, y `createdAt` como desempate):
 * los rankings son versionados (`results_version`), y la última publicada
 * es la vigente (AGENTS.md §5: no hay cambios retroactivos silenciosos).
 */
function latestRanking(rows: readonly RankingRow[]): RankingRow | null {
  if (rows.length === 0) return null;
  return (
    [...rows].sort(
      (a, b) =>
        b.computedAt.getTime() - a.computedAt.getTime() ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    )[0] ?? null
  );
}

export class LeagueService {
  constructor(private readonly deps: LeagueServiceDeps) {}

  /**
   * Ligas activas del usuario + sus posiciones (US-15, dashboard).
   * Si `gpId` se indica, incluye la posición en ese GP; la posición
   * general siempre. Sin ligas activas → `[]`; sin rankings calculados
   * (US-19/US-21 pendientes) → posiciones `null`.
   */
  async myRankings(
    userId: string,
    gpId: string | null,
  ): Promise<MyLeagueRanking[]> {
    const memberships = await this.deps.prisma.leagueMember.findMany({
      where: { userId, status: "active" },
      include: { league: { select: { id: true, name: true } } },
      orderBy: { joinedAt: "asc" },
    });
    if (memberships.length === 0) return [];

    const leagueIds = memberships.map((m) => m.leagueId);
    const rankings = await this.deps.prisma.ranking.findMany({
      where: { userId, leagueId: { in: leagueIds } },
      select: {
        leagueId: true,
        gpId: true,
        position: true,
        points: true,
        computedAt: true,
        createdAt: true,
      },
    });

    return memberships.map((m) => {
      const leagueRankings = rankings.filter((r) => r.leagueId === m.leagueId);
      const gpRow =
        gpId === null
          ? null
          : latestRanking(leagueRankings.filter((r) => r.gpId === gpId));
      const overallRow = latestRanking(
        leagueRankings.filter((r) => r.gpId === null),
      );
      return {
        leagueId: m.leagueId,
        leagueName: m.league.name,
        gpPosition: gpRow ? gpRow.position : null,
        gpPoints: gpRow ? Number(gpRow.points) : null,
        overallPosition: overallRow ? overallRow.position : null,
        overallPoints: overallRow ? Number(overallRow.points) : null,
      };
    });
  }
}
