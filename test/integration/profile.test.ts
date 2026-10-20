/**
 * US-03 · Perfil y GDPR (PostgreSQL real): me, update, export, delete.
 *
 * Mismo patrón que `reset.test.ts`: el entorno se fija ANTES del `import()`
 * dinámico (los singletons de la app leen env al cargar); los routers se
 * montan con la BD de tests y un store de rate limit en memoria.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPrisma, integrationDbUrl } from "./helpers";

// Antes de importar los módulos de la app (sus singletons leen env al cargar).
process.env.DATABASE_URL = integrationDbUrl();
process.env.REDIS_URL ??= "redis://localhost:6379/0"; // dummy: lazyConnect, no se conecta

const { createAuthRouter } = await import("../../app/server/routers/auth");
const { createProfileRouter } = await import("../../app/server/routers/profile");
const {
  AccountService,
  ANONYMIZED_PASSWORD_SENTINEL,
  anonymizedEmail,
  anonymizedUsername,
  InMemoryRateLimitStore,
  logEmailSender,
} = await import("../../app/modules/identity");
const { createContext } = await import("../../app/server/trpc");

const suffix = randomUUID().slice(0, 8);
const email = (name: string) => `${name}-${suffix}@test.local`;
const username = (name: string) => `${name}_${suffix}`;
const PASSWORD = "contraseña-segura-1";

const APP_URL = "http://localhost:3000";
const SESSION_TTL_SEC = 3600;
const RATE_CFG = {
  maxPerWindow: 10,
  windowSec: 60,
  lockoutThreshold: 5,
  lockoutSec: 900,
};
const RESET_CFG = { tokenTtlSec: 3600, maxPerWindow: 5, windowSec: 300 };
const DELETE_CFG = { deleteMaxPerWindow: 3, deleteWindowSec: 3600 };

describe("US-03 · perfil y GDPR (PostgreSQL real)", () => {
  let prisma: ReturnType<typeof createPrisma>;
  let store: InstanceType<typeof InMemoryRateLimitStore>;
  let authRouter: ReturnType<typeof createAuthRouter>;
  let profileRouter: ReturnType<typeof createProfileRouter>;

  beforeAll(() => {
    prisma = createPrisma();
    store = new InMemoryRateLimitStore();
    authRouter = createAuthRouter({
      prisma,
      rateLimit: store,
      sessionTtlSec: SESSION_TTL_SEC,
      secureCookie: true,
      rateLimitCfg: RATE_CFG,
      emailSender: logEmailSender,
      appUrl: APP_URL,
      resetCfg: RESET_CFG,
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
    const req = new Request("http://localhost/api/trpc/profile", {
      method: "POST",
      headers,
    });
    const ctx = await createContext(req, prisma);
    return {
      ctx,
      auth: authRouter.createCaller(ctx),
      profile: profileRouter.createCaller(ctx),
    };
  }

  /** Extrae el token de la cookie de sesión emitida en `ctx.pendingCookies`. */
  function sessionTokenFrom(ctx: { pendingCookies: string[] }): string {
    expect(ctx.pendingCookies).toHaveLength(1);
    const token = /^session=([0-9a-f]{64});/.exec(ctx.pendingCookies[0] ?? "")?.[1];
    if (!token) throw new Error(`Cookie de sesión inesperada: ${ctx.pendingCookies[0]}`);
    return token;
  }

  /** Registra un usuario por el router auth y devuelve su token de sesión. */
  async function registerUser(name: string, ip = "203.0.113.1") {
    const reg = await callerFor(ip);
    await reg.auth.register({
      email: email(name),
      username: username(name),
      password: PASSWORD,
      termsAccepted: true,
    });
    return { token: sessionTokenFrom(reg.ctx), ip };
  }

  // ─── me ────────────────────────────────────────────────────────────────────

  it("me: sin sesión activa → UNAUTHORIZED", async () => {
    const anon = await callerFor("203.0.113.2");
    await expect(anon.profile.me()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("me: devuelve email, username, displayName, roles y createdAt", async () => {
    const { token } = await registerUser("me");
    const { profile } = await callerFor("203.0.113.1", token);
    const me = await profile.me();
    expect(me.email).toBe(email("me"));
    expect(me.username).toBe(username("me"));
    expect(me.displayName).toBe(username("me")); // el registro crea el perfil con el username
    expect(me.roles).toEqual(["user"]);
    expect(me.createdAt).toBeInstanceOf(Date);
  });

  // ─── update ────────────────────────────────────────────────────────────────

  it("update: cambia el nombre visible en la BD", async () => {
    const { token } = await registerUser("upd");
    const { profile } = await callerFor("203.0.113.1", token);
    await profile.update({ displayName: "Nombre Visible" });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: email("upd") } });
    const profileRow = await prisma.profile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(profileRow.displayName).toBe("Nombre Visible");
  });

  it("update: nombre visible inválido → BAD_REQUEST (Zod)", async () => {
    const { token } = await registerUser("updbad");
    const { profile } = await callerFor("203.0.113.1", token);
    await expect(profile.update({ displayName: "ab" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  // ─── export ────────────────────────────────────────────────────────────────

  it("export: devuelve cuenta, sesiones activas y secciones de juego vacías", async () => {
    const { token } = await registerUser("exp");
    const { profile } = await callerFor("203.0.113.1", token);
    const data = await profile.export();
    expect(data.cuenta.email).toBe(email("exp"));
    expect(data.cuenta.username).toBe(username("exp"));
    expect(data.cuenta.displayName).toBe(username("exp"));
    expect(data.cuenta.roles).toEqual(["user"]);
    expect(data.cuenta.createdAt).toBeInstanceOf(Date);
    // La sesión con la que se llama está activa.
    expect(data.sesionesActivas).toHaveLength(1);
    expect(data.sesionesActivas[0]?.id).toBeTypeOf("string");
    // Secciones de juego: vacías hoy (llegan en Fases 2–4).
    expect(data.lineups).toEqual([]);
    expect(data.puntos).toEqual([]);
    expect(data.ligas).toEqual([]);
  });

  it("export: incluye las ligas del usuario", async () => {
    const { token } = await registerUser("expliga");
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: email("expliga") },
    });
    const league = await prisma.league.create({
      data: { name: `Liga ${suffix}-exp` },
    });
    await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: user.id },
    });

    const { profile } = await callerFor("203.0.113.1", token);
    const data = await profile.export();
    expect(data.ligas).toHaveLength(1);
    expect(data.ligas[0]).toMatchObject({
      id: league.id,
      name: `Liga ${suffix}-exp`,
      role: "member",
      status: "active",
    });
  });

  it("export: incluye los lineups y puntos del usuario", async () => {
    const { token } = await registerUser("expjuego");
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: email("expjuego") },
    });
    const season = await prisma.season.create({
      data: { name: `Temporada ${suffix}`, year: 2030 },
    });
    const circuit = await prisma.circuit.create({
      data: { name: `Circuito ${suffix}`, country: "ES" },
    });
    const gp = await prisma.gp.create({
      data: {
        seasonId: season.id,
        round: 1,
        name: `GP ${suffix}`,
        circuitId: circuit.id,
        date: new Date("2030-03-01T14:00:00Z"),
      },
    });
    const lineup = await prisma.lineup.create({
      data: { userId: user.id, gpId: gp.id },
    });
    await prisma.score.create({
      data: {
        lineupId: lineup.id,
        userId: user.id,
        gpId: gp.id,
        pointsTotal: 170.5,
        breakdown: {},
        rulesVersion: "scoring-v1",
        resultsVersion: "results-v1",
      },
    });

    const { profile } = await callerFor("203.0.113.1", token);
    const data = await profile.export();
    expect(data.lineups).toHaveLength(1);
    expect(data.lineups[0]).toMatchObject({
      id: lineup.id,
      gp: `GP ${suffix}`,
      status: "draft",
    });
    expect(data.puntos).toHaveLength(1);
    expect(data.puntos[0]).toMatchObject({
      gp: `GP ${suffix}`,
      pointsTotal: 170.5,
      rulesVersion: "scoring-v1",
      resultsVersion: "results-v1",
    });
  });

  it("servicio: cuenta inexistente → NOT_FOUND en export y delete (guardas defensivas)", async () => {
    const service = new AccountService({
      prisma,
      rateLimit: new InMemoryRateLimitStore(),
      cfg: DELETE_CFG,
    });
    const missing = "00000000-0000-0000-0000-000000000000";
    await expect(service.exportUserData(missing)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      service.deleteAccount(missing, { password: "cualquiera-1" }, { ip: null }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // ─── delete ────────────────────────────────────────────────────────────────

  it("delete: contraseña incorrecta → UNAUTHORIZED y el usuario NO se anonimiza", async () => {
    const { token } = await registerUser("delbad");
    const { profile } = await callerFor("203.0.113.1", token);
    await expect(
      profile.delete({ password: "contraseña-incorrecta" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: email("delbad") },
    });
    expect(user.isAnonymized).toBe(false);
    expect(user.anonymizedAt).toBeNull();
  });

  it("delete: contraseña correcta → anonimización completa + auditoría sin PII", async () => {
    const { token } = await registerUser("delok");
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: email("delok") },
    });

    const { ctx, profile } = await callerFor("203.0.113.1", token);
    await profile.delete({ password: PASSWORD });

    // CA: la cookie se limpia en la respuesta.
    expect(ctx.pendingCookies).toHaveLength(1);
    expect(ctx.pendingCookies[0]).toBe(
      `session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`,
    );

    // CA: users anonimizado (placeholders deterministas + sentinela).
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.email).toBe(anonymizedEmail(user.id));
    expect(after.username).toBe(anonymizedUsername(user.id));
    expect(after.passwordHash).toBe(ANONYMIZED_PASSWORD_SENTINEL);
    expect(after.isAnonymized).toBe(true);
    expect(after.anonymizedAt).toBeInstanceOf(Date);

    // CA: perfil anonimizado.
    const profileRow = await prisma.profile.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(profileRow.displayName).toBe("Usuario eliminado");
    expect(profileRow.avatarUrl).toBeNull();

    // CA: sesiones revocadas y roles borrados.
    const sessions = await prisma.session.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.revokedAt).toBeInstanceOf(Date);
    const roles = await prisma.userRole.findMany({ where: { userId: user.id } });
    expect(roles).toHaveLength(0);

    // CA: auditoría `user.account_deleted` sin PII (solo id + contadores).
    const audit = await prisma.auditLog.findFirst({
      where: { action: "user.account_deleted", entityId: user.id },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(user.id);
    const afterData = audit?.afterData as Record<string, unknown>;
    expect(afterData.isAnonymized).toBe(true);
    expect(afterData.sessionsRevoked).toBe(1);
    expect(afterData.membershipsLeft).toBe(0);
    const serialized = JSON.stringify(audit?.afterData ?? {});
    expect(serialized).not.toContain(email("delok"));
    expect(serialized).not.toContain(username("delok"));
    expect(serialized).not.toContain(PASSWORD);
  });

  it("delete: la sesión vieja deja de funcionar y el login con el email original falla", async () => {
    const { token } = await registerUser("dellogin");
    const { profile } = await callerFor("203.0.113.1", token);
    await profile.delete({ password: PASSWORD });

    // La sesión revocada ya no resuelve usuario.
    const after = await callerFor("203.0.113.1", token);
    await expect(after.profile.me()).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    // El login con el email original + contraseña antigua falla (sentinela).
    const anon = await callerFor("203.0.113.1");
    await expect(
      anon.auth.login({ email: email("dellogin"), password: PASSWORD }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("delete: el email original queda libre para re-registrarse como cuenta nueva", async () => {
    const { token } = await registerUser("delrereg");
    const { profile } = await callerFor("203.0.113.1", token);
    await profile.delete({ password: PASSWORD });

    const reg = await callerFor("203.0.113.1");
    await reg.auth.register({
      email: email("delrereg"),
      username: username("delrereg"),
      password: "otra-contraseña-1",
      termsAccepted: true,
    });
    const users = await prisma.user.findMany({ where: { email: email("delrereg") } });
    expect(users).toHaveLength(1);
    expect(users[0]?.isAnonymized).toBe(false);
  });

  it("delete: cierra membresías de liga (left) y revoca invitaciones creadas", async () => {
    const { token } = await registerUser("delliga");
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: email("delliga") },
    });
    const league = await prisma.league.create({
      data: { name: `Liga ${suffix}-del` },
    });
    await prisma.leagueMember.create({
      data: { leagueId: league.id, userId: user.id },
    });
    const invite = await prisma.leagueInvite.create({
      data: {
        leagueId: league.id,
        code: `INV-${suffix.toUpperCase()}`,
        createdBy: user.id,
      },
    });

    const { profile } = await callerFor("203.0.113.1", token);
    await profile.delete({ password: PASSWORD });

    const membership = await prisma.leagueMember.findUniqueOrThrow({
      where: { leagueId_userId: { leagueId: league.id, userId: user.id } },
    });
    expect(membership.status).toBe("left");
    expect(membership.leftAt).toBeInstanceOf(Date);
    const inviteRow = await prisma.leagueInvite.findUniqueOrThrow({
      where: { id: invite.id },
    });
    expect(inviteRow.status).toBe("revoked");
  });

  it("delete: rate limit por usuario — el 4º intento en la ventana → TOO_MANY_REQUESTS", async () => {
    // Router con límite estricto (2/h) para el test.
    const strictStore = new InMemoryRateLimitStore();
    const strictRouter = createProfileRouter({
      prisma,
      rateLimit: strictStore,
      deleteRateLimit: { deleteMaxPerWindow: 2, deleteWindowSec: 3600 },
      secureCookie: true,
    });
    const { token } = await registerUser("delrl");
    const headers = { "x-forwarded-for": "203.0.113.1", cookie: `session=${token}` };
    const req = new Request("http://localhost/api/trpc/profile", {
      method: "POST",
      headers,
    });
    const ctx = await createContext(req, prisma);
    const caller = strictRouter.createCaller(ctx);

    // Intentos 1 y 2: el rate limit no bloquea (falla la contraseña).
    await expect(caller.delete({ password: "mala-1" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(caller.delete({ password: "mala-2" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    // Intento 3: bloqueado por el rate limit (3 > 2).
    await expect(caller.delete({ password: "mala-3" })).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
    // El usuario no se anonimiza.
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: email("delrl") },
    });
    expect(user.isAnonymized).toBe(false);
  });

  it("delete: idempotencia — la 2ª eliminación → PRECONDITION_FAILED y no modifica nada", async () => {
    // Idempotencia a nivel de servicio (la 2ª llamada no modifica nada); la
    // sesión no interviene aquí, así que no hace falta su token.
    await registerUser("delidem");
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: email("delidem") },
    });
    const service = new AccountService({
      prisma,
      rateLimit: new InMemoryRateLimitStore(),
      cfg: DELETE_CFG,
    });

    await service.deleteAccount(user.id, { password: PASSWORD }, { ip: null });
    const afterFirst = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(afterFirst.isAnonymized).toBe(true);

    // 2ª eliminación: PRECONDITION_FAILED (no modifica nada).
    await expect(
      service.deleteAccount(user.id, { password: PASSWORD }, { ip: null }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const afterSecond = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(afterSecond).toEqual(afterFirst);
  });
});
