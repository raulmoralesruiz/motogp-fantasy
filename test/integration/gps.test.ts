/**
 * US-05 · Circuitos, GPs, eventos de fin de semana e import de calendario
 * (PostgreSQL real).
 *
 * Mismo patrón que `seasons.test.ts`: los módulos de la app leen el entorno
 * al importar (singletons de Prisma y Redis), así que `DATABASE_URL` y
 * `REDIS_URL` se fijan ANTES del `import()` dinámico. El router `seasons`
 * es inyectable: se monta con la BD efímera y una `FakeCalendarSource`
 * (sin red) para probar `calendar.fetch`/`calendar.import` (ADR-0012).
 *
 * Criterios de aceptación (backlog US-05):
 * - Circuitos por acción separada (idempotentes por `(name, country)`).
 * - GPs con Q2 + carrera obligatorios (Q1/sprint opcionales y añadibles
 *   después); `lockoutAt` opcional en la creación y editable después.
 * - El GP transita `scheduled → locked → finished/cancelled` y solo el
 *   admin lo cambia (auditado, before/after).
 * - Import de calendario en 2 pasos: `fetch` (preview, sin escribir) e
 *   `import` (transacción atómica, salta rondas existentes, auditado).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CalendarSourceError,
  type CalendarSource,
  type NormalizedSeasonCalendar,
} from "../../app/modules/seasons";
import { PROVISIONAL_SEASON_RULES } from "../../app/shared/config/season-rules";

import { CapturingEmailSender, createPrisma, integrationDbUrl } from "./helpers";

// Antes de importar los módulos de la app (sus singletons leen env al cargar).
process.env.DATABASE_URL = integrationDbUrl();
process.env.REDIS_URL ??= "redis://localhost:6379/0"; // dummy: lazyConnect, no se conecta

const { createAuthRouter } = await import("../../app/server/routers/auth");
const { createSeasonsRouter } = await import("../../app/server/routers/seasons");
const { createContext } = await import("../../app/server/trpc");
const { InMemoryRateLimitStore } = await import("../../app/modules/identity");

/**
 * Fuente de calendario de test (sin red): 3 GPs en Falsia. R1 y R2
 * comparten circuito (para verificar la reutilización idempotente en la
 * import); R3 usa otro. El año 1999 simula un fallo de la fuente.
 */
class FakeCalendarSource implements CalendarSource {
  readonly meta = { name: "fake", version: "test-v1" };
  readonly calls: number[] = [];

  async fetchSeasonCalendar(year: number): Promise<NormalizedSeasonCalendar> {
    this.calls.push(year);
    if (year === 1999) {
      throw new CalendarSourceError("Fuente de test: fallo simulado de red");
    }
    return {
      year,
      seasonRef: `fake-season-${year}`,
      source: this.meta,
      gps: [
        {
          round: 1,
          name: "GP Ficticio Uno",
          circuit: {
            name: "Circuito Falso",
            country: "Falsia",
            location: "Ciudad Falsa",
          },
          date: new Date("2027-03-07T13:00:00.000Z"),
          sourceEventRef: `fake-event-1-${year}`,
          events: [
            { type: "q2", startTime: new Date("2027-03-06T12:00:00.000Z") },
            { type: "race", startTime: new Date("2027-03-07T13:00:00.000Z") },
          ],
        },
        {
          round: 2,
          name: "GP Ficticio Dos",
          circuit: {
            name: "Circuito Falso",
            country: "Falsia",
            location: null,
          },
          date: new Date("2027-03-14T13:00:00.000Z"),
          sourceEventRef: `fake-event-2-${year}`,
          events: [
            { type: "q1", startTime: null },
            { type: "q2", startTime: null },
            { type: "sprint", startTime: null },
            { type: "race", startTime: null },
          ],
        },
        {
          round: 3,
          name: "GP Ficticio Tres",
          circuit: {
            name: "Autódromo Falso",
            country: "Falsia",
            location: null,
          },
          date: new Date("2027-03-21T13:00:00.000Z"),
          sourceEventRef: `fake-event-3-${year}`,
          events: [
            { type: "q2", startTime: null },
            { type: "race", startTime: null },
          ],
        },
      ],
    };
  }
}

const suffix = randomUUID().slice(0, 8);
const email = (name: string) => `${name}-${suffix}@test.local`;
const username = (name: string) => `${name}_${suffix}`;
const PASSWORD = "contraseña-segura-1";
const ADMIN_EMAIL = email("admin");
const ADMIN_IP = "198.51.100.30";
const USER_IP = "198.51.100.31";
const SEASON_NAME = `Temporada US-05 ${suffix}`;
const CALENDAR_SEASON_NAME = `Temporada Calendario ${suffix}`;

describe("US-05 · Circuitos, GPs y calendario (PostgreSQL real)", () => {
  let prisma: ReturnType<typeof createPrisma>;
  let authRouter: ReturnType<typeof createAuthRouter>;
  let seasonsRouter: ReturnType<typeof createSeasonsRouter>;
  const fakeSource = new FakeCalendarSource();
  let adminId: string;
  let adminToken: string;
  let userToken: string;
  let seasonId: string;
  let calendarSeasonId: string;
  let circuitId: string;
  let gpId: string;
  let gp2Id: string;

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
    seasonsRouter = createSeasonsRouter({ prisma, calendarSource: fakeSource });

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

    // Dos temporadas: una para los GPs manuales (2026) y otra para la
    // import de calendario (2027), para aislar sus auditorías.
    const adminSeasons = (await callerFor(ADMIN_IP, adminToken)).seasons;
    seasonId = (
      await adminSeasons.create({
        name: SEASON_NAME,
        year: 2026,
        rules: PROVISIONAL_SEASON_RULES,
      })
    ).id;
    calendarSeasonId = (
      await adminSeasons.create({
        name: CALENDAR_SEASON_NAME,
        year: 2027,
        rules: PROVISIONAL_SEASON_RULES,
      })
    ).id;
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

  // ── Circuitos ─────────────────────────────────────────────────────────────

  it("un admin crea un circuito (auditoría circuit.created)", async () => {
    const { seasons } = await callerFor(ADMIN_IP, adminToken);
    const circuit = await seasons.circuits.create({
      name: "Circuito Manual",
      country: "España",
      location: "Madrid",
    });
    circuitId = circuit.id;
    expect(circuit).toMatchObject({
      name: "Circuito Manual",
      country: "España",
      location: "Madrid",
      created: true,
    });

    const audit = await prisma.auditLog.findMany({
      where: { action: "circuit.created", entityId: circuitId },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: adminId,
      entity: "circuit",
      ip: ADMIN_IP,
    });
  });

  it("recrear el mismo circuito lo reutiliza (idempotente, sin auditoría nueva)", async () => {
    const { seasons } = await callerFor(ADMIN_IP, adminToken);
    const reused = await seasons.circuits.create({
      name: "Circuito Manual",
      country: "España",
      location: "Otra Ciudad",
    });
    expect(reused.id).toBe(circuitId);
    expect(reused.created).toBe(false);
    // El unique `(name, country)` se mantiene: una sola fila.
    expect(await prisma.circuit.count({ where: { name: "Circuito Manual" } })).toBe(1);
    // Reutilizar no audita.
    expect(await prisma.auditLog.count({ where: { action: "circuit.created" } })).toBe(1);
  });

  // ── GPs manuales ──────────────────────────────────────────────────────────

  it("un admin crea un GP con eventos y lockoutAt (auditoría gp.created)", async () => {
    const { seasons } = await callerFor(ADMIN_IP, adminToken);
    const gp = await seasons.gps.create({
      seasonId,
      round: 1,
      name: "GP Manual Uno",
      circuitId,
      date: new Date("2026-03-08T13:00:00Z"),
      lockoutAt: new Date("2026-03-08T12:00:00Z"),
      // Enviados en orden no canónico: la vista debe devolverlos ordenados.
      events: [
        { type: "q2", startTime: new Date("2026-03-07T12:00:00Z") },
        { type: "race", startTime: new Date("2026-03-08T13:00:00Z") },
        { type: "sprint", startTime: null },
        { type: "q1" },
      ],
    });
    gpId = gp.id;
    expect(gp.status).toBe("scheduled");
    expect(gp.date.toISOString()).toBe("2026-03-08T13:00:00.000Z");
    expect(gp.lockoutAt?.toISOString()).toBe("2026-03-08T12:00:00.000Z");
    expect(gp.events.map((e) => e.type)).toEqual(["q1", "q2", "sprint", "race"]);
    expect(gp.circuit).toMatchObject({ name: "Circuito Manual", country: "España" });

    const audit = await prisma.auditLog.findMany({
      where: { action: "gp.created", entityId: gpId },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: adminId,
      entity: "gp",
      ip: ADMIN_IP,
    });
    // Los eventos se registran en el orden enviado (dato de entrada).
    expect(audit[0]?.afterData).toMatchObject({
      round: 1,
      name: "GP Manual Uno",
      events: ["q2", "race", "sprint", "q1"],
    });
  });

  it("un GP sin Q2 o sin carrera se rechaza con BAD_REQUEST", async () => {
    const { seasons } = await callerFor(ADMIN_IP, adminToken);
    await expect(
      seasons.gps.create({
        seasonId,
        round: 2,
        name: "GP Sin Q2",
        circuitId,
        date: new Date("2026-03-15T13:00:00Z"),
        events: [{ type: "q1" }, { type: "sprint" }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await prisma.gp.count({ where: { seasonId } })).toBe(1);
  });

  it("una ronda duplicada se rechaza con CONFLICT", async () => {
    const { seasons } = await callerFor(ADMIN_IP, adminToken);
    await expect(
      seasons.gps.create({
        seasonId,
        round: 1,
        name: "GP Duplicado",
        circuitId,
        date: new Date("2026-03-22T13:00:00Z"),
        events: [{ type: "q2" }, { type: "race" }],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("temporada o circuito inexistente → NOT_FOUND", async () => {
    const { seasons } = await callerFor(ADMIN_IP, adminToken);
    await expect(
      seasons.gps.create({
        seasonId: randomUUID(),
        round: 1,
        name: "GP Fantasma",
        circuitId,
        date: new Date("2026-03-22T13:00:00Z"),
        events: [{ type: "q2" }, { type: "race" }],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      seasons.gps.create({
        seasonId,
        round: 1,
        name: "GP Fantasma",
        circuitId: randomUUID(),
        date: new Date("2026-03-22T13:00:00Z"),
        events: [{ type: "q2" }, { type: "race" }],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("gps.list ordena por ronda; temporada o GP inexistente → NOT_FOUND", async () => {
    const { seasons } = await callerFor(ADMIN_IP, adminToken);
    // Segundo GP de la temporada (solo lo obligatorio: Q2 + carrera).
    const gp2 = await seasons.gps.create({
      seasonId,
      round: 2,
      name: "GP Manual Dos",
      circuitId,
      date: new Date("2026-03-15T13:00:00Z"),
      events: [{ type: "q2" }, { type: "race" }],
    });
    gp2Id = gp2.id;
    expect(gp2.lockoutAt).toBeNull();
    expect(gp2.events.map((e) => e.type)).toEqual(["q2", "race"]);

    const list = await seasons.gps.list({ seasonId });
    expect(list.map((g) => g.round)).toEqual([1, 2]);

    await expect(seasons.gps.list({ seasonId: randomUUID() })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(seasons.gps.get({ gpId: randomUUID() })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("addWeekendEvent añade un evento faltante (auditoría gp.event_added)", async () => {
    const { seasons } = await callerFor(ADMIN_IP, adminToken);
    const updated = await seasons.gps.addEvent({
      gpId: gp2Id,
      type: "sprint",
      startTime: new Date("2026-03-14T15:00:00Z"),
    });
    expect(updated.events.map((e) => e.type)).toEqual(["q2", "sprint", "race"]);

    const audit = await prisma.auditLog.findMany({
      where: { action: "gp.event_added" },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actorId: adminId,
      entity: "weekend_event",
      ip: ADMIN_IP,
    });
    expect(audit[0]?.afterData).toMatchObject({
      gpId: gp2Id,
      type: "sprint",
      startTime: "2026-03-14T15:00:00.000Z",
    });
  });

  it("addWeekendEvent duplicado → CONFLICT; GP inexistente → NOT_FOUND", async () => {
    const { seasons } = await callerFor(ADMIN_IP, adminToken);
    await expect(
      seasons.gps.addEvent({ gpId: gp2Id, type: "race" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      seasons.gps.addEvent({ gpId: randomUUID(), type: "q1" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // ── Estado del GP (transiciones) ──────────────────────────────────────────

  it("scheduled → locked → finished (auditoría gp.status_changed before/after)", async () => {
    const { seasons } = await callerFor(ADMIN_IP, adminToken);
    const locked = await seasons.gps.updateStatus({ gpId, status: "locked" });
    expect(locked.status).toBe("locked");
    const finished = await seasons.gps.updateStatus({ gpId, status: "finished" });
    expect(finished.status).toBe("finished");

    const audit = await prisma.auditLog.findMany({
      where: { action: "gp.status_changed", entityId: gpId },
    });
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({
      actorId: adminId,
      beforeData: { status: "scheduled" },
      afterData: { status: "locked" },
    });
    expect(audit[1]).toMatchObject({
      beforeData: { status: "locked" },
      afterData: { status: "finished" },
    });
  });

  it("transición que salta estados (scheduled → finished) → BAD_REQUEST", async () => {
    const { seasons } = await callerFor(ADMIN_IP, adminToken);
    await expect(
      seasons.gps.updateStatus({ gpId: gp2Id, status: "finished" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: /bloqueado/ });
  });

  it("US-13: locked → scheduled (reapertura) es válida y auditada (ADR-0017)", async () => {
    const { seasons } = await callerFor(ADMIN_IP, adminToken);
    // gp2 está scheduled; cerramos y reabrimos.
    await seasons.gps.updateStatus({ gpId: gp2Id, status: "locked" });
    const reopened = await seasons.gps.updateStatus({ gpId: gp2Id, status: "scheduled" });
    expect(reopened.status).toBe("scheduled");

    const audit = await prisma.auditLog.findMany({
      where: { action: "gp.status_changed", entityId: gp2Id },
      orderBy: { createdAt: "asc" },
    });
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({
      beforeData: { status: "scheduled" },
      afterData: { status: "locked" },
    });
    expect(audit[1]).toMatchObject({
      beforeData: { status: "locked" },
      afterData: { status: "scheduled" },
    });
  });

  it("estado terminal: finished no admite cambios (BAD_REQUEST)", async () => {
    const { seasons } = await callerFor(ADMIN_IP, adminToken);
    await expect(
      seasons.gps.updateStatus({ gpId, status: "scheduled" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: /terminal/ });
  });

  it("mismo estado: no-op sin auditoría nueva", async () => {
    const { seasons } = await callerFor(ADMIN_IP, adminToken);
    const before = await prisma.auditLog.count({
      where: { action: "gp.status_changed", entityId: gpId },
    });
    const same = await seasons.gps.updateStatus({ gpId, status: "finished" });
    expect(same.status).toBe("finished");
    const after = await prisma.auditLog.count({
      where: { action: "gp.status_changed", entityId: gpId },
    });
    expect(after).toBe(before);
  });

  it("updateGpLockout fija y borra lockoutAt (auditoría gp.lockout_changed)", async () => {
    const { seasons } = await callerFor(ADMIN_IP, adminToken);
    const setLock = await seasons.gps.updateLockout({
      gpId: gp2Id,
      lockoutAt: new Date("2026-03-14T11:00:00Z"),
    });
    expect(setLock.lockoutAt?.toISOString()).toBe("2026-03-14T11:00:00.000Z");
    const clearLock = await seasons.gps.updateLockout({ gpId: gp2Id, lockoutAt: null });
    expect(clearLock.lockoutAt).toBeNull();

    const audit = await prisma.auditLog.findMany({
      where: { action: "gp.lockout_changed", entityId: gp2Id },
    });
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({
      beforeData: { lockoutAt: null },
      afterData: { lockoutAt: "2026-03-14T11:00:00.000Z" },
    });
    expect(audit[1]).toMatchObject({
      beforeData: { lockoutAt: "2026-03-14T11:00:00.000Z" },
      afterData: { lockoutAt: null },
    });
  });

  // ── Import de calendario (2 pasos, ADR-0012) ──────────────────────────────

  it("calendar.fetch devuelve el preview sin escribir en BD", async () => {
    const { seasons } = await callerFor(ADMIN_IP, adminToken);
    const calendar = await seasons.calendar.fetch({ year: 2027 });
    expect(calendar.year).toBe(2027);
    expect(calendar.seasonRef).toBe("fake-season-2027");
    expect(calendar.source).toEqual({ name: "fake", version: "test-v1" });
    expect(calendar.gps.map((g) => g.round)).toEqual([1, 2, 3]);
    expect(fakeSource.calls).toContain(2027);
    // Paso 1 no escribe: la temporada de calendario sigue vacía.
    expect(await prisma.gp.count({ where: { seasonId: calendarSeasonId } })).toBe(0);
    expect(await prisma.circuit.count({ where: { country: "Falsia" } })).toBe(0);
    // Año fuera de rango: BAD_REQUEST (Zod).
    await expect(seasons.calendar.fetch({ year: 1800 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("un fallo de la fuente mapea a INTERNAL_SERVER_ERROR con el motivo", async () => {
    const { seasons } = await callerFor(ADMIN_IP, adminToken);
    await expect(seasons.calendar.fetch({ year: 1999 })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: /fallo simulado de red/,
    });
  });

  it("calendar.import crea los GPs en una transacción (auditorías completas)", async () => {
    const { seasons } = await callerFor(ADMIN_IP, adminToken);
    const calendar = await seasons.calendar.fetch({ year: 2027 });
    const report = await seasons.calendar.import({
      seasonId: calendarSeasonId,
      calendar,
    });
    expect(report).toMatchObject({
      seasonId: calendarSeasonId,
      year: 2027,
      created: 3,
      skipped: [],
    });

    const gps = await seasons.gps.list({ seasonId: calendarSeasonId });
    expect(gps.map((g) => g.round)).toEqual([1, 2, 3]);
    expect(gps[0]?.date.toISOString()).toBe("2027-03-07T13:00:00.000Z");
    // Eventos del GP 2 en orden canónico; lockoutAt nula (la import no la fija).
    expect(gps[1]?.events.map((e) => e.type)).toEqual(["q1", "q2", "sprint", "race"]);
    expect(gps[0]?.lockoutAt).toBeNull();
    expect(gps[2]?.circuit.location).toBeNull();

    // Circuitos: R1 y R2 comparten «Circuito Falso» (reutilizado) y R3 crea
    // «Autódromo Falso» → 2 filas, 2 auditorías circuit.created (source: calendar).
    const circuits = await prisma.circuit.findMany({
      where: { country: "Falsia" },
      orderBy: { name: "asc" },
    });
    expect(circuits.map((c) => c.name)).toEqual(["Autódromo Falso", "Circuito Falso"]);
    const circuitAudit = await prisma.auditLog.findMany({
      where: {
        action: "circuit.created",
        afterData: { path: ["source"], equals: "calendar" },
      },
    });
    expect(circuitAudit).toHaveLength(2);

    // Auditorías: 1 calendar.imported + 3 gp.created (con procedencia).
    const imported = await prisma.auditLog.findMany({
      where: { action: "calendar.imported", entityId: calendarSeasonId },
    });
    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({
      actorId: adminId,
      entity: "season",
      ip: ADMIN_IP,
    });
    expect(imported[0]?.afterData).toMatchObject({
      year: 2027,
      source: "fake",
      seasonRef: "fake-season-2027",
      created: 3,
      skipped: 0,
    });
    const gpAudit = await prisma.auditLog.findMany({
      where: { action: "gp.created", entityId: { in: gps.map((g) => g.id) } },
    });
    expect(gpAudit).toHaveLength(3);
    expect(gpAudit[0]?.afterData).toMatchObject({
      source: "fake",
      seasonRef: "fake-season-2027",
    });
  });

  it("re-importar el mismo calendario salta todas las rondas (informe, no error)", async () => {
    const { seasons } = await callerFor(ADMIN_IP, adminToken);
    const calendar = await seasons.calendar.fetch({ year: 2027 });
    const report = await seasons.calendar.import({
      seasonId: calendarSeasonId,
      calendar,
    });
    expect(report.created).toBe(0);
    expect(report.skipped.map((s) => s.round)).toEqual([1, 2, 3]);
    expect(report.skipped.every((s) => s.reason.length > 0)).toBe(true);
    // No se duplica nada.
    const gps = await seasons.gps.list({ seasonId: calendarSeasonId });
    expect(gps).toHaveLength(3);
    expect(
      await prisma.auditLog.count({
        where: { action: "gp.created", entityId: { in: gps.map((g) => g.id) } },
      }),
    ).toBe(3);
    // La import sí se audita de nuevo (fue una acción del admin).
    expect(
      await prisma.auditLog.count({
        where: { action: "calendar.imported", entityId: calendarSeasonId },
      }),
    ).toBe(2);
  });

  it("import con año que no coincide con la temporada → BAD_REQUEST", async () => {
    const { seasons } = await callerFor(ADMIN_IP, adminToken);
    const otherYear = await fakeSource.fetchSeasonCalendar(2028);
    await expect(
      seasons.calendar.import({ seasonId: calendarSeasonId, calendar: otherYear }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: /no coincide/ });
  });

  it("import con calendario inválido (GP sin carrera) → BAD_REQUEST", async () => {
    const { seasons } = await callerFor(ADMIN_IP, adminToken);
    const calendar = await seasons.calendar.fetch({ year: 2027 });
    const invalid: NormalizedSeasonCalendar = {
      ...calendar,
      gps: [
        {
          round: 1,
          name: "GP Sin Carrera",
          circuit: { name: "Circuito Roto", country: "Falsia", location: null },
          date: new Date("2027-03-07T13:00:00.000Z"),
          sourceEventRef: null,
          events: [{ type: "q2", startTime: null }],
        },
      ],
    };
    await expect(
      seasons.calendar.import({ seasonId: calendarSeasonId, calendar: invalid }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("import en una temporada inexistente → NOT_FOUND", async () => {
    const { seasons } = await callerFor(ADMIN_IP, adminToken);
    const calendar = await seasons.calendar.fetch({ year: 2027 });
    await expect(
      seasons.calendar.import({ seasonId: randomUUID(), calendar }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // ── RBAC y lecturas públicas ──────────────────────────────────────────────

  it("un usuario normal no puede crear circuitos/GPs ni importar calendario (FORBIDDEN)", async () => {
    const { seasons } = await callerFor(USER_IP, userToken);
    const calendar = await fakeSource.fetchSeasonCalendar(2027);
    await expect(
      seasons.circuits.create({ name: "Circuito Usuario", country: "Usuario" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      seasons.gps.create({
        seasonId,
        round: 9,
        name: "GP Usuario",
        circuitId,
        date: new Date("2026-09-06T13:00:00Z"),
        events: [{ type: "q2" }, { type: "race" }],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(seasons.calendar.fetch({ year: 2027 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      seasons.calendar.import({ seasonId: calendarSeasonId, calendar }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("sin sesión, las mutaciones y el calendario rechazan con UNAUTHORIZED", async () => {
    const { seasons } = await callerFor(ADMIN_IP);
    await expect(
      seasons.circuits.create({ name: "Circuito Anónimo", country: "Anónimo" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(seasons.calendar.fetch({ year: 2027 })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("un usuario normal puede listar circuitos y GPs (lectura pública)", async () => {
    const { seasons } = await callerFor(USER_IP, userToken);
    const circuits = await seasons.circuits.list();
    expect(circuits.some((c) => c.id === circuitId)).toBe(true);
    const gps = await seasons.gps.list({ seasonId });
    expect(gps.map((g) => g.round)).toEqual([1, 2]);
  });
});
