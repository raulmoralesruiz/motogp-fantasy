/**
 * US-21 · Rankings por GP y general (PostgreSQL real).
 *
 * `LeagueService.recalculateRankings`: calcula y publica los rankings a
 * partir de `scores` (leagues.md §8):
 * - **Por GP:** orden por puntos de ese GP.
 * - **General:** orden por suma de puntos de la temporada.
 * - **Desempates** (leagues.md §8): más GPs ganados → mejor último GP →
 *   menor coste total → antigüedad. (El orden lo aplica la fórmula pura
 *   `sortRanking`, cubierta en unit; aquí se verifica el resultado integral
 *   contra datos reales en BD.)
 *
 * Escenario (3 miembros, 2 GPs):
 * - A: GP1=100, GP2=50 (total 150) · B: GP1=50, GP2=100 (total 150) ·
 *   C: GP1=150, GP2=0 (total 150).
 * - Por GP: GP1 → C>A>B; GP2 → B>A>C.
 * - General (todos 150): C ganó GP1, B ganó GP2 (A ninguno) → C,B > A;
 *   C y B empatan en GPs ganados → último GP: B (100) > C (0) → **B > C > A**.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AssetType, PrismaClient, SlotType } from "@prisma/client";

import { LeagueService } from "../../app/modules/leagues";
import { createPrisma, integrationDbUrl } from "./helpers";

process.env.DATABASE_URL = integrationDbUrl();
process.env.REDIS_URL ??= "redis://localhost:6379/0"; // dummy: lazyConnect

describe("US-21 · Rankings por GP y general (PostgreSQL real)", () => {
  let prisma: PrismaClient;
  let service: LeagueService;
  const suffix = randomUUID().slice(0, 8);

  let seasonId: string;
  let gp1: string;
  let gp2: string;
  let leagueId: string;
  let userA: string;
  let userB: string;
  let userC: string;
  let costLeagueId: string;
  let userD: string;
  let userE: string;

  beforeAll(async () => {
    prisma = createPrisma();
    service = new LeagueService({ prisma });

    seasonId = (
      await prisma.season.create({ data: { name: `Temporada ${suffix}`, year: 2098 } })
    ).id;
    const circuit = (
      await prisma.circuit.create({ data: { name: `Circuito ${suffix}`, country: "Ficticia" } })
    ).id;
    gp1 = (
      await prisma.gp.create({
        data: {
          seasonId,
          round: 1,
          name: `GP1 ${suffix}`,
          circuitId: circuit,
          date: new Date("2098-05-01T12:00:00Z"),
        },
      })
    ).id;
    gp2 = (
      await prisma.gp.create({
        data: {
          seasonId,
          round: 2,
          name: `GP2 ${suffix}`,
          circuitId: circuit,
          date: new Date("2098-06-01T12:00:00Z"),
        },
      })
    ).id;

    // 3 usuarios (miembros de la liga).
    userA = (
      await prisma.user.create({
        data: { email: `a-${suffix}@test.local`, passwordHash: "h", username: `a_${suffix}` },
      })
    ).id;
    userB = (
      await prisma.user.create({
        data: { email: `b-${suffix}@test.local`, passwordHash: "h", username: `b_${suffix}` },
      })
    ).id;
    userC = (
      await prisma.user.create({
        data: { email: `c-${suffix}@test.local`, passwordHash: "h", username: `c_${suffix}` },
      })
    ).id;

    // Liga privada con los 3 como miembros activos (B se unió antes que A).
    leagueId = (
      await prisma.league.create({ data: { name: `Liga ${suffix}`, type: "private" } })
    ).id;
    await prisma.leagueMember.createMany({
      data: [
        { leagueId, userId: userB, joinedAt: new Date("2098-01-01T00:00:00Z") },
        { leagueId, userId: userA, joinedAt: new Date("2098-02-01T00:00:00Z") },
        { leagueId, userId: userC, joinedAt: new Date("2098-03-01T00:00:00Z") },
      ],
    });

    // Lineups (1 por usuario por GP; los scores los requieren) + scores.
    // A: GP1=100, GP2=50 · B: GP1=50, GP2=100 · C: GP1=150, GP2=0.
    const scores: [string, string, number][] = [
      [userA, gp1, 100],
      [userA, gp2, 50],
      [userB, gp1, 50],
      [userB, gp2, 100],
      [userC, gp1, 150],
      [userC, gp2, 0],
    ];
    for (const [userId, gpId, points] of scores) {
      const lineup = await prisma.lineup.create({ data: { userId, gpId } });
      await prisma.score.create({
        data: {
          lineupId: lineup.id,
          userId,
          gpId,
          pointsTotal: points,
          breakdown: {},
          rulesVersion: "scoring-v1",
          resultsVersion: "rv-1",
        },
      });
    }

    // Escenario de desempate 3 (coste): D y E empatan en puntos, GPs ganados
    // y último GP; D tiene lineups más baratos → D por delante (leagues.md §8).
    userD = (
      await prisma.user.create({
        data: { email: `d-${suffix}@test.local`, passwordHash: "h", username: `d_${suffix}` },
      })
    ).id;
    userE = (
      await prisma.user.create({
        data: { email: `e-${suffix}@test.local`, passwordHash: "h", username: `e_${suffix}` },
      })
    ).id;
    costLeagueId = (
      await prisma.league.create({ data: { name: `Liga coste ${suffix}`, type: "private" } })
    ).id;
    await prisma.leagueMember.createMany({
      data: [
        { leagueId: costLeagueId, userId: userD, joinedAt: new Date("2098-01-01T00:00:00Z") },
        { leagueId: costLeagueId, userId: userE, joinedAt: new Date("2098-01-02T00:00:00Z") },
      ],
    });
    // Mismos puntos para D y E en ambos GPs → empate en puntos, gpsWon (0,
    // ambos empatan 1º) y último GP (100).
    for (const userId of [userD, userE]) {
      for (const gp of [gp1, gp2]) {
        const lineup = await prisma.lineup.create({ data: { userId, gpId: gp } });
        await prisma.score.create({
          data: {
            lineupId: lineup.id,
            userId,
            gpId: gp,
            pointsTotal: 100,
            breakdown: {},
            rulesVersion: "scoring-v1",
            resultsVersion: "rv-1",
          },
        });
      }
    }
    // Activos + precios por GP. Composición válida (invariante 1): 2 oro +
    // 2 plata + 1 constructor + 1 equipo. D más barato que E.
    const mkRider = (n: string) =>
      prisma.rider.create({ data: { name: `${n} ${suffix}` } }).then((r) => r.id);
    const mkCtor = (n: string) =>
      prisma.constructor.create({ data: { name: `${n} ${suffix}` } }).then((c) => c.id);
    const mkTeam = (n: string, ctorId: string) =>
      prisma.team
        .create({ data: { name: `${n} ${suffix}`, constructorId: ctorId } })
        .then((t) => t.id);
    const [r1, r2, r4, r5, r6, r7, c1, c2] = await Promise.all([
      mkRider("R1"),
      mkRider("R2"),
      mkRider("R4"),
      mkRider("R5"),
      mkRider("R6"),
      mkRider("R7"),
      mkCtor("C1"),
      mkCtor("C2"),
    ]);
    const [t1, t2] = await Promise.all([mkTeam("T1", c1), mkTeam("T2", c2)]);
    const price = (assetType: AssetType, assetId: string, gp: string, p: number) => ({
      assetType,
      assetId,
      gpId: gp,
      price: p,
    });
    // D: oro r1(20)+r2(15), plata r4(10)+r5(8), ctor c1(12), team t1(10) = 75/GP.
    // E: oro r1(20)+r2(15), plata r6(25)+r7(22), ctor c2(20), team t2(18) = 120/GP.
    const priceRows = [
      price("rider", r1, gp1, 20), price("rider", r1, gp2, 20),
      price("rider", r2, gp1, 15), price("rider", r2, gp2, 15),
      price("rider", r4, gp1, 10), price("rider", r4, gp2, 10),
      price("rider", r5, gp1, 8), price("rider", r5, gp2, 8),
      price("rider", r6, gp1, 25), price("rider", r6, gp2, 25),
      price("rider", r7, gp1, 22), price("rider", r7, gp2, 22),
      price("constructor", c1, gp1, 12), price("constructor", c1, gp2, 12),
      price("constructor", c2, gp1, 20), price("constructor", c2, gp2, 20),
      price("team", t1, gp1, 10), price("team", t1, gp2, 10),
      price("team", t2, gp1, 18), price("team", t2, gp2, 18),
    ];
    await prisma.price.createMany({ data: priceRows });
    type Slot = { slotType: SlotType; assetType: AssetType; assetId: string };
    const dSlots: Slot[] = [
      { slotType: "gold", assetType: "rider", assetId: r1 },
      { slotType: "gold", assetType: "rider", assetId: r2 },
      { slotType: "silver", assetType: "rider", assetId: r4 },
      { slotType: "silver", assetType: "rider", assetId: r5 },
      { slotType: "constructor", assetType: "constructor", assetId: c1 },
      { slotType: "team", assetType: "team", assetId: t1 },
    ];
    const eSlots: Slot[] = [
      { slotType: "gold", assetType: "rider", assetId: r1 },
      { slotType: "gold", assetType: "rider", assetId: r2 },
      { slotType: "silver", assetType: "rider", assetId: r6 },
      { slotType: "silver", assetType: "rider", assetId: r7 },
      { slotType: "constructor", assetType: "constructor", assetId: c2 },
      { slotType: "team", assetType: "team", assetId: t2 },
    ];
    const dLineups = await prisma.lineup.findMany({ where: { userId: userD } });
    const eLineups = await prisma.lineup.findMany({ where: { userId: userE } });
    for (const l of dLineups) {
      await prisma.lineupSlot.createMany({
        data: dSlots.map((s) => ({ ...s, lineupId: l.id })),
      });
    }
    for (const l of eLineups) {
      await prisma.lineupSlot.createMany({
        data: eSlots.map((s) => ({ ...s, lineupId: l.id })),
      });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /**
   * La última publicación de un ranking (por `computedAt`, como `myRankings`):
   * `recalculateRankings` versiona (nuevas filas por recálculo), así que se
   * lee la más reciente, no todas.
   */
  async function latestRankings(where: { gpId: string | null }, league: string = leagueId) {
    const latest = await prisma.ranking.findFirst({
      where: { leagueId: league, ...where },
      select: { computedAt: true },
      orderBy: { computedAt: "desc" },
    });
    if (!latest) return [];
    return prisma.ranking.findMany({
      where: { leagueId: league, ...where, computedAt: latest.computedAt },
      orderBy: { position: "asc" },
    });
  }

  it("publica el ranking por GP (orden por puntos de ese GP)", async () => {
    await service.recalculateRankings(gp2, "rv-1");

    const gp1Ranking = await latestRankings({ gpId: gp1 });
    expect(gp1Ranking.map((r) => r.userId)).toEqual([userC, userA, userB]);
    expect(gp1Ranking.map((r) => r.position)).toEqual([1, 2, 3]);
    expect(Number(gp1Ranking[0]!.points)).toBe(150); // C

    const gp2Ranking = await latestRankings({ gpId: gp2 });
    expect(gp2Ranking.map((r) => r.userId)).toEqual([userB, userA, userC]);
    expect(Number(gp2Ranking[0]!.points)).toBe(100); // B
  });

  it("publica el ranking general con los desempates de leagues.md §8", async () => {
    await service.recalculateRankings(gp2, "rv-1");

    const overall = await latestRankings({ gpId: null });
    // Todos 150: C y B ganaron 1 GP (A ninguno) → C,B > A; C y B empatan en
    // GPs ganados → último GP: B (100) > C (0) → B > C > A.
    expect(overall.map((r) => r.userId)).toEqual([userB, userC, userA]);
    expect(overall.map((r) => r.position)).toEqual([1, 2, 3]);
    for (const r of overall) expect(Number(r.points)).toBe(150);

    // Los desempates quedan registrados (auditoría/depuración).
    const b = overall.find((r) => r.userId === userB)!;
    expect(b.tiebreakers).toMatchObject({ gpsWon: 1, lastGpScore: 100 });
    const c = overall.find((r) => r.userId === userC)!;
    expect(c.tiebreakers).toMatchObject({ gpsWon: 1, lastGpScore: 0 });
    const a = overall.find((r) => r.userId === userA)!;
    expect(a.tiebreakers).toMatchObject({ gpsWon: 0, lastGpScore: 50 });
  });

  it("desempate 3: menor coste total de lineups (leagues.md §8)", async () => {
    await service.recalculateRankings(gp2, "rv-1");

    const overall = await latestRankings({ gpId: null }, costLeagueId);
    // D y E: 200 pts, 0 GPs ganados, último GP 100 → empatan hasta el coste.
    // D (150) < E (240) → D por delante.
    expect(overall.map((r) => r.userId)).toEqual([userD, userE]);
    expect(overall.map((r) => r.position)).toEqual([1, 2]);
    expect(Number(overall[0]!.points)).toBe(200); // D
    expect(Number(overall[1]!.points)).toBe(200); // E

    // El coste queda registrado como desempate (auditoría/depuración).
    const d = overall.find((r) => r.userId === userD)!;
    expect(d.tiebreakers).toMatchObject({ gpsWon: 0, lastGpScore: 100, totalCost: 150 });
    const e = overall.find((r) => r.userId === userE)!;
    expect(e.tiebreakers).toMatchObject({ gpsWon: 0, lastGpScore: 100, totalCost: 240 });
  });

  it("versiona los rankings por results_version", async () => {
    const rows = await prisma.ranking.findMany({
      where: { leagueId, resultsVersion: "rv-1" },
      select: { id: true },
    });
    expect(rows.length).toBeGreaterThan(0);
  });

  it("liga sin miembros activos → no publica rankings para ella", async () => {
    // Liga vacía (sin miembros activos) → no se publican rankings para ella.
    // Nota: `result.leagues` cuenta TODAS las ligas con miembros activos de la
    // BD (las ligas son agnósticas de temporada y comparten `scores`,
    // invariante 4), así que aquí solo se verifica que la vacía no reciba filas.
    const emptyLeague = (
      await prisma.league.create({ data: { name: `Liga vacía ${suffix}`, type: "private" } })
    ).id;
    const result = await service.recalculateRankings(gp2, "rv-1");
    expect(result.leagues).toBeGreaterThanOrEqual(1); // al menos la del escenario
    const emptyRankings = await prisma.ranking.count({ where: { leagueId: emptyLeague } });
    expect(emptyRankings).toBe(0);
  });

  it("GP inexistente → NOT_FOUND", async () => {
    await expect(service.recalculateRankings(randomUUID(), "rv-1")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
