/**
 * US-06 · Mercado: pilotos, constructores, equipos y afiliaciones por GP
 * (PostgreSQL real).
 *
 * Mismo patrón que `gps.test.ts`: los módulos de la app leen el entorno al
 * importar (singletons de Prisma y Redis), así que `DATABASE_URL` y
 * `REDIS_URL` se fijan ANTES del `import()` dinámico. El router `market` es
 * inyectable: se monta con la BD efímera.
 *
 * Criterios de aceptación (backlog US-06):
 * - Constructor y equipo son entidades distintas (un equipo pertenece a
 *   exactamente un constructor); invariante 5: nunca intercambiables.
 * - Afiliación por GP (unique `(rider, gp)`); el constructor siempre se
 *   deriva del equipo en el servidor.
 * - Un cambio de equipo a mitad de temporada no modifica GPs anteriores
 *   (test explícito; ADR-0013: "desde el GP X" rellena solo GPs sin
 *   afiliación, salta y reporta los existentes).
 * - Creación idempotente por nombre (reutiliza sin auditar).
 * - RBAC: mutaciones solo `global_admin` (403 para `user`); lecturas para
 *   cualquier usuario autenticado.
 * - Auditoría (T-09): `rider.created`, `constructor.created`,
 *   `team.created`, `affiliation.set` (before/after) y
 *   `affiliation.range_set` (resumen).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
const { createMarketRouter } = await import("../../app/server/routers/market");
const { createContext } = await import("../../app/server/trpc");
const { InMemoryRateLimitStore } = await import("../../app/modules/identity");

const suffix = randomUUID().slice(0, 8);
const email = (name: string) => `${name}-${suffix}@test.local`;
const username = (name: string) => `${name}_${suffix}`;
const PASSWORD = "contraseña-segura-1";
const ADMIN_EMAIL = email("admin");
const ADMIN_IP = "198.51.100.40";
const USER_IP = "198.51.100.41";

const RIDER_NAME = `Marco Rossi ${suffix}`;
const CTOR_A = `Constructor Alfa ${suffix}`;
const CTOR_B = `Constructor Beta ${suffix}`;
const TEAM_A = `Equipo Alfa ${suffix}`;
const TEAM_B = `Equipo Beta ${suffix}`;

describe("US-06 · Mercado: activos y afiliaciones por GP (PostgreSQL real)", () => {
  let prisma: ReturnType<typeof createPrisma>;
  let authRouter: ReturnType<typeof createAuthRouter>;
  let marketRouter: ReturnType<typeof createMarketRouter>;
  let world: World;
  let adminId: string;
  let adminToken: string;
  let userToken: string;
  let riderId: string; // piloto del mundo (afiliaciones)
  let newRiderId: string; // piloto creado por el router (CRUD)
  let ctorAId: string;
  let ctorBId: string;
  let teamAId: string;
  let teamBId: string;
  let gp2Id: string;
  let gp3Id: string;

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
    marketRouter = createMarketRouter({ prisma });
    world = await seedWorld(prisma);
    riderId = world.riders[0].id;

    // Rondas 2 y 3 de la misma temporada (la creación de GPs es US-05; aquí
    // solo se necesitan las rondas para las afiliaciones).
    const gp2 = await prisma.gp.create({
      data: {
        seasonId: world.season.id,
        round: 2,
        name: `GP ${suffix} R2`,
        circuitId: world.gp.circuitId,
        date: new Date("2099-06-08T12:00:00Z"),
      },
    });
    gp2Id = gp2.id;
    const gp3 = await prisma.gp.create({
      data: {
        seasonId: world.season.id,
        round: 3,
        name: `GP ${suffix} R3`,
        circuitId: world.gp.circuitId,
        date: new Date("2099-06-15T12:00:00Z"),
      },
    });
    gp3Id = gp3.id;

    // Admin global (bootstrap, ADR-0010) + usuario normal.
    const adminCaller = await callerFor(ADMIN_IP);
    const adminReg = await adminCaller.auth.register({
      email: ADMIN_EMAIL,
      username: username("admin"),
      password: PASSWORD,
      termsAccepted: true,
    });
    adminId = adminReg.user.id;
    adminToken = sessionTokenFrom(adminCaller.ctx);

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
    const req = new Request("http://localhost/api/trpc/market", {
      method: "POST",
      headers,
    });
    const ctx = await createContext(req, prisma);
    return {
      ctx,
      auth: authRouter.createCaller(ctx),
      market: marketRouter.createCaller(ctx),
    };
  }

  /** Extrae el token de la cookie de sesión emitida en `ctx.pendingCookies`. */
  function sessionTokenFrom(ctx: { pendingCookies: string[] }): string {
    expect(ctx.pendingCookies).toHaveLength(1);
    const token = /^session=([0-9a-f]{64});/.exec(ctx.pendingCookies[0] ?? "")?.[1];
    if (!token) throw new Error(`Cookie de sesión inesperada: ${ctx.pendingCookies[0]}`);
    return token;
  }

  // ── Creación idempotente de activos ───────────────────────────────────────

  it("un admin crea un constructor (auditoría constructor.created)", async () => {
    const { market } = await callerFor(ADMIN_IP, adminToken);
    const ctor = await market.constructors.create({ name: CTOR_A });
    ctorAId = ctor.id;
    expect(ctor).toMatchObject({ id: ctorAId, name: CTOR_A, created: true });

    const audit = await prisma.auditLog.findMany({
      where: { action: "constructor.created", entityId: ctorAId },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: adminId,
      entity: "constructor",
      ip: ADMIN_IP,
    });
    expect(audit[0]?.afterData).toMatchObject({ name: CTOR_A });
  });

  it("recrear el mismo constructor lo reutiliza (idempotente, sin auditoría nueva)", async () => {
    const { market } = await callerFor(ADMIN_IP, adminToken);
    const reused = await market.constructors.create({ name: CTOR_A });
    expect(reused.id).toBe(ctorAId);
    expect(reused.created).toBe(false);
    // El unique `name` se mantiene: una sola fila.
    expect(await prisma.constructor.count({ where: { name: CTOR_A } })).toBe(1);
    // Reutilizar no audita.
    expect(
      await prisma.auditLog.count({
        where: { action: "constructor.created", entityId: ctorAId },
      }),
    ).toBe(1);
  });

  it("un admin crea un piloto con dorsal (auditoría rider.created)", async () => {
    const { market } = await callerFor(ADMIN_IP, adminToken);
    const rider = await market.riders.create({ name: RIDER_NAME, number: 27 });
    newRiderId = rider.id;
    expect(rider).toMatchObject({
      id: newRiderId,
      name: RIDER_NAME,
      number: 27,
      isActive: true,
      created: true,
    });

    const audit = await prisma.auditLog.findMany({
      where: { action: "rider.created", entityId: newRiderId },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: adminId,
      entity: "rider",
      ip: ADMIN_IP,
    });
    expect(audit[0]?.afterData).toMatchObject({ name: RIDER_NAME, number: 27 });
  });

  it("recrear el mismo piloto lo reutiliza (idempotente, sin auditoría nueva)", async () => {
    const { market } = await callerFor(ADMIN_IP, adminToken);
    const reused = await market.riders.create({ name: RIDER_NAME, number: 99 });
    expect(reused.id).toBe(newRiderId);
    expect(reused.created).toBe(false);
    // El dorsal NO se muta al reutilizar (no es un cambio).
    expect(reused.number).toBe(27);
    expect(await prisma.rider.count({ where: { name: RIDER_NAME } })).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { action: "rider.created", entityId: newRiderId },
      }),
    ).toBe(1);
  });

  it("un admin crea un equipo con un constructor existente (auditoría team.created)", async () => {
    const { market } = await callerFor(ADMIN_IP, adminToken);
    const team = await market.teams.create({ name: TEAM_A, constructorId: ctorAId });
    teamAId = team.id;
    expect(team).toMatchObject({
      id: teamAId,
      name: TEAM_A,
      constructorId: ctorAId,
      constructorName: CTOR_A,
      created: true,
    });

    const audit = await prisma.auditLog.findMany({
      where: { action: "team.created", entityId: teamAId },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: adminId,
      entity: "team",
      ip: ADMIN_IP,
    });
    expect(audit[0]?.afterData).toMatchObject({ name: TEAM_A, constructorId: ctorAId });
  });

  it("crear un equipo con un constructor inexistente falla (NOT_FOUND)", async () => {
    const { market } = await callerFor(ADMIN_IP, adminToken);
    await expect(
      market.teams.create({ name: `Equipo Huérfano ${suffix}`, constructorId: randomUUID() }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "El constructor no existe.",
    });
    // No queda equipo ni auditoría.
    expect(
      await prisma.team.count({ where: { name: `Equipo Huérfano ${suffix}` } }),
    ).toBe(0);
  });

  it("recrear el mismo equipo lo reutiliza (idempotente, sin auditoría nueva)", async () => {
    const { market } = await callerFor(ADMIN_IP, adminToken);
    const reused = await market.teams.create({ name: TEAM_A, constructorId: ctorAId });
    expect(reused.id).toBe(teamAId);
    expect(reused.created).toBe(false);
    expect(await prisma.team.count({ where: { name: TEAM_A } })).toBe(1);
    expect(
      await prisma.auditLog.count({ where: { action: "team.created", entityId: teamAId } }),
    ).toBe(1);
  });

  // ── Lecturas y RBAC ───────────────────────────────────────────────────────

  it("un usuario normal puede listar pilotos, constructores y equipos", async () => {
    const { market } = await callerFor(USER_IP, userToken);
    const riders = await market.riders.list();
    expect(riders.map((r) => r.name)).toContain(RIDER_NAME);
    const constructors = await market.constructors.list();
    expect(constructors.map((c) => c.name)).toContain(CTOR_A);
    const teams = await market.teams.list();
    expect(teams.find((t) => t.id === teamAId)).toMatchObject({
      name: TEAM_A,
      constructorId: ctorAId,
      constructorName: CTOR_A,
    });
  });

  it("un usuario no autenticado no puede leer el mercado (401)", async () => {
    const { market } = await callerFor(USER_IP); // sin cookie de sesión
    await expect(market.riders.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("un usuario normal no puede crear activos (403 FORBIDDEN)", async () => {
    const { market } = await callerFor(USER_IP, userToken);
    await expect(market.riders.create({ name: `Piloto Robado ${suffix}` })).rejects.toMatchObject(
      { code: "FORBIDDEN" },
    );
    await expect(
      market.constructors.create({ name: `Constructor Robado ${suffix}` }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      market.teams.create({ name: `Equipo Robado ${suffix}`, constructorId: ctorAId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("un usuario normal no puede asignar afiliaciones (403 FORBIDDEN)", async () => {
    const { market } = await callerFor(USER_IP, userToken);
    await expect(
      market.affiliations.set({ riderId, teamId: teamAId, gpId: world.gp.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      market.affiliations.setFrom({ riderId, teamId: teamAId, fromGpId: world.gp.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // ── Afiliaciones por GP (ajuste fino) ─────────────────────────────────────

  it("affiliations.set crea la afiliación de un GP (constructor derivado del equipo, auditado)", async () => {
    const { market } = await callerFor(ADMIN_IP, adminToken);
    const result = await market.affiliations.set({
      riderId,
      teamId: teamAId,
      gpId: world.gp.id,
    });
    expect(result.changed).toBe(true);
    expect(result.affiliation).toMatchObject({
      riderId,
      teamId: teamAId,
      gpId: world.gp.id,
    });
    // El constructor se deriva del equipo en el servidor (invariante 5).
    const row = await prisma.riderAffiliation.findUnique({
      where: { riderId_gpId: { riderId, gpId: world.gp.id } },
    });
    expect(row).toMatchObject({ teamId: teamAId, constructorId: ctorAId });

    const audit = await prisma.auditLog.findMany({
      where: { action: "affiliation.set", entityId: row?.id },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: adminId,
      entity: "rider_affiliation",
      ip: ADMIN_IP,
    });
    expect(audit[0]?.beforeData).toBeNull();
    expect(audit[0]?.afterData).toMatchObject({
      riderId,
      teamId: teamAId,
      constructorId: ctorAId,
      gpId: world.gp.id,
    });
  });

  it("affiliations.set con la misma afiliación es un no-op (sin auditar)", async () => {
    const { market } = await callerFor(ADMIN_IP, adminToken);
    const before = await prisma.auditLog.count({ where: { action: "affiliation.set" } });
    const result = await market.affiliations.set({
      riderId,
      teamId: teamAId,
      gpId: world.gp.id,
    });
    expect(result.changed).toBe(false);
    expect(result.affiliation.teamId).toBe(teamAId);
    expect(await prisma.auditLog.count({ where: { action: "affiliation.set" } })).toBe(before);
  });

  it("affiliations.set reemplaza la afiliación existente (auditoría before/after)", async () => {
    const { market } = await callerFor(ADMIN_IP, adminToken);
    // Segundo constructor + equipo (para el cambio de equipo).
    const ctorB = await market.constructors.create({ name: CTOR_B });
    ctorBId = ctorB.id;
    const teamB = await market.teams.create({ name: TEAM_B, constructorId: ctorBId });
    teamBId = teamB.id;

    const result = await market.affiliations.set({
      riderId,
      teamId: teamBId,
      gpId: world.gp.id,
    });
    expect(result.changed).toBe(true);
    const row = await prisma.riderAffiliation.findUnique({
      where: { riderId_gpId: { riderId, gpId: world.gp.id } },
    });
    // Mismo registro (unique `(rider, gp)`), ahora con el equipo nuevo.
    expect(row).toMatchObject({ teamId: teamBId, constructorId: ctorBId });

    // Dos auditorías sobre la misma fila: creación (before null) + reemplazo.
    const audits = await prisma.auditLog.findMany({
      where: { action: "affiliation.set", entityId: row?.id },
    });
    expect(audits).toHaveLength(2);
    const creation = audits.find((a) => a.beforeData === null);
    const replacement = audits.find((a) => a.beforeData !== null);
    expect(creation?.afterData).toMatchObject({ teamId: teamAId, constructorId: ctorAId });
    expect(replacement?.beforeData).toMatchObject({ teamId: teamAId, constructorId: ctorAId });
    expect(replacement?.afterData).toMatchObject({
      teamId: teamBId,
      constructorId: ctorBId,
      gpId: world.gp.id,
    });
  });

  it("affiliations.set con piloto, equipo o GP inexistentes falla (NOT_FOUND)", async () => {
    const { market } = await callerFor(ADMIN_IP, adminToken);
    await expect(
      market.affiliations.set({ riderId: randomUUID(), teamId: teamAId, gpId: world.gp.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "El piloto no existe." });
    await expect(
      market.affiliations.set({ riderId, teamId: randomUUID(), gpId: world.gp.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "El equipo no existe." });
    await expect(
      market.affiliations.set({ riderId, teamId: teamAId, gpId: randomUUID() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "El GP no existe." });
  });

  // ── "Desde el GP X en adelante" (ADR-0013) ────────────────────────────────

  it("affiliations.setFrom NO modifica los GPs anteriores (CA US-06)", async () => {
    const { market } = await callerFor(ADMIN_IP, adminToken);
    // Estado previo: R1 → equipo B (reemplazo anterior); R2 y R3 sin afiliación.
    const report = await market.affiliations.setFrom({
      riderId,
      teamId: teamAId,
      fromGpId: gp2Id,
    });
    expect(report).toMatchObject({
      riderId,
      teamId: teamAId,
      fromGpId: gp2Id,
      seasonId: world.season.id,
      created: 2,
      skipped: [],
    });

    // R2 y R3: afiliación nueva con el equipo A (constructor derivado).
    const aff2 = await prisma.riderAffiliation.findUnique({
      where: { riderId_gpId: { riderId, gpId: gp2Id } },
    });
    const aff3 = await prisma.riderAffiliation.findUnique({
      where: { riderId_gpId: { riderId, gpId: gp3Id } },
    });
    expect(aff2).toMatchObject({ teamId: teamAId, constructorId: ctorAId });
    expect(aff3).toMatchObject({ teamId: teamAId, constructorId: ctorAId });

    // CA: R1 (anterior al GP de inicio) sigue con el equipo B: un cambio de
    // equipo a mitad de temporada no modifica GPs anteriores.
    const aff1 = await prisma.riderAffiliation.findUnique({
      where: { riderId_gpId: { riderId, gpId: world.gp.id } },
    });
    expect(aff1).toMatchObject({ teamId: teamBId, constructorId: ctorBId });

    // Auditoría: `affiliation.set` por GP creado + resumen `affiliation.range_set`.
    expect(
      await prisma.auditLog.count({ where: { action: "affiliation.set", entityId: aff2?.id } }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({ where: { action: "affiliation.set", entityId: aff3?.id } }),
    ).toBe(1);
    const rangeAudit = await prisma.auditLog.findMany({
      where: { action: "affiliation.range_set", entityId: riderId },
    });
    expect(rangeAudit).toHaveLength(1);
    expect(rangeAudit[0]).toMatchObject({
      actorId: adminId,
      entity: "rider_affiliation",
      ip: ADMIN_IP,
    });
    expect(rangeAudit[0]?.afterData).toMatchObject({
      riderId,
      teamId: teamAId,
      constructorId: ctorAId,
      fromGpId: gp2Id,
      seasonId: world.season.id,
      created: 2,
      skipped: 0,
    });
  });

  it("affiliations.setFrom salta y reporta los GPs con afiliación (no los sobreescribe)", async () => {
    const { market } = await callerFor(ADMIN_IP, adminToken);
    const report = await market.affiliations.setFrom({
      riderId,
      teamId: teamBId,
      fromGpId: gp2Id,
    });
    expect(report.created).toBe(0);
    expect(report.skipped).toHaveLength(2);
    expect(report.skipped.map((s) => s.round).sort((a, b) => a - b)).toEqual([2, 3]);
    expect(report.skipped[0]?.reason).toContain("ronda 2");
    expect(report.skipped[1]?.reason).toContain("ronda 3");

    // Sin sobreescribir: R2 y R3 siguen con el equipo A.
    const aff2 = await prisma.riderAffiliation.findUnique({
      where: { riderId_gpId: { riderId, gpId: gp2Id } },
    });
    const aff3 = await prisma.riderAffiliation.findUnique({
      where: { riderId_gpId: { riderId, gpId: gp3Id } },
    });
    expect(aff2?.teamId).toBe(teamAId);
    expect(aff3?.teamId).toBe(teamAId);

    // Sin `affiliation.set` nuevos (solo el resumen `affiliation.range_set`).
    expect(
      await prisma.auditLog.count({ where: { action: "affiliation.set", entityId: aff2?.id } }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({ where: { action: "affiliation.set", entityId: aff3?.id } }),
    ).toBe(1);
    const rangeAudit = await prisma.auditLog.findMany({
      where: { action: "affiliation.range_set", entityId: riderId },
    });
    expect(rangeAudit).toHaveLength(2);
    const second = rangeAudit.find(
      (a) => (a.afterData as { created?: number } | null)?.created === 0,
    );
    expect(second).toBeDefined();
    expect(second?.afterData).toMatchObject({
      teamId: teamBId,
      created: 0,
      skipped: 2,
    });
  });

  it("affiliations.setFrom con GP de inicio inexistente falla (NOT_FOUND)", async () => {
    const { market } = await callerFor(ADMIN_IP, adminToken);
    await expect(
      market.affiliations.setFrom({ riderId, teamId: teamAId, fromGpId: randomUUID() }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "El GP de inicio no existe.",
    });
  });

  // ── riders.get ────────────────────────────────────────────────────────────

  it("riders.get devuelve el piloto con sus afiliaciones ordenadas por ronda", async () => {
    const { market } = await callerFor(ADMIN_IP, adminToken);
    const detail = await market.riders.get({ riderId });
    expect(detail.rider).toMatchObject({ id: riderId, name: world.riders[0].name });
    expect(detail.affiliations.map((a) => a.gp.round)).toEqual([1, 2, 3]);
    expect(detail.affiliations[0]).toMatchObject({
      team: { id: teamBId },
      constructor: { id: ctorBId },
    });
    expect(detail.affiliations[1]).toMatchObject({
      team: { id: teamAId },
      constructor: { id: ctorAId },
    });
    expect(detail.affiliations[2]).toMatchObject({
      team: { id: teamAId },
      constructor: { id: ctorAId },
    });
  });

  it("riders.get con piloto inexistente falla (NOT_FOUND)", async () => {
    const { market } = await callerFor(ADMIN_IP, adminToken);
    await expect(market.riders.get({ riderId: randomUUID() })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "El piloto no existe.",
    });
  });
});
