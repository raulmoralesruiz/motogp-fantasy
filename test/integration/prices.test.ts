/**
 * US-07 · Precios: precio de apertura (P0) e histórico (PostgreSQL real).
 *
 * Mismo patrón que `market.test.ts`: los módulos de la app leen el entorno
 * al importar (singletons de Prisma y Redis), así que `DATABASE_URL` y
 * `REDIS_URL` se fijan ANTES del `import()` dinámico. El router `market` es
 * inyectable: se monta con la BD efímera.
 *
 * Criterios de aceptación (backlog US-07, ADR-0014):
 * - P0 es un upsert auditado: crea (auditoría `price.opening_set` con
 *   before=null), no-op con el mismo valor (no se audita) y actualiza con
 *   otro valor (before/after).
 * - Fila de P0: `gpId = null`, `reason = manual`, `createdBy = actor`,
 *   `rulesVersion = null`.
 * - P0 se puede fijar o cambiar en cualquier momento (auditado); el gate
 *   de lockout para precios por GP es US-08.
 * - `prices.list`: activos + P0 (null si no está fijado), ordenados por
 *   nombre; cualquier usuario autenticado.
 * - `prices.history`: P0 + una fila por GP, orden P0 → ronda; cualquier
 *   usuario autenticado.
 * - RBAC: `setOpening` solo `global_admin` (403 para `user`); 401 sin
 *   sesión.
 *
 * Nota: las filas de precio por GP las produce US-08 (fórmula de precios);
 * aquí se crean directamente como fixture para verificar el orden del
 * histórico.
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
const ADMIN_IP = "198.51.100.50";
const USER_IP = "198.51.100.51";

describe("US-07 · Precios: P0 e histórico (PostgreSQL real)", () => {
  let prisma: ReturnType<typeof createPrisma>;
  let authRouter: ReturnType<typeof createAuthRouter>;
  let marketRouter: ReturnType<typeof createMarketRouter>;
  let world: World;
  let adminId: string;
  let adminToken: string;
  let userToken: string;
  let riderId: string; // piloto del mundo (P0)
  let p0RowId: string; // fila de P0 de ese piloto
  let gp2Id: string; // ronda 2 (filas de precio por GP)

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

    // Ronda 2 de la misma temporada (para las filas de precio por GP del
    // histórico).
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

  /** Fila de P0 de un activo (gpId null; el índice parcial único garantiza ≤1 fila). */
  async function p0Row(assetType: "rider" | "constructor" | "team", assetId: string) {
    return prisma.price.findFirst({
      where: { assetType, assetId, gpId: null },
    });
  }

  /** Auditorías `price.opening_set` de una fila de precio (acotadas por entityId). */
  async function openingAudits(priceRowId: string) {
    return prisma.auditLog.findMany({
      where: { action: "price.opening_set", entityId: priceRowId },
    });
  }

  // ── Lectura (prices.list) ──────────────────────────────────────────────────

  it("prices.list devuelve los pilotos sin P0 (null), ordenados por nombre", async () => {
    const { market } = await callerFor(USER_IP, userToken);
    const rows = await market.prices.list({ assetType: "rider" });
    // La BD compartida tiene pilotos de otros archivos: se acota a los del
    // mundo de este run.
    const worldRiderIds = new Set(world.riders.map((r) => r.id));
    const mine = rows.filter((r) => worldRiderIds.has(r.assetId));
    expect(mine).toHaveLength(6);
    expect(mine.every((r) => r.openingPrice === null)).toBe(true);
    // Ordenados por nombre (mismo prefijo: el orden es inequívoco).
    expect(mine.map((r) => r.name)).toEqual(world.riders.map((r) => r.name).sort());
  });

  it("prices.list devuelve el constructor y el equipo del mundo sin P0", async () => {
    const { market } = await callerFor(USER_IP, userToken);
    const ctors = await market.prices.list({ assetType: "constructor" });
    expect(ctors.find((c) => c.assetId === world.ctor.id)).toMatchObject({
      name: world.ctor.name,
      openingPrice: null,
    });
    const teams = await market.prices.list({ assetType: "team" });
    expect(teams.find((t) => t.assetId === world.team.id)).toMatchObject({
      name: world.team.name,
      openingPrice: null,
    });
  });

  // ── P0 (setOpening): upsert auditado ───────────────────────────────────────

  it("setOpening crea el P0 (auditoría price.opening_set, before=null)", async () => {
    const { market } = await callerFor(ADMIN_IP, adminToken);
    const result = await market.prices.setOpening({
      assetType: "rider",
      assetId: riderId,
      price: 20,
    });
    expect(result).toEqual({ price: 20, status: "created" });

    // Fila de P0: gpId null, reason manual, rulesVersion null, createdBy = actor.
    const row = await p0Row("rider", riderId);
    expect(row).not.toBeNull();
    p0RowId = row!.id;
    expect(row).toMatchObject({
      assetType: "rider",
      assetId: riderId,
      gpId: null,
      reason: "manual",
      rulesVersion: null,
      createdBy: adminId,
    });
    expect(Number(row!.price)).toBe(20);

    // Auditoría: una fila, before=null, after con el valor nuevo.
    const audits = await openingAudits(p0RowId);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorId: adminId,
      entity: "price",
      entityId: p0RowId,
      ip: ADMIN_IP,
    });
    expect(audits[0]?.beforeData).toBeNull();
    expect(audits[0]?.afterData).toMatchObject({
      assetType: "rider",
      assetId: riderId,
      price: 20,
    });
  });

  it("setOpening con el mismo valor no hace nada (no se audita)", async () => {
    const { market } = await callerFor(ADMIN_IP, adminToken);
    const result = await market.prices.setOpening({
      assetType: "rider",
      assetId: riderId,
      price: 20,
    });
    expect(result).toEqual({ price: 20, status: "unchanged" });
    // Sin auditoría nueva: sigue la única de la creación.
    expect(await openingAudits(p0RowId)).toHaveLength(1);
  });

  it("setOpening con otro valor actualiza (auditoría before/after)", async () => {
    const { market } = await callerFor(ADMIN_IP, adminToken);
    const result = await market.prices.setOpening({
      assetType: "rider",
      assetId: riderId,
      price: 25,
    });
    expect(result).toEqual({ price: 25, status: "updated" });

    const row = await p0Row("rider", riderId);
    expect(Number(row?.price)).toBe(25);
    expect(row?.createdBy).toBe(adminId);

    // Dos auditorías de la misma fila: creación (before=null) y
    // actualización (before/after). Se identifican por contenido
    // (createdAt tiene precisión de segundo).
    const audits = await openingAudits(p0RowId);
    expect(audits).toHaveLength(2);
    const creation = audits.find((a) => a.beforeData === null);
    const update = audits.find((a) => a.beforeData !== null);
    expect(creation?.afterData).toMatchObject({ price: 20 });
    expect(update?.beforeData).toMatchObject({ price: 20 });
    expect(update?.afterData).toMatchObject({
      assetType: "rider",
      assetId: riderId,
      price: 25,
    });
    expect(update?.actorId).toBe(adminId);
    expect(update?.ip).toBe(ADMIN_IP);
  });

  it("setOpening sobre un activo inexistente falla (NOT_FOUND)", async () => {
    const { market } = await callerFor(ADMIN_IP, adminToken);
    await expect(
      market.prices.setOpening({ assetType: "rider", assetId: randomUUID(), price: 10 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "El piloto no existe." });
    await expect(
      market.prices.setOpening({
        assetType: "constructor",
        assetId: randomUUID(),
        price: 10,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "El constructor no existe." });
    await expect(
      market.prices.setOpening({ assetType: "team", assetId: randomUUID(), price: 10 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "El equipo no existe." });
  });

  it("setOpening por un usuario normal falla (403 FORBIDDEN)", async () => {
    const { market } = await callerFor(USER_IP, userToken);
    await expect(
      market.prices.setOpening({ assetType: "rider", assetId: riderId, price: 30 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // El P0 no se modifica.
    expect(Number((await p0Row("rider", riderId))?.price)).toBe(25);
  });

  it("setOpening con un precio inválido falla (validación)", async () => {
    const { market } = await callerFor(ADMIN_IP, adminToken);
    // Zod: tRPC envuelve los issues en el mensaje; el mensaje exacto lo
    // cubren los tests unit de los schemas.
    await expect(
      market.prices.setOpening({ assetType: "rider", assetId: riderId, price: 0 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      market.prices.setOpening({ assetType: "rider", assetId: riderId, price: 1.234 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  // ── Lecturas (list + history) ──────────────────────────────────────────────

  it("prices.list refleja el P0 fijado", async () => {
    const { market } = await callerFor(USER_IP, userToken);
    const rows = await market.prices.list({ assetType: "rider" });
    const mine = rows.find((r) => r.assetId === riderId);
    expect(mine?.openingPrice).toBe(25);
    // Ningún otro piloto de este mundo tiene P0 (la BD compartida puede
    // tener P0 de runs anteriores sobre otros pilotos).
    const worldRiderIds = new Set(world.riders.map((r) => r.id));
    expect(
      rows.filter((r) => worldRiderIds.has(r.assetId) && r.openingPrice !== null),
    ).toHaveLength(1);
  });

  it("prices.history devuelve el P0 (lo lee cualquier usuario autenticado)", async () => {
    const { market } = await callerFor(USER_IP, userToken);
    const history = await market.prices.history({ assetType: "rider", assetId: riderId });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      id: p0RowId,
      gpRound: null,
      gpName: null,
      price: 25,
      reason: "manual",
    });
  });

  it("prices.history sobre un activo inexistente falla (NOT_FOUND)", async () => {
    const { market } = await callerFor(USER_IP, userToken);
    await expect(
      market.prices.history({ assetType: "rider", assetId: randomUUID() }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "El piloto no existe." });
  });

  it("prices.list y prices.history sin sesión fallan (401)", async () => {
    const { market } = await callerFor(USER_IP); // sin cookie de sesión
    await expect(market.prices.list({ assetType: "rider" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      market.prices.history({ assetType: "rider", assetId: riderId }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  // ── Filas por GP (fixture de US-08) y orden del histórico ──────────────────

  it("prices.history ordena P0 → rondas de GP (filas por GP de fórmula)", async () => {
    // Las filas por GP las produce US-08 (fórmula de precios, `pricing-v1`);
    // aquí se crean directamente como fixture para verificar el orden.
    await prisma.price.create({
      data: {
        assetType: "rider",
        assetId: riderId,
        gpId: world.gp.id,
        price: 22,
        reason: "formula",
        rulesVersion: "pricing-v1",
      },
    });
    await prisma.price.create({
      data: {
        assetType: "rider",
        assetId: riderId,
        gpId: gp2Id,
        price: 24,
        reason: "formula",
        rulesVersion: "pricing-v1",
      },
    });

    const { market } = await callerFor(USER_IP, userToken);
    const history = await market.prices.history({ assetType: "rider", assetId: riderId });
    expect(history).toHaveLength(3);
    expect(history.map((h) => h.price)).toEqual([25, 22, 24]);
    expect(history[0]).toMatchObject({ gpRound: null, gpName: null, reason: "manual" });
    expect(history[1]).toMatchObject({
      gpRound: 1,
      gpName: world.gp.name,
      reason: "formula",
    });
    expect(history[2]).toMatchObject({
      gpRound: 2,
      gpName: `GP ${suffix} R2`,
      reason: "formula",
    });
  });

  it("setOpening también funciona para constructor y equipo (P0 independientes, auditados)", async () => {
    const { market } = await callerFor(ADMIN_IP, adminToken);
    const ctorResult = await market.prices.setOpening({
      assetType: "constructor",
      assetId: world.ctor.id,
      price: 15,
    });
    const teamResult = await market.prices.setOpening({
      assetType: "team",
      assetId: world.team.id,
      price: 12,
    });
    expect(ctorResult).toEqual({ price: 15, status: "created" });
    expect(teamResult).toEqual({ price: 12, status: "created" });

    // Cada lista muestra su P0 (acotado: la BD compartida tiene otros
    // constructores y equipos de otros archivos).
    const ctors = await market.prices.list({ assetType: "constructor" });
    expect(ctors.find((c) => c.assetId === world.ctor.id)).toMatchObject({
      openingPrice: 15,
    });
    const teams = await market.prices.list({ assetType: "team" });
    expect(teams.find((t) => t.assetId === world.team.id)).toMatchObject({
      openingPrice: 12,
    });

    // Una auditoría por fila, antes=null.
    const ctorRow = await p0Row("constructor", world.ctor.id);
    const teamRow = await p0Row("team", world.team.id);
    const ctorAudits = await openingAudits(ctorRow!.id);
    const teamAudits = await openingAudits(teamRow!.id);
    expect(ctorAudits).toHaveLength(1);
    expect(teamAudits).toHaveLength(1);
    expect(ctorAudits[0]?.beforeData).toBeNull();
    expect(teamAudits[0]?.beforeData).toBeNull();
    expect(ctorAudits[0]?.afterData).toMatchObject({
      assetType: "constructor",
      assetId: world.ctor.id,
      price: 15,
    });
    expect(teamAudits[0]?.afterData).toMatchObject({
      assetType: "team",
      assetId: world.team.id,
      price: 12,
    });
  });

  it("cambiar el P0 no toca las filas por GP (independencia)", async () => {
    const { market } = await callerFor(ADMIN_IP, adminToken);
    const result = await market.prices.setOpening({
      assetType: "rider",
      assetId: riderId,
      price: 30,
    });
    expect(result).toEqual({ price: 30, status: "updated" });

    // Las filas por GP no se modifican.
    const gpRows = await prisma.price.findMany({
      where: { assetType: "rider", assetId: riderId, gpId: { not: null } },
    });
    expect(gpRows.map((p) => Number(p.price)).sort((a, b) => a - b)).toEqual([22, 24]);

    // Histórico: el P0 nuevo primero, luego las rondas.
    const history = await market.prices.history({ assetType: "rider", assetId: riderId });
    expect(history.map((h) => h.price)).toEqual([30, 22, 24]);
    expect(history[0]).toMatchObject({ gpRound: null, reason: "manual" });
  });
});
