/**
 * T-08 · RBAC y autorización por recurso (PostgreSQL real).
 *
 * Mismo patrón que `auth.test.ts`: los módulos de la app leen el entorno al
 * importar (singletons de Prisma y Redis), así que `DATABASE_URL` y
 * `REDIS_URL` se fijan ANTES del `import()` dinámico. El router de auth se
 * monta con `bootstrapAdminEmail` (ADR-0010) para crear el `global_admin`
 * del test; el router `admin` es el de producción (no inyecta dependencias).
 *
 * La suite IDOR (lineups, ligas) crece con cada módulo: cada router nuevo
 * trae sus tests por recurso en su DoD (AGENTS.md §8, CA de T-08).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CapturingEmailSender, createPrisma, integrationDbUrl } from "./helpers";

// Antes de importar los módulos de la app (sus singletons leen env al cargar).
process.env.DATABASE_URL = integrationDbUrl();
process.env.REDIS_URL ??= "redis://localhost:6379/0"; // dummy: lazyConnect, no se conecta

const { createAuthRouter } = await import("../../app/server/routers/auth");
const { adminRouter } = await import("../../app/server/routers/admin");
const { createContext } = await import("../../app/server/trpc");
const { InMemoryRateLimitStore } = await import("../../app/modules/identity");

const suffix = randomUUID().slice(0, 8);
const email = (name: string) => `${name}-${suffix}@test.local`;
const username = (name: string) => `${name}_${suffix}`;
const PASSWORD = "contraseña-segura-1";
const BOOTSTRAP_EMAIL = email("admin");

describe("T-08 · RBAC (PostgreSQL real)", () => {
  let prisma: ReturnType<typeof createPrisma>;
  let authRouter: ReturnType<typeof createAuthRouter>;

  beforeAll(() => {
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
      bootstrapAdminEmail: BOOTSTRAP_EMAIL,
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Contexto tRPC para una petición simulada (IP + cookie de sesión opcional). */
  async function callerFor(ip: string, sessionToken?: string) {
    const headers: Record<string, string> = { "x-forwarded-for": ip };
    if (sessionToken !== undefined) headers.cookie = `session=${sessionToken}`;
    const req = new Request("http://localhost/api/trpc/auth", {
      method: "POST",
      headers,
    });
    const ctx = await createContext(req, prisma);
    return {
      ctx,
      auth: authRouter.createCaller(ctx),
      admin: adminRouter.createCaller(ctx),
    };
  }

  /** Extrae el token de la cookie de sesión emitida en `ctx.pendingCookies`. */
  function sessionTokenFrom(ctx: { pendingCookies: string[] }): string {
    expect(ctx.pendingCookies).toHaveLength(1);
    const token = /^session=([0-9a-f]{64});/.exec(ctx.pendingCookies[0] ?? "")?.[1];
    if (!token) throw new Error(`Cookie de sesión inesperada: ${ctx.pendingCookies[0]}`);
    return token;
  }

  it("un user no accede al router de admin (403 FORBIDDEN)", async () => {
    const reg = await callerFor("198.51.100.1");
    const { user } = await reg.auth.register({
      email: email("maria"),
      username: username("maria"),
      password: PASSWORD,
      termsAccepted: true,
    });
    expect(user.roles).toEqual(["user"]);

    const { admin } = await callerFor("198.51.100.1", sessionTokenFrom(reg.ctx));
    await expect(admin.me()).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "No tienes permisos para acceder al panel de administración.",
    });
  });

  it("el registro con el email de bootstrap (ADR-0010) recibe global_admin y accede a admin.me", async () => {
    const reg = await callerFor("198.51.100.2");
    const { user } = await reg.auth.register({
      email: BOOTSTRAP_EMAIL,
      username: username("admin"),
      password: PASSWORD,
      termsAccepted: true,
    });
    expect(user.roles).toEqual(expect.arrayContaining(["user", "global_admin"]));

    // En BD: exactamente dos roles (user + global_admin).
    const row = await prisma.user.findUniqueOrThrow({
      where: { email: BOOTSTRAP_EMAIL },
      include: { userRoles: { include: { role: true } } },
    });
    expect(row.userRoles.map((ur) => ur.role.name).sort()).toEqual([
      "global_admin",
      "user",
    ]);

    const { admin } = await callerFor("198.51.100.2", sessionTokenFrom(reg.ctx));
    const me = await admin.me();
    expect(me).toMatchObject({
      email: BOOTSTRAP_EMAIL,
      roles: expect.arrayContaining(["global_admin"]),
    });
  });

  it("sin sesión, admin.me rechaza con UNAUTHORIZED (la sesión se valida antes que el rol)", async () => {
    const { admin } = await callerFor("198.51.100.3");
    await expect(admin.me()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "No estás autenticado",
    });
  });
});
