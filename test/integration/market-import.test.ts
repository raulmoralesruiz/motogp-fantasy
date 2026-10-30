/**
 * US-06/ADR-0013 + ADR-0014 · Import de mercado (2 pasos) + P0 heurística
 * (PostgreSQL real).
 *
 * El router `market` es inyectable: se monta con una `MarketSource` falsa
 * (sin red) para probar los endpoints `fetch` (preview), `import` (transacción
 * atómica idempotente con afiliaciones por GP) y `p0Heuristic` (P0 desde la
 * clasificación, agrupado por afiliación en BD).
 *
 * Criterios:
 * - `fetch` devuelve el preview normalizado (sin escribir en BD).
 * - `import` crea constructores/equipos/pilotos (únicos por nombre) y
 *   afiliaciones para TODOS los GPs de la temporada; idempotente (re-ejecutar
 *   salta); auditoría `market.imported` con resumen.
 * - Año del mercado ≠ año de la temporada → error.
 * - `p0Heuristic` calcula P0 de riders (posición → precio lineal 30→10),
 *   equipos y constructores (media de sus riders, vía afiliación en BD);
 *   idempotente (re-ejecutar actualiza); auditoría `price.p0_heuristic`.
 * - RBAC: mutaciones solo `global_admin` (403 para `user`).
 * - Fallos de la fuente → INTERNAL_SERVER_ERROR con motivo en español.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  CapturingEmailSender,
  createPrisma,
  integrationDbUrl,
  seedWorld,
  type World,
} from "./helpers";

process.env.DATABASE_URL = integrationDbUrl();
process.env.REDIS_URL ??= "redis://localhost:6379/0";

const { createAuthRouter } = await import("../../app/server/routers/auth");
const { createMarketRouter } = await import("../../app/server/routers/market");
const { createContext } = await import("../../app/server/trpc");
const { InMemoryRateLimitStore } = await import("../../app/modules/identity");
const { MarketSourceError } = await import("../../app/modules/market");

const suffix = randomUUID().slice(0, 8);
const email = (name: string) => `${name}-${suffix}@test.local`;
const username = (name: string) => `${name}_${suffix}`;
const PASSWORD = "contraseña-segura-1";
const ADMIN_EMAIL = email("admin");
const ADMIN_IP = "198.51.100.50";
const USER_IP = "198.51.100.51";

const CTOR = `Constructor Imp ${suffix}`;
const TEAM = `Equipo Imp ${suffix}`;
const RIDER_FULL = `Marc Imp ${suffix}`; // "name surname" → "Marc Imp"
const RIDER_NAME = "Marc";
const RIDER_SURNAME = `Imp ${suffix}`;

describe("US-06/ADR-0013/ADR-0014 · Import de mercado + P0 heurística (PostgreSQL real)", () => {
  let prisma: ReturnType<typeof createPrisma>;
  let authRouter: ReturnType<typeof createAuthRouter>;
  let marketRouter: ReturnType<typeof createMarketRouter>;
  let world: World;
  let adminId: string;
  let adminToken: string;
  let userToken: string;
  let gp2Id: string;

  // Fuente falsa (sin red).
  const fetchSeasonMarket = vi.fn<(year: number) => Promise<unknown>>();
  const fetchStandings = vi.fn<(year: number) => Promise<unknown>>();
  const fakeSource = {
    meta: { name: "fake", version: "v1" },
    fetchSeasonMarket: (year: number) => fetchSeasonMarket(year),
    fetchStandings: (year: number) => fetchStandings(year),
  };

  /** Mercado normalizado para el año de la temporada (2099). */
  function normalizedMarket(year: number) {
    return {
      year,
      seasonRef: `ref-${suffix}`,
      source: { name: "fake", version: "v1" },
      constructors: [{ sourceId: `c-${suffix}`, name: CTOR }],
      teams: [
        {
          sourceId: `t-${suffix}`,
          name: TEAM,
          manufacturer: { sourceId: `c-${suffix}`, name: CTOR },
        },
      ],
      riders: [
        {
          sourceId: `r-${suffix}`,
          name: RIDER_NAME,
          surname: RIDER_SURNAME,
          number: 93,
          countryIso: "ES",
        },
      ],
      affiliations: [
        {
          riderSourceId: `r-${suffix}`,
          teamSourceId: `t-${suffix}`,
          seasonYear: year,
        },
      ],
    };
  }

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
    marketRouter = createMarketRouter({
      prisma,
      marketSource: fakeSource as never,
    });
    world = await seedWorld(prisma);

    // Segunda ronda para comprobar que las afiliaciones se crean en TODOS los GPs.
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

  function sessionTokenFrom(ctx: { pendingCookies: string[] }): string {
    const token = /^session=([0-9a-f]{64});/.exec(ctx.pendingCookies[0] ?? "")?.[1];
    if (!token) throw new Error(`Cookie de sesión inesperada: ${ctx.pendingCookies[0]}`);
    return token;
  }

  // ── market.fetch (preview) ─────────────────────────────────────────────────

  it("market.fetch devuelve el preview normalizado (sin escribir en BD)", async () => {
    fetchSeasonMarket.mockResolvedValue(normalizedMarket(world.season.year));
    const { market } = await callerFor(ADMIN_IP, adminToken);

    const preview = await market.market.fetch({ year: world.season.year });

    expect(preview).toMatchObject({
      year: world.season.year,
      constructors: [{ name: CTOR }],
      teams: [{ name: TEAM }],
      riders: [{ name: RIDER_NAME, surname: RIDER_SURNAME }],
    });
    expect(fetchSeasonMarket).toHaveBeenCalledWith(world.season.year);
    // No escribe en BD.
    expect(await prisma.constructor.count({ where: { name: CTOR } })).toBe(0);
  });

  it("market.fetch: fallo de la fuente → INTERNAL_SERVER_ERROR con motivo", async () => {
    fetchSeasonMarket.mockRejectedValue(
      new MarketSourceError("La fuente no tiene temporada para el año 2099."),
    );
    const { market } = await callerFor(ADMIN_IP, adminToken);

    await expect(
      market.market.fetch({ year: world.season.year }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "La fuente no tiene temporada para el año 2099.",
    });
  });

  // ── market.import (transacción atómica idempotente) ───────────────────────

  it("market.import crea constructores, equipos, pilotos y afiliaciones (todos los GPs)", async () => {
    const { market } = await callerFor(ADMIN_IP, adminToken);

    const report = await market.market.import({
      seasonId: world.season.id,
      market: normalizedMarket(world.season.year),
    });

    expect(report).toMatchObject({
      constructorsCreated: 1,
      constructorsSkipped: 0,
      teamsCreated: 1,
      teamsSkipped: 0,
      ridersCreated: 1,
      ridersSkipped: 0,
      // 1 rider × 2 GPs (ronda 1 + ronda 2).
      affiliationsCreated: 2,
      affiliationsSkipped: 0,
    });

    // El piloto se crea con el nombre completo "name surname".
    const rider = await prisma.rider.findUnique({
      where: { name: RIDER_FULL },
    });
    expect(rider).toMatchObject({ number: 93 });
    // El equipo referencia al constructor (FK).
    const team = await prisma.team.findUnique({ where: { name: TEAM } });
    const ctor = await prisma.constructor.findUnique({ where: { name: CTOR } });
    expect(team?.constructorId).toBe(ctor?.id);
    // Afiliaciones en los dos GPs de la temporada.
    const affs = await prisma.riderAffiliation.findMany({
      where: { riderId: rider?.id },
    });
    expect(affs.map((a) => a.gpId).sort()).toEqual(
      [world.gp.id, gp2Id].sort(),
    );
    // El constructor de la afiliación se deriva del equipo (invariante 5).
    expect(affs[0]?.constructorId).toBe(ctor?.id);

    // Auditoría `market.imported`.
    const audit = await prisma.auditLog.findFirst({
      where: { action: "market.imported", entityId: world.season.id },
    });
    expect(audit).toMatchObject({
      actorId: adminId,
      entity: "market",
      ip: ADMIN_IP,
    });
    expect(audit?.afterData).toMatchObject({
      constructorsCreated: 1,
      teamsCreated: 1,
      ridersCreated: 1,
      affiliationsCreated: 2,
    });
  });

  it("market.import es idempotente (re-ejecutar salta lo existente)", async () => {
    const { market } = await callerFor(ADMIN_IP, adminToken);

    const report = await market.market.import({
      seasonId: world.season.id,
      market: normalizedMarket(world.season.year),
    });

    expect(report).toMatchObject({
      constructorsCreated: 0,
      constructorsSkipped: 1,
      teamsCreated: 0,
      teamsSkipped: 1,
      ridersCreated: 0,
      ridersSkipped: 1,
      affiliationsCreated: 0,
      affiliationsSkipped: 2,
    });
    // Una sola fila por nombre (no se duplica).
    expect(await prisma.constructor.count({ where: { name: CTOR } })).toBe(1);
    expect(await prisma.team.count({ where: { name: TEAM } })).toBe(1);
    expect(await prisma.rider.count({ where: { name: RIDER_FULL } })).toBe(1);
  });

  it("market.import: año del mercado ≠ año de la temporada → error", async () => {
    const { market } = await callerFor(ADMIN_IP, adminToken);
    await expect(
      market.market.import({
        seasonId: world.season.id,
        market: normalizedMarket(world.season.year + 1),
      }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("market.import: equipo que referencia un constructor desconocido → error (y nada se crea)", async () => {
    const { market } = await callerFor(ADMIN_IP, adminToken);
    // El equipo referencia un constructor que NO está en la lista de constructores.
    const badMarket = normalizedMarket(world.season.year);
    badMarket.teams = [
      {
        sourceId: `t-bad-${suffix}`,
        name: `Equipo Huérfano ${suffix}`,
        manufacturer: { sourceId: `c-unknown-${suffix}`, name: `Constructor Desconocido ${suffix}` },
      },
    ];
    // La afiliación (rider → equipo huérfano) pasa la validación Zod (min 1)
    // pero no se procesa: el error se lanza al crear el equipo.
    badMarket.affiliations = [
      {
        riderSourceId: `r-${suffix}`,
        teamSourceId: `t-bad-${suffix}`,
        seasonYear: world.season.year,
      },
    ];

    await expect(
      market.market.import({ seasonId: world.season.id, market: badMarket }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    // Transacción atómica: el equipo huérfano no se crea.
    expect(
      await prisma.team.count({ where: { name: `Equipo Huérfano ${suffix}` } }),
    ).toBe(0);
  });

  it("market.import: temporada inexistente → NOT_FOUND", async () => {
    const { market } = await callerFor(ADMIN_IP, adminToken);
    await expect(
      market.market.import({
        seasonId: randomUUID(),
        market: normalizedMarket(world.season.year),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("market.import: usuario normal → 403 (RBAC)", async () => {
    const { market } = await callerFor(USER_IP, userToken);
    await expect(
      market.market.import({
        seasonId: world.season.id,
        market: normalizedMarket(world.season.year),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // ── market.p0Heuristic (P0 desde la clasificación) ─────────────────────────

  it("p0Heuristic calcula P0 de riders, equipos y constructores (vía afiliación)", async () => {
    // Clasificación: 2 riders (1 con afiliación en BD, 1 sin).
    const otherRider = `Jorge Imp ${suffix}`;
    await prisma.rider.create({
      data: { name: otherRider, number: 89 },
    });
    fetchStandings.mockResolvedValue([
      {
        position: 1,
        riderFullName: RIDER_FULL,
        riderNumber: 93,
        teamName: TEAM,
        constructorName: CTOR,
        points: 300,
      },
      {
        position: 2,
        riderFullName: otherRider,
        riderNumber: 89,
        teamName: "",
        constructorName: "",
        points: 200,
      },
    ]);
    const { market } = await callerFor(ADMIN_IP, adminToken);

    const result = await market.market.p0Heuristic({
      seasonId: world.season.id,
    });

    // 2 riders: pos 1 → 30, pos 2 → 10 (n=2, step=20).
    expect(result).toMatchObject({
      ridersPriced: 2,
      teamsPriced: 1, // solo el rider con afiliación cuenta
      constructorsPriced: 1,
      maxPrice: 30,
      minPrice: 10,
    });

    // P0 del rider (gp_id = NULL).
    const rider = await prisma.rider.findUnique({ where: { name: RIDER_FULL } });
    const riderP0 = await prisma.price.findFirst({
      where: { assetType: "rider", assetId: rider?.id, gpId: null },
    });
    expect(Number(riderP0?.price)).toBe(30);
    expect(riderP0?.reason).toBe("formula");

    // P0 del equipo = media de sus riders (solo el de pos 1) = 30.
    const team = await prisma.team.findUnique({ where: { name: TEAM } });
    const teamP0 = await prisma.price.findFirst({
      where: { assetType: "team", assetId: team?.id, gpId: null },
    });
    expect(Number(teamP0?.price)).toBe(30);

    // P0 del constructor = media de sus riders (solo el de pos 1) = 30.
    const ctor = await prisma.constructor.findUnique({ where: { name: CTOR } });
    const ctorP0 = await prisma.price.findFirst({
      where: { assetType: "constructor", assetId: ctor?.id, gpId: null },
    });
    expect(Number(ctorP0?.price)).toBe(30);

    // Auditoría `price.p0_heuristic`.
    const audit = await prisma.auditLog.findFirst({
      where: { action: "price.p0_heuristic", entityId: world.season.id },
    });
    expect(audit).toMatchObject({ actorId: adminId, entity: "price" });
    expect(audit?.afterData).toMatchObject({
      ridersPriced: 2,
      teamsPriced: 1,
      constructorsPriced: 1,
    });
  });

  it("p0Heuristic es idempotente (re-ejecutar actualiza, no duplica)", async () => {
    fetchStandings.mockResolvedValue([
      {
        position: 1,
        riderFullName: RIDER_FULL,
        riderNumber: 93,
        teamName: TEAM,
        constructorName: CTOR,
        points: 300,
      },
    ]);
    const { market } = await callerFor(ADMIN_IP, adminToken);

    const result = await market.market.p0Heuristic({
      seasonId: world.season.id,
    });

    expect(result.ridersPriced).toBe(1);
    // Una sola fila de P0 por activo (no se duplica).
    const rider = await prisma.rider.findUnique({ where: { name: RIDER_FULL } });
    const count = await prisma.price.count({
      where: { assetType: "rider", assetId: rider?.id, gpId: null },
    });
    expect(count).toBe(1);
  });

  it("p0Heuristic: temporada inexistente → NOT_FOUND", async () => {
    const { market } = await callerFor(ADMIN_IP, adminToken);
    await expect(
      market.market.p0Heuristic({ seasonId: randomUUID() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("p0Heuristic: usuario normal → 403 (RBAC)", async () => {
    const { market } = await callerFor(USER_IP, userToken);
    await expect(
      market.market.p0Heuristic({ seasonId: world.season.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
