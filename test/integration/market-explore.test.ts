/**
 * US-14 · Exploración del mercado: lista + detalle (PostgreSQL real).
 *
 * Mismo patrón que `prices.test.ts`: los módulos de la app leen el entorno
 * al importar (singletons de Prisma y Redis), así que `DATABASE_URL` y
 * `REDIS_URL` se fijan ANTES del `import()` dinámico. El router `market` es
 * inyectable: se monta con la BD efímera.
 *
 * Criterios de aceptación (backlog US-14):
 * - Lista filtrable por constructor/equipo (solo riders, vía su afiliación
 *   en el GP) y rango de precio (inclusivo) sobre el precio actual.
 * - Cada activo muestra precio actual (precio del GP; si el GP no tiene
 *   precio, P0 — `isP0Fallback`), tendencia (sube/baja/estable frente al
 *   punto anterior del histórico) y mini-histórico.
 * - El detalle muestra el histórico completo (orden P0 → ronda, motivo
 *   fórmula/manual) y la concentración (nº de lineups de ese GP que
 *   contienen el activo — sin PII).
 * - RBAC: `list`/`detail` cualquier usuario autenticado; 401 sin sesión.
 *
 * Nota: la BD es compartida entre archivos de test; todas las aserciones
 * se acotan a los IDs del mundo de este run.
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
const ADMIN_IP = "198.51.100.60";
const USER_IP = "198.51.100.61";

describe("US-14 · Exploración del mercado: lista + detalle (PostgreSQL real)", () => {
  let prisma: ReturnType<typeof createPrisma>;
  let authRouter: ReturnType<typeof createAuthRouter>;
  let marketRouter: ReturnType<typeof createMarketRouter>;
  let world: World;
  let userToken: string;
  let gp2Id: string; // ronda 2 (GP de exploración)
  let ctor2Id: string; // 2º constructor (discrimina el filtro)
  let team2Id: string; // 2º equipo (discrimina el filtro)

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

    // Ronda 2 de la misma temporada (GP de exploración del mercado).
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

    // Segundo constructor + equipo (para discriminar los filtros).
    const ctor2 = await prisma.constructor.create({
      data: { name: `Constructor 2 ${suffix}` },
    });
    ctor2Id = ctor2.id;
    const team2 = await prisma.team.create({
      data: { name: `Equipo 2 ${suffix}`, constructorId: ctor2.id },
    });
    team2Id = team2.id;

    // Admin global (bootstrap, ADR-0010) + P0 de los activos del mundo.
    const adminCaller = await callerFor(ADMIN_IP);
    await adminCaller.auth.register({
      email: ADMIN_EMAIL,
      username: username("admin"),
      password: PASSWORD,
      termsAccepted: true,
    });
    const adminToken = sessionTokenFrom(adminCaller.ctx);
    const admin = (await callerFor(ADMIN_IP, adminToken)).market;
    await admin.prices.setOpening({
      assetType: "rider",
      assetId: world.riders[0].id,
      price: 20,
    });
    await admin.prices.setOpening({
      assetType: "rider",
      assetId: world.riders[1].id,
      price: 10,
    });
    await admin.prices.setOpening({
      assetType: "constructor",
      assetId: world.ctor.id,
      price: 15,
    });

    // Filas de precio por GP (fixture del histórico: P0 → J1 → J2).
    await prisma.price.create({
      data: {
        assetType: "rider",
        assetId: world.riders[0].id,
        gpId: world.gp.id,
        price: 22,
        reason: "formula",
        rulesVersion: "pricing-v1",
      },
    });
    await prisma.price.create({
      data: {
        assetType: "rider",
        assetId: world.riders[0].id,
        gpId: gp2Id,
        price: 19,
        reason: "formula",
        rulesVersion: "pricing-v1",
      },
    });
    await prisma.price.create({
      data: {
        assetType: "constructor",
        assetId: world.ctor.id,
        gpId: gp2Id,
        price: 16,
        reason: "formula",
        rulesVersion: "pricing-v1",
      },
    });

    // Afiliaciones por GP (ronda 2): rider0 → equipo/constructor del mundo,
    // rider1 → equipo 2 (constructor 2).
    await prisma.riderAffiliation.create({
      data: {
        riderId: world.riders[0].id,
        teamId: world.team.id,
        constructorId: world.ctor.id,
        gpId: gp2Id,
      },
    });
    await prisma.riderAffiliation.create({
      data: {
        riderId: world.riders[1].id,
        teamId: team2Id,
        constructorId: ctor2Id,
        gpId: gp2Id,
      },
    });

    // Lineup del GP de exploración (popularidad: riders 0–3, constructor
    // y equipo del mundo) en UNA sentencia (trigger AFTER STATEMENT).
    const lineup = await prisma.lineup.create({
      data: { userId: world.user.id, gpId: gp2Id },
    });
    await prisma.lineupSlot.createMany({
      data: [
        {
          lineupId: lineup.id,
          slotType: "gold",
          assetType: "rider",
          assetId: world.riders[0].id,
        },
        {
          lineupId: lineup.id,
          slotType: "gold",
          assetType: "rider",
          assetId: world.riders[1].id,
        },
        {
          lineupId: lineup.id,
          slotType: "silver",
          assetType: "rider",
          assetId: world.riders[2].id,
        },
        {
          lineupId: lineup.id,
          slotType: "silver",
          assetType: "rider",
          assetId: world.riders[3].id,
        },
        {
          lineupId: lineup.id,
          slotType: "constructor",
          assetType: "constructor",
          assetId: world.ctor.id,
        },
        {
          lineupId: lineup.id,
          slotType: "team",
          assetType: "team",
          assetId: world.team.id,
        },
      ],
    });

    // Usuario normal.
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

  /** Pilotos del mundo (la BD compartida tiene riders de otros archivos). */
  function worldRiderIds(): Set<string> {
    return new Set(world.riders.map((r) => r.id));
  }

  // ── market.list (riders) ───────────────────────────────────────────────────

  it("market.list (riders): precio del GP, tendencia, fallback P0 y popularidad", async () => {
    const { market } = await callerFor(USER_IP, userToken);
    const rows = await market.market.list({ gpId: gp2Id, assetType: "rider" });
    const mine = rows.filter((r) => worldRiderIds().has(r.assetId));
    expect(mine).toHaveLength(6);

    // rider0: precio del GP (19), tendencia baja (19 < 22), popularidad 1.
    const r0 = mine.find((r) => r.assetId === world.riders[0].id);
    expect(r0).toMatchObject({
      name: world.riders[0].name,
      constructorId: world.ctor.id,
      constructorName: world.ctor.name,
      teamId: world.team.id,
      teamName: world.team.name,
      currentPrice: 19,
      isP0Fallback: false,
      trend: "down",
      popularity: 1,
    });
    expect(r0?.miniHistory.map((p) => p.price)).toEqual([20, 22, 19]);

    // rider1: el GP no tiene precio → fallback P0 (10), tendencia estable.
    const r1 = mine.find((r) => r.assetId === world.riders[1].id);
    expect(r1).toMatchObject({
      constructorId: ctor2Id,
      teamId: team2Id,
      currentPrice: 10,
      isP0Fallback: true,
      trend: "flat",
      popularity: 1,
    });
    expect(r1?.miniHistory.map((p) => p.price)).toEqual([10]);

    // rider2: sin precio alguno → null, estable; popularidad 1 (en el lineup).
    const r2 = mine.find((r) => r.assetId === world.riders[2].id);
    expect(r2).toMatchObject({
      currentPrice: null,
      isP0Fallback: false,
      trend: "flat",
      popularity: 1,
    });

    // Ordenado por nombre (mismo prefijo: el orden es inequívoco).
    expect(mine.map((r) => r.name)).toEqual(
      world.riders.map((r) => r.name).sort(),
    );
  });

  it("market.list: filtro por constructor (solo riders afiliados en el GP)", async () => {
    const { market } = await callerFor(USER_IP, userToken);
    const rows = await market.market.list({
      gpId: gp2Id,
      assetType: "rider",
      constructorId: world.ctor.id,
    });
    const mine = rows.filter((r) => worldRiderIds().has(r.assetId));
    expect(mine.map((r) => r.assetId)).toEqual([world.riders[0].id]);
  });

  it("market.list: filtro por equipo (solo riders afiliados en el GP)", async () => {
    const { market } = await callerFor(USER_IP, userToken);
    const rows = await market.market.list({
      gpId: gp2Id,
      assetType: "rider",
      teamId: team2Id,
    });
    const mine = rows.filter((r) => worldRiderIds().has(r.assetId));
    expect(mine.map((r) => r.assetId)).toEqual([world.riders[1].id]);
  });

  it("market.list: rango de precio inclusivo; excluye los activos sin precio", async () => {
    const { market } = await callerFor(USER_IP, userToken);
    const rows = await market.market.list({
      gpId: gp2Id,
      assetType: "rider",
      priceMin: 10,
      priceMax: 19,
    });
    const mine = rows.filter((r) => worldRiderIds().has(r.assetId));
    // rider0 (19) y rider1 (10) dentro del rango; rider2–5 sin precio fuera.
    expect(mine.map((r) => r.assetId).sort()).toEqual(
      [world.riders[0].id, world.riders[1].id].sort(),
    );
  });

  it("market.list (constructor y equipo): precio, tendencia y popularidad", async () => {
    const { market } = await callerFor(USER_IP, userToken);
    const ctors = await market.market.list({ gpId: gp2Id, assetType: "constructor" });
    const ctor = ctors.find((c) => c.assetId === world.ctor.id);
    expect(ctor).toMatchObject({
      name: world.ctor.name,
      currentPrice: 16,
      isP0Fallback: false,
      trend: "up",
      popularity: 1,
      constructorName: null,
      teamName: null,
    });
    const teams = await market.market.list({ gpId: gp2Id, assetType: "team" });
    const team = teams.find((t) => t.assetId === world.team.id);
    expect(team).toMatchObject({
      name: world.team.name,
      currentPrice: null,
      isP0Fallback: false,
      trend: "flat",
      popularity: 1,
    });
  });

  // ── market.detail ──────────────────────────────────────────────────────────

  it("market.detail: vista del activo + histórico completo (P0 → ronda)", async () => {
    const { market } = await callerFor(USER_IP, userToken);
    const detail = await market.market.detail({
      gpId: gp2Id,
      assetType: "rider",
      assetId: world.riders[0].id,
    });

    expect(detail.asset).toMatchObject({
      assetId: world.riders[0].id,
      name: world.riders[0].name,
      constructorId: world.ctor.id,
      constructorName: world.ctor.name,
      teamId: world.team.id,
      teamName: world.team.name,
      currentPrice: 19,
      isP0Fallback: false,
      trend: "down",
      popularity: 1,
    });
    expect(detail.asset.miniHistory.map((p) => p.price)).toEqual([20, 22, 19]);

    // Histórico completo: P0 (manual) → J1 → J2 (fórmula).
    expect(detail.history.map((h) => h.price)).toEqual([20, 22, 19]);
    expect(detail.history[0]).toMatchObject({
      gpRound: null,
      gpName: null,
      reason: "manual",
    });
    expect(detail.history[1]).toMatchObject({
      gpRound: 1,
      gpName: world.gp.name,
      reason: "formula",
    });
    expect(detail.history[2]).toMatchObject({
      gpRound: 2,
      gpName: `GP ${suffix} R2`,
      reason: "formula",
    });
  });

  it("market.detail: GP sin precio propio → fallback P0 en la vista", async () => {
    const { market } = await callerFor(USER_IP, userToken);
    const detail = await market.market.detail({
      gpId: world.gp.id, // ronda 1: rider1 no tiene precio de GP
      assetType: "rider",
      assetId: world.riders[1].id,
    });
    expect(detail.asset).toMatchObject({
      currentPrice: 10,
      isP0Fallback: true,
      trend: "flat",
    });
    expect(detail.history).toHaveLength(1);
    expect(detail.history[0]).toMatchObject({ gpRound: null, price: 10 });
  });

  // ── Errores y RBAC ─────────────────────────────────────────────────────────

  it("GP inexistente → NOT_FOUND (lista y detalle)", async () => {
    const { market } = await callerFor(USER_IP, userToken);
    await expect(
      market.market.list({ gpId: randomUUID(), assetType: "rider" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "El GP no existe." });
    await expect(
      market.market.detail({
        gpId: randomUUID(),
        assetType: "rider",
        assetId: world.riders[0].id,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "El GP no existe." });
  });

  it("activo inexistente → NOT_FOUND (detalle)", async () => {
    const { market } = await callerFor(USER_IP, userToken);
    await expect(
      market.market.detail({
        gpId: gp2Id,
        assetType: "rider",
        assetId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "El piloto no existe." });
  });

  it("input inválido (precio no positivo) → BAD_REQUEST", async () => {
    const { market } = await callerFor(USER_IP, userToken);
    await expect(
      market.market.list({ gpId: gp2Id, assetType: "rider", priceMin: 0 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      market.market.list({ gpId: gp2Id, assetType: "rider", priceMax: 1.234 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("sin sesión → 401 (lista y detalle)", async () => {
    const { market } = await callerFor(USER_IP); // sin cookie de sesión
    await expect(
      market.market.list({ gpId: gp2Id, assetType: "rider" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      market.market.detail({
        gpId: gp2Id,
        assetType: "rider",
        assetId: world.riders[0].id,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
