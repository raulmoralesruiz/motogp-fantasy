/**
 * T-09 · Auditoría append-only (PostgreSQL real).
 *
 * Verifica los CA: una acción sensible crea una entrada con
 * actor/acción/entidad/antes/después/IP/timestamp, y la app no puede
 * actualizar ni borrar entradas. La garantía vive en el trigger de BD
 * (no en la app): los tests intentan UPDATE/DELETE directamente vía
 * Prisma y esperan la excepción.
 *
 * Mismo patrón que `rbac.test.ts`: los módulos de la app leen el entorno
 * al importar (singletons de Prisma y Redis), así que `DATABASE_URL` y
 * `REDIS_URL` se fijan ANTES del `import()` dinámico. Las aserciones se
 * filtran por actor propio (los archivos de test corren en paralelo sobre
 * la misma BD efímera).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { appendAudit } from "../../app/modules/admin";
import { CapturingEmailSender, createPrisma, integrationDbUrl } from "./helpers";

// Antes de importar los módulos de la app (sus singletons leen env al cargar).
process.env.DATABASE_URL = integrationDbUrl();
process.env.REDIS_URL ??= "redis://localhost:6379/0"; // dummy: lazyConnect, no se conecta

const { createAuthRouter } = await import("../../app/server/routers/auth");
const { createContext } = await import("../../app/server/trpc");
const { InMemoryRateLimitStore } = await import("../../app/modules/identity");

const suffix = randomUUID().slice(0, 8);
const email = (name: string) => `${name}-${suffix}@test.local`;
const username = (name: string) => `${name}_${suffix}`;
const PASSWORD = "contraseña-segura-1";
const BOOTSTRAP_EMAIL = email("admin");

describe("T-09 · Auditoría append-only (PostgreSQL real)", () => {
  let prisma: ReturnType<typeof createPrisma>;
  let authRouter: ReturnType<typeof createAuthRouter>;
  let entryId: string;

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

  /** Contexto tRPC para una petición simulada (IP). */
  async function callerFor(ip: string) {
    const req = new Request("http://localhost/api/trpc/auth", {
      method: "POST",
      headers: { "x-forwarded-for": ip },
    });
    const ctx = await createContext(req, prisma);
    return authRouter.createCaller(ctx);
  }

  it("appendAudit crea la entrada dentro de la transacción (INSERT ok, todos los campos)", async () => {
    const entry = await prisma.$transaction((tx) =>
      appendAudit(tx, {
        actorId: null,
        action: "test.entry",
        entity: "test",
        entityId: `fixture-${suffix}`,
        beforeData: null,
        afterData: { ok: true },
        ip: "198.51.100.9",
      }),
    );
    entryId = entry.id;
    expect(entry).toMatchObject({
      actorId: null,
      action: "test.entry",
      entity: "test",
      entityId: `fixture-${suffix}`,
      ip: "198.51.100.9",
    });
    expect(entry.beforeData).toBeNull();
    expect(entry.afterData).toEqual({ ok: true });
    expect(entry.createdAt).toBeInstanceOf(Date);
  });

  it("UPDATE se rechaza por el trigger de BD (append-only)", async () => {
    await expect(
      prisma.auditLog.update({
        where: { id: entryId },
        data: { action: "test.hackeada" },
      }),
    ).rejects.toThrow(/append-only/);
    // La entrada sigue intacta.
    const after = await prisma.auditLog.findUniqueOrThrow({ where: { id: entryId } });
    expect(after.action).toBe("test.entry");
  });

  it("DELETE se rechaza por el trigger de BD (append-only)", async () => {
    await expect(prisma.auditLog.delete({ where: { id: entryId } })).rejects.toThrow(
      /append-only/,
    );
    // La entrada sigue existiendo.
    const after = await prisma.auditLog.findUnique({ where: { id: entryId } });
    expect(after).not.toBeNull();
  });

  it("un registro normal no crea entradas de auditoría", async () => {
    const caller = await callerFor("198.51.100.1");
    const { user } = await caller.register({
      email: email("maria"),
      username: username("maria"),
      password: PASSWORD,
      termsAccepted: true,
    });
    const rows = await prisma.auditLog.findMany({ where: { actorId: user.id } });
    expect(rows).toHaveLength(0);
  });

  it("el registro de bootstrap (T-08) crea la entrada role.bootstrap_admin", async () => {
    const caller = await callerFor("198.51.100.2");
    await caller.register({
      email: BOOTSTRAP_EMAIL,
      username: username("admin"),
      password: PASSWORD,
      termsAccepted: true,
    });

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: BOOTSTRAP_EMAIL },
    });
    const role = await prisma.role.findUniqueOrThrow({ where: { name: "global_admin" } });
    const rows = await prisma.auditLog.findMany({
      where: { action: "role.bootstrap_admin", actorId: user.id },
    });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (!row) throw new Error("Falta la entrada de auditoría del bootstrap");
    expect(row).toMatchObject({
      actorId: user.id,
      action: "role.bootstrap_admin",
      entity: "role",
      entityId: role.id,
      ip: "198.51.100.2",
    });
    expect(row.afterData).toEqual({
      userId: user.id,
      roleId: role.id,
      email: BOOTSTRAP_EMAIL,
    });
  });
});
