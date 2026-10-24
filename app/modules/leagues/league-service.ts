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
import { TRPCError } from "@trpc/server";
import type { Prisma, PrismaClient, Ranking } from "@prisma/client";

import { sortRanking } from "./core";

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

  /**
   * Calcula y publica los rankings de una liga a partir de `scores` (US-21).
   *
   * Se dispara al publicarse resultados definitivos (leagues.md §8: "los
   * rankings se recalculan al publicarse resultados definitivos y se
   * versionan"). Escribe:
   * - **Por GP** (una fila por GP de la temporada que tenga `scores`): orden
   *   por puntos de ese GP + desempates (leagues.md §8).
   * - **General** (fila `gpId` NULL): orden por suma de puntos de la
   *   temporada + los mismos desempates.
   *
   * Desempates (leagues.md §8, en orden): más GPs ganados → mejor último GP →
   * menor coste total de lineups → antigüedad. Los valores los aporta el
   * servicio (I/O); el orden lo aplica la fórmula pura `sortRanking` (`core`).
   *
   * Multi-liga (invariante 4): los puntos por GP son los mismos en todas las
   * ligas; la posición SÍ es por liga (los desempates de coste/antigüedad
   * pueden diferir).
   *
   * Solo se publican las ligas con miembros activos **que puntuaron** en la
   * temporada (derivado de `scores`, data-model.md §5): una liga donde nadie
   * puntuó no recibe filas (vacío elegante, US-15) y no se cuenta en el
   * retorno.
   *
   * @param gpId           GP que ha publicado resultados (ancla de la recalc.).
   * @param resultsVersion versión de resultados del GP (versiona los rankings).
   * @returns nº de ligas publicadas (con filas) + filas de ranking escritas.
   */
  async recalculateRankings(
    gpId: string,
    resultsVersion: string,
  ): Promise<{ leagues: number; rankings: number }> {
    const gp = await this.deps.prisma.gp.findUnique({ where: { id: gpId } });
    if (!gp) {
      throw new TRPCError({ code: "NOT_FOUND", message: "El GP no existe." });
    }

    // 1. GPs de la temporada (orden por round; el último da "último GP").
    const seasonGps = await this.deps.prisma.gp.findMany({
      where: { seasonId: gp.seasonId },
      select: { id: true },
      orderBy: { round: "asc" },
    });
    const gpIds = seasonGps.map((g) => g.id);
    const lastGpId = seasonGps[seasonGps.length - 1]?.id ?? null;

    // 2. Scores de la temporada (gpId → userId → puntos). Solo GPs puntuados.
    const scores = await this.deps.prisma.score.findMany({
      where: { gpId: { in: gpIds } },
      select: { userId: true, gpId: true, pointsTotal: true },
    });
    const scoreByGpUser = new Map<string, Map<string, number>>();
    for (const s of scores) {
      const gpMap = scoreByGpUser.get(s.gpId) ?? new Map<string, number>();
      gpMap.set(s.userId, Number(s.pointsTotal));
      scoreByGpUser.set(s.gpId, gpMap);
    }

    // Usuarios que puntuaron en al menos un GP de la temporada. El ranking
    // es DERIVADO de `scores` (data-model.md §5): solo se publican filas para
    // los miembros con datos — una liga donde nadie puntuó no recibe ranking
    // (vacío elegante, US-15).
    const scoredUsers = new Set<string>();
    for (const gpMap of scoreByGpUser.values()) {
      for (const uid of gpMap.keys()) scoredUsers.add(uid);
    }

    // 3. Coste total de lineups por usuario (desempate 3).
    const costByUser = await this.totalCostByUser(gpIds);

    // 4. Miembros activos, agrupados por liga.
    const memberships = await this.deps.prisma.leagueMember.findMany({
      where: { status: "active" },
      select: { leagueId: true, userId: true, joinedAt: true },
    });
    const membersByLeague = new Map<string, { userId: string; joinedAt: Date }[]>();
    for (const m of memberships) {
      const list = membersByLeague.get(m.leagueId) ?? [];
      list.push({ userId: m.userId, joinedAt: m.joinedAt });
      membersByLeague.set(m.leagueId, list);
    }
    if (membersByLeague.size === 0) return { leagues: 0, rankings: 0 };

    // 5. Por liga: rankings por GP + general (orden: fórmula pura `sortRanking`).
    //    Solo se publican ligas donde algún miembro puntuó (derivado de scores).
    const now = new Date();
    const perGpRows: Prisma.RankingCreateManyInput[] = [];
    const overallRows: Prisma.RankingCreateManyInput[] = [];
    const publishedLeagues = new Set<string>();

    for (const [leagueId, members] of membersByLeague) {
      const memberIds = members.map((m) => m.userId);
      const joinedAtByUser = new Map(members.map((m) => [m.userId, m.joinedAt]));

      // Liga sin miembros que puntuaron → no se publica (vacío elegante).
      if (!memberIds.some((uid) => scoredUsers.has(uid))) continue;
      publishedLeagues.add(leagueId);

      // GPs ganados por usuario (1º por puntos, sin empate, entre miembros).
      const gpsWonByUser = new Map<string, number>();
      for (const g of seasonGps) {
        const gpMap = scoreByGpUser.get(g.id);
        if (!gpMap) continue;
        let maxPoints = -Infinity;
        for (const uid of memberIds) {
          const pts = gpMap.get(uid);
          if (pts !== undefined && pts > maxPoints) maxPoints = pts;
        }
        if (maxPoints === -Infinity) continue;
        const winners = memberIds.filter((uid) => gpMap.get(uid) === maxPoints);
        const winner = winners.length === 1 ? winners[0] : undefined;
        if (winner !== undefined) {
          gpsWonByUser.set(winner, (gpsWonByUser.get(winner) ?? 0) + 1);
        }
      }

      // Puntos del último GP (desempate 2; 0 si aún no puntuado).
      const lastGpMap = lastGpId ? scoreByGpUser.get(lastGpId) : undefined;
      const lastGpScore = (uid: string): number => lastGpMap?.get(uid) ?? 0;

      // Ranking por GP (solo GPs con `scores`).
      for (const g of seasonGps) {
        const gpMap = scoreByGpUser.get(g.id);
        if (!gpMap) continue;
        const sorted = sortRanking(
          memberIds
            .filter((uid) => gpMap.has(uid))
            .map((uid) => ({
              userId: uid,
              points: gpMap.get(uid)!,
              gpsWon: gpsWonByUser.get(uid) ?? 0,
              lastGpScore: lastGpScore(uid),
              totalCost: costByUser.get(uid) ?? 0,
              joinedAt: joinedAtByUser.get(uid)!,
            })),
        );
        sorted.forEach((r, i) => {
          perGpRows.push({
            leagueId,
            gpId: g.id,
            userId: r.userId,
            position: i + 1,
            points: r.points,
            tiebreakers: {
              gpsWon: r.gpsWon,
              lastGpScore: r.lastGpScore,
              totalCost: r.totalCost,
            },
            resultsVersion,
            computedAt: now,
          });
        });
      }

      // Ranking general (suma de puntos de la temporada).
      const totalPoints = (uid: string): number => {
        let total = 0;
        for (const g of seasonGps) {
          const pts = scoreByGpUser.get(g.id)?.get(uid);
          if (pts !== undefined) total += pts;
        }
        return total;
      };
      const overallSorted = sortRanking(
        memberIds
          .filter((uid) => scoredUsers.has(uid))
          .map((uid) => ({
            userId: uid,
            points: totalPoints(uid),
            gpsWon: gpsWonByUser.get(uid) ?? 0,
            lastGpScore: lastGpScore(uid),
            totalCost: costByUser.get(uid) ?? 0,
            joinedAt: joinedAtByUser.get(uid)!,
          })),
      );
      overallSorted.forEach((r, i) => {
        overallRows.push({
          leagueId,
          gpId: null,
          userId: r.userId,
          position: i + 1,
          points: r.points,
          tiebreakers: {
            gpsWon: r.gpsWon,
            lastGpScore: r.lastGpScore,
            totalCost: r.totalCost,
          },
          resultsVersion,
          computedAt: now,
        });
      });
    }

    // 6. Publicar (atómico): los rankings son versionados; la lectura (US-15)
    //    toma la más reciente por `computedAt`.
    await this.deps.prisma.$transaction(async (tx) => {
      if (perGpRows.length > 0) await tx.ranking.createMany({ data: perGpRows });
      if (overallRows.length > 0) await tx.ranking.createMany({ data: overallRows });
    });

    return { leagues: publishedLeagues.size, rankings: perGpRows.length + overallRows.length };
  }

  /**
   * Coste total de los lineups de la temporada por usuario (desempate 3:
   * "menor coste total de lineups"). Coste de un lineup = suma de los precios
   * de sus activos (slots) a los precios del GP (invariante 2). Sin precio
   * para un activo → no cuenta (el lineup no se habría podido guardar).
   */
  private async totalCostByUser(gpIds: string[]): Promise<Map<string, number>> {
    const lineups = await this.deps.prisma.lineup.findMany({
      where: { gpId: { in: gpIds } },
      select: { id: true, userId: true, gpId: true },
    });
    if (lineups.length === 0) return new Map();
    const lineupIds = lineups.map((l) => l.id);
    const [slots, prices] = await Promise.all([
      this.deps.prisma.lineupSlot.findMany({
        where: { lineupId: { in: lineupIds } },
        select: { lineupId: true, assetType: true, assetId: true },
      }),
      this.deps.prisma.price.findMany({
        where: { gpId: { in: gpIds } },
        select: { assetType: true, assetId: true, gpId: true, price: true },
      }),
    ]);

    const priceOf = new Map<string, number>();
    for (const p of prices) {
      priceOf.set(`${p.assetType}:${p.assetId}:${p.gpId}`, Number(p.price));
    }
    const slotsByLineup = new Map<string, { assetType: string; assetId: string }[]>();
    for (const s of slots) {
      const list = slotsByLineup.get(s.lineupId) ?? [];
      list.push({ assetType: s.assetType, assetId: s.assetId });
      slotsByLineup.set(s.lineupId, list);
    }

    const costByUser = new Map<string, number>();
    for (const l of lineups) {
      let cost = 0;
      for (const s of slotsByLineup.get(l.id) ?? []) {
        const price = priceOf.get(`${s.assetType}:${s.assetId}:${l.gpId}`);
        if (price !== undefined) cost += price;
      }
      costByUser.set(l.userId, (costByUser.get(l.userId) ?? 0) + cost);
    }
    return costByUser;
  }
}
