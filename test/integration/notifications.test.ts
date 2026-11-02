/**
 * US-36 · Notificaciones por email (ADR-0033) — PostgreSQL real.
 *
 * Mismo patrón que `results-definitive.test.ts`: `DATABASE_URL`/`REDIS_URL`
 * se fijan ANTES del `import()` dinámico; los routers se montan con la BD
 * efímera y un sender de captura (sin I/O real).
 *
 * Semánticas bajo test (ADR-0033):
 * - `notifications.settings`: email habilitado por defecto (opt-out);
 *   `protectedProcedure` (401 sin sesión).
 * - `notifications.updateSettings`: upsert por usuario.
 * - Hook `markDefinitive` → `definitive_published`: notifica a TODOS los
 *   miembros activos de las ligas que tienen ranking en el GP (incluye a
 *   miembros sin lineup); las ligas sin ranking en el GP no notifican.
 * - No-op (GP ya definitivo) → sin notificación.
 * - Corrección → recálculo (US-19) → `recalculation_applied`: notifica;
 *   los usuarios con email deshabilitado se excluyen.
 * - Auditoría `notification.sent` (append-only, T-09) por envío.
 * - Fallo grave del servicio de notificación: el recálculo se completa
 *   igualmente (el fallo se loguea, no bloquea — ADR-0033).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@prisma/client";

import {
  NotificationService,
  type NotificationEmail,
  type NotificationEmailSender,
  type NotificationOutcome,
} from "../../app/modules/notifications";
import {
  createPrisma,
  integrationDbUrl,
  seedWorld,
  type World,
} from "./helpers";

// Antes de importar los módulos de la app (sus singletons leen env al cargar).
process.env.DATABASE_URL = integrationDbUrl();
process.env.REDIS_URL ??= "redis://localhost:6379/0"; // dummy: lazyConnect, no se conecta

const { createAuthRouter } = await import("../../app/server/routers/auth");
const { createResultsRouter } = await import("../../app/server/routers/results");
const { createNotificationsRouter } = await import("../../app/server/routers/notifications");
const { createContext } = await import("../../app/server/trpc");
const { InMemoryRateLimitStore } = await import("../../app/modules/identity");

const suffix = randomUUID().slice(0, 8);
const email = (name: string) => `${name}-${suffix}@test.local`;
const username = (name: string) => `${name}_${suffix}`;
const PASSWORD = "contraseña-segura-1";
const ADMIN_EMAIL = email("admin");
const ADMIN_IP = "198.51.100.42";
const USER_IP = "198.51.100.43";

/** Sender de captura (US-36): registra los envíos en memoria. */
class CapturingNotificationSender implements NotificationEmailSender {
  sent: NotificationEmail[] = [];
  async send(mail: NotificationEmail): Promise<void> {
    this.sent.push(mail);
  }
}

describe("US-36 · Notificaciones por email (PostgreSQL real)", () => {
  let prisma: PrismaClient;
  let authRouter: ReturnType<typeof createAuthRouter>;
  let resultsRouter: ReturnType<typeof createResultsRouter>;
  let notificationsRouter: ReturnType<typeof createNotificationsRouter>;
  let sender: CapturingNotificationSender;
  let world: World;
  let adminToken: string;
  let p1Token: string;
  let p3Token: string;

  // Jugadores (registrados por el router de auth).
  let p1Email: string;
  let p2Email: string;
  let p3Email: string;
  let p1Id: string;
  let p2Id: string;
  let p3Id: string;
  let p4Id: string;

  // Pilotos del mundo (lineups de p1 y p2).
  let r1: string;
  let r2: string;
  let r3: string;
  let r4: string;

  beforeAll(async () => {
    prisma = createPrisma();
    sender = new CapturingNotificationSender();
    const notifications = new NotificationService({
      prisma,
      sender,
      from: "notificaciones@test.local",
      appUrl: "https://app.test",
    });
    authRouter = createAuthRouter({
      prisma,
      rateLimit: new InMemoryRateLimitStore(),
      sessionTtlSec: 3600,
      secureCookie: true,
      rateLimitCfg: {
        maxPerWindow: 20,
        windowSec: 60,
        lockoutThreshold: 10,
        lockoutSec: 900,
      },
      emailSender: { sendResetLink: async () => {} },
      appUrl: "http://localhost:3000",
      resetCfg: { tokenTtlSec: 3600, maxPerWindow: 5, windowSec: 300 },
      registerCfg: { maxPerWindow: 100, windowSec: 3600 },
      bootstrapAdminEmail: ADMIN_EMAIL,
    });
    resultsRouter = createResultsRouter({ prisma, notifications });
    notificationsRouter = createNotificationsRouter({
      prisma,
      sender,
      from: "notificaciones@test.local",
      appUrl: "https://app.test",
    });

    world = await seedWorld(prisma);
    r1 = world.riders[0].id;
    r2 = world.riders[1].id;
    r3 = world.riders[2].id;
    r4 = world.riders[3].id;

    // Afiliaciones del GP (equipo/constructor) + precios de apertura.
    for (const rider of [r1, r2, r3, r4]) {
      await prisma.riderAffiliation.create({
        data: {
          riderId: rider,
          teamId: world.team.id,
          constructorId: world.ctor.id,
          gpId: world.gp.id,
        },
      });
    }
    for (const [assetId, price] of [
      [r1, 30],
      [r2, 20],
      [r3, 10],
      [r4, 15],
    ] as [string, number][]) {
      await prisma.price.create({
        data: { assetType: "rider", assetId, price: String(price) },
      });
    }

    // Jugadores (p1 y p2 con lineup; p3 y p4 sin lineup).
    const register = async (name: string) => {
      const caller = await callerFor(USER_IP);
      const reg = await caller.auth.register({
        email: email(name),
        username: username(name),
        password: PASSWORD,
        termsAccepted: true,
      });
      return { id: reg.user.id, token: sessionTokenFrom(caller.ctx) };
    };
    const admin = await register("admin");
    adminToken = admin.token;
    const p1 = await register("p1");
    p1Id = p1.id;
    p1Token = p1.token;
    p1Email = email("p1");
    const p2 = await register("p2");
    p2Id = p2.id;
    p2Email = email("p2");
    const p3 = await register("p3");
    p3Id = p3.id;
    p3Token = p3.token;
    p3Email = email("p3");
    const p4 = await register("p4");
    p4Id = p4.id;

    // Lineups: p1 y p2 (con score ⇒ ranking por GP en la liga).
    const createLineup = async (userId: string) => {
      const lineup = await prisma.lineup.create({
        data: { userId, gpId: world.gp.id },
      });
      await prisma.lineupSlot.createMany({
        data: [
          { lineupId: lineup.id, slotType: "gold", assetType: "rider", assetId: r1 },
          { lineupId: lineup.id, slotType: "gold", assetType: "rider", assetId: r2 },
          { lineupId: lineup.id, slotType: "silver", assetType: "rider", assetId: r3 },
          { lineupId: lineup.id, slotType: "silver", assetType: "rider", assetId: r4 },
          { lineupId: lineup.id, slotType: "constructor", assetType: "constructor", assetId: world.ctor.id },
          { lineupId: lineup.id, slotType: "team", assetType: "team", assetId: world.team.id },
        ],
      });
    };
    await createLineup(p1Id);
    await createLineup(p2Id);

    // L1: p1 + p2 (con lineup) + p3 (miembro SIN lineup).
    const league1 = await prisma.league.create({
      data: { name: `L1 ${suffix}`, type: "private", status: "active" },
    });
    for (const userId of [p1Id, p2Id, p3Id]) {
      await prisma.leagueMember.create({
        data: { leagueId: league1.id, userId, status: "active" },
      });
    }
    // L2: p4 (sin lineup ⇒ sin score ⇒ sin ranking en el GP ⇒ no notifica).
    const league2 = await prisma.league.create({
      data: { name: `L2 ${suffix}`, type: "private", status: "active" },
    });
    await prisma.leagueMember.create({
      data: { leagueId: league2.id, userId: p4Id, status: "active" },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Contexto tRPC para una petición simulada (IP + cookie de sesión opcional). */
  async function callerFor(ip: string, sessionToken?: string) {
    const headers: Record<string, string> = { "x-forwarded-for": ip };
    if (sessionToken !== undefined) headers.cookie = `session=${sessionToken}`;
    const req = new Request("http://localhost/api/trpc/notifications", {
      method: "POST",
      headers,
    });
    const ctx = await createContext(req, prisma);
    return {
      ctx,
      auth: authRouter.createCaller(ctx),
      results: resultsRouter.createCaller(ctx),
      notifications: notificationsRouter.createCaller(ctx),
    };
  }

  /** Extrae el token de la cookie de sesión emitida en `ctx.pendingCookies`. */
  function sessionTokenFrom(ctx: { pendingCookies: string[] }): string {
    expect(ctx.pendingCookies).toHaveLength(1);
    const token = /^session=([0-9a-f]{64});/.exec(ctx.pendingCookies[0] ?? "")?.[1];
    if (!token) throw new Error(`Cookie de sesión inesperada: ${ctx.pendingCookies[0]}`);
    return token;
  }

  /** Importa la carrera del GP del mundo (provisional o corrección). */
  async function importRace(positions: Record<string, number>) {
    const caller = await callerFor(ADMIN_IP, adminToken);
    await caller.results.importEvent({
      gpId: world.gp.id,
      eventId: world.event.id,
      entries: Object.entries(positions).map(([riderId, position]) => ({
        riderId,
        position,
        started: true,
        finished: true,
        penalties: [],
        bonuses: [],
        rawPoints: null,
      })),
      reason: "importación de la carrera",
    });
  }

  it("settings: email habilitado por defecto (sin fila de ajustes)", async () => {
    const caller = await callerFor(USER_IP, p1Token);
    await expect(caller.notifications.settings()).resolves.toEqual({
      emailEnabled: true,
    });
  });

  it("settings: sin sesión → UNAUTHORIZED", async () => {
    const caller = await callerFor(USER_IP);
    await expect(caller.notifications.settings()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("updateSettings: deshabilitar email queda reflejado en settings", async () => {
    const caller = await callerFor(USER_IP, p1Token);
    await caller.notifications.updateSettings({ emailEnabled: false });
    await expect(caller.notifications.settings()).resolves.toEqual({
      emailEnabled: false,
    });
    // Lo re-habilita para no afectar a los tests siguientes.
    await caller.notifications.updateSettings({ emailEnabled: true });
  });

  it("markDefinitive: notifica a todos los miembros activos de las ligas con ranking en el GP", async () => {
    await importRace({ [r1]: 1, [r2]: 2, [r3]: 3, [r4]: 4 });

    const caller = await callerFor(ADMIN_IP, adminToken);
    await caller.results.markDefinitive({ gpId: world.gp.id });

    // L1 tiene ranking en el GP (p1 + p2 con score) → sus 3 miembros activos
    // reciben (incluido p3, sin lineup). L2 no tiene ranking en el GP (p4 sin
    // score) → no recibe.
    expect(sender.sent).toHaveLength(3);
    const recipients = sender.sent.map((mail) => mail.to).sort();
    expect(recipients).toEqual([p1Email, p2Email, p3Email].sort());
    for (const mail of sender.sent) {
      expect(mail.subject).toBe(
        `Resultados definitivos: ${world.gp.name} (ronda ${world.gp.round})`,
      );
      expect(mail.html).toContain("resultados definitivos");
      expect(mail.html).toContain("https://app.test/resultados");
    }

    // Auditoría append-only (T-09): una entrada por envío.
    const audit = await prisma.auditLog.findMany({
      where: { action: "notification.sent", entityId: world.gp.id },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.afterData).toMatchObject({
      event: "definitive_published",
      recipients: 3,
      sent: 3,
      failed: 0,
    });
  });

  it("markDefinitive no-op (GP ya definitivo): sin notificación nueva", async () => {
    const before = sender.sent.length;
    const caller = await callerFor(ADMIN_IP, adminToken);
    const result = await caller.results.markDefinitive({ gpId: world.gp.id });
    expect(result.noop).toBe(true);
    expect(sender.sent.length).toBe(before);
  });

  it("corrección → recálculo: notifica `recalculation_applied` y excluye email deshabilitado", async () => {
    // p3 deshabilita su email (US-36).
    const p3 = await callerFor(USER_IP, p3Token);
    await p3.notifications.updateSettings({ emailEnabled: false });

    const before = sender.sent.length;
    await importRace({ [r1]: 2, [r2]: 1, [r3]: 3, [r4]: 4 }); // corrección

    // Los 2 restantes (p1 + p2) reciben el aviso de recálculo.
    expect(sender.sent.length).toBe(before + 2);
    const batch = sender.sent.slice(before);
    for (const mail of batch) {
      expect(mail.subject).toBe(
        `Recálculo aplicado: ${world.gp.name} (ronda ${world.gp.round})`,
      );
      expect(mail.html).toContain("Tu puntuación puede haber cambiado.");
    }
    expect(batch.map((mail) => mail.to).sort()).toEqual([p1Email, p2Email].sort());

    // Auditoría del segundo envío. `orderBy` determinista: sin él Postgres
    // no garantiza el orden de inserción y `audit[1]` podía ser cualquiera
    // de las dos filas (flake observado en la corrida unida, T-12).
    const audit = await prisma.auditLog.findMany({
      where: { action: "notification.sent", entityId: world.gp.id },
      orderBy: { createdAt: "asc" },
    });
    expect(audit).toHaveLength(2);
    expect(audit[1]?.afterData).toMatchObject({
      event: "recalculation_applied",
      recipients: 2,
      sent: 2,
      failed: 0,
    });
  });

  it("fallo grave del servicio de notificación: el recálculo se completa igualmente (ADR-0033)", async () => {
    // Un fallo que sí propaga (p. ej. BD caída al auditar) no debe romper el
    // flujo principal: el router encaja el error (log) y continúa.
    class ThrowingNotificationService extends NotificationService {
      async notifyRecalculationApplied(): Promise<NotificationOutcome> {
        throw new Error("fallo grave simulado (p. ej. BD caída al auditar)");
      }
    }
    const throwingRouter = createResultsRouter({
      prisma,
      notifications: new ThrowingNotificationService({
        prisma,
        sender,
        from: "notificaciones@test.local",
        appUrl: "https://app.test",
      }),
    });
    const headers: Record<string, string> = {
      "x-forwarded-for": ADMIN_IP,
      cookie: `session=${adminToken}`,
    };
    const req = new Request("http://localhost/api/trpc/results", {
      method: "POST",
      headers,
    });
    const ctx = await createContext(req, prisma);
    const caller = throwingRouter.createCaller(ctx);

    const before = sender.sent.length;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let result: unknown;
    let errorCallCount = 0;
    try {
      result = await caller.importEvent({
        gpId: world.gp.id,
        eventId: world.event.id,
        entries: [
          { riderId: r1, position: 3, started: true, finished: true, penalties: [], bonuses: [], rawPoints: null },
          { riderId: r2, position: 2, started: true, finished: true, penalties: [], bonuses: [], rawPoints: null },
          { riderId: r3, position: 1, started: true, finished: true, penalties: [], bonuses: [], rawPoints: null },
          { riderId: r4, position: 4, started: true, finished: true, penalties: [], bonuses: [], rawPoints: null },
        ],
        reason: "corrección para probar el fallo de notificación",
      });
      // `mockRestore()` (en el `finally`) limpia el historial de llamadas del
      // spy, así que se captura el conteo ANTES de restaurarlo.
      errorCallCount = errorSpy.mock.calls.length;
    } finally {
      errorSpy.mockRestore();
    }

    // El flujo principal se completa: corrección + recálculo (rv-3).
    expect(result).toMatchObject({
      recalculated: true,
      resultsVersion: "rv-3",
    });
    // El fallo se loguea (sin romper) y no envía ni audita nada.
    expect(errorCallCount).toBeGreaterThan(0);
    expect(sender.sent.length).toBe(before);
    const audit = await prisma.auditLog.findMany({
      where: { action: "notification.sent", entityId: world.gp.id },
    });
    expect(audit).toHaveLength(2);
  });
});
