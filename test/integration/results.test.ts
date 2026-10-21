/**
 * US-16 · Importación manual de resultados (PostgreSQL real).
 *
 * Mismo patrón que `market.test.ts`: los módulos de la app leen el entorno al
 * importar (singletons de Prisma y Redis), así que `DATABASE_URL` y
 * `REDIS_URL` se fijan ANTES del `import()` dinámico. El router `results` es
 * inyectable: se monta con la BD efímera.
 *
 * Semánticas bajo test (ADR-0018):
 * - Filas nuevas: `status = provisional`, `results_version = null`,
 *   `source = manual`; valores en `raw` (JSON) + desnormalización de
 *   `position`/`rawPoints`.
 * - Re-importar con los mismos valores = no-op (sin auditoría ni histórico).
 * - Valores distintos = corrección: `results_history` (antes→nuevo, motivo,
 *   actor, versión en vigor); `definitive → corrected`, `provisional` se
 *   mantiene; `reason` obligatorio cuando hay correcciones.
 * - Filas no presentes en el payload se conservan (`kept`).
 * - Efectos: `results_events.status = finished`; `weekend_events`
 *   `scheduled → finished`.
 * - Auditoría (T-09): `results.import` / `results.correct` (payload completo
 *   en `afterData`), en la misma transacción; no-op → sin entrada.
 * - Rechazos: Q1, GP/evento cancelado, piloto desconocido, semántica por
 *   tipo de evento (códigos de bono/penalización), `finished` sin posición,
 *   corrección sin motivo.
 * - RBAC: todo `adminProcedure` (403 para `user`, 401 sin sesión).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ResultBonusCode, ResultPenaltyCode } from "../../app/shared/types";
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
const { createResultsRouter } = await import("../../app/server/routers/results");
const { createContext } = await import("../../app/server/trpc");
const { InMemoryRateLimitStore } = await import("../../app/modules/identity");

const suffix = randomUUID().slice(0, 8);
const email = (name: string) => `${name}-${suffix}@test.local`;
const username = (name: string) => `${name}_${suffix}`;
const PASSWORD = "contraseña-segura-1";
const ADMIN_EMAIL = email("admin");
const ADMIN_IP = "198.51.100.42";
const USER_IP = "198.51.100.43";

/** Entrada de resultados con valores por defecto coherentes (DNF). */
function entry(
  riderId: string,
  values: {
    position?: number | null;
    started?: boolean;
    finished?: boolean;
    penalties?: ResultPenaltyCode[];
    bonuses?: ResultBonusCode[];
    rawPoints?: number | null;
  } = {},
) {
  return {
    riderId,
    position: values.position ?? null,
    started: values.started ?? true,
    finished: values.finished ?? false,
    penalties: values.penalties ?? [],
    bonuses: values.bonuses ?? [],
    rawPoints: values.rawPoints ?? null,
  };
}

describe("US-16 · Importación manual de resultados (PostgreSQL real)", () => {
  let prisma: ReturnType<typeof createPrisma>;
  let authRouter: ReturnType<typeof createAuthRouter>;
  let resultsRouter: ReturnType<typeof createResultsRouter>;
  let world: World;
  let adminId: string;
  let adminToken: string;
  let userToken: string;

  // Pilotos del mundo.
  let r1: string;
  let r2: string;
  let r3: string;
  let r4: string;
  let r5: string;

  // Eventos del GP del mundo (seedWorld crea solo la carrera, orderNum 1).
  let q1: string;
  let q2: string;
  let sprint: string;
  let cancelledSprint: string;

  // GP cancelado (ronda 2) con su carrera: rechazos de GP/evento.
  let cancelledGpId: string;
  let cancelledGpEventId: string;

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
    resultsRouter = createResultsRouter({ prisma });
    world = await seedWorld(prisma);
    r1 = world.riders[0].id;
    r2 = world.riders[1].id;
    r3 = world.riders[2].id;
    r4 = world.riders[3].id;
    r5 = world.riders[4].id;

    // Resto del fin de semana (la creación de GPs/eventos es US-05; aquí solo
    // se necesitan las filas para las semánticas de importación).
    q1 = (await prisma.weekendEvent.create({ data: { gpId: world.gp.id, type: "q1", orderNum: 2 } }))
      .id;
    q2 = (await prisma.weekendEvent.create({ data: { gpId: world.gp.id, type: "q2", orderNum: 3 } }))
      .id;
    sprint = (
      await prisma.weekendEvent.create({ data: { gpId: world.gp.id, type: "sprint", orderNum: 4 } })
    ).id;
    cancelledSprint = (
      await prisma.weekendEvent.create({
        data: { gpId: world.gp.id, type: "sprint", orderNum: 5, status: "cancelled" },
      })
    ).id;

    // GP cancelado con su carrera (rechazos de GP cancelado y evento de otro GP).
    cancelledGpId = (
      await prisma.gp.create({
        data: {
          seasonId: world.season.id,
          round: 2,
          name: `GP ${suffix} cancelado`,
          circuitId: world.gp.circuitId,
          date: new Date("2099-06-08T12:00:00Z"),
          status: "cancelled",
        },
      })
    ).id;
    cancelledGpEventId = (
      await prisma.weekendEvent.create({
        data: { gpId: cancelledGpId, type: "race", orderNum: 1 },
      })
    ).id;

    // Admin global (bootstrap, ADR-0010) + usuario normal.
    const authCaller = await callerFor(ADMIN_IP);
    const adminReg = await authCaller.auth.register({
      email: ADMIN_EMAIL,
      username: username("admin"),
      password: PASSWORD,
      termsAccepted: true,
    });
    adminId = adminReg.user.id;
    adminToken = sessionTokenFrom(authCaller.ctx);

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
    const req = new Request("http://localhost/api/trpc/results", {
      method: "POST",
      headers,
    });
    const ctx = await createContext(req, prisma);
    return {
      ctx,
      auth: authRouter.createCaller(ctx),
      results: resultsRouter.createCaller(ctx),
    };
  }

  /** Extrae el token de la cookie de sesión emitida en `ctx.pendingCookies`. */
  function sessionTokenFrom(ctx: { pendingCookies: string[] }): string {
    expect(ctx.pendingCookies).toHaveLength(1);
    const token = /^session=([0-9a-f]{64});/.exec(ctx.pendingCookies[0] ?? "")?.[1];
    if (!token) throw new Error(`Cookie de sesión inesperada: ${ctx.pendingCookies[0]}`);
    return token;
  }

  const raceId = () => world.event.id;

  // ── Vistas de solo lectura (antes de importar) ────────────────────────────

  it("gpEvents lista solo q2/sprint/race (sin Q1) y resultsStatus null antes de importar", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    const events = await results.gpEvents({ gpId: world.gp.id });
    expect(events).toEqual([
      { id: raceId(), type: "race", orderNum: 1, status: "scheduled", resultsStatus: null },
      { id: q2, type: "q2", orderNum: 3, status: "scheduled", resultsStatus: null },
      { id: sprint, type: "sprint", orderNum: 4, status: "scheduled", resultsStatus: null },
      { id: cancelledSprint, type: "sprint", orderNum: 5, status: "cancelled", resultsStatus: null },
    ]);
  });

  it("gpEvents devuelve NOT_FOUND si el GP no existe", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    await expect(results.gpEvents({ gpId: randomUUID() })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "El GP no existe.",
    });
  });

  it("eventResults devuelve una lista vacía sin filas importadas", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    const view = await results.eventResults({ gpId: world.gp.id, eventId: raceId() });
    expect(view).toEqual([]);
  });

  // ── RBAC ───────────────────────────────────────────────────────────────────

  it("un usuario normal no puede importar ni leer resultados (403 FORBIDDEN)", async () => {
    const { results } = await callerFor(USER_IP, userToken);
    await expect(
      results.importEvent({ gpId: world.gp.id, eventId: raceId(), entries: [entry(r1)] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(results.gpEvents({ gpId: world.gp.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      results.eventResults({ gpId: world.gp.id, eventId: raceId() }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("un usuario no autenticado no puede importar resultados (401)", async () => {
    const { results } = await callerFor(USER_IP); // sin cookie de sesión
    await expect(
      results.importEvent({ gpId: world.gp.id, eventId: raceId(), entries: [entry(r1)] }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  // ── Creación ───────────────────────────────────────────────────────────────

  it("un admin importa la carrera: filas provisional + efectos + auditoría results.import", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    const payload = {
      gpId: world.gp.id,
      eventId: raceId(),
      entries: [
        entry(r1, { position: 1, finished: true, bonuses: ["fastest-lap"], rawPoints: 25.5 }),
        entry(r2), // DNF: salió y no terminó
      ],
    };
    const summary = await results.importEvent(payload);
    expect(summary).toEqual({ created: 2, corrected: 0, unchanged: 0, kept: 0 });

    // Filas: provisional, sin versión, fuente manual, valores en `raw` +
    // desnormalización de `position`/`rawPoints`.
    const rows = await prisma.result.findMany({
      where: { gpId: world.gp.id, eventId: raceId() },
    });
    expect(rows).toHaveLength(2);
    const r1Row = rows.find((r) => r.riderId === r1);
    expect(r1Row).toMatchObject({
      position: 1,
      status: "provisional",
      resultsVersion: null,
      source: "manual",
      sourceName: "manual",
    });
    expect(r1Row && Number(r1Row.rawPoints)).toBe(25.5);
    expect(r1Row?.raw).toEqual({
      position: 1,
      started: true,
      finished: true,
      penalties: [],
      bonuses: ["fastest-lap"],
      rawPoints: 25.5,
    });
    const r2Row = rows.find((r) => r.riderId === r2);
    expect(r2Row).toMatchObject({ position: null, status: "provisional", resultsVersion: null });
    expect(r2Row?.raw).toEqual({
      position: null,
      started: true,
      finished: false,
      penalties: [],
      bonuses: [],
      rawPoints: null,
    });

    // Efectos: `results_events` finished + `weekend_events` scheduled → finished.
    const resultsEvent = await prisma.resultsEvent.findUniqueOrThrow({
      where: { gpId_eventId: { gpId: world.gp.id, eventId: raceId() } },
    });
    expect(resultsEvent.status).toBe("finished");
    const race = await prisma.weekendEvent.findUniqueOrThrow({ where: { id: raceId() } });
    expect(race.status).toBe("finished");
    // La vista gpEvents refleja el estado.
    const events = await results.gpEvents({ gpId: world.gp.id });
    expect(events.find((e) => e.id === raceId())).toMatchObject({
      status: "finished",
      resultsStatus: "finished",
    });

    // Sin histórico todavía.
    expect(await prisma.resultsHistory.count()).toBe(0);

    // Auditoría results.import: quién, cuándo (IP) y valores completos; el
    // motivo por defecto es "importación manual".
    const audit = await prisma.auditLog.findMany({
      where: { action: "results.import", entityId: raceId() },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: adminId, entity: "results", ip: ADMIN_IP });
    expect(audit[0]?.afterData).toEqual({
      gpId: world.gp.id,
      eventId: raceId(),
      entries: [
        {
          riderId: r1,
          position: 1,
          started: true,
          finished: true,
          penalties: [],
          bonuses: ["fastest-lap"],
          rawPoints: 25.5,
        },
        {
          riderId: r2,
          position: null,
          started: true,
          finished: false,
          penalties: [],
          bonuses: [],
          rawPoints: null,
        },
      ],
      reason: "importación manual",
    });
  });

  it("la vista eventResults muestra las filas con estado derivado (posición asc, nulls last)", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    const view = await results.eventResults({ gpId: world.gp.id, eventId: raceId() });
    expect(view).toEqual([
      {
        riderId: r1,
        riderName: world.riders[0].name,
        position: 1,
        started: true,
        finished: true,
        penalties: [],
        bonuses: ["fastest-lap"],
        rawPoints: 25.5,
        derivedStatus: "FINISHED",
        status: "provisional",
        resultsVersion: null,
      },
      {
        riderId: r2,
        riderName: world.riders[1].name,
        position: null,
        started: true,
        finished: false,
        penalties: [],
        bonuses: [],
        rawPoints: null,
        derivedStatus: "DNF",
        status: "provisional",
        resultsVersion: null,
      },
    ]);
  });

  // ── Idempotencia (invariante 6) ────────────────────────────────────────────

  it("re-importar los mismos valores es un no-op (sin auditoría ni histórico)", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    const summary = await results.importEvent({
      gpId: world.gp.id,
      eventId: raceId(),
      entries: [
        entry(r1, { position: 1, finished: true, bonuses: ["fastest-lap"], rawPoints: 25.5 }),
        entry(r2),
      ],
    });
    expect(summary).toEqual({ created: 0, corrected: 0, unchanged: 2, kept: 0 });
    // Una sola fila por piloto (sin duplicados) y sin nuevas entradas de
    // auditoría ni histórico (el no-op no audita).
    expect(
      await prisma.result.count({ where: { gpId: world.gp.id, eventId: raceId() } }),
    ).toBe(2);
    expect(
      await prisma.auditLog.count({ where: { action: "results.import", entityId: raceId() } }),
    ).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "results.correct" } })).toBe(0);
    expect(await prisma.resultsHistory.count()).toBe(0);
  });

  // ── Corrección ─────────────────────────────────────────────────────────────

  it("una corrección actualiza la fila + histórico + auditoría results.correct (provisional se mantiene)", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    const summary = await results.importEvent({
      gpId: world.gp.id,
      eventId: raceId(),
      entries: [
        entry(r1, { position: 2, finished: true, bonuses: ["fastest-lap"], rawPoints: 25.5 }),
        entry(r2), // inalterado
      ],
      reason: "corrección de parrilla",
    });
    expect(summary).toEqual({ created: 0, corrected: 1, unchanged: 1, kept: 0 });

    // Fila actualizada; provisional se mantiene (no es definitive).
    const r1Row = await prisma.result.findUniqueOrThrow({
      where: { gpId_eventId_riderId: { gpId: world.gp.id, eventId: raceId(), riderId: r1 } },
    });
    expect(r1Row).toMatchObject({ position: 2, status: "provisional", resultsVersion: null });
    expect(r1Row.raw).toMatchObject({ position: 2 });

    // Histórico: antes→nuevo, motivo, actor, versión en vigor (null).
    const history = await prisma.resultsHistory.findMany({ where: { resultId: r1Row.id } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      reason: "corrección de parrilla",
      userId: adminId,
      resultsVersion: null,
    });
    expect(history[0]?.beforeData).toEqual({
      position: 1,
      started: true,
      finished: true,
      penalties: [],
      bonuses: ["fastest-lap"],
      rawPoints: 25.5,
    });
    expect(history[0]?.afterData).toEqual({
      position: 2,
      started: true,
      finished: true,
      penalties: [],
      bonuses: ["fastest-lap"],
      rawPoints: 25.5,
    });

    // Auditoría results.correct: correcciones antes/después + payload completo
    // + motivo.
    const audit = await prisma.auditLog.findMany({
      where: { action: "results.correct", entityId: raceId() },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: adminId, entity: "results", ip: ADMIN_IP });
    expect(audit[0]?.beforeData).toEqual({
      gpId: world.gp.id,
      eventId: raceId(),
      corrections: [
        {
          riderId: r1,
          before: {
            position: 1,
            started: true,
            finished: true,
            penalties: [],
            bonuses: ["fastest-lap"],
            rawPoints: 25.5,
          },
        },
      ],
    });
    expect(audit[0]?.afterData).toEqual({
      gpId: world.gp.id,
      eventId: raceId(),
      corrections: [
        {
          riderId: r1,
          after: {
            position: 2,
            started: true,
            finished: true,
            penalties: [],
            bonuses: ["fastest-lap"],
            rawPoints: 25.5,
          },
        },
      ],
      entries: [
        {
          riderId: r1,
          position: 2,
          started: true,
          finished: true,
          penalties: [],
          bonuses: ["fastest-lap"],
          rawPoints: 25.5,
        },
        {
          riderId: r2,
          position: null,
          started: true,
          finished: false,
          penalties: [],
          bonuses: [],
          rawPoints: null,
        },
      ],
      reason: "corrección de parrilla",
    });
    // La auditoría de creación no se repite.
    expect(
      await prisma.auditLog.count({ where: { action: "results.import", entityId: raceId() } }),
    ).toBe(1);
  });

  it("una importación mixta (crear + corregir) audita results.correct con el payload completo", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    const summary = await results.importEvent({
      gpId: world.gp.id,
      eventId: raceId(),
      entries: [
        entry(r2, { position: 3, finished: true }), // DNF → 3º (corrección)
        entry(r3, { position: 4, finished: true }), // fila nueva
      ],
      reason: "resultados finales de la carrera",
    });
    // r1 está en BD pero no en el payload → se conserva (kept).
    expect(summary).toEqual({ created: 1, corrected: 1, unchanged: 0, kept: 1 });

    const r2Row = await prisma.result.findUniqueOrThrow({
      where: { gpId_eventId_riderId: { gpId: world.gp.id, eventId: raceId(), riderId: r2 } },
    });
    expect(r2Row).toMatchObject({ position: 3, status: "provisional" });
    const r3Row = await prisma.result.findUniqueOrThrow({
      where: { gpId_eventId_riderId: { gpId: world.gp.id, eventId: raceId(), riderId: r3 } },
    });
    expect(r3Row).toMatchObject({ position: 4, status: "provisional" });

    // Dos correcciones auditadas en total; la última cubre ambas entradas.
    const audit = await prisma.auditLog.findMany({
      where: { action: "results.correct", entityId: raceId() },
      orderBy: { createdAt: "asc" },
    });
    expect(audit).toHaveLength(2);
    const last = audit[1];
    expect(last?.beforeData).toMatchObject({
      corrections: [{ riderId: r2, before: { position: null } }],
    });
    expect(last?.afterData).toMatchObject({
      corrections: [{ riderId: r2, after: { position: 3 } }],
      entries: [
        { riderId: r2, position: 3, started: true, finished: true },
        { riderId: r3, position: 4, started: true, finished: true },
      ],
      reason: "resultados finales de la carrera",
    });
  });

  it("las filas no presentes en el payload se conservan (kept, sin auditoría)", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    const summary = await results.importEvent({
      gpId: world.gp.id,
      eventId: raceId(),
      entries: [entry(r1, { position: 2, finished: true, bonuses: ["fastest-lap"], rawPoints: 25.5 })],
    });
    expect(summary).toEqual({ created: 0, corrected: 0, unchanged: 1, kept: 2 });

    // Las filas conservadas no se tocan.
    const kept = await prisma.result.findMany({
      where: { gpId: world.gp.id, eventId: raceId(), riderId: { in: [r2, r3] } },
    });
    expect(kept.map((r) => r.position).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([3, 4]);
    // No-op parcial: sin auditoría nueva ni histórico nuevo.
    expect(
      await prisma.auditLog.count({ where: { action: "results.correct", entityId: raceId() } }),
    ).toBe(2);
    expect(await prisma.resultsHistory.count()).toBe(2);
  });

  it("una corrección sobre una fila definitive la pasa a corrected (conserva la versión en vigor)", async () => {
    // Simula el estado posterior a un recálculo (US-18/19): fila definitive
    // con la versión de resultados en vigor.
    const r1Row = await prisma.result.findUniqueOrThrow({
      where: { gpId_eventId_riderId: { gpId: world.gp.id, eventId: raceId(), riderId: r1 } },
    });
    await prisma.result.update({
      where: { id: r1Row.id },
      data: { status: "definitive", resultsVersion: "rv-1" },
    });

    const { results } = await callerFor(ADMIN_IP, adminToken);
    const summary = await results.importEvent({
      gpId: world.gp.id,
      eventId: raceId(),
      entries: [entry(r1, { position: 1, finished: true, bonuses: ["fastest-lap"], rawPoints: 25.5 })],
      reason: "error de transcripción",
    });
    expect(summary).toEqual({ created: 0, corrected: 1, unchanged: 0, kept: 2 });

    const after = await prisma.result.findUniqueOrThrow({ where: { id: r1Row.id } });
    expect(after).toMatchObject({ position: 1, status: "corrected", resultsVersion: "rv-1" });

    // El histórico referencia la versión en vigor al momento de la corrección.
    const history = await prisma.resultsHistory.findMany({
      where: { resultId: r1Row.id },
      orderBy: { createdAt: "asc" },
    });
    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({
      reason: "error de transcripción",
      userId: adminId,
      resultsVersion: "rv-1",
    });
    expect(history[1]?.beforeData).toMatchObject({ position: 2 });
    expect(history[1]?.afterData).toMatchObject({ position: 1 });
  });

  it("un admin importa la clasificación Q2 (pole, ABSENT y DNF derivados)", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    const summary = await results.importEvent({
      gpId: world.gp.id,
      eventId: q2,
      entries: [
        entry(r1, { position: 1, finished: true, bonuses: ["pole"] }),
        entry(r3, { started: false }), // non-starter → ABSENT
        entry(r4), // DNF
      ],
    });
    expect(summary).toEqual({ created: 3, corrected: 0, unchanged: 0, kept: 0 });

    // Efectos en el evento Q2.
    const resultsEvent = await prisma.resultsEvent.findUniqueOrThrow({
      where: { gpId_eventId: { gpId: world.gp.id, eventId: q2 } },
    });
    expect(resultsEvent.status).toBe("finished");
    const q2Event = await prisma.weekendEvent.findUniqueOrThrow({ where: { id: q2 } });
    expect(q2Event.status).toBe("finished");

    // Vista: posición asc (nulls last) y, entre nulls, por nombre; el estado
    // de puntuación se deriva (FINISHED/ABSENT/DNF).
    const view = await results.eventResults({ gpId: world.gp.id, eventId: q2 });
    expect(view.map((v) => [v.riderId, v.derivedStatus])).toEqual([
      [r1, "FINISHED"],
      [r3, "ABSENT"],
      [r4, "DNF"],
    ]);
    expect(view[0]).toMatchObject({ position: 1, bonuses: ["pole"], status: "provisional" });
    expect(view[1]).toMatchObject({ position: null, started: false, finished: false });
    expect(view[2]).toMatchObject({ position: null, started: true, finished: false });

    // Auditoría results.import del Q2 (motivo por defecto).
    const audit = await prisma.auditLog.findMany({
      where: { action: "results.import", entityId: q2 },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.afterData).toMatchObject({
      reason: "importación manual",
      entries: [
        { riderId: r1, position: 1, bonuses: ["pole"] },
        { riderId: r3, position: null, started: false },
        { riderId: r4, position: null, started: true },
      ],
    });
  });

  // ── Rechazos (todo o nada) ─────────────────────────────────────────────────

  it("rechaza Q1 (PRECONDITION_FAILED)", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    await expect(
      results.importEvent({ gpId: world.gp.id, eventId: q1, entries: [entry(r1, { position: 1, finished: true })] }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "Q1 no es un evento de resultados.",
    });
  });

  it("rechaza un GP cancelado (PRECONDITION_FAILED)", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    await expect(
      results.importEvent({
        gpId: cancelledGpId,
        eventId: cancelledGpEventId,
        entries: [entry(r1, { position: 1, finished: true })],
      }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "El GP está cancelado: no se pueden importar resultados.",
    });
  });

  it("rechaza un evento cancelado (PRECONDITION_FAILED)", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    await expect(
      results.importEvent({
        gpId: world.gp.id,
        eventId: cancelledSprint,
        entries: [entry(r1, { position: 1, finished: true })],
      }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "El evento está cancelado: no se pueden importar resultados.",
    });
  });

  it("rechaza un piloto desconocido (PRECONDITION_FAILED)", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    const unknownId = randomUUID();
    await expect(
      results.importEvent({
        gpId: world.gp.id,
        eventId: raceId(),
        entries: [entry(unknownId, { position: 1, finished: true })],
      }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: `Hay pilotos que no existen en el mercado: ${unknownId}.`,
    });
  });

  it("rechaza pilotos repetidos en el payload (BAD_REQUEST, Zod)", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    await expect(
      results.importEvent({
        gpId: world.gp.id,
        eventId: raceId(),
        entries: [entry(r1, { position: 1, finished: true }), entry(r1, { position: 2, finished: true })],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rechaza finished sin posición (BAD_REQUEST, Zod)", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    await expect(
      results.importEvent({
        gpId: world.gp.id,
        eventId: raceId(),
        entries: [entry(r1, { finished: true })],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rechaza un bono de otro evento (BAD_REQUEST, núcleo puro)", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    await expect(
      results.importEvent({
        gpId: world.gp.id,
        eventId: raceId(),
        entries: [entry(r1, { position: 1, finished: true, bonuses: ["pole"] })],
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: `${world.riders[0].name}: El bono «pole» no es válido en carrera principal`,
    });
  });

  it("rechaza fastest-lap sin terminar (BAD_REQUEST, núcleo puro)", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    await expect(
      results.importEvent({
        gpId: world.gp.id,
        eventId: raceId(),
        entries: [entry(r2, { bonuses: ["fastest-lap"] })],
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: `${world.riders[1].name}: El bono de vuelta rápida exige que el piloto haya terminado la carrera`,
    });
  });

  it("rechaza time-penalty en Q2 (BAD_REQUEST, núcleo puro)", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    await expect(
      results.importEvent({
        gpId: world.gp.id,
        eventId: q2,
        entries: [entry(r1, { position: 1, finished: true, penalties: ["time-penalty"] })],
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: `${world.riders[0].name}: La penalización «time-penalty» no es válida en Q2`,
    });
  });

  it("rechaza pole sin posición en Q2 (BAD_REQUEST, núcleo puro)", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    await expect(
      results.importEvent({
        gpId: world.gp.id,
        eventId: q2,
        entries: [entry(r4, { bonuses: ["pole"] })],
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: `${world.riders[3].name}: El bono de pole exige que el piloto haya clasificado (posición en Q2)`,
    });
  });

  it("rechaza una corrección sin motivo (BAD_REQUEST)", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    await expect(
      results.importEvent({
        gpId: world.gp.id,
        eventId: raceId(),
        entries: [entry(r1, { position: 5, finished: true })],
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "El motivo es obligatorio cuando la importación corrige resultados existentes.",
    });
  });

  it("rechaza un GP inexistente (NOT_FOUND)", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    await expect(
      results.importEvent({
        gpId: randomUUID(),
        eventId: raceId(),
        entries: [entry(r1, { position: 1, finished: true })],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "El GP no existe." });
  });

  it("rechaza un evento de otro GP (NOT_FOUND)", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    await expect(
      results.importEvent({
        gpId: world.gp.id,
        eventId: cancelledGpEventId,
        entries: [entry(r1, { position: 1, finished: true })],
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "El evento no existe en este GP.",
    });
  });

  it("un rechazo semántico es atómico (ninguna fila se escribe)", async () => {
    const { results } = await callerFor(ADMIN_IP, adminToken);
    // r4 es válido y nuevo; r5 trae un bono inválido en carrera → rechazo
    // atómico: ni la fila de r4 se crea.
    await expect(
      results.importEvent({
        gpId: world.gp.id,
        eventId: raceId(),
        entries: [
          entry(r4, { position: 10, finished: true }),
          entry(r5, { position: 11, finished: true, bonuses: ["pole"] }),
        ],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(
      await prisma.result.count({
        where: { gpId: world.gp.id, eventId: raceId(), riderId: { in: [r4, r5] } },
      }),
    ).toBe(0);
    // Sin auditoría por el intento fallido (1 import + 3 correct previas).
    expect(
      await prisma.auditLog.count({
        where: { action: { in: ["results.import", "results.correct"] }, entityId: raceId() },
      }),
    ).toBe(4);
  });
});
