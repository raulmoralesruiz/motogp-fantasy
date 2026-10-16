/**
 * US-02 · Cierre de sesión y recuperación de contraseña (PostgreSQL real).
 *
 * Mismo patrón que `auth.test.ts`: el entorno se fija ANTES del `import()`
 * dinámico (los singletons de la app leen env al cargar); el router se monta
 * con la BD de tests, un store de rate limit en memoria (reloj inyectable) y
 * un `EmailSender` de captura (sin I/O real).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CapturingEmailSender, createPrisma, integrationDbUrl } from "./helpers";

// Antes de importar los módulos de la app (sus singletons leen env al cargar).
process.env.DATABASE_URL = integrationDbUrl();
process.env.REDIS_URL ??= "redis://localhost:6379/0"; // dummy: lazyConnect, no se conecta

const { createAuthRouter } = await import("../../app/server/routers/auth");
const { createContext } = await import("../../app/server/trpc");
const { hashResetToken, InMemoryRateLimitStore } =
  await import("../../app/modules/identity");

const suffix = randomUUID().slice(0, 8);
const email = (name: string) => `${name}-${suffix}@test.local`;
const username = (name: string) => `${name}_${suffix}`;
const PASSWORD = "contraseña-segura-1";
const NEW_PASSWORD = "nueva-contraseña-1";

const APP_URL = "http://localhost:3000";
const SESSION_TTL_SEC = 3600;
const RATE_CFG = {
  maxPerWindow: 5,
  windowSec: 60,
  lockoutThreshold: 3,
  lockoutSec: 900,
};
const RESET_CFG = { tokenTtlSec: 3600, maxPerWindow: 3, windowSec: 300 };

const GENERIC_RESET_MESSAGE =
  "Si el email está registrado, recibirás un enlace de recuperación.";
const INVALID_TOKEN_MESSAGE = "El enlace de recuperación no es válido o ha caducado.";

describe("US-02 · logout y recuperación de contraseña (PostgreSQL real)", () => {
  let prisma: ReturnType<typeof createPrisma>;
  let store: InstanceType<typeof InMemoryRateLimitStore>;
  let emailSender: CapturingEmailSender;
  let authRouter: ReturnType<typeof createAuthRouter>;

  beforeAll(() => {
    prisma = createPrisma();
    store = new InMemoryRateLimitStore();
    emailSender = new CapturingEmailSender();
    authRouter = createAuthRouter({
      prisma,
      rateLimit: store,
      sessionTtlSec: SESSION_TTL_SEC,
      secureCookie: true,
      rateLimitCfg: RATE_CFG,
      emailSender,
      appUrl: APP_URL,
      resetCfg: RESET_CFG,
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

  /** Extrae el token de recuperación del link enviado al "email". */
  function tokenFromLink(link: string): string {
    const token = new URL(link).searchParams.get("token");
    if (!token) throw new Error(`Link sin token: ${link}`);
    return token;
  }

  function lastSent(): { to: string; link: string } {
    const mail = emailSender.sent[emailSender.sent.length - 1];
    if (!mail) throw new Error("No se capturó ningún email");
    return mail;
  }

  function lastSentLink(): string {
    return lastSent().link;
  }

  // ─── Logout ────────────────────────────────────────────────────────────────

  it("logout: revoca la sesión en BD, limpia la cookie y la sesión deja de funcionar", async () => {
    const reg = await callerFor("203.0.113.1");
    await reg.caller.register({
      email: email("out"),
      username: username("out"),
      password: PASSWORD,
      termsAccepted: true,
    });
    const token = sessionTokenFrom(reg.ctx);

    const out = await callerFor("203.0.113.1", token);
    await out.caller.logout();

    // CA: la cookie se limpia (valor vacío + Max-Age=0, mismos flags).
    expect(out.ctx.pendingCookies).toHaveLength(1);
    expect(out.ctx.pendingCookies[0]).toBe(
      `session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`,
    );

    // CA: la sesión queda revocada en la BD.
    const row = await prisma.session.findUniqueOrThrow({ where: { token } });
    expect(row.revokedAt).toBeInstanceOf(Date);

    // La sesión ya no funciona.
    const after = await callerFor("203.0.113.1", token);
    await expect(after.caller.me()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("logout: sin sesión activa → UNAUTHORIZED (guard de autenticación)", async () => {
    const anon = await callerFor("203.0.113.2");
    await expect(anon.caller.logout()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "No estás autenticado",
    });
  });

  // ─── requestReset ──────────────────────────────────────────────────────────

  it("requestReset: email registrado → token en BD como SHA-256 (nunca el claro) + email con el link", async () => {
    store.setNow(0);
    const reg = await callerFor("203.0.113.10");
    await reg.caller.register({
      email: email("reset"),
      username: username("reset"),
      password: PASSWORD,
      termsAccepted: true,
    });

    const { caller } = await callerFor("203.0.113.10");
    const res = await caller.requestReset({ email: email("reset") });

    // Respuesta genérica (anti-enumeración).
    expect(res.message).toBe(GENERIC_RESET_MESSAGE);

    // Email capturado con el link correcto.
    expect(emailSender.sent).toHaveLength(1);
    const mail = lastSent();
    expect(mail.to).toBe(email("reset"));
    const token = tokenFromLink(mail.link);
    expect(mail.link).toBe(`${APP_URL}/reestablecer-contrasena?token=${token}`);
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    // CA: en BD solo el SHA-256 (único), nunca el token en claro.
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: email("reset") },
    });
    const rows = await prisma.passwordResetToken.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    const row = rows[0];
    if (!row) throw new Error("No se encontró el token en BD");
    expect(row.tokenHash).toBe(hashResetToken(token));
    expect(row.tokenHash).not.toBe(token);
    expect(row.usedAt).toBeNull();

    // Vigencia configurada (± tolerancia de reloj).
    const ttlMs = row.expiresAt.getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(3500 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(RESET_CFG.tokenTtlSec * 1000);
  });

  it("requestReset: email no registrado → misma respuesta, sin token ni email (anti-enumeración)", async () => {
    store.setNow(0);
    const before = await prisma.passwordResetToken.count();
    const sentBefore = emailSender.sent.length;

    const { caller } = await callerFor("203.0.113.11");
    const res = await caller.requestReset({ email: email("inexistente") });

    expect(res.message).toBe(GENERIC_RESET_MESSAGE);
    expect(await prisma.passwordResetToken.count()).toBe(before);
    expect(emailSender.sent.length).toBe(sentBefore);
  });

  it("requestReset: cada solicitud caduca los tokens previos sin usar (gana el último)", async () => {
    store.setNow(0);
    const reg = await callerFor("203.0.113.12");
    await reg.caller.register({
      email: email("latest"),
      username: username("latest"),
      password: PASSWORD,
      termsAccepted: true,
    });

    const req1 = await callerFor("203.0.113.12");
    await req1.caller.requestReset({ email: email("latest") });
    const token1 = tokenFromLink(lastSentLink());

    const req2 = await callerFor("203.0.113.12");
    await req2.caller.requestReset({ email: email("latest") });
    const token2 = tokenFromLink(lastSentLink());
    expect(token2).not.toBe(token1);

    const row1 = await prisma.passwordResetToken.findUniqueOrThrow({
      where: { tokenHash: hashResetToken(token1) },
    });
    const row2 = await prisma.passwordResetToken.findUniqueOrThrow({
      where: { tokenHash: hashResetToken(token2) },
    });

    // El primero quedó caducado (sin consumirse); el segundo sigue vigente.
    expect(row1.usedAt).toBeNull();
    expect(row1.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(row2.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // El token caducado no sirve; el vigente, sí.
    const old = await callerFor("203.0.113.12");
    await expect(
      old.caller.resetPassword({ token: token1, password: NEW_PASSWORD }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", message: INVALID_TOKEN_MESSAGE });

    const fresh = await callerFor("203.0.113.12");
    await expect(
      fresh.caller.resetPassword({ token: token2, password: NEW_PASSWORD }),
    ).resolves.toEqual({ ok: true });
  });

  it("requestReset: rate limit por IP (máx por ventana, no afecta a otras IPs, se reinicia al expirar)", async () => {
    store.setNow(0);
    const ip = "203.0.113.13";

    for (let i = 0; i < RESET_CFG.maxPerWindow; i++) {
      const { caller } = await callerFor(ip);
      const res = await caller.requestReset({ email: email("latest") });
      expect(res.message).toBe(GENERIC_RESET_MESSAGE);
    }

    const blocked = await callerFor(ip);
    await expect(
      blocked.caller.requestReset({ email: email("latest") }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(blocked.caller.requestReset({ email: email("latest") })).rejects.toThrow(
      /demasiadas peticiones\. Inténtalo de nuevo en \d+ s\./,
    );

    // Otra IP no se ve afectada.
    const other = await callerFor("203.0.113.14");
    const res = await other.caller.requestReset({ email: email("latest") });
    expect(res.message).toBe(GENERIC_RESET_MESSAGE);

    // Al expirar la ventana, la IP rate-limited puede reintentar.
    store.setNow(RESET_CFG.windowSec * 1000 + 1000);
    const retry = await callerFor(ip);
    const retried = await retry.caller.requestReset({ email: email("latest") });
    expect(retried.message).toBe(GENERIC_RESET_MESSAGE);
  });

  // ─── resetPassword ─────────────────────────────────────────────────────────

  it("resetPassword: token válido → cambia la contraseña, marca usado y revoca todas las sesiones", async () => {
    store.setNow(0);
    const reg = await callerFor("203.0.113.20");
    await reg.caller.register({
      email: email("pw"),
      username: username("pw"),
      password: PASSWORD,
      termsAccepted: true,
    });
    const tokenA = sessionTokenFrom(reg.ctx);

    const login = await callerFor("203.0.113.21");
    await login.caller.login({ email: email("pw"), password: PASSWORD });
    const tokenB = sessionTokenFrom(login.ctx);

    const req = await callerFor("203.0.113.22");
    await req.caller.requestReset({ email: email("pw") });
    const token = tokenFromLink(lastSentLink());

    const reset = await callerFor("203.0.113.23");
    await reset.caller.resetPassword({ token, password: NEW_PASSWORD });

    // CA: el token queda marcado como usado.
    const row = await prisma.passwordResetToken.findUniqueOrThrow({
      where: { tokenHash: hashResetToken(token) },
    });
    expect(row.usedAt).toBeInstanceOf(Date);

    // CA: la contraseña cambió (la antigua falla, la nueva funciona).
    const oldLogin = await callerFor("203.0.113.21");
    await expect(
      oldLogin.caller.login({ email: email("pw"), password: PASSWORD }),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message: "Credenciales incorrectas.",
    });
    const newLogin = await callerFor("203.0.113.21");
    const { user } = await newLogin.caller.login({
      email: email("pw"),
      password: NEW_PASSWORD,
    });
    expect(user.email).toBe(email("pw"));
    const tokenC = sessionTokenFrom(newLogin.ctx);

    // CA: todas las sesiones anteriores quedaron revocadas.
    const afterA = await callerFor("203.0.113.20", tokenA);
    await expect(afterA.caller.me()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const afterB = await callerFor("203.0.113.21", tokenB);
    await expect(afterB.caller.me()).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    // La sesión nueva (tras el login con la nueva contraseña) funciona.
    const afterC = await callerFor("203.0.113.21", tokenC);
    const me = await afterC.caller.me();
    expect(me.email).toBe(email("pw"));
  });

  it("resetPassword: reutilizar un token ya usado falla con el mismo error genérico", async () => {
    store.setNow(0);
    const req = await callerFor("203.0.113.24");
    await req.caller.requestReset({ email: email("pw") });
    const token = tokenFromLink(lastSentLink());

    const first = await callerFor("203.0.113.25");
    await first.caller.resetPassword({ token, password: "otra-contraseña-1" });

    const second = await callerFor("203.0.113.25");
    await expect(
      second.caller.resetPassword({ token, password: "otra-contraseña-2" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", message: INVALID_TOKEN_MESSAGE });
  });

  it("resetPassword: token inexistente → error genérico (no revela que no existe)", async () => {
    const { caller } = await callerFor("203.0.113.26");
    await expect(
      caller.resetPassword({ token: "f".repeat(64), password: NEW_PASSWORD }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", message: INVALID_TOKEN_MESSAGE });
  });

  it("resetPassword: token expirado → error genérico", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: email("pw") } });
    const expiredToken = "e".repeat(64);
    await prisma.passwordResetToken.create({
      data: {
        tokenHash: hashResetToken(expiredToken),
        userId: user.id,
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    const { caller } = await callerFor("203.0.113.27");
    await expect(
      caller.resetPassword({ token: expiredToken, password: NEW_PASSWORD }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", message: INVALID_TOKEN_MESSAGE });
  });

  it("resetPassword: contraseña débil → rechazada por política y el token no se consume", async () => {
    store.setNow(0);
    const req = await callerFor("203.0.113.28");
    await req.caller.requestReset({ email: email("pw") });
    const token = tokenFromLink(lastSentLink());

    const weak = await callerFor("203.0.113.29");
    await expect(
      weak.caller.resetPassword({ token, password: "corta" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // El token sigue siendo válido (la validación no lo consume).
    const row = await prisma.passwordResetToken.findUniqueOrThrow({
      where: { tokenHash: hashResetToken(token) },
    });
    expect(row.usedAt).toBeNull();

    const ok = await callerFor("203.0.113.29");
    await expect(
      ok.caller.resetPassword({ token, password: NEW_PASSWORD }),
    ).resolves.toEqual({ ok: true });
  });
});
