/**
 * US-04 · Temporadas con `season_rules` versionado (PostgreSQL real).
 *
 * Mismo patrón que `rbac.test.ts`: los módulos de la app leen el entorno al
 * importar (singletons de Prisma y Redis), así que `DATABASE_URL` y
 * `REDIS_URL` se fijan ANTES del `import()` dinámico. El router de auth se
 * monta con `bootstrapAdminEmail` (ADR-0010) para crear el `global_admin`
 * del test; el router `seasons` es inyectable (se monta con la BD efímera).
 *
 * Criterio de aceptación (backlog US-04): la temporada guarda
 * `season_rules` versionado (JSONB) y crear una segunda versión NO muta la
 * primera (unique `(season, version)`).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PROVISIONAL_SEASON_RULES } from "../../app/shared/config/season-rules";

import { CapturingEmailSender, createPrisma, integrationDbUrl } from "./helpers";

// Antes de importar los módulos de la app (sus singletons leen env al cargar).
process.env.DATABASE_URL = integrationDbUrl();
process.env.REDIS_URL ??= "redis://localhost:6379/0"; // dummy: lazyConnect, no se conecta

const { createAuthRouter } = await import("../../app/server/routers/auth");
const { createSeasonsRouter } = await import("../../app/server/routers/seasons");
const { createContext } = await import("../../app/server/trpc");
const { InMemoryRateLimitStore } = await import("../../app/modules/identity");

const suffix = randomUUID().slice(0, 8);
const email = (name: string) => `${name}-${suffix}@test.local`;
const username = (name: string) => `${name}_${suffix}`;
const PASSWORD = "contraseña-segura-1";
const ADMIN_EMAIL = email("admin");
const ADMIN_IP = "198.51.100.20";
const USER_IP = "198.51.100.21";
const SEASON_NAME = `Temporada Test ${suffix}`;

describe("US-04 · Temporadas y season_rules versionado (PostgreSQL real)", () => {
  let prisma: ReturnType<typeof createPrisma>;
  let authRouter: ReturnType<typeof createAuthRouter>;
  let seasonsRouter: ReturnType<typeof createSeasonsRouter>;
  let adminId: string;
  let adminToken: string;
  let userToken: string;
  let seasonId: string;
  let version2Id: string;

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
    seasonsRouter = createSeasonsRouter({ prisma });

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
    const req = new Request("http://localhost/api/trpc/seasons", {
      method: "POST",
      headers,
    });
    const ctx = await createContext(req, prisma);
    return {
      ctx,
      auth: authRouter.createCaller(ctx),
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

  it("un admin crea una temporada con su primera versión de reglas (auditoría season.created)", async () => {
    const { seasons } = await callerFor(ADMIN_IP, adminToken);
    const season = await seasons.create({
      name: SEASON_NAME,
      year: 2026,
      startDate: new Date("2026-02-28T00:00:00Z"),
      endDate: new Date("2026-11-08T00:00:00Z"),
      rules: PROVISIONAL_SEASON_RULES,
    });

    seasonId = season.id;
    expect(season.name).toBe(SEASON_NAME);
    expect(season.year).toBe(2026);
    expect(season.status).toBe("planned");
    expect(season.startDate?.toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(season.endDate?.toISOString()).toBe("2026-11-08T00:00:00.000Z");
    expect(season.rules).toHaveLength(1);
    expect(season.rules[0]?.version).toBe(PROVISIONAL_SEASON_RULES.rulesVersion);
    // El JSONB viaja íntegro (round-trip).
    expect(season.rules[0]?.rules).toEqual(PROVISIONAL_SEASON_RULES);

    // Auditoría (T-09): una entrada `season.created` con actor e IP.
    const audit = await prisma.auditLog.findMany({
      where: { action: "season.created", entityId: seasonId },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: adminId,
      entity: "season",
      ip: ADMIN_IP,
    });
  });

  it("una segunda versión de reglas NO muta la primera (AGENTS.md §5)", async () => {
    const v2 = {
      ...PROVISIONAL_SEASON_RULES,
      rulesVersion: "provisional-v2",
      economy: { ...PROVISIONAL_SEASON_RULES.economy, B: 105 },
    };
    const { seasons } = await callerFor(ADMIN_IP, adminToken);
    const added = await seasons.addRulesVersion({ seasonId, rules: v2 });
    version2Id = added.id;
    expect(added.version).toBe("provisional-v2");

    const season = await seasons.get({ seasonId });
    expect(season.rules).toHaveLength(2);
    // Orden cronológico: v1 primero, intacta.
    expect(season.rules[0]?.version).toBe(PROVISIONAL_SEASON_RULES.rulesVersion);
    expect(season.rules[0]?.rules).toEqual(PROVISIONAL_SEASON_RULES);
    // v2 con el cambio.
    expect(season.rules[1]?.version).toBe("provisional-v2");
    expect(season.rules[1]?.rules).toEqual(v2);

    // Auditoría (T-09): entrada `season.rules_version_added` sobre la nueva fila.
    const audit = await prisma.auditLog.findMany({
      where: { action: "season.rules_version_added", entityId: version2Id },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: adminId,
      entity: "season_rules",
      ip: ADMIN_IP,
    });
  });

  it("rechaza un duplicado (season, version) con CONFLICT (sin fila nueva)", async () => {
    const v2 = {
      ...PROVISIONAL_SEASON_RULES,
      rulesVersion: "provisional-v2",
      economy: { ...PROVISIONAL_SEASON_RULES.economy, B: 105 },
    };
    const { seasons } = await callerFor(ADMIN_IP, adminToken);
    await expect(seasons.addRulesVersion({ seasonId, rules: v2 })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const count = await prisma.seasonRule.count({ where: { seasonId } });
    expect(count).toBe(2);
  });

  it("rechaza un payload de reglas inválido con BAD_REQUEST (no se persiste nada)", async () => {
    const invalid = {
      ...PROVISIONAL_SEASON_RULES,
      economy: { ...PROVISIONAL_SEASON_RULES.economy, B: -1 },
    };
    const { seasons } = await callerFor(ADMIN_IP, adminToken);
    await expect(
      seasons.create({
        name: `Temporada Inválida ${suffix}`,
        year: 2027,
        rules: invalid,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const count = await prisma.season.count({
      where: { name: `Temporada Inválida ${suffix}` },
    });
    expect(count).toBe(0);
  });

  it("un usuario normal no crea temporadas (403 FORBIDDEN)", async () => {
    const { seasons } = await callerFor(USER_IP, userToken);
    await expect(
      seasons.create({
        name: `Temporada Usuario ${suffix}`,
        year: 2027,
        rules: PROVISIONAL_SEASON_RULES,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("sin sesión, create rechaza con UNAUTHORIZED", async () => {
    const { seasons } = await callerFor(ADMIN_IP);
    await expect(
      seasons.create({
        name: `Temporada Anónima ${suffix}`,
        year: 2027,
        rules: PROVISIONAL_SEASON_RULES,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("get con una temporada inexistente → NOT_FOUND", async () => {
    const { seasons } = await callerFor(ADMIN_IP, adminToken);
    await expect(seasons.get({ seasonId: randomUUID() })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("addRulesVersion con una temporada inexistente → NOT_FOUND", async () => {
    const { seasons } = await callerFor(ADMIN_IP, adminToken);
    await expect(
      seasons.addRulesVersion({
        seasonId: randomUUID(),
        rules: PROVISIONAL_SEASON_RULES,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("un usuario normal puede listar y consultar temporadas (lectura pública)", async () => {
    const { seasons } = await callerFor(USER_IP, userToken);
    const list = await seasons.list();
    expect(list.some((s) => s.id === seasonId)).toBe(true);

    const season = await seasons.get({ seasonId });
    expect(season.id).toBe(seasonId);
    expect(season.rules).toHaveLength(2);
  });
});
