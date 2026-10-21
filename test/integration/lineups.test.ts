/**
 * US-09 · Lineups: composición, coste, presupuesto y contabilidad de
 * cambios (PostgreSQL real).
 *
 * Mismo patrón que `market.test.ts`: los módulos de la app leen el entorno
 * al importar (singletons de Prisma y Redis), así que `DATABASE_URL` y
 * `REDIS_URL` se fijan ANTES del `import()` dinámico. El router `lineups`
 * es inyectable: se monta con la BD efímera.
 *
 * Criterios de aceptación (backlog US-09, ADR-0017):
 * - Composición exacta (2+2+1+1) con motivos en español; concentración
 *   (máx 2 por constructor y por equipo); piloto sin afiliación del GP.
 * - Coste recalculado SIEMPRE en el servidor con precios congelados del GP;
 *   coste ≤ presupuesto (coste = presupuesto aceptado; exceso →
 *   "excede el presupuesto por X"); activo sin precio congelado.
 * - unique `(user, gp)`; el primer save no consume cambios y escribe
 *   `base + carry + spend(−coste)` (carry desde el saldo del GP anterior).
 * - Saves posteriores: diff mínimo (swap/add/remove = 1 cambio; reasignar
 *   oro↔plata es gratis) + historial `lineup_changes` + `spend(−Δcoste)`.
 * - Capacidad de cambios por GP (2) y exención consumida al agotarla
 *   (`reason = "exencion:<id>"`, `usedAt`).
 * - Lockout: `status = locked ∨ now ≥ lockoutAt` → PRECONDITION_FAILED.
 * - GP inexistente → NOT_FOUND; temporada sin reglas → INTERNAL.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PROVISIONAL_SEASON_RULES } from "../../app/shared/config/season-rules";
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
const { createLineupsRouter } = await import("../../app/server/routers/lineups");
const { createContext } = await import("../../app/server/trpc");
const { InMemoryRateLimitStore } = await import("../../app/modules/identity");

const suffix = randomUUID().slice(0, 8);
const email = (name: string) => `${name}-${suffix}@test.local`;
const username = (name: string) => `${name}_${suffix}`;
const PASSWORD = "contraseña-segura-1";
const ADMIN_EMAIL = email("admin");
const USER_IP = "198.51.100.50";
const USER2_IP = "198.51.100.51";

describe("US-09 · Lineups: composición, coste y cambios (PostgreSQL real)", () => {
  let prisma: ReturnType<typeof createPrisma>;
  let authRouter: ReturnType<typeof createAuthRouter>;
  let lineupsRouter: ReturnType<typeof createLineupsRouter>;
  let world: World;
  let mariaId: string;
  let mariaToken: string;
  let carlosId: string;
  let carlosToken: string;
  let adminId: string;
  let adminToken: string;
  let ctorA: World["ctor"];
  let ctorBId: string;
  let teamA: World["team"];
  let teamBId: string;
  let riderXId: string; // afiliado a teamA/ctorA, SIN precio congelado
  let gp2Id: string;
  let gp3Id: string;
  let gp4Id: string;
  let gp5Id: string;
  let gp6Id: string;
  let gp7Id: string;
  let gpNoRulesId: string;
  let luisId: string;
  let luisToken: string;
  let saraToken: string;
  let pabloToken: string;

  type Rider = World["riders"][number];
  let r1: Rider;
  let r2: Rider;
  let r3: Rider;
  let r4: Rider;
  let r5: Rider;
  let r6: Rider;

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
    lineupsRouter = createLineupsRouter({ prisma });
    world = await seedWorld(prisma);
    [r1, r2, r3, r4, r5, r6] = world.riders;
    ctorA = world.ctor;
    teamA = world.team;

    ctorBId = (
      await prisma.constructor.create({
        data: { name: `Constructor Beta ${suffix}` },
      })
    ).id;
    teamBId = (
      await prisma.team.create({
        data: { name: `Equipo Beta ${suffix}`, constructorId: ctorBId },
      })
    ).id;
    riderXId = (
      await prisma.rider.create({ data: { name: `Piloto ${suffix}-X` } })
    ).id;

    // Reglas de la temporada (versión vigente: la más reciente).
    await prisma.seasonRule.create({
      data: {
        seasonId: world.season.id,
        version: "provisional-v1",
        rules: PROVISIONAL_SEASON_RULES,
      },
    });

    // Afiliaciones: teamA/ctorA = r1, r2, r5, riderX; teamB/ctorB = r3, r4;
    // r6 sin afiliación.
    const seedGpAffiliations = (gpId: string) =>
      prisma.$transaction([
        ...[
          world.riders[0].id,
          world.riders[1].id,
          world.riders[4].id,
          riderXId,
        ].map((riderId) =>
          prisma.riderAffiliation.create({
            data: {
              gpId,
              riderId,
              teamId: teamA.id,
              constructorId: ctorA.id,
            },
          }),
        ),
        ...[world.riders[2].id, world.riders[3].id].map((riderId) =>
          prisma.riderAffiliation.create({
            data: {
              gpId,
              riderId,
              teamId: teamBId,
              constructorId: ctorBId,
            },
          }),
        ),
      ]);
    await seedGpAffiliations(world.gp.id);
    await seedGpPrices(world.gp.id);

    // Rondas 2–5 (lockout, carry, coste anterior corrupto).
    const mkGp = (round: number, date: string) =>
      prisma.gp.create({
        data: {
          seasonId: world.season.id,
          round,
          name: `GP ${suffix} R${round}`,
          circuitId: world.gp.circuitId,
          date: new Date(date),
        },
      });
    gp2Id = (await mkGp(2, "2099-06-08T12:00:00Z")).id;
    gp3Id = (await mkGp(3, "2099-06-15T12:00:00Z")).id;
    gp4Id = (await mkGp(4, "2099-06-22T12:00:00Z")).id;
    gp5Id = (await mkGp(5, "2099-06-29T12:00:00Z")).id;
    gp6Id = (await mkGp(6, "2099-07-06T12:00:00Z")).id;
    gp7Id = (await mkGp(7, "2099-07-13T12:00:00Z")).id;
    await seedGpAffiliations(gp4Id);
    await seedGpAffiliations(gp5Id);
    await seedGpAffiliations(gp6Id);
    await seedGpAffiliations(gp7Id);
    await seedGpPrices(gp4Id);
    await seedGpPrices(gp5Id);
    await seedGpPrices(gp6Id);
    await seedGpPrices(gp7Id);

    // Temporada sin reglas publicadas (rama INTERNAL de latestRules).
    const season2 = await prisma.season.create({
      data: { name: `Temporada sin reglas ${suffix}`, year: 2098 },
    });
    const circuit2 = await prisma.circuit.create({
      data: { name: `Circuito sin reglas ${suffix}`, country: "Ficticia" },
    });
    gpNoRulesId = (
      await prisma.gp.create({
        data: {
          seasonId: season2.id,
          round: 1,
          name: `GP sin reglas ${suffix}`,
          circuitId: circuit2.id,
          date: new Date("2098-06-01T12:00:00Z"),
        },
      })
    ).id;

    // Usuarios (sesiones reales vía router de auth).
    const mariaCaller = await callerFor(USER_IP);
    await mariaCaller.auth.register({
      email: email("maria"),
      username: username("maria"),
      password: PASSWORD,
      termsAccepted: true,
    });
    mariaToken = sessionTokenFrom(mariaCaller.ctx);
    const mariaUser = await prisma.user.findUnique({
      where: { email: email("maria") },
    });
    if (!mariaUser) throw new Error("no se pudo registrar maria");
    mariaId = mariaUser.id;

    const carlosCaller = await callerFor(USER2_IP);
    await carlosCaller.auth.register({
      email: email("carlos"),
      username: username("carlos"),
      password: PASSWORD,
      termsAccepted: true,
    });
    carlosToken = sessionTokenFrom(carlosCaller.ctx);
    const carlosUser = await prisma.user.findUnique({
      where: { email: email("carlos") },
    });
    if (!carlosUser) throw new Error("no se pudo registrar carlos");
    carlosId = carlosUser.id;

    // Usuarios adicionales para las ramas de US-12 (wildcard/save/get).
    const luisCaller = await callerFor("198.51.100.60");
    await luisCaller.auth.register({
      email: email("luis"),
      username: username("luis"),
      password: PASSWORD,
      termsAccepted: true,
    });
    luisToken = sessionTokenFrom(luisCaller.ctx);
    const luisUser = await prisma.user.findUnique({ where: { email: email("luis") } });
    if (!luisUser) throw new Error("no se pudo registrar luis");
    luisId = luisUser.id;

    const saraCaller = await callerFor("198.51.100.61");
    await saraCaller.auth.register({
      email: email("sara"),
      username: username("sara"),
      password: PASSWORD,
      termsAccepted: true,
    });
    saraToken = sessionTokenFrom(saraCaller.ctx);

    const pabloCaller = await callerFor("198.51.100.62");
    await pabloCaller.auth.register({
      email: email("pablo"),
      username: username("pablo"),
      password: PASSWORD,
      termsAccepted: true,
    });
    pabloToken = sessionTokenFrom(pabloCaller.ctx);

    // Admin global (bootstrap, ADR-0010) para las acciones de US-12.
    const adminCaller = await callerFor("192.0.2.100");
    await adminCaller.auth.register({
      email: ADMIN_EMAIL,
      username: username("admin"),
      password: PASSWORD,
      termsAccepted: true,
    });
    adminToken = sessionTokenFrom(adminCaller.ctx);
    const adminUser = await prisma.user.findUnique({
      where: { email: ADMIN_EMAIL },
    });
    if (!adminUser) throw new Error("no se pudo registrar el admin");
    adminId = adminUser.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Contexto tRPC para una petición simulada (IP + cookie de sesión opcional). */
  async function callerFor(ip: string, sessionToken?: string) {
    const headers: Record<string, string> = { "x-forwarded-for": ip };
    if (sessionToken !== undefined) headers.cookie = `session=${sessionToken}`;
    const req = new Request("http://localhost/api/trpc/lineups", {
      method: "POST",
      headers,
    });
    const ctx = await createContext(req, prisma);
    return {
      ctx,
      auth: authRouter.createCaller(ctx),
      lineups: lineupsRouter.createCaller(ctx),
    };
  }

  /** Extrae el token de la cookie de sesión emitida en `ctx.pendingCookies`. */
  function sessionTokenFrom(ctx: { pendingCookies: string[] }): string {
    expect(ctx.pendingCookies).toHaveLength(1);
    const token = /^session=([0-9a-f]{64});/.exec(ctx.pendingCookies[0] ?? "")?.[1];
    if (!token) throw new Error(`Cookie de sesión inesperada: ${ctx.pendingCookies[0]}`);
    return token;
  }

  /** Precios congelados de un GP (riderX sin precio: rama "sin precio"). */
  async function seedGpPrices(gpId: string) {
    await prisma.price.createMany({
      data: [
        { gpId, assetType: "rider", assetId: world.riders[0].id, price: 10 },
        { gpId, assetType: "rider", assetId: world.riders[1].id, price: 15 },
        { gpId, assetType: "rider", assetId: world.riders[2].id, price: 20 },
        { gpId, assetType: "rider", assetId: world.riders[3].id, price: 25 },
        { gpId, assetType: "rider", assetId: world.riders[4].id, price: 35 },
        { gpId, assetType: "constructor", assetId: ctorA.id, price: 5 },
        { gpId, assetType: "constructor", assetId: ctorBId, price: 30 },
        { gpId, assetType: "team", assetId: teamA.id, price: 5 },
        { gpId, assetType: "team", assetId: teamBId, price: 5.01 },
      ],
    });
  }

  /** Input de `lineups.save` (slots: 2 oro, 2 plata, 1 constructor, 1 equipo). */
  function lineupInput(
    gpId: string,
    gold: string[],
    silver: string[],
    constructorId: string,
    teamId: string,
  ) {
    return { gpId, slots: { gold, silver, constructorId, teamId } };
  }

  /** Importes de los movimientos de un tipo (ordenados, para asserts). */
  function amountsByType(
    movements: { type: string; amount: unknown }[],
    type: string,
  ): number[] {
    return movements
      .filter((m) => m.type === type)
      .map((m) => Number(m.amount))
      .sort((a, b) => a - b);
  }

  /** Movimientos de presupuesto de un usuario en un GP. */
  async function movementsOf(userId: string, gpId: string) {
    return prisma.budgetMovement.findMany({
      where: { userId, gpId },
      select: { type: true, amount: true, reference: true, rulesVersion: true },
    });
  }

  it("rechaza sin sesión (UNAUTHORIZED)", async () => {
    const { lineups } = await callerFor(USER_IP);
    await expect(lineups.get({ gpId: world.gp.id })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("get devuelve null si el usuario aún no ha guardado el lineup", async () => {
    const { lineups } = await callerFor(USER_IP, mariaToken);
    const view = await lineups.get({ gpId: world.gp.id });
    expect(view).toBeNull();
  });

  it("primer save: crea el lineup, movimientos base+carry+spend y no consume cambios", async () => {
    const { lineups } = await callerFor(USER_IP, mariaToken);
    const result = await lineups.save(
      lineupInput(world.gp.id, [r1.id, r2.id], [r3.id, r4.id], ctorA.id, teamA.id),
    );
    expect(result).toMatchObject({
      gpId: world.gp.id,
      cost: 80,
      budget: 100,
      balance: 20,
      changesApplied: 0,
      remainingChanges: 2,
      firstSave: true,
    });

    const lineup = await prisma.lineup.findUnique({
      where: { userId_gpId: { userId: mariaId, gpId: world.gp.id } },
      include: { slots: true },
    });
    expect(lineup).not.toBeNull();
    const lineupId = lineup!.id;
    const expectedSlots = [
      `constructor:${ctorA.id}`,
      `gold:${r1.id}`,
      `gold:${r2.id}`,
      `silver:${r3.id}`,
      `silver:${r4.id}`,
      `team:${teamA.id}`,
    ].sort();
    expect(lineup!.slots.map((s) => `${s.slotType}:${s.assetId}`).sort()).toEqual(
      expectedSlots,
    );

    const movements = await movementsOf(mariaId, world.gp.id);
    expect(movements).toHaveLength(3);
    for (const m of movements) {
      expect(m.reference).toBe(lineupId);
      expect(m.rulesVersion).toBe("provisional-v1");
    }
    expect(amountsByType(movements, "base")).toEqual([100]);
    expect(amountsByType(movements, "carry")).toEqual([0]);
    expect(amountsByType(movements, "spend")).toEqual([-80]);

    const view = await lineups.get({ gpId: world.gp.id });
    expect(view).toMatchObject({
      gpId: world.gp.id,
      cost: 80,
      budget: 100,
      balance: 20,
      usedChanges: 0,
      remainingChanges: 2,
    });
    expect(view!.slots).toMatchObject({
      gold: [r1.id, r2.id],
      silver: [r3.id, r4.id],
      constructorId: ctorA.id,
      teamId: teamA.id,
    });
  });

  it("rechaza composición inexacta con motivos en español", async () => {
    const { lineups } = await callerFor(USER_IP, mariaToken);
    await expect(
      lineups.save(lineupInput(world.gp.id, [r1.id], [r3.id, r4.id], ctorA.id, teamA.id)),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "El lineup debe tener exactamente 2 pilotos oro (tiene 1)",
    });
  });

  it("rechaza concentración excedida (máx 2 por constructor y por equipo)", async () => {
    const { lineups } = await callerFor(USER_IP, mariaToken);
    const err = await lineups
      .save(lineupInput(world.gp.id, [r1.id, r2.id], [r5.id, r3.id], ctorA.id, teamA.id))
      .catch((e) => e);
    expect(err).toMatchObject({ code: "BAD_REQUEST" });
    expect(err.message).toContain("Concentración excedida: 3 pilotos del constructor");
    expect(err.message).toContain("Concentración excedida: 3 pilotos del equipo");
  });

  it("rechaza un piloto sin afiliación para el GP", async () => {
    const { lineups } = await callerFor(USER_IP, mariaToken);
    await expect(
      lineups.save(lineupInput(world.gp.id, [r1.id, r6.id], [r3.id, r4.id], ctorA.id, teamA.id)),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: `El piloto ${r6.id} no tiene afiliación para este GP`,
    });
  });

  it("rechaza activos sin precio congelado para el GP", async () => {
    const { lineups } = await callerFor(USER_IP, mariaToken);
    await expect(
      lineups.save(
        lineupInput(world.gp.id, [r1.id, riderXId], [r3.id, r4.id], ctorA.id, teamA.id),
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: `Activos sin precio congelado para este GP: rider ${riderXId}.`,
    });
  });

  it("únicamente un lineup por (usuario, GP) — unique de BD", async () => {
    await expect(
      prisma.lineup.create({ data: { userId: mariaId, gpId: world.gp.id } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("save posterior: coste = presupuesto aceptado, diff mínimo + spend(−Δ) + historial", async () => {
    const { lineups } = await callerFor(USER_IP, mariaToken);
    const result = await lineups.save(
      lineupInput(world.gp.id, [r1.id, r5.id], [r3.id, r4.id], ctorA.id, teamA.id),
    );
    expect(result).toMatchObject({
      cost: 100,
      budget: 100,
      balance: 0,
      changesApplied: 1,
      remainingChanges: 1,
      firstSave: false,
    });

    const changes = await prisma.lineupChange.findMany({
      where: { userId: mariaId, gpId: world.gp.id },
    });
    expect(changes).toHaveLength(1);
    const change = changes[0];
    if (!change) throw new Error("falta el cambio en el historial");
    expect(change).toMatchObject({
      type: "swap",
      assetType: "rider",
      assetId: r5.id,
      reason: null,
      userId: mariaId,
    });
    expect(Number(change.costBefore)).toBe(80);
    expect(Number(change.costAfter)).toBe(100);

    const movements = await movementsOf(mariaId, world.gp.id);
    expect(amountsByType(movements, "spend")).toEqual([-80, -20]);

    const view = await lineups.get({ gpId: world.gp.id });
    expect(view).toMatchObject({
      cost: 100,
      budget: 100,
      balance: 0,
      usedChanges: 1,
      remainingChanges: 1,
    });
  });

  it("rechaza el lineup que excede el presupuesto por 0.01", async () => {
    const { lineups } = await callerFor(USER_IP, mariaToken);
    await expect(
      lineups.save(
        lineupInput(world.gp.id, [r1.id, r5.id], [r3.id, r4.id], ctorA.id, teamBId),
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "El lineup excede el presupuesto por 0.01 (coste 100.01, presupuesto 100).",
    });
  });

  it("reasignar oro↔plata es gratis (0 cambios, entradas gold_silver, sin movimientos)", async () => {
    const { lineups } = await callerFor(USER_IP, mariaToken);
    const result = await lineups.save(
      lineupInput(world.gp.id, [r1.id, r3.id], [r5.id, r4.id], ctorA.id, teamA.id),
    );
    expect(result).toMatchObject({
      cost: 100,
      balance: 0,
      changesApplied: 0,
      remainingChanges: 1,
      firstSave: false,
    });
    // 1 swap previo + 2 reasignaciones oro↔plata (r3 y r5 cambian de tier).
    const rows = await prisma.lineupChange.findMany({
      where: { userId: mariaId, gpId: world.gp.id },
    });
    expect(rows).toHaveLength(3);
    const gs = rows.filter((c) => c.type === "gold_silver");
    expect(gs.map((c) => c.assetId).sort()).toEqual([r3.id, r5.id].sort());
    for (const row of gs) {
      expect(row).toMatchObject({ assetType: "rider", reason: null });
      expect(Number(row.costBefore)).toBe(100);
      expect(Number(row.costAfter)).toBe(100);
    }
    const movements = await movementsOf(mariaId, world.gp.id);
    expect(amountsByType(movements, "spend")).toEqual([-80, -20]);
  });

  it("agota la capacidad de cambios del GP (2) y rechaza el tercero", async () => {
    const { lineups } = await callerFor(USER_IP, mariaToken);

    // Segundo cambio: swap r5→r2 (coste 100 → 80, devolución +20).
    const cheap = await lineups.save(
      lineupInput(world.gp.id, [r1.id, r3.id], [r2.id, r4.id], ctorA.id, teamA.id),
    );
    expect(cheap).toMatchObject({
      cost: 80,
      balance: 20,
      changesApplied: 1,
      remainingChanges: 0,
    });
    const movements = await movementsOf(mariaId, world.gp.id);
    expect(amountsByType(movements, "spend")).toEqual([-80, -20, 20]);

    // Tercer cambio (r2→r5): sin capacidad ni exención → rechazado.
    await expect(
      lineups.save(lineupInput(world.gp.id, [r1.id, r3.id], [r5.id, r4.id], ctorA.id, teamA.id)),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "No te quedan cambios para este GP; usa tu wildcard.",
    });
  });

  it("consume la exención por lesión al agotar los cambios (reason + usedAt)", async () => {
    const injury = await prisma.injuryConfirmation.create({
      data: {
        gpId: world.gp.id,
        assetType: "rider",
        assetId: r5.id,
        confirmedBy: world.user.id,
      },
    });
    const exemption = await prisma.changeExemption.create({
      data: {
        userId: mariaId,
        gpId: world.gp.id,
        injuryConfirmationId: injury.id,
      },
    });

    const { lineups } = await callerFor(USER_IP, mariaToken);
    const result = await lineups.save(
      lineupInput(world.gp.id, [r1.id, r3.id], [r5.id, r4.id], ctorA.id, teamA.id),
    );
    expect(result).toMatchObject({
      cost: 100,
      balance: 0,
      changesApplied: 1,
      remainingChanges: 0,
    });

    // 5 filas: swap r5 + 2 gold_silver (r3, r5) + swap r2 + swap r5 (exención).
    const changes = await prisma.lineupChange.findMany({
      where: { userId: mariaId, gpId: world.gp.id },
    });
    expect(changes).toHaveLength(5);
    const withExemption = changes.find(
      (c) => c.reason === `exencion:${exemption.id}`,
    );
    if (!withExemption) throw new Error("falta el cambio con exención");
    expect(withExemption).toMatchObject({ type: "swap", assetId: r5.id });
    expect(Number(withExemption.costBefore)).toBe(80);
    expect(Number(withExemption.costAfter)).toBe(100);

    const used = await prisma.changeExemption.findUnique({ where: { id: exemption.id } });
    expect(used?.usedAt).not.toBeNull();
  });

  it("US-11: reasignar oro↔plata durante el lockout se bloquea (motivo explícito)", async () => {
    const { lineups } = await callerFor(USER_IP, mariaToken);
    // María tiene lineup en el GP1 (oro [r1, r3], plata [r5, r4]).
    // Cerramos el GP: la reasignación (0 cambios) tampoco puede pasar.
    await prisma.gp.update({ where: { id: world.gp.id }, data: { status: "locked" } });
    try {
      await expect(
        lineups.save(
          lineupInput(world.gp.id, [r1.id, r5.id], [r3.id, r4.id], ctorA.id, teamA.id),
        ),
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: "El GP está cerrado (lockout): no se pueden guardar lineups.",
      });
    } finally {
      // Restaura el estado para el resto de la suite.
      await prisma.gp.update({
        where: { id: world.gp.id },
        data: { status: "scheduled" },
      });
    }
  });

  it("US-10: el builder expone el presupuesto (base + carry) antes del primer save", async () => {
    const { lineups } = await callerFor(USER2_IP, carlosToken);
    // Primer GP de carlos (sin saldo previo) → carry 0.
    const view = await lineups.builder({ gpId: gp4Id });
    expect(view.budget).toEqual({ base: 100, carry: 0, total: 100 });
  });

  it("carry: el presupuesto del GP siguiente suma min(t·sin_usar, cmax) del saldo previo", async () => {
    const { lineups } = await callerFor(USER2_IP, carlosToken);

    // GP4 (round 4): primer save, coste 80 → saldo 20.
    const first = await lineups.save(
      lineupInput(gp4Id, [r1.id, r2.id], [r3.id, r4.id], ctorA.id, teamA.id),
    );
    expect(first).toMatchObject({ cost: 80, budget: 100, balance: 20, firstSave: true });

    // US-10: antes del primer save del GP5, el builder ya expone el
    // presupuesto (base + carry) que el servidor validará.
    const view = await lineups.builder({ gpId: gp5Id });
    expect(view.budget).toEqual({ base: 100, carry: 5, total: 105 });

    // Anti-ratchet (invariante 8): el precio de r1 (activo de carlos en
    // GP4) sube en el mercado del GP5 → el presupuesto NO cambia.
    const priceRow = await prisma.price.findFirst({
      where: { gpId: gp5Id, assetType: "rider", assetId: r1.id },
    });
    if (!priceRow) throw new Error("falta el precio de r1 en el GP5");
    await prisma.price.update({ where: { id: priceRow.id }, data: { price: 40 } });
    const viewAfter = await lineups.builder({ gpId: gp5Id });
    expect(viewAfter.budget).toEqual({ base: 100, carry: 5, total: 105 });
    // Restaura el precio (el save de abajo espera coste 100).
    await prisma.price.update({ where: { id: priceRow.id }, data: { price: 10 } });

    // GP5 (round 5): presupuesto = 100 + min(0.25·20, 8) = 105 (mismo
    // valor que el builder: US-10 "mismo input → mismo valor").
    const second = await lineups.save(
      lineupInput(gp5Id, [r1.id, r3.id], [r5.id, r4.id], ctorA.id, teamA.id),
    );
    expect(second).toMatchObject({ cost: 100, budget: 105, balance: 5, firstSave: true });

    const movements = await movementsOf(carlosId, gp5Id);
    expect(movements).toHaveLength(3);
    expect(amountsByType(movements, "base")).toEqual([100]);
    expect(amountsByType(movements, "carry")).toEqual([5]);
    expect(amountsByType(movements, "spend")).toEqual([-100]);
  });

  it("rechaza (INTERNAL) si el lineup actual perdió sus precios congelados", async () => {
    const priceRow = await prisma.price.findFirst({
      where: { gpId: gp5Id, assetType: "rider", assetId: r1.id },
    });
    if (!priceRow) throw new Error("falta el precio de r1 en el GP5");
    await prisma.price.delete({ where: { id: priceRow.id } });

    const { lineups } = await callerFor(USER2_IP, carlosToken);
    // Nuevo lineup válido y dentro de presupuesto (105 = 105), pero el
    // lineup actual incluye a r1, cuyo precio ya no existe → costBefore falla.
    await expect(
      lineups.save(lineupInput(gp5Id, [r2.id, r3.id], [r5.id, r4.id], ctorA.id, teamA.id)),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "El lineup actual no tiene precios congelados para este GP; contacta con el administrador.",
    });

    // Restaura el precio para no contaminar el resto de la suite.
    await prisma.price.create({
      data: { gpId: gp5Id, assetType: "rider", assetId: r1.id, price: 10 },
    });
  });

  it("lockout por status=locked: PRECONDITION_FAILED antes de cualquier validación", async () => {
    await prisma.gp.update({ where: { id: gp2Id }, data: { status: "locked" } });
    const { lineups } = await callerFor(USER_IP, mariaToken);
    await expect(
      lineups.save(lineupInput(gp2Id, [r1.id, r2.id], [r3.id, r4.id], ctorA.id, teamA.id)),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "El GP está cerrado (lockout): no se pueden guardar lineups.",
    });
  });

  it("lockout por lockoutAt pasado: PRECONDITION_FAILED", async () => {
    await prisma.gp.update({
      where: { id: gp3Id },
      data: { lockoutAt: new Date(Date.now() - 3600_000) },
    });
    const { lineups } = await callerFor(USER_IP, mariaToken);
    await expect(
      lineups.save(lineupInput(gp3Id, [r1.id, r2.id], [r3.id, r4.id], ctorA.id, teamA.id)),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "El GP está cerrado (lockout): no se pueden guardar lineups.",
    });
  });

  it("GP inexistente: NOT_FOUND", async () => {
    const { lineups } = await callerFor(USER_IP, mariaToken);
    await expect(
      lineups.save(lineupInput(randomUUID(), [r1.id, r2.id], [r3.id, r4.id], ctorA.id, teamA.id)),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "El GP no existe.",
    });
  });

  it("temporada sin reglas publicadas: INTERNAL_SERVER_ERROR", async () => {
    const { lineups } = await callerFor(USER_IP, mariaToken);
    await expect(
      lineups.save(
        lineupInput(gpNoRulesId, [r1.id, r2.id], [r3.id, r4.id], ctorA.id, teamA.id),
      ),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "La temporada no tiene reglas publicadas.",
    });
  });

  it("builder: pilotos con afiliación y precio, constructores y equipos", async () => {
    const { lineups } = await callerFor(USER_IP, mariaToken);
    const view = await lineups.builder({ gpId: world.gp.id });
    expect(view.gp).toMatchObject({
      id: world.gp.id,
      name: world.gp.name,
      round: 1,
      status: "scheduled",
    });
    // US-10: presupuesto del usuario (maria ya guardó el GP1: base + carry).
    expect(view.budget).toEqual({ base: 100, carry: 0, total: 100 });
    expect(view.riders).toHaveLength(6); // r1..r5 + riderX (r6 sin afiliación)
    const r1row = view.riders.find((r) => r.riderId === r1.id);
    expect(r1row).toMatchObject({
      name: r1.name,
      price: 10,
      teamId: teamA.id,
      constructorId: ctorA.id,
    });
    const xrow = view.riders.find((r) => r.riderId === riderXId);
    expect(xrow?.price).toBeNull();
    // La BD de integración es compartida entre suites (market crea más
    // constructores/equipos): se verifica por lookup, no por count.
    const ctorArow = view.constructors.find((c) => c.id === ctorA.id);
    expect(ctorArow).toMatchObject({ name: ctorA.name, price: 5 });
    const ctorBrow = view.constructors.find((c) => c.id === ctorBId);
    expect(ctorBrow).toMatchObject({ price: 30 });
    const teamArow = view.teams.find((t) => t.id === teamA.id);
    expect(teamArow).toMatchObject({ constructorId: ctorA.id, price: 5 });
    const teamBrow = view.teams.find((t) => t.id === teamBId);
    expect(teamBrow).toMatchObject({ constructorId: ctorBId, price: 5.01 });
  });

  it("builder: GP inexistente → NOT_FOUND", async () => {
    const { lineups } = await callerFor(USER_IP, mariaToken);
    await expect(lineups.builder({ gpId: randomUUID() })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "El GP no existe.",
    });
  });

  // ── US-12: lesiones, wildcard e historial ─────────────────────────────────

  it("US-12: confirmInjury concede +1 cambio a los usuarios afectados (admin, auditado)", async () => {
    const { lineups } = await callerFor("192.0.2.100", adminToken);
    // María tiene r1 en su lineup de GP1 (oro [r1, r3], plata [r5, r4]).
    const result = await lineups.confirmInjury({
      gpId: world.gp.id,
      assetId: r1.id,
      reason: "Lesión confirmada",
    });
    expect(result.confirmationId).toBeDefined();
    expect(result.exemptionsGranted).toBeGreaterThanOrEqual(1);

    // Auditoría: injury.confirmed.
    const audit = await prisma.auditLog.findFirst({
      where: { action: "injury.confirmed", entityId: result.confirmationId },
    });
    expect(audit).toMatchObject({
      actorId: adminId,
      afterData: { gpId: world.gp.id, assetId: r1.id },
    });

    // Exención concedida a María.
    const exemption = await prisma.changeExemption.findFirst({
      where: { userId: mariaId, gpId: world.gp.id, injuryConfirmationId: result.confirmationId },
    });
    expect(exemption).not.toBeNull();
    expect(exemption?.usedAt).toBeNull();

    // Idempotencia: confirmar de nuevo no re-concede.
    const result2 = await lineups.confirmInjury({
      gpId: world.gp.id,
      assetId: r1.id,
    });
    expect(result2.confirmationId).toBe(result.confirmationId);
    expect(result2.exemptionsGranted).toBe(0);
  });

  it("US-12: wildcard resetea el lineup sin consumir cambios (1/temporada)", async () => {
    const { lineups } = await callerFor(USER2_IP, carlosToken);
    // Carlos tiene lineup en GP4 (oro [r1, r2], plata [r3, r4]).
    // Wildcard: reset a un lineup diferente (oro [r3, r4], plata [r1, r2]).
    const result = await lineups.wildcard(
      lineupInput(gp4Id, [r3.id, r4.id], [r1.id, r2.id], ctorA.id, teamA.id),
    );
    expect(result).toMatchObject({
      cost: 80,
      budget: 100,
      wildcardUsed: true,
    });

    // Entrada wildcard en el historial.
    const change = await prisma.lineupChange.findFirst({
      where: { userId: carlosId, gpId: gp4Id, type: "wildcard" },
    });
    expect(change).not.toBeNull();
    expect(Number(change?.costBefore)).toBe(80);
    expect(Number(change?.costAfter)).toBe(80);
    expect(change?.assetType).toBeNull();
    expect(change?.assetId).toBeNull();

    // El lineup se reseteó (oro [r3, r4], plata [r1, r2]).
    const view = await lineups.get({ gpId: gp4Id });
    expect(view?.slots.gold).toEqual([r3.id, r4.id]);
    expect(view?.slots.silver).toEqual([r1.id, r2.id]);

    // Segunda wildcard: rechazada (1/temporada).
    await expect(
      lineups.wildcard(
        lineupInput(gp4Id, [r1.id, r2.id], [r3.id, r4.id], ctorA.id, teamA.id),
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Ya usaste tu wildcard esta temporada.",
    });
  });

  it("US-12: historial muestra los cambios (quién/cuándo/qué/coste antes-después)", async () => {
    const { lineups } = await callerFor(USER_IP, mariaToken);
    const history = await lineups.history({ gpId: world.gp.id });
    expect(history.length).toBeGreaterThanOrEqual(1);

    // El primer cambio (swap r2→r5) debe estar en el historial.
    const swap = history.find((c) => c.type === "swap" && c.assetId === r5.id);
    expect(swap).toMatchObject({
      costBefore: 80,
      costAfter: 100,
    });
    expect(swap?.createdAt).toBeInstanceOf(Date);

    // Las reasignaciones oro↔plata (gratis) también quedan registradas.
    const gs = history.filter((c) => c.type === "gold_silver");
    expect(gs.map((c) => c.assetId).sort()).toEqual([r3.id, r5.id].sort());
    for (const row of gs) {
      expect(row).toMatchObject({
        assetType: "rider",
        costBefore: 100,
        costAfter: 100,
        reason: null,
      });
    }
  });

  it("US-12: history GP inexistente → NOT_FOUND", async () => {
    const { lineups } = await callerFor(USER_IP, mariaToken);
    await expect(lineups.history({ gpId: randomUUID() })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "El GP no existe.",
    });
  });

  // ── US-12: ramas de error de confirmInjury / wildcard / save / get ──────

  it("US-12: confirmInjury GP inexistente → NOT_FOUND (admin)", async () => {
    const { lineups } = await callerFor("192.0.2.100", adminToken);
    await expect(
      lineups.confirmInjury({ gpId: randomUUID(), assetId: r1.id }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "El GP no existe.",
    });
  });

  it("US-12: confirmInjury piloto inexistente → NOT_FOUND (admin)", async () => {
    const { lineups } = await callerFor("192.0.2.100", adminToken);
    await expect(
      lineups.confirmInjury({ gpId: world.gp.id, assetId: randomUUID() }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "El piloto no existe.",
    });
  });

  it("US-12: confirmInjury sin usuarios afectados → 0 exenciones (admin)", async () => {
    const { lineups } = await callerFor("192.0.2.100", adminToken);
    // r6 no está en ningún lineup del GP1 (sin afiliación).
    const result = await lineups.confirmInjury({
      gpId: world.gp.id,
      assetId: r6.id,
      reason: "Piloto ausente",
    });
    expect(result.exemptionsGranted).toBe(0);
    expect(result.confirmationId).toBeDefined();
  });

  it("US-12: wildcard GP inexistente → NOT_FOUND", async () => {
    const { lineups } = await callerFor("198.51.100.60", luisToken);
    await expect(
      lineups.wildcard(
        lineupInput(randomUUID(), [r1.id, r2.id], [r3.id, r4.id], ctorA.id, teamA.id),
      ),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "El GP no existe.",
    });
  });

  it("US-12: wildcard en GP cerrado (lockout) → PRECONDITION_FAILED", async () => {
    const { lineups } = await callerFor("198.51.100.60", luisToken);
    await expect(
      lineups.wildcard(
        lineupInput(gp2Id, [r1.id, r2.id], [r3.id, r4.id], ctorA.id, teamA.id),
      ),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "El GP está cerrado (lockout): no se pueden guardar lineups.",
    });
  });

  it("US-12: wildcard con composición inválida → BAD_REQUEST (motivos en español)", async () => {
    const { lineups } = await callerFor(USER_IP, mariaToken);
    await expect(
      lineups.wildcard(
        lineupInput(world.gp.id, [r1.id, r2.id, r3.id], [r4.id], ctorA.id, teamA.id),
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("exactamente 2 pilotos oro"),
    });
  });

  it("US-12: wildcard con piloto sin precio congelado → BAD_REQUEST", async () => {
    const { lineups } = await callerFor("198.51.100.60", luisToken);
    await expect(
      lineups.wildcard(
        lineupInput(gp6Id, [r1.id, riderXId], [r3.id, r4.id], ctorA.id, teamA.id),
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("sin precio congelado"),
    });
  });

  it("US-12: wildcard primer save excede el presupuesto → BAD_REQUEST", async () => {
    const { lineups } = await callerFor("198.51.100.60", luisToken);
    await expect(
      lineups.wildcard(
        lineupInput(gp6Id, [r5.id, r2.id], [r3.id, r4.id], ctorBId, teamBId),
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("excede el presupuesto"),
    });
  });

  it("US-12: wildcard primer save crea el lineup (costBefore=0, movimientos base+carry+spend)", async () => {
    const { lineups } = await callerFor("198.51.100.60", luisToken);
    const result = await lineups.wildcard(
      lineupInput(gp6Id, [r1.id, r2.id], [r3.id, r4.id], ctorA.id, teamA.id),
    );
    expect(result).toMatchObject({
      cost: 80,
      budget: 100,
      balance: 20,
      wildcardUsed: true,
    });

    // Lineup creado con los slots indicados.
    const lineup = await prisma.lineup.findUnique({
      where: { userId_gpId: { userId: luisId, gpId: gp6Id } },
      include: { slots: true },
    });
    expect(lineup).not.toBeNull();
    expect(lineup!.slots.map((s) => `${s.slotType}:${s.assetId}`).sort()).toEqual([
      `constructor:${ctorA.id}`,
      `gold:${r1.id}`,
      `gold:${r2.id}`,
      `silver:${r3.id}`,
      `silver:${r4.id}`,
      `team:${teamA.id}`,
    ].sort());

    // Movimientos base + carry + spend(−coste).
    const movements = await movementsOf(luisId, gp6Id);
    expect(amountsByType(movements, "base")).toEqual([100]);
    expect(amountsByType(movements, "carry")).toEqual([0]);
    expect(amountsByType(movements, "spend")).toEqual([-80]);

    // Entrada wildcard con costBefore=0.
    const change = await prisma.lineupChange.findFirst({
      where: { userId: luisId, gpId: gp6Id, type: "wildcard" },
    });
    expect(change).not.toBeNull();
    expect(Number(change?.costBefore)).toBe(0);
    expect(Number(change?.costAfter)).toBe(80);
  });

  it("US-12: wildcard existente excede el presupuesto → BAD_REQUEST", async () => {
    const { lineups } = await callerFor(USER_IP, mariaToken);
    await expect(
      lineups.wildcard(
        lineupInput(world.gp.id, [r5.id, r2.id], [r3.id, r4.id], ctorBId, teamBId),
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("excede el presupuesto"),
    });
  });

  it("US-12: get y wildcard rechazan si el lineup actual perdió precios (INTERNAL)", async () => {
    const { lineups } = await callerFor("198.51.100.61", saraToken);
    // Sara first-saves gp7 (coste 100 = presupuesto).
    await lineups.save(
      lineupInput(gp7Id, [r1.id, r5.id], [r3.id, r4.id], ctorA.id, teamA.id),
    );
    // El lineup actual incluye a r5; se elimina su precio congelado.
    const priceRow = await prisma.price.findFirst({
      where: { gpId: gp7Id, assetType: "rider", assetId: r5.id },
    });
    if (!priceRow) throw new Error("falta el precio de r5 en gp7");
    await prisma.price.delete({ where: { id: priceRow.id } });

    // get → INTERNAL (el lineup no tiene precios congelados).
    await expect(lineups.get({ gpId: gp7Id })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "El lineup no tiene precios congelados para su GP; contacta con el administrador.",
    });

    // wildcard → costBefore falla (lineup actual sin precio) → INTERNAL.
    await expect(
      lineups.wildcard(
        lineupInput(gp7Id, [r1.id, r2.id], [r3.id, r4.id], ctorA.id, teamA.id),
      ),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "El lineup actual no tiene precios congelados para este GP; contacta con el administrador.",
    });

    // Restaura el precio para no contaminar el resto de la suite.
    await prisma.price.create({
      data: { gpId: gp7Id, assetType: "rider", assetId: r5.id, price: 35 },
    });
  });

  it("US-12: wildcard existente con Δcoste escribe movimiento spend (costBefore→costAfter)", async () => {
    const { lineups } = await callerFor(USER_IP, mariaToken);
    // Lineup actual de María en GP1: oro [r1, r3], plata [r5, r4] (coste 100).
    // Wildcard a oro [r1, r2], plata [r3, r4] (coste 80) → Δ = −20.
    const result = await lineups.wildcard(
      lineupInput(world.gp.id, [r1.id, r2.id], [r3.id, r4.id], ctorA.id, teamA.id),
    );
    expect(result).toMatchObject({
      cost: 80,
      budget: 100,
      balance: 20,
      wildcardUsed: true,
    });

    // Movimiento spend(−Δ) = +20 (se libera presupuesto).
    const movements = await movementsOf(mariaId, world.gp.id);
    const spends = amountsByType(movements, "spend");
    expect(spends).toContain(-80); // spend original del primer save
    expect(spends).toContain(20); // movimiento del wildcard (100 → 80)

    // Entrada wildcard con costBefore=100, costAfter=80.
    const change = await prisma.lineupChange.findFirst({
      where: { userId: mariaId, gpId: world.gp.id, type: "wildcard" },
    });
    expect(change).not.toBeNull();
    expect(Number(change?.costBefore)).toBe(100);
    expect(Number(change?.costAfter)).toBe(80);
  });

  it("US-12: save primer save excede el presupuesto → BAD_REQUEST", async () => {
    const { lineups } = await callerFor("198.51.100.62", pabloToken);
    await expect(
      lineups.save(
        lineupInput(gp6Id, [r5.id, r2.id], [r3.id, r4.id], ctorBId, teamBId),
      ),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("excede el presupuesto"),
    });
  });
});
