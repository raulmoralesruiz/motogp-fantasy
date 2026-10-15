/**
 * US-01 · Registro y login contra PostgreSQL real (Testcontainers).
 *
 * Los módulos de la app leen el entorno al importar (singletons de Prisma y
 * Redis), así que `DATABASE_URL` y `REDIS_URL` se fijan ANTES del `import()`
 * dinámico. El router se monta con la BD de tests y un store de rate limit en
 * memoria (reloj inyectable): el store de Redis queda cubierto por los unit
 * tests de la lógica pura, y aquí se prueba la capa tRPC sin pasar por HTTP.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrisma, integrationDbUrl } from "./helpers";

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
const WRONG_PASSWORD = "contraseña-mala-1";

const SESSION_TTL_SEC = 3600;
const RATE_CFG = {
  maxPerWindow: 5,
  windowSec: 60,
  lockoutThreshold: 3,
  lockoutSec: 900,
};

describe("US-01 · registro y login (PostgreSQL real)", () => {
  let prisma: ReturnType<typeof createPrisma>;
  let store: InstanceType<typeof InMemoryRateLimitStore>;
  let authRouter: ReturnType<typeof createAuthRouter>;

  beforeAll(() => {
    prisma = createPrisma();
    store = new InMemoryRateLimitStore();
    authRouter = createAuthRouter({
      prisma,
      rateLimit: store,
      sessionTtlSec: SESSION_TTL_SEC,
      secureCookie: true,
      rateLimitCfg: RATE_CFG,
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
    return { ctx, caller: authRouter.createCaller(ctx) };
  }

  /** Extrae el token de la cookie de sesión emitida en `ctx.pendingCookies`. */
  function sessionTokenFrom(ctx: { pendingCookies: string[] }): string {
    expect(ctx.pendingCookies).toHaveLength(1);
    const token = /^session=([0-9a-f]{64});/.exec(ctx.pendingCookies[0] ?? "")?.[1];
    if (!token) throw new Error(`Cookie de sesión inesperada: ${ctx.pendingCookies[0]}`);
    return token;
  }

  it("registro: crea usuario con hash argon2 (nunca en claro) y cookie de sesión con flags", async () => {
    const { ctx, caller } = await callerFor("192.0.2.1");
    const { user } = await caller.register({
      email: email("ana"),
      username: username("ana"),
      password: PASSWORD,
      termsAccepted: true,
    });

    // Proyección pública (sin datos sensibles).
    expect(user.email).toBe(email("ana"));
    expect(user.username).toBe(username("ana"));
    expect(user.roles).toContain("user");

    // CA: la contraseña se guarda con hash argon2 (verificado inspeccionando la BD).
    const row = await prisma.user.findUniqueOrThrow({ where: { email: email("ana") } });
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row.passwordHash).not.toContain(PASSWORD);

    // CA: cookie HttpOnly + Secure + SameSite=Lax.
    const token = sessionTokenFrom(ctx);
    expect(ctx.pendingCookies[0]).toBe(
      `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SEC}; Secure`,
    );
  });

  it("registro: rechaza email y username duplicados con mensaje explícito", async () => {
    const { caller } = await callerFor("192.0.2.2");
    await expect(
      caller.register({
        email: email("ana"),
        username: username("otro"),
        password: PASSWORD,
        termsAccepted: true,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "El email ya está registrado." });

    await expect(
      caller.register({
        email: email("otro"),
        username: username("ana"),
        password: PASSWORD,
        termsAccepted: true,
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "El nombre de usuario ya está en uso.",
    });
  });

  it("registro: rechaza términos no aceptados y entradas inválidas", async () => {
    const { caller } = await callerFor("192.0.2.3");
    await expect(
      caller.register({
        email: email("borrador"),
        username: username("borrador"),
        password: PASSWORD,
        termsAccepted: false,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await expect(
      caller.register({
        email: "no-es-un-email",
        username: "x",
        password: "corta",
        termsAccepted: true,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("login: credenciales correctas emiten cookie de sesión", async () => {
    const { ctx, caller } = await callerFor("192.0.2.4");
    const { user } = await caller.login({ email: email("ana"), password: PASSWORD });
    expect(user.email).toBe(email("ana"));
    expect(ctx.pendingCookies).toHaveLength(1);
  });

  it("login: credenciales incorrectas (y email inexistente) rechazan sin revelar qué falla", async () => {
    const { caller } = await callerFor("192.0.2.5");
    await expect(
      caller.login({ email: email("ana"), password: WRONG_PASSWORD }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", message: "Credenciales incorrectas." });

    await expect(
      caller.login({ email: email("inexistente"), password: PASSWORD }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", message: "Credenciales incorrectas." });
  });

  it("me: cookie válida devuelve al usuario; sin cookie, falsa o expirada rechaza", async () => {
    // Cookie válida (login real).
    const login = await callerFor("192.0.2.6");
    await login.caller.login({ email: email("ana"), password: PASSWORD });
    const token = sessionTokenFrom(login.ctx);

    const me = await callerFor("192.0.2.6", token);
    const user = await me.caller.me();
    expect(user).toMatchObject({ email: email("ana"), username: username("ana") });

    // Sin cookie.
    const anon = await callerFor("192.0.2.7");
    await expect(anon.caller.me()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "No estás autenticado",
    });

    // Cookie falsa (token que no existe en la BD).
    const fake = await callerFor("192.0.2.7", "f".repeat(64));
    await expect(fake.caller.me()).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    // Sesión expirada (creada directamente en la BD).
    const row = await prisma.user.findUniqueOrThrow({ where: { email: email("ana") } });
    const expired = await prisma.session.create({
      data: {
        userId: row.id,
        token: "e".repeat(64),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const expiredCtx = await callerFor("192.0.2.7", expired.token);
    await expect(expiredCtx.caller.me()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("bloqueo temporal: tras N fallos la cuenta queda bloqueada (aunque la contraseña sea correcta) hasta que expira", async () => {
    store.setNow(0);
    const account = email("lock");
    const setup = await callerFor("192.0.2.10");
    await setup.caller.register({
      email: account,
      username: username("lock"),
      password: PASSWORD,
      termsAccepted: true,
    });

    // Fallos consecutivos hasta umbral - 1.
    for (let i = 0; i < RATE_CFG.lockoutThreshold - 1; i++) {
      const { caller } = await callerFor("192.0.2.10");
      await expect(
        caller.login({ email: account, password: WRONG_PASSWORD }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED", message: "Credenciales incorrectas." });
    }

    // El intento que alcanza el umbral ya responde con el bloqueo.
    const triggering = await callerFor("192.0.2.10");
    await expect(
      triggering.caller.login({ email: account, password: WRONG_PASSWORD }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Demasiados intentos fallidos. Vuelve a intentarlo en 15 min.",
    });

    // Bloqueado: ni siquiera la contraseña correcta funciona.
    const locked = await callerFor("192.0.2.11");
    await expect(
      locked.caller.login({ email: account, password: PASSWORD }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Al expirar el bloqueo (reloj del store), la cuenta vuelve a funcionar.
    store.setNow(RATE_CFG.lockoutSec * 1000 + 1000);
    const unlocked = await callerFor("192.0.2.11");
    const { user } = await unlocked.caller.login({ email: account, password: PASSWORD });
    expect(user.email).toBe(account);
  });

  it("rate limit por IP: permite hasta el máximo por ventana, rechaza el siguiente y no afecta a otras IPs", async () => {
    store.setNow(1_000_000);
    const ip = "192.0.2.20";

    for (let i = 0; i < RATE_CFG.maxPerWindow; i++) {
      const { caller } = await callerFor(ip);
      const { user } = await caller.login({ email: email("ana"), password: PASSWORD });
      expect(user.email).toBe(email("ana"));
    }

    const blocked = await callerFor(ip);
    await expect(
      blocked.caller.login({ email: email("ana"), password: PASSWORD }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      blocked.caller.login({ email: email("ana"), password: PASSWORD }),
    ).rejects.toThrow(/demasiadas peticiones\. Inténtalo de nuevo en \d+ s\./);

    // Otra IP no se ve afectada.
    const other = await callerFor("192.0.2.21");
    const { user } = await other.caller.login({ email: email("ana"), password: PASSWORD });
    expect(user.email).toBe(email("ana"));

    // Al expirar la ventana, la IP rate-limited puede reintentar.
    store.setNow(1_000_000 + (RATE_CFG.windowSec + 1) * 1000);
    const retry = await callerFor(ip);
    const { user: retried } = await retry.caller.login({
      email: email("ana"),
      password: PASSWORD,
    });
    expect(retried.email).toBe(email("ana"));
  });
});
