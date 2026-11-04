/**
 * D-07 · 2FA TOTP (ADR-0039) contra PostgreSQL real (Testcontainers):
 * - matriculación (enroll) → secreto + URI otpauth + QR server-side;
 *   el 2FA queda PENDIENTE (DB: `totp_enabled_at = null`);
 * - confirmación con código válido → activo (DB + auditoría `totp.enabled`);
 * - login de 2 pasos: reto sin sesión → `verifyTotp` → sesión (cookie);
 * - presupuesto por reto: al agotarse, el reto se invalida (re-login);
 * - fuerza bruta: los fallos de código alimentan el bloqueo por cuenta
 *   (5 fallos → FORBIDDEN, ni el código válido pasa);
 * - reto expirado (reloj inyectado del store) → error genérico idéntico;
 * - desactivación (re-autenticación) + limpieza GDPR al borrar la cuenta.
 *
 * El núcleo TOTP (RFC 6238) está cubierto por tests unitarios con los
 * vectores del RFC; aquí se verifica el cableado completo (routers + BD +
 * stores) con códigos reales calculados al vuelo.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CapturingEmailSender, createPrisma, integrationDbUrl } from "./helpers";

// Antes de importar los módulos de la app (sus singletons leen env al cargar).
process.env.DATABASE_URL = integrationDbUrl();
process.env.REDIS_URL ??= "redis://localhost:6379/0"; // dummy: lazyConnect, no se conecta

const { createAuthRouter } = await import("../../app/server/routers/auth");
const { createProfileRouter } = await import("../../app/server/routers/profile");
const { computeTotp } = await import("../../app/modules/identity/core/totp");
const { InMemoryRateLimitStore, InMemoryTotpChallengeStore } = await import(
  "../../app/modules/identity"
);
const { createContext } = await import("../../app/server/trpc");

const suffix = randomUUID().slice(0, 8);
const email = (name: string) => `${name}-${suffix}@test.local`;
const username = (name: string) => `${name}_${suffix}`;
const PASSWORD = "contraseña-segura-1";

const APP_URL = "http://localhost:3000";
const SESSION_TTL_SEC = 3600;
// Presupuesto de intentos por reto (2) < bloqueo por cuenta (5): se puede
// testear cada semántica por separado sin que la otra dispare primero.
const RATE_CFG = { maxPerWindow: 100, windowSec: 3600, lockoutThreshold: 5, lockoutSec: 900 };
const TOTPCFG = { challengeTtlSec: 300, maxAttempts: 2 };
const DELETE_CFG = { deleteMaxPerWindow: 3, deleteWindowSec: 3600 };

describe("D-07 · 2FA TOTP (PostgreSQL real, ADR-0039)", () => {
  let prisma: ReturnType<typeof createPrisma>;
  let store: InstanceType<typeof InMemoryRateLimitStore>;
  let totpStore: InstanceType<typeof InMemoryTotpChallengeStore>;
  let authRouter: ReturnType<typeof createAuthRouter>;
  let profileRouter: ReturnType<typeof createProfileRouter>;

  beforeAll(() => {
    prisma = createPrisma();
    store = new InMemoryRateLimitStore();
    totpStore = new InMemoryTotpChallengeStore();
    authRouter = createAuthRouter({
      prisma,
      rateLimit: store,
      totp: totpStore,
      totpCfg: TOTPCFG,
      sessionTtlSec: SESSION_TTL_SEC,
      secureCookie: true,
      rateLimitCfg: RATE_CFG,
      emailSender: new CapturingEmailSender(),
      appUrl: APP_URL,
      resetCfg: { tokenTtlSec: 3600, maxPerWindow: 5, windowSec: 300 },
      registerCfg: { maxPerWindow: 100, windowSec: 3600 },
    });
    profileRouter = createProfileRouter({
      prisma,
      rateLimit: store,
      deleteRateLimit: DELETE_CFG,
      secureCookie: true,
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

  /** Token de sesión desde la cookie emitida en `ctx.pendingCookies`. */
  function sessionTokenFrom(ctx: { pendingCookies: string[] }): string {
    expect(ctx.pendingCookies).toHaveLength(1);
    const token = /^session=([0-9a-f]{64});/.exec(ctx.pendingCookies[0] ?? "")?.[1];
    if (!token) throw new Error(`Cookie de sesión inesperada: ${ctx.pendingCookies[0]}`);
    return token;
  }

  /** Código TOTP válido "ahora" (el servicio lo verifica contra Date.now()). */
  function codeFor(secret: string): string {
    return computeTotp(secret, Date.now());
  }

  /** Registra un usuario y devuelve su cookie de sesión. */
  async function register(name: string): Promise<string> {
    const { ctx, caller } = await callerFor("192.0.2.100");
    await caller.register({
      email: email(name),
      username: username(name),
      password: PASSWORD,
      termsAccepted: true,
    });
    return sessionTokenFrom(ctx);
  }

  /** Matricula + confirma el 2FA de un usuario (queda activo). */
  async function enable2fa(name: string, sessionToken: string): Promise<string> {
    const { caller } = await callerFor("192.0.2.101", sessionToken);
    const { secret } = await caller.totp.enroll({ password: PASSWORD });
    await caller.totp.confirm({ code: codeFor(secret) });
    return secret;
  }

  describe("matriculación (enroll)", () => {
    it("genera secreto base32, URI otpauth y QR; el 2FA queda PENDIENTE", async () => {
      const session = await register("enroll_ok");
      const { caller } = await callerFor("192.0.2.101", session);
      const { secret, otpauthUri, qrDataUrl } = await caller.totp.enroll({ password: PASSWORD });

      expect(secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(otpauthUri.startsWith("otpauth://totp/")).toBe(true);
      expect(otpauthUri).toContain(`secret=${secret}`);
      expect(otpauthUri).toContain(`issuer=${encodeURIComponent("FantasyMotoGP")}`);
      // QR: SVG generado en el servidor (la URI lleva el secreto: no sale
      // a servicios externos, ADR-0039).
      expect(qrDataUrl).toMatch(/^data:image\/svg\+xml;/);

      // DB: secreto guardado, activación PENDIENTE (totp_enabled_at null).
      const row = await prisma.user.findUniqueOrThrow({ where: { email: email("enroll_ok") } });
      expect(row.totpSecret).toBe(secret);
      expect(row.totpEnabledAt).toBeNull();

      // Auditoría (T-09): `totp.enrolled`.
      const audit = await prisma.auditLog.findFirst({
        where: { action: "totp.enrolled", entityId: row.id },
      });
      expect(audit).not.toBeNull();
    });

    it("sin sesión: UNAUTHORIZED (los procedimientos totp exigen autenticarse)", async () => {
      const { caller } = await callerFor("192.0.2.102");
      await expect(
        caller.totp.enroll({ password: PASSWORD }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await expect(
        caller.totp.confirm({ code: "123456" }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await expect(
        caller.totp.disable({ password: PASSWORD }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("contraseña incorrecta: UNAUTHORIZED y NO sobrescribe el secreto", async () => {
      const session = await register("enroll_pw");
      const { caller } = await callerFor("192.0.2.103", session);

      const first = await caller.totp.enroll({ password: PASSWORD });
      await expect(
        caller.totp.enroll({ password: "contraseña-mala-1" }),
      ).rejects.toMatchObject({
        code: "UNAUTHORIZED",
        message: "La contraseña no es correcta.",
      });

      const row = await prisma.user.findUniqueOrThrow({ where: { email: email("enroll_pw") } });
      expect(row.totpSecret).toBe(first.secret); // intacto
      expect(row.totpEnabledAt).toBeNull();
    });
  });

  describe("confirmación (activación)", () => {
    it("código válido: activa el 2FA (DB + auditoría `totp.enabled`)", async () => {
      const session = await register("confirm1");
      const { caller } = await callerFor("192.0.2.104", session);
      const { secret } = await caller.totp.enroll({ password: PASSWORD });

      const result = await caller.totp.confirm({ code: codeFor(secret) });
      expect(result).toEqual({ enabled: true });

      const row = await prisma.user.findUniqueOrThrow({ where: { email: email("confirm1") } });
      expect(row.totpSecret).toBe(secret);
      expect(row.totpEnabledAt).not.toBeNull();

      const audit = await prisma.auditLog.findFirst({
        where: { action: "totp.enabled", entityId: row.id },
      });
      expect(audit).not.toBeNull();
    });

    it("código incorrecto: UNAUTHORIZED y sigue sin activar", async () => {
      const session = await register("confirm2");
      const { caller } = await callerFor("192.0.2.105", session);
      await caller.totp.enroll({ password: PASSWORD });

      await expect(
        caller.totp.confirm({ code: "000000" }),
      ).rejects.toMatchObject({
        code: "UNAUTHORIZED",
        message: "El código no es válido.",
      });

      const row = await prisma.user.findUniqueOrThrow({
        where: { email: email("confirm2") },
      });
      expect(row.totpEnabledAt).toBeNull(); // pendiente
    });

    it("sin matricular: PRECONDITION_FAILED (matricular primero)", async () => {
      const session = await register("confirm3");
      const { caller } = await callerFor("192.0.2.106", session);
      await expect(
        caller.totp.confirm({ code: "123456" }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });
  });

  describe("login de 2 pasos", () => {
    it("con 2FA activo: reto sin sesión; verifyTotp canjea el código y emite la cookie", async () => {
      const session = await register("login2fa");
      const secret = await enable2fa("login2fa", session);
      const row = await prisma.user.findUniqueOrThrow({
        where: { email: email("login2fa") },
      });
      const sessionsBefore = await prisma.session.count({ where: { userId: row.id } });

      // Paso 1: contraseña correcta → reto opaco y SIN cookie de sesión.
      const { ctx, caller } = await callerFor("192.0.2.107");
      const result = await caller.login({ email: email("login2fa"), password: PASSWORD });
      expect(result.totpRequired).toBe(true);
      expect(result.totpToken).toMatch(/^[0-9a-f]{64}$/);
      expect(result.sessionToken).toBeNull();
      expect(ctx.pendingCookies).toHaveLength(0); // SIN cookie
      expect(result.user.totpEnabled).toBe(true); // en la proyección pública

      // Paso 2: código válido → la cookie de sesión (única vía de sesión).
      const { ctx: vctx, caller: vcaller } = await callerFor("192.0.2.107");
      await vcaller.verifyTotp({ token: result.totpToken!, code: codeFor(secret) });
      const sessionToken = sessionTokenFrom(vctx);

      // El reto se consumió: reutilizarlo falla (error genérico).
      const { caller: reuse } = await callerFor("192.0.2.107");
      await expect(
        reuse.verifyTotp({ token: result.totpToken!, code: codeFor(secret) }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

      // La cookie es una sesión válida: `me` resuelve al usuario.
      const { caller: logged } = await callerFor("192.0.2.108", sessionToken);
      const me = await logged.me();
      expect(me.email).toBe(email("login2fa"));
      expect(me.totpEnabled).toBe(true);
      const sessionsAfter = await prisma.session.count({ where: { userId: row.id } });
      expect(sessionsAfter).toBe(sessionsBefore + 1); // exactamente una
    });

    it("sin 2FA: login directo con sesión (comportamiento de siempre)", async () => {
      await register("login1fa");
      const { ctx, caller } = await callerFor("192.0.2.109");
      const result = await caller.login({ email: email("login1fa"), password: PASSWORD });
      expect(result.totpRequired).toBe(false);
      expect(result.sessionToken).toMatch(/^[0-9a-f]{64}$/);
      expect(ctx.pendingCookies).toHaveLength(1);
    });

    it("verifyTotp con reto inexistente: error genérico (no se revela el caso)", async () => {
      const { caller } = await callerFor("192.0.2.110");
      await expect(
        caller.verifyTotp({ token: "f".repeat(64), code: "123456" }),
      ).rejects.toMatchObject({
        code: "UNAUTHORIZED",
        message: "El código no es válido o ha caducado.",
      });
    });
  });

  describe("presupuesto de intentos y fuerza bruta", () => {
    it("presupuesto por reto agotado (2 fallos): el reto se invalida; un reto nuevo funciona", async () => {
      const session = await register("budget");
      const secret = await enable2fa("budget", session);
      const bad = "000000"; // no coincide con el código real (ventana ±1 paso)

      // Dos fallos sobre el MISMO reto agotan el presupuesto (maxAttempts=2).
      const { caller } = await callerFor("192.0.2.120");
      const { totpToken } = await caller.login({ email: email("budget"), password: PASSWORD });
      await expect(caller.verifyTotp({ token: totpToken!, code: bad })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      await expect(caller.verifyTotp({ token: totpToken!, code: bad })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      // 3er intento sobre el reto agotado: ni el código bueno pasa
      // (error genérico — no se revela que el reto está agotado).
      await expect(caller.verifyTotp({ token: totpToken!, code: codeFor(secret) })).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });

      // Cuenta NO bloqueada (2 < 5): un login nuevo emite otro reto y funciona.
      const { ctx: fctx, caller: fcaller } = await callerFor("192.0.2.121");
      const { totpToken: fresh } = await fcaller.login({ email: email("budget"), password: PASSWORD });
      expect(fresh).not.toBe(totpToken);
      await fcaller.verifyTotp({ token: fresh!, code: codeFor(secret) });
      expect(sessionTokenFrom(fctx)).toMatch(/^[0-9a-f]{64}$/);
    });

    it("5 fallos de código (fuerza bruta): la cuenta queda bloqueada (FORBIDDEN)", async () => {
      const session = await register("brute");
      await enable2fa("brute", session);
      const bad = "000000";

      // 4 fallos de código (a lo largo de 2 retos): la cuenta NO llega a 5.
      for (const ip of ["192.0.2.130", "192.0.2.131", "192.0.2.132", "192.0.2.133"]) {
        const { caller } = await callerFor(ip);
        const { totpToken } = await caller.login({ email: email("brute"), password: PASSWORD });
        await expect(caller.verifyTotp({ token: totpToken!, code: bad })).rejects.toMatchObject({
          code: "UNAUTHORIZED",
        });
      }

      // 5º fallo: dispara el bloqueo por cuenta (FORBIDDEN, no el genérico).
      {
        const { caller } = await callerFor("192.0.2.134");
        const { totpToken } = await caller.login({ email: email("brute"), password: PASSWORD });
        await expect(caller.verifyTotp({ token: totpToken!, code: bad })).rejects.toMatchObject({
          code: "FORBIDDEN",
          message: expect.stringMatching(/Demasiados intentos/),
        });
      }

      // Bloqueada: ni el login (con la contraseña CORRECTA) pasa ahora.
      const { caller } = await callerFor("192.0.2.135");
      await expect(
        caller.login({ email: email("brute"), password: PASSWORD }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("reto expirado", () => {
    it("tras el TTL: error genérico idéntico al resto de casos inválidos", async () => {
      const session = await register("expired");
      await enable2fa("expired", session);

      const H = 10 ** 12; // reloj interno del store (ms)
      totpStore.setNow(H);
      const { caller } = await callerFor("192.0.2.140");
      const { totpToken } = await caller.login({ email: email("expired"), password: PASSWORD });
      expect(totpToken).toMatch(/^[0-9a-f]{64}$/);

      totpStore.setNow(H + 400_000); // 400 s > TTL 300 s
      try {
        await expect(
          caller.verifyTotp({ token: totpToken!, code: "123456" }),
        ).rejects.toMatchObject({
          code: "UNAUTHORIZED",
          message: "El código no es válido o ha caducado.",
        });
      } finally {
        totpStore.setNow(0); // restaura el reloj del store para los tests siguientes
      }
    });
  });

  describe("desactivación", () => {
    it("con la contraseña: borra secreto y activación (DB + auditoría `totp.disabled`)", async () => {
      const session = await register("disable1");
      await enable2fa("disable1", session);

      const { caller } = await callerFor("192.0.2.141", session);
      const result = await caller.totp.disable({ password: PASSWORD });
      expect(result).toEqual({ enabled: false });

      const row = await prisma.user.findUniqueOrThrow({
        where: { email: email("disable1") },
      });
      expect(row.totpSecret).toBeNull();
      expect(row.totpEnabledAt).toBeNull();
      const audit = await prisma.auditLog.findFirst({
        where: { action: "totp.disabled", entityId: row.id },
      });
      expect(audit).not.toBeNull();

      // El login vuelve a ser directo (sin segundo paso).
      const { ctx, caller: l } = await callerFor("192.0.2.142");
      const login = await l.login({ email: email("disable1"), password: PASSWORD });
      expect(login.totpRequired).toBe(false);
      expect(ctx.pendingCookies).toHaveLength(1);
    });

    it("contraseña incorrecta: UNAUTHORIZED y el 2FA sigue activo", async () => {
      const session = await register("disable2");
      await enable2fa("disable2", session);

      const { caller } = await callerFor("192.0.2.143", session);
      await expect(
        caller.totp.disable({ password: "contraseña-mala-1" }),
      ).rejects.toMatchObject({
        code: "UNAUTHORIZED",
        message: "La contraseña no es correcta.",
      });
      const row = await prisma.user.findUniqueOrThrow({
        where: { email: email("disable2") },
      });
      expect(row.totpSecret).not.toBeNull();
      expect(row.totpEnabledAt).not.toBeNull();
    });

    it("sin matricular: PRECONDITION_FAILED", async () => {
      const session = await register("disable3");
      const { caller } = await callerFor("192.0.2.144", session);
      await expect(
        caller.totp.disable({ password: PASSWORD }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });
  });

  describe("GDPR", () => {
    it("borrar la cuenta limpia el secreto y la activación (anonimización)", async () => {
      const session = await register("gdprtotp");
      await enable2fa("gdprtotp", session);
      const row = await prisma.user.findUniqueOrThrow({
        where: { email: email("gdprtotp") },
      });
      expect(row.totpSecret).not.toBeNull(); // precondición: 2FA activo

      const { ctx } = await callerFor("192.0.2.145", session);
      const profile = profileRouter.createCaller(ctx);
      await profile.delete({ password: PASSWORD });

      const after = await prisma.user.findUniqueOrThrow({
        where: { id: row.id },
      });
      expect(after.totpSecret).toBeNull();
      expect(after.totpEnabledAt).toBeNull();
      expect(after.isAnonymized).toBe(true);
    });
  });
});
