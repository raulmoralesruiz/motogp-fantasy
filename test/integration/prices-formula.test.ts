/**
 * US-08 · Fórmula de precios (pricing-v1) y ajuste manual (PostgreSQL real).
 *
 * Mismo patrón que `prices.test.ts`: los módulos de la app leen el entorno
 * al importar (singletons de Prisma y Redis), así que `DATABASE_URL` y
 * `REDIS_URL` se fijan ANTES del `import()` dinámico. El router `market` es
 * inyectable: se monta con la BD efímera.
 *
 * Criterios de aceptación (backlog US-08, ADR-0015):
 * - Tras un GP definitivo, la fórmula v1 calcula el precio del siguiente GP
 *   y registra cada movimiento (motivo `formula`, rulesVersion
 *   `pricing-v1`, createdBy null). Idempotente: re-ejecutar no cambia nada.
 * - Corrección de resultados (recálculo): actualiza la fila y audita
 *   `price.formula_recompute` (actor = sistema, before/after).
 * - GP sin resultados definitivos → PRECONDITION_FAILED; sin siguiente GP
 *   → no-op (`targetGpId: null`).
 * - Gate de lockout: ni la fórmula ni el ajuste manual tocan un GP
 *   `locked` (test: intentar actualizar en lockout no modifica la BD).
 * - Ajuste manual: `reason = manual`, `createdBy = actor`, rulesVersion
 *   null, auditado `price.manual_set` (before/after).
 * - RBAC: `setManual`/`applyFormula` solo `global_admin`.
 *
 * Valores golden (economy.md §4.3; Pmax piloto 30 / grupo 30 — calibración
 * D-02, ADR-0030):
 * - r1 P0=20, gana (25+5=30 pts) → perf 100, W 50 → precio 20.
 * - ctor P0=15, grupo (30+20)/2=25 → perf 83.33 → 14.69.
 * - team P0=12, mismo grupo → 11.75.
 * - Recálculo con r1 en P3 (16 pts): 18.83 / 14.25 / 11.40.
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

describe("US-08 · Fórmula de precios y ajuste manual (PostgreSQL real)", () => {
  let prisma: ReturnType<typeof createPrisma>;
  let authRouter: ReturnType<typeof createAuthRouter>;
  let marketRouter: ReturnType<typeof createMarketRouter>;
  let world: World;
  let gp1Id: string; // ronda 1 (world.gp): el GP "definitivo"
  let gp1RaceId: string; // evento `race` de gp1
  let gp2Id: string; // ronda 2: objetivo de la fórmula
  let gp3Id: string; // ronda 3: último GP (sin siguiente)
  let r1Id: string; // piloto con P0 y P1
  let r2Id: string; // piloto P2 (sin P0)
  let r3Id: string; // piloto P3 (sin P0)
  let adminToken: string;
  let userToken: string;

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
    gp1Id = world.gp.id;
    gp1RaceId = world.event.id; // race, orderNum 1

    // Rondas 2 y 3 de la misma temporada (con su evento `race`).
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
    await prisma.weekendEvent.create({
      data: { gpId: gp2Id, type: "race", orderNum: 1 },
    });
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
    await prisma.weekendEvent.create({
      data: { gpId: gp3Id, type: "race", orderNum: 1 },
    });

    r1Id = world.riders[0].id;
    r2Id = world.riders[1].id;
    r3Id = world.riders[2].id;

    // P0 (fixture directo): r1=20, ctor=15, team=12 (el resto sin P0).
    await prisma.price.create({
      data: { assetType: "rider", assetId: r1Id, price: 20, reason: "manual" },
    });
    await prisma.price.create({
      data: {
        assetType: "constructor",
        assetId: world.ctor.id,
        price: 15,
        reason: "manual",
      },
    });
    await prisma.price.create({
      data: { assetType: "team", assetId: world.team.id, price: 12, reason: "manual" },
    });

    // Afiliaciones de gp1: r1 y r2 → (ctor, team) (grupo de 2 pilotos).
    await prisma.riderAffiliation.create({
      data: { riderId: r1Id, teamId: world.team.id, constructorId: world.ctor.id, gpId: gp1Id },
    });
    await prisma.riderAffiliation.create({
      data: { riderId: r2Id, teamId: world.team.id, constructorId: world.ctor.id, gpId: gp1Id },
    });

    // Grid de gp2 (objetivo de la fórmula): los 6 pilotos → (ctor, team).
    // La fórmula solo fija precios a los activos del grid del GP objetivo.
    for (const rider of world.riders) {
      await prisma.riderAffiliation.create({
        data: { riderId: rider.id, teamId: world.team.id, constructorId: world.ctor.id, gpId: gp2Id },
      });
    }

    // Admin global (bootstrap, ADR-0010) + usuario normal.
    const adminCaller = await callerFor(ADMIN_IP);
    await adminCaller.auth.register({
      email: ADMIN_EMAIL,
      username: username("admin"),
      password: PASSWORD,
      termsAccepted: true,
    });
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

  /** Fila de precio de (activo, GP). */
  async function priceRow(
    assetType: "rider" | "constructor" | "team",
    assetId: string,
    gpId: string,
  ) {
    return prisma.price.findFirst({ where: { assetType, assetId, gpId } });
  }

  /** Auditorías de una acción sobre una fila de precio (entityId). */
  async function auditsFor(action: string, priceRowId: string) {
    // `orderBy` explícito: sin él Postgres no garantiza el orden de las filas
    // (índice `(entity, entityId)` sin clave de desempate) y las aserciones
    // por posición (`audits[1]`) serían inestables.
    return prisma.auditLog.findMany({
      where: { action, entityId: priceRowId },
      orderBy: { createdAt: "asc" },
    });
  }

  /** Resultados definitivos de la carrera de gp1 (r1 P1, r2 P2, r3 P3, DNF). */
  async function createDefinitiveResults() {
    const mk = (riderId: string, position: number | null) =>
      prisma.result.create({
        data: { gpId: gp1Id, eventId: gp1RaceId, riderId, position, status: "definitive" },
      });
    await mk(r1Id, 1); // 25 + 5 (vencedor) = 30 pts
    await mk(r2Id, 2); // 20 pts
    await mk(r3Id, 3); // 16 pts
    await mk(world.riders[3].id, null); // DNF (posición null → 0 pts)
  }

  /** Huella de las filas de precio de gp2 (para afirmar BD inalterada). */
  async function gp2Fingerprint() {
    const rows = await prisma.price.findMany({ where: { gpId: gp2Id } });
    return rows.map((r) => `${r.assetType}:${r.assetId}=${r.price}`).sort();
  }

  // ── applyFormula: fórmula v1 ───────────────────────────────────────────────

  it("applyFormula sin resultados definitivos → PRECONDITION_FAILED", async () => {
    const { market } = await callerFor(ADMIN_IP, adminToken);
    await expect(market.prices.applyFormula({ gpId: gp1Id })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  it("applyFormula crea los precios del siguiente GP (valores golden, motivo formula)", async () => {
    await createDefinitiveResults();
    const { market } = await callerFor(ADMIN_IP, adminToken);
    const result = await market.prices.applyFormula({ gpId: gp1Id });

    expect(result).toEqual({
      targetGpId: gp2Id,
      targetGpRound: 2,
      created: 3,
      updated: 0,
      unchanged: 0,
      skippedNoOpening: 5, // los 5 activos sin P0
      skippedLocked: false,
    });

    // Fila de r1: 20, motivo formula, rulesVersion pricing-v1, createdBy null.
    const rowR1 = await priceRow("rider", r1Id, gp2Id);
    expect(rowR1).not.toBeNull();
    expect(rowR1).toMatchObject({
      price: expect.anything(),
      reason: "formula",
      rulesVersion: "pricing-v1",
      createdBy: null,
    });
    expect(Number(rowR1!.price)).toBe(20);
    // ctor: 14.69 y team: 11.75 (media top-2 del grupo: (30+20)/2=25).
    expect(Number((await priceRow("constructor", world.ctor.id, gp2Id))!.price)).toBe(14.69);
    expect(Number((await priceRow("team", world.team.id, gp2Id))!.price)).toBe(11.75);
    // Sin P0 → sin fila (r2, por ejemplo).
    expect(await priceRow("rider", r2Id, gp2Id)).toBeNull();
  });

  it("applyFormula es idempotente: re-ejecutar no crea ni cambia nada", async () => {
    const { market } = await callerFor(ADMIN_IP, adminToken);
    const result = await market.prices.applyFormula({ gpId: gp1Id });
    expect(result).toMatchObject({ created: 0, updated: 0, unchanged: 3 });
    expect(await priceRow("rider", r1Id, gp2Id)).toMatchObject({
      reason: "formula",
      rulesVersion: "pricing-v1",
    });
  });

  it("corrección de resultados → recálculo actualiza y audita price.formula_recompute", async () => {
    // r1 pasa de P1 (30 pts) a P3 (16 pts): el grupo (ctor/team) también cambia.
    await prisma.result.updateMany({
      where: { gpId: gp1Id, riderId: r1Id },
      data: { position: 3 },
    });
    const { market } = await callerFor(ADMIN_IP, adminToken);
    const result = await market.prices.applyFormula({ gpId: gp1Id });
    expect(result).toMatchObject({ created: 0, updated: 3, unchanged: 0 });

    // Valores corregidos: r1 18.83, ctor 14.25, team 11.40.
    expect(Number((await priceRow("rider", r1Id, gp2Id))!.price)).toBe(18.83);
    expect(Number((await priceRow("constructor", world.ctor.id, gp2Id))!.price)).toBe(14.25);
    expect(Number((await priceRow("team", world.team.id, gp2Id))!.price)).toBe(11.4);

    // Auditoría por fila: actor sistema (null), before/after.
    const rowR1 = await priceRow("rider", r1Id, gp2Id);
    const audits = await auditsFor("price.formula_recompute", rowR1!.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorId: null,
      entity: "price",
      beforeData: { price: 20 },
      afterData: expect.objectContaining({ price: 18.83, gpId: gp2Id }),
    });
  });

  it("sin siguiente GP (último de la temporada) → no-op con targetGpId null", async () => {
    const { market } = await callerFor(ADMIN_IP, adminToken);
    const result = await market.prices.applyFormula({ gpId: gp3Id });
    expect(result).toEqual({
      targetGpId: null,
      targetGpRound: null,
      created: 0,
      updated: 0,
      unchanged: 0,
      skippedNoOpening: 0,
      skippedLocked: false,
    });
  });

  // ── Gate de lockout (CA US-08: los precios no cambian durante el lockout) ──

  it("GP objetivo locked → la fórmula no toca la BD (skippedLocked)", async () => {
    const before = await gp2Fingerprint();
    await prisma.gp.update({ where: { id: gp2Id }, data: { status: "locked" } });

    const { market } = await callerFor(ADMIN_IP, adminToken);
    const result = await market.prices.applyFormula({ gpId: gp1Id });
    expect(result).toMatchObject({ targetGpId: gp2Id, skippedLocked: true });

    // BD inalterada: mismas filas y precios que antes del intento.
    expect(await gp2Fingerprint()).toEqual(before);
  });

  it("GP locked → el ajuste manual se rechaza y no modifica la BD (CA US-08)", async () => {
    const before = await gp2Fingerprint();
    const { market } = await callerFor(ADMIN_IP, adminToken);
    await expect(
      market.prices.setManual({ assetType: "rider", assetId: r1Id, gpId: gp2Id, price: 99 }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await gp2Fingerprint()).toEqual(before);
  });

  // ── setManual: ajuste manual auditado ──────────────────────────────────────

  it("setManual crea una fila manual (reason manual, createdBy actor, auditado)", async () => {
    await prisma.gp.update({ where: { id: gp2Id }, data: { status: "scheduled" } });
    const { market } = await callerFor(ADMIN_IP, adminToken);
    const result = await market.prices.setManual({
      assetType: "rider",
      assetId: r3Id,
      gpId: gp2Id,
      price: 5,
    });
    expect(result).toEqual({ price: 5, status: "created" });

    const row = await priceRow("rider", r3Id, gp2Id);
    expect(row).toMatchObject({
      reason: "manual",
      rulesVersion: null,
      createdBy: expect.any(String),
    });
    expect(Number(row!.price)).toBe(5);

    // Auditoría price.manual_set: actor, before=null (creación), after.
    const audits = await auditsFor("price.manual_set", row!.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorId: row!.createdBy,
      entity: "price",
      beforeData: null,
      afterData: { assetType: "rider", assetId: r3Id, gpId: gp2Id, price: 5 },
      ip: ADMIN_IP,
    });
  });

  it("setManual con otro valor actualiza y audita before/after", async () => {
    const { market } = await callerFor(ADMIN_IP, adminToken);
    const result = await market.prices.setManual({
      assetType: "rider",
      assetId: r3Id,
      gpId: gp2Id,
      price: 6,
    });
    expect(result).toEqual({ price: 6, status: "updated" });

    const row = await priceRow("rider", r3Id, gp2Id);
    expect(Number(row!.price)).toBe(6);
    const audits = await auditsFor("price.manual_set", row!.id);
    expect(audits).toHaveLength(2);
    expect(audits[1]).toMatchObject({
      beforeData: { price: 5 },
      afterData: expect.objectContaining({ price: 6 }),
    });
  });

  it("setManual con el mismo valor es no-op (sin auditoría nueva)", async () => {
    const { market } = await callerFor(ADMIN_IP, adminToken);
    const result = await market.prices.setManual({
      assetType: "rider",
      assetId: r3Id,
      gpId: gp2Id,
      price: 6,
    });
    expect(result).toEqual({ price: 6, status: "unchanged" });
    const row = await priceRow("rider", r3Id, gp2Id);
    expect(await auditsFor("price.manual_set", row!.id)).toHaveLength(2);
  });

  it("setManual sobre una fila de fórmula la sustituye (reason manual, rulesVersion null)", async () => {
    const { market } = await callerFor(ADMIN_IP, adminToken);
    const result = await market.prices.setManual({
      assetType: "rider",
      assetId: r1Id,
      gpId: gp2Id,
      price: 19,
    });
    expect(result).toEqual({ price: 19, status: "updated" });

    const row = await priceRow("rider", r1Id, gp2Id);
    expect(row).toMatchObject({ reason: "manual", rulesVersion: null });
    expect(Number(row!.price)).toBe(19);
    // La auditoría de manual_set referencia la misma fila (entityId).
    const audits = await auditsFor("price.manual_set", row!.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ beforeData: { price: 18.83 } });
  });

  // ── RBAC y casos límite ────────────────────────────────────────────────────

  it("un usuario normal no puede setManual ni applyFormula (403)", async () => {
    const { market } = await callerFor(USER_IP, userToken);
    await expect(
      market.prices.setManual({ assetType: "rider", assetId: r1Id, gpId: gp2Id, price: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(market.prices.applyFormula({ gpId: gp1Id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("setManual con activo o GP inexistente → NOT_FOUND", async () => {
    const { market } = await callerFor(ADMIN_IP, adminToken);
    await expect(
      market.prices.setManual({
        assetType: "rider",
        assetId: randomUUID(),
        gpId: gp2Id,
        price: 1,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      market.prices.setManual({ assetType: "rider", assetId: r1Id, gpId: randomUUID(), price: 1 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("applyFormula con GP inexistente → NOT_FOUND", async () => {
    const { market } = await callerFor(ADMIN_IP, adminToken);
    await expect(market.prices.applyFormula({ gpId: randomUUID() })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
