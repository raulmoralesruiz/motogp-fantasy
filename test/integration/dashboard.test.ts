/**
 * US-15 · Dashboard (PostgreSQL real):
 * próximo GP con cuenta atrás a lockout, presupuesto disponible, coste del
 * lineup, posición en cada liga y avisos (recálculo, lockout).
 *
 * Mismo patrón que `market-explore.test.ts`: los módulos de la app leen el
 * entorno al importar (singletons de Prisma y Redis), así que `DATABASE_URL`
 * se fija ANTES del `import()` dinámico. El router `dashboard` es inyectable:
 * se monta con la BD efímera.
 *
 * Criterios de aceptación (backlog US-15):
 * - Próximo GP (primer `scheduled` de la temporada más reciente) con su
 *   estado de cierre (gate US-13: `locked ∨ now ≥ lockoutAt`, server-side).
 * - Presupuesto disponible (B + carry, US-10) y lineup guardado (coste,
 *   presupuesto, saldo, cambios restantes).
 * - Posición en cada liga activa (por GP y general; nulls si US-21 aún no
 *   calcula); membresías `left` excluidas.
 * - Avisos: lockout (warning si futuro / error si pasado) y recálculo
 *   (nº de correcciones + última fecha; solo GPs con lineup del usuario).
 * - RBAC: 401 sin sesión.
 *
 * Nota: la BD es compartida entre archivos de test; todas las aserciones se
 * acotan a los IDs del mundo de este run. La temporada usa año 2199 (mayor
 * que el 2099 de los demás tests) para que "temporada más reciente" sea
 * determinista.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CapturingEmailSender,
  createPrisma,
  integrationDbUrl,
} from "./helpers";

// Antes de importar los módulos de la app (sus singletons leen env al cargar).
process.env.DATABASE_URL = integrationDbUrl();
process.env.REDIS_URL ??= "redis://localhost:6379/0"; // dummy: lazyConnect, no se conecta

const { createAuthRouter } = await import("../../app/server/routers/auth");
const { createDashboardRouter } = await import(
  "../../app/server/routers/dashboard"
);
const { createContext } = await import("../../app/server/trpc");
const { InMemoryRateLimitStore } = await import("../../app/modules/identity");
const { PROVISIONAL_SEASON_RULES } = await import(
  "../../app/shared/config/season-rules"
);

const suffix = randomUUID().slice(0, 8);
const email = (name: string) => `${name}-${suffix}@test.local`;
const username = (name: string) => `${name}_${suffix}`;
const PASSWORD = "contraseña-segura-1";
const USER_IP = "198.51.100.70";
const ADMIN_EMAIL = email("admin");

describe("US-15 · Dashboard (PostgreSQL real)", () => {
  let prisma: ReturnType<typeof createPrisma>;
  let authRouter: ReturnType<typeof createAuthRouter>;
  let dashboardRouter: ReturnType<typeof createDashboardRouter>;

  // Mundo: temporada 2199 → GP ronda 1 (cerrado) + GP ronda 2 (próximo).
  let seasonAId: string;
  let circuitName: string;
  let gpA1Id: string; // ronda 1 (pasada, cerrada)
  let gpA2Id: string; // ronda 2 (próximo GP)
  let eventA1Id: string;
  let eventA2Id: string;
  let riderIds: string[]; // 4 pilotos (2 oro + 2 plata)
  let ctorId: string;
  let teamId: string;
  let userId: string;
  let userToken: string;
  let league1Id: string; // activa, con rankings
  let league2Id: string; // activa, sin rankings
  let league3Id: string; // left (excluida)
  let seasonBId: string | null = null; // temporada sin GPs (último test)

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
    dashboardRouter = createDashboardRouter({ prisma });

    // Temporada 2199 (mayor que el 2099 de los demás tests) + reglas.
    const seasonA = await prisma.season.create({
      data: {
        name: `Temporada 2199 ${suffix}`,
        year: 2199,
        status: "active",
      },
    });
    seasonAId = seasonA.id;
    await prisma.seasonRule.create({
      data: {
        seasonId: seasonAId,
        version: "provisional-v1",
        rules: PROVISIONAL_SEASON_RULES,
      },
    });

    const circuit = await prisma.circuit.create({
      data: { name: `Circuito ${suffix}`, country: "Ficticia" },
    });
    circuitName = circuit.name;

    const gpA1 = await prisma.gp.create({
      data: {
        seasonId: seasonAId,
        round: 1,
        name: `GP ${suffix} R1`,
        circuitId: circuit.id,
        date: new Date("2199-06-01T12:00:00Z"),
        status: "locked",
      },
    });
    gpA1Id = gpA1.id;
    const gpA2 = await prisma.gp.create({
      data: {
        seasonId: seasonAId,
        round: 2,
        name: `GP ${suffix} R2`,
        circuitId: circuit.id,
        date: new Date("2199-06-08T12:00:00Z"),
        status: "scheduled",
      },
    });
    gpA2Id = gpA2.id;

    const eventA1 = await prisma.weekendEvent.create({
      data: { gpId: gpA1Id, type: "race", orderNum: 1 },
    });
    eventA1Id = eventA1.id;
    const eventA2 = await prisma.weekendEvent.create({
      data: { gpId: gpA2Id, type: "race", orderNum: 1 },
    });
    eventA2Id = eventA2.id;

    riderIds = [];
    for (let i = 0; i < 4; i++) {
      const rider = await prisma.rider.create({
        data: { name: `Piloto ${suffix}-${i}` },
      });
      riderIds.push(rider.id);
    }
    const ctor = await prisma.constructor.create({
      data: { name: `Constructor ${suffix}` },
    });
    ctorId = ctor.id;
    const team = await prisma.team.create({
      data: { name: `Equipo ${suffix}`, constructorId: ctor.id },
    });
    teamId = team.id;

    // Usuario normal (con sesión para las llamadas tRPC).
    const userCaller = await callerFor(USER_IP);
    await userCaller.auth.register({
      email: email("ana"),
      username: username("ana"),
      password: PASSWORD,
      termsAccepted: true,
    });
    userToken = sessionTokenFrom(userCaller.ctx);
    const user = await prisma.user.findUnique({
      where: { email: email("ana") },
    });
    if (!user) throw new Error("Usuario no encontrado tras el registro.");
    userId = user.id;
  });

  afterAll(async () => {
    // Restaura el estado: la temporada sin GPs (2299) era solo para el último
    // test; la borra para no alterar la "temporada más reciente" de otros runs.
    if (seasonBId !== null) {
      await prisma.season.delete({ where: { id: seasonBId } });
    }
    await prisma.$disconnect();
  });

  /** Contexto tRPC para una petición simulada (IP + cookie de sesión opcional). */
  async function callerFor(ip: string, sessionToken?: string) {
    const headers: Record<string, string> = { "x-forwarded-for": ip };
    if (sessionToken !== undefined) headers.cookie = `session=${sessionToken}`;
    const req = new Request("http://localhost/api/trpc/dashboard", {
      method: "POST",
      headers,
    });
    const ctx = await createContext(req, prisma);
    return {
      ctx,
      auth: authRouter.createCaller(ctx),
      dashboard: dashboardRouter.createCaller(ctx),
    };
  }

  /** Extrae el token de la cookie de sesión emitida en `ctx.pendingCookies`. */
  function sessionTokenFrom(ctx: { pendingCookies: string[] }): string {
    expect(ctx.pendingCookies).toHaveLength(1);
    const token = /^session=([0-9a-f]{64});/.exec(ctx.pendingCookies[0] ?? "")?.[1];
    if (!token) throw new Error(`Cookie de sesión inesperada: ${ctx.pendingCookies[0]}`);
    return token;
  }

  /** Precios congelados del próximo GP (r0–r3, constructor y equipo). */
  async function seedGp2Prices() {
    const prices: [string, string, number][] = [
      ["rider", riderIds[0] ?? "", 20],
      ["rider", riderIds[1] ?? "", 18],
      ["rider", riderIds[2] ?? "", 15],
      ["rider", riderIds[3] ?? "", 12],
      ["constructor", ctorId, 16],
      ["team", teamId, 14],
    ];
    for (const [assetType, assetId, price] of prices) {
      await prisma.price.create({
        data: {
          assetType: assetType as "rider" | "constructor" | "team",
          assetId,
          gpId: gpA2Id,
          price,
          reason: "formula",
          rulesVersion: "pricing-v1",
        },
      });
    }
  }

  /** Lineup completo del usuario para el próximo GP (2 oro + 2 plata + ctor + equipo). */
  async function seedLineup() {
    const lineup = await prisma.lineup.create({
      data: { userId, gpId: gpA2Id },
    });
    await prisma.lineupSlot.createMany({
      data: [
        { lineupId: lineup.id, slotType: "gold", assetType: "rider", assetId: riderIds[0] ?? "" },
        { lineupId: lineup.id, slotType: "gold", assetType: "rider", assetId: riderIds[1] ?? "" },
        { lineupId: lineup.id, slotType: "silver", assetType: "rider", assetId: riderIds[2] ?? "" },
        { lineupId: lineup.id, slotType: "silver", assetType: "rider", assetId: riderIds[3] ?? "" },
        { lineupId: lineup.id, slotType: "constructor", assetType: "constructor", assetId: ctorId },
        { lineupId: lineup.id, slotType: "team", assetType: "team", assetId: teamId },
      ],
    });
  }

  // ── RBAC ───────────────────────────────────────────────────────────────────

  it("dashboard.get: 401 sin sesión", async () => {
    const { dashboard } = await callerFor(USER_IP);
    await expect(dashboard.get()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  // ── Vista base ─────────────────────────────────────────────────────────────

  it("vista base: temporada, próximo GP, presupuesto base, sin lineup/ligas/avisos", async () => {
    const { dashboard } = await callerFor(USER_IP, userToken);
    const view = await dashboard.get();

    expect(view.season).toMatchObject({ id: seasonAId, year: 2199 });
    expect(view.nextGp).toMatchObject({
      id: gpA2Id,
      name: `GP ${suffix} R2`,
      round: 2,
      status: "scheduled",
      lockoutAt: null,
      circuit: { name: circuitName, country: "Ficticia" },
      closed: false,
    });
    // Sin movimientos → carry 0 → presupuesto = B (100).
    expect(view.budget).toEqual({ base: 100, carry: 0, total: 100 });
    expect(view.lineup).toBeNull();
    expect(view.leagues).toEqual([]);
    expect(view.notices).toEqual([]);
  });

  // ── Presupuesto con carry ──────────────────────────────────────────────────

  it("presupuesto con carry del GP anterior (B + min(t·sin_usar, cmax))", async () => {
    // Saldo del GP anterior: base 100 − gasto 80 = 20 → carry min(0.25·20, 8) = 5.
    await prisma.budgetMovement.create({
      data: { userId, gpId: gpA1Id, type: "base", amount: 100 },
    });
    await prisma.budgetMovement.create({
      data: { userId, gpId: gpA1Id, type: "spend", amount: -80 },
    });

    const { dashboard } = await callerFor(USER_IP, userToken);
    const view = await dashboard.get();
    expect(view.budget).toEqual({ base: 100, carry: 5, total: 105 });
  });

  // ── Lineup guardado ────────────────────────────────────────────────────────

  it("lineup guardado: coste, presupuesto, saldo y cambios restantes", async () => {
    await seedGp2Prices();
    await seedLineup();
    // Movimientos del primer save: base 100 + carry 5 − gasto 95.
    await prisma.budgetMovement.create({
      data: { userId, gpId: gpA2Id, type: "base", amount: 100 },
    });
    await prisma.budgetMovement.create({
      data: { userId, gpId: gpA2Id, type: "carry", amount: 5 },
    });
    await prisma.budgetMovement.create({
      data: { userId, gpId: gpA2Id, type: "spend", amount: -95 },
    });

    const { dashboard } = await callerFor(USER_IP, userToken);
    const view = await dashboard.get();

    expect(view.budget).toEqual({ base: 100, carry: 5, total: 105 });
    expect(view.lineup).toMatchObject({
      gpId: gpA2Id,
      cost: 95,
      budget: 105,
      balance: 10,
      usedChanges: 0,
      remainingChanges: 2,
    });
    expect(view.lineup?.slots).toEqual({
      gold: [riderIds[0], riderIds[1]],
      silver: [riderIds[2], riderIds[3]],
      constructorId: ctorId,
      teamId,
    });
  });

  // ── Ligas ──────────────────────────────────────────────────────────────────

  it("liga con rankings: posición por GP y general", async () => {
    const league1 = await prisma.league.create({
      data: { name: `Liga ${suffix} A` },
    });
    league1Id = league1.id;
    await prisma.leagueMember.create({
      data: { leagueId: league1Id, userId, role: "member", status: "active" },
    });
    await prisma.ranking.create({
      data: {
        leagueId: league1Id,
        gpId: gpA2Id,
        userId,
        position: 2,
        points: 150.5,
        resultsVersion: "scoring-v1",
      },
    });
    await prisma.ranking.create({
      data: {
        leagueId: league1Id,
        gpId: null,
        userId,
        position: 3,
        points: 800.25,
        resultsVersion: "scoring-v1",
      },
    });

    const { dashboard } = await callerFor(USER_IP, userToken);
    const view = await dashboard.get();
    expect(view.leagues).toHaveLength(1);
    expect(view.leagues[0]).toMatchObject({
      leagueId: league1Id,
      leagueName: `Liga ${suffix} A`,
      gpPosition: 2,
      gpPoints: 150.5,
      overallPosition: 3,
      overallPoints: 800.25,
    });
  });

  it("liga sin rankings: posiciones null", async () => {
    const league2 = await prisma.league.create({
      data: { name: `Liga ${suffix} B` },
    });
    league2Id = league2.id;
    await prisma.leagueMember.create({
      data: { leagueId: league2Id, userId, role: "member", status: "active" },
    });

    const { dashboard } = await callerFor(USER_IP, userToken);
    const view = await dashboard.get();
    expect(view.leagues).toHaveLength(2);
    const l2 = view.leagues.find((l) => l.leagueId === league2Id);
    expect(l2).toMatchObject({
      leagueId: league2Id,
      leagueName: `Liga ${suffix} B`,
      gpPosition: null,
      gpPoints: null,
      overallPosition: null,
      overallPoints: null,
    });
  });

  it("membresía left: excluida de las ligas del dashboard", async () => {
    const league3 = await prisma.league.create({
      data: { name: `Liga ${suffix} C` },
    });
    league3Id = league3.id;
    await prisma.leagueMember.create({
      data: { leagueId: league3Id, userId, role: "member", status: "left" },
    });

    const { dashboard } = await callerFor(USER_IP, userToken);
    const view = await dashboard.get();
    expect(view.leagues).toHaveLength(2);
    expect(view.leagues.find((l) => l.leagueId === league3Id)).toBeUndefined();
  });

  // ── Avisos de recálculo ────────────────────────────────────────────────────

  it("aviso de recálculo: 1 y 2 correcciones (solo GPs con lineup)", async () => {
    // Resultado del próximo GP (con lineup) + 1 corrección.
    const result = await prisma.result.create({
      data: {
        gpId: gpA2Id,
        eventId: eventA2Id,
        riderId: riderIds[0] ?? "",
        position: 1,
        rawPoints: 25,
        status: "corrected",
        resultsVersion: "results-v2",
        source: "manual",
      },
    });
    await prisma.resultsHistory.create({
      data: {
        resultId: result.id,
        beforeData: { position: 2, points: 20 },
        afterData: { position: 1, points: 25 },
        reason: "corrección manual",
        resultsVersion: "results-v2",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    });

    const { dashboard } = await callerFor(USER_IP, userToken);
    let view = await dashboard.get();
    expect(view.notices).toHaveLength(1);
    expect(view.notices[0]).toMatchObject({
      kind: "recalculo",
      severity: "info",
      gpId: gpA2Id,
      gpName: `GP ${suffix} R2`,
    });
    // El nº de correcciones y la última fecha viven en el mensaje.
    expect(view.notices[0]?.message).toContain("1 corrección");
    expect(view.notices[0]?.at?.toISOString()).toBe("2026-01-01T00:00:00.000Z");

    // 2ª corrección → se suma al conteo y actualiza la última fecha.
    await prisma.resultsHistory.create({
      data: {
        resultId: result.id,
        beforeData: { position: 1, points: 25 },
        afterData: { position: 1, points: 25 },
        reason: "ajuste de bono",
        resultsVersion: "results-v3",
        createdAt: new Date("2026-01-02T00:00:00Z"),
      },
    });
    view = await dashboard.get();
    expect(view.notices).toHaveLength(1);
    expect(view.notices[0]?.message).toContain("2 correcciones");
    expect(view.notices[0]?.at?.toISOString()).toBe("2026-01-02T00:00:00.000Z");

    // Resultado de un GP SIN lineup del usuario → excluido del aviso.
    const otherResult = await prisma.result.create({
      data: {
        gpId: gpA1Id,
        eventId: eventA1Id,
        riderId: riderIds[1] ?? "",
        position: 3,
        rawPoints: 16,
        status: "corrected",
        resultsVersion: "results-v2",
        source: "manual",
      },
    });
    await prisma.resultsHistory.create({
      data: {
        resultId: otherResult.id,
        beforeData: { position: 4, points: 13 },
        afterData: { position: 3, points: 16 },
        reason: "corrección manual",
        resultsVersion: "results-v2",
      },
    });
    view = await dashboard.get();
    expect(view.notices).toHaveLength(1);
    expect(view.notices[0]?.gpId).toBe(gpA2Id);
  });

  // ── Lockout ────────────────────────────────────────────────────────────────

  it("lockout futuro: aviso warning y cerrado = false", async () => {
    const lockoutAt = new Date(Date.now() + 2 * 3600 * 1000);
    await prisma.gp.update({
      where: { id: gpA2Id },
      data: { lockoutAt },
    });

    const { dashboard } = await callerFor(USER_IP, userToken);
    const view = await dashboard.get();
    expect(view.nextGp?.closed).toBe(false);
    const lockout = view.notices.find((n) => n.kind === "lockout");
    expect(lockout).toMatchObject({
      kind: "lockout",
      severity: "warning",
      gpId: gpA2Id,
    });
    expect(lockout?.at?.toISOString()).toBe(lockoutAt.toISOString());
  });

  it("lockout pasado: aviso error y cerrado = true", async () => {
    const lockoutAt = new Date(Date.now() - 3600 * 1000);
    await prisma.gp.update({
      where: { id: gpA2Id },
      data: { lockoutAt },
    });

    const { dashboard } = await callerFor(USER_IP, userToken);
    const view = await dashboard.get();
    expect(view.nextGp?.closed).toBe(true);
    const lockout = view.notices.find((n) => n.kind === "lockout");
    expect(lockout).toMatchObject({
      kind: "lockout",
      severity: "error",
      gpId: gpA2Id,
    });
  });

  // ── Temporada sin GPs ──────────────────────────────────────────────────────

  it("temporada sin GPs programados: sin próximo GP ni presupuesto/lineup", async () => {
    const seasonB = await prisma.season.create({
      data: {
        name: `Temporada 2299 ${suffix}`,
        year: 2299,
        status: "active",
      },
    });
    seasonBId = seasonB.id;

    const { dashboard } = await callerFor(USER_IP, userToken);
    const view = await dashboard.get();
    expect(view.season).toMatchObject({ id: seasonBId, year: 2299 });
    expect(view.nextGp).toBeNull();
    expect(view.budget).toBeNull();
    expect(view.lineup).toBeNull();
    // Las ligas y los avisos de recálculo siguen siendo útiles.
    expect(view.leagues).toHaveLength(2);
    expect(view.notices).toHaveLength(1);
    expect(view.notices[0]?.kind).toBe("recalculo");
  });
});
