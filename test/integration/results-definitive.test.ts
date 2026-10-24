/**
 * US-18 · Definitivo + primer recálculo + estados de evento (PostgreSQL real).
 *
 * Mismo patrón que `results.test.ts`: `DATABASE_URL`/`REDIS_URL` se fijan
 * ANTES del `import()` dinámico; el router `results` se monta con la BD
 * efímera.
 *
 * Semánticas bajo test (ADR-0020):
 * - `markDefinitive`: voltea `provisional`/`corrected` → `definitive` y
 *   ejecuta el primer recálculo (rv-1) en la misma transacción: una `Score`
 *   por lineup (puntos + desglose con el motor puro y las tablas de
 *   `season_rules`), `resultsVersion = rv-1` en `results`/`results_events`,
 *   auditoría `results.marked_definitive`.
 * - No-op (sin auditoría) si el GP ya era definitivo; reconfirmación de
 *   `corrected` tras una corrección.
 * - Gates: GP inexistente (NOT_FOUND), GP cancelado (PRECONDITION_FAILED),
 *   sin resultados (BAD_REQUEST).
 * - `cancelEvent`/`neutralizeEvent`: flag en `results_events` + auditoría;
 *   no-op si ya estaba; event cancelado no puntúa (0); carrera cancelada →
 *   GP puntúa 0 para todos.
 * - `gpState`: estado derivado (definitivo = hay filas y ninguna
 *   `provisional`) + `resultsVersion` + conteos.
 * - RBAC: todo `adminProcedure` (403 para `user`, 401 sin sesión).
 * - Concurrencia: `FOR UPDATE` del GP serializa (una sola auditoría).
 *
 * Escenario de puntuación (reglas PROVISIONAL, `season_rules`):
 * - Q2: r1 p1 (pole) · r2 p3 · r3 p5 · r4 p7
 * - Sprint: r1 p2 · r2 p1 · r3 p4 · r4 p5 → EVENTO CANCELADO (0 para todos)
 * - Carrera: r1 p1 (vuelta rápida) · r2 DNF · r3 p3 (extraordinario) · r4 p5
 * - r1 = 47 · r2 = 3 · r3 = 28 · r4 = 16 · ctor/team = 37.5 → lineup 147
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
const email = (name: string) => `${name}-${suffix}@test.local`;
const username = (name: string) => `${name}_${suffix}`;
const PASSWORD = "contraseña-segura-1";
const ADMIN_EMAIL = email("admin");
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
    rawPoints?: number | null;
  } = {},
) {
  return {
    riderId,
    position: values.position ?? null,
    started: values.started ?? true,
    finished: values.finished ?? false,
    penalties: values.penalties ?? [],
    bonuses: values.bonuses ?? [],
    rawPoints: values.rawPoints ?? null,
  };
}

/** Desglose de un piloto en `Score.breakdown` (orden de bonos del motor). */
interface RiderBreakdown {
  q2: number;
  sprint: number;
  mainRace: number;
  bonuses: { code: string; points: number }[];
  penalties: { code: string; points: number }[];
  total: number;
}

describe("US-18 · Definitivo + primer recálculo (PostgreSQL real)", () => {
  let prisma: PrismaClient;
  let authRouter: ReturnType<typeof createAuthRouter>;
  let resultsRouter: ReturnType<typeof createResultsRouter>;
  let world: World;
  let adminId: string;
  let adminToken: string;
  let userToken: string;

  // Pilotos del mundo.
  let r1: string;
  let r2: string;
  let r3: string;
  let r4: string;

  // Eventos del GP del mundo (seedWorld crea solo la carrera, orderNum 1).
  let q2: string;
  let sprint: string;
  let q1: string;

  // GP cancelado (ronda 2): rechazo de `markDefinitive`.
  let cancelledGpId: string;

  // Lineup del GP del mundo (2 oro + 2 plata + ctor + equipo).
  let lineupId: string;

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
    r1 = world.riders[0].id;
    r2 = world.riders[1].id;
    r3 = world.riders[2].id;
    r4 = world.riders[3].id;

    // Resto del fin de semana + Q1 (para los rechazos de evento no válido).
    q1 = (await prisma.weekendEvent.create({ data: { gpId: world.gp.id, type: "q1", orderNum: 2 } }))
      .id;
    q2 = (await prisma.weekendEvent.create({ data: { gpId: world.gp.id, type: "q2", orderNum: 3 } }))
      .id;
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

    // Afiliaciones del GP (equipo/constructor) + precios (extraordinario:
    // r3 es el más barato del equipo).
    for (const rider of [r1, r2, r3, r4]) {
      await prisma.riderAffiliation.create({
        data: {
          riderId: rider,
          teamId: world.team.id,
          constructorId: world.ctor.id,
          gpId: world.gp.id,
        },
      });
    }
    const prices: [string, number][] = [
      [r1, 30],
      [r2, 20],
      [r3, 10],
      [r4, 15],
    ];
    for (const [assetId, price] of prices) {
      await prisma.price.create({
        data: { assetType: "rider", assetId, price: String(price) },
      });
    }

    // Lineup del GP del mundo (una sola sentencia: trigger de composición).
    const lineup = await prisma.lineup.create({
      data: { userId: world.user.id, gpId: world.gp.id },
    });
    lineupId = lineup.id;
    await prisma.lineupSlot.createMany({
      data: [
        { lineupId: lineup.id, slotType: "gold", assetType: "rider", assetId: r1 },
        { lineupId: lineup.id, slotType: "gold", assetType: "rider", assetId: r2 },
        { lineupId: lineup.id, slotType: "silver", assetType: "rider", assetId: r3 },
        { lineupId: lineup.id, slotType: "silver", assetType: "rider", assetId: r4 },
        { lineupId: lineup.id, slotType: "constructor", assetType: "constructor", assetId: world.ctor.id },
        { lineupId: lineup.id, slotType: "team", assetType: "team", assetId: world.team.id },
      ],
    });

    // GP cancelado (rechazo de `markDefinitive`).
    cancelledGpId = (
      await prisma.gp.create({
        data: {
          seasonId: world.season.id,
          round: 2,
          name: `GP ${suffix} cancelado`,
          circuitId: world.gp.circuitId,
          date: new Date("2099-06-08T12:00:00Z"),
          status: "cancelled",
        },
      })
    ).id;

    // Admin global (bootstrap, ADR-0010) + usuario normal.
    const authCaller = await callerFor(ADMIN_IP);
    const adminReg = await authCaller.auth.register({
      email: ADMIN_EMAIL,
      username: username("admin"),
      password: PASSWORD,
      termsAccepted: true,
    });
    adminId = adminReg.user.id;
    adminToken = sessionTokenFrom(authCaller.ctx);

    const userCaller = await callerFor(USER_IP);
    await userCaller.auth.register({
      email: email("maria"),
      username: username("maria"),
      password: PASSWORD,
      termsAccepted: true,
    });
    userToken = sessionTokenFrom(userCaller.ctx);
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

  /** Crea un lineup completo (2 oro + 2 plata + ctor + equipo) para un GP. */
  async function createLineupFor(gpId: string): Promise<string> {
    const lineup = await prisma.lineup.create({
      data: { userId: world.user.id, gpId },
    });
    await prisma.lineupSlot.createMany({
      data: [
        { lineupId: lineup.id, slotType: "gold", assetType: "rider", assetId: r1 },
        { lineupId: lineup.id, slotType: "gold", assetType: "rider", assetId: r2 },
        { lineupId: lineup.id, slotType: "silver", assetType: "rider", assetId: r3 },
        { lineupId: lineup.id, slotType: "silver", assetType: "rider", assetId: r4 },
        { lineupId: lineup.id, slotType: "constructor", assetType: "constructor", assetId: world.ctor.id },
        { lineupId: lineup.id, slotType: "team", assetType: "team", assetId: world.team.id },
      ],
    });
    return lineup.id;
  }

  /** Afiliaciones + precios del GP (para el recálculo). */
  async function seedAffiliationsFor(gpId: string) {
    for (const rider of [r1, r2, r3, r4]) {
      await prisma.riderAffiliation.create({
        data: {
          riderId: rider,
          teamId: world.team.id,
          constructorId: world.ctor.id,
          gpId,
        },
      });
    }
  }

  // ── gpState + gates + RBAC (sin resultados) ───────────────────────────────

  it("gpState sin resultados: no definitivo, 0 filas, 1 lineup", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    const state = await results.gpState({ gpId: world.gp.id });
    expect(state).toMatchObject({
      gpId: world.gp.id,
      gpName: world.gp.name,
      round: 1,
      seasonName: world.season.name,
      definitive: false,
      resultsVersion: null,
      counts: { provisional: 0, definitive: 0, corrected: 0 },
      totalResults: 0,
      lineups: 1,
    });
  });

  it("gpState devuelve NOT_FOUND si el GP no existe", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    await expect(results.gpState({ gpId: randomUUID() })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "El GP no existe.",
    });
  });

  it("markDefinitive sin resultados → BAD_REQUEST", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    await expect(results.markDefinitive({ gpId: world.gp.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message:
        "El GP no tiene resultados: importa los resultados antes de marcarlo definitivo.",
    });
  });

  it("markDefinitive con GP inexistente → NOT_FOUND", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    await expect(results.markDefinitive({ gpId: randomUUID() })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "El GP no existe.",
    });
  });

  it("markDefinitive con GP cancelado → PRECONDITION_FAILED", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    await expect(results.markDefinitive({ gpId: cancelledGpId })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  it("un usuario normal no puede marcar definitivo ni gestionar eventos (403)", async () => {
    const { results } = await callerFor(USER_IP, userToken);
    await expect(results.markDefinitive({ gpId: world.gp.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      results.cancelEvent({ gpId: world.gp.id, eventId: sprint }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      results.neutralizeEvent({ gpId: world.gp.id, eventId: q2 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(results.gpState({ gpId: world.gp.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("un usuario no autenticado no puede marcar definitivo (401)", async () => {
    const { results } = await callerFor(USER_IP); // sin cookie de sesión
    await expect(results.markDefinitive({ gpId: world.gp.id })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  // ── Importación de resultados (provisional) ───────────────────────────────

  it("un admin importa Q2, sprint y carrera (provisional)", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    const q2Payload = {
      gpId: world.gp.id,
      eventId: q2,
      entries: [
        entry(r1, { position: 1, finished: true, bonuses: ["pole"] }),
        entry(r2, { position: 3, finished: true }),
        entry(r3, { position: 5, finished: true }),
        entry(r4, { position: 7, finished: true }),
      ],
    };
    expect(await results.importEvent(q2Payload)).toMatchObject({ created: 4 });

    const sprintPayload = {
      gpId: world.gp.id,
      eventId: sprint,
      entries: [
        entry(r1, { position: 2, finished: true }),
        entry(r2, { position: 1, finished: true }),
        entry(r3, { position: 4, finished: true }),
        entry(r4, { position: 5, finished: true }),
      ],
    };
    expect(await results.importEvent(sprintPayload)).toMatchObject({ created: 4 });

    const racePayload = {
      gpId: world.gp.id,
      eventId: world.event.id,
      entries: [
        entry(r1, { position: 1, finished: true, bonuses: ["fastest-lap"] }),
        entry(r2), // DNF: salió y no terminó
        entry(r3, { position: 3, finished: true }),
        entry(r4, { position: 5, finished: true }),
      ],
    };
    expect(await results.importEvent(racePayload)).toMatchObject({ created: 4 });

    const rows = await prisma.result.findMany({ where: { gpId: world.gp.id } });
    expect(rows).toHaveLength(12);
    expect(rows.every((row) => row.status === "provisional")).toBe(true);
    expect(rows.every((row) => row.resultsVersion === null)).toBe(true);
  });

  it("gpState tras importar: 12 provisional, no definitivo, sin versión", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    const state = await results.gpState({ gpId: world.gp.id });
    expect(state).toMatchObject({
      definitive: false,
      resultsVersion: null,
      counts: { provisional: 12, definitive: 0, corrected: 0 },
      totalResults: 12,
      lineups: 1,
    });
  });

  // ── Estados de evento (cancelar / neutralizar) ────────────────────────────

  it("cancelEvent sprint: flag + auditoría results.event_cancelled", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    const res = await results.cancelEvent({ gpId: world.gp.id, eventId: sprint });
    expect(res).toEqual({ cancelled: true, neutralized: false, noop: false });

    const resultsEvent = await prisma.resultsEvent.findUniqueOrThrow({
      where: { gpId_eventId: { gpId: world.gp.id, eventId: sprint } },
    });
    expect(resultsEvent.cancelled).toBe(true);
    expect(resultsEvent.neutralized).toBe(false);

    const audit = await prisma.auditLog.findMany({
      where: { action: "results.event_cancelled", entityId: sprint },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: adminId,
      entity: "results",
      ip: ADMIN_IP,
    });
    expect(audit[0]?.afterData).toEqual({
      gpId: world.gp.id,
      eventId: sprint,
      cancelled: true,
    });
  });

  it("cancelEvent sprint de nuevo → no-op (sin auditoría nueva)", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    const res = await results.cancelEvent({ gpId: world.gp.id, eventId: sprint });
    expect(res).toEqual({ cancelled: true, neutralized: false, noop: true });
    const audit = await prisma.auditLog.count({
      where: { action: "results.event_cancelled", entityId: sprint },
    });
    expect(audit).toBe(1);
  });

  it("neutralizeEvent Q2: flag + auditoría results.event_neutralized", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    const res = await results.neutralizeEvent({ gpId: world.gp.id, eventId: q2 });
    expect(res).toEqual({ cancelled: false, neutralized: true, noop: false });

    const resultsEvent = await prisma.resultsEvent.findUniqueOrThrow({
      where: { gpId_eventId: { gpId: world.gp.id, eventId: q2 } },
    });
    expect(resultsEvent.neutralized).toBe(true);
    expect(resultsEvent.cancelled).toBe(false);

    const audit = await prisma.auditLog.findMany({
      where: { action: "results.event_neutralized", entityId: q2 },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.afterData).toEqual({ gpId: world.gp.id, eventId: q2, neutralized: true });
  });

  it("neutralizeEvent Q2 de nuevo → no-op (sin auditoría nueva)", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    const res = await results.neutralizeEvent({ gpId: world.gp.id, eventId: q2 });
    expect(res).toEqual({ cancelled: false, neutralized: true, noop: true });
    const audit = await prisma.auditLog.count({
      where: { action: "results.event_neutralized", entityId: q2 },
    });
    expect(audit).toBe(1);
  });

  it("cancelEvent: rechazos (GP inexistente, Q1, evento de otro GP)", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    await expect(
      results.cancelEvent({ gpId: randomUUID(), eventId: sprint }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "El GP no existe." });
    await expect(
      results.cancelEvent({ gpId: world.gp.id, eventId: q1 }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "Q1 no es un evento de resultados.",
    });
    // Evento de otro GP: crear un GP + evento y referenciarlo con el GP del
    // mundo (o viceversa).
    const otherGp = await prisma.gp.create({
      data: {
        seasonId: world.season.id,
        round: 9,
        name: `GP ${suffix} otro`,
        circuitId: world.gp.circuitId,
        date: new Date("2099-07-01T12:00:00Z"),
      },
    });
    const otherEvent = await prisma.weekendEvent.create({
      data: { gpId: otherGp.id, type: "race", orderNum: 1 },
    });
    await expect(
      results.cancelEvent({ gpId: world.gp.id, eventId: otherEvent.id }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "El evento no existe en este GP.",
    });
  });

  // ── Marcar definitivo (primer recálculo rv-1) ─────────────────────────────

  it("markDefinitive: voltea filas, rv-1, Score del lineup y auditoría", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    const res = await results.markDefinitive({ gpId: world.gp.id });
    expect(res).toEqual({
      madeDefinitive: 12,
      reconfirmed: 0,
      alreadyDefinitive: 0,
      lineupsScored: 1,
      resultsVersion: "rv-1",
      noop: false,
    });

    // Filas: todas definitive + resultsVersion rv-1.
    const rows = await prisma.result.findMany({ where: { gpId: world.gp.id } });
    expect(rows).toHaveLength(12);
    expect(rows.every((row) => row.status === "definitive")).toBe(true);
    expect(rows.every((row) => row.resultsVersion === "rv-1")).toBe(true);

    // results_events: resultsVersion rv-1.
    const resultsEvents = await prisma.resultsEvent.findMany({
      where: { gpId: world.gp.id },
    });
    expect(resultsEvents).toHaveLength(3);
    expect(resultsEvents.every((e) => e.resultsVersion === "rv-1")).toBe(true);

    // Score del lineup: puntos + desglose (motor puro, reglas PROVISIONAL).
    const score = await prisma.score.findUniqueOrThrow({
      where: { lineupId_resultsVersion: { lineupId, resultsVersion: "rv-1" } },
    });
    expect(score.userId).toBe(world.user.id);
    expect(score.gpId).toBe(world.gp.id);
    expect(score.rulesVersion).toBe("scoring-v1");
    expect(Number(score.pointsTotal)).toBeCloseTo(147, 6);

    const breakdown = score.breakdown as unknown as {
      rulesVersion: string;
      gold: Array<{ riderId: string; weight: number; points: number; breakdown: RiderBreakdown }>;
      silver: Array<{ riderId: string; weight: number; points: number; breakdown: RiderBreakdown }>;
      constructor: { id: string; points: number };
      team: { id: string; points: number };
      total: number;
    };
    expect(breakdown.rulesVersion).toBe("scoring-v1");
    expect(breakdown.total).toBeCloseTo(147, 6);
    expect(breakdown.constructor).toEqual({ id: world.ctor.id, points: 37.5 });
    expect(breakdown.team).toEqual({ id: world.team.id, points: 37.5 });

    const gold = [...breakdown.gold].sort((a, b) => a.riderId.localeCompare(b.riderId));
    const silver = [...breakdown.silver].sort((a, b) => a.riderId.localeCompare(b.riderId));
    const byRider = new Map([...gold, ...silver].map((slot) => [slot.riderId, slot]));

    // r1: Q2 12 + pole 2 · sprint 0 (cancelado) · carrera 25 + ganador 5 +
    // vuelta rápida 3 = 47.
    expect(byRider.get(r1)).toMatchObject({
      weight: 1,
      points: 47,
      breakdown: {
        q2: 12,
        sprint: 0,
        mainRace: 25,
        bonuses: [
          { code: "pole", points: 2 },
          { code: "fastest-lap", points: 3 },
          { code: "winner", points: 5 },
        ],
        penalties: [],
        total: 47,
      },
    });
    // r2: Q2 8 · sprint 0 (cancelado) · DNF carrera 0 − 5 = 3.
    expect(byRider.get(r2)).toMatchObject({
      weight: 1,
      points: 3,
      breakdown: {
        q2: 8,
        sprint: 0,
        mainRace: 0,
        bonuses: [],
        penalties: [{ code: "dnf", points: -5 }],
        total: 3,
      },
    });
    // r3: Q2 5 · sprint 0 (cancelado) · carrera 16 + extraordinario 5 +
    // posiciones ganadas (Q2 5 → carrera 3) 2 = 28.
    expect(byRider.get(r3)).toMatchObject({
      weight: 0.5,
      points: 14,
      breakdown: {
        q2: 5,
        sprint: 0,
        mainRace: 16,
        bonuses: [
          { code: "positions-gained", points: 2 },
          { code: "extraordinary", points: 5 },
        ],
        penalties: [],
        total: 28,
      },
    });
    // r4: Q2 3 · sprint 0 (cancelado) · carrera 11 + posiciones ganadas
    // (Q2 7 → carrera 5) 2 = 16.
    expect(byRider.get(r4)).toMatchObject({
      weight: 0.5,
      points: 8,
      breakdown: {
        q2: 3,
        sprint: 0,
        mainRace: 11,
        bonuses: [{ code: "positions-gained", points: 2 }],
        penalties: [],
        total: 16,
      },
    });

    // Auditoría results.marked_definitive (misma transacción, T-09).
    const audit = await prisma.auditLog.findMany({
      where: { action: "results.marked_definitive", entityId: world.gp.id },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: adminId, entity: "results", ip: ADMIN_IP });
    expect(audit[0]?.afterData).toEqual({
      gpId: world.gp.id,
      madeDefinitive: 12,
      reconfirmed: 0,
      alreadyDefinitive: 0,
      lineupsScored: 1,
      resultsVersion: "rv-1",
    });
  });

  it("markDefinitive de nuevo → no-op (sin auditoría ni Score nuevos)", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    const res = await results.markDefinitive({ gpId: world.gp.id });
    expect(res).toEqual({
      madeDefinitive: 0,
      reconfirmed: 0,
      alreadyDefinitive: 12,
      lineupsScored: 0,
      resultsVersion: "rv-1",
      noop: true,
    });
    expect(
      await prisma.auditLog.count({
        where: { action: "results.marked_definitive", entityId: world.gp.id },
      }),
    ).toBe(1);
    expect(
      await prisma.score.count({
        where: { gpId: world.gp.id, resultsVersion: "rv-1" },
      }),
    ).toBe(1);
  });

  it("gpState tras el definitivo: definitivo, rv-1, 12 definitive", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    const state = await results.gpState({ gpId: world.gp.id });
    expect(state).toMatchObject({
      definitive: true,
      resultsVersion: "rv-1",
      counts: { provisional: 0, definitive: 12, corrected: 0 },
      totalResults: 12,
      lineups: 1,
    });
  });

  it("corrección: recalcula inline (rv-2) y reconfirma (US-19)", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    // Corrección: r1 pasa de 1º a 2º en la carrera (motivo obligatorio).
    // US-19: el GP ya tiene scores (rv-1), así que la corrección dispara el
    // recálculo inline: nueva results_version (rv-2) + reconfirmación.
    const corrected = await results.importEvent({
      gpId: world.gp.id,
      eventId: world.event.id,
      entries: [entry(r1, { position: 2, finished: true, bonuses: ["fastest-lap"] })],
      reason: "corrección de la clasificación oficial",
    });
    expect(corrected).toMatchObject({
      corrected: 1,
      recalculated: true,
      resultsVersion: "rv-2",
      lineupsScored: 1,
    });

    // La fila se reconfirma a definitive (con la nueva versión).
    const r1Row = (await prisma.result.findMany({ where: { gpId: world.gp.id, riderId: r1 } }))
      .find((row) => row.eventId === world.event.id);
    expect(r1Row?.status).toBe("definitive");
    expect(r1Row?.resultsVersion).toBe("rv-2");

    // gpState: 0 corrected, definitivo, rv-2.
    const state = await results.gpState({ gpId: world.gp.id });
    expect(state).toMatchObject({
      definitive: true,
      resultsVersion: "rv-2",
      counts: { provisional: 0, definitive: 12, corrected: 0 },
    });

    // Auditoría: results.correct + results.recalculated.
    expect(
      await prisma.auditLog.count({
        where: { action: "results.correct", entityId: world.event.id },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { action: "results.recalculated", entityId: world.gp.id },
      }),
    ).toBe(1);

    // r1: Q2 14 · sprint 0 (cancelado) · carrera 20 + vuelta rápida 3 = 37 →
    // ctor/team (media top-2 de 37 y 28) = 32.5 → lineup 127.
    // El Score rv-2 tiene los mismos puntos (misma rules_version).
    const score = await prisma.score.findUniqueOrThrow({
      where: { lineupId_resultsVersion: { lineupId, resultsVersion: "rv-2" } },
    });
    expect(Number(score.pointsTotal)).toBeCloseTo(127, 6);
    const breakdown = score.breakdown as unknown as {
      gold: Array<{ riderId: string; points: number }>;
      silver: Array<{ riderId: string; points: number }>;
      constructor: { points: number };
      team: { points: number };
    };
    const gold = breakdown.gold.find((slot) => slot.riderId === r1);
    expect(gold?.points).toBeCloseTo(37, 6);
    expect(breakdown.constructor.points).toBeCloseTo(32.5, 6);
    expect(breakdown.team.points).toBeCloseTo(32.5, 6);

    // El Score rv-1 permanece para histórico (invariante 7).
    const scoreRv1 = await prisma.score.findUniqueOrThrow({
      where: { lineupId_resultsVersion: { lineupId, resultsVersion: "rv-1" } },
    });
    expect(Number(scoreRv1.pointsTotal)).toBeCloseTo(147, 6);

    // markDefinitive es no-op (el GP ya es definitivo).
    const res = await results.markDefinitive({ gpId: world.gp.id });
    expect(res).toMatchObject({ noop: true, resultsVersion: "rv-2" });
  });

  // ── Concurrencia (FOR UPDATE del GP) ──────────────────────────────────────

  it("dos markDefinitive concurrentes: una sola auditoría y un solo Score", async () => {
    // GP de concurrencia (ronda 3) con resultados + lineup.
    const gp = await prisma.gp.create({
      data: {
        seasonId: world.season.id,
        round: 3,
        name: `GP ${suffix} concurrencia`,
        circuitId: world.gp.circuitId,
        date: new Date("2099-06-15T12:00:00Z"),
      },
    });
    const race = await prisma.weekendEvent.create({
      data: { gpId: gp.id, type: "race", orderNum: 1 },
    });
    await seedAffiliationsFor(gp.id);
    const gpLineupId = await createLineupFor(gp.id);

    const { results } = await callerFor(ADMIN_IP, adminToken);
    await results.importEvent({
      gpId: gp.id,
      eventId: race.id,
      entries: [
        entry(r1, { position: 1, finished: true }),
        entry(r2, { position: 2, finished: true }),
      ],
    });

    const [a, b] = await Promise.all([
      results.markDefinitive({ gpId: gp.id }),
      results.markDefinitive({ gpId: gp.id }),
    ]);
    // Uno hace el trabajo y el otro es no-op (o viceversa): el no-op al final.
    const results_ = [a, b].sort((x, y) => Number(x.noop) - Number(y.noop));
    expect(results_[0]).toMatchObject({
      madeDefinitive: 2,
      lineupsScored: 1,
      resultsVersion: "rv-1",
      noop: false,
    });
    expect(results_[1]).toMatchObject({ noop: true });

    expect(
      await prisma.auditLog.count({
        where: { action: "results.marked_definitive", entityId: gp.id },
      }),
    ).toBe(1);
    expect(
      await prisma.score.count({ where: { gpId: gp.id, resultsVersion: "rv-1" } }),
    ).toBe(1);
    expect(
      await prisma.score.findUniqueOrThrow({
        where: { lineupId_resultsVersion: { lineupId: gpLineupId, resultsVersion: "rv-1" } },
      }),
    ).toMatchObject({ pointsTotal: expect.anything() });
  });

  // ── Carrera principal cancelada → GP puntúa 0 para todos ──────────────────

  it("carrera cancelada → el GP puntúa 0 para todos (scoring.md §6)", async () => {
    const gp = await prisma.gp.create({
      data: {
        seasonId: world.season.id,
        round: 4,
        name: `GP ${suffix} carrera cancelada`,
        circuitId: world.gp.circuitId,
        date: new Date("2099-06-22T12:00:00Z"),
      },
    });
    const race = await prisma.weekendEvent.create({
      data: { gpId: gp.id, type: "race", orderNum: 1 },
    });
    await seedAffiliationsFor(gp.id);
    const gpLineupId = await createLineupFor(gp.id);

    const { results } = await callerFor(ADMIN_IP, adminToken);
    await results.importEvent({
      gpId: gp.id,
      eventId: race.id,
      entries: [
        entry(r1, { position: 1, finished: true }),
        entry(r2, { position: 2, finished: true }),
      ],
    });
    await results.cancelEvent({ gpId: gp.id, eventId: race.id });

    const res = await results.markDefinitive({ gpId: gp.id });
    expect(res).toMatchObject({ madeDefinitive: 2, lineupsScored: 1, noop: false });

    const score = await prisma.score.findUniqueOrThrow({
      where: { lineupId_resultsVersion: { lineupId: gpLineupId, resultsVersion: "rv-1" } },
    });
    expect(Number(score.pointsTotal)).toBe(0);
    const breakdown = score.breakdown as unknown as {
      gold: Array<{ points: number; breakdown: { total: number } }>;
      silver: Array<{ points: number }>;
      constructor: { points: number };
      team: { points: number };
    };
    expect(breakdown.gold.every((slot) => slot.points === 0)).toBe(true);
    expect(breakdown.gold.every((slot) => slot.breakdown.total === 0)).toBe(true);
    expect(breakdown.silver.every((slot) => slot.points === 0)).toBe(true);
    expect(breakdown.constructor.points).toBe(0);
    expect(breakdown.team.points).toBe(0);
  });

  it("markDefinitive sin reglas de temporada → INTERNAL_SERVER_ERROR (sin escrituras)", async () => {
    // Temporada nueva sin `SeasonRule` (el recálculo las requiere).
    const seasonNoRules = await prisma.season.create({
      data: { name: `Temporada ${suffix} sin reglas`, year: 2099 },
    });
    const gp = await prisma.gp.create({
      data: {
        seasonId: seasonNoRules.id,
        round: 1,
        name: `GP ${suffix} sin reglas`,
        circuitId: world.gp.circuitId,
        date: new Date("2099-08-01T12:00:00Z"),
      },
    });
    const race = await prisma.weekendEvent.create({
      data: { gpId: gp.id, type: "race", orderNum: 1 },
    });
    await seedAffiliationsFor(gp.id);
    await createLineupFor(gp.id);

    const { results } = await callerFor(ADMIN_IP, adminToken);
    await results.importEvent({
      gpId: gp.id,
      eventId: race.id,
      entries: [
        entry(r1, { position: 1, finished: true }),
        entry(r2, { position: 2, finished: true }),
      ],
    });

    await expect(results.markDefinitive({ gpId: gp.id })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "La temporada no tiene reglas publicadas.",
    });

    // Atomicidad: las filas siguen `provisional` (sin `resultsVersion`) y no
    // hay auditoría ni Score.
    const rows = await prisma.result.findMany({ where: { gpId: gp.id } });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.status === "provisional")).toBe(true);
    expect(rows.every((row) => row.resultsVersion === null)).toBe(true);
    expect(
      await prisma.auditLog.count({
        where: { action: "results.marked_definitive", entityId: gp.id },
      }),
    ).toBe(0);
    expect(await prisma.score.count({ where: { gpId: gp.id } })).toBe(0);
  });

  it("sprint sin cancelar: sus puntos entran en el recálculo", async () => {
    const gp = await prisma.gp.create({
      data: {
        seasonId: world.season.id,
        round: 5,
        name: `GP ${suffix} sprint`,
        circuitId: world.gp.circuitId,
        date: new Date("2099-06-29T12:00:00Z"),
      },
    });
    const race = await prisma.weekendEvent.create({
      data: { gpId: gp.id, type: "race", orderNum: 1 },
    });
    const q2 = await prisma.weekendEvent.create({
      data: { gpId: gp.id, type: "q2", orderNum: 2 },
    });
    const sprint = await prisma.weekendEvent.create({
      data: { gpId: gp.id, type: "sprint", orderNum: 3 },
    });
    await seedAffiliationsFor(gp.id);
    const gpLineupId = await createLineupFor(gp.id);

    const { results } = await callerFor(ADMIN_IP, adminToken);
    await results.importEvent({
      gpId: gp.id,
      eventId: q2.id,
      entries: [
        entry(r1, { position: 1, finished: true }),
        entry(r2, { position: 2, finished: true }),
      ],
    });
    await results.importEvent({
      gpId: gp.id,
      eventId: sprint.id,
      entries: [
        entry(r1, { position: 1, finished: true }),
        entry(r2, { position: 2, finished: true }),
      ],
    });
    await results.importEvent({
      gpId: gp.id,
      eventId: race.id,
      entries: [
        entry(r1, { position: 1, finished: true }),
        entry(r2, { position: 2, finished: true }),
      ],
    });

    const res = await results.markDefinitive({ gpId: gp.id });
    expect(res).toMatchObject({ madeDefinitive: 6, lineupsScored: 1, noop: false });

    const score = await prisma.score.findUniqueOrThrow({
      where: { lineupId_resultsVersion: { lineupId: gpLineupId, resultsVersion: "rv-1" } },
    });
    const breakdown = score.breakdown as unknown as {
      gold: Array<{
        riderId: string;
        points: number;
        breakdown: { q2: number; sprint: number; mainRace: number; total: number };
      }>;
    };
    // r1: Q2 12 + sprint 12 + carrera 25 + ganador 5 (derivado) = 54.
    const r1Slot = breakdown.gold.find((slot) => slot.riderId === r1);
    expect(r1Slot?.points).toBeCloseTo(54, 6);
    expect(r1Slot?.breakdown).toMatchObject({ q2: 12, sprint: 12, mainRace: 25, total: 54 });
    // r2: Q2 8 + sprint 9 + carrera 20 = 37.
    const r2Slot = breakdown.gold.find((slot) => slot.riderId === r2);
    expect(r2Slot?.points).toBeCloseTo(37, 6);
    expect(r2Slot?.breakdown).toMatchObject({ q2: 8, sprint: 9, mainRace: 20, total: 37 });
  });

  // ── US-19: Recálculo auditable y versionado ────────────────────────────────

  it("corrección: results_history conserva antes→nuevo (CA US-19)", async () => {
    // GP de US-19 (ronda 6) con resultados + lineup.
    const gp = await prisma.gp.create({
      data: {
        seasonId: world.season.id,
        round: 6,
        name: `GP ${suffix} US-19`,
        circuitId: world.gp.circuitId,
        date: new Date("2099-07-15T12:00:00Z"),
      },
    });
    const q2 = await prisma.weekendEvent.create({
      data: { gpId: gp.id, type: "q2", orderNum: 1 },
    });
    const race = await prisma.weekendEvent.create({
      data: { gpId: gp.id, type: "race", orderNum: 3 },
    });
    await seedAffiliationsFor(gp.id);
    const gpLineupId = await createLineupFor(gp.id);

    const { results } = await callerFor(ADMIN_IP, adminToken);
    // Importar resultados iniciales.
    await results.importEvent({
      gpId: gp.id,
      eventId: q2.id,
      entries: [entry(r1, { position: 1, finished: true })],
    });
    await results.importEvent({
      gpId: gp.id,
      eventId: race.id,
      entries: [entry(r1, { position: 1, finished: true })],
    });

    // Marcar definitivo (rv-1).
    await results.markDefinitive({ gpId: gp.id });

    // Corrección: r1 pasa de 1º a 3º en la carrera (penalización posterior).
    const corrected = await results.importEvent({
      gpId: gp.id,
      eventId: race.id,
      entries: [entry(r1, { position: 3, finished: true })],
      reason: "penalización posterior (US-19)",
    });
    expect(corrected).toMatchObject({
      corrected: 1,
      recalculated: true,
      resultsVersion: "rv-2",
    });

    // results_history conserva antes→nuevo.
    const r1Row = await prisma.result.findUniqueOrThrow({
      where: { gpId_eventId_riderId: { gpId: gp.id, eventId: race.id, riderId: r1 } },
    });
    const history = await prisma.resultsHistory.findMany({
      where: { resultId: r1Row.id },
      orderBy: { createdAt: "asc" },
    });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      reason: "penalización posterior (US-19)",
      userId: adminId,
      resultsVersion: "rv-1", // versión en vigor al momento de la corrección.
    });
    expect(history[0]?.beforeData).toMatchObject({ position: 1 });
    expect(history[0]?.afterData).toMatchObject({ position: 3 });

    // La fila se reconfirma a definitive (con la nueva versión).
    expect(r1Row.status).toBe("definitive");
    expect(r1Row.resultsVersion).toBe("rv-2");

    // El Score rv-2 existe (recalculado).
    const score = await prisma.score.findUniqueOrThrow({
      where: { lineupId_resultsVersion: { lineupId: gpLineupId, resultsVersion: "rv-2" } },
    });
    expect(score).toBeDefined();

    // El Score rv-1 permanece para histórico (invariante 7).
    const scoreRv1 = await prisma.score.findUniqueOrThrow({
      where: { lineupId_resultsVersion: { lineupId: gpLineupId, resultsVersion: "rv-1" } },
    });
    expect(scoreRv1).toBeDefined();
  });

  it("re-importar el mismo resultado no duplica puntos (CA US-19)", async () => {
    // GP de US-19 (ronda 7) con resultados + lineup.
    const gp = await prisma.gp.create({
      data: {
        seasonId: world.season.id,
        round: 7,
        name: `GP ${suffix} US-19 idempotencia`,
        circuitId: world.gp.circuitId,
        date: new Date("2099-08-15T12:00:00Z"),
      },
    });
    const race = await prisma.weekendEvent.create({
      data: { gpId: gp.id, type: "race", orderNum: 3 },
    });
    await seedAffiliationsFor(gp.id);
    const gpLineupId = await createLineupFor(gp.id);

    const { results } = await callerFor(ADMIN_IP, adminToken);
    // Importar resultados.
    await results.importEvent({
      gpId: gp.id,
      eventId: race.id,
      entries: [entry(r1, { position: 1, finished: true })],
    });

    // Marcar definitivo (rv-1).
    await results.markDefinitive({ gpId: gp.id });

    // Re-importar el mismo resultado (no-op).
    const reImport = await results.importEvent({
      gpId: gp.id,
      eventId: race.id,
      entries: [entry(r1, { position: 1, finished: true })],
      reason: "re-importación (no-op)",
    });
    expect(reImport).toMatchObject({
      created: 0,
      corrected: 0,
      recalculated: false,
      resultsVersion: null,
      lineupsScored: 0,
    });

    // Una sola fila por piloto (no duplicada).
    const rowCount = await prisma.result.count({
      where: { gpId: gp.id, eventId: race.id, riderId: r1 },
    });
    expect(rowCount).toBe(1);

    // El Score rv-1 es el único (no se generó rv-2).
    const scoreCount = await prisma.score.count({
      where: { gpId: gp.id, lineupId: gpLineupId },
    });
    expect(scoreCount).toBe(1);
    const score = await prisma.score.findUniqueOrThrow({
      where: { lineupId_resultsVersion: { lineupId: gpLineupId, resultsVersion: "rv-1" } },
    });
    expect(score).toBeDefined();
  });
});
