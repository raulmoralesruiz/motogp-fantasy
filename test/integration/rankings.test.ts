/**
 * US-21 · Rankings por GP y general (PostgreSQL real).
 * US-28 · Ranking sobre miembros activos (cierre; la implementación es la de
 *   US-21/ADR-0022: solo miembros `active` entran en la publicación).
 * US-29 · Multi-liga: un único lineup por GP y los mismos puntos en todas
 *   las ligas (invariantes 3 y 4; la garantía es el esquema de BD + el
 *   motor de puntuación, aquí se verifica el resultado integral).
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

  // ── US-28 · Ranking sobre miembros activos (leagues.md §8) ──────────────
  // CA: "cada liga tiene su ranking (GP y general) sobre sus miembros
  // activos". Un miembro que sale (`status = left`) queda fuera de la nueva
  // publicación; el histórico (publicaciones anteriores, versionadas por
  // append) se conserva.

  it("US-28: un miembro que sale (left) queda fuera de la nueva publicación; el histórico se conserva", async () => {
    // Liga nueva con dos miembros nuevos, ambos con score en gp1.
    const userG = (
      await prisma.user.create({
        data: { email: `g-${suffix}@test.local`, passwordHash: "h", username: `g_${suffix}` },
      })
    ).id;
    const userF = (
      await prisma.user.create({
        data: { email: `f-${suffix}@test.local`, passwordHash: "h", username: `f_${suffix}` },
      })
    ).id;
    const l5 = (
      await prisma.league.create({ data: { name: `Liga US28 ${suffix}`, type: "private" } })
    ).id;
    await prisma.leagueMember.createMany({
      data: [
        { leagueId: l5, userId: userG, joinedAt: new Date("2098-01-01T00:00:00Z") },
        { leagueId: l5, userId: userF, joinedAt: new Date("2098-01-02T00:00:00Z") },
      ],
    });
    for (const [uid, pts] of [
      [userG, 100],
      [userF, 60],
    ] as const) {
      const lineup = await prisma.lineup.create({ data: { userId: uid, gpId: gp1 } });
      await prisma.score.create({
        data: {
          lineupId: lineup.id,
          userId: uid,
          gpId: gp1,
          pointsTotal: pts,
          breakdown: {},
          rulesVersion: "scoring-v1",
          resultsVersion: "rv-1",
        },
      });
    }

    // 1ª publicación: ambos miembros activos aparecen.
    await service.recalculateRankings(gp1, "rv-1");
    const first = await latestRankings({ gpId: gp1 }, l5);
    expect(first.map((r) => r.userId).sort()).toEqual([userG, userF].sort());
    expect(first.find((r) => r.userId === userG)!.position).toBe(1);
    expect(first.find((r) => r.userId === userF)!.position).toBe(2);

    // userF sale de la liga (status → left; la acción de salida la
    // implementa US-27, aquí solo el estado de la membresía).
    await prisma.leagueMember.update({
      where: { leagueId_userId: { leagueId: l5, userId: userF } },
      data: { status: "left", leftAt: new Date() },
    });

    // 2ª publicación (nueva versión): userF queda fuera; userG solo.
    await service.recalculateRankings(gp1, "rv-1");
    const second = await latestRankings({ gpId: gp1 }, l5);
    expect(second).toHaveLength(1);
    expect(second[0]!.userId).toBe(userG);
    expect(second[0]!.position).toBe(1);

    // El histórico (1ª publicación) se conserva: 2 filas antiguas + 1 nueva.
    const total = await prisma.ranking.count({ where: { leagueId: l5, gpId: gp1 } });
    expect(total).toBe(3);
  });

  // ── US-29 · Multi-liga: mismo lineup, mismos puntos (invariantes 3 y 4) ─
  // CA: "un usuario en 2+ ligas tiene un único lineup por GP y los mismos
  // puntos en todas las ligas (los `scores` son por `(user, gp)`; los
  // `rankings` por `(league, user, gp)` con valores idénticos)".

  it("US-29: un usuario en 2 ligas tiene un único lineup por GP y los mismos puntos en ambas", async () => {
    // Usuario nuevo en dos ligas nuevas.
    const userX = (
      await prisma.user.create({
        data: { email: `x-${suffix}@test.local`, passwordHash: "h", username: `x_${suffix}` },
      })
    ).id;
    const l3 = (
      await prisma.league.create({ data: { name: `Liga US29a ${suffix}`, type: "private" } })
    ).id;
    const l4 = (
      await prisma.league.create({ data: { name: `Liga US29b ${suffix}`, type: "private" } })
    ).id;
    await prisma.leagueMember.createMany({
      data: [
        { leagueId: l3, userId: userX, joinedAt: new Date("2098-01-01T00:00:00Z") },
        { leagueId: l4, userId: userX, joinedAt: new Date("2098-01-01T00:00:00Z") },
      ],
    });

    // Un único lineup por GP (invariante 3): el 2º intento para el mismo
    // (user, gp) lo rechaza la constraint única de BD.
    const lineup = await prisma.lineup.create({ data: { userId: userX, gpId: gp1 } });
    await expect(prisma.lineup.create({ data: { userId: userX, gpId: gp1 } })).rejects.toMatchObject(
      { code: "P2002" },
    );

    // Score para ese único lineup (los scores son por (user, gp), invariante 4).
    await prisma.score.create({
      data: {
        lineupId: lineup.id,
        userId: userX,
        gpId: gp1,
        pointsTotal: 80,
        breakdown: {},
        rulesVersion: "scoring-v1",
        resultsVersion: "rv-1",
      },
    });

    await service.recalculateRankings(gp1, "rv-1");

    // Mismos puntos en ambas ligas, por GP…
    const inL3 = (await latestRankings({ gpId: gp1 }, l3)).find((r) => r.userId === userX);
    const inL4 = (await latestRankings({ gpId: gp1 }, l4)).find((r) => r.userId === userX);
    expect(inL3).toBeDefined();
    expect(inL4).toBeDefined();
    expect(Number(inL3!.points)).toBe(80);
    expect(Number(inL4!.points)).toBe(80);
    expect(inL3!.points.toString()).toBe(inL4!.points.toString()); // valores idénticos

    // …y en el ranking general.
    const overallL3 = (await latestRankings({ gpId: null }, l3)).find((r) => r.userId === userX);
    const overallL4 = (await latestRankings({ gpId: null }, l4)).find((r) => r.userId === userX);
    expect(overallL3).toBeDefined();
    expect(overallL4).toBeDefined();
    expect(Number(overallL3!.points)).toBe(80);
    expect(Number(overallL4!.points)).toBe(80);
  });

  // ── US-30 · Entrada a mitad de temporada (leagues.md §7) ────────────────

  it("US-30: un recién llegado no hereda GPs previos y el ranking ajustado es por liga", async () => {
    const veteran = (
      await prisma.user.create({
        data: { email: `v30-${suffix}@test.local`, passwordHash: "h", username: `v30_${suffix}` },
      })
    ).id;
    const newcomer = (
      await prisma.user.create({
        data: { email: `n30-${suffix}@test.local`, passwordHash: "h", username: `n30_${suffix}` },
      })
    ).id;
    const normalLeague = (
      await prisma.league.create({ data: { name: `Liga US30 ${suffix}`, type: "private" } })
    ).id;
    const adjustedLeague = (
      await prisma.league.create({
        data: { name: `Liga US30 ajustada ${suffix}`, type: "private", adjustedRankingEnabled: true },
      })
    ).id;

    await prisma.leagueMember.createMany({
      data: [
        { leagueId: normalLeague, userId: veteran, joinedAt: new Date("2098-01-01T00:00:00Z") },
        { leagueId: normalLeague, userId: newcomer, joinedAt: new Date("2098-05-15T00:00:00Z") },
        { leagueId: adjustedLeague, userId: veteran, joinedAt: new Date("2098-01-01T00:00:00Z") },
        { leagueId: adjustedLeague, userId: newcomer, joinedAt: new Date("2098-05-15T00:00:00Z") },
      ],
    });

    const scores: [string, string, number][] = [
      [veteran, gp1, 100],
      [veteran, gp2, 50],
      [newcomer, gp1, 200],
      [newcomer, gp2, 100],
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

    await service.recalculateRankings(gp2, "rv-us30");

    // GP1: el recién llegado no aparece aunque tenga un score previo.
    const gp1Normal = await latestRankings({ gpId: gp1 }, normalLeague);
    expect(gp1Normal.map((r) => r.userId)).toEqual([veteran]);
    expect(Number(gp1Normal[0]!.points)).toBe(100);
    const gp1Adjusted = await latestRankings({ gpId: gp1 }, adjustedLeague);
    expect(gp1Adjusted.map((r) => r.userId)).toEqual([veteran]);

    // GP2: ambos son elegibles.
    const gp2Normal = await latestRankings({ gpId: gp2 }, normalLeague);
    expect(gp2Normal.map((r) => r.userId)).toEqual([newcomer, veteran]);
    expect(gp2Normal.map((r) => Number(r.points))).toEqual([100, 50]);

    // General normal: el recién llegado solo cuenta desde su entrada.
    const overallNormal = await latestRankings({ gpId: null }, normalLeague);
    expect(overallNormal.map((r) => r.userId)).toEqual([veteran, newcomer]);
    expect(Number(overallNormal.find((r) => r.userId === veteran)!.points)).toBe(150);
    expect(Number(overallNormal.find((r) => r.userId === newcomer)!.points)).toBe(100);

    // General ajustado: ambos cuentan solo desde la última entrada.
    const overallAdjusted = await latestRankings({ gpId: null }, adjustedLeague);
    expect(overallAdjusted.map((r) => r.userId)).toEqual([newcomer, veteran]);
    expect(Number(overallAdjusted.find((r) => r.userId === newcomer)!.points)).toBe(100);
    expect(Number(overallAdjusted.find((r) => r.userId === veteran)!.points)).toBe(50);
  });

  it("US-30: los desempates no heredan GPs previos a la entrada del miembro", async () => {
    const veteran = (
      await prisma.user.create({
        data: { email: `vc30-${suffix}@test.local`, passwordHash: "h", username: `vc30_${suffix}` },
      })
    ).id;
    const newcomer = (
      await prisma.user.create({
        data: { email: `nc30-${suffix}@test.local`, passwordHash: "h", username: `nc30_${suffix}` },
      })
    ).id;
    const league = (
      await prisma.league.create({ data: { name: `Liga US30 coste ${suffix}`, type: "private" } })
    ).id;
    await prisma.leagueMember.createMany({
      data: [
        { leagueId: league, userId: veteran, joinedAt: new Date("2098-01-01T00:00:00Z") },
        { leagueId: league, userId: newcomer, joinedAt: new Date("2098-05-15T00:00:00Z") },
      ],
    });

    for (const userId of [veteran, newcomer]) {
      for (const gpId of [gp1, gp2]) {
        const lineup = await prisma.lineup.create({ data: { userId, gpId } });
        await prisma.score.create({
          data: {
            lineupId: lineup.id,
            userId,
            gpId,
            pointsTotal: 100,
            breakdown: {},
            rulesVersion: "scoring-v1",
            resultsVersion: "rv-1",
          },
        });
      }
    }

    // Costes distintos SOLO en GP1 (previo a la entrada del recién llegado).
    const mkRider = (n: string) => prisma.rider.create({ data: { name: `${n} ${suffix}` } }).then((r) => r.id);
    const mkCtor = (n: string) => prisma.constructor.create({ data: { name: `${n} ${suffix}` } }).then((c) => c.id);
    const mkTeam = (n: string, ctorId: string) =>
      prisma.team.create({ data: { name: `${n} ${suffix}`, constructorId: ctorId } }).then((t) => t.id);
    const [vr1, vr2, vs1, vs2, vc1, vn1, vn2, vn3, vn4, vc2] = await Promise.all([
      mkRider("V1"),
      mkRider("V2"),
      mkRider("VS1"),
      mkRider("VS2"),
      mkCtor("VC1"),
      mkRider("N1"),
      mkRider("N2"),
      mkRider("NS1"),
      mkRider("NS2"),
      mkCtor("NC1"),
    ]);
    const [vt1, nt1] = await Promise.all([mkTeam("VT1", vc1), mkTeam("NT1", vc2)]);
    const price = (assetType: AssetType, assetId: string, p: number) => ({
      assetType,
      assetId,
      gpId: gp1,
      price: p,
    });
    await prisma.price.createMany({
      data: [
        price("rider", vr1, 20),
        price("rider", vr2, 20),
        price("rider", vs1, 20),
        price("rider", vs2, 20),
        price("constructor", vc1, 20),
        price("team", vt1, 20),
        price("rider", vn1, 10),
        price("rider", vn2, 10),
        price("rider", vn3, 10),
        price("rider", vn4, 10),
        price("constructor", vc2, 10),
        price("team", nt1, 10),
      ],
    });
    type Slot = { slotType: SlotType; assetType: AssetType; assetId: string };
    const veteranSlots: Slot[] = [
      { slotType: "gold", assetType: "rider", assetId: vr1 },
      { slotType: "gold", assetType: "rider", assetId: vr2 },
      { slotType: "silver", assetType: "rider", assetId: vs1 },
      { slotType: "silver", assetType: "rider", assetId: vs2 },
      { slotType: "constructor", assetType: "constructor", assetId: vc1 },
      { slotType: "team", assetType: "team", assetId: vt1 },
    ];
    const newcomerSlots: Slot[] = [
      { slotType: "gold", assetType: "rider", assetId: vn1 },
      { slotType: "gold", assetType: "rider", assetId: vn2 },
      { slotType: "silver", assetType: "rider", assetId: vn3 },
      { slotType: "silver", assetType: "rider", assetId: vn4 },
      { slotType: "constructor", assetType: "constructor", assetId: vc2 },
      { slotType: "team", assetType: "team", assetId: nt1 },
    ];
    const veteranLineup = await prisma.lineup.findFirstOrThrow({ where: { userId: veteran, gpId: gp1 } });
    const newcomerLineup = await prisma.lineup.findFirstOrThrow({ where: { userId: newcomer, gpId: gp1 } });
    await prisma.lineupSlot.createMany({
      data: veteranSlots.map((s) => ({ ...s, lineupId: veteranLineup.id })),
    });
    await prisma.lineupSlot.createMany({
      data: newcomerSlots.map((s) => ({ ...s, lineupId: newcomerLineup.id })),
    });

    await service.recalculateRankings(gp2, "rv-us30-cost");

    const overall = await latestRankings({ gpId: null }, league);
    // Ambos empatan en puntos/GPs ganados/último GP. El coste de GP1 NO cuenta
    // para el recién llegado, así que el desempate es la antigüedad: veteran > newcomer.
    expect(overall.map((r) => r.userId)).toEqual([veteran, newcomer]);
    const newcomerRow = overall.find((r) => r.userId === newcomer)!;
    expect(newcomerRow.tiebreakers).toMatchObject({ gpsWon: 0, lastGpScore: 100, totalCost: 0 });
  });
});
