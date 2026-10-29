/**
 * US-22 · Pantallas de resultados y ranking (PostgreSQL real).
 *
 * Cubre `results.myResults` (composición BFF: estado del GP + posiciones por
 * liga + delta vs el GP anterior + recálculo con histórico) sobre datos
 * reales:
 *
 * - **Estado del GP**: definitivo/versión, cancelado (`cancelled = true` —
 *   CA: "GP cancelado, 0 puntos").
 * - **Posición + delta**: dos usuarios en una liga; en la ronda 1 gana el
 *   usuario 1 (170.5, scoring.md §5) y en la ronda 2 gana el usuario 2 →
 *   delta del usuario 1 = 1 − 2 = −1 (bajó) y del usuario 2 = 2 − 1 = +1
 *   (subió); sin GP anterior → delta `null`.
 * - **Recálculo**: una corrección (US-16) sobre la ronda 1 → aviso
 *   (nº de correcciones + última fecha) + histórico anterior → nuevo
 *   (motivo + actor).
 * - **RBAC**: `protectedProcedure` (UNAUTHORIZED sin sesión).
 *
 * El desglose (US-20) lo cubre `my-score.test.ts`; aquí se comprueba la
 * composición que la UI de `/resultados` consume.
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
const { createSeasonsRouter } = await import("../../app/server/routers/seasons");
const { createContext } = await import("../../app/server/trpc");
const { InMemoryRateLimitStore } = await import("../../app/modules/identity");

const suffix = randomUUID().slice(0, 8);
const ADMIN_EMAIL = `admin-${suffix}@test.local`;
const ADMIN_USERNAME = `admin_${suffix}`;
const USER1_EMAIL = `user1-${suffix}@test.local`;
const USER1_USERNAME = `user1_${suffix}`;
const USER2_EMAIL = `user2-${suffix}@test.local`;
const USER2_USERNAME = `user2_${suffix}`;
const PASSWORD = "contraseña-segura-1";
const ADMIN_IP = "198.51.100.62";
const USER1_IP = "198.51.100.63";
const USER2_IP = "198.51.100.64";

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

describe("US-22 · Resultados y ranking (PostgreSQL real)", () => {
  let prisma: PrismaClient;
  let authRouter: ReturnType<typeof createAuthRouter>;
  let resultsRouter: ReturnType<typeof createResultsRouter>;
  let seasonsRouter: ReturnType<typeof createSeasonsRouter>;
  let world: World;
  let adminToken: string;
  let user1Token: string;
  let user2Token: string;
  let user1Id: string;
  let user2Id: string;

  // Pilotos del mundo: A=r1 · B=r2 · C=r3 · E=r4 · H=r5 · I=r6.
  let A: string;
  let B: string;
  let C: string;
  let E: string;
  let H: string;
  let I: string;

  // Eventos de la ronda 1 (seedWorld crea solo la carrera).
  let q2: string;
  let sprint: string;

  // Ronda 2 (GP + eventos).
  let gp2: string;
  let q2_2: string;
  let sprint_2: string;
  let race_2: string;

  // Liga de prueba (los dos usuarios).
  let leagueId: string;

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
    seasonsRouter = createSeasonsRouter({ prisma });
    world = await seedWorld(prisma);

    A = world.riders[0].id;
    B = world.riders[1].id;
    C = world.riders[2].id;
    E = world.riders[3].id;
    H = world.riders[4].id;
    I = world.riders[5].id;

    // Resto del fin de semana de la ronda 1 (seedWorld crea solo la carrera).
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

    // Ronda 2: GP + eventos (Q2, sprint, carrera).
    gp2 = (
      await prisma.gp.create({
        data: {
          seasonId: world.season.id,
          round: 2,
          name: `GP2 ${suffix}`,
          circuitId: world.gp.circuitId,
          date: new Date("2099-06-07T12:00:00Z"),
        },
      })
    ).id;
    q2_2 = (
      await prisma.weekendEvent.create({ data: { gpId: gp2, type: "q2", orderNum: 2 } })
    ).id;
    sprint_2 = (
      await prisma.weekendEvent.create({ data: { gpId: gp2, type: "sprint", orderNum: 3 } })
    ).id;
    race_2 = (
      await prisma.weekendEvent.create({ data: { gpId: gp2, type: "race", orderNum: 4 } })
    ).id;

    // Afiliaciones (misma topología que `my-score.test.ts`): X/X-team =
    // {A, B, I} · X2 = {C, E} · X4 = {H}. Sin afiliaciones el
    // constructor/equipo del lineup puntuaría 0 (media top-2 sobre ∅).
    // Son por GP (ADR-0013): se crean para la ronda 1 y 2.
    const x2Ctor = (await prisma.constructor.create({ data: { name: `X2 ${suffix}` } })).id;
    const x2Team = (
      await prisma.team.create({ data: { name: `X2-team ${suffix}`, constructorId: x2Ctor } })
    ).id;
    const x4Ctor = (await prisma.constructor.create({ data: { name: `X4 ${suffix}` } })).id;
    const x4Team = (
      await prisma.team.create({ data: { name: `X4-team ${suffix}`, constructorId: x4Ctor } })
    ).id;
    const affiliations: [string, string, string][] = [
      [A, world.ctor.id, world.team.id],
      [B, world.ctor.id, world.team.id],
      [I, world.ctor.id, world.team.id],
      [C, x2Ctor, x2Team],
      [E, x2Ctor, x2Team],
      [H, x4Ctor, x4Team],
    ];
    for (const gpId of [world.gp.id, gp2]) {
      for (const [riderId, constructorId, teamId] of affiliations) {
        await prisma.riderAffiliation.create({
          data: { riderId, constructorId, teamId, gpId },
        });
      }
    }

    // Admin global (bootstrap, ADR-0010) + dos usuarios (miembros de la liga).
    const adminCaller = await callerFor(ADMIN_IP);
    await adminCaller.auth.register({
      email: ADMIN_EMAIL,
      username: ADMIN_USERNAME,
      password: PASSWORD,
      termsAccepted: true,
    });
    adminToken = sessionTokenFrom(adminCaller.ctx);

    const user1Caller = await callerFor(USER1_IP);
    const user1Reg = await user1Caller.auth.register({
      email: USER1_EMAIL,
      username: USER1_USERNAME,
      password: PASSWORD,
      termsAccepted: true,
    });
    user1Id = user1Reg.user.id;
    user1Token = sessionTokenFrom(user1Caller.ctx);

    const user2Caller = await callerFor(USER2_IP);
    const user2Reg = await user2Caller.auth.register({
      email: USER2_EMAIL,
      username: USER2_USERNAME,
      password: PASSWORD,
      termsAccepted: true,
    });
    user2Id = user2Reg.user.id;
    user2Token = sessionTokenFrom(user2Caller.ctx);

    // Liga de prueba (activa): user1 (admin) + user2 (miembro).
    leagueId = (
      await prisma.league.create({
        data: {
          name: `Liga ${suffix}`,
          type: "private",
          visibility: "private",
          minMembers: 2,
          maxMembers: 50,
          status: "active",
        },
      })
    ).id;
    await prisma.leagueMember.createMany({
      data: [
        { leagueId, userId: user1Id, role: "admin", status: "active" },
        { leagueId, userId: user2Id, role: "member", status: "active" },
      ],
    });

    // Lineups de la ronda 1:
    // - user1: oro {A, C} · plata {E, H} (el lineup de 170.5 de scoring.md §5).
    // - user2: oro {B, I} · plata {E, H} (puntuación menor en la ronda 1).
    await createLineup(user1Id, world.gp.id, [A, C], [E, H]);
    await createLineup(user2Id, world.gp.id, [B, I], [E, H]);

    // Lineups de la ronda 2 (mismos pilotos; los resultados decidirán).
    await createLineup(user1Id, gp2, [A, C], [E, H]);
    await createLineup(user2Id, gp2, [B, I], [E, H]);
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
      seasons: seasonsRouter.createCaller(ctx),
    };
  }

  /** Extrae el token de la cookie de sesión emitida en `ctx.pendingCookies`. */
  function sessionTokenFrom(ctx: { pendingCookies: string[] }): string {
    expect(ctx.pendingCookies).toHaveLength(1);
    const token = /^session=([0-9a-f]{64});/.exec(ctx.pendingCookies[0] ?? "")?.[1];
    if (!token) throw new Error(`Cookie de sesión inesperada: ${ctx.pendingCookies[0]}`);
    return token;
  }

  /** Crea un lineup (2 oro + 2 plata + constructor + equipo) en una sentencia. */
  async function createLineup(
    userId: string,
    gpId: string,
    gold: [string, string],
    silver: [string, string],
  ) {
    const lineup = await prisma.lineup.create({ data: { userId, gpId } });
    await prisma.lineupSlot.createMany({
      data: [
        { lineupId: lineup.id, slotType: "gold", assetType: "rider", assetId: gold[0] },
        { lineupId: lineup.id, slotType: "gold", assetType: "rider", assetId: gold[1] },
        { lineupId: lineup.id, slotType: "silver", assetType: "rider", assetId: silver[0] },
        { lineupId: lineup.id, slotType: "silver", assetType: "rider", assetId: silver[1] },
        {
          lineupId: lineup.id,
          slotType: "constructor",
          assetType: "constructor",
          assetId: world.ctor.id,
        },
        { lineupId: lineup.id, slotType: "team", assetType: "team", assetId: world.team.id },
      ],
    });
  }

  // ── Gates + RBAC (sin resultados todavía) ─────────────────────────────────

  it("myResults sin sesión → UNAUTHORIZED", async () => {
    const { results } = await callerFor(USER1_IP);
    await expect(results.myResults({ gpId: world.gp.id })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("myResults con GP inexistente → NOT_FOUND", async () => {
    const { results } = await callerFor(USER1_IP, user1Token);
    await expect(results.myResults({ gpId: randomUUID() })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "El GP no existe.",
    });
  });

  it("myResults sin resultados: estado, posiciones null, delta null, sin recálculo", async () => {
    const { results } = await callerFor(USER1_IP, user1Token);
    const view = await results.myResults({ gpId: world.gp.id });

    // Identidad + estado (sin resultados definitivos).
    expect(view.gp.id).toBe(world.gp.id);
    expect(view.gp.round).toBe(1);
    expect(view.gp.status).toBe("scheduled");
    expect(view.cancelled).toBe(false);
    expect(view.state.definitive).toBe(false);
    expect(view.state.totalResults).toBe(0);

    // Sin GP anterior (ronda 1) → delta null; posición aún null.
    expect(view.previousGp).toBeNull();
    expect(view.leagues).toHaveLength(1);
    expect(view.leagues[0]).toMatchObject({
      leagueId,
      gpPosition: null,
      gpPoints: null,
      delta: null,
    });

    // Sin correcciones → aviso vacío.
    expect(view.recalculation).toEqual({ corrections: 0, lastAt: null, history: [] });
  });

  // ── Ronda 1: importación + definitivo → posiciones ────────────────────────

  it("ronda 1: user1 1º (170.5) y user2 2º; delta null (sin GP anterior)", async () => {
    const admin = await callerFor(ADMIN_IP, adminToken);

    // Q2: A p1 (pole) · B p2 · C p3 · E p6 · H p15 · I p12.
    expect(
      await admin.results.importEvent({
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
      }),
    ).toMatchObject({ created: 6 });

    // Sprint: A p1 · B p3 · C p7 · E p8 · H DNF · I p9.
    expect(
      await admin.results.importEvent({
        gpId: world.gp.id,
        eventId: sprint,
        entries: [
          entry(A, { position: 1, finished: true }),
          entry(B, { position: 3, finished: true }),
          entry(C, { position: 7, finished: true }),
          entry(E, { position: 8, finished: true }),
          entry(H, {}),
          entry(I, { position: 9, finished: true }),
        ],
      }),
    ).toMatchObject({ created: 6 });

    // Carrera: A p1 (ganador) · B p11 · C p2 · E p6 · H DNF (−5) · I p14.
    expect(
      await admin.results.importEvent({
        gpId: world.gp.id,
        eventId: world.event.id,
        entries: [
          entry(A, { position: 1, finished: true }),
          entry(B, { position: 11, finished: true }),
          entry(C, { position: 2, finished: true }),
          entry(E, { position: 6, finished: true }),
          entry(H, {}),
          entry(I, { position: 14, finished: true }),
        ],
      }),
    ).toMatchObject({ created: 6 });

    // Definitivo → primer recálculo (rv-1) + rankings (US-21).
    const definitive = await admin.results.markDefinitive({ gpId: world.gp.id });
    expect(definitive.resultsVersion).toBe("rv-1");

    // user1: 1º con 170.5 (scoring.md §5); delta null (ronda 1).
    const u1 = await (await callerFor(USER1_IP, user1Token)).results.myResults({
      gpId: world.gp.id,
    });
    expect(u1.state.definitive).toBe(true);
    expect(u1.state.resultsVersion).toBe("rv-1");
    expect(u1.previousGp).toBeNull();
    expect(u1.leagues[0]).toMatchObject({
      gpPosition: 1,
      gpPoints: 170.5,
      overallPosition: 1,
      delta: null,
    });

    // user2: 2º (108.5 < 170.5).
    const u2 = await (await callerFor(USER2_IP, user2Token)).results.myResults({
      gpId: world.gp.id,
    });
    expect(u2.leagues[0]).toMatchObject({
      gpPosition: 2,
      gpPoints: 108.5,
      overallPosition: 2,
      delta: null,
    });
  });

  // ── Ronda 2: user2 gana → delta user1 = −1, user2 = +1 ────────────────────

  it("ronda 2: user2 1º y user1 2º; delta user1 = −1 y user2 = +1", async () => {
    const admin = await callerFor(ADMIN_IP, adminToken);

    // Q2: B p1 (pole) · I p2 · C p3 · E p4 · H p5 · A p6.
    expect(
      await admin.results.importEvent({
        gpId: gp2,
        eventId: q2_2,
        entries: [
          entry(B, { position: 1, finished: true, bonuses: ["pole"] }),
          entry(I, { position: 2, finished: true }),
          entry(C, { position: 3, finished: true }),
          entry(E, { position: 4, finished: true }),
          entry(H, { position: 5, finished: true }),
          entry(A, { position: 6, finished: true }),
        ],
      }),
    ).toMatchObject({ created: 6 });

    // Sprint: B p1 · I p2 · C p3 · E p4 · H p5 · A DNF.
    expect(
      await admin.results.importEvent({
        gpId: gp2,
        eventId: sprint_2,
        entries: [
          entry(B, { position: 1, finished: true }),
          entry(I, { position: 2, finished: true }),
          entry(C, { position: 3, finished: true }),
          entry(E, { position: 4, finished: true }),
          entry(H, { position: 5, finished: true }),
          entry(A, {}),
        ],
      }),
    ).toMatchObject({ created: 6 });

    // Carrera: B p1 (ganador + vuelta rápida) · I p2 · C p3 · E p4 · H p5 · A p15 DNF.
    expect(
      await admin.results.importEvent({
        gpId: gp2,
        eventId: race_2,
        entries: [
          // "winner" es derivado (p1 en carrera; ADR-0018); solo se importa la vuelta rápida.
          entry(B, { position: 1, finished: true, bonuses: ["fastest-lap"] }),
          entry(I, { position: 2, finished: true }),
          entry(C, { position: 3, finished: true }),
          entry(E, { position: 4, finished: true }),
          entry(H, { position: 5, finished: true }),
          entry(A, {}),
        ],
      }),
    ).toMatchObject({ created: 6 });

    const definitive = await admin.results.markDefinitive({ gpId: gp2 });
    expect(definitive.resultsVersion).toBe("rv-1");

    // GP anterior resuelto (ronda 1) + posiciones invertidas.
    const u1 = await (await callerFor(USER1_IP, user1Token)).results.myResults({ gpId: gp2 });
    expect(u1.previousGp).toMatchObject({ id: world.gp.id, round: 1 });
    expect(u1.leagues[0]).toMatchObject({
      gpPosition: 2,
      overallPosition: 2,
      delta: -1, // 1º en la ronda 1 → 2º en la ronda 2 (bajó).
    });

    const u2 = await (await callerFor(USER2_IP, user2Token)).results.myResults({ gpId: gp2 });
    expect(u2.leagues[0]).toMatchObject({
      gpPosition: 1,
      overallPosition: 1,
      delta: 1, // 2º en la ronda 1 → 1º en la ronda 2 (subió).
    });
  });

  // ── Recálculo: corrección → aviso + histórico anterior → nuevo ────────────

  it("corrección en la ronda 1: aviso (1 corrección) + histórico antes → nuevo", async () => {
    const admin = await callerFor(ADMIN_IP, adminToken);

    // Corrección: B pasa de p2 a p3 en Q2 (motivo obligatorio, US-16).
    const reason = "Corrección oficial de la FIM (test US-22).";
    const result = await admin.results.importEvent({
      gpId: world.gp.id,
      eventId: q2,
      entries: [entry(B, { position: 3, finished: true })],
      reason,
    });
    expect(result.corrected).toBe(1);
    // El GP ya tenía scores → recálculo inline (rv-2, US-19).
    expect(result.recalculated).toBe(true);
    expect(result.resultsVersion).toBe("rv-2");

    const u1 = await (await callerFor(USER1_IP, user1Token)).results.myResults({
      gpId: world.gp.id,
    });

    // Aviso: 1 corrección + fecha de la última.
    expect(u1.recalculation.corrections).toBe(1);
    expect(u1.recalculation.lastAt).toBeInstanceOf(Date);

    // Histórico anterior → nuevo (motivo + actor).
    expect(u1.recalculation.history).toHaveLength(1);
    const h = u1.recalculation.history[0];
    if (h === undefined) throw new Error("Falta la entrada del histórico");
    expect(h).toMatchObject({
      riderId: B,
      riderName: world.riders[1].name,
      eventLabel: "Q2",
      before: expect.objectContaining({ position: 2, finished: true }),
      after: expect.objectContaining({ position: 3, finished: true }),
      reason,
      actor: ADMIN_USERNAME,
    });
    expect(h.at).toBeInstanceOf(Date);
  });

  // ── GP cancelado → "GP cancelado, 0 puntos" ───────────────────────────────

  it("GP cancelado: `cancelled = true` (la UI muestra 'GP cancelado, 0 puntos')", async () => {
    // Ronda 3: GP programado → cancelado (transición `scheduled → cancelled`).
    const gp3 = (
      await prisma.gp.create({
        data: {
          seasonId: world.season.id,
          round: 3,
          name: `GP3 ${suffix}`,
          circuitId: world.gp.circuitId,
          date: new Date("2099-06-14T12:00:00Z"),
        },
      })
    ).id;

    const admin = await callerFor(ADMIN_IP, adminToken);
    await admin.seasons.gps.updateStatus({ gpId: gp3, status: "cancelled" });

    const u1 = await (await callerFor(USER1_IP, user1Token)).results.myResults({ gpId: gp3 });
    expect(u1.cancelled).toBe(true);
    expect(u1.gp.status).toBe("cancelled");
  });
});
