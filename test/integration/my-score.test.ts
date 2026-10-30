/**
 * US-20 · Mi puntuación con desglose (PostgreSQL real).
 *
 * Replica el ejemplo de `docs/product/scoring.md` §5 (**170.5 puntos**) contra
 * datos reales importados en un GP de test: el desglose que ve el usuario
 * (`results.myScore`) coincide con el módulo puro `scoring` (el total y el
 * desglose por piloto/constructor/equipo que escribió el recálculo US-18/US-19).
 *
 * Escenario (reglas PROVISIONAL, `season_rules` scoring-v1):
 * - Lineup: oro = {A, C} · plata = {E, H} · constructor = X · equipo = X-team.
 * - A = 56 (pole + 1º sprint + 1º GP + ganador) · C = 32 (2º GP + 1 pos. ganada)
 *   · E = 17 · H = −4 (DNF carrera) · B = 20 · I = 6 (campo, fuera del lineup).
 * - Constructor X y equipo X-team: pilotos {A, B, I} → 56, 20, 6 →
 *   media top-2 = {56, 20} → **38.0**.
 * - **Total lineup = 56 + 32 + 0.5·17 + 0.5·(−4) + 38 + 38 = 170.5.**
 *
 * Semánticas bajo test:
 * - `myScore`: desglose por piloto (Q2/sprint/GP/bonos/penal) con pesos
 *   oro/plata, constructor y equipo, nombres resueltos; total = 170.5.
 * - Gates: GP inexistente (NOT_FOUND), sin lineup (NOT_FOUND), sin resultados
 *   definitivos (PRECONDITION_FAILED).
 * - RBAC: `protectedProcedure` (401 sin sesión); el usuario ve su propia
 *   puntuación (`ctx.user.id`).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "@prisma/client";

import { PROVISIONAL_SEASON_RULES } from "../../app/shared/config/season-rules";
import type { ResultBonusCode, ResultPenaltyCode } from "../../app/shared/types";
import {
  CapturingEmailSender,
  createPrisma,
  integrationDbUrl,
  seedWorld,
  type World,
} from "./helpers";

// Antes de importar los módulos de la app (sus singletons leen env al cargar).
process.env.DATABASE_URL = integrationDbUrl();
process.env.REDIS_URL ??= "redis://localhost:6379/0"; // dummy: lazyConnect, no se conecta

const { createAuthRouter } = await import("../../app/server/routers/auth");
const { createResultsRouter } = await import("../../app/server/routers/results");
const { createContext } = await import("../../app/server/trpc");
const { InMemoryRateLimitStore } = await import("../../app/modules/identity");

const suffix = randomUUID().slice(0, 8);
const ADMIN_EMAIL = `admin-${suffix}@test.local`;
const ADMIN_USERNAME = `admin_${suffix}`;
const USER_EMAIL = `user-${suffix}@test.local`;
const USER_USERNAME = `user_${suffix}`;
const PASSWORD = "contraseña-segura-1";
const ADMIN_IP = "198.51.100.42";
const USER_IP = "198.51.100.43";

/** Entrada de resultados con valores por defecto coherentes. */
function entry(
  riderId: string,
  values: {
    position?: number | null;
    started?: boolean;
    finished?: boolean;
    penalties?: ResultPenaltyCode[];
    bonuses?: ResultBonusCode[];
  } = {},
) {
  return {
    riderId,
    position: values.position ?? null,
    started: values.started ?? true,
    finished: values.finished ?? false,
    penalties: values.penalties ?? [],
    bonuses: values.bonuses ?? [],
    rawPoints: null,
  };
}

describe("US-20 · Mi puntuación con desglose (PostgreSQL real)", () => {
  let prisma: PrismaClient;
  let authRouter: ReturnType<typeof createAuthRouter>;
  let resultsRouter: ReturnType<typeof createResultsRouter>;
  let world: World;
  let adminToken: string;
  let userToken: string;

  // Pilotos del mundo: A=r1 · B=r2 · C=r3 · E=r4 · H=r5 · I=r6.
  let A: string;
  let B: string;
  let C: string;
  let E: string;
  let H: string;
  let I: string;

  // Eventos del GP (seedWorld crea solo la carrera, orderNum 1).
  let q2: string;
  let sprint: string;

  // Constructores/equipo adicionales: C y E en X2; H en X4 (no contaminan
  // la media top-2 de X / X-team).
  let x2Ctor: string;
  let x2Team: string;
  let x4Ctor: string;
  let x4Team: string;

  beforeAll(async () => {
    prisma = createPrisma();
    authRouter = createAuthRouter({
      prisma,
      rateLimit: new InMemoryRateLimitStore(),
      sessionTtlSec: 3600,
      secureCookie: true,
      rateLimitCfg: {
        maxPerWindow: 5,
        windowSec: 60,
        lockoutThreshold: 3,
        lockoutSec: 900,
      },
      emailSender: new CapturingEmailSender(),
      appUrl: "http://localhost:3000",
      resetCfg: { tokenTtlSec: 3600, maxPerWindow: 5, windowSec: 300 },
      bootstrapAdminEmail: ADMIN_EMAIL,
    });
    resultsRouter = createResultsRouter({ prisma });
    world = await seedWorld(prisma);

    A = world.riders[0].id;
    B = world.riders[1].id;
    C = world.riders[2].id;
    E = world.riders[3].id;
    H = world.riders[4].id;
    I = world.riders[5].id;

    // Resto del fin de semana (seedWorld crea solo la carrera).
    q2 = (
      await prisma.weekendEvent.create({ data: { gpId: world.gp.id, type: "q2", orderNum: 3 } })
    ).id;
    sprint = (
      await prisma.weekendEvent.create({ data: { gpId: world.gp.id, type: "sprint", orderNum: 4 } })
    ).id;

    // Reglas de la temporada (PROVISIONAL) — el recálculo las requiere.
    await prisma.seasonRule.create({
      data: {
        seasonId: world.season.id,
        version: "scoring-v1",
        rules: PROVISIONAL_SEASON_RULES as unknown as Parameters<
          PrismaClient["seasonRule"]["create"]
        >[0]["data"]["rules"],
      },
    });

    // Constructores/equipo adicionales (C, E en X2; H en X4).
    x2Ctor = (await prisma.constructor.create({ data: { name: `X2 ${suffix}` } })).id;
    x2Team = (
      await prisma.team.create({ data: { name: `X2-team ${suffix}`, constructorId: x2Ctor } })
    ).id;
    x4Ctor = (await prisma.constructor.create({ data: { name: `X4 ${suffix}` } })).id;
    x4Team = (
      await prisma.team.create({ data: { name: `X4-team ${suffix}`, constructorId: x4Ctor } })
    ).id;

    // Afiliaciones del GP: X/X-team = {A, B, I} · X2 = {C, E} · X4 = {H}.
    const affiliations: [string, string, string][] = [
      [A, world.ctor.id, world.team.id],
      [B, world.ctor.id, world.team.id],
      [I, world.ctor.id, world.team.id],
      [C, x2Ctor, x2Team],
      [E, x2Ctor, x2Team],
      [H, x4Ctor, x4Team],
    ];
    for (const [riderId, constructorId, teamId] of affiliations) {
      await prisma.riderAffiliation.create({
        data: { riderId, constructorId, teamId, gpId: world.gp.id },
      });
    }

    // Admin global (bootstrap, ADR-0010) + usuario normal (dueño del lineup).
    const adminCaller = await callerFor(ADMIN_IP);
    await adminCaller.auth.register({
      email: ADMIN_EMAIL,
      username: ADMIN_USERNAME,
      password: PASSWORD,
      termsAccepted: true,
    });
    adminToken = sessionTokenFrom(adminCaller.ctx);

    const userCaller = await callerFor(USER_IP);
    const userReg = await userCaller.auth.register({
      email: USER_EMAIL,
      username: USER_USERNAME,
      password: PASSWORD,
      termsAccepted: true,
    });
    const userId = userReg.user.id;
    userToken = sessionTokenFrom(userCaller.ctx);

    // Lineup del usuario de auth: oro = {A, C} · plata = {E, H} · constructor
    // = X · equipo = X-team (una sola sentencia: trigger de composición).
    const lineup = await prisma.lineup.create({
      data: { userId, gpId: world.gp.id },
    });
    await prisma.lineupSlot.createMany({
      data: [
        { lineupId: lineup.id, slotType: "gold", assetType: "rider", assetId: A },
        { lineupId: lineup.id, slotType: "gold", assetType: "rider", assetId: C },
        { lineupId: lineup.id, slotType: "silver", assetType: "rider", assetId: E },
        { lineupId: lineup.id, slotType: "silver", assetType: "rider", assetId: H },
        { lineupId: lineup.id, slotType: "constructor", assetType: "constructor", assetId: world.ctor.id },
        { lineupId: lineup.id, slotType: "team", assetType: "team", assetId: world.team.id },
      ],
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Contexto tRPC para una petición simulada (IP + cookie de sesión opcional). */
  async function callerFor(ip: string, sessionToken?: string) {
    const headers: Record<string, string> = { "x-forwarded-for": ip };
    if (sessionToken !== undefined) headers.cookie = `session=${sessionToken}`;
    const req = new Request("http://localhost/api/trpc/results", {
      method: "POST",
      headers,
    });
    const ctx = await createContext(req, prisma);
    return {
      ctx,
      auth: authRouter.createCaller(ctx),
      results: resultsRouter.createCaller(ctx),
    };
  }

  /** Extrae el token de la cookie de sesión emitida en `ctx.pendingCookies`. */
  function sessionTokenFrom(ctx: { pendingCookies: string[] }): string {
    expect(ctx.pendingCookies).toHaveLength(1);
    const token = /^session=([0-9a-f]{64});/.exec(ctx.pendingCookies[0] ?? "")?.[1];
    if (!token) throw new Error(`Cookie de sesión inesperada: ${ctx.pendingCookies[0]}`);
    return token;
  }

  // ── Gates + RBAC (sin resultados definitivos todavía) ─────────────────────

  it("myScore sin resultados definitivos → PRECONDITION_FAILED", async () => {
    const { results } = await callerFor(USER_IP, userToken);
    await expect(results.myScore({ gpId: world.gp.id })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message:
        "Este GP aún no tiene resultados definitivos; tu puntuación aparecerá cuando se marquen definitivos.",
    });
  });

  it("myScore con GP inexistente → NOT_FOUND", async () => {
    const { results } = await callerFor(USER_IP, userToken);
    await expect(results.myScore({ gpId: randomUUID() })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "El GP no existe.",
    });
  });

  it("myScore sin sesión → UNAUTHORIZED", async () => {
    const { results } = await callerFor(USER_IP);
    await expect(results.myScore({ gpId: world.gp.id })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("myScore sin lineup en el GP → NOT_FOUND", async () => {
    // El usuario no tiene lineup en este GP (ronda 3, sin lineup).
    const otherGp = (
      await prisma.gp.create({
        data: {
          seasonId: world.season.id,
          round: 3,
          name: `GP ${suffix} sin lineup`,
          circuitId: world.gp.circuitId,
          date: new Date("2099-06-15T12:00:00Z"),
        },
      })
    ).id;
    const { results } = await callerFor(USER_IP, userToken);
    await expect(results.myScore({ gpId: otherGp })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "No tienes lineup para este GP.",
    });
  });

  // ── Importación de resultados + definitivo → myScore = 170.5 ──────────────

  it("importa Q2/sprint/carrera, marca definitivo y myScore = 170.5 con desglose", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);

    // Q2: A p1 (pole) · B p2 · C p3 · E p6 · H p15 · I p12.
    const q2Payload = {
      gpId: world.gp.id,
      eventId: q2,
      entries: [
        entry(A, { position: 1, finished: true, bonuses: ["pole"] }),
        entry(B, { position: 2, finished: true }),
        entry(C, { position: 3, finished: true }),
        entry(E, { position: 6, finished: true }),
        entry(H, { position: 15, finished: true }),
        entry(I, { position: 12, finished: true }),
      ],
    };
    expect(await results.importEvent(q2Payload)).toMatchObject({ created: 6 });

    // Sprint: A p1 · B p3 · C p7 · E p8 · H DNF · I p9.
    const sprintPayload = {
      gpId: world.gp.id,
      eventId: sprint,
      entries: [
        entry(A, { position: 1, finished: true }),
        entry(B, { position: 3, finished: true }),
        entry(C, { position: 7, finished: true }),
        entry(E, { position: 8, finished: true }),
        entry(H, {}), // DNF (salió, no terminó) → 0 puntos, sin penalización.
        entry(I, { position: 9, finished: true }),
      ],
    };
    expect(await results.importEvent(sprintPayload)).toMatchObject({ created: 6 });

    // Carrera: A p1 (ganador) · B p11 · C p2 · E p6 · H DNF (−5) · I p14.
    const racePayload = {
      gpId: world.gp.id,
      eventId: world.event.id,
      entries: [
        entry(A, { position: 1, finished: true }),
        entry(B, { position: 11, finished: true }),
        entry(C, { position: 2, finished: true }),
        entry(E, { position: 6, finished: true }),
        entry(H, {}), // DNF (salió, no terminó) → 0 puntos + penalización −5.
        entry(I, { position: 14, finished: true }),
      ],
    };
    expect(await results.importEvent(racePayload)).toMatchObject({ created: 6 });

    // Marcar definitivo → primer recálculo (rv-1) con el motor puro.
    await results.markDefinitive({ gpId: world.gp.id });

    // El usuario ve su puntuación con el desglose.
    const { results: userResults } = await callerFor(USER_IP, userToken);
    const score = await userResults.myScore({ gpId: world.gp.id });

    // Total = 170.5 (scoring.md §5).
    expect(score.total).toBeCloseTo(170.5, 2);
    expect(score.pointsTotal).toBeCloseTo(170.5, 2);

    // Identidad del GP + versiones.
    expect(score.gpId).toBe(world.gp.id);
    expect(score.gpName).toBe(world.gp.name);
    expect(score.round).toBe(world.gp.round);
    expect(score.seasonName).toBe(world.season.name);
    expect(score.rulesVersion).toBe("scoring-v1");
    expect(score.resultsVersion).toBe("rv-1");

    // Composición: 2 oro + 2 plata, con pesos oro/plata.
    expect(score.gold).toHaveLength(2);
    expect(score.silver).toHaveLength(2);
    for (const g of score.gold) expect(g.weight).toBe(1.0);
    for (const s of score.silver) expect(s.weight).toBe(0.5);

    // Pilotos del lineup (nombres resueltos).
    const goldIds = new Set(score.gold.map((g) => g.riderId));
    expect(goldIds.has(A)).toBe(true);
    expect(goldIds.has(C)).toBe(true);
    const silverIds = new Set(score.silver.map((s) => s.riderId));
    expect(silverIds.has(E)).toBe(true);
    expect(silverIds.has(H)).toBe(true);
    for (const g of score.gold) expect(g.riderName).toBeTruthy();
    for (const s of score.silver) expect(s.riderName).toBeTruthy();

    // Puntos ponderados por piloto (motor puro): oro ×1.0, plata ×0.5.
    const aView = score.gold.find((g) => g.riderId === A)!;
    expect(aView.points).toBeCloseTo(56, 2);
    const cView = score.gold.find((g) => g.riderId === C)!;
    expect(cView.points).toBeCloseTo(32, 2);
    const eView = score.silver.find((s) => s.riderId === E)!;
    expect(eView.points).toBeCloseTo(8.5, 2); // 17 × 0.5
    const hView = score.silver.find((s) => s.riderId === H)!;
    expect(hView.points).toBeCloseTo(-2, 2); // −4 × 0.5

    // Desglose de A: Q2 12 + pole 2 · sprint 12 · GP 25 + ganador 5 → 56.
    expect(aView.breakdown.q2).toBe(12);
    expect(aView.breakdown.sprint).toBe(12);
    expect(aView.breakdown.mainRace).toBe(25);
    expect(aView.breakdown.bonuses).toEqual(
      expect.arrayContaining([
        { code: "pole", points: 2 },
        { code: "winner", points: 5 },
      ]),
    );
    expect(aView.breakdown.penalties).toHaveLength(0);
    expect(aView.breakdown.total).toBeCloseTo(56, 2);

    // Desglose de C: Q2 8 · sprint 3 · GP 20 + 1 pos. ganada → 32.
    expect(cView.breakdown.q2).toBe(8);
    expect(cView.breakdown.sprint).toBe(3);
    expect(cView.breakdown.mainRace).toBe(20);
    expect(cView.breakdown.bonuses).toEqual([{ code: "positions-gained", points: 1 }]);
    expect(cView.breakdown.total).toBeCloseTo(32, 2);

    // Desglose de H: Q2 1 · sprint 0 (DNF) · GP 0 (DNF) − 5 → −4.
    expect(hView.breakdown.q2).toBe(1);
    expect(hView.breakdown.sprint).toBe(0);
    expect(hView.breakdown.mainRace).toBe(0);
    expect(hView.breakdown.penalties).toEqual([{ code: "dnf", points: -5 }]);
    expect(hView.breakdown.total).toBeCloseTo(-4, 2);

    // Constructor y equipo: 38.0 (media top-2 {56, 20}), nombres resueltos.
    // `manufacturer` (NO `constructor`): superjson rechaza la key propia
    // `constructor` al serializar la respuesta (anti prototype pollution).
    expect(score.manufacturer.id).toBe(world.ctor.id);
    expect(score.manufacturer.name).toBe(world.ctor.name);
    expect(score.manufacturer.points).toBeCloseTo(38, 2);
    expect(score.team.id).toBe(world.team.id);
    expect(score.team.name).toBe(world.team.name);
    expect(score.team.points).toBeCloseTo(38, 2);
  });
});
